//! Integração com o tmux: listar panes, capturar, enviar teclas e criar sessões.
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::process::Command;

const SEP: char = '\t';

/// Formato passado a `tmux list-panes -a -F`. Campos separados por TAB.
pub const LIST_FORMAT: &str = "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_active}\t#{pane_title}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Pane {
    pub session: String,
    pub window_index: u32,
    pub window_name: String,
    pub pane_index: u32,
    pub pane_id: String,
    pub pid: u32,
    pub command: String,
    pub path: String,
    pub active: bool,
    pub title: String,
}

impl Pane {
    /// Alvo para `-t` (ex.: `%3`).
    pub fn target(&self) -> &str {
        &self.pane_id
    }
}

/// Faz o parse da saída de `tmux list-panes -a -F LIST_FORMAT`. Linhas inválidas são ignoradas.
pub fn parse_list_panes(out: &str) -> Vec<Pane> {
    out.lines().filter_map(parse_line).collect()
}

fn parse_line(line: &str) -> Option<Pane> {
    let f: Vec<&str> = line.splitn(10, SEP).collect();
    if f.len() < 9 {
        return None;
    }
    Some(Pane {
        session: f[0].to_string(),
        window_index: f[1].parse().ok()?,
        window_name: f[2].to_string(),
        pane_index: f[3].parse().ok()?,
        pane_id: f[4].to_string(),
        pid: f[5].parse().ok()?,
        command: f[6].to_string(),
        path: f[7].to_string(),
        active: f[8] == "1",
        title: f.get(9).unwrap_or(&"").to_string(),
    })
}

/// `tmux -u`: força UTF-8. Sem locale (app aberto pelo Dock), o tmux troca o TAB do `-F` por "_"
/// e o parse das listas quebra ("pane não encontrado").
pub fn cmd() -> Command {
    let mut c = crate::shell::command(crate::harness::which("tmux").unwrap_or_else(|| "tmux".into()));
    c.arg("-u");
    c
}

fn tmux(args: &[&str]) -> Result<String> {
    let out = cmd().args(args).output().context("falha ao executar tmux")?;
    if !out.status.success() {
        bail!("tmux {:?}: {}", args, String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Lista todos os panes. Se não houver servidor tmux rodando, devolve lista vazia.
pub fn list_panes() -> Result<Vec<Pane>> {
    let out = cmd().args(["list-panes", "-a", "-F", LIST_FORMAT]).output().context("falha ao executar tmux")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("no server running") || err.contains("No such file") || err.contains("error connecting") {
            return Ok(vec![]);
        }
        bail!("tmux list-panes: {}", err.trim());
    }
    Ok(parse_list_panes(&String::from_utf8_lossy(&out.stdout)))
}

/// Captura o conteúdo visível (e `history` linhas de scrollback) com sequências de cor (`-e`).
pub fn capture_pane(target: &str, history: u32) -> Result<String> {
    let start = format!("-{history}");
    tmux(&["capture-pane", "-p", "-e", "-J", "-t", target, "-S", &start])
}

/// Pane com atividade e tamanho, numa única chamada ao tmux (antes eram duas listagens).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaneExt {
    pub pane: Pane,
    /// `#{window_activity}` (segundos Unix da última saída na janela).
    pub activity: u64,
    pub cols: u16,
    pub rows: u16,
}

/// Formato de [`list_panes_ext`]: atividade e tamanho antes dos campos de [`LIST_FORMAT`] (o título,
/// que pode ter TAB, continua por último).
pub fn ext_format() -> String {
    format!("#{{window_activity}}\t#{{pane_width}}\t#{{pane_height}}\t{LIST_FORMAT}")
}

pub fn parse_list_panes_ext(out: &str) -> Vec<PaneExt> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.splitn(4, SEP);
            let activity = it.next()?.parse().ok()?;
            let cols = it.next()?.parse().ok()?;
            let rows = it.next()?.parse().ok()?;
            Some(PaneExt { pane: parse_line(it.next()?)?, activity, cols, rows })
        })
        .collect()
}

pub fn list_panes_ext() -> Result<Vec<PaneExt>> {
    let out = cmd().args(["list-panes", "-a", "-F", &ext_format()]).output().context("falha ao executar tmux")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("no server running") || err.contains("No such file") || err.contains("error connecting") {
            return Ok(vec![]);
        }
        bail!("tmux list-panes: {}", err.trim());
    }
    Ok(parse_list_panes_ext(&String::from_utf8_lossy(&out.stdout)))
}

