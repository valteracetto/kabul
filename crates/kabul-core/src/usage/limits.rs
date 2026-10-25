//! Limites e janelas de reset por provedor/conta. Fontes:
//! - **stream do agente** (passivo, a cada turno): Claude `rate_limit_event` (`unifiedWindows`) e Codex
//!   `account/rateLimits/updated`;
//! - **app-server do Codex** (sob demanda): `account/rateLimits/read` + `account/read`, por perfil de conta;
//! - **CodexBar CLI** (opcional, quando instalado): `codexbar usage --format json --status`. O CodexBar é
//!   MIT (github.com/steipete/CodexBar); daqui só se lê a saída JSON dele, sem código portado.
//!
//! O resultado fica em `<estado>/usage-limits.json` (com `schema_version`).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

/// Uma janela de limite (sessão de 5 h, semana, mês, ou uma janela própria do provedor).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Limit {
    pub provider: String,
    /// Perfil de conta do Kabul, quando a fonte sabe qual é.
    #[serde(default)]
    pub account: Option<String>,
    /// Como mostrar a conta (e-mail/apelido) quando a fonte não sabe o perfil.
    #[serde(default)]
    pub account_label: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
    /// Id da janela: `5h`, `semana`, `mes` ou o id da fonte.
    pub window: String,
    pub title: String,
    pub used_pct: f64,
    #[serde(default)]
    pub window_mins: Option<u64>,
    /// Segundos Unix.
    #[serde(default)]
    pub resets_at: Option<u64>,
    pub source: String,
    pub updated_at: u64,
}

