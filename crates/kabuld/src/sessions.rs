//! Espelho ao vivo de TODAS as sessões tmux (claude, codex, agy, opencode, shell...): quem roda,
//! onde (Mac, nuvem do provedor, espelhada), em que repo/workspace e o status (trabalhando, esperando
//! você, ocioso), detectado pela tela do pane e pela atividade recente.
use kabul_core::agent::{self, AgentKind};
use kabul_core::harness::strip_ansi;
use kabul_core::runs_on::RunsOn;
use kabul_core::store::{Repo, Workspace};
use kabul_core::term;
use serde::Serialize;
use std::collections::HashMap;

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

const WAITING: &[&str] = &["do you want to", "would you like to", "❯ 1. yes", "allow command", "allow this", "approve", "(y/n)", "[y/n]", "(yes/no)", "press enter to continue", "waiting for your input", "waiting for input", "deseja continuar"];
const WORKING: &[&str] = &["to interrupt", "esc to cancel", "ctrl+c to stop"];

/// Status a partir da tela visível (sem cores) e de há quantos segundos o pane não imprime nada.
pub fn detect_status(agent: &str, screen: &str, idle_secs: u64) -> (Status, Option<String>) {
    screen_status(screen).unwrap_or_else(|| idle_status(agent, idle_secs))
}

/// O que a tela sozinha diz (trabalhando / pede decisão); `None` = decide pela atividade.
pub fn screen_status(screen: &str) -> Option<(Status, Option<String>)> {
    let lines: Vec<&str> = screen.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = &lines[lines.len().saturating_sub(18)..];
    for l in tail.iter().rev() {
        let low = l.to_lowercase();
        if WORKING.iter().any(|p| low.contains(p)) {
            return Some((Status::Working, None));
        }
    }
    // A pergunta costuma vir antes das opções: a primeira linha que casa vira o detalhe.
    for l in tail.iter() {
        let low = l.to_lowercase();
        if WAITING.iter().any(|p| low.contains(p)) {
            return Some((Status::Waiting, Some(cut(l.trim_start_matches(['│', '╭', '╰', '|', ' ']), 90))));
        }
    }
    None
}

fn idle_status(agent: &str, idle_secs: u64) -> (Status, Option<String>) {
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

/// Caminho real de cada raiz, guardado: a varredura compara cada pane com todos os workspaces e o
/// `canonicalize` (uma chamada ao sistema) por par custava pane × workspace a cada 1,5 s. Raiz que
/// ainda não existe é tentada de novo depois de 30 s.
fn canonical(root: &str) -> Option<String> {
    use std::sync::Mutex;
    use std::time::Instant;
    type Canon = HashMap<String, (Option<String>, Instant)>;
    static CACHE: Mutex<Option<Canon>> = Mutex::new(None);
    let mut g = CACHE.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    if let Some((v, at)) = m.get(root) {
        if v.is_some() || at.elapsed().as_secs() < 30 {
            return v.clone();
        }
    }
    let v = std::fs::canonicalize(root).ok().map(|r| r.to_string_lossy().into_owned()).filter(|r| r != root);
    if m.len() > 4096 {
        m.clear();
    }
    m.insert(root.to_string(), (v.clone(), Instant::now()));
    v
}

/// Compara também pelo caminho real (no macOS o tmux reporta `/private/var/...` para `/var/...`).
fn within(path: &str, root: &str) -> bool {
    within_raw(path, root) || canonical(root).map(|r| within_raw(path, &r)).unwrap_or(false)
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

/// Tela já analisada de um pane: só captura de novo quando a janela teve saída (ou a cada 10 s).
#[derive(Debug, Clone)]
struct Seen {
    activity: u64,
    at: u64,
    screen: Option<(Status, Option<String>)>,
    preview: String,
}

/// Varredura pelo backend de terminal: UMA listagem (com atividade e tamanho), UMA leitura da tabela de
/// processos e UMA captura em lote só dos panes que imprimiram algo desde a última vez. Antes: duas
/// listagens e uma captura por pane. (No tmux, listagem e captura são um processo cada; no PTY, memória.)
pub struct Scanner {
    git_roots: HashMap<String, Option<String>>,
    seen: HashMap<String, Seen>,
}

impl Default for Scanner {
    fn default() -> Self {
        Self::new()
    }
}

/// Recaptura de segurança mesmo sem atividade (tela limpa/redimensionada sem saída nova).
const RECAPTURE_SECS: u64 = 10;

impl Scanner {
    pub fn new() -> Self {
        Self { git_roots: HashMap::new(), seen: HashMap::new() }
    }

    pub fn scan(&mut self, repos: &[Repo], workspaces: &[Workspace]) -> Vec<LiveSession> {
        let b = term::backend();
        let panes = b.list_ext().unwrap_or_default();
        if panes.is_empty() {
            self.seen.clear();
            return vec![];
        }
        let idx = agent::ProcIndex::current();
        let now = crate::auth::now();
        // Uma linha por sessão: o primeiro pane ativo (ou o primeiro pane).
        let mut chosen: Vec<term::PaneExt> = vec![];
        for p in panes {
            match chosen.iter_mut().find(|c| c.pane.session == p.pane.session) {
                Some(c) if p.pane.active && !c.pane.active => *c = p,
                Some(_) => {}
                None => chosen.push(p),
            }
        }
        self.seen.retain(|id, _| chosen.iter().any(|c| &c.pane.pane_id == id));
        let need: Vec<&str> = chosen.iter().filter(|c| self.seen.get(&c.pane.pane_id).map(|s| s.activity != c.activity || now.saturating_sub(s.at) >= RECAPTURE_SECS).unwrap_or(true)).map(|c| c.pane.pane_id.as_str()).collect();
        for (pane, raw) in b.capture_many(&need) {
            let screen = strip_ansi(&raw);
            let preview = screen.lines().map(str::trim).rfind(|l| !l.is_empty()).map(|l| cut(l, 120)).unwrap_or_default();
            let activity = chosen.iter().find(|c| c.pane.pane_id == pane).map(|c| c.activity).unwrap_or(now);
            self.seen.insert(pane, Seen { activity, at: now, screen: screen_status(&screen), preview });
        }
        let roots = &mut self.git_roots;
        let mut git_root = |p: &str| -> Option<String> {
            roots
                .entry(p.to_string())
                .or_insert_with(|| {
                    let o = kabul_core::shell::command("git").args(["-C", p, "rev-parse", "--show-toplevel"]).output().ok()?;
                    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
                })
                .clone()
        };
        let mut out: Vec<LiveSession> = Vec::with_capacity(chosen.len());
        for c in chosen {
            let p = c.pane;
            let desc = idx.descendants(p.pid);
            let agent = detect_agent(&p.command, &desc);
            // Backend sem atividade conhecida (0): conta como agora.
            let idle = if c.activity == 0 { 0 } else { now.saturating_sub(c.activity) };
            let seen = self.seen.get(&p.pane_id);
            let (status, detail) = seen.and_then(|s| s.screen.clone()).unwrap_or_else(|| idle_status(&agent, idle));
            let preview = seen.map(|s| s.preview.clone()).unwrap_or_default();
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
                cols: c.cols,
                rows: c.rows,
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
