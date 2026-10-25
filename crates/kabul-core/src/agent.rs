//! Detecta qual agente roda num pane: Claude Code, Codex, Antigravity ou shell.
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
    Antigravity,
    Shell,
    Other,
}

impl AgentKind {
    pub fn label(self) -> &'static str {
        match self {
            AgentKind::Claude => "claude",
            AgentKind::Codex => "codex",
            AgentKind::Antigravity => "antigravity",
            AgentKind::Shell => "shell",
            AgentKind::Other => "outro",
        }
    }
}

const SHELLS: &[&str] = &["zsh", "bash", "sh", "fish", "nu", "dash", "ksh", "tcsh", "login", "pwsh", "powershell", "cmd"];

fn basename(s: &str) -> &str {
    let first = s.split_whitespace().next().unwrap_or("");
    let b = first.rsplit(['/', '\\']).next().unwrap_or(first).trim_start_matches('-');
    // Windows: `claude.exe`, `codex.cmd`.
    [".exe", ".cmd", ".bat"].iter().find_map(|e| b.strip_suffix(e)).unwrap_or(b)
}

/// Classifica uma linha de comando (nome curto ou cmdline completa).
pub fn classify(cmd: &str) -> Option<AgentKind> {
    let lower = cmd.to_lowercase().replace('\\', "/");
    let base = basename(&lower);
    if base == "claude" || lower.contains("@anthropic-ai/claude-code") || lower.contains("/claude/versions/") {
        return Some(AgentKind::Claude);
    }
    if base == "codex" || lower.contains("@openai/codex") {
        return Some(AgentKind::Codex);
    }
    if base == "agy" || base == "antigravity" || lower.contains("antigravity-cli") {
        return Some(AgentKind::Antigravity);
    }
    if SHELLS.contains(&base) {
        return Some(AgentKind::Shell);
    }
    None
}

/// Decide o agente a partir do `pane_current_command` e das cmdlines dos processos filhos.
/// Agentes ganham de shell; o claude nativo aparece como versão (ex.: `2.1.3`).
pub fn detect(current_command: &str, descendants: &[String]) -> AgentKind {
    let mut found_shell = false;
    for c in std::iter::once(current_command).chain(descendants.iter().map(String::as_str)) {
        match classify(c) {
            Some(AgentKind::Shell) => found_shell = true,
            Some(k) => return k,
            None => {}
        }
    }
    if found_shell {
        AgentKind::Shell
    } else {
        AgentKind::Other
    }
}

/// Processo da tabela: (pid, ppid, linha de comando).
pub type ProcRow = (u32, u32, String);

/// Tabela de processos para a detecção. macOS/Linux: `ps` (uma chamada); Windows: `sysinfo`.
pub fn process_table() -> Vec<ProcRow> {
    if cfg!(windows) {
        return crate::resources::processes().into_iter().map(|p| (p.pid, p.parent.unwrap_or(0), std::iter::once(p.name.clone()).chain(p.cmd.iter().skip(1).cloned()).collect::<Vec<_>>().join(" "))).collect();
    }
    match crate::shell::command("ps").args(["-A", "-o", "pid=,ppid=,command="]).output() {
        Ok(o) if o.status.success() => parse_ps(&String::from_utf8_lossy(&o.stdout)),
        _ => vec![],
    }
}

/// Parse de `ps -A -o pid=,ppid=,command=`.
pub fn parse_ps(ps_out: &str) -> Vec<ProcRow> {
    ps_out
        .lines()
        .filter_map(|l| {
            let mut it = l.trim_start().splitn(2, char::is_whitespace);
            let pid = it.next()?.parse().ok()?;
            let rest = it.next()?.trim_start();
            let mut it2 = rest.splitn(2, char::is_whitespace);
            let ppid = it2.next()?.parse().ok()?;
            Some((pid, ppid, it2.next().unwrap_or("").trim().to_string()))
        })
        .collect()
}

/// Cmdlines descendentes de `root` na saída do `ps`.
pub fn descendants_from_ps(ps_out: &str, root: u32) -> Vec<String> {
    descendants(&parse_ps(ps_out), root)
}

/// Cmdlines descendentes de `root` na tabela.
pub fn descendants(procs: &[ProcRow], root: u32) -> Vec<String> {
    let mut out = vec![];
    let mut frontier = vec![root];
    while let Some(p) = frontier.pop() {
        for (pid, ppid, cmd) in procs {
            if *ppid == p && *pid != p {
                out.push(cmd.clone());
                frontier.push(*pid);
            }
        }
    }
    out
}