const CAPTURE_MARK: &str = "@@kabul-captura@@";

/// Argumentos de [`capture_many`]: `capture-pane ; display-message <marca> ; capture-pane ...` num
/// único processo do tmux.
pub fn capture_many_args(panes: &[&str]) -> Vec<String> {
    let mut a = vec![];
    for (i, p) in panes.iter().enumerate() {
        if i > 0 {
            a.push(";".into());
        }
        // Só o índice na marca: o display-message expande `%` como strftime (o `%3` do pane sumiria).
        a.extend(["display-message".into(), "-p".into(), format!("{CAPTURE_MARK}{i}")]);
        a.extend([";".into(), "capture-pane".into(), "-p".into(), "-t".into(), (*p).to_string()]);
    }
    a
}

/// Separa a saída de [`capture_many_args`] por pane (na ordem de `panes`).
pub fn parse_capture_many(panes: &[&str], out: &str) -> std::collections::HashMap<String, String> {
    let mut m = std::collections::HashMap::new();
    for chunk in out.split(CAPTURE_MARK).skip(1) {
        let (i, body) = chunk.split_once('\n').unwrap_or((chunk, ""));
        if let Some(p) = i.trim().parse::<usize>().ok().and_then(|i| panes.get(i)) {
            m.insert(p.to_string(), body.to_string());
        }
    }
    m
}

/// Tela visível (sem cores) de vários panes com UM processo do tmux (antes era um por pane).
pub fn capture_many(panes: &[&str]) -> std::collections::HashMap<String, String> {
    if panes.is_empty() {
        return Default::default();
    }
    let args = capture_many_args(panes);
    let mut m = match cmd().args(&args).output() {
        Ok(o) => parse_capture_many(panes, &String::from_utf8_lossy(&o.stdout)),
        Err(_) => Default::default(),
    };
    // Um pane que sumiu no meio interrompe a sequência: os que faltaram saem um a um.
    let missing: Vec<&str> = panes.iter().copied().filter(|p| !m.contains_key(*p)).collect();
    for p in missing {
        if let Ok(t) = tmux(&["capture-pane", "-p", "-t", p]) {
            m.insert(p.to_string(), t);
        }
    }
    m
}

/// Envia texto literal (`-l`) para o pane. Se `enter`, envia Enter depois.
pub fn send_text(target: &str, text: &str, enter: bool) -> Result<()> {
    tmux(&["send-keys", "-t", target, "-l", text])?;
    if enter {
        tmux(&["send-keys", "-t", target, "Enter"])?;
    }
    Ok(())
}

/// Envia teclas nomeadas do tmux (ex.: `C-c`, `Escape`, `Up`).
pub fn send_keys(target: &str, keys: &[&str]) -> Result<()> {
    let mut args = vec!["send-keys", "-t", target];
    args.extend_from_slice(keys);
    tmux(&args).map(|_| ())
}

/// Argumentos de `send-keys -H` (bytes crus em hex): repassa exatamente o que o xterm.js produz.
pub fn send_bytes_args(target: &str, data: &[u8]) -> Vec<String> {
    let mut a: Vec<String> = ["send-keys", "-t", target, "-H"].iter().map(|s| s.to_string()).collect();
    a.extend(data.iter().map(|b| format!("{b:02x}")));
    a
}

/// Envia bytes crus (teclas, sequências de escape, colagens) para o pane.
pub fn send_bytes(target: &str, data: &[u8]) -> Result<()> {
    anyhow::ensure!(!target.starts_with('-'), "alvo inválido: {target:?}");
    for chunk in data.chunks(512) {
        let args = send_bytes_args(target, chunk);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        tmux(&refs)?;
    }
    Ok(())
}

/// Redimensiona a janela do pane.
pub fn resize(target: &str, cols: u16, rows: u16) -> Result<()> {
    tmux(&["resize-window", "-t", target, "-x", &cols.to_string(), "-y", &rows.to_string()]).map(|_| ())
}

/// Tela visível pronta para um terminal (CRLF + cursor posicionado).
pub fn screen(target: &str) -> Result<String> {
    let body = tmux(&["capture-pane", "-p", "-e", "-t", target])?;
    let cur = tmux(&["display-message", "-p", "-t", target, "#{cursor_x},#{cursor_y}"])?;
    Ok(frame(&body, cur.trim()))
}

