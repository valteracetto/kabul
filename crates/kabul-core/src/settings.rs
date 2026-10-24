//! Settings em camadas (da maior para a menor precedência):
//! `~/.kabul/settings.managed.toml` > `<repo>/.kabul/settings.local.toml` >
//! `<repo>/.kabul/settings.toml` (lido da branch padrão no remoto, com fallback no disco) >
//! `~/.kabul/settings.toml` > padrões. Para compatibilidade, `.conductor/` é lido quando `.kabul/` não existe.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RunScript {
    pub command: String,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub available_in: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Scripts {
    pub setup: Option<String>,
    pub archive: Option<String>,
    /// `concurrent` (padrão) ou `nonconcurrent`.
    pub run_mode: Option<String>,
    #[serde(default)]
    pub run: BTreeMap<String, RunScript>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(default)]
    pub scripts: Scripts,
    /// Arquivos ignorados pelo git a copiar para o worktree novo (além de `.worktreeinclude` e `.env*`).
    #[serde(default)]
    pub file_include_globs: Vec<String>,
    /// Branch alvo dos PRs/diff (padrão: branch padrão do repo).
    pub target_branch: Option<String>,
    /// Variáveis de ambiente do repo (scripts e agentes); a camada local sobrescreve a compartilhada.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Instruções extras por ação (Configurações › Actions).
    #[serde(default)]
    pub prompts: Prompts,
    /// URL de preview; aceita `$CONDUCTOR_PORT`/`$KABUL_PORT` e `$((CONDUCTOR_PORT+N))`.
    #[serde(default)]
    pub preview_url: Option<String>,
}

/// Prompts personalizáveis por ação (vazio = o padrão do Kabul).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Prompts {
    pub general: Option<String>,
    pub review: Option<String>,
    pub create_pr: Option<String>,
    pub fix_errors: Option<String>,
    pub resolve_conflicts: Option<String>,
    pub branch_rename: Option<String>,
}

impl Prompts {
    fn merge(lo: Prompts, hi: Prompts) -> Prompts {
        Prompts {
            general: hi.general.or(lo.general),
            review: hi.review.or(lo.review),
            create_pr: hi.create_pr.or(lo.create_pr),
            fix_errors: hi.fix_errors.or(lo.fix_errors),
            resolve_conflicts: hi.resolve_conflicts.or(lo.resolve_conflicts),
            branch_rename: hi.branch_rename.or(lo.branch_rename),
        }
    }
}

/// Troca `$CONDUCTOR_PORT`, `$KABUL_PORT` e `$((CONDUCTOR_PORT+N))` pela porta do workspace.
pub fn expand_port(url: &str, port: u16) -> String {
    let mut out = url.to_string();
    for var in ["CONDUCTOR_PORT", "KABUL_PORT"] {
        while let Some(i) = out.find(&format!("$(({var}+")) {
            let rest = &out[i + var.len() + 4..];
            let Some(end) = rest.find("))") else { break };
            let n: u16 = rest[..end].trim().parse().unwrap_or(0);
            out = format!("{}{}{}", &out[..i], port + n, &rest[end + 2..]);
        }
        out = out.replace(&format!("${{{var}}}"), &port.to_string()).replace(&format!("${var}"), &port.to_string());
    }
    out
}

/// `KEY=VALUE` por linha (aceita `export`, aspas e comentários), como num .env.
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let (k, v) = l.trim_start_matches("export ").split_once('=')?;
            let k = k.trim();
            let ok = !k.is_empty() && !k.starts_with(|c: char| c.is_ascii_digit()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|x| x.strip_suffix('"')).or_else(|| v.strip_prefix('\'').and_then(|x| x.strip_suffix('\''))).unwrap_or(v);
            ok.then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Layer {
    pub name: String,
    pub path: String,
    pub found: bool,
}

