//! Sessões do Claude na nuvem e espelhamento (remote-control), rodando no tmux.
//! `claude --cloud` exige terminal interativo (confirmado: "requires an interactive terminal"),
//! por isso roda numa sessão tmux e a saída é lida por capture-pane.
use crate::harness::{find_urls, shell_quote, strip_ansi, ClaudeCode, Harness};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct CloudInfo {
    pub id: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
    /// Aviso do CLI (ex.: branch não está no GitHub; a nuvem parte de outro commit).
    pub warning: Option<String>,
    pub exited: Option<i32>,
    pub runs_on: Option<crate::runs_on::RunsOn>,
}

/// Linha de shell para criar a sessão de nuvem.
pub fn cloud_line(prompt: &str, environment: Option<&str>) -> String {
    ClaudeCode.cloud_run(prompt, environment).map(|c| c.shell_line()).unwrap_or_default()
}

pub fn teleport_line(id: &str) -> String {
    format!("claude --teleport {}", shell_quote(id))
}

/// Sessão interativa espelhada em claude.ai/code e no app do celular.
pub fn remote_control_line(name: &str, resume: Option<&str>) -> String {
    let mut s = format!("claude --remote-control {}", shell_quote(name));
    if let Some(r) = resume {
        s.push_str(&format!(" --resume {}", shell_quote(r)));
    }
    s
}

/// Lê a saída do `claude --cloud` (capturada do tmux).
pub fn parse(out: &str) -> CloudInfo {
    let clean = strip_ansi(out);
    let h = ClaudeCode.parse_remote_output(&clean);
    let line = |p: &str| clean.lines().find(|l| l.trim_start().starts_with(p)).map(|l| l.trim().to_string());
    CloudInfo {
        id: h.id,
        url: h.url,
        title: line("Created cloud session:").map(|l| l.trim_start_matches("Created cloud session:").trim().to_string()),
        warning: line("Branch ").filter(|l| l.contains("not on GitHub")).or_else(|| clean.lines().find(|l| l.contains("rror")).map(|l| l.trim().to_string())),
        exited: clean.lines().find_map(|l| l.trim().strip_prefix("[kabul] saiu com ").and_then(|c| c.trim().parse().ok())),
        runs_on: Some(crate::runs_on::RunsOn::ProviderCloud { provider: "claude".into() }),
    }
}

/// Link do remote-control na saída da sessão espelhada.
pub fn parse_remote_link(out: &str) -> Option<String> {
    find_urls(&strip_ansi(out)).into_iter().find(|u| u.contains("claude.ai/code"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saida_real() {
        let i = parse(include_str!("../tests/fixtures/claude_cloud_cli.txt"));
        assert_eq!(i.id.as_deref(), Some("session_01AbcDefGhiJklMnoPqrStu"));
        assert_eq!(i.title.as_deref(), Some("Resposta curta sem ferramentas"));
        assert!(i.warning.unwrap().contains("not on GitHub"));
        assert_eq!(parse("x\n[kabul] saiu com 1\n").exited, Some(1));
        assert_eq!(cloud_line("faz x", Some("env_1")), "claude --cloud 'faz x' --environment env_1");
        assert_eq!(remote_control_line("kabul-lisboa", Some("abc")), "claude --remote-control kabul-lisboa --resume abc");
    }
}
