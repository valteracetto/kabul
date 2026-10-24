//! Detecta qual agente roda num pane: Claude Code, Codex, Antigravity ou shell.
use serde::Serialize;
use std::process::Command;

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

const SHELLS: &[&str] = &["zsh", "bash", "sh", "fish", "nu", "dash", "ksh", "tcsh", "login"];

fn basename(s: &str) -> &str {
    let first = s.split_whitespace().next().unwrap_or("");
    first.rsplit('/').next().unwrap_or(first).trim_start_matches('-')
}

/// Classifica uma linha de comando (nome curto ou cmdline completa).
pub fn classify(cmd: &str) -> Option<AgentKind> {
    let lower = cmd.to_lowercase();
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

/// Parse de `ps -A -o pid=,ppid=,command=` e retorna as cmdlines descendentes de `root`.
pub fn descendants_from_ps(ps_out: &str, root: u32) -> Vec<String> {
    let procs: Vec<(u32, u32, String)> = ps_out
        .lines()
        .filter_map(|l| {
            let mut it = l.trim_start().splitn(2, char::is_whitespace);
            let pid = it.next()?.parse().ok()?;
            let rest = it.next()?.trim_start();
            let mut it2 = rest.splitn(2, char::is_whitespace);
            let ppid = it2.next()?.parse().ok()?;
            Some((pid, ppid, it2.next().unwrap_or("").trim().to_string()))
        })
        .collect();
    let mut out = vec![];
    let mut frontier = vec![root];
    while let Some(p) = frontier.pop() {
        for (pid, ppid, cmd) in &procs {
            if *ppid == p {
                out.push(cmd.clone());
                frontier.push(*pid);
            }
        }
    }
    out
}

/// Detecta o agente de um pane consultando `ps` (best-effort).
pub fn detect_pane(current_command: &str, pane_pid: u32) -> AgentKind {
    let ps = Command::new("ps").args(["-A", "-o", "pid=,ppid=,command="]).output();
    let desc = match ps {
        Ok(o) if o.status.success() => descendants_from_ps(&String::from_utf8_lossy(&o.stdout), pane_pid),
        _ => vec![],
    };
    detect(current_command, &desc)
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
    fn olha_filhos() {
        let ps = "  100     1 -zsh\n  200   100 node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js\n  300   200 /x/codex\n  400     1 /home/dev/.local/bin/agy\n";
        let d = descendants_from_ps(ps, 100);
        assert_eq!(d.len(), 2);
        assert_eq!(detect("node", &d), AgentKind::Codex);
        assert_eq!(detect("2.1.3", &["/home/dev/.local/share/claude/versions/2.1.3".into()]), AgentKind::Claude);
        assert_eq!(detect("zsh", &descendants_from_ps(ps, 400)), AgentKind::Shell);
    }
}