/// Tabela de processos indexada por pai: os descendentes de cada pane saem em O(tamanho da subárvore),
/// em vez de varrer a lista inteira a cada nível (o [`descendants`] faz isso por pane).
#[derive(Debug, Default)]
pub struct ProcIndex {
    cmds: Vec<String>,
    /// ppid → índices em `cmds`/`pids`.
    kids: std::collections::HashMap<u32, Vec<usize>>,
    pids: Vec<u32>,
}

impl ProcIndex {
    /// Saída de `ps -A -o pid=,ppid=,command=`.
    pub fn parse(ps_out: &str) -> Self {
        Self::from_rows(parse_ps(ps_out))
    }
    pub fn from_rows(rows: Vec<ProcRow>) -> Self {
        let mut idx = Self::default();
        for (pid, ppid, cmd) in rows {
            idx.kids.entry(ppid).or_default().push(idx.cmds.len());
            idx.pids.push(pid);
            idx.cmds.push(cmd);
        }
        idx
    }
    /// Uma leitura da tabela de processos para todos os panes ([`process_table`]: `ps` no macOS/Linux,
    /// `sysinfo` no Windows).
    pub fn current() -> Self {
        Self::from_rows(process_table())
    }
    /// Cmdlines dos descendentes de `root` (mesma ordem de visita do [`descendants`]).
    pub fn descendants(&self, root: u32) -> Vec<String> {
        let mut out = vec![];
        let mut frontier = vec![root];
        let mut seen = std::collections::HashSet::new();
        while let Some(p) = frontier.pop() {
            if !seen.insert(p) {
                continue;
            }
            for &i in self.kids.get(&p).map(Vec::as_slice).unwrap_or(&[]) {
                if self.pids[i] == p {
                    continue;
                }
                out.push(self.cmds[i].clone());
                frontier.push(self.pids[i]);
            }
        }
        out
    }
}

/// Detecta o agente de um pane pela árvore de processos (best-effort). Para vários panes, use [`detect_panes`].
pub fn detect_pane(current_command: &str, pane_pid: u32) -> AgentKind {
    detect(current_command, &ProcIndex::current().descendants(pane_pid))
}

/// Agente de cada pane com UMA leitura da tabela de processos (antes era uma por pane).
pub fn detect_panes(panes: &[crate::term::Pane]) -> Vec<AgentKind> {
    if panes.is_empty() {
        return vec![];
    }
    let idx = ProcIndex::current();
    panes.iter().map(|p| detect(&p.command, &idx.descendants(p.pid))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifica() {
        assert_eq!(detect("claude", &[]), AgentKind::Claude);
        assert_eq!(detect("codex", &[]), AgentKind::Codex);
        assert_eq!(detect("agy", &[]), AgentKind::Antigravity);
        assert_eq!(detect("zsh", &[]), AgentKind::Shell);
        assert_eq!(detect("-zsh", &[]), AgentKind::Shell);
        assert_eq!(detect("vim", &[]), AgentKind::Other);
    }

    #[test]
    fn caminhos_do_windows() {
        assert_eq!(classify("C:\\Users\\dev\\.local\\bin\\claude.exe --print"), Some(AgentKind::Claude));
        assert_eq!(classify("node C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"), Some(AgentKind::Codex));
        assert_eq!(classify("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), Some(AgentKind::Shell));
        assert_eq!(classify("cmd.exe /c x"), Some(AgentKind::Shell));
    }

    #[test]
    fn olha_filhos() {
        let ps = "  100     1 -zsh\n  200   100 node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js\n  300   200 /x/codex\n  400     1 /home/dev/.local/bin/agy\n";
        let d = descendants_from_ps(ps, 100);
        assert_eq!(d.len(), 2);
        assert_eq!(detect("node", &d), AgentKind::Codex);
        assert_eq!(detect("2.1.3", &["/home/dev/.local/share/claude/versions/2.1.3".into()]), AgentKind::Claude);
        assert_eq!(detect("zsh", &descendants_from_ps(ps, 400)), AgentKind::Shell);
        // O índice dá o mesmo resultado que a varredura.
        let idx = ProcIndex::parse(ps);
        for root in [100, 200, 300, 400, 1] {
            assert_eq!(idx.descendants(root), descendants_from_ps(ps, root), "raiz {root}");
        }
    }
}
