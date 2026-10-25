//! Arquivamento de workspace em segundo plano, sem prender o estado.
//!
//! O usuário vê o workspace sumir na hora: [`crate::store::Store::begin_archive`] só marca
//! `archived = true, state = "archiving"` (gravar o JSON, sob o lock do estado). O resto roda numa
//! thread ([`spawn`]), sem lock nenhum:
//!
//! 1. mata as sessões de terminal do workspace (em paralelo), logo no início;
//! 2. espera a janela do "Desfazer" ([`grace`]); desfazer nela não mexeu em nada no disco;
//! 3. fecha o PR (se pedido) em paralelo com o script de archive (com tempo máximo e log);
//! 4. checkpoint das mudanças (rápido: ver [`crate::checkpoint::create`]) e cópia de `.context/`;
//! 5. move o worktree para a lixeira do Kabul no mesmo volume (`rename`, instantâneo), solta o registro
//!    do worktree no git e apaga a branch se pedido;
//! 6. devolve o resultado para quem chamou gravar no estado (de novo um lock curto) e apaga a pasta
//!    da lixeira em segundo plano, com prioridade baixa ([`purge`]). Lixo que sobrou (app fechado no
//!    meio) é apagado na próxima abertura ([`sweep`]).
//!
//! Erro em qualquer passo volta o workspace para a lista (quem chamou avisa, com "Tentar de novo").
use crate::store::{Repo, Workspace};
use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Nome da lixeira (pasta irmã dos worktrees, no mesmo volume).
pub const TRASH: &str = ".kabul-trash";

