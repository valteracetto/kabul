//! Uso de recursos do Kabul e dos processos filhos (agentes, terminais e o que eles abrirem), pela
//! crate `sysinfo` (macOS, Linux e Windows). A árvore é montada a partir de uma lista simples de
//! processos ([`Proc`]), testável sem o sistema.
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

/// Processo como o `sysinfo` vê (só o que a árvore usa).
#[derive(Debug, Clone, Default)]
pub struct Proc {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub cmd: Vec<String>,
    pub cpu: f32,
    pub mem: u64,
    pub cwd: Option<String>,
    /// Início (segundos desde a época Unix).
    pub start: u64,
}

/// Dica para ligar um processo a um workspace/conversa do Kabul.
#[derive(Debug, Clone, Default)]
pub struct Hint {
    /// Processo da conversa (agente rodando pelo app).
    pub pid: Option<u32>,
    /// Pasta do workspace (processos com o cwd dentro dela).
    pub path: Option<String>,
    pub workspace_id: String,
    pub chat_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Node {
    pub pid: u32,
    pub name: String,
    /// CPU (% de um núcleo, como no Monitor de Atividade) e memória deste nó e de todos os filhos.
    pub cpu: f32,
    pub mem: u64,
    /// app | main | agent | terminal | process
    pub kind: String,
    pub agent: Option<String>,
    pub workspace_id: Option<String>,
    pub chat_id: Option<String>,
    pub children: Vec<Node>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    pub cpu: f32,
    pub mem: u64,
    /// Processos na árvore (para o "Mostrar tudo (N)").
    pub count: usize,
    pub root: Node,
}

const AGENTS: &[&str] = &["claude", "codex", "agy", "opencode", "gemini", "qwen", "goose", "cursor-agent"];
const SHELLS: &[&str] = &["zsh", "bash", "fish", "sh", "dash", "tmux", "pwsh", "powershell", "cmd", "nu"];

/// Nome do agente quando o processo é um (binário ou `node .../claude`).
pub fn agent_of(p: &Proc) -> Option<String> {
    let base = |s: &str| s.rsplit(['/', '\\']).next().unwrap_or(s).trim_end_matches(".exe").to_string();
    let n = base(&p.name);
    if AGENTS.contains(&n.as_str()) {
        return Some(n);
    }
    if matches!(n.as_str(), "node" | "bun" | "deno") {
        return p.cmd.iter().skip(1).take(2).map(|a| base(a)).find(|a| AGENTS.contains(&a.as_str()));
    }
    None
}

/// Monta a árvore "App → Principal → filhos" a partir de `root` (o processo do app).
pub fn build(procs: &[Proc], root: u32, hints: &[Hint]) -> Snapshot {
    let by_pid: HashMap<u32, &Proc> = procs.iter().map(|p| (p.pid, p)).collect();
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs {
        if let Some(pp) = p.parent.filter(|pp| *pp != p.pid) {
            kids.entry(pp).or_default().push(p.pid);
        }
    }
    fn node(pid: u32, by: &HashMap<u32, &Proc>, kids: &HashMap<u32, Vec<u32>>, hints: &[Hint], inherited: (Option<String>, Option<String>), depth: usize, count: &mut usize) -> Node {
        let p = by.get(&pid).copied().cloned().unwrap_or_default();
        *count += 1;
        let agent = agent_of(&p);
        let base = p.name.rsplit(['/', '\\']).next().unwrap_or(&p.name).trim_end_matches(".exe").to_string();
        let kind = if agent.is_some() { "agent" } else if SHELLS.contains(&base.as_str()) { "terminal" } else { "process" };
        // Workspace/conversa: pelo pid do agente do app, pelo cwd ou herdado do pai.
        let by_pid = hints.iter().find(|h| h.pid == Some(pid));
        let by_cwd = p.cwd.as_deref().and_then(|c| hints.iter().filter(|h| h.path.as_deref().is_some_and(|w| c == w || c.starts_with(&format!("{w}/")) || c.starts_with(&format!("{w}\\")))).max_by_key(|h| h.path.as_ref().map(|w| w.len())));
        let ws = by_pid.filter(|h| !h.workspace_id.is_empty()).or(by_cwd).map(|h| h.workspace_id.clone()).or(inherited.0);
        let chat = by_pid.and_then(|h| h.chat_id.clone()).or(inherited.1);
        let mut children: Vec<Node> = if depth > 32 { vec![] } else { kids.get(&pid).map(|v| v.iter().map(|c| node(*c, by, kids, hints, (ws.clone(), chat.clone()), depth + 1, count)).collect()).unwrap_or_default() };
        children.sort_by_key(|c| std::cmp::Reverse(c.mem));
        let cpu = p.cpu + children.iter().map(|c| c.cpu).sum::<f32>();
        let mem = p.mem + children.iter().map(|c| c.mem).sum::<u64>();
        Node { pid, name: agent.clone().unwrap_or(base), cpu, mem, kind: kind.into(), agent, workspace_id: ws, chat_id: chat, children }
    }
    let mut count = 0;
    let mut main = node(root, &by_pid, &kids, hints, (None, None), 0, &mut count);
    main.kind = "main".into();
    main.name = "Principal".into();
    // O nó "Principal" mostra só o próprio processo; o "App" soma tudo.
    let own = by_pid.get(&root).map(|p| (p.cpu, p.mem)).unwrap_or_default();
    let (cpu, mem) = (main.cpu, main.mem);
    let mut shown = main.clone();
    shown.cpu = own.0;
    shown.mem = own.1;
    // Filhos continuam com os totais deles; o Principal fica com o uso próprio.
    let app = Node { pid: root, name: "App".into(), cpu, mem, kind: "app".into(), agent: None, workspace_id: None, chat_id: None, children: vec![shown] };
    Snapshot { cpu, mem, count, root: app }
}

static SYS: Mutex<Option<sysinfo::System>> = Mutex::new(None);

/// Processos do sistema agora. A CPU é medida entre duas chamadas (a primeira vem zerada).
pub fn processes() -> Vec<Proc> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
    let mut g = SYS.lock().unwrap();
    let sys = g.get_or_insert_with(sysinfo::System::new);
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory().with_cwd(UpdateKind::OnlyIfNotSet).with_cmd(UpdateKind::OnlyIfNotSet));
    sys.processes()
        .values()
        .map(|p| Proc {
            pid: p.pid().as_u32(),
            parent: p.parent().map(|x| x.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            cmd: p.cmd().iter().take(4).map(|a| a.to_string_lossy().into_owned()).collect(),
            cpu: p.cpu_usage(),
            mem: p.memory(),
            cwd: p.cwd().map(|c| c.display().to_string()),
            start: p.start_time(),
        })
        .collect()
}