impl Limit {
    /// Ainda vale: sem reset conhecido (até 1 dia depois da leitura) ou reset no futuro.
    pub fn live(&self, now: u64) -> bool {
        match self.resets_at {
            Some(r) => r > now,
            None => now.saturating_sub(self.updated_at) < 86_400,
        }
    }
    fn key(&self) -> (String, String, String) {
        (self.provider.clone(), self.account.clone().or(self.account_label.clone()).unwrap_or_default(), self.window.clone())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProviderStatus {
    pub provider: String,
    /// none | minor | major | critical | maintenance
    pub indicator: String,
    pub description: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Credits {
    pub provider: String,
    #[serde(default)]
    pub account_label: Option<String>,
    pub remaining: f64,
}

/// Como foi cada fonte na última leitura.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SourceInfo {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct LimitsSnapshot {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub limits: Vec<Limit>,
    #[serde(default)]
    pub status: Vec<ProviderStatus>,
    #[serde(default)]
    pub credits: Vec<Credits>,
    #[serde(default)]
    pub sources: Vec<SourceInfo>,
    #[serde(default)]
    pub updated_at: u64,
}

impl LimitsSnapshot {
    /// Junta limites: a mesma janela da mesma conta fica com a leitura mais nova.
    pub fn merge(&mut self, new: Vec<Limit>) {
        for l in new {
            match self.limits.iter_mut().find(|x| x.key() == l.key()) {
                Some(x) if x.updated_at <= l.updated_at => *x = l,
                Some(_) => {}
                None => self.limits.push(l),
            }
        }
        let now = crate::store::now();
        // Janelas vencidas há mais de uma semana saem.
        self.limits.retain(|l| l.resets_at.map_or(now.saturating_sub(l.updated_at) < 7 * 86_400, |r| r + 7 * 86_400 > now));
        self.limits.sort_by(|a, b| a.provider.cmp(&b.provider).then(a.account_label.cmp(&b.account_label)).then(a.window_mins.unwrap_or(u64::MAX).cmp(&b.window_mins.unwrap_or(u64::MAX))));
    }
}

pub fn provider_label(p: &str) -> &str {
    match p {
        "claude" => "Claude",
        "codex" => "Codex",
        "agy" | "antigravity" => "Antigravity",
        "gemini" => "Gemini",
        "openrouter" => "OpenRouter",
        "opencode" => "OpenCode",
        "qwen" => "Qwen",
        "cursor" => "Cursor",
        "copilot" => "Copilot",
        "local" => "Local",
        other => other,
    }
}

/// Nome e título da janela pela duração.
pub fn window_name(mins: Option<u64>, fallback: &str) -> (String, String) {
    match mins {
        Some(300) => ("5h".into(), "Sessão (5 h)".into()),
        Some(10_080) => ("semana".into(), "Semana".into()),
        Some(m) if (40_000..=45_000).contains(&m) => ("mes".into(), "Mês".into()),
        Some(m) if m % 1440 == 0 => (format!("{}d", m / 1440), format!("{} dias", m / 1440)),
        Some(m) if m % 60 == 0 => (format!("{}h", m / 60), format!("{} h", m / 60)),
        Some(m) => (format!("{m}m"), format!("{m} min")),
        None => (fallback.into(), fallback.into()),
    }
}

fn file(home: &Path) -> std::path::PathBuf {
    home.join("usage-limits.json")
}

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn load(home: &Path) -> LimitsSnapshot {
    std::fs::read_to_string(file(home)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(home: &Path, s: &LimitsSnapshot) {
    let mut s = s.clone();
    s.schema_version = super::SCHEMA_VERSION;
    let _ = std::fs::create_dir_all(home);
    let tmp = file(home).with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_vec_pretty(&s).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, file(home));
    }
}

/// Limites vistos no stream de um agente (grava junto com os outros).
pub fn store_passive(home: &Path, l: Vec<Limit>) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = load(home);
    s.merge(l);
    save(home, &s);
}

// ---------------- parsers ----------------

/// `rate_limit_event` do Claude Code (stream-json). `utilization` vem em fração (0–1).
pub fn from_claude_event(v: &Value, account: Option<String>, label: Option<String>) -> Vec<Limit> {
    let info = &v["rate_limit_info"];
    let now = crate::store::now();
    let pct = |u: f64| if u <= 1.0 { u * 100.0 } else { u };
    let mk = |id: &str, mins: Option<u64>, title: Option<&str>, w: &Value| -> Option<Limit> {
        let used = w.get("utilization").and_then(Value::as_f64)?;
        let (window, t) = window_name(mins, id);
        Some(Limit {
            provider: "claude".into(),
            account: account.clone(),
            account_label: label.clone(),
            window,
            title: title.map(String::from).unwrap_or(t),
            used_pct: pct(used),
            window_mins: mins,
            resets_at: w.get("resetsAt").and_then(Value::as_u64),
            source: "claude-stream".into(),
            updated_at: now,
            ..Default::default()
        })
    };
    let mut out = vec![];
    if let Some(ws) = info.get("unifiedWindows").and_then(Value::as_object) {
        for (id, w) in ws {
            let (mins, title) = match id.as_str() {
                "five_hour" => (Some(300), None),
                "seven_day" => (Some(10_080), None),
                "seven_day_opus" => (Some(10_080), Some("Semana (Opus)")),
                "seven_day_sonnet" => (Some(10_080), Some("Semana (Sonnet)")),
                _ => (None, None),
            };
            let mut l = match mk(id, mins, title, w) {
                Some(l) => l,
                None => continue,
            };
            if title.is_some() || mins.is_none() {
                l.window = id.clone();
            }
            out.push(l);
        }
    }
    if out.is_empty() {
        let mins = match info.get("rateLimitType").and_then(Value::as_str) {
            Some("five_hour") => Some(300),
            Some(t) if t.starts_with("seven_day") => Some(10_080),
            _ => None,
        };
        out.extend(mk(info.get("rateLimitType").and_then(Value::as_str).unwrap_or("limite"), mins, None, info));
    }
    out
}

/// `rateLimits` do app-server do Codex (`account/rateLimits/read` ou `account/rateLimits/updated`).
pub fn from_codex_rate_limits(v: &Value, account: Option<String>, label: Option<String>, source: &str) -> Vec<Limit> {
    let rl = v.get("rateLimits").unwrap_or(v);
    let now = crate::store::now();
    let plan = rl.get("planType").and_then(Value::as_str).map(String::from);
    ["primary", "secondary"]
        .iter()
        .filter_map(|k| {
            let w = rl.get(*k).filter(|w| w.is_object())?;
            let mins = w.get("windowDurationMins").and_then(Value::as_u64);
            let (window, title) = window_name(mins, k);
            Some(Limit {
                provider: "codex".into(),
                account: account.clone(),
                account_label: label.clone(),
                plan: plan.clone(),
                window,
                title,
                used_pct: w.get("usedPercent").and_then(Value::as_f64)?,
                window_mins: mins,
                resets_at: w.get("resetsAt").and_then(Value::as_u64),
                source: source.into(),
                updated_at: now,
            })
        })
        .collect()
}

fn iso_secs(s: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp().max(0) as u64)
}

/// Provedores do CodexBar → provedor de conta do Kabul.
fn codexbar_provider(p: &str) -> String {
    match p {
        "antigravity" => "agy".into(),
        other => other.into(),
    }
}

/// Saída de `codexbar usage --format json [--status]`: lista com um item por provedor/conta.
/// Limites, status e créditos lidos de uma fonte.
pub type Reading = (Vec<Limit>, Vec<ProviderStatus>, Vec<Credits>);