/// Junta captura + "x,y" do cursor numa sequência para o xterm.
pub fn frame(body: &str, cursor: &str) -> String {
    let body = body.strip_suffix('\n').unwrap_or(body).replace('\n', "\r\n");
    let (x, y) = cursor.split_once(',').and_then(|(x, y)| Some((x.parse::<u32>().ok()?, y.parse::<u32>().ok()?))).unwrap_or((0, 0));
    format!("{body}\x1b[{};{}H", y + 1, x + 1)
}

/// Monta os argumentos de `tmux new-session` (testável sem tmux).
pub fn new_session_args(name: &str, cwd: Option<&str>, command: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = ["new-session", "-d", "-s", name].iter().map(|s| s.to_string()).collect();
    if let Some(c) = cwd {
        a.extend(["-c".into(), c.into()]);
    }
    if let Some(cmd) = command {
        a.push(cmd.into());
    }
    a
}

/// Cria uma sessão destacada.
pub fn new_session(name: &str, cwd: Option<&str>, command: Option<&str>) -> Result<()> {
    let args = new_session_args(name, cwd, command);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    tmux(&refs).map(|_| ())
}

/// Id de pane do tmux (`%3`). É o único alvo aceito no modo de controle, onde a linha vira comando do
/// tmux: um "pane" com espaço, `;` ou quebra de linha injetaria comandos (ex.: `run-shell`).
pub fn is_pane_id(s: &str) -> bool {
    s.len() > 1 && s.len() <= 12 && s.starts_with('%') && s[1..].bytes().all(|b| b.is_ascii_digit())
}

/// Alvo exato de sessão (`=nome`): sem isso o tmux casa por prefixo (`kabul-x` acharia `kabul-x-setup`).
pub fn exact(name: &str) -> String {
    format!("={name}")
}

pub fn kill_session(name: &str) -> Result<()> {
    tmux(&["kill-session", "-t", &exact(name)]).map(|_| ())
}