/// Janela do "Desfazer" antes de tocar no disco (`KABUL_ARCHIVE_GRACE_MS`, padrão 5 s).
pub fn grace() -> Duration {
    Duration::from_millis(std::env::var("KABUL_ARCHIVE_GRACE_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(5000))
}

/// Tempo máximo do script de archive (`KABUL_ARCHIVE_SCRIPT_TIMEOUT_S`, padrão 120 s).
pub fn script_timeout() -> Duration {
    Duration::from_secs(std::env::var("KABUL_ARCHIVE_SCRIPT_TIMEOUT_S").ok().and_then(|v| v.parse().ok()).unwrap_or(120))
}

/// O que arquivar (montado sob o lock por `begin_archive`, usado sem lock).
#[derive(Debug, Clone)]
pub struct Plan {
    pub ws: Workspace,
    pub repo: Repo,
    /// Estado antes de arquivar (volta a ele no desfazer e no erro).
    pub prev_state: String,
    pub delete_branch: bool,
    /// Onde guardar `.context/` (`archived-contexts/<repo>/<workspace>`).
    pub contexts: PathBuf,
    /// Lixeira preferida (`<pasta dos workspaces>/.kabul-trash`).
    pub trash: PathBuf,
}

#[derive(Debug, Clone)]
pub struct Options {
    pub grace: Duration,
    pub close_pr: bool,
    pub dry_run: bool,
    /// Roda o script `archive` do settings.toml (com tempo máximo e log em `.context/archive-logs.txt`).
    pub run_script: bool,
    pub script_timeout: Duration,
    /// Mata as sessões de terminal `kabul-<nome>` e `kabul-<nome>-*`.
    pub kill_sessions: bool,
}

impl Options {
    /// Sem janela de desfazer, sem script, sem PR e sem mexer no terminal (testes e chamadas síncronas).
    pub fn bare() -> Self {
        Self { grace: Duration::ZERO, close_pr: false, dry_run: false, run_script: false, script_timeout: script_timeout(), kill_sessions: false }
    }
    /// Como no app: janela de desfazer, script e sessões.
    pub fn app() -> Self {
        Self { grace: grace(), run_script: true, kill_sessions: true, ..Self::bare() }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Outcome {
    pub checkpoint: Option<String>,
    /// Pasta na lixeira (apagada em segundo plano).
    pub trash: Option<PathBuf>,
}

// ---------------- trabalhos em andamento ----------------

const WAITING: u8 = 0;
const COMMITTED: u8 = 1;
const DONE: u8 = 2;
const CANCELLED: u8 = 3;

struct Job {
    phase: AtomicU8,
    prev_state: String,
    done: Mutex<bool>,
    cv: Condvar,
}

impl Job {
    fn finish(&self) {
        *self.done.lock().unwrap() = true;
        self.cv.notify_all();
    }
    fn wait(&self) {
        let mut d = self.done.lock().unwrap();
        while !*d {
            d = self.cv.wait(d).unwrap();
        }
    }
}

fn jobs() -> &'static Mutex<HashMap<String, Arc<Job>>> {
    static J: OnceLock<Mutex<HashMap<String, Arc<Job>>>> = OnceLock::new();
    J.get_or_init(Default::default)
}

/// Tira o trabalho do registro (só ele: um arquivamento novo do mesmo workspace pode já estar lá).
fn unregister(id: &str, job: &Arc<Job>) {
    let mut j = jobs().lock().unwrap();
    if j.get(id).is_some_and(|x| Arc::ptr_eq(x, job)) {
        j.remove(id);
    }
}

/// Há um arquivamento deste workspace rodando neste processo.
pub fn running(id: &str) -> bool {
    jobs().lock().unwrap().contains_key(id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Undo {
    /// Ainda na janela do desfazer: nada foi tocado no disco; volte o estado para `prev_state`.
    Cancelled { prev_state: String },
    /// O arquivamento já tinha começado e terminou (com sucesso ou erro): siga pelo desarquivar normal.
    Finished,
    /// Nada rodando para este workspace.
    NotRunning,
}

/// Desfazer: cancela se ainda dá; senão espera o trabalho terminar. Chame **sem** o lock do estado (o
/// fim do trabalho grava no estado).
pub fn undo(id: &str) -> Undo {
    let Some(job) = jobs().lock().unwrap().get(id).cloned() else { return Undo::NotRunning };
    if job.phase.compare_exchange(WAITING, CANCELLED, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        unregister(id, &job);
        return Undo::Cancelled { prev_state: job.prev_state.clone() };
    }
    job.wait();
    Undo::Finished
}

/// Espera o arquivamento deste workspace terminar (se houver um).
pub fn wait(id: &str) {
    let job = jobs().lock().unwrap().get(id).cloned();
    if let Some(j) = job {
        j.wait();
    }
}

/// Roda o arquivamento numa thread. `finish` recebe o resultado (para gravar no estado e avisar a UI);
/// não é chamado se o usuário desfez a tempo. Devolve `false` se já havia um rodando para o workspace.
pub fn spawn(plan: Plan, opts: Options, finish: impl FnOnce(Result<Outcome, String>) + Send + 'static) -> bool {
    let id = plan.ws.id.clone();
    let job = Arc::new(Job { phase: AtomicU8::new(WAITING), prev_state: plan.prev_state.clone(), done: Mutex::new(false), cv: Condvar::new() });
    {
        let mut j = jobs().lock().unwrap();
        if j.contains_key(&id) {
            return false;
        }
        j.insert(id.clone(), job.clone());
    }
    std::thread::Builder::new()
        .name(format!("kabul-archive-{}", plan.ws.name))
        .spawn(move || {
            let kill = opts.kill_sessions.then(|| kill_sessions(&plan.ws));
            let until = Instant::now() + opts.grace;
            while Instant::now() < until && job.phase.load(Ordering::SeqCst) == WAITING {
                std::thread::sleep(Duration::from_millis(25).min(until.saturating_duration_since(Instant::now())));
            }
            if let Some(k) = kill {
                let _ = k.join();
            }
            if job.phase.compare_exchange(WAITING, COMMITTED, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                // Desfeito a tempo: quem desfez volta o estado.
                unregister(&id, &job);
                job.finish();
                return;
            }
            let res = execute(&plan, &opts);
            let trash = res.as_ref().ok().and_then(|o| o.trash.clone());
            finish(res.map_err(|e| format!("{e:#}")));
            job.phase.store(DONE, Ordering::SeqCst);
            unregister(&id, &job);
            job.finish();
            if let Some(t) = trash {
                let _ = purge(&t);
            }
        })
        .expect("thread do arquivamento");
    true
}

/// Mata as sessões do workspace, cada uma numa thread (o `tmux kill-session` é um processo por sessão).
fn kill_sessions(w: &Workspace) -> std::thread::JoinHandle<()> {
    let main = w.tmux_session();
    std::thread::spawn(move || {
        let b = crate::term::backend();
        let mine: Vec<String> = b.sessions().into_iter().filter(|s| s == &main || s.starts_with(&format!("{main}-"))).collect();
        let hs: Vec<_> = mine.into_iter().map(|s| std::thread::spawn(move || drop(crate::term::backend().kill(&s)))).collect();
        for h in hs {
            let _ = h.join();
        }
    })
}

// ---------------- o trabalho pesado (sem lock) ----------------

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let o = crate::shell::command("git").arg("-C").arg(dir).args(args).output().context("falha ao executar git")?;
    if !o.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string())
}

/// Um lock por repositório para o que mexe nos metadados compartilhados do git (registro de worktree,
/// `branch -D`, que reescreve `packed-refs`): vários arquivamentos do mesmo repo em paralelo não brigam
/// pelo `packed-refs.lock`. Checkpoint e cópia não passam por aqui.
fn repo_lock(repo: &str) -> Arc<Mutex<()>> {
    static L: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    L.get_or_init(Default::default).lock().unwrap().entry(repo.to_string()).or_default().clone()
}

/// Arquiva de fato (síncrono, sem lock do estado): o que [`spawn`] roda depois da janela do desfazer.
pub fn execute(plan: &Plan, opts: &Options) -> Result<Outcome> {
    let (w, repo) = (&plan.ws, &plan.repo);
    let wp = Path::new(&w.path);
    let rp = Path::new(&repo.path);
    if !wp.exists() {
        // Retomada de um arquivamento interrompido depois de mover a pasta: o checkpoint já existe.
        let ck = format!("archive-{}", w.id);
        let has = git(rp, &["rev-parse", "--verify", "-q", &format!("refs/kabul-checkpoints/{ck}")]).is_ok();
        return Ok(Outcome { checkpoint: has.then_some(ck), trash: None });
    }
    let b = crate::checkpoint::busy(wp)?;
    anyhow::ensure!(b == "clean", "git ocupado ({b}); termine a operação antes de arquivar");
    // "Arquivar e fechar o PR" em paralelo com o script (o gh precisa da pasta: junta antes de mover).
    let pr = opts.close_pr.then(|| {
        let (w, dry) = (w.clone(), opts.dry_run);
        std::thread::spawn(move || crate::gitops::pr_close(&w, dry).map(|_| ()))
    });
    if opts.run_script {
        let (set, _) = crate::settings::load(rp, &repo.default_branch);
        if let Some(script) = set.scripts.archive.filter(|s| !s.trim().is_empty()) {
            run_script(&script, w, repo, opts.script_timeout);
        }
    }
    if let Some(h) = pr {
        h.join().map_err(|_| anyhow::anyhow!("fechar o PR: a thread caiu"))?.context("fechar o PR")?;
    }
    let ckpt = crate::checkpoint::create(wp, &format!("archive-{}", w.id), "arquivamento")?.id;
    let ctx = wp.join(".context");
    if ctx.is_dir() {
        std::fs::create_dir_all(&plan.contexts)?;
        crate::store::copy_dir(&ctx, &plan.contexts)?;
    }
    let lock = repo_lock(&repo.path);
    let _g = lock.lock().unwrap();
    let trash = remove_worktree(rp, wp, &plan.trash)?;
    if plan.delete_branch {
        git(rp, &["branch", "-D", &w.branch])?;
    }
    crate::gitops::invalidate(&w.path);
    Ok(Outcome { checkpoint: Some(ckpt), trash })
}

/// Script `archive` do settings.toml na pasta do workspace: saída em `.context/archive-logs.txt`;
/// passou do tempo, o grupo de processos é encerrado e o arquivamento segue (como antes, o código de
/// saída não impede arquivar).
fn run_script(script: &str, w: &Workspace, repo: &Repo, timeout: Duration) {
    let log = Path::new(&w.path).join(".context/archive-logs.txt");
    let _ = std::fs::create_dir_all(log.parent().unwrap());
    let Ok(out) = std::fs::File::create(&log) else { return };
    let Ok(err) = out.try_clone() else { return };
    let sh = crate::shell::Shell::for_scripts();
    let mut c = crate::shell::command(&sh.program);
    c.args(sh.run_args(script, false)).current_dir(&w.path).envs(w.full_env(repo)).stdin(std::process::Stdio::null()).stdout(out).stderr(err);
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut c, 0);
    let Ok(mut child) = c.spawn() else { return };
    let until = Instant::now() + timeout;
    let code = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s.code().map(|c| c.to_string()).unwrap_or_else(|| "sinal".into()),
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                break format!("tempo esgotado ({} s)", timeout.as_secs());
            }
        }
    };
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(&log) {
        let _ = writeln!(f, "[kabul] script de archive saiu com {code}");
    }
}

