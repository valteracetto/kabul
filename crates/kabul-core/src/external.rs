//! Sessões de agentes fora do Kabul: processos rodando em outros terminais (vistos pelo `sysinfo`)
//! e o histórico local de cada CLI (só metadados: id, título, pasta, branch e data; o conteúdo das
//! conversas nunca é copiado nem registrado em log).
//!
//! Onde cada CLI guarda as sessões (confirmado nesta máquina):
//! - Claude Code: `~/.claude/projects/<pasta>/<sessão>.jsonl` (linhas `user` com `cwd`/`gitBranch`,
//!   `ai-title`); sessões vivas com pid em `claude agents --json`.
//! - Codex: `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl` (1ª linha `session_meta` com `id`, `cwd`, `git`).
//! - OpenCode: `~/.local/share/opencode/opencode.db` (tabela `session`: `id`, `title`, `directory`, `time_updated`).
//! - Antigravity: `~/.gemini/antigravity-cli/conversation_summaries.db` (`conversation_id`, `title`,
//!   `workspace_uris`, `last_modified_time`).
//!
//! Nuvem do Claude criada fora do Kabul: o CLI não lista sessões de nuvem sem TTY (`--teleport` sem id
//! abre um seletor interativo; `claude agents --json` só traz sessões locais). O Kabul aceita colar o
//! link ou o id (`claude --teleport <id>`).
use crate::harness::HarnessKind;
use crate::resources::{agent_of, Proc};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Running {
    pub agent: String,
    pub pid: u32,
    pub cwd: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    /// Segundos rodando.
    pub running_secs: u64,
    /// App de onde veio (Terminal, iTerm2, Ghostty, VS Code…).
    pub terminal: Option<String>,
    /// Sessão do agente para continuar no Kabul, quando dá para saber.
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Recent {
    pub agent: String,
    pub id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    /// Última atividade (segundos Unix).
    pub updated: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalSessions {
    pub running: Vec<Running>,
    pub recent: Vec<Recent>,
    /// Por que a nuvem do Claude criada fora do Kabul não aparece sozinha.
    pub cloud_note: String,
}

pub const CLOUD_NOTE: &str = "O Claude Code não lista sessões de nuvem fora de um terminal interativo (claude --teleport sem id abre um seletor). Cole o link do claude.ai/code ou o id da sessão para acompanhar e trazer para o Mac.";

/// Harness do Kabul que retoma a sessão desse agente.
pub fn harness_of(agent: &str) -> Option<HarnessKind> {
    HarnessKind::parse(agent)
}

const TERMINALS: &[(&str, &str)] = &[
    ("Terminal", "Terminal"),
    ("iTerm2", "iTerm2"),
    ("ghostty", "Ghostty"),
    ("Ghostty", "Ghostty"),
    ("WezTerm", "WezTerm"),
    ("wezterm-gui", "WezTerm"),
    ("Alacritty", "Alacritty"),
    ("alacritty", "Alacritty"),
    ("kitty", "kitty"),
    ("Warp", "Warp"),
    ("stable", "Warp"),
    ("Hyper", "Hyper"),
    ("Code Helper", "VS Code"),
    ("Code", "VS Code"),
    ("Electron", "VS Code"),
    ("Cursor", "Cursor"),
    ("Cursor Helper", "Cursor"),
    ("zed", "Zed"),
    ("WindowsTerminal", "Windows Terminal"),
    ("tmux", "tmux"),
    ("sshd", "SSH"),
];

fn base(s: &str) -> &str {
    s.rsplit(['/', '\\']).next().unwrap_or(s).trim_end_matches(".exe")
}

/// Pasta do repositório (raiz do git) e branch, sem rodar git: sobe até achar `.git`.
pub fn repo_of(cwd: &str) -> (Option<String>, Option<String>) {
    let mut d = Some(Path::new(cwd));
    while let Some(p) = d {
        let git = p.join(".git");
        let head = if git.is_dir() {
            std::fs::read_to_string(git.join("HEAD")).ok()
        } else if git.is_file() {
            // worktree: "gitdir: <caminho>"
            std::fs::read_to_string(&git).ok().and_then(|t| t.strip_prefix("gitdir:").map(|g| PathBuf::from(g.trim()))).and_then(|g| std::fs::read_to_string(g.join("HEAD")).ok())
        } else {
            None
        };
        if let Some(h) = head {
            let branch = h.trim().strip_prefix("ref: refs/heads/").map(String::from);
            return (p.file_name().map(|n| n.to_string_lossy().into_owned()), branch);
        }
        d = p.parent();
    }
    (None, None)
}

/// Processos de agentes fora do Kabul (fora do app `own` e fora do tmux, que já tem seção própria).
pub fn running(procs: &[Proc], own: u32, now: u64, claude_live: &HashMap<u32, String>) -> Vec<Running> {
    let by: HashMap<u32, &Proc> = procs.iter().map(|p| (p.pid, p)).collect();
    let ancestors = |p: &Proc| {
        let mut out = vec![];
        let mut cur = p.parent;
        let mut guard = 0;
        while let Some(pid) = cur.filter(|x| *x > 1) {
            guard += 1;
            if guard > 64 {
                break;
            }
            match by.get(&pid) {
                Some(a) => {
                    out.push(*a);
                    cur = a.parent;
                }
                None => break,
            }
        }
        out
    };
    let mut v: Vec<Running> = procs
        .iter()
        .filter_map(|p| {
            let agent = agent_of(p)?;
            let anc = ancestors(p);
            // Do próprio Kabul, dentro do tmux (já listado) ou subprocesso de outro agente: fora.
            if p.pid == own || anc.iter().any(|a| a.pid == own || base(&a.name) == "tmux" || agent_of(a).is_some()) {
                return None;
            }
            let terminal = anc.iter().find_map(|a| TERMINALS.iter().find(|(n, _)| base(&a.name) == *n).map(|(_, l)| l.to_string()));
            let (repo, branch) = p.cwd.as_deref().map(repo_of).unwrap_or_default();
            Some(Running { session_id: if agent == "claude" { claude_live.get(&p.pid).cloned() } else { None }, agent, pid: p.pid, cwd: p.cwd.clone(), repo, branch, running_secs: now.saturating_sub(p.start), terminal })
        })
        .collect();
    v.sort_by_key(|r| r.running_secs);
    v
}

/// `claude agents --json`: pid → id da sessão das sessões vivas.
pub fn parse_claude_agents(json: &str) -> HashMap<u32, String> {
    serde_json::from_str::<Vec<Value>>(json).unwrap_or_default().iter().filter_map(|v| Some((v.get("pid").and_then(|p| p.as_u64().or_else(|| p.as_str()?.parse().ok()))? as u32, v.get("sessionId")?.as_str()?.to_string()))).collect()
}

fn mtime(p: &Path) -> i64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn clip(s: &str) -> String {
    let one = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() > 80 {
        format!("{}…", one.chars().take(80).collect::<String>())
    } else {
        one
    }
}

fn user_text(content: &Value) -> Option<String> {
    let t = match content {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(|x| x.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join(" "),
        _ => return None,
    };
    // Instruções injetadas (<system_instruction>, <environment_context>, comandos) não são título.
    let t = t.trim();
    (!t.is_empty() && !t.starts_with('<')).then(|| clip(t))
}

/// Sessão do Claude Code a partir do `.jsonl` (lê só o começo).
pub fn claude_session(path: &Path) -> Option<Recent> {
    let f = std::fs::File::open(path).ok()?;
    let mut r = Recent { agent: "claude".into(), id: path.file_stem()?.to_string_lossy().into_owned(), title: String::new(), cwd: None, repo: None, branch: None, updated: mtime(path) };
    let mut first = None;
    for line in BufReader::new(f).lines().map_while(Result::ok).take(400) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        match v.get("type").and_then(Value::as_str) {
            Some("ai-title") | Some("summary") => {
                if let Some(t) = v.get("aiTitle").or_else(|| v.get("summary")).and_then(Value::as_str) {
                    r.title = clip(t);
                }
            }
            Some("user") => {
                r.cwd = r.cwd.or_else(|| v.get("cwd").and_then(Value::as_str).map(String::from));
                r.branch = r.branch.or_else(|| v.get("gitBranch").and_then(Value::as_str).filter(|b| !b.is_empty()).map(String::from));
                if first.is_none() {
                    first = v.pointer("/message/content").and_then(user_text);
                }
            }
            _ => {}
        }
        if !r.title.is_empty() && r.cwd.is_some() {
            break;
        }
    }
    r.cwd.as_ref()?;
    if r.title.is_empty() {
        r.title = first.unwrap_or_else(|| "(sem título)".into());
    }
    r.repo = r.cwd.as_deref().and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned());
    Some(r)
}

/// Sessão do Codex a partir do rollout.
pub fn codex_session(path: &Path) -> Option<Recent> {
    let f = std::fs::File::open(path).ok()?;
    let mut lines = BufReader::new(f).lines().map_while(Result::ok);
    let meta: Value = serde_json::from_str(&lines.next()?).ok()?;
    let p = meta.get("payload")?;
    let cwd = p.get("cwd").and_then(Value::as_str).map(String::from);
    let mut title = None;
    for line in lines.take(200) {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("type").and_then(Value::as_str) == Some("event_msg") && v.pointer("/payload/type").and_then(Value::as_str) == Some("user_message") {
            title = v.pointer("/payload/message").and_then(user_text);
            if title.is_some() {
                break;
            }
        }
    }
    Some(Recent {
        agent: "codex".into(),
        id: p.get("id").or_else(|| p.get("session_id")).and_then(Value::as_str)?.to_string(),
        title: title.unwrap_or_else(|| "(sem título)".into()),
        repo: cwd.as_deref().and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned()),
        branch: p.pointer("/git/branch").and_then(Value::as_str).map(String::from),
        cwd,
        updated: mtime(path),
    })
}