/// Junta `hi` sobre `lo` (campos de `hi` vencem; scripts run por id).
pub fn merge(lo: Settings, hi: Settings) -> Settings {
    let mut run = lo.scripts.run;
    run.extend(hi.scripts.run);
    Settings {
        scripts: Scripts { setup: hi.scripts.setup.or(lo.scripts.setup), archive: hi.scripts.archive.or(lo.scripts.archive), run_mode: hi.scripts.run_mode.or(lo.scripts.run_mode), run },
        file_include_globs: if hi.file_include_globs.is_empty() { lo.file_include_globs } else { hi.file_include_globs },
        target_branch: hi.target_branch.or(lo.target_branch),
        env: { let mut e = lo.env; e.extend(hi.env); e },
        prompts: Prompts::merge(lo.prompts, hi.prompts),
        preview_url: hi.preview_url.or(lo.preview_url),
    }
}

/// Cada camada lida (nome, settings) — para mostrar herança no ambiente por escopo.
pub fn load_layers(repo: &Path, default_branch: &str) -> Vec<(String, Settings)> {
    let d = dir_for(repo);
    let shared = Command::new("git").arg("-C").arg(repo).args(["show", &format!("origin/{default_branch}:{d}/settings.toml")]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).or_else(|| std::fs::read_to_string(repo.join(format!("{d}/settings.toml"))).ok());
    let local = std::fs::read_to_string(repo.join(format!("{d}/settings.local.toml"))).ok();
    [("repo", shared), ("repo local", local)].into_iter().map(|(n, t)| (n.to_string(), t.and_then(|t| toml::from_str(&t).ok()).unwrap_or_default())).collect()
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn dir_for(repo: &Path) -> &'static str {
    if repo.join(".kabul").is_dir() || !repo.join(".conductor").is_dir() { ".kabul" } else { ".conductor" }
}

/// Lê as camadas e devolve settings efetivos + quais arquivos foram encontrados.
pub fn load(repo: &Path, default_branch: &str) -> (Settings, Vec<Layer>) {
    let d = dir_for(repo);
    let shared_rel = format!("{d}/settings.toml");
    let remote = Command::new("git").arg("-C").arg(repo).args(["show", &format!("origin/{default_branch}:{shared_rel}")]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).into_owned());
    let layers: Vec<(String, PathBuf, Option<String>)> = vec![
        ("usuário".into(), home().join(".kabul/settings.toml"), None),
        (if remote.is_some() { format!("repo (origin/{default_branch})") } else { "repo".into() }, repo.join(&shared_rel), remote),
        ("repo local".into(), repo.join(format!("{d}/settings.local.toml")), None),
        ("gerenciado".into(), home().join(".kabul/settings.managed.toml"), None),
    ];
    let mut s = Settings::default();
    let mut info = vec![];
    for (name, path, content) in layers {
        let text = content.or_else(|| std::fs::read_to_string(&path).ok());
        info.push(Layer { name, path: path.display().to_string(), found: text.is_some() });
        if let Some(t) = text {
            if let Ok(layer) = toml::from_str::<Settings>(&t) {
                s = merge(s, layer);
            }
        }
    }
    (s, info)
}

