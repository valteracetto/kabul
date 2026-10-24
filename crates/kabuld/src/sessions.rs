//! Espelho ao vivo de TODAS as sessões tmux (claude, codex, agy, opencode, shell...): quem roda,
//! onde (Mac, nuvem do provedor, espelhada), em que repo/workspace e o status (trabalhando, esperando
//! você, ocioso), detectado pela tela do pane e pela atividade recente.
use kabul_core::agent::{self, AgentKind};
use kabul_core::harness::strip_ansi;
use kabul_core::runs_on::RunsOn;
use kabul_core::store::{Repo, Workspace};
use kabul_core::tmux;
use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// O agente está trabalhando (ou o terminal está imprimindo).
    Working,
    /// Pede uma decisão sua (aprovação, pergunta, y/n).
    Waiting,
    Idle,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Group {
    /// Chave estável do grupo (id do workspace, caminho do repo ou "outras").
    pub key: String,
    pub repo: String,
    pub workspace: Option<String>,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LiveSession {
    /// `tmux:<sessão>` ou `chat:<id>`.
    pub id: String,
    pub kind: &'static str,
    pub name: String,
    pub agent: String,
    pub status: Status,
    pub detail: Option<String>,
    pub runs_on: RunsOn,
    pub group: Group,
    pub path: String,
    pub pane: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Segundos desde a última saída.
    pub idle_secs: u64,
    pub preview: String,
}

const WAITING: &[&str] = &[
    "do you want to",
    "would you like to",
    "❯ 1. yes",
    "allow command",
    "allow this",
    "approve",
    "(y/n)",
    "[y/n]",
    "(yes/no)",
    "press enter to continue",
    "waiting for your input",
    "waiting for input",
    "deseja continuar",
];
const WORKING: &[&str] = &["to interrupt", "esc to cancel", "ctrl+c to stop"];

/// Status a partir da tela visível (sem cores) e de há quantos segundos o pane não imprime nada.
pub fn detect_status(agent: &str, screen: &str, idle_secs: u64) -> (Status, Option<String>) {
    let lines: Vec<&str> = screen.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = &lines[lines.len().saturating_sub(18)..];
    for l in tail.iter().rev() {
        let low = l.to_lowercase();
        if WORKING.iter().any(|p| low.contains(p)) {
            return (Status::Working, None);
        }
    }
    // A pergunta costuma vir antes das opções: a primeira linha que casa vira o detalhe.
    for l in tail.iter() {
        let low = l.to_lowercase();
        if WAITING.iter().any(|p| low.contains(p)) {
            return (Status::Waiting, Some(cut(l.trim_start_matches(['│', '╭', '╰', '|', ' ']), 90)));
        }
    }
    let threshold = if agent == "shell" { 3 } else { 2 };
    if idle_secs < threshold {
        (Status::Working, None)
    } else {
        (Status::Idle, None)
    }
}

fn cut(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        format!("{t}…")
    } else {
        t
    }
}

/// Agente do pane: o detector do core (claude/codex/agy/shell) e, além dele, opencode, qwen e gemini.
pub fn detect_agent(current_command: &str, descendants: &[String]) -> String {
    let k = agent::detect(current_command, descendants);
    if matches!(k, AgentKind::Shell | AgentKind::Other) {
        for c in std::iter::once(current_command).chain(descendants.iter().map(String::as_str)) {
            let low = c.to_lowercase();
            let base = low.split_whitespace().next().unwrap_or("").rsplit('/').next().unwrap_or("").to_string();
            for (needle, name) in [("opencode", "opencode"), ("qwen", "qwen"), ("gemini", "gemini")] {
                if base == needle || low.contains(&format!("/{needle}")) || low.contains(&format!("@{needle}")) {
                    return name.into();
                }
            }
        }
    }
    k.label().into()
}

/// Onde a sessão roda: nuvem do provedor (`--cloud`), espelhada (`--remote-control` / `-mirror`) ou local.
pub fn runs_on(session: &str, agent: &str, cmdlines: &[String]) -> RunsOn {
    if cmdlines.iter().any(|c| c.contains(" --cloud")) || session.contains("-cloud-") {
        let provider = match agent {
            "codex" => "codex",
            "antigravity" | "gemini" => "gemini",
            _ => "claude",
        };
        return RunsOn::ProviderCloud { provider: provider.into() };
    }
    let mirrored = session.ends_with("-mirror") || cmdlines.iter().any(|c| c.contains("--remote-control"));
    RunsOn::Local { mirrored }
}