/// Árvore do processo atual (o app ou o `kabul serve`).
pub fn snapshot(hints: &[Hint]) -> Snapshot {
    build(&processes(), std::process::id(), hints)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str, cpu: f32, mem: u64, cwd: Option<&str>, cmd: &[&str]) -> Proc {
        Proc { pid, parent: Some(parent), name: name.into(), cmd: cmd.iter().map(|s| s.to_string()).collect(), cpu, mem, cwd: cwd.map(String::from), start: 0 }
    }

    #[test]
    fn arvore_com_agentes_terminais_e_workspaces() {
        let procs = vec![
            p(1, 0, "launchd", 0.0, 1, None, &[]),
            p(100, 1, "kabul-desktop", 4.5, 200, None, &[]),
            p(101, 100, "claude", 0.2, 500, Some("/w/ws-a"), &["claude"]),
            p(102, 101, "node", 0.0, 600, Some("/w/ws-a/sub"), &[]),
            p(103, 101, "zsh", 0.0, 2, Some("/w/ws-a"), &[]),
            p(104, 103, "cargo", 10.0, 70, Some("/w/ws-a"), &[]),
            p(105, 100, "node", 1.0, 300, Some("/w/ws-b"), &["node", "/opt/bin/codex", "app-server"]),
            p(106, 100, "zsh", 0.0, 3, Some("/outro"), &[]),
            p(200, 1, "Safari", 50.0, 9000, None, &[]),
        ];
        let hints = vec![
            Hint { pid: Some(101), path: Some("/w/ws-a".into()), workspace_id: "a".into(), chat_id: Some("chat-1".into()) },
            Hint { pid: None, path: Some("/w/ws-b".into()), workspace_id: "b".into(), chat_id: None },
        ];
        let s = build(&procs, 100, &hints);
        assert_eq!(s.count, 7, "só o app e os descendentes");
        assert_eq!(s.mem, 200 + 500 + 600 + 2 + 70 + 300 + 3);
        assert!((s.cpu - 15.7).abs() < 0.01);
        let main = &s.root.children[0];
        assert_eq!((main.name.as_str(), main.mem, main.kind.as_str()), ("Principal", 200, "main"));
        let claude = main.children.iter().find(|c| c.pid == 101).unwrap();
        assert_eq!((claude.kind.as_str(), claude.workspace_id.as_deref(), claude.chat_id.as_deref()), ("agent", Some("a"), Some("chat-1")));
        assert_eq!(claude.mem, 500 + 600 + 2 + 70);
        assert_eq!(claude.children[0].name, "node", "filhos por memória");
        let zsh = claude.children.iter().find(|c| c.pid == 103).unwrap();
        assert_eq!((zsh.kind.as_str(), zsh.chat_id.as_deref()), ("terminal", Some("chat-1")));
        let codex = main.children.iter().find(|c| c.pid == 105).unwrap();
        assert_eq!((codex.name.as_str(), codex.agent.as_deref(), codex.workspace_id.as_deref()), ("codex", Some("codex"), Some("b")));
        assert_eq!(main.children.iter().find(|c| c.pid == 106).unwrap().workspace_id, None);
    }

    #[test]
    fn sistema_real() {
        // Duas leituras (CPU entre elas); o processo do teste está na árvore.
        processes();
        let s = snapshot(&[]);
        assert_eq!(s.root.pid, std::process::id());
        assert!(s.mem > 0 && s.count >= 1);
    }
}