pub fn from_codexbar(v: &Value, accounts: &[crate::accounts::AccountProfile]) -> Reading {
    let (mut lims, mut st, mut cr) = (vec![], vec![], vec![]);
    let now = crate::store::now();
    for it in v.as_array().into_iter().flatten() {
        let provider = codexbar_provider(it.get("provider").and_then(Value::as_str).unwrap_or_default());
        if provider.is_empty() {
            continue;
        }
        let u = &it["usage"];
        let email = u.get("accountEmail").or(u.pointer("/identity/accountEmail")).and_then(Value::as_str).map(String::from);
        // Perfil do Kabul só pelo mesmo e-mail (nunca por semelhança de nome).
        let account = email.as_deref().and_then(|e| accounts.iter().find(|a| a.provider == provider && a.email.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(e)))).map(|a| a.id.clone());
        let plan = u.get("loginMethod").and_then(Value::as_str).map(String::from);
        let updated = u.get("updatedAt").and_then(Value::as_str).and_then(iso_secs).unwrap_or(now);
        let mut push = |id: &str, title: Option<&str>, w: &Value| {
            let Some(used) = w.get("usedPercent").and_then(Value::as_f64) else { return };
            let mins = w.get("windowMinutes").and_then(Value::as_u64);
            let (window, t) = window_name(mins, id);
            lims.push(Limit {
                provider: provider.clone(),
                account: account.clone(),
                account_label: email.clone(),
                plan: plan.clone(),
                window: if title.is_some() { id.to_string() } else { window },
                title: title.map(String::from).unwrap_or(t),
                used_pct: used,
                window_mins: mins,
                resets_at: w.get("resetsAt").and_then(Value::as_str).and_then(iso_secs),
                source: "codexbar".into(),
                updated_at: updated,
            });
        };
        for k in ["primary", "secondary", "tertiary"] {
            if u.get(k).is_some_and(Value::is_object) {
                push(k, None, &u[k]);
            }
        }
        for x in u.get("extraRateWindows").and_then(Value::as_array).into_iter().flatten() {
            let id = x.get("id").and_then(Value::as_str).unwrap_or("extra");
            push(id, x.get("title").and_then(Value::as_str), &x["window"]);
        }
        if let Some(s) = it.get("status").filter(|s| s.is_object()) {
            st.push(ProviderStatus {
                provider: provider.clone(),
                indicator: s.get("indicator").and_then(Value::as_str).unwrap_or("none").into(),
                description: s.get("description").and_then(Value::as_str).unwrap_or_default().into(),
                url: s.get("url").and_then(Value::as_str).map(String::from),
            });
        }
        let c = &it["credits"];
        if c.get("balanceReadSucceeded").and_then(Value::as_bool) != Some(false) {
            if let Some(r) = c.get("remaining").and_then(Value::as_f64) {
                cr.push(Credits { provider: provider.clone(), account_label: email.clone(), remaining: r });
            }
        }
    }
    (lims, st, cr)
}

// ---------------- leitura ativa ----------------

/// Roda um programa com tempo máximo; devolve o stdout (ou `None` se falhar/estourar o tempo).
fn run_with_timeout(mut cmd: std::process::Command, timeout: Duration) -> Option<String> {
    use std::io::Read;
    let mut child = cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().ok()?;
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    reader.join().ok()
}

/// CodexBar instalado? (`codexbar` no PATH ou `KABUL_BIN_CODEXBAR`).
pub fn codexbar_bin() -> Option<std::path::PathBuf> {
    crate::harness::which("codexbar")
}

/// Lê o CodexBar (até 45 s: ele consulta as APIs dos provedores).
pub fn read_codexbar(accounts: &[crate::accounts::AccountProfile]) -> Result<Reading, String> {
    let bin = codexbar_bin().ok_or("CodexBar não instalado")?;
    let mut c = crate::shell::command(bin);
    c.args(["usage", "--format", "json", "--status", "--no-color"]);
    let out = run_with_timeout(c, Duration::from_secs(45)).ok_or("CodexBar não respondeu")?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|e| format!("saída do CodexBar inválida: {e}"))?;
    Ok(from_codexbar(&v, accounts))
}