fn newest_files(dir: &Path, ext: &str, limit: usize, depth: usize) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    entries.sort();
    entries.reverse();
    for e in entries {
        if out.len() >= limit {
            break;
        }
        if e.is_dir() && depth > 0 {
            out.extend(newest_files(&e, ext, limit - out.len(), depth - 1));
        } else if e.extension().and_then(|x| x.to_str()) == Some(ext) {
            out.push(e);
        }
    }
    out
}

fn sqlite_ro(path: &Path) -> Option<rusqlite::Connection> {
    rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()
}

fn opencode_sessions(home: &Path, limit: usize) -> Vec<Recent> {
    let Some(c) = sqlite_ro(&home.join(".local/share/opencode/opencode.db")) else { return vec![] };
    let Ok(mut st) = c.prepare("select id, title, directory, time_updated from session where parent_id is null order by time_updated desc limit ?1") else { return vec![] };
    st.query_map([limit as i64], |r| {
        let cwd: Option<String> = r.get(2)?;
        Ok(Recent {
            agent: "opencode".into(),
            id: r.get(0)?,
            title: clip(&r.get::<_, Option<String>>(1)?.unwrap_or_default()),
            repo: cwd.as_deref().and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned()),
            branch: None,
            cwd,
            updated: r.get::<_, i64>(3)? / 1000,
        })
    })
    .map(|it| it.flatten().collect())
    .unwrap_or_default()
}

