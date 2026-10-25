//! `kabul loadtest`: teste de carga do backend (ESCALA: muitos workspaces e agentes ao mesmo tempo).
//!
//! O processo pai sobe um **worker** (o mesmo binário, `kabul loadtest-worker`) com o kabuld de
//! verdade, N workspaces sintéticos e M agentes falsos que emitem eventos (texto em streaming,
//! ferramentas, uso) no ritmo pedido, pelo mesmo caminho dos agentes reais (`ChatHub`). O pai conecta
//! K clientes WebSocket (como o app e o celular), mede a latência evento → cliente (cada evento leva o
//! instante em que foi emitido), o tempo de resposta das listagens (RPC) e amostra CPU e memória do
//! worker. Sai um relatório JSON; com `--budgets` compara com os limites e devolve código 1 se algum
//! passar (usado no CI).
//!
//! Sessões tmux de teste (`--tmux N`) usam o prefixo `kabul-test-perf-` e são removidas no fim.
use anyhow::{bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use kabul_core::harness::{Event, HarnessKind};
use kabul_core::store::{Repo, Store, Workspace};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio_tungstenite::tungstenite::Message;

/// Prefixo das sessões tmux criadas pelo teste (nunca tocamos em outras).
pub const TMUX_PREFIX: &str = "kabul-test-perf-";

#[derive(Debug, Clone)]
pub struct Opts {
    pub workspaces: usize,
    pub agents: usize,
    /// Eventos por segundo por agente.
    pub rate: f64,
    pub duration: u64,
    pub warmup: u64,
    pub clients: usize,
    pub tmux: usize,
    pub monitor_ms: u64,
    /// Limite de agentes simultâneos no kabuld (governança); `None` = sem limite.
    pub max_agents: Option<usize>,
    /// Pede compressão por mensagem ao kabuld (`hello.compress`), quando o servidor oferecer.
    pub compress: bool,
    pub out: Option<PathBuf>,
    pub budgets: Option<PathBuf>,
    pub label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorkerOpts {
    pub home: PathBuf,
    pub port: u16,
    pub workspaces: usize,
    pub agents: usize,
    pub rate: f64,
    pub tmux: usize,
    pub monitor_ms: u64,
    pub max_agents: Option<usize>,
}

fn now_us() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0)
}

/// Marca de tempo embutida no texto dos eventos: `⟦<µs desde a época>⟧`.
fn stamp() -> String {
    format!("\u{27e6}{}\u{27e7}", now_us())
}

/// Todas as marcas de tempo de um quadro (texto cru, sem parse do JSON).
pub fn stamps(frame: &str) -> impl Iterator<Item = u64> + '_ {
    frame.split('\u{27e6}').skip(1).filter_map(|p| p.split('\u{27e7}').next()?.parse().ok())
}

pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((p / 100.0) * (sorted.len() - 1) as f64).round() as usize;
    sorted[i.min(sorted.len() - 1)]
}

fn summary(mut v: Vec<f64>) -> Value {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let avg = if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    json!({
        "n": v.len(),
        "avg": round(avg),
        "p50": round(percentile(&v, 50.0)),
        "p95": round(percentile(&v, 95.0)),
        "p99": round(percentile(&v, 99.0)),
        "max": round(v.last().copied().unwrap_or(0.0)),
    })
}