/// Pergunta os limites ao app-server do Codex com a config do perfil. Linhas JSON-RPC por stdio.
pub fn probe_codex(p: &crate::accounts::AccountProfile) -> Result<Vec<Limit>, String> {
    use std::io::{BufRead, BufReader, Write};
    let bin = crate::harness::which("codex").ok_or("Codex não instalado")?;
    let mut cmd = crate::shell::command(bin);
    cmd.args(["app-server", "--listen", "stdio://"]).envs(crate::accounts::env_for(p)).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().ok_or("sem stdin")?;
    let stdout = child.stdout.take().ok_or("sem stdout")?;
    let (tx, rx) = std::sync::mpsc::channel::<Value>();
    std::thread::spawn(move || {
        for l in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&l) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
    });
    let msgs = [
        json!({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "kabul", "title": "Kabul", "version": env!("CARGO_PKG_VERSION")}}}),
        json!({"method": "initialized"}),
        json!({"id": 2, "method": "account/rateLimits/read"}),
        json!({"id": 3, "method": "account/read", "params": {"refreshToken": false}}),
    ];
    for m in msgs {
        let _ = writeln!(stdin, "{m}");
    }
    let _ = stdin.flush();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let (mut rl, mut acc) = (None, None);
    while (rl.is_none() || acc.is_none()) && std::time::Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(v) if v["id"] == 2 => rl = Some(v),
            Ok(v) if v["id"] == 3 => acc = Some(v),
            Ok(_) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    let rl = rl.ok_or("app-server do Codex não respondeu")?;
    if let Some(e) = rl.get("error") {
        return Err(e.get("message").and_then(Value::as_str).unwrap_or("erro").into());
    }
    let label = acc.as_ref().and_then(|a| a.pointer("/result/account/email")).and_then(Value::as_str).map(String::from).or(p.email.clone()).or(Some(p.nickname.clone()));
    Ok(from_codex_rate_limits(&rl["result"], Some(p.id.clone()), label, "codex-app-server"))
}

