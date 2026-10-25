//! Multiplexador próprio sobre PTY (ConPTY no Windows, openpty no Unix, via `portable-pty`): o que o
//! Kabul usava do tmux sem depender dele. Cada sessão tem um nome, um pane (`%N`), um emulador de
//! terminal (`vt100`) que guarda a tela e o scrollback para capture/snapshot, e quantos espectadores
//! quiserem (cada `attach` recebe a mesma saída).
//!
//! As sessões vivem no processo que as criou (o app, com o kabuld embutido, ou o `kabuld`): fechar o app
//! encerra os terminais. A sessão termina quando o comando sai, como no tmux.
use super::{Cmd, Conn, Launch, PaneInfo, Stream, TerminalBackend, What};
use crate::harness::{which, CmdSpec};
use crate::shell::Shell;
use anyhow::{bail, Context, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::num::NonZeroU16;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Linhas de scrollback por sessão.
const SCROLLBACK: usize = 10_000;

type Subs = Mutex<Vec<Sender<(String, Vec<u8>)>>>;

struct Sess {
    name: String,
    pane: String,
    cwd: String,
    command: String,
    pid: u32,
    term: Mutex<vt100::Parser>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    job: Option<crate::job::Job>,
    subs: Subs,
    activity: AtomicU64,
}

#[derive(Default)]
struct Inner {
    sessions: Mutex<Vec<Arc<Sess>>>,
    seq: AtomicU32,
}

impl Inner {
    fn find(&self, target: &str) -> Option<Arc<Sess>> {
        let t = target.strip_prefix('=').unwrap_or(target);
        self.sessions.lock().unwrap().iter().find(|s| s.pane == t || s.name == t).cloned()
    }
    /// Tira a sessão da lista (só esta: outra com o mesmo nome pode já ter nascido) e fecha os streams.
    fn finish(&self, s: &Arc<Sess>) {
        self.sessions.lock().unwrap().retain(|x| !Arc::ptr_eq(x, s));
        s.subs.lock().unwrap().clear();
        s.writer.lock().unwrap().take();
        s.master.lock().unwrap().take();
    }
}

/// Backend PTY. Clones compartilham as mesmas sessões.
#[derive(Clone, Default)]
pub struct Mux {
    inner: Arc<Inner>,
}

fn now() -> u64 {
    crate::procs::now()
}

fn nz(v: u16) -> NonZeroU16 {
    NonZeroU16::new(v.max(1)).unwrap_or(NonZeroU16::MIN)
}

fn base(p: &str) -> String {
    let b = p.rsplit(['/', '\\']).next().unwrap_or(p);
    b.strip_suffix(".exe").or_else(|| b.strip_suffix(".EXE")).unwrap_or(b).to_string()
}

/// No Windows o `CreateProcessW` não roda `.cmd`/`.bat` direto (é o caso dos CLIs do npm): vai pelo cmd.
pub fn windows_batch(spec: CmdSpec, windows: bool) -> CmdSpec {
    let lower = spec.program.to_ascii_lowercase();
    if windows && (lower.ends_with(".cmd") || lower.ends_with(".bat")) {
        let comspec = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        let mut args = vec!["/C".to_string(), spec.program.clone()];
        args.extend(spec.args.iter().cloned());
        return CmdSpec { program: comspec, args, ..spec };
    }
    spec
}

/// Programa, argumentos e ambiente de uma sessão (testável com shells quaisquer).
pub fn build(l: &Launch, interactive: &Shell, scripts: &Shell, windows: bool) -> CmdSpec {
    let mut env = l.env.clone();
    let spec = match &l.what {
        What::Shell => interactive.spec(interactive.interactive_args()),
        What::Run { cmd, log } => {
            let line = match cmd {
                Cmd::Line(s) => s.clone(),
                Cmd::Spec(sp) => {
                    env.extend(sp.env.iter().cloned());
                    scripts.join(sp)
                }
            };
            scripts.spec(scripts.run_args(&scripts.script_line(&line, log.as_deref()), true))
        }
        What::Exec(Cmd::Spec(sp)) => {
            env.extend(sp.env.iter().cloned());
            let program = which(&sp.program).map(|p| p.display().to_string()).unwrap_or_else(|| sp.program.clone());
            windows_batch(CmdSpec { program, args: sp.args.clone(), cwd: None, env: vec![] }, windows)
        }
        What::Exec(Cmd::Line(s)) => scripts.spec(scripts.run_args(s, false)),
    };
    CmdSpec { cwd: l.cwd.clone(), env, ..spec }
}

impl Mux {
    /// Multiplexador isolado (testes).
    pub fn new() -> Self {
        Self::default()
    }

    /// O do processo: o app e o kabuld embutido enxergam as mesmas sessões.
    pub fn global() -> Self {
        static G: OnceLock<Mux> = OnceLock::new();
        G.get_or_init(Mux::new).clone()
    }

    fn get(&self, target: &str) -> Result<Arc<Sess>> {
        self.inner.find(target).with_context(|| format!("sessão {target} não encontrada"))
    }

    fn spawn(&self, l: &Launch, spec: CmdSpec) -> Result<()> {
        let (cols, rows) = (80u16, 24u16);
        let pair = native_pty_system().openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).context("abrindo o PTY")?;
        let mut cb = CommandBuilder::new(&spec.program);
        cb.args(&spec.args);
        let cwd = spec.cwd.clone().filter(|d| std::path::Path::new(d).is_dir()).unwrap_or_else(|| crate::paths::home().display().to_string());
        cb.cwd(&cwd);
        if !cfg!(windows) {
            cb.env("TERM", "xterm-256color");
            cb.env("COLORTERM", "truecolor");
        }
        for (k, v) in &spec.env {
            cb.env(k, v);
        }
        let mut child = pair.slave.spawn_command(cb).with_context(|| format!("iniciando {}", spec.program))?;
        // Sem a ponta escrava aberta aqui, a leitura recebe EOF quando o comando sai (Unix).
        drop(pair.slave);
        let pid = child.process_id().unwrap_or(0);
        let job = crate::job::Job::new();
        if let Some(j) = &job {
            j.assign(pid);
        }
        let mut reader = pair.master.try_clone_reader().context("leitura do PTY")?;
        let writer = pair.master.take_writer().context("escrita do PTY")?;
        let pane = format!("%{}", self.inner.seq.fetch_add(1, Ordering::SeqCst));
        let s = Arc::new(Sess {
            name: l.name.clone(),
            pane: pane.clone(),
            cwd,
            command: base(&spec.program),
            pid,
            term: Mutex::new(vt100::Parser::new(nz(rows), nz(cols), SCROLLBACK)),
            writer: Mutex::new(Some(writer)),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(child.clone_killer()),
            job,
            subs: Mutex::new(vec![]),
            activity: AtomicU64::new(now()),
        });
        self.inner.sessions.lock().unwrap().push(s.clone());

        // Leitura: alimenta o emulador e repassa a todos os espectadores.
        let (inner, rs) = (self.inner.clone(), s.clone());
        let (done_tx, done_rx) = channel::<()>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = &buf[..n];
                        rs.term.lock().unwrap().process(data);
                        rs.activity.store(now(), Ordering::Relaxed);
                        rs.subs.lock().unwrap().retain(|tx| tx.send((rs.pane.clone(), data.to_vec())).is_ok());
                    }
                }
            }
            let _ = done_tx.send(());
            inner.finish(&rs);
        });

        // Espera o comando: fecha o PTY (no Windows o ConPTY só entrega o EOF depois disso) e encerra a
        // sessão mesmo se um processo em segundo plano segurar a leitura.
        let (inner, ws) = (self.inner.clone(), s);
        std::thread::spawn(move || {
            let _ = child.wait();
            ws.master.lock().unwrap().take();
            let _ = done_rx.recv_timeout(Duration::from_millis(500));
            inner.finish(&ws);
        });
        Ok(())
    }

    /// Todas as linhas do scrollback (até `history`) mais a tela, em texto puro.
    fn text_with_history(p: &mut vt100::Parser, history: usize) -> Vec<String> {
        let screen = p.screen_mut();
        let (rows, cols) = screen.size();
        let (rows, cols) = (rows.get() as usize, cols.get());
        screen.set_scrollback(usize::MAX);
        let mut off = screen.scrollback().min(history);
        let mut lines = vec![];
        while off > 0 {
            screen.set_scrollback(off);
            let take = off.min(rows);
            lines.extend(screen.rows(0, cols).take(take));
            off -= take;
        }
        screen.set_scrollback(0);
        lines.extend(screen.rows(0, cols));
        lines
    }
}