/// Tira o worktree do caminho: `rename` para a lixeira (instantâneo no mesmo volume) e solta o registro
/// dele no git (o equivalente a `git worktree prune` só para ele: os worktrees de outros, mesmo num
/// disco desconectado, ficam). Sem lixeira possível (outro volume, arquivo aberto no Windows): o
/// `git worktree remove --force` de sempre. Devolve a pasta na lixeira.
pub fn remove_worktree(repo: &Path, wp: &Path, trash: &Path) -> Result<Option<PathBuf>> {
    // `.git` do worktree: `gitdir: <repo>/.git/worktrees/<nome>`.
    let admin = std::fs::read_to_string(wp.join(".git")).ok().and_then(|s| s.strip_prefix("gitdir:").map(|p| PathBuf::from(p.trim()))).map(|p| if p.is_absolute() { p } else { wp.join(p) });
    let Some(admin) = admin.filter(|a| a.parent().and_then(|p| p.file_name()).is_some_and(|n| n == "worktrees")) else {
        crate::worktree::remove(repo, wp, true)?;
        return Ok(None);
    };
    let name = format!("{}-{}", wp.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), crate::store::now_nanos());
    let fallback = wp.parent().map(|p| p.join(TRASH));
    let moved = [Some(trash.to_path_buf()), fallback].into_iter().flatten().find_map(|t| {
        std::fs::create_dir_all(&t).ok()?;
        let dest = t.join(&name);
        std::fs::rename(wp, &dest).ok().map(|_| dest)
    });
    let Some(dest) = moved else {
        crate::worktree::remove(repo, wp, true)?;
        return Ok(None);
    };
    if std::fs::remove_dir_all(&admin).is_err() {
        let _ = git(repo, &["worktree", "prune"]);
    }
    Ok(Some(dest))
}