fn round(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

// ---------------------------------------------------------------------------------------------
// Worker: kabuld + workspaces sintéticos + agentes falsos.
// ---------------------------------------------------------------------------------------------

/// Agente falso: o `send` do ChatHub libera o gerador (o turno "começa" quando o kabuld despacha,
/// inclusive se a mensagem tiver esperado vaga na fila).
struct FakeAgent {
    go: std::sync::mpsc::Sender<()>,
}

impl kabuld::chat::AgentProc for FakeAgent {
    fn send(&self, _text: &str) -> Result<()> {
        let _ = self.go.send(());
        Ok(())
    }
    fn approve(&self, _r: &str, _allow: bool, _tool: &str, _always: bool) -> Result<()> {
        Ok(())
    }
    fn kill(&mut self) -> Result<()> {
        Ok(())
    }
}

/// Monta `state.json` com `n` workspaces (pastas vazias; nenhum git é tocado).
pub fn synth_state(home: &Path, n: usize) -> Result<Vec<Workspace>> {
    let root = home.join("workspaces");
    let mut st = Store::open(home.join("state.json"), root.clone(), "perf".into())?;
    st.state = Default::default();
    let repos = n.div_ceil(10).max(1);
    for j in 0..repos {
        let path = home.join("repos").join(format!("repo-{j}"));
        std::fs::create_dir_all(&path)?;
        st.state.repos.push(Repo { id: format!("r{j}"), name: format!("repo-{j}"), path: path.display().to_string(), default_branch: "main".into(), ..Default::default() });
    }
    for i in 0..n {
        let j = i % repos;
        let path = root.join(format!("repo-{j}")).join(format!("perf-{i}"));
        std::fs::create_dir_all(&path)?;
        st.state.workspaces.push(Workspace {
            id: format!("w{i}"),
            repo_id: format!("r{j}"),
            name: format!("perf-{i}"),
            branch: format!("perf/{i}"),
            path: path.display().to_string(),
            created_at: kabul_core::store::now(),
            status: "in-progress".into(),
            state: "ready".into(),
            port: 0,
            ..Default::default()
        });
    }
    st.save()?;
    Ok(st.state.workspaces)
}

fn tmux_name(i: usize) -> String {
    format!("{TMUX_PREFIX}{}-{i}", std::process::id())
}

/// Um turno sintético: texto em streaming com uma ferramenta no meio e uso no fim.
fn turn_event(step: usize, turn: u64) -> Event {
    match step {
        12 => Event::ToolUse { id: format!("t{turn}"), name: "Bash".into(), input: json!({"command": "cargo test", "stamp": stamp()}) },
        13 => Event::ToolResult { id: format!("t{turn}"), output: format!("{} {}", stamp(), "test ok; ".repeat(120)), is_error: false },
        38 => Event::Usage { input: Some(1200), output: Some(800), cache_read: Some(50_000), cache_write: Some(0), duration_ms: Some(4000) },
        39 => Event::TurnCompleted { result: None, input_tokens: Some(1200), output_tokens: Some(800), cost_usd: Some(0.012) },
        _ => Event::TextDelta { text: format!("{} palavra palavra palavra ", stamp()) },
    }
}
const TURN_LEN: usize = 40;

pub fn worker(o: WorkerOpts) -> Result<()> {
    std::fs::create_dir_all(&o.home)?;
    let wss = synth_state(&o.home, o.workspaces)?;
    let cfg = kabuld::Config { port: o.port, home: o.home.clone(), web_dir: None, tailscale: false, secrets: Arc::new(kabuld::secrets::MemStore::default()), monitor_ms: o.monitor_ms, assets: None };
    let srv = kabuld::start(cfg)?;
    if let Some(l) = o.max_agents {
        srv.hub.chats.governor.set_config(kabul_core::governor::Config { limit: Some(l), idle_minutes: None, nice_background: false });
    }

    let mut tmux_sessions = vec![];
    if o.tmux > 0 && kabul_core::harness::which("tmux").is_some() {
        for i in 0..o.tmux {
            let name = tmux_name(i);
            let cwd = &wss[i % wss.len()].path;
            if kabul_core::tmux::new_session(&name, Some(cwd), Some("sh -c 'i=0; while :; do i=$((i+1)); echo kabul-perf linha $i; sleep 0.2; done'")).is_ok() {
                tmux_sessions.push(name);
            }
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    let emitted = Arc::new(AtomicU64::new(0));
    let stamped = Arc::new(AtomicU64::new(0));
    let turns = Arc::new(AtomicU64::new(0));
    let owner = kabuld::auth::Principal::local_owner("loadtest");
    let mut gens = vec![];
    let interval = Duration::from_secs_f64(1.0 / o.rate.max(0.1));
    for a in 0..o.agents {
        let w = &wss[a % wss.len()];
        let (tx, rx) = std::sync::mpsc::channel();
        let (go_tx, go_rx) = std::sync::mpsc::channel();
        let meta =
            kabuld::chat::ChatMeta { id: String::new(), workspace_id: w.id.clone(), path: w.path.clone(), branch: w.branch.clone(), title: format!("agente {a}"), harness: HarnessKind::Claude, model: "falso".into(), approvals: false, account: None };
        let view = srv.hub.chats.start(meta, Box::new(FakeAgent { go: go_tx }), rx);
        let (chats, id, owner) = (srv.hub.chats.clone(), view.meta.id.clone(), owner.clone());
        let (stop, emitted, stamped, turns) = (stop.clone(), emitted.clone(), stamped.clone(), turns.clone());
        gens.push(std::thread::spawn(move || {
            // Agentes não começam todos no mesmo instante.
            std::thread::sleep(interval.mul_f64((a % 10) as f64 / 10.0));
            let mut next = Instant::now();
            let mut turn = 0u64;
            'outer: while !stop.load(Ordering::Relaxed) {
                if chats.send(&id, &owner, "tarefa sintética").is_err() {
                    break;
                }
                loop {
                    match go_rx.recv_timeout(Duration::from_millis(200)) {
                        Ok(()) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) if !stop.load(Ordering::Relaxed) => continue,
                        Err(_) => break 'outer,
                    }
                }
                turn += 1;
                for step in 0..TURN_LEN {
                    if stop.load(Ordering::Relaxed) {
                        break 'outer;
                    }
                    let ev = turn_event(step, turn);
                    if matches!(ev, Event::TextDelta { .. } | Event::ToolUse { .. } | Event::ToolResult { .. }) {
                        stamped.fetch_add(1, Ordering::Relaxed);
                    }
                    if tx.send(ev).is_err() {
                        break 'outer;
                    }
                    emitted.fetch_add(1, Ordering::Relaxed);
                    next += interval;
                    let now = Instant::now();
                    if next > now {
                        std::thread::sleep(next - now);
                    } else if now - next > Duration::from_secs(1) {
                        next = now;
                    }
                }
                turns.fetch_add(1, Ordering::Relaxed);
            }
        }));
    }

    println!("READY {}", srv.port());
    std::io::stdout().flush().ok();
    // Espera STOP (ou o pai fechar o stdin).
    let mut line = String::new();
    let stdin = std::io::stdin();
    let mut rd = stdin.lock();
    while rd.read_line(&mut line).unwrap_or(0) > 0 {
        if line.trim() == "STOP" {
            break;
        }
        line.clear();
    }
    stop.store(true, Ordering::Relaxed);
    for g in gens {
        let _ = g.join();
    }
    for s in &tmux_sessions {
        let _ = kabul_core::tmux::kill_session(s);
    }
    println!("STATS {}", json!({"emitted": emitted.load(Ordering::Relaxed), "stamped": stamped.load(Ordering::Relaxed), "turns": turns.load(Ordering::Relaxed), "tmux_sessions": tmux_sessions.len(), "governor": srv.hub.chats.governor.status()}));
    std::io::stdout().flush().ok();
    // O servidor continua no ar até o pai terminar de drenar os clientes (EXIT ou stdin fechado).
    line.clear();
    while rd.read_line(&mut line).unwrap_or(0) > 0 && line.trim() != "EXIT" {
        line.clear();
    }
    srv.stop();
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Pai: clientes WebSocket, amostragem de CPU/memória, relatório e orçamentos.
// ---------------------------------------------------------------------------------------------

#[derive(Default)]
struct ClientStats {
    frames: u64,
    bytes: u64,
    chat_events: u64,
    term_frames: u64,
    other_events: u64,
    stamps: u64,
    lat_ms: Vec<f64>,
    rpc_ms: HashMap<String, Vec<f64>>,
    lagged: u64,
    compressed_frames: u64,
    wire_bytes: u64,
}

fn inflate(b: &[u8]) -> Option<String> {
    use std::io::Read;
    let mut s = String::new();
    flate2::read::DeflateDecoder::new(b).read_to_string(&mut s).ok()?;
    Some(s)
}

async fn client(idx: usize, port: u16, compress: bool, measure_from_us: u64, until: Instant, tmux: Vec<String>, stats: Arc<Mutex<ClientStats>>) -> Result<()> {
    let (ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws")).await.context("conectando ao kabuld")?;
    let (mut tx, mut rx) = ws.split();
    let hello = if compress { json!({"hello": {"compress": "deflate"}}) } else { json!({"hello": {}}) };
    tx.send(Message::Text(hello.to_string().into())).await?;
    // O celular (cliente 2+) só assina status; o app e o espelho assinam tudo.
    let subs: &[&str] = if idx >= 2 { &["session-status", "chat-state", "sessions-changed"] } else { &["*"] };
    for s in subs {
        tx.send(Message::Text(json!({"sub": s}).to_string().into())).await?;
    }
    let mut rpc_id = 0u64;
    let mut pending: HashMap<u64, (String, Instant)> = HashMap::new();
    if idx == 0 {
        for s in &tmux {
            rpc_id += 1;
            pending.insert(rpc_id, ("term_attach".into(), Instant::now()));
            tx.send(Message::Text(json!({"id": rpc_id, "command": "term_attach", "args": {"session": s}}).to_string().into())).await?;
        }
    }
    let mut tick = tokio::time::interval(Duration::from_millis(1000));
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(until.into()) => break,
            _ = tick.tick() => {
                // Listagens que o app e o celular fazem: sessões ao vivo, workspaces e chats.
                if idx <= 1 {
                    for cmd in ["live_sessions", "workspaces_list", "chat_list", "sessions_list"] {
                        rpc_id += 1;
                        pending.insert(rpc_id, (cmd.to_string(), Instant::now()));
                        tx.send(Message::Text(json!({"id": rpc_id, "command": cmd, "args": {}}).to_string().into())).await?;
                    }
                }
            }
            m = rx.next() => {
                let Some(m) = m else { break };
                let m = m?;
                let recv_us = now_us();
                let (text, wire, compressed) = match m {
                    Message::Text(t) => { let n = t.len(); (t.to_string(), n, false) }
                    Message::Binary(b) => match inflate(&b) { Some(t) => (t, b.len(), true), None => continue },
                    Message::Close(_) => break,
                    _ => continue,
                };
                let mut st = stats.lock().unwrap();
                st.frames += 1;
                st.bytes += text.len() as u64;
                st.wire_bytes += wire as u64;
                if compressed { st.compressed_frames += 1; }
                if text.starts_with("{\"id\"") || text.contains("\"ok\":") && !text.starts_with("{\"channel\"") && !text.starts_with("{\"hello\"") {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        if let Some(id) = v["id"].as_u64() {
                            if let Some((cmd, t0)) = pending.remove(&id) {
                                if recv_us >= measure_from_us {
                                    st.rpc_ms.entry(cmd).or_default().push(t0.elapsed().as_secs_f64() * 1000.0);
                                }
                            }
                        }
                    }
                    continue;
                }
                if text.contains("\"chat-event\"") {
                    st.chat_events += 1;
                    for s in stamps(&text) {
                        st.stamps += 1;
                        if s >= measure_from_us {
                            st.lat_ms.push(recv_us.saturating_sub(s) as f64 / 1000.0);
                        }
                    }
                } else if text.contains("\"term-output\"") {
                    st.term_frames += 1;
                } else if text.contains("\"lagged\"") {
                    st.lagged += 1;
                } else {
                    st.other_events += 1;
                }
            }
        }
    }
    let _ = tx.send(Message::Close(None)).await;
    Ok(())
}

