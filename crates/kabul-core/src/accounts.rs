//! Várias contas por provedor (ex.: duas contas Claude). Cada perfil tem um diretório de config isolado
//! em `<estado>/accounts/<provedor>/<id>` e o CLI roda com a variável de ambiente dele apontando para lá.
//! O perfil sem diretório é a conta "padrão do sistema" (a config normal do CLI).
use crate::harness::HarnessKind;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccountProfile {
    pub id: String,
    /// claude | codex | agy | opencode | qwen | gemini | gh
    pub provider: String,
    pub nickname: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
    /// `None` = configuração normal do CLI (padrão do sistema).
    #[serde(default)]
    pub dir: Option<PathBuf>,
    #[serde(default)]
    pub default: bool,
}

/// Variável que isola a config de cada CLI, e se ela está confirmada nesta versão.
pub fn isolation(provider: &str) -> Option<(&'static str, bool)> {
    match provider {
        "claude" => Some(("CLAUDE_CONFIG_DIR", true)),
        "codex" => Some(("CODEX_HOME", true)),
        "gh" => Some(("GH_CONFIG_DIR", true)),
        // Achada nas strings do binário do agy; a confirmar.
        "agy" => Some(("ANTIGRAVITY_GEMINI_DIR", false)),
        // XDG_DATA_HOME guarda o auth.json do OpenCode; a confirmar.
        "opencode" => Some(("XDG_DATA_HOME", false)),
        // Qwen Code e Gemini CLI leem de ~/.qwen e ~/.gemini: isolar o HOME; a confirmar.
        "qwen" | "gemini" => Some(("HOME", false)),
        _ => None,
    }
}

pub fn provider_of(k: HarnessKind) -> &'static str {
    match k {
        HarnessKind::Claude => "claude",
        HarnessKind::Codex => "codex",
        HarnessKind::Antigravity => "agy",
        HarnessKind::OpenCode => "opencode",
        HarnessKind::QwenCode => "qwen",
        HarnessKind::GeminiCli => "gemini",
    }
}

/// Variáveis para rodar o CLI com este perfil.
pub fn env_for(p: &AccountProfile) -> Vec<(String, String)> {
    match (&p.dir, isolation(&p.provider)) {
        (Some(d), Some((var, _))) => vec![(var.to_string(), d.display().to_string())],
        _ => vec![],
    }
}

pub struct Accounts {
    file: PathBuf,
    root: PathBuf,
    pub list: Vec<AccountProfile>,
}

impl Accounts {
    pub fn open(home: &Path) -> Self {
        let file = home.join("accounts.json");
        let list = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Self { file, root: home.join("accounts"), list }
    }