/// Apaga uma pasta da lixeira em segundo plano, com prioridade baixa (no macOS, QoS "utility": abaixo
/// do app e dos builds, sem a fome do "background", que com o disco ocupado levava minutos e segurava
/// GBs na lixeira; no Linux, `nice` + `ionice -c3`). O processo sobrevive ao app fechar. Só aceita
/// pastas dentro de uma lixeira do Kabul.
pub fn purge(path: &Path) -> Option<std::thread::JoinHandle<()>> {
    if path.parent().and_then(|p| p.file_name()).is_none_or(|n| n != TRASH) || !path.exists() {
        return None;
    }
    let p = path.to_path_buf();
    Some(std::thread::spawn(move || {
        #[cfg(unix)]
        {
            let mut c = if cfg!(target_os = "macos") && Path::new("/usr/sbin/taskpolicy").exists() {
                let mut c = std::process::Command::new("/usr/sbin/taskpolicy");
                c.args(["-c", "utility", "/usr/bin/nice", "-n", "10", "/bin/rm", "-rf", "--"]);
                c
            } else if crate::harness::which("ionice").is_some() {
                let mut c = std::process::Command::new("ionice");
                c.args(["-c3", "nice", "-n", "19", "rm", "-rf", "--"]);
                c
            } else {
                let mut c = std::process::Command::new("nice");
                c.args(["-n", "19", "rm", "-rf", "--"]);
                c
            };
            if c.arg(&p).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success()) {
                return;
            }
        }
        let _ = std::fs::remove_dir_all(&p);
    }))
}

/// Lixo pendente (app fechado antes de terminar de apagar): apaga tudo o que houver nas lixeiras.
/// Uma vez por pasta por processo.
pub fn sweep(dirs: impl IntoIterator<Item = PathBuf>) -> Vec<std::thread::JoinHandle<()>> {
    static SEEN: OnceLock<Mutex<std::collections::HashSet<PathBuf>>> = OnceLock::new();
    let mut out = vec![];
    for d in dirs {
        if d.file_name().is_none_or(|n| n != TRASH) || !SEEN.get_or_init(Default::default).lock().unwrap().insert(d.clone()) {
            continue;
        }
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            out.extend(purge(&e.path()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purge_so_dentro_da_lixeira() {
        let tmp = std::env::temp_dir().join(format!("kabul-purge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let fora = tmp.join("fora");
        std::fs::create_dir_all(&fora).unwrap();
        assert!(purge(&fora).is_none(), "fora da lixeira não apaga");
        assert!(fora.exists());
        let lixo = tmp.join(TRASH).join("ws-1");
        std::fs::create_dir_all(lixo.join("node_modules/a")).unwrap();
        std::fs::write(lixo.join("node_modules/a/x.js"), "x").unwrap();
        purge(&lixo).unwrap().join().unwrap();
        assert!(!lixo.exists());
        std::fs::remove_dir_all(&tmp).ok();
    }

    /// Lixo deixado por um app fechado no meio é apagado na próxima abertura.
    #[test]
    fn lixo_pendente_recuperado() {
        let tmp = std::env::temp_dir().join(format!("kabul-sweep-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let t = tmp.join(TRASH);
        for n in ["a-1", "b-2"] {
            std::fs::create_dir_all(t.join(n).join("target/debug")).unwrap();
            std::fs::write(t.join(n).join("target/debug/bin"), vec![0u8; 4096]).unwrap();
        }
        let hs = sweep([t.clone(), tmp.join("nao-e-lixeira")]);
        assert_eq!(hs.len(), 2);
        hs.into_iter().for_each(|h| h.join().unwrap());
        assert_eq!(std::fs::read_dir(&t).unwrap().count(), 0);
        assert!(sweep([t.clone()]).is_empty(), "uma vez por processo");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