fn within_raw(path: &str, root: &str) -> bool {
    let root = root.trim_end_matches('/');
    !root.is_empty() && (path == root || path.starts_with(&format!("{root}/")))
}

/// Compara também pelo caminho real (no macOS o tmux reporta `/private/var/...` para `/var/...`).
fn within(path: &str, root: &str) -> bool {
    within_raw(path, root) || std::fs::canonicalize(root).ok().map(|r| within_raw(path, &r.to_string_lossy())).unwrap_or(false)
}

fn base(p: &str) -> String {
    std::path::Path::new(p).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| p.to_string())
}

/// Agrupa por workspace do Kabul (o mais específico), depois pelo repo, depois pela raiz git.
pub fn group_for(path: &str, repos: &[Repo], workspaces: &[Workspace], git_root: &mut dyn FnMut(&str) -> Option<String>) -> Group {
    if let Some(w) = workspaces.iter().filter(|w| !w.archived && within(path, &w.path)).max_by_key(|w| w.path.len()) {
        let repo = repos.iter().find(|r| r.id == w.repo_id).map(|r| r.name.clone()).unwrap_or_else(|| base(&w.path));
        let title = w.title.clone().unwrap_or_else(|| w.name.clone());
        return Group { key: w.id.clone(), repo, workspace: Some(title), workspace_id: Some(w.id.clone()) };
    }
    if let Some(r) = repos.iter().filter(|r| within(path, &r.path)).max_by_key(|r| r.path.len()) {
        return Group { key: r.path.clone(), repo: r.name.clone(), workspace: None, workspace_id: None };
    }
    if let Some(root) = git_root(path) {
        return Group { key: root.clone(), repo: base(&root), workspace: None, workspace_id: None };
    }
    Group { key: "outras".into(), repo: "Outras sessões".into(), workspace: None, workspace_id: None }
}

/// Atividade e tamanho dos panes (`#{window_activity}` em segundos Unix).
pub fn pane_extras() -> HashMap<String, (u64, u16, u16)> {
    let out = Command::new("tmux").args(["list-panes", "-a", "-F", "#{pane_id}\t#{window_activity}\t#{pane_width}\t#{pane_height}"]).output();
    let Ok(o) = out else { return HashMap::new() };
    String::from_utf8_lossy(&o.stdout)
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            Some((f.first()?.to_string(), (f.get(1)?.parse().ok()?, f.get(2)?.parse().ok()?, f.get(3)?.parse().ok()?)))
        })
        .collect()
}