    fn save(&self) -> Result<()> {
        if let Some(d) = self.file.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&self.file, serde_json::to_vec_pretty(&self.list)?).context("salvando contas")
    }

    /// Perfis do provedor, com o "padrão do sistema" sempre primeiro.
    pub fn of(&self, provider: &str) -> Vec<AccountProfile> {
        let mut v = vec![AccountProfile { id: format!("{provider}:sistema"), provider: provider.into(), nickname: "Padrão do sistema".into(), email: None, plan: None, dir: None, default: !self.list.iter().any(|p| p.provider == provider && p.default) }];
        v.extend(self.list.iter().filter(|p| p.provider == provider).cloned());
        v
    }

    pub fn get(&self, id: &str) -> Option<AccountProfile> {
        let provider = id.split(':').next()?;
        self.of(provider).into_iter().find(|p| p.id == id)
    }

    pub fn default_for(&self, provider: &str) -> AccountProfile {
        self.of(provider).into_iter().find(|p| p.default).unwrap()
    }

    pub fn add(&mut self, provider: &str, nickname: &str) -> Result<AccountProfile> {
        isolation(provider).context("provedor sem isolamento de conta")?;
        let id = format!("{provider}:{}", crate::store::id());
        let dir = self.root.join(provider).join(id.split(':').nth(1).unwrap());
        std::fs::create_dir_all(&dir)?;
        let p = AccountProfile { id, provider: provider.into(), nickname: nickname.trim().into(), email: None, plan: None, dir: Some(dir), default: false };
        self.list.push(p.clone());
        self.save()?;
        Ok(p)
    }

    pub fn rename(&mut self, id: &str, nickname: &str) -> Result<()> {
        self.list.iter_mut().find(|p| p.id == id).context("conta não encontrada")?.nickname = nickname.trim().into();
        self.save()
    }

    /// Remove o perfil e o diretório isolado dele (as credenciais daquela conta somem do Kabul).
    pub fn remove(&mut self, id: &str) -> Result<()> {
        if let Some(p) = self.list.iter().find(|p| p.id == id) {
            if let Some(d) = &p.dir {
                if d.starts_with(&self.root) {
                    let _ = std::fs::remove_dir_all(d);
                }
            }
        }
        self.list.retain(|p| p.id != id);
        self.save()
    }

    pub fn set_default(&mut self, id: &str) -> Result<()> {
        let provider = id.split(':').next().unwrap_or("").to_string();
        for p in self.list.iter_mut().filter(|p| p.provider == provider) {
            p.default = p.id == id;
        }
        self.save()
    }

    pub fn set_identity(&mut self, id: &str, email: Option<String>, plan: Option<String>) -> Result<()> {
        if let Some(p) = self.list.iter_mut().find(|p| p.id == id) {
            p.email = email.or(p.email.take());
            p.plan = plan.or(p.plan.take());
        }
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perfis_isolados() {
        let home = std::env::temp_dir().join(format!("kabul-acc-{}", std::process::id()));
        let mut a = Accounts::open(&home);
        assert_eq!(a.of("claude").len(), 1, "só o padrão do sistema");
        let p = a.add("claude", "Trabalho").unwrap();
        assert!(p.dir.as_ref().unwrap().is_dir());
        assert_eq!(env_for(&p), vec![("CLAUDE_CONFIG_DIR".to_string(), p.dir.as_ref().unwrap().display().to_string())]);
        assert!(a.default_for("claude").dir.is_none());
        a.set_default(&p.id).unwrap();
        assert_eq!(Accounts::open(&home).default_for("claude").nickname, "Trabalho");
        a.rename(&p.id, "Cliente").unwrap();
        assert_eq!(a.get(&p.id).unwrap().nickname, "Cliente");
        assert!(env_for(&a.default_for("codex")).is_empty());
        let dir = p.dir.clone().unwrap();
        a.remove(&p.id).unwrap();
        assert!(!dir.exists());
        assert!(a.add("desconhecido", "x").is_err());
        std::fs::remove_dir_all(&home).ok();
    }
}

/// O perfil está logado? (sem ler tokens: comando de status ou existência do arquivo de credenciais).
pub fn logged_in(p: &AccountProfile) -> Option<bool> {
    let env = env_for(p);
    let dir = p.dir.clone();
    match p.provider.as_str() {
        "claude" => {
            let o = crate::harness::CmdSpec::new("claude", ["auth", "status", "--json"]).with_env(&env).command().output().ok()?;
            crate::auth::parse_claude_status(&String::from_utf8_lossy(&o.stdout)).map(|s| s.logged_in)
        }
        "codex" => Some(dir.map(|d| d.join("auth.json")).unwrap_or_else(crate::auth::codex_auth_path).is_file()),
        "agy" => Some(dir.map(|d| d.join("antigravity-cli/antigravity-oauth-token")).unwrap_or_else(crate::auth::agy_token_path).is_file()),
        "gh" => {
            let o = crate::harness::CmdSpec::new("gh", ["auth", "status", "--json", "hosts"]).with_env(&env).command().output().ok()?;
            Some(crate::github::parse_status(&String::from_utf8_lossy(&o.stdout)).iter().any(|a| a.active && a.ok))
        }
        _ => None,
    }
}

/// Comando de login do CLI para o perfil (e o que digitar logo após iniciar).
pub fn login_argv(provider: &str) -> Option<(Vec<&'static str>, &'static [u8])> {
    Some(match provider {
        "gh" => (vec!["gh", "auth", "login", "--web", "-h", "github.com", "-p", "https", "--skip-ssh-key"], b"\n"),
        p => (crate::auth::login_command(HarnessKind::parse(if p == "agy" { "agy" } else { p })?), b""),
    })
}