struct PtyConn {
    s: Arc<Sess>,
    mux: Mux,
}

impl Conn for PtyConn {
    fn input(&mut self, pane: &str, data: &[u8]) -> Result<()> {
        // Mesma regra do tmux -C: só o id `%N` do pane desta sessão.
        anyhow::ensure!(super::is_pane_id(pane) && pane == self.s.pane, "pane inválido: {pane:?}");
        write_to(&self.s, data)
    }
    fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.mux.resize(&self.s.name, cols, rows)
    }
}

fn write_to(s: &Sess, data: &[u8]) -> Result<()> {
    let mut w = s.writer.lock().unwrap();
    let w = w.as_mut().context("o terminal já fechou")?;
    w.write_all(data)?;
    w.flush()?;
    Ok(())
}

impl TerminalBackend for Mux {
    fn kind(&self) -> &'static str {
        "pty"
    }
    fn list(&self) -> Result<Vec<super::Pane>> {
        Ok(self
            .inner
            .sessions
            .lock()
            .unwrap()
            .iter()
            .map(|s| super::Pane { session: s.name.clone(), window_index: 0, window_name: s.command.clone(), pane_index: 0, pane_id: s.pane.clone(), pid: s.pid, command: s.command.clone(), path: s.cwd.clone(), active: true, title: String::new() })
            .collect())
    }
    fn has(&self, session: &str) -> bool {
        self.inner.sessions.lock().unwrap().iter().any(|s| s.name == session)
    }
    fn open(&self, l: &Launch) -> Result<()> {
        if self.has(&l.name) {
            bail!("a sessão {} já existe", l.name);
        }
        let spec = build(l, &Shell::interactive(), &Shell::for_scripts(), cfg!(windows));
        self.spawn(l, spec)
    }
    fn kill(&self, session: &str) -> Result<()> {
        let s = self.inner.sessions.lock().unwrap().iter().find(|s| s.name == session).cloned().with_context(|| format!("sessão {session} não encontrada"))?;
        // O grupo inteiro (o que o shell abriu), depois o próprio processo.
        if let Some(j) = &s.job {
            j.terminate();
        }
        crate::job::kill_tree(s.pid);
        let _ = s.killer.lock().unwrap().kill();
        self.inner.finish(&s);
        Ok(())
    }
    fn capture(&self, target: &str, history: u32) -> Result<String> {
        let s = self.get(target)?;
        let mut p = s.term.lock().unwrap();
        Ok(Self::text_with_history(&mut p, history as usize).join("\n") + "\n")
    }
    fn plain(&self, target: &str) -> Result<String> {
        let s = self.get(target)?;
        let p = s.term.lock().unwrap();
        let cols = p.screen().size().1.get();
        Ok(p.screen().rows(0, cols).collect::<Vec<_>>().join("\n") + "\n")
    }
    fn screen(&self, target: &str) -> Result<String> {
        let s = self.get(target)?;
        let p = s.term.lock().unwrap();
        Ok(p.screen().contents_formatted())
    }
    fn send(&self, target: &str, data: &[u8]) -> Result<()> {
        write_to(&*self.get(target)?, data)
    }
    fn resize(&self, session: &str, cols: u16, rows: u16) -> Result<()> {
        let s = self.get(session)?;
        let (cols, rows) = (cols.max(2), rows.max(2));
        if let Some(m) = s.master.lock().unwrap().as_ref() {
            m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).context("redimensionando o PTY")?;
        }
        s.term.lock().unwrap().screen_mut().set_size(nz(rows), nz(cols));
        Ok(())
    }
    fn info(&self, target: &str) -> Option<PaneInfo> {
        let s = self.inner.find(target)?;
        let (rows, cols) = s.term.lock().unwrap().screen().size();
        Some(PaneInfo { cols: cols.get(), rows: rows.get(), activity: s.activity.load(Ordering::Relaxed) })
    }
    fn attach(&self, session: &str) -> Result<Stream> {
        let s = self.get(session)?;
        let (tx, rx) = channel();
        s.subs.lock().unwrap().push(tx);
        Ok(Stream::new(Box::new(PtyConn { s, mux: self.clone() }), rx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn sh(script: &str) -> What {
        if cfg!(windows) {
            What::Exec(Cmd::Spec(CmdSpec::new("powershell.exe", ["-NoProfile", "-NoLogo", "-Command", script])))
        } else {
            What::Exec(Cmd::Spec(CmdSpec::new("sh", ["-c", script])))
        }
    }

    /// Shell interativo do teste: `sh` no Unix, `cmd` no Windows.
    fn interactive() -> What {
        What::Exec(Cmd::Spec(if cfg!(windows) { CmdSpec::new("cmd.exe", ["/Q"]) } else { CmdSpec::new("sh", Vec::<String>::new()) }))
    }

    fn until(secs: u64, mut f: impl FnMut() -> bool) -> bool {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(secs) {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        f()
    }

    fn name(tag: &str) -> String {
        format!("kabul-test-pty-{tag}-{}", std::process::id())
    }

    /// Sessão nomeada, dois espectadores com a mesma saída, tela, captura, resize e kill.
    #[test]
    fn sessao_compartilhada() {
        let mux = Mux::new();
        let n = name("par");
        mux.open(&Launch::new(&n, None, interactive())).unwrap();
        assert!(mux.has(&n));
        assert!(mux.open(&Launch::new(&n, None, interactive())).is_err(), "nome repetido");
        let pane = mux.pane_of(&n).unwrap();
        assert!(pane.starts_with('%'));
        let mut a = mux.attach(&n).unwrap();
        let b = mux.attach(&n).unwrap();
        // `4^2` no cmd e `$((40+2))` no sh: o eco do que foi digitado não contém "kabul-42".
        let line: &[u8] = if cfg!(windows) { b"echo kabul-4^2\r" } else { b"echo kabul-$((40+2))\r" };
        a.input(&pane, line).unwrap();
        let (ra, rb) = (a.output.take().unwrap(), b.output.as_ref().unwrap());
        let (mut ga, mut gb) = (String::new(), String::new());
        assert!(
            until(10, || {
                while let Ok((_, d)) = ra.try_recv() {
                    ga.push_str(&String::from_utf8_lossy(&d));
                }
                while let Ok((_, d)) = rb.try_recv() {
                    gb.push_str(&String::from_utf8_lossy(&d));
                }
                ga.contains("kabul-42") && gb.contains("kabul-42")
            }),
            "{ga:?} / {gb:?}"
        );
        assert!(until(5, || mux.plain(&pane).unwrap().contains("kabul-42")));
        assert!(mux.screen(&n).unwrap().contains("kabul-42"));
        assert!(mux.capture(&pane, 100).unwrap().contains("kabul-42"));
        mux.resize(&n, 100, 30).unwrap();
        let i = mux.info(&pane).unwrap();
        assert_eq!((i.cols, i.rows), (100, 30));
        assert!(i.activity > 0);
        mux.kill(&n).unwrap();
        assert!(!mux.has(&n));
        // Os streams fecham junto.
        assert!(until(5, || matches!(ra.try_recv(), Err(std::sync::mpsc::TryRecvError::Disconnected))));
    }

    /// Como no tmux, a sessão acaba quando o comando sai.
    #[test]
    fn termina_com_o_comando() {
        let mux = Mux::new();
        let n = name("fim");
        mux.open(&Launch::new(&n, None, sh("echo fim"))).unwrap();
        assert!(until(10, || !mux.has(&n)), "a sessão continuou depois do comando sair");
    }

    /// Scrollback: a captura com histórico tem as linhas que já saíram da tela.
    #[test]
    fn scrollback() {
        let mux = Mux::new();
        let n = name("hist");
        let script = if cfg!(windows) { "0..199 | % { \"linha-$_\" }; Start-Sleep 20" } else { "i=0; while [ $i -lt 200 ]; do echo linha-$i; i=$((i+1)); done; sleep 20" };
        mux.open(&Launch::new(&n, None, sh(script))).unwrap();
        assert!(until(10, || mux.plain(&n).map(|t| t.contains("linha-199")).unwrap_or(false)));
        let all = mux.capture(&n, 1000).unwrap();
        let screen = mux.plain(&n).unwrap();
        mux.kill(&n).unwrap();
        assert!(all.contains("linha-0\n") && all.contains("linha-199"), "{all}");
        assert!(!screen.contains("linha-0\n"), "a tela só tem as últimas linhas");
        let lines: Vec<&str> = all.lines().filter(|l| l.starts_with("linha-")).collect();
        assert_eq!(lines.len(), 200, "cada linha uma vez, na ordem");
        assert_eq!(lines[10], "linha-10");
    }

    /// O ambiente vai pela API (valor com espaço e aspas, sem montar `export`).
    #[test]
    fn ambiente_pela_api() {
        let mux = Mux::new();
        let n = name("env");
        let script = if cfg!(windows) { "Write-Output \"v=$env:KABUL_TESTE\"; Start-Sleep 20" } else { "echo \"v=$KABUL_TESTE\"; sleep 20" };
        mux.open(&Launch::new(&n, None, sh(script)).env(&[("KABUL_TESTE".into(), "a b 'c'".into())])).unwrap();
        let ok = until(10, || mux.plain(&n).map(|t| t.contains("v=a b 'c'")).unwrap_or(false));
        let text = mux.plain(&n).unwrap_or_default();
        mux.kill(&n).unwrap();
        assert!(ok, "{text}");
    }

    /// Linhas de comando montadas para cada shell (sem rodar nada).
    #[test]
    fn linhas_por_shell() {
        let ps = Shell::from_program("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
        let bash = Shell::from_program("C:\\Program Files\\Git\\bin\\bash.exe");
        let env = vec![("KABUL_PORT".to_string(), "5100".to_string())];
        let l = Launch::new("w", Some("C:\\w"), What::Shell).env(&env);
        let c = build(&l, &ps, &bash, true);
        assert_eq!((c.program.as_str(), c.args.clone(), c.cwd.as_deref()), ("C:\\Program Files\\PowerShell\\7\\pwsh.exe", vec!["-NoLogo".to_string()], Some("C:\\w")));
        assert_eq!(c.env, env, "ambiente pela API");
        let run = Launch::new("w-setup", None, What::Run { cmd: Cmd::Line("npm i".into()), log: Some("C:\\w\\.context\\setup-logs.txt".into()) });
        let c = build(&run, &ps, &bash, true);
        assert_eq!(c.program, "C:\\Program Files\\Git\\bin\\bash.exe");
        assert_eq!(c.args[0], "-lc");
        assert!(c.args[1].starts_with("{ ( npm i ) 2>&1; echo \"[kabul] saiu com $?\"; } | tee -a "), "{}", c.args[1]);
        let run_ps = Launch::new("w-cloud", None, What::Run { cmd: Cmd::Spec(CmdSpec::new("claude", ["--cloud", "it's"])), log: None });
        let c = build(&run_ps, &ps, &ps, true);
        assert_eq!(c.args[..3], ["-NoLogo", "-NoExit", "-Command"]);
        assert!(c.args[3].starts_with("& { & claude --cloud 'it''s' }"), "{}", c.args[3]);
        let bat = windows_batch(CmdSpec::new("C:\\npm\\claude.cmd", ["-p", "oi"]), true);
        assert_eq!(bat.args, vec!["/C", "C:\\npm\\claude.cmd", "-p", "oi"]);
        assert_eq!(windows_batch(CmdSpec::new("/usr/bin/claude", ["-p"]), false).program, "/usr/bin/claude");
    }
}