fn free_port() -> Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// Amostra CPU (% de um núcleo) e memória residente do worker.
fn sampler(pid: u32, stop: Arc<AtomicBool>, warm_until: Instant, out: Arc<Mutex<(Vec<f64>, Vec<f64>)>>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
        let mut sys = System::new();
        let pids = [Pid::from_u32(pid)];
        let kind = ProcessRefreshKind::nothing().with_cpu().with_memory();
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, kind);
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(500));
            sys.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), true, kind);
            let Some(p) = sys.process(pids[0]) else { break };
            if Instant::now() >= warm_until {
                let mut g = out.lock().unwrap();
                g.0.push(p.cpu_usage() as f64);
                g.1.push(p.memory() as f64 / (1024.0 * 1024.0));
            }
        }
    })
}

pub fn run(o: Opts) -> Result<i32> {
    let home = std::env::temp_dir().join(format!("kabul-loadtest-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    let port = free_port()?;
    let exe = std::env::current_exe()?;
    let mut child = Command::new(exe)
        .args([
            "loadtest-worker",
            "--home",
            &home.display().to_string(),
            "--port",
            &port.to_string(),
            "--workspaces",
            &o.workspaces.to_string(),
            "--agents",
            &o.agents.to_string(),
            "--rate",
            &o.rate.to_string(),
            "--tmux",
            &o.tmux.to_string(),
            "--monitor-ms",
            &o.monitor_ms.to_string(),
            "--max-agents",
            &o.max_agents.unwrap_or(0).to_string(),
        ])
        .env("KABUL_HOME", &home)
        .env("KABULD_NO_TAILSCALE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .context("iniciando o worker do loadtest")?;
    let mut out = BufReader::new(child.stdout.take().context("stdout")?);
    let mut line = String::new();
    let t_ready = Instant::now();
    loop {
        line.clear();
        if out.read_line(&mut line)? == 0 {
            let _ = child.kill();
            bail!("o worker terminou antes de ficar pronto");
        }
        if line.starts_with("READY") {
            break;
        }
    }
    let startup_ms = t_ready.elapsed().as_secs_f64() * 1000.0;
    let tmux: Vec<String> = (0..o.tmux).map(|i| format!("{TMUX_PREFIX}{}-{i}", child.id())).collect();

    let start = Instant::now();
    let warm_until = start + Duration::from_secs(o.warmup);
    let until = warm_until + Duration::from_secs(o.duration);
    let measure_from_us = now_us() + o.warmup * 1_000_000;
    let samples = Arc::new(Mutex::new((vec![], vec![])));
    let stop = Arc::new(AtomicBool::new(false));
    let samp = sampler(child.id(), stop.clone(), warm_until, samples.clone());

    // No fim da medição o worker para de gerar; os clientes ainda drenam o que estiver no caminho.
    let stdin = Arc::new(Mutex::new(child.stdin.take().context("stdin")?));
    let stopper = {
        let stdin = stdin.clone();
        std::thread::spawn(move || {
            std::thread::sleep(until.saturating_duration_since(Instant::now()));
            let _ = writeln!(stdin.lock().unwrap(), "STOP");
        })
    };
    let drain_until = until + Duration::from_millis(1500);
    let stats: Vec<Arc<Mutex<ClientStats>>> = (0..o.clients).map(|_| Arc::new(Mutex::new(ClientStats::default()))).collect();
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build()?;
    let errors: Vec<String> = rt.block_on(async {
        let tasks: Vec<_> = stats.iter().enumerate().map(|(i, s)| tokio::spawn(client(i, port, o.compress, measure_from_us, drain_until, tmux.clone(), s.clone()))).collect();
        let mut errs = vec![];
        for t in tasks {
            match t.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => errs.push(format!("{e:#}")),
                Err(e) => errs.push(e.to_string()),
            }
        }
        errs
    });
    stop.store(true, Ordering::Relaxed);
    let _ = samp.join();

    let _ = stopper.join();
    let mut worker_stats = Value::Null;
    loop {
        line.clear();
        if out.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        if let Some(j) = line.strip_prefix("STATS ") {
            worker_stats = serde_json::from_str(j.trim()).unwrap_or(Value::Null);
            break;
        }
    }
    let _ = writeln!(stdin.lock().unwrap(), "EXIT");
    let _ = child.wait();
    // Garantia: nenhuma sessão de teste fica para trás.
    for s in &tmux {
        if kabul_core::tmux::has_session(s) {
            let _ = kabul_core::tmux::kill_session(s);
        }
    }
    let _ = std::fs::remove_dir_all(&home);

    let (cpu, mem) = samples.lock().unwrap().clone();
    let secs = o.duration.max(1) as f64;
    let mut all_lat = vec![];
    let mut rpc: HashMap<String, Vec<f64>> = HashMap::new();
    let mut per_client = vec![];
    let mut stamps_full = 0u64;
    for (i, s) in stats.iter().enumerate() {
        let s = s.lock().unwrap();
        if i < 2 {
            all_lat.extend(s.lat_ms.iter().copied());
            stamps_full = stamps_full.max(s.stamps);
        }
        for (k, v) in &s.rpc_ms {
            rpc.entry(k.clone()).or_default().extend(v.iter().copied());
        }
        per_client.push(json!({
            "client": i,
            "subs": if i >= 2 { "status" } else { "*" },
            "frames": s.frames,
            "frames_per_s": round(s.frames as f64 / (secs + o.warmup as f64)),
            "bytes": s.bytes,
            "wire_bytes": s.wire_bytes,
            "compressed_frames": s.compressed_frames,
            "chat_events": s.chat_events,
            "term_frames": s.term_frames,
            "other_events": s.other_events,
            "stamps": s.stamps,
            "lagged": s.lagged,
        }));
    }
    let stamped = worker_stats["stamped"].as_u64().unwrap_or(0);
    let delivery = if stamped > 0 { stamps_full as f64 / stamped as f64 } else { 0.0 };
    let cpu_s = summary(cpu);
    let mem_s = summary(mem);
    let lat = summary(all_lat);
    let rpc_all: Vec<f64> = rpc.values().flatten().copied().collect();
    let report = json!({
        "label": o.label,
        "config": {"workspaces": o.workspaces, "agents": o.agents, "rate_per_agent": o.rate, "duration_s": o.duration, "warmup_s": o.warmup, "clients": o.clients, "tmux": o.tmux, "monitor_ms": o.monitor_ms, "max_agents": o.max_agents, "compress": o.compress, "os": std::env::consts::OS},
        "startup_ms": round(startup_ms),
        "worker": worker_stats,
        "server": {"cpu_pct": cpu_s, "rss_mb": mem_s},
        "latency_ms": lat,
        "delivery_ratio": round(delivery * 10000.0) / 10000.0,
        "rpc_ms": rpc.iter().map(|(k, v)| (k.clone(), summary(v.clone()))).collect::<serde_json::Map<String, Value>>(),
        "rpc_all_ms": summary(rpc_all),
        "clients": per_client,
        "errors": errors,
    });

    let mut code = 0;
    let mut report = report;
    if let Some(b) = &o.budgets {
        let budgets: Value = serde_json::from_str(&std::fs::read_to_string(b).with_context(|| format!("lendo {}", b.display()))?)?;
        let violations = check_budgets(&report, &budgets);
        if !violations.is_empty() {
            code = 1;
        }
        report["budgets"] = json!({"file": b.display().to_string(), "violations": violations, "ok": code == 0});
    }
    let text = serde_json::to_string_pretty(&report)?;
    if let Some(p) = &o.out {
        std::fs::write(p, &text)?;
    }
    println!("{text}");
    if !report["errors"].as_array().map(|a| a.is_empty()).unwrap_or(true) {
        code = 1;
    }
    Ok(code)
}

/// Compara o relatório com os limites. Chaves `max_*` são tetos e `min_*` são pisos; o valor do
/// relatório sai do caminho em `path` (ex.: `latency_ms.p95`).
pub fn check_budgets(report: &Value, budgets: &Value) -> Vec<String> {
    let mut v = vec![];
    let Some(limits) = budgets.get("limits").and_then(Value::as_object) else { return vec!["perf-budgets.json sem \"limits\"".into()] };
    for (name, spec) in limits {
        let Some(path) = spec.get("path").and_then(Value::as_str) else { continue };
        let ptr = format!("/{}", path.replace('.', "/"));
        let Some(got) = report.pointer(&ptr).and_then(Value::as_f64) else {
            v.push(format!("{name}: {path} ausente no relatório"));
            continue;
        };
        if let Some(max) = spec.get("max").and_then(Value::as_f64) {
            if got > max {
                v.push(format!("{name}: {path} = {got} > máximo {max}"));
            }
        }
        if let Some(min) = spec.get("min").and_then(Value::as_f64) {
            if got < min {
                v.push(format!("{name}: {path} = {got} < mínimo {min}"));
            }
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marcas_e_percentis() {
        let f = format!("{{\"channel\":\"chat-event\",\"payload\":{{\"text\":\"{} a {} b\"}}}}", "\u{27e6}10\u{27e7}", "\u{27e6}20\u{27e7}");
        assert_eq!(stamps(&f).collect::<Vec<_>>(), vec![10, 20]);
        let v: Vec<f64> = (1..=100).map(|x| x as f64).collect();
        assert_eq!(percentile(&v, 50.0), 51.0);
        assert_eq!(percentile(&v, 100.0), 100.0);
    }

    #[test]
    fn orcamentos() {
        let r = json!({"latency_ms": {"p95": 40.0}, "server": {"cpu_pct": {"avg": 12.0}}, "delivery_ratio": 0.98});
        let b = json!({"limits": {"lat": {"path": "latency_ms.p95", "max": 50}, "cpu": {"path": "server.cpu_pct.avg", "max": 10}, "entrega": {"path": "delivery_ratio", "min": 0.99}, "falta": {"path": "x.y", "max": 1}}});
        let v = check_budgets(&r, &b);
        assert_eq!(v.len(), 3, "{v:?}");
        assert!(v.iter().any(|s| s.starts_with("cpu:")));
        assert!(v.iter().any(|s| s.starts_with("entrega:")));
        assert!(v.iter().any(|s| s.starts_with("falta:")));
    }

    #[test]
    fn estado_sintetico() {
        let home = std::env::temp_dir().join(format!("kabul-lt-test-{}", std::process::id()));
        let w = synth_state(&home, 25).unwrap();
        assert_eq!(w.len(), 25);
        let st = Store::open(home.join("state.json"), home.join("workspaces"), "perf".into()).unwrap();
        assert_eq!(st.state.repos.len(), 3);
        assert!(Path::new(&w[24].path).is_dir());
        std::fs::remove_dir_all(home).ok();
    }
}
