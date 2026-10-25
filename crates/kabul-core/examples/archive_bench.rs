//! Bench do arquivamento: repo sintético com muitos arquivos rastreados, `node_modules/` e `target/`
//! ignorados (~1–2 GB) e mudanças não commitadas; mede quanto o usuário espera, quanto tempo o
//! mutex do estado fica preso e quanto leva cada fase (checkpoint, mover para a lixeira, apagar).
//!
//! Números (MacBook, ~1,5 GB, 15 mil rastreados + 80 mil ignorados): ver `docs/perf/arquivar.json`.
//!
//! `cargo run -p kabul-core --example archive_bench` (debug basta: o tempo é de git e disco).
//! Variáveis: `KABUL_BENCH_MB` (tamanho dos ignorados, padrão 1200), `KABUL_BENCH_TRACKED` (arquivos
//! rastreados, padrão 15000), `KABUL_BENCH_DIR` (pasta temporária; apagada no fim).
use kabul_core::store::Store;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn git(dir: &Path, args: &[&str]) {
    let o = std::process::Command::new("git").arg("-C").arg(dir).args(["-c", "user.name=b", "-c", "user.email=b@b"]).args(args).output().unwrap();
    assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
}

fn env_n(k: &str, d: usize) -> usize {
    std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d)
}

/// Preenche `dir` com `files` arquivos somando ~`mb` MB, em subpastas de 200.
fn fill(dir: &Path, files: usize, mb: usize) {
    let size = (mb << 20) / files.max(1);
    let buf: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
    for i in 0..files {
        let d = dir.join(format!("pkg{}", i / 200));
        if i % 200 == 0 {
            std::fs::create_dir_all(&d).unwrap();
        }
        std::fs::write(d.join(format!("f{i}.js")), &buf).unwrap();
    }
}

fn du_mb(p: &Path) -> u64 {
    let o = std::process::Command::new("du").args(["-sk"]).arg(p).output().unwrap();
    String::from_utf8_lossy(&o.stdout).split_whitespace().next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0) / 1024
}

/// Workspace novo com os ignorados pesados e mudanças não commitadas.
fn workspace(st: &mut Store, repo_id: &str, mb: usize, tracked: usize) -> kabul_core::store::Workspace {
    let w = st.create_workspace(repo_id).unwrap();
    let wp = Path::new(&w.path).to_path_buf();
    let t = Instant::now();
    fill(&wp.join("node_modules"), env_n("KABUL_BENCH_FILES", 80_000), mb * 5 / 6);
    fill(&wp.join("target"), 120, mb / 6);
    for i in (0..tracked).step_by(300).take(50) {
        std::fs::write(wp.join("src").join(format!("m{}", i / 300)).join(format!("a{i}.rs")), "// mudado\n").unwrap();
    }
    for i in 0..20 {
        std::fs::write(wp.join(format!("novo{i}.txt")), "novo\n").unwrap();
    }
    std::fs::write(wp.join(".context/nota.md"), "contexto").unwrap();
    eprintln!("workspace sintético {}: {} MB, {tracked} rastreados + {} ignorados (montado em {:.1?})", w.name, du_mb(&wp), env_n("KABUL_BENCH_FILES", 80_000) + 120, t.elapsed());
    w
}

/// Thread "UI": lê a lista a cada 10 ms e guarda a maior espera pelo lock do estado.
struct Probe {
    stop: Arc<std::sync::atomic::AtomicBool>,
    worst: Arc<Mutex<Duration>>,
    h: std::thread::JoinHandle<()>,
}

