//! Limites da assinatura do Claude (Pro/Max/Team) lidos direto da Anthropic, sem depender do CodexBar.
//!
//! Usa o login que o próprio Claude Code já guarda: no macOS, o item do Keychain do Claude Code (serviço
//! `Claude Code-credentials`, conta = usuário; com `CLAUDE_CONFIG_DIR` o serviço ganha o sufixo
//! `-<8 primeiros hex do sha256 do diretório>`); no Linux/Windows (ou sem item no Keychain), o arquivo
//! `.credentials.json` da pasta de config. Consulta `GET https://api.anthropic.com/api/oauth/usage`
//! (cabeçalho `anthropic-beta: oauth-2025-04-20`), que devolve as janelas de 5 h, semana, semana por
//! modelo e o uso extra.
//!
//! Regras: o token é lido sob demanda a cada consulta, fica só na memória durante a chamada e nunca é
//! gravado, logado nem devolvido em erro. Token vencido ou 401 viram "entre de novo no Claude Code": o
//! Kabul não tenta renovar o login (quem renova é o Claude Code quando roda).
//!
//! O endpoint e o formato da resposta foram conferidos no código do CodexBar (MIT,
//! github.com/steipete/CodexBar) e numa chamada real; a implementação aqui é própria.
use super::limits::{window_name, Limit};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const BETA: &str = "oauth-2025-04-20";
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

/// Por que não deu para ler os limites de uma conta. `code()` vai para a interface (texto no idioma dela).
#[derive(Debug, Clone, PartialEq)]
pub enum ClaudeError {
    /// Nenhuma credencial do Claude Code para esta conta.
    NoLogin,
    /// O token guardado venceu (o Claude Code renova quando roda).
    Expired,
    /// A Anthropic recusou o token (401/403).
    Unauthorized,
    /// Muitas consultas: tentar de novo depois deste instante (segundos Unix).
    RateLimited(u64),
    Network(String),
    Other(String),
}

impl ClaudeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoLogin => "no_login",
            Self::Expired => "expired",
            Self::Unauthorized => "unauthorized",
            Self::RateLimited(_) => "rate_limited",
            Self::Network(_) => "network",
            Self::Other(_) => "error",
        }
    }
    /// Texto em português (a interface traduz pelo `code`).
    pub fn text(&self) -> String {
        match self {
            Self::NoLogin => "sem login do Claude Code nesta conta: entre no Claude Code (rode `claude`)".into(),
            Self::Expired => "o login do Claude Code venceu: entre de novo no Claude Code (rode `claude`)".into(),
            Self::Unauthorized => "a Anthropic recusou o login: entre de novo no Claude Code (rode `claude`)".into(),
            Self::RateLimited(_) => "a Anthropic limitou as consultas de uso; tento de novo em alguns minutos".into(),
            Self::Network(e) => format!("sem conexão com a Anthropic: {e}"),
            Self::Other(e) => e.clone(),
        }
    }
}

/// Credencial lida do Claude Code. O `Debug` esconde o token.
pub struct Credential {
    token: String,
    /// Milissegundos Unix (como o Claude Code grava).
    pub expires_at_ms: Option<u64>,
    pub subscription: Option<String>,
    pub tier: Option<String>,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credential").field("token", &"<oculto>").field("expires_at_ms", &self.expires_at_ms).field("subscription", &self.subscription).field("tier", &self.tier).finish()
    }
}

impl Credential {
    pub fn expired(&self, now: u64) -> bool {
        self.expires_at_ms.is_some_and(|ms| ms / 1000 <= now)
    }
    /// Plano legível: "Max 20x", "Max 5x", "Pro", "Team"…
    pub fn plan(&self) -> Option<String> {
        let sub = self.subscription.as_deref()?;
        let mut p = sub[..1].to_uppercase() + &sub[1..];
        if let Some(x) = self.tier.as_deref().and_then(|t| ["20x", "5x"].into_iter().find(|x| t.ends_with(x))) {
            p = format!("{p} {x}");
        }
        Some(p)
    }
}

/// Lê a credencial do JSON que o Claude Code guarda (`{"claudeAiOauth": {...}}`).
pub fn parse_credential(json: &str) -> Option<Credential> {
    let v: Value = serde_json::from_str(json).ok()?;
    let o = v.get("claudeAiOauth")?;
    let token = o.get("accessToken").and_then(Value::as_str).filter(|t| !t.trim().is_empty())?.trim().to_string();
    let s = |k: &str| o.get(k).and_then(Value::as_str).map(String::from);
    Some(Credential { token, expires_at_ms: o.get("expiresAt").and_then(Value::as_u64), subscription: s("subscriptionType"), tier: s("rateLimitTier") })
}