fn agy_sessions(home: &Path, limit: usize) -> Vec<Recent> {
    let Some(c) = sqlite_ro(&home.join(".gemini/antigravity-cli/conversation_summaries.db")) else { return vec![] };
    let Ok(mut st) = c.prepare("select conversation_id, title, preview, workspace_uris, cast(strftime('%s', last_modified_time) as integer) from conversation_summaries where parent_conversation_id = '' order by last_modified_time desc limit ?1")
    else {
        return vec![];
    };
    st.query_map([limit as i64], |r| {
        let uris: String = r.get(3)?;
        let cwd = uris.split([',', ';', '\n', '"', '[', ']']).map(str::trim).find(|u| u.starts_with("file://") || u.starts_with('/')).map(|u| u.trim_start_matches("file://").to_string());
        let title: String = r.get(1)?;
        let preview: String = r.get(2)?;
        Ok(Recent {
            agent: "agy".into(),
            id: r.get(0)?,
            title: clip(if title.is_empty() { &preview } else { &title }),
            repo: cwd.as_deref().and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned()),
            branch: None,
            cwd,
            updated: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
        })
    })
    .map(|it| it.flatten().collect())
    .unwrap_or_default()
}

/// Sessões recentes dos CLIs (mais novas primeiro), sem as que já são conversas do Kabul.
pub fn recent(home: &Path, limit: usize, known: &HashSet<String>) -> Vec<Recent> {
    let mut v: Vec<Recent> = vec![];
    let mut claude: Vec<PathBuf> = std::fs::read_dir(home.join(".claude/projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|d| std::fs::read_dir(d.path()).into_iter().flatten().flatten().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .collect();
    claude.sort_by_key(|p| std::cmp::Reverse(mtime(p)));
    v.extend(claude.iter().take(limit).filter_map(|p| claude_session(p)));
    v.extend(newest_files(&home.join(".codex/sessions"), "jsonl", limit, 3).iter().filter_map(|p| codex_session(p)));
    v.extend(opencode_sessions(home, limit));
    v.extend(agy_sessions(home, limit));
    v.retain(|r| !known.contains(&r.id));
    v.sort_by_key(|r| std::cmp::Reverse(r.updated));
    v.truncate(limit);
    v
}

/// Tudo que o Painel mostra de fora do Kabul.
pub fn collect(kabul_home: &Path, limit: usize) -> ExternalSessions {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default();
    let procs = crate::resources::processes();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let live = if procs.iter().any(|p| agent_of(p).as_deref() == Some("claude")) {
        crate::harness::CmdSpec::new("claude", ["agents", "--json"]).command().output().map(|o| parse_claude_agents(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
    } else {
        HashMap::new()
    };
    let known = crate::history::agent_sessions(kabul_home);
    let mut running = running(&procs, std::process::id(), now, &live);
    // Sem pid→sessão (codex, opencode, agy): a sessão mais recente do mesmo agente na mesma pasta.
    let recent = recent(&home, limit, &known);
    for r in running.iter_mut().filter(|r| r.session_id.is_none()) {
        r.session_id = recent.iter().find(|s| s.agent == r.agent && s.cwd == r.cwd).map(|s| s.id.clone());
    }
    ExternalSessions { running, recent, cloud_note: CLOUD_NOTE.into() }
}

/// Id da sessão de nuvem a partir do link do claude.ai/code ou do id colado.
pub fn cloud_id(input: &str) -> Option<String> {
    let t = input.trim().trim_end_matches('/');
    let id = if t.starts_with("http") { t.split(['?', '#']).next()?.rsplit('/').next()? } else { t };
    (id.len() >= 6 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')).then(|| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str, cwd: Option<&str>, cmd: &[&str], start: u64) -> Proc {
        Proc { pid, parent: Some(parent), name: name.into(), cmd: cmd.iter().map(|s| s.to_string()).collect(), cpu: 0.0, mem: 0, cwd: cwd.map(String::from), start }
    }

    #[test]
    fn processos_de_fora() {
        let procs = vec![
            p(10, 1, "Terminal", None, &[], 0),
            p(11, 10, "login", None, &[], 0),
            p(12, 11, "zsh", Some("/w/a"), &[], 0),
            p(13, 12, "opencode", Some("/w/a"), &["opencode"], 900),
            p(14, 13, "node", Some("/w/a"), &["node", "/x/claude"], 950),
            p(20, 1, "iTerm2", None, &[], 0),
            p(21, 20, "zsh", Some("/w/b"), &[], 0),
            p(22, 21, "node", Some("/w/b"), &["node", "/usr/local/bin/claude"], 500),
            p(30, 1, "tmux", None, &[], 0),
            p(31, 30, "zsh", None, &[], 0),
            p(32, 31, "codex", Some("/w/c"), &["codex"], 100),
            p(40, 1, "kabul-desktop", None, &[], 0),
            p(41, 40, "claude", Some("/w/d"), &["claude"], 100),
        ];
        let live = parse_claude_agents(r#"[{"pid":"22","sessionId":"sess-b","cwd":"/w/b"},{"pid":41,"sessionId":"x"}]"#);
        let r = running(&procs, 40, 1000, &live);
        assert_eq!(r.len(), 2, "{r:?}");
        assert_eq!((r[0].agent.as_str(), r[0].terminal.as_deref(), r[0].running_secs), ("opencode", Some("Terminal"), 100));
        assert_eq!((r[1].agent.as_str(), r[1].terminal.as_deref(), r[1].session_id.as_deref()), ("claude", Some("iTerm2"), Some("sess-b")));
    }

    #[test]
    fn historico_dos_clis() {
        let home = std::env::temp_dir().join(format!("kabul-ext-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let cp = home.join(".claude/projects/-w-repo");
        std::fs::create_dir_all(&cp).unwrap();
        std::fs::write(cp.join("aaaa-1111.jsonl"), include_str!("../tests/fixtures/ext_claude.jsonl")).unwrap();
        std::fs::write(
            cp.join("bbbb-2222.jsonl"),
            r#"{"type":"user","cwd":"/w/repo","gitBranch":"","message":{"role":"user","content":[{"type":"text","text":"<system_instruction>x</system_instruction>"}]}}
{"type":"user","cwd":"/w/repo","message":{"role":"user","content":"corrige o login no Safari"}}"#,
        )
        .unwrap();
        let cx = home.join(".codex/sessions/2026/10/24");
        std::fs::create_dir_all(&cx).unwrap();
        std::fs::write(cx.join("rollout-2026-10-24T10-00-00-cccc.jsonl"), include_str!("../tests/fixtures/ext_codex.jsonl")).unwrap();
        let known: HashSet<String> = ["bbbb-2222".to_string()].into();
        let v = recent(&home, 10, &known);
        let c = v.iter().find(|r| r.agent == "claude").unwrap();
        assert_eq!((c.id.as_str(), c.title.as_str(), c.cwd.as_deref(), c.branch.as_deref(), c.repo.as_deref()), ("aaaa-1111", "Revisar a fila de mensagens", Some("/w/repo"), Some("feat/fila"), Some("repo")));
        assert!(!v.iter().any(|r| r.id == "bbbb-2222"), "já é conversa do Kabul");
        let x = v.iter().find(|r| r.agent == "codex").unwrap();
        assert_eq!((x.id.as_str(), x.title.as_str(), x.branch.as_deref()), ("0000-codex", "adiciona testes do parser", Some("main")));
        // Sem título: a primeira mensagem do usuário que não é instrução injetada.
        let b = claude_session(&cp.join("bbbb-2222.jsonl")).unwrap();
        assert_eq!(b.title, "corrige o login no Safari");
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn link_da_nuvem() {
        assert_eq!(cloud_id("https://claude.ai/code/session_01AbCdEf?x=1").as_deref(), Some("session_01AbCdEf"));
        assert_eq!(cloud_id(" session_01AbCdEf ").as_deref(), Some("session_01AbCdEf"));
        assert_eq!(cloud_id("rm -rf /"), None);
        assert_eq!(harness_of("agy"), Some(HarnessKind::Antigravity));
    }

    #[test]
    fn repo_e_branch_sem_git() {
        let d = std::env::temp_dir().join(format!("kabul-ext-repo-{}", std::process::id()));
        std::fs::create_dir_all(d.join("proj/.git")).unwrap();
        std::fs::create_dir_all(d.join("proj/src")).unwrap();
        std::fs::write(d.join("proj/.git/HEAD"), "ref: refs/heads/dev/x\n").unwrap();
        assert_eq!(repo_of(&d.join("proj/src").display().to_string()), (Some("proj".into()), Some("dev/x".into())));
        std::fs::remove_dir_all(&d).ok();
    }
}