/// Atualiza tudo o que dá: app-server do Codex por perfil e CodexBar (se ligado e instalado).
/// Lento (segundos): chamar fora da thread de UI.
pub fn refresh(home: &Path, use_codexbar: bool) -> LimitsSnapshot {
    let accs = crate::accounts::Accounts::open(home);
    let mut fresh = vec![];
    let mut sources = vec![];
    if crate::harness::which("codex").is_some() {
        for p in accs.of("codex") {
            match probe_codex(&p) {
                Ok(l) => {
                    sources.push(SourceInfo { name: format!("Codex app-server · {}", p.nickname), ok: true, detail: format!("{} janela(s)", l.len()) });
                    fresh.extend(l);
                }
                Err(e) => sources.push(SourceInfo { name: format!("Codex app-server · {}", p.nickname), ok: false, detail: e }),
            }
        }
    }
    let (mut status, mut credits) = (None, None);
    if use_codexbar {
        let all: Vec<_> = ["claude", "codex", "agy", "gemini"].iter().flat_map(|p| accs.of(p)).collect();
        match read_codexbar(&all) {
            Ok((l, s, c)) => {
                sources.push(SourceInfo { name: "CodexBar".into(), ok: true, detail: format!("{} janela(s)", l.len()) });
                fresh.extend(l);
                (status, credits) = (Some(s), Some(c));
            }
            Err(e) => sources.push(SourceInfo { name: "CodexBar".into(), ok: false, detail: e }),
        }
    }
    sources.push(SourceInfo { name: "Stream dos agentes".into(), ok: true, detail: "Claude e Codex mandam os limites a cada turno".into() });
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut s = load(home);
    s.merge(fresh);
    if let Some(st) = status {
        s.status = st;
    }
    if let Some(c) = credits {
        s.credits = c;
    }
    s.sources = sources;
    s.updated_at = crate::store::now();
    save(home, &s);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_rate_limit_event() {
        let v = json!({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "rateLimitType": "five_hour", "utilization": 0.12, "resetsAt": 1_900_000_000u64,
            "unifiedWindows": {"five_hour": {"utilization": 0.12, "resetsAt": 1_900_000_000u64}, "seven_day": {"utilization": 0.5, "resetsAt": 1_900_100_000u64}, "seven_day_opus": {"utilization": 0.9, "resetsAt": 1_900_100_000u64}}}});
        let l = from_claude_event(&v, Some("claude:sistema".into()), None);
        assert_eq!(l.len(), 3);
        let five = l.iter().find(|x| x.window == "5h").unwrap();
        assert!((five.used_pct - 12.0).abs() < 1e-9);
        assert_eq!(five.title, "Sessão (5 h)");
        assert_eq!(l.iter().find(|x| x.window == "seven_day_opus").unwrap().title, "Semana (Opus)");
        // Sem janelas detalhadas: usa o topo.
        let v = json!({"type": "rate_limit_event", "rate_limit_info": {"rateLimitType": "seven_day", "utilization": 0.3, "resetsAt": 5}});
        let l = from_claude_event(&v, None, None);
        assert_eq!((l.len(), l[0].window.as_str()), (1, "semana"));
    }

    #[test]
    fn codex_rate_limits_read() {
        let v = json!({"rateLimits": {"limitId": "codex", "primary": {"usedPercent": 0, "windowDurationMins": 43200, "resetsAt": 1_795_473_440u64}, "secondary": null, "planType": "free"}});
        let l = from_codex_rate_limits(&v, Some("codex:sistema".into()), Some("conta".into()), "codex-app-server");
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].window.as_str(), l[0].title.as_str(), l[0].plan.as_deref(), l[0].resets_at), ("mes", "Mês", Some("free"), Some(1_795_473_440)));
    }

    #[test]
    fn codexbar_json() {
        let v = json!([
            {"provider": "claude", "source": "claude", "status": {"indicator": "none", "description": "All Systems Operational", "url": "https://status.example"},
             "usage": {"accountEmail": "dev@example.com", "updatedAt": "2026-10-25T02:08:57Z",
                "primary": {"usedPercent": 12, "windowMinutes": 300, "resetsAt": "2026-10-25T06:40:00Z"},
                "secondary": {"usedPercent": 50, "windowMinutes": 10080, "resetsAt": "2026-10-27T16:00:00Z"}, "tertiary": null,
                "extraRateWindows": [{"id": "claude-weekly-scoped", "title": "Só um modelo", "window": {"usedPercent": 3, "windowMinutes": 10080, "resetsAt": "2026-10-27T16:00:00Z"}}]}},
            {"provider": "codex", "usage": {"primary": {"usedPercent": 0, "windowMinutes": 43200, "resetsAt": "2026-11-23T22:37:20Z"}}, "credits": {"balanceReadSucceeded": false, "remaining": 0}},
            {"provider": "antigravity", "usage": {"primary": {"usedPercent": 70, "windowMinutes": 300}}, "credits": {"remaining": 12.5}}
        ]);
        let accounts = vec![crate::accounts::AccountProfile { id: "claude:x".into(), provider: "claude".into(), nickname: "Trabalho".into(), email: Some("DEV@example.com".into()), plan: None, dir: None, default: false }];
        let (l, s, c) = from_codexbar(&v, &accounts);
        assert_eq!(l.len(), 5);
        assert!(l.iter().filter(|x| x.provider == "claude").all(|x| x.account.as_deref() == Some("claude:x")), "mesmo e-mail → mesmo perfil");
        assert_eq!(l.iter().find(|x| x.window == "claude-weekly-scoped").unwrap().title, "Só um modelo");
        assert_eq!(l.iter().find(|x| x.provider == "claude" && x.window == "5h").unwrap().resets_at, Some(1_792_910_400));
        assert!(l.iter().any(|x| x.provider == "agy" && x.used_pct == 70.0));
        assert_eq!(s.len(), 1);
        assert_eq!(c, vec![Credits { provider: "agy".into(), account_label: None, remaining: 12.5 }]);
    }

    #[test]
    fn merge_fica_com_o_mais_novo() {
        let now = crate::store::now();
        let l = |pct: f64, at: u64| Limit { provider: "claude".into(), account: Some("a".into()), window: "5h".into(), title: "x".into(), used_pct: pct, resets_at: Some(now + 100), source: "t".into(), updated_at: at, ..Default::default() };
        let mut s = LimitsSnapshot::default();
        s.merge(vec![l(10.0, now)]);
        s.merge(vec![l(5.0, now - 50)]);
        assert_eq!(s.limits.len(), 1);
        assert_eq!(s.limits[0].used_pct, 10.0);
        s.merge(vec![l(20.0, now + 1)]);
        assert_eq!(s.limits[0].used_pct, 20.0);
        assert_eq!(window_name(Some(120), "x").1, "2 h");
    }

    #[test]
    fn timeout_mata_o_processo() {
        #[cfg(unix)]
        {
            let mut c = std::process::Command::new("sh");
            c.args(["-c", "sleep 5"]);
            let t = std::time::Instant::now();
            assert!(run_with_timeout(c, Duration::from_millis(300)).is_none());
            assert!(t.elapsed() < Duration::from_secs(3));
            let mut c = std::process::Command::new("sh");
            c.args(["-c", "echo '[]'"]);
            assert_eq!(run_with_timeout(c, Duration::from_secs(5)).unwrap().trim(), "[]");
        }
    }
}
