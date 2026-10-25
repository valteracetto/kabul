//! Backend tmux (macOS/Linux): as sessões sobrevivem ao app e aparecem no `tmux ls` do usuário.
//! As linhas de comando são as mesmas de antes da trait (zsh de login, `export` do ambiente).
use super::{Cmd, Conn, Launch, PaneInfo, Stream, TerminalBackend, What};
use crate::harness::shell_quote;
use crate::tmux;
use anyhow::Result;

pub struct Tmux;

fn line(cmd: &Cmd) -> String {
    match cmd {
        Cmd::Line(s) => s.clone(),
        Cmd::Spec(s) => s.shell_line(),
    }
}

fn exports(env: &[(String, String)]) -> String {
    env.iter().map(|(k, v)| format!("export {k}={}; ", shell_quote(v))).collect()
}

/// Comando passado ao `tmux new-session` (testável sem tmux). `zsh`: há zsh na máquina.
pub fn command_for(l: &Launch, zsh: bool) -> Option<String> {
    let ex = exports(&l.env);
    match &l.what {
        What::Shell if zsh => Some(format!("zsh -c {}", shell_quote(&format!("{ex}exec zsh -l")))),
        What::Shell => Some(format!("sh -c {}", shell_quote(&format!("{ex}exec \"${{SHELL:-sh}}\" -l")))),
        What::Run { cmd, log } => {
            let script = line(cmd);
            let (sh, status) = if zsh { ("zsh", "$pipestatus[1]") } else { ("sh", "$?") };
            let tail = match log {
                Some(l) => {
                    let q = shell_quote(&l.display().to_string());
                    format!(" 2>&1 | tee -a {q}; echo \"[kabul] saiu com {status}\" | tee -a {q}")
                }
                None => "; echo \"[kabul] saiu com $?\"".into(),
            };
            let inner = format!("{ex}{sh} -lc {}{tail}; exec {sh} -l", shell_quote(&script));
            Some(format!("{sh} -c {}", shell_quote(&inner)))
        }
        What::Exec(cmd) if ex.is_empty() => Some(line(cmd)),
        What::Exec(cmd) => Some(format!("sh -c {}", shell_quote(&format!("{ex}{}", line(cmd))))),
    }
}

struct TmuxConn(tmux::stream::TermStream);

impl Conn for TmuxConn {
    fn input(&mut self, pane: &str, data: &[u8]) -> Result<()> {
        self.0.input(pane, data)
    }
    fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.0.resize(cols, rows)
    }
}