/// Nome do item no Keychain do macOS para a pasta de config (`None` = a padrão, sem `CLAUDE_CONFIG_DIR`).
pub fn keychain_service(config_dir: Option<&Path>) -> String {
    match config_dir {
        None => KEYCHAIN_SERVICE.into(),
        Some(d) => format!("{KEYCHAIN_SERVICE}-{}", &crate::usage::sha256_hex(d.display().to_string().as_bytes())[..8]),
    }
}

/// Conta do item no Keychain: o usuário do sistema (o Claude Code usa um nome fixo se ele tiver caractere estranho).
fn keychain_account() -> String {
    let u = std::env::var("USER").unwrap_or_default();
    if !u.is_empty() && u.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        u
    } else {
        "claude-code-user".into()
    }
}

/// `.credentials.json` da pasta de config (a padrão é `~/.claude`).
pub fn credentials_file(config_dir: Option<&Path>) -> PathBuf {
    config_dir.map(Path::to_path_buf).unwrap_or_else(|| crate::paths::home().join(".claude")).join(".credentials.json")
}

#[cfg(target_os = "macos")]
fn read_keychain(service: &str) -> Option<String> {
    use std::process::{Command, Stdio};
    let run = |with_account: bool| {
        let mut c = Command::new("/usr/bin/security");
        c.args(["find-generic-password", "-s", service]);
        if with_account {
            c.args(["-a", &keychain_account()]);
        }
        let o = c.arg("-w").stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
    };
    run(true).or_else(|| run(false))
}

#[cfg(not(target_os = "macos"))]
fn read_keychain(_service: &str) -> Option<String> {
    None
}

/// Lê a credencial da conta (Keychain no macOS; depois o arquivo). `config_dir` = `CLAUDE_CONFIG_DIR` do perfil.
pub fn read_credential(config_dir: Option<&Path>) -> Result<Credential, ClaudeError> {
    let from_keychain = if cfg!(target_os = "macos") { read_keychain(&keychain_service(config_dir)) } else { None };
    let raw = from_keychain.or_else(|| std::fs::read_to_string(credentials_file(config_dir)).ok()).ok_or(ClaudeError::NoLogin)?;
    parse_credential(&raw).ok_or(ClaudeError::NoLogin)
}

/// Uma chamada ao endpoint de uso. Devolve o JSON; erros sem corpo nem token.
pub fn fetch_usage(cred: &Credential) -> Result<Value, ClaudeError> {
    let ua = format!("kabul/{}", env!("CARGO_PKG_VERSION"));
    let res = ureq::get(USAGE_URL).timeout(Duration::from_secs(20)).set("Authorization", &format!("Bearer {}", cred.token)).set("anthropic-beta", BETA).set("Accept", "application/json").set("User-Agent", &ua).call();
    match res {
        Ok(r) => r.into_string().ok().and_then(|t| serde_json::from_str(&t).ok()).ok_or_else(|| ClaudeError::Other("resposta inválida da Anthropic".into())),
        Err(ureq::Error::Status(401 | 403, _)) => Err(ClaudeError::Unauthorized),
        Err(ureq::Error::Status(429, r)) => {
            let wait = r.header("retry-after").and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(600).clamp(60, 6 * 3600);
            Err(ClaudeError::RateLimited(crate::store::now() + wait))
        }
        Err(ureq::Error::Status(code, _)) => Err(ClaudeError::Other(format!("a Anthropic respondeu HTTP {code}"))),
        Err(ureq::Error::Transport(t)) => Err(ClaudeError::Network(t.kind().to_string())),
    }
}

fn iso(s: Option<&str>) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(s?).ok().map(|d| d.timestamp().max(0) as u64)
}