pub fn has_session(name: &str) -> bool {
    cmd().args(["has-session", "-t", &exact(name)]).output().map(|o| o.status.success()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sem locale (como no app aberto pelo Dock), `tmux -u` mantém o TAB do formato.
    #[test]
    fn lista_sem_locale() {
        if crate::harness::which("tmux").is_none() {
            return;
        }
        let name = format!("kabul-test-locale-{}", std::process::id());
        new_session(&name, Some("/tmp"), Some("sleep 30")).unwrap();
        let out = cmd().env_remove("LANG").env_remove("LC_ALL").env_remove("LC_CTYPE").args(["list-panes", "-a", "-F", LIST_FORMAT]).output().unwrap();
        let panes = parse_list_panes(&String::from_utf8_lossy(&out.stdout));
        let _ = kill_session(&name);
        assert!(panes.iter().any(|p| p.session == name), "pane não encontrado sem locale");
    }

    #[test]
    fn parse_fixture() {
        let panes = parse_list_panes(include_str!("../tests/fixtures/list_panes.txt"));
        assert_eq!(panes.len(), 4);
        assert_eq!(panes[0].session, "kabul-claude");
        assert_eq!(panes[0].pane_id, "%0");
        assert_eq!(panes[0].pid, 4242);
        assert!(panes[0].active);
        assert_eq!(panes[1].command, "codex");
        assert_eq!(panes[2].path, "/home/dev/com espaço");
        assert_eq!(panes[3].title, "titulo\tcom tab");
    }

    #[test]
    fn ignora_linhas_ruins() {
        assert!(parse_list_panes("lixo\n\nx\ty\tz\n").is_empty());
    }

    #[test]
    fn bytes_e_frame() {
        assert_eq!(send_bytes_args("%1", b"a\r\x1b"), vec!["send-keys", "-t", "%1", "-H", "61", "0d", "1b"]);
        assert_eq!(frame("a\nb\n", "3,1"), "a\r\nb\x1b[2;4H");
    }

    #[test]
    fn lista_estendida_e_captura_em_lote() {
        let out = "1700000000\t120\t40\tkabul-x\t0\tzsh\t0\t%7\t42\tzsh\t/tmp\t1\ttítulo\twith tab\n";
        let v = parse_list_panes_ext(out);
        assert_eq!((v[0].activity, v[0].cols, v[0].rows, v[0].pane.pane_id.as_str(), v[0].pane.title.as_str()), (1700000000, 120, 40, "%7", "título\twith tab"));
        let a = capture_many_args(&["%1", "%2"]);
        assert_eq!(a.iter().filter(|x| *x == ";").count(), 3);
        let m = parse_capture_many(&["%1", "%2"], "@@kabul-captura@@0\nolá\n$ \n@@kabul-captura@@1\noutra\n");
        assert_eq!((m["%1"].as_str(), m["%2"].as_str()), ("olá\n$ \n", "outra\n"));
    }

    /// Captura em lote com tmux real (pula sem tmux).
    #[test]
    fn captura_em_lote_real() {
        if crate::harness::which("tmux").is_none() {
            return;
        }
        let names: Vec<String> = (0..2).map(|i| format!("kabul-test-perf-cap-{}-{i}", std::process::id())).collect();
        for (i, n) in names.iter().enumerate() {
            new_session(n, Some("/tmp"), Some(&format!("sh -c 'echo marca-{i}; sleep 30'"))).unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
        let panes: Vec<PaneExt> = list_panes_ext().unwrap().into_iter().filter(|p| names.contains(&p.pane.session)).collect();
        let ids: Vec<&str> = panes.iter().map(|p| p.pane.pane_id.as_str()).collect();
        let m = capture_many(&ids);
        for n in &names {
            let _ = kill_session(n);
        }
        assert_eq!(panes.len(), 2);
        assert!(panes.iter().all(|p| p.activity > 0 && p.cols > 0));
        for (i, p) in panes.iter().enumerate() {
            let want = format!("marca-{}", names.iter().position(|n| *n == p.pane.session).unwrap());
            assert!(m.get(&p.pane.pane_id).is_some_and(|t| t.contains(&want)), "{i}: {m:?}");
        }
    }

    #[test]
    fn args_new_session() {
        assert_eq!(new_session_args("s", Some("/tmp"), Some("claude")), vec!["new-session", "-d", "-s", "s", "-c", "/tmp", "claude"]);
        assert_eq!(new_session_args("s", None, None), vec!["new-session", "-d", "-s", "s"]);
    }
}

/// Terminal por stream: cliente tmux em modo de controle (`tmux -C attach`), sem polling.
/// Saída chega como `%output %<pane> <texto com escapes octais>`.
pub mod stream {
    use anyhow::{Context, Result};
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, ChildStdin, Stdio};
    use std::sync::mpsc::{channel, Receiver};

    /// Desfaz os escapes `\ooo` e `\\` do modo de controle.
    pub fn unescape(s: &str) -> Vec<u8> {
        let b = s.as_bytes();
        let mut out = Vec::with_capacity(b.len());
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'\\' && i + 3 < b.len() && b[i + 1..i + 4].iter().all(|c| (b'0'..=b'7').contains(c)) {
                out.push((b[i + 1] - b'0') * 64 + (b[i + 2] - b'0') * 8 + (b[i + 3] - b'0'));
                i += 4;
            } else if b[i] == b'\\' && b.get(i + 1) == Some(&b'\\') {
                out.push(b'\\');
                i += 2;
            } else {
                out.push(b[i]);
                i += 1;
            }
        }
        out
    }

    /// `%output %3 abc` → (`%3`, bytes). `%extended-output %3 <atraso> : texto` também.
    pub fn parse_line(line: &str) -> Option<(String, Vec<u8>)> {
        if let Some(rest) = line.strip_prefix("%output ") {
            let (pane, data) = rest.split_once(' ').unwrap_or((rest, ""));
            return Some((pane.into(), unescape(data)));
        }
        if let Some(rest) = line.strip_prefix("%extended-output ") {
            let (pane, rest) = rest.split_once(' ')?;
            let (_, data) = rest.split_once(" : ")?;
            return Some((pane.into(), unescape(data)));
        }
        None
    }

    pub struct TermStream {
        child: Child,
        stdin: ChildStdin,
        pub output: Option<Receiver<(String, Vec<u8>)>>,
    }

    impl TermStream {
        pub fn attach(session: &str) -> Result<Self> {
            let mut child = crate::tmux::cmd().args(["-C", "attach-session", "-t", &crate::tmux::exact(session)]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().context("tmux -C")?;
            let stdin = child.stdin.take().context("stdin")?;
            let out = child.stdout.take().context("stdout")?;
            let (tx, rx) = channel();
            std::thread::spawn(move || {
                for line in BufReader::new(out).split(b'\n').map_while(Result::ok) {
                    if let Some(x) = parse_line(&String::from_utf8_lossy(&line)) {
                        if tx.send(x).is_err() {
                            return;
                        }
                    }
                }
            });
            Ok(Self { child, stdin, output: Some(rx) })
        }
        fn cmd(&mut self, c: &str) -> Result<()> {
            self.stdin.write_all(c.as_bytes())?;
            self.stdin.write_all(b"\n")?;
            self.stdin.flush()?;
            Ok(())
        }
        pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
            self.cmd(&format!("refresh-client -C {cols}x{rows}"))
        }
        pub fn input(&mut self, pane: &str, data: &[u8]) -> Result<()> {
            anyhow::ensure!(crate::tmux::is_pane_id(pane), "pane inválido: {pane:?}");
            for chunk in data.chunks(256) {
                let hex: Vec<String> = chunk.iter().map(|b| format!("{b:02x}")).collect();
                self.cmd(&format!("send-keys -t {pane} -H {}", hex.join(" ")))?;
            }
            Ok(())
        }
    }

    impl Drop for TermStream {
        fn drop(&mut self) {
            let _ = self.cmd("detach-client");
            let _ = self.child.kill();
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn escapes() {
            assert_eq!(unescape("a\\015\\012b\\\\c"), b"a\r\nb\\c");
            assert_eq!(parse_line("%output %3 ol\\303\\241"), Some(("%3".into(), "olá".as_bytes().to_vec())));
            assert_eq!(parse_line("%extended-output %1 12 : x"), Some(("%1".into(), b"x".to_vec())));
            assert_eq!(parse_line("%begin 1 2 0"), None);
        }

        /// Ponta a ponta com tmux real (pula sem tmux).
        #[test]
        fn stream_real() {
            if crate::harness::which("tmux").is_none() {
                return;
            }
            let name = format!("kabul-test-{}", std::process::id());
            crate::tmux::new_session(&name, None, Some("sh")).unwrap();
            let pane = crate::tmux::list_panes().unwrap().into_iter().find(|p| p.session == name).unwrap().pane_id;
            let mut t = TermStream::attach(&name).unwrap();
            t.resize(100, 30).unwrap();
            t.input(&pane, b"echo kabul-$((40+2))\r").unwrap();
            let rx = t.output.take().unwrap();
            let mut got = Vec::new();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while std::time::Instant::now() < deadline && !String::from_utf8_lossy(&got).contains("kabul-42") {
                if let Ok((_, b)) = rx.recv_timeout(std::time::Duration::from_millis(200)) {
                    got.extend(b);
                }
            }
            drop(t);
            let _ = crate::tmux::cmd().args(["kill-session", "-t", &name]).status();
            assert!(String::from_utf8_lossy(&got).contains("kabul-42"), "{}", String::from_utf8_lossy(&got));
        }

        /// Segurança: o "pane" vai para a linha de comando do tmux -C; texto com `;` ou quebra de linha
        /// não pode virar comando (ex.: `run-shell`). Com tmux real, confere que nada rodou.
        #[test]
        fn pane_nao_injeta_comandos_no_modo_de_controle() {
            assert!(crate::tmux::is_pane_id("%0") && crate::tmux::is_pane_id("%123"));
            for bad in ["", "%", "0", "%1 ", "%1;run-shell x", "%1\nrun-shell x", "-t", "%1a", "sess:0.1"] {
                assert!(!crate::tmux::is_pane_id(bad), "{bad:?}");
            }
            if crate::harness::which("tmux").is_none() {
                return;
            }
            let name = format!("kabul-test-inj-{}", std::process::id());
            let marker = std::env::temp_dir().join(format!("kabul-inj-{}", std::process::id()));
            let _ = std::fs::remove_file(&marker);
            crate::tmux::new_session(&name, None, Some("sh")).unwrap();
            let pane = crate::tmux::list_panes().unwrap().into_iter().find(|p| p.session == name).unwrap().pane_id;
            let mut t = TermStream::attach(&name).unwrap();
            for evil in [format!("{pane} -H 61 ; run-shell 'touch {}'", marker.display()), format!("{pane}\nrun-shell 'touch {}'", marker.display())] {
                assert!(t.input(&evil, b"x").is_err(), "{evil:?}");
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
            drop(t);
            let _ = crate::tmux::cmd().args(["kill-session", "-t", &name]).status();
            assert!(!marker.exists(), "comando injetado rodou");
        }
    }
}