fn display(target: &str, fmt: &str) -> Option<String> {
    let o = tmux::cmd().args(["display-message", "-p", "-t", target, fmt]).output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

impl TerminalBackend for Tmux {
    fn kind(&self) -> &'static str {
        "tmux"
    }
    fn list(&self) -> Result<Vec<super::Pane>> {
        tmux::list_panes()
    }
    fn list_ext(&self) -> Result<Vec<super::PaneExt>> {
        tmux::list_panes_ext()
    }
    fn capture_many(&self, panes: &[&str]) -> std::collections::HashMap<String, String> {
        tmux::capture_many(panes)
    }
    fn has(&self, session: &str) -> bool {
        tmux::has_session(session)
    }
    fn open(&self, l: &Launch) -> Result<()> {
        let zsh = crate::harness::which("zsh").is_some();
        tmux::new_session(&l.name, l.cwd.as_deref(), command_for(l, zsh).as_deref())
    }
    fn kill(&self, session: &str) -> Result<()> {
        tmux::kill_session(session)
    }
    fn capture(&self, target: &str, history: u32) -> Result<String> {
        tmux::capture_pane(target, history)
    }
    fn plain(&self, target: &str) -> Result<String> {
        let o = tmux::cmd().args(["capture-pane", "-p", "-t", target]).output()?;
        Ok(String::from_utf8_lossy(&o.stdout).into_owned())
    }
    fn screen(&self, target: &str) -> Result<String> {
        tmux::screen(target)
    }
    fn send(&self, target: &str, data: &[u8]) -> Result<()> {
        tmux::send_bytes(target, data)
    }
    fn resize(&self, session: &str, cols: u16, rows: u16) -> Result<()> {
        tmux::resize(&tmux::exact(session), cols, rows)
    }
    fn info(&self, target: &str) -> Option<PaneInfo> {
        let s = display(target, "#{pane_width} #{pane_height} #{window_activity}")?;
        let mut it = s.split_whitespace();
        Some(PaneInfo { cols: it.next()?.parse().ok()?, rows: it.next()?.parse().ok()?, activity: it.next().and_then(|a| a.parse().ok()).unwrap_or(0) })
    }
    fn attach(&self, session: &str) -> Result<Stream> {
        let mut t = tmux::stream::TermStream::attach(session)?;
        let rx = t.output.take().expect("stream novo tem saída");
        Ok(Stream::new(Box::new(TmuxConn(t)), rx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::CmdSpec;

    /// As linhas do tmux continuam as de antes da trait (macOS com zsh).
    #[test]
    fn linhas_iguais_as_de_antes() {
        let env = vec![("KABUL_PORT".to_string(), "5100".to_string())];
        let shell = Launch::new("s", Some("/w"), What::Shell).env(&env);
        assert_eq!(command_for(&shell, true).unwrap(), "zsh -c 'export KABUL_PORT=5100; exec zsh -l'");
        let run = Launch::new("s", Some("/w"), What::Run { cmd: Cmd::Line("npm i".into()), log: Some("/w/.context/setup-logs.txt".into()) }).env(&env);
        assert_eq!(
            command_for(&run, true).unwrap(),
            format!("zsh -c {}", shell_quote("export KABUL_PORT=5100; zsh -lc 'npm i' 2>&1 | tee -a /w/.context/setup-logs.txt; echo \"[kabul] saiu com $pipestatus[1]\" | tee -a /w/.context/setup-logs.txt; exec zsh -l"))
        );
        let run2 = Launch::new("s", None, What::Run { cmd: Cmd::Spec(CmdSpec::new("claude", ["--teleport", "abc"])), log: None });
        assert_eq!(command_for(&run2, true).unwrap(), format!("zsh -c {}", shell_quote("zsh -lc 'claude --teleport abc'; echo \"[kabul] saiu com $?\"; exec zsh -l")));
        let exec = Launch::new("s", None, What::Exec(Cmd::Spec(CmdSpec::new("ollama", ["pull", "qwen3"]))));
        assert_eq!(command_for(&exec, true).unwrap(), "ollama pull qwen3");
        assert_eq!(command_for(&Launch::new("s", None, What::Shell), false).unwrap(), "sh -c 'exec \"${SHELL:-sh}\" -l'");
    }

    /// Ponta a ponta pela trait com tmux real (pula sem tmux).
    #[test]
    fn pela_trait() {
        if crate::harness::which("tmux").is_none() {
            return;
        }
        let t = Tmux;
        let name = format!("kabul-test-trait-{}", std::process::id());
        t.open(&Launch::new(&name, Some("/tmp"), What::Exec(Cmd::Line("sh".into())))).unwrap();
        assert!(t.has(&name));
        let pane = t.pane_of(&name).unwrap();
        let mut s = t.attach(&name).unwrap();
        s.input(&pane, b"echo kabul-$((40+2))\r").unwrap();
        let rx = s.output.take().unwrap();
        let mut got = String::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline && !got.contains("kabul-42") {
            if let Ok((_, b)) = rx.recv_timeout(std::time::Duration::from_millis(200)) {
                got.push_str(&String::from_utf8_lossy(&b));
            }
        }
        drop(s);
        let info = t.info(&pane);
        let plain = t.plain(&pane).unwrap_or_default();
        let _ = t.kill(&name);
        assert!(got.contains("kabul-42"), "{got}");
        assert!(info.is_some_and(|i| i.cols > 0 && i.rows > 0));
        assert!(plain.contains("kabul-42"));
        assert!(!t.has(&name));
    }
}