/// Resposta do endpoint → janelas. `utilization` vem em % (0–100). Campos desconhecidos são ignorados.
pub fn parse_usage(v: &Value, account: Option<String>, label: Option<String>, plan: Option<String>, now: u64) -> Vec<Limit> {
    let mk = |window: String, title: String, mins: Option<u64>, pct: f64, resets_at: Option<u64>| Limit {
        provider: "claude".into(),
        account: account.clone(),
        account_label: label.clone(),
        plan: plan.clone(),
        window,
        title,
        used_pct: pct,
        window_mins: mins,
        resets_at,
        source: "claude-oauth".into(),
        updated_at: now,
    };
    let mut out = vec![];
    let fixed = [("five_hour", Some(300), None), ("seven_day", Some(10_080), None), ("seven_day_opus", Some(10_080), Some("Opus")), ("seven_day_sonnet", Some(10_080), Some("Sonnet"))];
    for (key, mins, model) in fixed {
        let Some(w) = v.get(key).filter(|w| w.is_object()) else { continue };
        let Some(pct) = w.get("utilization").and_then(Value::as_f64) else { continue };
        let (id, title) = match model {
            Some(m) => (key.to_string(), format!("Semana ({m})")),
            None => window_name(mins, key),
        };
        out.push(mk(id, title, mins, pct, iso(w.get("resets_at").and_then(Value::as_str))));
    }
    // Formato novo: lista `limits` com as semanas por modelo (`scope.model.display_name`).
    for l in v.get("limits").and_then(Value::as_array).into_iter().flatten() {
        if l.get("kind").and_then(Value::as_str) != Some("weekly_scoped") {
            continue;
        }
        let (Some(name), Some(pct)) = (l.pointer("/scope/model/display_name").and_then(Value::as_str), l.get("percent").and_then(Value::as_f64)) else { continue };
        let id = format!("seven_day_{}", name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect::<String>());
        if out.iter().any(|x| x.window == id) {
            continue;
        }
        out.push(mk(id, format!("Semana ({name})"), Some(10_080), pct, iso(l.get("resets_at").and_then(Value::as_str))));
    }
    // Uso extra (créditos além do plano), só quando ligado.
    let ex = &v["extra_usage"];
    if ex.get("is_enabled").and_then(Value::as_bool) == Some(true) {
        if let Some(pct) = ex.get("utilization").and_then(Value::as_f64) {
            out.push(mk("extra".into(), "Uso extra".into(), None, pct, None));
        }
    }
    out
}

/// Consultas recusadas por excesso (429): não insiste até o instante guardado, por conta.
static BACKOFF: std::sync::Mutex<Vec<(String, u64)>> = std::sync::Mutex::new(Vec::new());