/// Grava `settings.local.toml` (não versionado) do repo.
pub fn save_local(repo: &Path, s: &Settings) -> anyhow::Result<PathBuf> {
    let p = repo.join(format!("{}/settings.local.toml", dir_for(repo)));
    std::fs::create_dir_all(p.parent().unwrap())?;
    std::fs::write(&p, toml::to_string_pretty(s)?)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camadas() {
        let lo: Settings = toml::from_str("[scripts]\nsetup = \"npm i\"\n[scripts.run.web]\ncommand = \"npm run dev\"\ndefault = true\nicon = \"globe\"\n").unwrap();
        let hi: Settings = toml::from_str("[scripts]\nrun_mode = \"nonconcurrent\"\n[scripts.run.api]\ncommand = \"cargo run\"\n").unwrap();
        let m = merge(lo, hi);
        assert_eq!(m.scripts.setup.as_deref(), Some("npm i"));
        assert_eq!(m.scripts.run_mode.as_deref(), Some("nonconcurrent"));
        assert_eq!(m.scripts.run.len(), 2);
        assert!(m.scripts.run["web"].default);
        let tmp = std::env::temp_dir().join(format!("kabul-set-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join(".kabul")).unwrap();
        std::fs::write(tmp.join(".kabul/settings.toml"), "[scripts]\nsetup = \"a\"\n").unwrap();
        std::fs::write(tmp.join(".kabul/settings.local.toml"), "[scripts]\nsetup = \"b\"\n").unwrap();
        let (s, l) = load(&tmp, "main");
        assert_eq!(s.scripts.setup.as_deref(), Some("b"));
        assert!(l[1].found && l[2].found);
        std::fs::write(tmp.join(".kabul/settings.toml"), "[env]\nA = \"1\"\nB = \"2\"\n[prompts]\nreview = \"foco em segurança\"\n").unwrap();
        std::fs::write(tmp.join(".kabul/settings.local.toml"), "[env]\nB = \"local\"\n").unwrap();
        let (s, _) = load(&tmp, "main");
        assert_eq!((s.env["A"].as_str(), s.env["B"].as_str(), s.prompts.review.as_deref()), ("1", "local", Some("foco em segurança")));
        let ls = load_layers(&tmp, "main");
        assert_eq!((ls[0].1.env["B"].as_str(), ls[1].1.env["B"].as_str()), ("2", "local"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn porta_e_env() {
        assert_eq!(expand_port("http://localhost:$CONDUCTOR_PORT/x", 41000), "http://localhost:41000/x");
        assert_eq!(expand_port("http://localhost:$((CONDUCTOR_PORT+2))", 41000), "http://localhost:41002");
        assert_eq!(expand_port("http://127.0.0.1:${KABUL_PORT}", 41010), "http://127.0.0.1:41010");
        assert_eq!(parse_env("# x\nexport A=1\nB=\"dois\"\n1X=ruim\nC D=ruim\nE='tres'"), vec![("A".into(), "1".into()), ("B".into(), "dois".into()), ("E".into(), "tres".into())]);
        let s = AppSettings::default();
        assert_eq!((s.completion_sound.as_str(), s.merge_method.as_str(), s.scrollback_mb, s.rename_ws_on_branch), ("Glass", "squash", 10, true));
    }
}

/// Configurações do app (não do repo): JSON em `<estado>/app-settings.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    /// `github` (usuário do `gh`), `user` ($USER) ou `custom`.
    #[serde(default = "d_prefix_type")]
    pub branch_prefix_type: String,
    #[serde(default)]
    pub branch_prefix_custom: String,
    #[serde(default = "d_true")]
    pub notifications: bool,
    #[serde(default = "d_true")]
    pub sound: bool,
    /// Mantém o Mac acordado (`caffeinate`) enquanto há agente rodando.
    #[serde(default = "d_true")]
    pub caffeinate: bool,
    /// Renomeia a branch a partir da primeira mensagem.
    #[serde(default = "d_true")]
    pub auto_rename_branch: bool,
    /// Variáveis de ambiente: escopo `all` ou id do harness (`claude`, `codex`, `opencode`...).
    #[serde(default)]
    pub env: Vec<EnvVar>,
    /// Arquivo .env do usuário carregado antes das variáveis acima (opcional).
    #[serde(default)]
    pub env_file: Option<String>,

    // ---- General ----
    /// Som de conclusão: `none` ou o nome de um som do sistema (padrão `Glass`).
    #[serde(default = "d_sound")]
    pub completion_sound: String,
    /// Mostra o anel de contexto sempre (sem isso, só acima de 70%).
    #[serde(default)]
    pub always_show_context: bool,
    /// Texto colado acima de 5000 caracteres vira anexo.
    #[serde(default = "d_true")]
    pub auto_convert_long_text: bool,
    /// Filtra "You're absolutely right!" das respostas.
    #[serde(default)]
    pub not_absolutely_right: bool,

    // ---- Git ----
    /// Onde abrir PRs: `github` (padrão), `linear` ou `graphite`.
    #[serde(default = "d_github")]
    pub open_prs_in: String,
    #[serde(default)]
    pub delete_branch_on_archive: bool,
    #[serde(default)]
    pub archive_on_merge: bool,
    #[serde(default = "d_true")]
    pub rename_ws_on_branch: bool,
    /// `squash` (padrão), `merge` ou `rebase`.
    #[serde(default = "d_squash")]
    pub merge_method: String,
    /// Simula as ações do GitHub (push, merge, ready, re-run): mostra os comandos sem executar.
    #[serde(default)]
    pub github_dry_run: bool,

    // ---- Models ----
    /// Estilo de saída do Claude Code: default, Proactive, Concise, Explanatory, Learning.
    #[serde(default = "d_default")]
    pub claude_output_style: String,
    /// Personalidade do Codex: pragmatic (padrão), friendly, none.
    #[serde(default = "d_pragmatic")]
    pub codex_personality: String,
    /// Modelo usado pelo botão Revisar (chave do seletor); vazio = o da conversa.
    #[serde(default)]
    pub review_model: Option<String>,
    /// Conversas novas começam em plan mode.
    #[serde(default)]
    pub default_plan: bool,

    // ---- Advanced ----
    /// Executáveis dos agentes (vazio = o do PATH).
    #[serde(default)]
    pub claude_path: Option<String>,
    #[serde(default)]
    pub codex_path: Option<String>,
    #[serde(default)]
    pub opencode_path: Option<String>,
    /// Limite do scrollback do terminal, em MB (padrão 10).
    #[serde(default = "d_scrollback")]
    pub scrollback_mb: u32,
}

fn d_sound() -> String {
    "Glass".into()
}
fn d_github() -> String {
    "github".into()
}
fn d_squash() -> String {
    "squash".into()
}
fn d_default() -> String {
    "default".into()
}
fn d_pragmatic() -> String {
    "pragmatic".into()
}
fn d_scrollback() -> u32 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    #[serde(default = "d_all")]
    pub scope: String,
}

/// prefixo padrão = usuário do GitHub (cai para $USER sem `gh`).
fn d_prefix_type() -> String {
    "github".into()
}
fn d_true() -> bool {
    true
}
fn d_all() -> String {
    "all".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        serde_json::from_str("{}").unwrap()
    }
}

impl AppSettings {
    pub fn load(file: &Path) -> Self {
        std::fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn save(&self, file: &Path) -> anyhow::Result<()> {
        if let Some(d) = file.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(file, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
    pub fn env_for(&self, harness: &str) -> Vec<(String, String)> {
        let file = self.env_file.as_deref().filter(|f| !f.trim().is_empty()).and_then(|f| std::fs::read_to_string(f).ok()).map(|t| parse_env(&t)).unwrap_or_default();
        file.into_iter().chain(self.env.iter().filter(|e| e.scope == "all" || e.scope == harness).map(|e| (e.key.clone(), e.value.clone()))).collect()
    }
    /// Prefixo efetivo da branch.
    pub fn branch_prefix(&self) -> String {
        match self.branch_prefix_type.as_str() {
            "custom" if !self.branch_prefix_custom.trim().is_empty() => self.branch_prefix_custom.trim().trim_end_matches('/').to_string(),
            "none" => String::new(),
            "github" => Command::new("gh").args(["api", "user", "-q", ".login"]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(user),
            _ => user(),
        }
    }
}

fn user() -> String {
    std::env::var("KABUL_BRANCH_PREFIX").or_else(|_| std::env::var("USER")).unwrap_or_else(|_| "kabul".into())
}
