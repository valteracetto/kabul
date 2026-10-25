//! GitHub: status do `gh` (contas, escopos), token pessoal no Keychain (exportado como GH_TOKEN)
//! e checagem de acesso ao repositório.
use anyhow::{bail, Result};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

const SERVICE: &str = "kabul-github";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GhAccount {
    pub host: String,
    pub login: String,
    pub active: bool,
    pub scopes: Vec<String>,
    /// keyring | oauth_token | GH_TOKEN ...
    pub source: String,
    pub ok: bool,
}

pub fn parse_status(json: &str) -> Vec<GhAccount> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let mut out = vec![];
    for (host, list) in v.get("hosts").and_then(Value::as_object).into_iter().flatten() {
        for a in list.as_array().into_iter().flatten() {
            out.push(GhAccount {
                host: host.clone(),
                login: a.get("login").and_then(Value::as_str).unwrap_or("").into(),
                active: a.get("active").and_then(Value::as_bool).unwrap_or(false),
                scopes: a.get("scopes").and_then(Value::as_str).unwrap_or("").split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
                source: a.get("tokenSource").and_then(Value::as_str).unwrap_or("").into(),
                ok: a.get("state").and_then(Value::as_str) == Some("success"),
            });
        }
    }
    out
}

pub fn status() -> Vec<GhAccount> {
    crate::shell::command(crate::harness::which("gh").unwrap_or_else(|| "gh".into())).args(["auth", "status", "--json", "hosts"]).output().map(|o| parse_status(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

pub fn switch(login: &str) -> Result<()> {
    let o = crate::shell::command(crate::harness::which("gh").unwrap_or_else(|| "gh".into())).args(["auth", "switch", "-h", "github.com", "-u", login]).output()?;
    if !o.status.success() {
        bail!("gh auth switch: {}", String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(())
}

/// Token no cofre do sistema (Keychain, Credential Manager, Secret Service).
pub fn get_token() -> Option<String> {
    crate::secrets::get(SERVICE)
}

/// Grava o token sem passá-lo na linha de comando ([`crate::secrets`]; no macOS, [`crate::keychain`]).
pub fn set_token(token: &str) -> Result<()> {
    crate::secrets::set(SERVICE, token)
}

pub fn clear_token() {
    crate::secrets::delete(SERVICE)
}

/// `owner/repo` a partir da URL do remote origin (https ou ssh).
pub fn slug_from_remote(url: &str) -> Option<String> {
    let u = url.trim().trim_end_matches(".git");
    let rest = u.split_once("github.com").map(|(_, r)| r)?;
    let s = rest.trim_start_matches([':', '/']);
    let mut parts = s.split('/');
    Some(format!("{}/{}", parts.next()?, parts.next()?))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RepoAccess {
    pub slug: Option<String>,
    pub ok: bool,
    pub permission: Option<String>,
    pub message: Option<String>,
}

/// Verifica se a conta ativa enxerga o repo (`gh repo view --json viewerPermission`).
pub fn repo_access(repo: &Path) -> RepoAccess {
    let remote = crate::shell::command("git").arg("-C").arg(repo).args(["remote", "get-url", "origin"]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let Some(slug) = remote.as_deref().and_then(slug_from_remote) else {
        return RepoAccess { slug: None, ok: false, permission: None, message: Some(if remote.is_some() { "O remote origin não é do GitHub.".into() } else { "O repositório não tem remote origin.".into() }) };
    };
    let o = crate::shell::command("gh").args(["repo", "view", &slug, "--json", "viewerPermission", "-q", ".viewerPermission"]).output();
    match o {
        Ok(o) if o.status.success() => {
            let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let ok = matches!(p.as_str(), "ADMIN" | "MAINTAIN" | "WRITE");
            RepoAccess { message: (!ok).then(|| format!("Sua conta tem só {p} em {slug}: dá para ler, mas não para fazer push/PR.")), slug: Some(slug), ok, permission: Some(p) }
        }
        Ok(o) => RepoAccess { message: Some(format!("Missing GitHub access: a conta ativa não acessa {slug} ({}).", String::from_utf8_lossy(&o.stderr).trim())), slug: Some(slug), ok: false, permission: None },
        Err(e) => RepoAccess { message: Some(format!("gh indisponível: {e}")), slug: Some(slug), ok: false, permission: None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_e_slug() {
        let a = parse_status(r#"{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"dev","tokenSource":"keyring","scopes":"gist, read:org, repo, workflow","gitProtocol":"https"}]}}"#);
        assert_eq!((a[0].login.as_str(), a[0].active, a[0].scopes.len()), ("dev", true, 4));
        assert_eq!(slug_from_remote("https://github.com/dev/kabul.git").as_deref(), Some("dev/kabul"));
        assert_eq!(slug_from_remote("git@github.com:org/app.git").as_deref(), Some("org/app"));
        assert_eq!(slug_from_remote("https://gitlab.com/x/y"), None);
    }
}
