//! Identidade desta máquina para o seletor do topo da barra lateral: nome amigável do computador e
//! a conta do GitHub conectada (login, e-mail e avatar). Nada fica gravado; tudo é lido na hora.
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MachineUser {
    pub login: String,
    pub email: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MachineInfo {
    pub name: String,
    pub user: Option<MachineUser>,
}

fn out(cmd: &str, args: &[&str]) -> Option<String> {
    let o = crate::shell::command(cmd).args(args).output().ok()?;
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !s.is_empty()).then_some(s)
}

/// Nome amigável ("Mac de Dev"). macOS: `scutil --get ComputerName`; Windows: `COMPUTERNAME`;
/// demais: `hostname` sem o domínio. Ver docs/windows.md.
pub fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Some(n) = out("scutil", &["--get", "ComputerName"]) {
        return n;
    }
    if let Ok(n) = std::env::var("COMPUTERNAME") {
        return n;
    }
    out("hostname", &[]).map(|h| h.split('.').next().unwrap_or(&h).to_string()).unwrap_or_else(|| "Este computador".into())
}

/// Usuário do sistema: `USER` (Unix) ou `USERNAME` (Windows).
pub fn user_name() -> String {
    std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default()
}

/// Conta ativa do `gh` (login, e-mail público e avatar). `None` sem GitHub conectado.
pub fn github_user() -> Option<MachineUser> {
    let active = crate::github::status().into_iter().find(|a| a.active && a.ok)?;
    let gh = crate::harness::which("gh").map(|p| p.display().to_string()).unwrap_or_else(|| "gh".into());
    let email = out(&gh, &["api", "user", "-q", ".email"]).filter(|e| e.contains('@'));
    let avatar = out(&gh, &["api", "user", "-q", ".avatar_url"]).filter(|u| u.starts_with("https://"));
    Some(MachineUser { login: active.login, email, avatar })
}

pub fn info() -> MachineInfo {
    MachineInfo { name: computer_name(), user: github_user() }
}

#[cfg(test)]
mod tests {
    #[test]
    fn nome_nao_vazio() {
        assert!(!super::computer_name().trim().is_empty());
    }
}