impl Probe {
    fn start(store: &Arc<Mutex<Store>>) -> Self {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let worst = Arc::new(Mutex::new(Duration::ZERO));
        let (store, s2, w2) = (store.clone(), stop.clone(), worst.clone());
        let h = std::thread::spawn(move || {
            while !s2.load(std::sync::atomic::Ordering::Relaxed) {
                let t = Instant::now();
                let n = store.lock().unwrap().state.workspaces.len();
                let d = t.elapsed();
                let mut w = w2.lock().unwrap();
                *w = (*w).max(d);
                drop(w);
                std::hint::black_box(n);
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        Self { stop, worst, h }
    }
    fn stop(self) -> Duration {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        self.h.join().unwrap();
        let w = *self.worst.lock().unwrap();
        w
    }
}

fn wait_until(cond: impl Fn() -> bool, max: Duration) -> Duration {
    let t = Instant::now();
    while !cond() && t.elapsed() < max {
        std::thread::sleep(Duration::from_millis(5));
    }
    t.elapsed()
}

fn main() {
    let mb = env_n("KABUL_BENCH_MB", 1200);
    let tracked = env_n("KABUL_BENCH_TRACKED", 15000);
    let base = std::env::var_os("KABUL_BENCH_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join(format!("kabul-archive-bench-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&base);
    let repo = base.join("repo");
    std::fs::create_dir_all(repo.join("src")).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    std::fs::write(repo.join(".gitignore"), "node_modules/\ntarget/\n").unwrap();
    for i in 0..tracked {
        let d = repo.join("src").join(format!("m{}", i / 300));
        if i % 300 == 0 {
            std::fs::create_dir_all(&d).unwrap();
        }
        std::fs::write(d.join(format!("a{i}.rs")), format!("// arquivo {i}\n{}", "fn x() {}\n".repeat(400))).unwrap();
    }
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-qm", "base"]);
    let mut st = Store::open(base.join("state.json"), base.join("ws"), "bench".into()).unwrap();
    let r = st.add_repo(&repo).unwrap();

    if std::env::var_os("KABUL_BENCH_FASES").is_some() {
        let w = workspace(&mut st, &r.id, mb, tracked);
        let wp = Path::new(&w.path).to_path_buf();
        let t = Instant::now();
        kabul_core::checkpoint::create(&wp, "fase", "fase").unwrap();
        let ck = t.elapsed();
        let t = Instant::now();
        let lixo = kabul_core::archive::remove_worktree(&repo, &wp, &st.trash_dir()).unwrap();
        let mv = t.elapsed();
        let t = Instant::now();
        if let Some(h) = lixo.as_deref().and_then(kabul_core::archive::purge) {
            h.join().unwrap();
        }
        println!("fases: checkpoint {ck:.2?}; worktree para a lixeira {mv:.2?}; apagar a lixeira (fundo, prioridade baixa) {:.2?}", t.elapsed());
        let _ = std::fs::remove_dir_all(&base);
        return;
    }

    // 1) Síncrono (a mesma chamada medida no "antes": `archive_workspace_opts` com o lock preso).
    let w = workspace(&mut st, &r.id, mb, tracked);
    let wp = Path::new(&w.path).to_path_buf();
    let store = Arc::new(Mutex::new(st));
    let probe = Probe::start(&store);
    let t = Instant::now();
    store.lock().unwrap().archive_workspace_opts(&w.id, false).unwrap();
    let total = t.elapsed();
    let worst = probe.stop();
    let lixo = wait_until(|| std::fs::read_dir(store.lock().unwrap().trash_dir()).map(|d| d.count() == 0).unwrap_or(true), Duration::from_secs(120));
    println!("DEPOIS, síncrono: chamada {total:.2?}; lista travada por até {worst:.2?}; pasta some: {}; lixeira vazia em +{lixo:.2?} (fundo)", !wp.exists());

    // 2) Como no app: begin (lock curto) + trabalho em segundo plano (sem janela de desfazer, para medir).
    let w = workspace(&mut store.lock().unwrap(), &r.id, mb, tracked);
    let wp = Path::new(&w.path).to_path_buf();
    let probe = Probe::start(&store);
    let t = Instant::now();
    let plan = store.lock().unwrap().begin_archive(&w.id, false).unwrap();
    let ui = t.elapsed();
    let (tx, rx) = std::sync::mpsc::channel();
    let (st2, id, prev) = (store.clone(), w.id.clone(), plan.prev_state.clone());
    let opts = kabul_core::archive::Options { kill_sessions: false, run_script: false, grace: Duration::ZERO, ..kabul_core::archive::Options::app() };
    kabul_core::archive::spawn(plan, opts, move |res| {
        st2.lock().unwrap().finish_archive(&id, &prev, &res).unwrap();
        tx.send(()).unwrap();
    });
    let gone = wait_until(|| !wp.exists(), Duration::from_secs(120));
    rx.recv().unwrap();
    let done = t.elapsed();
    let worst = probe.stop();
    let lixo = wait_until(|| std::fs::read_dir(store.lock().unwrap().trash_dir()).map(|d| d.count() == 0).unwrap_or(true), Duration::from_secs(120));
    println!("DEPOIS, app: some da lista em {ui:.2?}; lista travada por até {worst:.2?}; pasta fora do lugar em {gone:.2?}; arquivado (checkpoint gravado) em {done:.2?}; lixeira vazia em +{lixo:.2?} (fundo)");
    let _ = std::fs::remove_dir_all(&base);
}