fn plain_screen(pane: &str) -> String {
    Command::new("tmux").args(["capture-pane", "-p", "-t", pane]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// Varredura completa: uma chamada ao `ps` e uma captura por pane ativo de cada sessão.
pub struct Scanner {
    git_roots: HashMap<String, Option<String>>,
}

impl Default for Scanner {
    fn default() -> Self {
        Self::new()
    }
}

impl Scanner {
    pub fn new() -> Self {
        Self { git_roots: HashMap::new() }
    }

    pub fn scan(&mut self, repos: &[Repo], workspaces: &[Workspace]) -> Vec<LiveSession> {
        let panes = tmux::list_panes().unwrap_or_default();
        if panes.is_empty() {
            return vec![];
        }
        let ps = Command::new("ps").args(["-A", "-o", "pid=,ppid=,command="]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        let extras = pane_extras();
        let now = crate::auth::now();
        let roots = &mut self.git_roots;
        let mut git_root = |p: &str| -> Option<String> {
            roots
                .entry(p.to_string())
                .or_insert_with(|| {
                    let o = Command::new("git").args(["-C", p, "rev-parse", "--show-toplevel"]).output().ok()?;
                    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
                })
                .clone()
        };
        // Uma linha por sessão: o primeiro pane ativo (ou o primeiro pane).
        let mut chosen: Vec<tmux::Pane> = vec![];
        for p in panes {
            match chosen.iter_mut().find(|c| c.session == p.session) {
                Some(c) if p.active && !c.active => *c = p,
                Some(_) => {}
                None => chosen.push(p),
            }
        }
        let mut out: Vec<LiveSession> = vec![];
        for p in chosen {
            let desc = agent::descendants_from_ps(&ps, p.pid);
            let agent = detect_agent(&p.command, &desc);
            let (activity, cols, rows) = extras.get(&p.pane_id).copied().unwrap_or((now, 80, 24));
            let idle = now.saturating_sub(activity);
            let screen = strip_ansi(&plain_screen(&p.pane_id));
            let (status, detail) = detect_status(&agent, &screen, idle);
            let preview = screen.lines().map(str::trim).rfind(|l| !l.is_empty()).map(|l| cut(l, 120)).unwrap_or_default();
            let group = group_for(&p.path, repos, workspaces, &mut git_root);
            out.push(LiveSession {
                id: format!("tmux:{}", p.session),
                kind: "tmux",
                runs_on: runs_on(&p.session, &agent, &desc),
                name: p.session,
                agent,
                status,
                detail,
                group,
                path: p.path,
                pane: Some(p.pane_id),
                cols,
                rows,
                idle_secs: idle,
                preview,
            });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_pela_tela() {
        let claude_trabalhando = "> corrija o login\n\n✻ Pondering… (12s · esc to interrupt)\n";
        assert_eq!(detect_status("claude", claude_trabalhando, 60).0, Status::Working);
        let claude_pede = "Bash command\n  rm -rf build\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n";
        let (s, d) = detect_status("claude", claude_pede, 60);
        assert_eq!(s, Status::Waiting);
        assert_eq!(d.as_deref(), Some("Do you want to proceed?"));
        let codex_pede = "Would you like to run the following command?\n  $ npm test\n▌ Yes  No\n";
        assert_eq!(detect_status("codex", codex_pede, 60).0, Status::Waiting);
        assert_eq!(detect_status("shell", "$ rm x\nremove x? (y/n)", 60).0, Status::Waiting);
        assert_eq!(detect_status("claude", "> \n", 60).0, Status::Idle);
        assert_eq!(detect_status("shell", "$ npm run build\ncompilando...", 1).0, Status::Working, "saída recente");
        assert_eq!(detect_status("shell", "$ ", 10).0, Status::Idle);
    }

    #[test]
    fn agentes_extras() {
        assert_eq!(detect_agent("claude", &[]), "claude");
        assert_eq!(detect_agent("zsh", &["/home/dev/.opencode/bin/opencode".into()]), "opencode");
        assert_eq!(detect_agent("node", &["node /usr/lib/node_modules/@qwen-code/qwen-code/cli.js".into()]), "qwen");
        assert_eq!(detect_agent("zsh", &[]), "shell");
    }

    #[test]
    fn onde_roda() {
        assert_eq!(runs_on("kabul-x-cloud-123", "claude", &[]), RunsOn::ProviderCloud { provider: "claude".into() });
        assert_eq!(runs_on("s", "codex", &["codex --cloud tarefa".into()]), RunsOn::ProviderCloud { provider: "codex".into() });
        assert_eq!(runs_on("kabul-x-mirror", "claude", &[]), RunsOn::Local { mirrored: true });
        assert_eq!(runs_on("dev", "shell", &[]), RunsOn::Local { mirrored: false });
    }

    fn ws(id: &str, repo: &str, path: &str) -> Workspace {
        serde_json::from_value(serde_json::json!({
            "id": id, "repo_id": repo, "name": "lisboa", "branch": "dev/lisboa", "path": path, "archived": false, "created_at": 0,
            "title": null, "status": "in-progress", "state": "ready", "pinned": false, "notes": "", "port": 0
        }))
        .unwrap()
    }

    #[test]
    fn agrupa() {
        let repos: Vec<Repo> = vec![serde_json::from_value(serde_json::json!({"id": "r1", "name": "app", "path": "/src/app", "default_branch": "main"})).unwrap()];
        let wss = vec![ws("w1", "r1", "/ws/app/lisboa")];
        let mut none = |_: &str| None;
        let g = group_for("/ws/app/lisboa/src", &repos, &wss, &mut none);
        assert_eq!((g.repo.as_str(), g.workspace.as_deref(), g.workspace_id.as_deref()), ("app", Some("lisboa"), Some("w1")));
        let g = group_for("/src/app", &repos, &wss, &mut none);
        assert_eq!((g.repo.as_str(), g.workspace.as_deref()), ("app", None));
        let mut git = |_: &str| Some("/home/dev/outro".to_string());
        assert_eq!(group_for("/home/dev/outro/x", &repos, &wss, &mut git).repo, "outro");
        assert_eq!(group_for("/tmp", &repos, &wss, &mut none).key, "outras");
        assert!(!within("/ws/app/lisboa2", "/ws/app/lisboa"));
    }
}
