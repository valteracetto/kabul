//! Diagnóstico do ambiente (Ajuda › Diagnóstico): ferramentas, versões, PATH e shell, com relatório
//! copiável e uma versão sem dados pessoais (caminho da pasta pessoal, usuário, nome da máquina, e-mails).
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Check {
    pub group: String,
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

fn version(bin: &str, args: &[&str]) -> (bool, String) {
    let Some(path) = crate::harness::which(bin) else { return (false, "não encontrado no PATH".into()) };
    match Command::new(&path).args(args).output() {
        Ok(o) => {
            let out = String::from_utf8_lossy(if o.stdout.is_empty() { &o.stderr } else { &o.stdout }).lines().next().unwrap_or("").trim().to_string();
            (o.status.success(), format!("{out} ({})", path.display()))
        }
        Err(e) => (false, e.to_string()),
    }
}

pub fn run() -> Vec<Check> {
    let mut v = vec![];
    let mut add = |group: &str, name: &str, (ok, detail): (bool, String)| v.push(Check { group: group.into(), name: name.into(), ok, detail });
    add("Essenciais", "git", version("git", &["--version"]));
    add("Essenciais", "tmux", version("tmux", &["-V"]));
    add("Essenciais", "gh (GitHub CLI)", version("gh", &["--version"]));
    let gh_ok = crate::github::status().iter().any(|a| a.active && a.ok);
    add("Essenciais", "GitHub conectado", (gh_ok, if gh_ok { "conta ativa válida".into() } else { "rode gh auth login ou entre em Configurações › Contas".into() }));
    for (name, bin, args) in [("Claude Code", "claude", vec!["--version"]), ("Codex", "codex", vec!["--version"]), ("OpenCode", "opencode", vec!["--version"]), ("Qwen Code", "qwen", vec!["--version"]), ("Gemini CLI", "gemini", vec!["--version"]), ("Antigravity", "agy", vec!["--version"])] {
        add("Agentes", name, version(bin, &args));
    }
    add("Ferramentas", "node", version("node", &["--version"]));
    add("Ferramentas", "npm", version("npm", &["--version"]));
    add("Ferramentas", "ffmpeg (ditado)", version("ffmpeg", &["-version"]));
    add("Ferramentas", "whisper-cli (ditado)", version("whisper-cli", &["--help"]).0.then(|| (true, "instalado".to_string())).unwrap_or((false, "não encontrado no PATH".into())));
    let path = std::env::var("PATH").unwrap_or_default();
    add("Ambiente", "PATH", (!path.is_empty(), format!("{} pastas", path.split(':').filter(|p| !p.is_empty()).count())));
    add("Ambiente", "SHELL", std::env::var("SHELL").map(|s| (true, s)).unwrap_or((false, "não definido".into())));
    let home = std::env::var("HOME").unwrap_or_default();
    add("Ambiente", "HOME", (std::path::Path::new(&home).is_dir(), home.clone()));
    v
}

/// Relatório em texto (uma linha por checagem).
pub fn report(checks: &[Check]) -> String {
    let mut out = String::from("Kabul — diagnóstico\n");
    let mut group = "";
    for c in checks {
        if c.group != group {
            group = &c.group;
            out.push_str(&format!("\n## {group}\n"));
        }
        out.push_str(&format!("{} {}: {}\n", if c.ok { "✓" } else { "✕" }, c.name, c.detail));
    }
    out
}

/// Tira dados pessoais: pasta pessoal → ~, usuário → <usuário>, nome da máquina → <máquina>, e-mails → <e-mail>.
pub fn redact(text: &str, home: &str, user: &str, host: &str) -> String {
    let mut t = text.to_string();
    if !home.is_empty() {
        t = t.replace(home, "~");
    }
    // E-mails primeiro (antes de trocar o usuário dentro deles), depois a máquina e o usuário como palavra inteira.
    t = t
        .split_inclusive(char::is_whitespace)
        .map(|w| {
            let core = w.trim_end().trim_matches(|c: char| "(),;".contains(c));
            if core.contains('@') && core.contains('.') && !core.starts_with('@') { w.replace(core, "<e-mail>") } else { w.to_string() }
        })
        .collect();
    if host.len() >= 2 {
        t = t.replace(host, "<máquina>");
    }
    if user.len() >= 2 {
        let mut out = String::new();
        let mut rest = t.as_str();
        while let Some(i) = rest.find(user) {
            let before = rest[..i].chars().last();
            let after = rest[i + user.len()..].chars().next();
            let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
            out.push_str(&rest[..i]);
            out.push_str(if word(before) || word(after) { user } else { "<usuário>" });
            rest = &rest[i + user.len()..];
        }
        out.push_str(rest);
        t = out;
    }
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relatorio_e_redacao() {
        let c = vec![Check { group: "Essenciais".into(), name: "git".into(), ok: true, detail: "git version 2.50 (/home/dev/bin/git)".into() }, Check { group: "Ambiente".into(), name: "HOME".into(), ok: false, detail: "/home/dev em mac-de-dev, dono dev@example.com".into() }];
        let r = report(&c);
        assert!(r.contains("## Essenciais\n✓ git: git version 2.50"));
        assert!(r.contains("✕ HOME"));
        let red = redact(&r, "/home/dev", "dev", "mac-de-dev");
        assert!(red.contains("(~/bin/git)"), "{red}");
        assert!(red.contains("<máquina>") && red.contains("<e-mail>"), "{red}");
        assert_eq!(redact("user dev; device", "", "dev", ""), "user <usuário>; device");
        assert!(!red.contains("example.com"));
        assert!(!run().is_empty());
    }
}