/// Lê os limites de um perfil do Claude do Kabul (credencial sob demanda, uma chamada).
pub fn probe(p: &crate::accounts::AccountProfile) -> Result<Vec<Limit>, ClaudeError> {
    let now = crate::store::now();
    if let Some(until) = BACKOFF.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|(id, _)| *id == p.id).map(|x| x.1).filter(|u| *u > now) {
        return Err(ClaudeError::RateLimited(until));
    }
    let cred = read_credential(p.dir.as_deref())?;
    if cred.expired(now) {
        return Err(ClaudeError::Expired);
    }
    let res = fetch_usage(&cred);
    let mut b = BACKOFF.lock().unwrap_or_else(|e| e.into_inner());
    b.retain(|(id, _)| *id != p.id);
    if let Err(ClaudeError::RateLimited(until)) = &res {
        b.push((p.id.clone(), *until));
    }
    drop(b);
    let v = res?;
    let label = p.email.clone().or(Some(p.nickname.clone()));
    Ok(parse_usage(&v, Some(p.id.clone()), label, cred.plan(), now))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Resposta real do endpoint com os números trocados e sem nenhum dado da conta.
    const FIXTURE: &str = include_str!("fixtures/claude-oauth-usage.json");

    #[test]
    fn le_a_resposta_do_endpoint() {
        let v: Value = serde_json::from_str(FIXTURE).unwrap();
        let l = parse_usage(&v, Some("claude:sistema".into()), Some("Padrão do sistema".into()), Some("Max 20x".into()), 1_000);
        let w = |id: &str| l.iter().find(|x| x.window == id).unwrap_or_else(|| panic!("sem {id}: {l:?}"));
        assert_eq!((w("5h").used_pct, w("5h").title.as_str(), w("5h").window_mins), (37.0, "Sessão (5 h)", Some(300)));
        assert_eq!(w("5h").resets_at, Some(1_792_940_399));
        assert_eq!((w("semana").used_pct, w("semana").title.as_str()), (52.0, "Semana"));
        assert_eq!((w("seven_day_opus").used_pct, w("seven_day_opus").title.as_str()), (12.5, "Semana (Opus)"));
        // Semana por modelo do formato novo (lista `limits`).
        assert_eq!((w("seven_day_fable").used_pct, w("seven_day_fable").title.as_str()), (4.0, "Semana (Fable)"));
        // Uso extra ligado vira uma janela; campos desconhecidos (codinomes) são ignorados.
        assert_eq!((w("extra").used_pct, w("extra").title.as_str()), (10.0, "Uso extra"));
        assert_eq!(l.len(), 5);
        assert!(l.iter().all(|x| x.source == "claude-oauth" && x.account.as_deref() == Some("claude:sistema") && x.plan.as_deref() == Some("Max 20x")));
        // Uso extra desligado: não aparece.
        let mut v2 = v.clone();
        v2["extra_usage"]["is_enabled"] = Value::Bool(false);
        assert!(parse_usage(&v2, None, None, None, 0).iter().all(|x| x.window != "extra"));
        // Resposta vazia/estranha: nada (sem pânico).
        assert!(parse_usage(&serde_json::json!({"five_hour": null, "limits": "x"}), None, None, None, 0).is_empty());
    }

    #[test]
    fn credencial_sem_vazar_o_token() {
        let c = parse_credential(r#"{"mcpOAuth": {}, "claudeAiOauth": {"accessToken": "tok-de-teste", "refreshToken": "r", "expiresAt": 2000000, "scopes": ["user:profile"], "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x"}}"#)
            .unwrap();
        assert_eq!(c.plan().as_deref(), Some("Max 20x"));
        assert!(c.expired(2_000) && !c.expired(1_999));
        assert!(!format!("{c:?}").contains("tok-de-teste"), "Debug não mostra o token");
        assert!(parse_credential(r#"{"claudeAiOauth": {"accessToken": " "}}"#).is_none());
        assert!(parse_credential("não é json").is_none());
        let pro = parse_credential(r#"{"claudeAiOauth": {"accessToken": "x", "subscriptionType": "pro"}}"#).unwrap();
        assert_eq!((pro.plan().as_deref(), pro.expired(u64::MAX)), (Some("Pro"), false));
    }

    #[test]
    fn item_do_keychain_por_pasta_de_config() {
        assert_eq!(keychain_service(None), "Claude Code-credentials");
        // sha256("/tmp/perfil") = 3c2a2d5b…: o Claude Code usa os 8 primeiros hex.
        let s = keychain_service(Some(Path::new("/tmp/perfil")));
        assert_eq!(s, format!("Claude Code-credentials-{}", &crate::usage::sha256_hex(b"/tmp/perfil")[..8]));
        assert_eq!(s.len(), "Claude Code-credentials-".len() + 8);
        assert_eq!(credentials_file(Some(Path::new("/x/y"))), PathBuf::from("/x/y/.credentials.json"));
    }

    /// Manual (`cargo test -p kabul-core claude_oauth -- --ignored`): lê a credencial real da conta padrão
    /// sem chamar a rede e sem imprimir nada dela além do plano e de quanto falta para vencer.
    #[test]
    #[ignore]
    fn credencial_real_da_conta_padrao() {
        let c = read_credential(None).expect("sem login do Claude Code nesta máquina");
        let mins = c.expires_at_ms.map(|ms| (ms / 1000) as i64 - crate::store::now() as i64).map(|s| s / 60);
        println!("plano: {:?}; vence em (min): {mins:?}", c.plan());
        assert!(c.plan().is_some());
    }

    #[test]
    fn perfil_isolado_le_o_arquivo_da_pasta_dele() {
        let d = std::env::temp_dir().join(format!("kabul-claude-cred-{}", crate::store::id()));
        std::fs::create_dir_all(&d).unwrap();
        // Sem credencial: "sem login".
        assert_eq!(read_credential(Some(&d)).unwrap_err(), ClaudeError::NoLogin);
        std::fs::write(d.join(".credentials.json"), r#"{"claudeAiOauth": {"accessToken": "x", "expiresAt": 1000}}"#).unwrap();
        let c = read_credential(Some(&d)).unwrap();
        assert!(c.expired(5));
        let p = crate::accounts::AccountProfile { id: "claude:t".into(), provider: "claude".into(), nickname: "T".into(), email: None, plan: None, dir: Some(d.clone()), default: false };
        // Token vencido: não chama a rede e pede para entrar de novo.
        assert_eq!(probe(&p).unwrap_err(), ClaudeError::Expired);
        assert_eq!(ClaudeError::Expired.code(), "expired");
        assert!(ClaudeError::Unauthorized.text().contains("entre de novo no Claude Code"));
        let _ = std::fs::remove_dir_all(d);
    }
}
