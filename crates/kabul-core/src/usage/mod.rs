//! Uso, custos e limites de IA. Fontes, nesta ordem: (1) o que o Kabul mede em cada turno (tokens, custo
//! e duração reportados pelos harnesses), (2) os próprios agentes (eventos de limite do Claude e do Codex
//! no stream, `account/rateLimits/read` do app-server do Codex, endpoint de uso da assinatura do Claude
//! com o login do próprio Claude Code), (3) o CLI do CodexBar quando instalado.
//!
//! Os turnos ficam em `<estado>/usage.jsonl` (uma linha por turno; a primeira traz o `schema_version`).
//! Nada de conteúdo de prompt, código ou caminhos: só metadados (provedor, modelo, conta, workspace, sessão).
pub mod claude_oauth;
pub mod icon;
pub mod limits;

/// sha256 em hex minúsculo.
pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

use crate::harness::{Event, HarnessKind};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;

pub use limits::{Limit, LimitsSnapshot};

pub const SCHEMA_VERSION: u32 = 1;

/// Um turno de agente (do envio até o fim da resposta).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    /// Fim do turno (segundos Unix).
    pub at: u64,
    /// Provedor de conta: claude | codex | agy | opencode | qwen | gemini | local ...
    pub provider: String,
    pub harness: String,
    /// Rótulo do modelo (como no seletor) e a chave dele.
    pub model: String,
    #[serde(default)]
    pub model_key: String,
    /// Id do perfil de conta do Kabul (`claude:sistema`, `codex:abc`...).
    #[serde(default)]
    pub account: Option<String>,
    pub workspace_id: String,
    /// Sessão do agente (id para retomar) ou, sem ele, um id local da conversa.
    pub session: String,
    #[serde(default)]
    pub input: u64,
    #[serde(default)]
    pub output: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
    /// Só quando o harness reporta (Claude). Sem tabela de preços inventada.
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub duration_ms: u64,
}

impl Turn {
    pub fn tokens(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

#[derive(Serialize, Deserialize)]
struct Header {
    schema_version: u32,
}

/// Arquivo de turnos (append-only).
pub struct Ledger {
    path: PathBuf,
}

static WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());

impl Ledger {
    pub fn open(home: &Path) -> Self {
        Self { path: home.join("usage.jsonl") }
    }

    pub fn append(&self, t: &Turn) -> Result<()> {
        let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(d) = self.path.parent() {
            std::fs::create_dir_all(d)?;
        }
        let fresh = !self.path.exists();
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.path)?;
        let mut buf = String::new();
        if fresh {
            buf.push_str(&serde_json::to_string(&Header { schema_version: SCHEMA_VERSION })?);
            buf.push('\n');
        }
        buf.push_str(&serde_json::to_string(t)?);
        buf.push('\n');
        f.write_all(buf.as_bytes())?;
        Ok(())
    }

    /// Todos os turnos (linhas inválidas ou de versão futura desconhecida são ignoradas).
    pub fn load(&self) -> Vec<Turn> {
        let Ok(text) = std::fs::read_to_string(&self.path) else { return vec![] };
        parse_ledger(&text)
    }

    /// Turnos a partir de `since` (segundos Unix).
    pub fn since(&self, since: u64) -> Vec<Turn> {
        self.load().into_iter().filter(|t| t.at >= since).collect()
    }
}

fn parse_ledger(text: &str) -> Vec<Turn> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let version = match lines.next().and_then(|l| serde_json::from_str::<Header>(l).ok()) {
        Some(h) => h.schema_version,
        // Sem cabeçalho: arquivo antigo/corrompido; tenta ler as linhas como turnos.
        None => return text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect(),
    };
    // Migrações entram aqui quando o formato mudar (v1 → v2 ...).
    let _ = version;
    lines.filter_map(|l| serde_json::from_str(l).ok()).collect()
}

// ---------------- gravação a partir dos eventos ----------------

/// De quem é a conversa (vai em cada turno).
#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub provider: String,
    pub harness: String,
    pub model: String,
    pub model_key: String,
    pub account: Option<String>,
    pub workspace_id: String,
}

impl Meta {
    /// Monta a partir do modelo e da conta escolhida (sem conta: a padrão do provedor).
    pub fn for_chat(home: &Path, kind: HarnessKind, model: &crate::models::Model, account: Option<&str>, workspace_id: &str) -> Self {
        let local = model.local.is_some();
        let provider = if local { "local".to_string() } else { crate::accounts::provider_of(kind).to_string() };
        let account = if local {
            None
        } else {
            let accs = crate::accounts::Accounts::open(home);
            Some(account.and_then(|id| accs.get(id)).unwrap_or_else(|| accs.default_for(&provider)).id)
        };
        Self { provider, harness: serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(), model: model.label.clone(), model_key: model.key.clone(), account, workspace_id: workspace_id.into() }
    }
}

/// Acompanha os eventos de uma conversa e grava um [`Turn`] a cada fim de turno. Também guarda os
/// limites que os agentes mandam no stream (Claude `rate_limit_event`, Codex `account/rateLimits/updated`).
pub struct Recorder {
    meta: Meta,
    home: PathBuf,
    session: Option<String>,
    local_id: String,
    turn_start: Option<std::time::Instant>,
    usage: Option<(u64, u64, u64, u64, Option<u64>)>,
    /// Claude: `total_cost_usd` é acumulado no processo; grava a diferença.
    last_cost: f64,
    /// Codex: `thread/tokenUsage/updated` traz o total da thread; grava a diferença.
    codex_total: Option<(u64, u64, u64)>,
    codex_prev: (u64, u64, u64),
}

impl Recorder {
    pub fn new(home: &Path, meta: Meta) -> Self {
        Self { meta, home: home.to_path_buf(), session: None, local_id: format!("kabul-{}", crate::store::id()), turn_start: None, usage: None, last_cost: 0.0, codex_total: None, codex_prev: (0, 0, 0) }
    }

    /// Vê um evento; devolve o turno gravado quando o turno termina.
    pub fn observe(&mut self, ev: &Event) -> Option<Turn> {
        if self.turn_start.is_none() && !matches!(ev, Event::TurnCompleted { .. } | Event::Log { .. }) {
            self.turn_start = Some(std::time::Instant::now());
        }
        match ev {
            Event::SessionStarted { session_id, .. } if !session_id.is_empty() => self.session = Some(session_id.clone()),
            Event::Usage { input, output, cache_read, cache_write, duration_ms } => {
                self.usage = Some((input.unwrap_or(0), output.unwrap_or(0), cache_read.unwrap_or(0), cache_write.unwrap_or(0), *duration_ms));
            }
            Event::Raw { value } => self.raw(value),
            Event::TurnCompleted { input_tokens, output_tokens, cost_usd, .. } => {
                let t = self.finish(*input_tokens, *output_tokens, *cost_usd);
                if let Err(e) = Ledger::open(&self.home).append(&t) {
                    eprintln!("kabul: uso não gravado: {e:#}");
                }
                return Some(t);
            }
            _ => {}
        }
        None
    }

    fn raw(&mut self, v: &Value) {
        if v.get("type").and_then(Value::as_str) == Some("rate_limit_event") {
            let label = self.account_label();
            let l = limits::from_claude_event(v, self.meta.account.clone(), label);
            if !l.is_empty() {
                limits::store_passive(&self.home, l);
            }
            return;
        }
        match v.get("method").and_then(Value::as_str) {
            Some("account/rateLimits/updated") => {
                let label = self.account_label();
                let l = limits::from_codex_rate_limits(&v["params"], self.meta.account.clone(), label, "codex-stream");
                if !l.is_empty() {
                    limits::store_passive(&self.home, l);
                }
            }
            Some("thread/tokenUsage/updated") => {
                let t = &v["params"]["tokenUsage"]["total"];
                let n = |k: &str| t.get(k).and_then(Value::as_u64).unwrap_or(0);
                self.codex_total = Some((n("inputTokens"), n("cachedInputTokens"), n("outputTokens")));
            }
            _ => {}
        }
    }

    fn account_label(&self) -> Option<String> {
        let id = self.meta.account.as_deref()?;
        let p = crate::accounts::Accounts::open(&self.home).get(id)?;
        p.email.or(Some(p.nickname))
    }

    fn finish(&mut self, input_tokens: Option<u64>, output_tokens: Option<u64>, cost: Option<f64>) -> Turn {
        let elapsed = self.turn_start.take().map(|s| s.elapsed().as_millis() as u64).unwrap_or(0);
        let (mut input, mut output, mut cache_read, mut cache_write, dur) = match self.usage.take() {
            Some(u) => u,
            // Sem detalhe: a entrada do fim do turno já inclui o cache (Claude) ou é só a entrada.
            None => (input_tokens.unwrap_or(0), output_tokens.unwrap_or(0), 0, 0, None),
        };
        if let Some(total) = self.codex_total.take() {
            let p = self.codex_prev;
            let (ti, tc, to) = (total.0.saturating_sub(p.0), total.1.saturating_sub(p.1), total.2.saturating_sub(p.2));
            self.codex_prev = total;
            // inputTokens do Codex inclui o cache lido.
            (input, cache_read, output, cache_write) = (ti.saturating_sub(tc), tc, to, 0);
        }
        let cost_usd = cost.map(|c| {
            if self.meta.harness == "claude" {
                let d = if c + 1e-12 >= self.last_cost { c - self.last_cost } else { c };
                self.last_cost = c;
                d.max(0.0)
            } else {
                c
            }
        });
        Turn {
            at: crate::store::now(),
            provider: self.meta.provider.clone(),
            harness: self.meta.harness.clone(),
            model: self.meta.model.clone(),
            model_key: self.meta.model_key.clone(),
            account: self.meta.account.clone(),
            workspace_id: self.meta.workspace_id.clone(),
            session: self.session.clone().unwrap_or_else(|| self.local_id.clone()),
            input,
            output,
            cache_read,
            cache_write,
            cost_usd,
            duration_ms: dur.unwrap_or(elapsed),
        }
    }
}

/// Repassa os eventos da sessão por um [`Recorder`] (uma thread a mais, o resto do fluxo não muda).
/// `on_turn` é chamado depois de cada turno gravado (ex.: atualizar o ícone da barra).
pub fn tap(rx: Receiver<Event>, mut rec: Recorder, on_turn: impl Fn(&Turn) + Send + 'static) -> Receiver<Event> {
    let (tx, out) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for ev in rx {
            if let Some(t) = rec.observe(&ev) {
                on_turn(&t);
            }
            if tx.send(ev).is_err() {
                break;
            }
        }
    });
    out
}

// ---------------- agregação ----------------

/// Totais de um grupo (dia, modelo, conta, workspace, provedor).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Row {
    pub key: String,
    pub label: String,
    pub turns: u64,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub tokens: u64,
    pub cost_usd: f64,
    /// Turnos sem custo reportado (o custo do grupo é um mínimo).
    pub unpriced: u64,
    pub duration_ms: u64,
}

impl Row {
    fn add(&mut self, t: &Turn) {
        self.turns += 1;
        self.input += t.input;
        self.output += t.output;
        self.cache_read += t.cache_read;
        self.cache_write += t.cache_write;
        self.tokens += t.tokens();
        match t.cost_usd {
            Some(c) => self.cost_usd += c,
            None => self.unpriced += 1,
        }
        self.duration_ms += t.duration_ms;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupBy {
    Day,
    Model,
    Account,
    Workspace,
    Provider,
}

/// Dia local (`AAAA-MM-DD`) de um instante, com o deslocamento do fuso em segundos.
pub fn day_of(at: u64, offset_secs: i64) -> String {
    let days = (at as i64 + offset_secs).div_euclid(86_400);
    let (y, m, d) = civil(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Dias desde 1970-01-01 → (ano, mês, dia) (algoritmo de H. Hinnant).
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Deslocamento do fuso local agora, em segundos.
pub fn local_offset() -> i64 {
    use chrono::Offset;
    chrono::Local::now().offset().fix().local_minus_utc() as i64
}

/// Agrupa os turnos. `label` dá o nome legível da chave (conta, workspace).
pub fn group(turns: &[Turn], by: GroupBy, offset: i64, label: &dyn Fn(GroupBy, &str) -> String) -> Vec<Row> {
    let mut m: BTreeMap<String, Row> = BTreeMap::new();
    for t in turns {
        let key = match by {
            GroupBy::Day => day_of(t.at, offset),
            GroupBy::Model => t.model.clone(),
            GroupBy::Account => t.account.clone().unwrap_or_else(|| t.provider.clone()),
            GroupBy::Workspace => t.workspace_id.clone(),
            GroupBy::Provider => t.provider.clone(),
        };
        m.entry(key.clone()).or_insert_with(|| Row { label: label(by, &key), key, ..Default::default() }).add(t);
    }
    let mut v: Vec<Row> = m.into_values().collect();
    if by != GroupBy::Day {
        v.sort_by(|a, b| b.cost_usd.partial_cmp(&a.cost_usd).unwrap_or(std::cmp::Ordering::Equal).then(b.tokens.cmp(&a.tokens)));
    }
    v
}

/// Série diária contínua (dias sem uso entram zerados), do mais antigo ao de hoje.
pub fn daily(turns: &[Turn], days: u32, now: u64, offset: i64) -> Vec<Row> {
    let by: BTreeMap<String, Row> = group(turns, GroupBy::Day, offset, &|_, k| k.to_string()).into_iter().map(|r| (r.key.clone(), r)).collect();
    (0..days.max(1))
        .rev()
        .map(|i| {
            let k = day_of(now.saturating_sub(i as u64 * 86_400), offset);
            by.get(&k).cloned().unwrap_or_else(|| Row { label: k.clone(), key: k, ..Default::default() })
        })
        .collect()
}

/// Uma sessão de IA (conversa) com duração e custo.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SessionRow {
    pub session: String,
    pub workspace_id: String,
    pub provider: String,
    pub model: String,
    pub account: Option<String>,
    pub started: u64,
    pub ended: u64,
    pub turns: u64,
    pub tokens: u64,
    pub cost_usd: f64,
    pub unpriced: u64,
    /// Tempo do agente trabalhando (soma dos turnos).
    pub duration_ms: u64,
}

pub fn sessions(turns: &[Turn], limit: usize) -> Vec<SessionRow> {
    let mut m: BTreeMap<String, SessionRow> = BTreeMap::new();
    for t in turns {
        let s = m.entry(t.session.clone()).or_insert_with(|| SessionRow {
            session: t.session.clone(),
            workspace_id: t.workspace_id.clone(),
            provider: t.provider.clone(),
            model: t.model.clone(),
            account: t.account.clone(),
            started: t.at.saturating_sub(t.duration_ms / 1000),
            ..Default::default()
        });
        s.started = s.started.min(t.at.saturating_sub(t.duration_ms / 1000));
        s.ended = s.ended.max(t.at);
        s.model = t.model.clone();
        s.turns += 1;
        s.tokens += t.tokens();
        match t.cost_usd {
            Some(c) => s.cost_usd += c,
            None => s.unpriced += 1,
        }
        s.duration_ms += t.duration_ms;
    }
    let mut v: Vec<SessionRow> = m.into_values().collect();
    v.sort_by_key(|a| std::cmp::Reverse(a.ended));
    v.truncate(limit);
    v
}

/// CSV (vírgula, aspas quando precisa) com um turno por linha.
pub fn csv(turns: &[Turn], offset: i64) -> String {
    let q = |s: &str| if s.contains([',', '"', '\n']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s.to_string() };
    let mut out = String::from("data,hora,provedor,harness,modelo,conta,workspace,sessao,entrada,saida,cache_lido,cache_gravado,custo_usd,duracao_ms\n");
    for t in turns {
        let secs = (t.at as i64 + offset).rem_euclid(86_400);
        out.push_str(&format!(
            "{},{:02}:{:02},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            day_of(t.at, offset),
            secs / 3600,
            secs % 3600 / 60,
            q(&t.provider),
            q(&t.harness),
            q(&t.model),
            q(t.account.as_deref().unwrap_or("")),
            q(&t.workspace_id),
            q(&t.session),
            t.input,
            t.output,
            t.cache_read,
            t.cache_write,
            t.cost_usd.map(|c| format!("{c:.6}")).unwrap_or_default(),
            t.duration_ms
        ));
    }
    out
}

// ---------------- alertas e sugestões ----------------

/// Configuração dos alertas (Configurações › Uso).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlertConfig {
    /// Avisa quando uma janela de limite passar disto (%).
    pub limit_pct: f64,
    pub daily_budget_usd: Option<f64>,
    pub monthly_budget_usd: Option<f64>,
}

impl Default for AlertConfig {
    fn default() -> Self {
        Self { limit_pct: 80.0, daily_budget_usd: None, monthly_budget_usd: None }
    }
}

impl AlertConfig {
    pub fn from_settings(s: &crate::settings::AppSettings) -> Self {
        Self { limit_pct: s.usage_alert_pct as f64, daily_budget_usd: s.usage_daily_budget.filter(|b| *b > 0.0), monthly_budget_usd: s.usage_monthly_budget.filter(|b| *b > 0.0) }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Alert {
    /// Chave estável (não repetir a mesma notificação até o reset).
    pub key: String,
    /// limit | daily_budget | monthly_budget
    pub kind: String,
    /// warn | crit
    pub level: String,
    pub text: String,
    pub provider: Option<String>,
    pub account: Option<String>,
    /// Campos para a interface montar o texto no idioma dela (`text` fica em português).
    /// Limite: janela (`5h`, `semana`, `seven_day_opus`…), título, conta, % usado e segundos até reiniciar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    pub pct: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_in_secs: Option<u64>,
    /// Orçamento: gasto e teto em US$.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spent_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_usd: Option<f64>,
}

pub fn alerts(lims: &[Limit], today_usd: f64, month_usd: f64, cfg: &AlertConfig, now: u64) -> Vec<Alert> {
    let mut v = vec![];
    for l in lims.iter().filter(|l| l.live(now) && l.used_pct >= cfg.limit_pct) {
        let crit = l.used_pct >= 100.0;
        let who = l.account_label.clone().map(|a| format!(" ({a})")).unwrap_or_default();
        v.push(Alert {
            key: format!("limit:{}:{}:{}:{}", l.provider, l.account.as_deref().or(l.account_label.as_deref()).unwrap_or(""), l.window, l.resets_at.unwrap_or(0)),
            kind: "limit".into(),
            level: if crit { "crit" } else { "warn" }.into(),
            text: format!("{}{who}: {} em {:.0}%{}", limits::provider_label(&l.provider), l.title, l.used_pct, l.resets_at.map(|r| format!(", reinicia em {}", countdown(r.saturating_sub(now)))).unwrap_or_default()),
            provider: Some(l.provider.clone()),
            account: l.account.clone(),
            window: Some(l.window.clone()),
            title: Some(l.title.clone()),
            account_label: l.account_label.clone(),
            pct: l.used_pct,
            resets_in_secs: l.resets_at.map(|r| r.saturating_sub(now)),
            spent_usd: None,
            budget_usd: None,
        });
    }
    let budget = |kind: &str, spent: f64, b: Option<f64>, what: &str, period: &str| {
        let b = b?;
        let pct = spent / b * 100.0;
        (pct >= 80.0).then(|| Alert {
            key: format!("{kind}:{period}:{}", if pct >= 100.0 { "crit" } else { "warn" }),
            kind: kind.into(),
            level: if pct >= 100.0 { "crit" } else { "warn" }.into(),
            text: format!("Gasto {what}: US$ {spent:.2} de US$ {b:.2} ({pct:.0}%)"),
            provider: None,
            account: None,
            window: None,
            title: None,
            account_label: None,
            pct,
            resets_in_secs: None,
            spent_usd: Some(spent),
            budget_usd: Some(b),
        })
    };
    let (d, mo) = (day_of(now, local_offset()), day_of(now, local_offset())[..7].to_string());
    v.extend(budget("daily_budget", today_usd, cfg.daily_budget_usd, "de hoje", &d));
    v.extend(budget("monthly_budget", month_usd, cfg.monthly_budget_usd, "do mês", &mo));
    v
}

/// "3 h 20 min", "2 d 4 h", "12 min".
pub fn countdown(secs: u64) -> String {
    let (d, h, m) = (secs / 86_400, secs % 86_400 / 3600, secs % 3600 / 60);
    if d > 0 {
        format!("{d} d {h} h")
    } else if h > 0 {
        format!("{h} h {m} min")
    } else {
        format!("{} min", m.max(1))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AccountRef {
    pub id: String,
    pub nickname: String,
}

/// Perto do limite: trocar de conta (mesmo provedor) ou de provedor/modelo. A UI aplica na troca de
/// conta/LLM da própria conversa (vale no próximo envio, com handoff).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Suggestion {
    pub provider: String,
    pub account: Option<String>,
    pub to_account: Option<AccountRef>,
    pub to_provider: Option<String>,
    pub text: String,
}

/// `accounts`: perfis por provedor (id, apelido). Uma conta sem limite conhecido conta como livre.
pub fn suggestions(lims: &[Limit], accounts: &BTreeMap<String, Vec<AccountRef>>, cfg: &AlertConfig, now: u64) -> Vec<Suggestion> {
    let live: Vec<&Limit> = lims.iter().filter(|l| l.live(now)).collect();
    let worst = |p: &str, acc: Option<&str>| live.iter().filter(|l| l.provider == p && (acc.is_none() || l.account.as_deref() == acc)).map(|l| l.used_pct).fold(None, |a: Option<f64>, x| Some(a.map_or(x, |a| a.max(x))));
    let mut out = vec![];
    let mut seen = std::collections::HashSet::new();
    for l in live.iter().filter(|l| l.used_pct >= cfg.limit_pct) {
        if !seen.insert((l.provider.clone(), l.account.clone())) {
            continue;
        }
        let other = accounts.get(&l.provider).into_iter().flatten().filter(|a| Some(a.id.as_str()) != l.account.as_deref()).find(|a| worst(&l.provider, Some(&a.id)).is_none_or(|w| w < cfg.limit_pct));
        if let Some(a) = other {
            out.push(Suggestion {
                provider: l.provider.clone(),
                account: l.account.clone(),
                to_account: Some(a.clone()),
                to_provider: None,
                text: format!("{} perto do limite ({}: {:.0}%). Usar a conta {} nas conversas.", limits::provider_label(&l.provider), l.title, l.used_pct, a.nickname),
            });
            continue;
        }
        let alt = ["claude", "codex", "agy"].into_iter().filter(|p| *p != l.provider).find(|p| accounts.contains_key(*p) && worst(p, None).is_none_or(|w| w < cfg.limit_pct));
        if let Some(p) = alt {
            out.push(Suggestion {
                provider: l.provider.clone(),
                account: l.account.clone(),
                to_account: None,
                to_provider: Some(p.into()),
                text: format!("{} perto do limite ({}: {:.0}%). Trocar para um modelo do {} na mesma conversa.", limits::provider_label(&l.provider), l.title, l.used_pct, limits::provider_label(p)),
            });
        }
    }
    out
}

// ---------------- visão geral (aba Uso, barra, celular) ----------------

#[derive(Debug, Clone, Default, Serialize)]
pub struct Overview {
    pub schema_version: u32,
    pub days: u32,
    pub today_usd: f64,
    pub month_usd: f64,
    pub today_tokens: u64,
    pub month_tokens: u64,
    pub unpriced_turns: u64,
    pub by_day: Vec<Row>,
    pub by_model: Vec<Row>,
    pub by_account: Vec<Row>,
    pub by_workspace: Vec<Row>,
    pub by_provider: Vec<Row>,
    pub sessions: Vec<SessionRow>,
    pub limits: LimitsSnapshot,
    pub tightest: Option<Limit>,
    pub alerts: Vec<Alert>,
    pub suggestions: Vec<Suggestion>,
    /// Um bloco por provedor/conta em uso, com ou sem limites conhecidos (a tela nunca "perde" uma conta).
    pub expected: Vec<ExpectedBlock>,
}

/// Provedor/conta que a tela de uso deve mostrar mesmo sem dados de limite.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ExpectedBlock {
    pub provider: String,
    /// Id do perfil de conta do Kabul (`claude:sistema`, `claude:abc`).
    pub account: String,
    /// Apelido do perfil.
    pub label: String,
    /// Há janela de limite valendo para esta conta.
    pub has_data: bool,
    /// Última leitura que falhou para esta conta: código (`no_login`, `expired`, `unauthorized`,
    /// `rate_limited`, `network`, `error`) e o texto em português.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Provedores com limites que o Kabul sabe ler, na ordem da tela.
const LIMIT_PROVIDERS: [&str; 3] = ["claude", "codex", "agy"];

/// Blocos esperados: para Claude, Codex e Antigravity, cada perfil cadastrado (o "padrão do sistema" só
/// quando foi usado ou é o único); para os outros provedores com turnos, um bloco por conta usada.
pub fn expected_blocks(turns: &[Turn], snap: &LimitsSnapshot, accounts: &BTreeMap<String, Vec<AccountRef>>, now: u64) -> Vec<ExpectedBlock> {
    let live: Vec<&Limit> = snap.limits.iter().filter(|l| l.live(now)).collect();
    let mut out = vec![];
    let mut push = |provider: &str, id: &str, label: &str| {
        let sistema = id.ends_with(":sistema");
        // Leitura sem perfil (CodexBar, pelo e-mail) é da config padrão do CLI: conta como a do sistema.
        let has_data = live.iter().any(|l| l.provider == provider && (l.account.as_deref() == Some(id) || (sistema && l.account.is_none())));
        let fail = snap.sources.iter().find(|s| !s.ok && s.provider.as_deref() == Some(provider) && s.account.as_deref() == Some(id));
        out.push(ExpectedBlock { provider: provider.into(), account: id.into(), label: label.into(), has_data, code: fail.and_then(|s| s.code.clone()), detail: fail.map(|s| s.detail.clone()) });
    };
    for p in LIMIT_PROVIDERS {
        let profiles = accounts.get(p).cloned().unwrap_or_else(|| vec![AccountRef { id: format!("{p}:sistema"), nickname: "Padrão do sistema".into() }]);
        let mut used: std::collections::HashSet<&str> = turns.iter().filter(|t| t.provider == p).filter_map(|t| t.account.as_deref()).collect();
        used.extend(snap.sources.iter().filter(|s| s.provider.as_deref() == Some(p)).filter_map(|s| s.account.as_deref()));
        used.extend(live.iter().filter(|l| l.provider == p).map(|l| l.account.as_deref().unwrap_or("")));
        if used.is_empty() && profiles.len() < 2 {
            continue;
        }
        for a in &profiles {
            let sistema = a.id.ends_with(":sistema");
            if !sistema || profiles.len() == 1 || used.contains(a.id.as_str()) || used.contains("") {
                push(p, &a.id, &a.nickname);
            }
        }
    }
    let mut others: Vec<(String, String)> =
        turns.iter().filter(|t| !LIMIT_PROVIDERS.contains(&t.provider.as_str()) && t.provider != "local" && !t.provider.is_empty()).map(|t| (t.provider.clone(), t.account.clone().unwrap_or_else(|| format!("{}:sistema", t.provider)))).collect();
    others.sort();
    others.dedup();
    for (p, id) in others {
        push(&p, &id, if id.ends_with(":sistema") { "Padrão do sistema" } else { id.split(':').nth(1).unwrap_or(&id) });
    }
    out
}

/// Gasto reportado hoje (dia local), em US$.
pub fn today_usd(home: &Path) -> f64 {
    let now = crate::store::now();
    let offset = local_offset();
    let today = day_of(now, offset);
    Ledger::open(home).since(now.saturating_sub(2 * 86_400)).iter().filter(|t| day_of(t.at, offset) == today).filter_map(|t| t.cost_usd).sum()
}

/// Perfis de conta por provedor (para rótulos e sugestões).
pub fn account_refs(home: &Path) -> BTreeMap<String, Vec<AccountRef>> {
    let accs = crate::accounts::Accounts::open(home);
    ["claude", "codex", "agy"].into_iter().map(|p| (p.to_string(), accs.of(p).into_iter().map(|a| AccountRef { id: a.id, nickname: a.nickname }).collect())).collect()
}

/// Monta a visão geral dos últimos `days` dias. `ws_label` dá o nome do workspace.
pub fn overview(home: &Path, days: u32, cfg: &AlertConfig, ws_label: &dyn Fn(&str) -> Option<String>) -> Overview {
    let now = crate::store::now();
    let offset = local_offset();
    let days = days.clamp(1, 366);
    let all = Ledger::open(home).since(now.saturating_sub(400 * 86_400));
    overview_from(&all, limits::load(home), &account_refs(home), now, offset, days, cfg, ws_label)
}

#[allow(clippy::too_many_arguments)]
pub fn overview_from(all: &[Turn], lims: LimitsSnapshot, accounts: &BTreeMap<String, Vec<AccountRef>>, now: u64, offset: i64, days: u32, cfg: &AlertConfig, ws_label: &dyn Fn(&str) -> Option<String>) -> Overview {
    let today = day_of(now, offset);
    let month = &today[..7];
    let range_start = now.saturating_sub(days as u64 * 86_400);
    let turns: Vec<Turn> = all.iter().filter(|t| t.at >= range_start).cloned().collect();
    let (mut today_usd, mut month_usd, mut today_tokens, mut month_tokens) = (0.0, 0.0, 0, 0);
    for t in all {
        let d = day_of(t.at, offset);
        if d.starts_with(month) {
            month_usd += t.cost_usd.unwrap_or(0.0);
            month_tokens += t.tokens();
            if d == today {
                today_usd += t.cost_usd.unwrap_or(0.0);
                today_tokens += t.tokens();
            }
        }
    }
    let nick: BTreeMap<&str, &str> = accounts.values().flatten().map(|a| (a.id.as_str(), a.nickname.as_str())).collect();
    let label = |by: GroupBy, k: &str| -> String {
        match by {
            GroupBy::Account => nick.get(k).map(|n| format!("{} · {n}", limits::provider_label(k.split(':').next().unwrap_or(k)))).unwrap_or_else(|| limits::provider_label(k).to_string()),
            GroupBy::Workspace => ws_label(k).unwrap_or_else(|| k.to_string()),
            GroupBy::Provider => limits::provider_label(k).to_string(),
            _ => k.to_string(),
        }
    };
    let tightest = lims.limits.iter().filter(|l| l.live(now)).max_by(|a, b| a.used_pct.partial_cmp(&b.used_pct).unwrap_or(std::cmp::Ordering::Equal)).cloned();
    let alerts = alerts(&lims.limits, today_usd, month_usd, cfg, now);
    let suggestions = suggestions(&lims.limits, accounts, cfg, now);
    let expected = expected_blocks(all, &lims, accounts, now);
    Overview {
        expected,
        schema_version: SCHEMA_VERSION,
        days,
        today_usd,
        month_usd,
        today_tokens,
        month_tokens,
        unpriced_turns: turns.iter().filter(|t| t.cost_usd.is_none()).count() as u64,
        by_day: daily(&turns, days, now, offset),
        by_model: group(&turns, GroupBy::Model, offset, &label),
        by_account: group(&turns, GroupBy::Account, offset, &label),
        by_workspace: group(&turns, GroupBy::Workspace, offset, &label),
        by_provider: group(&turns, GroupBy::Provider, offset, &label),
        sessions: sessions(&turns, 100),
        limits: lims,
        tightest,
        alerts,
        suggestions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::Event;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kabul-usage-{name}-{}", crate::store::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn turn(at: u64, model: &str, ws: &str, cost: Option<f64>, tokens: u64) -> Turn {
        Turn {
            at,
            provider: "claude".into(),
            harness: "claude".into(),
            model: model.into(),
            account: Some("claude:sistema".into()),
            workspace_id: ws.into(),
            session: format!("s-{ws}"),
            input: tokens,
            output: 10,
            cost_usd: cost,
            duration_ms: 2000,
            ..Default::default()
        }
    }

    #[test]
    fn datas_civis() {
        assert_eq!(day_of(0, 0), "1970-01-01");
        // 2026-10-24 12:00 UTC; em -03:00 ainda é dia 24, às 02:00 UTC do dia 25 também.
        assert_eq!(day_of(1_792_843_200, 0), "2026-10-24");
        assert_eq!(day_of(1_792_893_600, -3 * 3600), "2026-10-24");
        assert_eq!(day_of(1_792_893_600, 0), "2026-10-25");
        assert_eq!(day_of(951_782_400, 0), "2000-02-29");
    }

    #[test]
    fn ledger_com_versao() {
        let home = tmp("ledger");
        let l = Ledger::open(&home);
        l.append(&turn(100, "Opus", "w1", Some(0.5), 10)).unwrap();
        l.append(&turn(200, "Opus", "w1", None, 20)).unwrap();
        let text = std::fs::read_to_string(home.join("usage.jsonl")).unwrap();
        assert!(text.starts_with("{\"schema_version\":1}\n"), "{text}");
        assert_eq!(l.load().len(), 2);
        assert_eq!(l.since(150).len(), 1);
        // Linha estragada não derruba a leitura.
        std::fs::write(home.join("usage.jsonl"), format!("{text}lixo\n")).unwrap();
        assert_eq!(l.load().len(), 2);
    }

    #[test]
    fn recorder_claude_custo_acumulado_e_tokens() {
        let home = tmp("rec");
        let meta = Meta { provider: "claude".into(), harness: "claude".into(), model: "Opus".into(), model_key: "claude:opus".into(), account: Some("claude:sistema".into()), workspace_id: "w1".into() };
        let mut r = Recorder::new(&home, meta);
        r.observe(&Event::SessionStarted { session_id: "sess-1".into(), model: None });
        r.observe(&Event::Usage { input: Some(100), output: Some(20), cache_read: Some(1000), cache_write: Some(50), duration_ms: Some(1500) });
        let t1 = r.observe(&Event::TurnCompleted { result: None, input_tokens: Some(1150), output_tokens: Some(20), cost_usd: Some(0.10) }).unwrap();
        assert_eq!((t1.input, t1.output, t1.cache_read, t1.cache_write, t1.duration_ms, t1.session.as_str()), (100, 20, 1000, 50, 1500, "sess-1"));
        assert!((t1.cost_usd.unwrap() - 0.10).abs() < 1e-9);
        // Segundo turno: total_cost_usd acumulado 0.25 → turno custou 0.15.
        let t2 = r.observe(&Event::TurnCompleted { result: None, input_tokens: Some(10), output_tokens: Some(5), cost_usd: Some(0.25) }).unwrap();
        assert!((t2.cost_usd.unwrap() - 0.15).abs() < 1e-9, "{:?}", t2.cost_usd);
        assert_eq!((t2.input, t2.output), (10, 5));
        assert_eq!(Ledger::open(&home).load().len(), 2);
    }

    #[test]
    fn recorder_codex_tokens_pelo_total_da_thread_e_limites_no_stream() {
        let home = tmp("codex");
        let meta = Meta { provider: "codex".into(), harness: "codex".into(), model: "GPT".into(), account: Some("codex:sistema".into()), workspace_id: "w2".into(), ..Default::default() };
        let mut r = Recorder::new(&home, meta);
        let usage = |i: u64, c: u64, o: u64| Event::Raw { value: serde_json::json!({"method": "thread/tokenUsage/updated", "params": {"tokenUsage": {"total": {"inputTokens": i, "cachedInputTokens": c, "outputTokens": o}}}}) };
        r.observe(&usage(1000, 400, 50));
        let t1 = r.observe(&Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }).unwrap();
        assert_eq!((t1.input, t1.cache_read, t1.output, t1.cost_usd), (600, 400, 50, None));
        r.observe(&usage(1500, 600, 80));
        let t2 = r.observe(&Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }).unwrap();
        assert_eq!((t2.input, t2.cache_read, t2.output), (300, 200, 30));
        let reset = crate::store::now() + 3600;
        r.observe(&Event::Raw { value: serde_json::json!({"method": "account/rateLimits/updated", "params": {"rateLimits": {"primary": {"usedPercent": 42, "windowDurationMins": 300, "resetsAt": reset}, "secondary": null}}}) });
        let snap = limits::load(&home);
        assert_eq!(snap.limits.len(), 1);
        assert_eq!((snap.limits[0].provider.as_str(), snap.limits[0].window.as_str(), snap.limits[0].used_pct), ("codex", "5h", 42.0));
    }

    #[test]
    fn tap_repassa_tudo() {
        let home = tmp("tap");
        let (tx, rx) = std::sync::mpsc::channel();
        let seen = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let s2 = seen.clone();
        let out = tap(rx, Recorder::new(&home, Meta::default()), move |_| {
            s2.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        tx.send(Event::Text { text: "oi".into() }).unwrap();
        tx.send(Event::TurnCompleted { result: None, input_tokens: Some(3), output_tokens: Some(4), cost_usd: None }).unwrap();
        drop(tx);
        assert_eq!(out.iter().count(), 2);
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn agregacao_sessoes_e_csv() {
        let day = 86_400;
        let now = 1_792_843_200; // 2026-10-24 12:00 UTC
        let turns = vec![turn(now - 2 * day, "Opus", "w1", Some(1.0), 100), turn(now - 60, "Opus", "w1", Some(0.5), 50), turn(now - 30, "Sonnet", "w2", None, 10)];
        let by_model = group(&turns, GroupBy::Model, 0, &|_, k| k.to_string());
        assert_eq!(by_model[0].key, "Opus");
        assert!((by_model[0].cost_usd - 1.5).abs() < 1e-9);
        assert_eq!(by_model[1].unpriced, 1);
        let d = daily(&turns, 7, now, 0);
        assert_eq!(d.len(), 7);
        assert_eq!(d.last().unwrap().key, "2026-10-24");
        assert_eq!(d.last().unwrap().turns, 2);
        assert_eq!(d[4].turns, 1, "anteontem");
        let s = sessions(&turns, 10);
        assert_eq!(s.len(), 2);
        assert_eq!(s.iter().find(|x| x.workspace_id == "w1").unwrap().turns, 2);
        let c = csv(&turns[..1], 0);
        assert!(c.starts_with("data,hora,provedor"));
        assert!(c.lines().nth(1).unwrap().starts_with("2026-10-22,12:00,claude,claude,Opus,claude:sistema,w1,s-w1,100,10,0,0,1.000000,2000"), "{c}");
        assert!(csv(&[Turn { model: "a,\"b\"".into(), ..Default::default() }], 0).contains(",\"a,\"\"b\"\"\","), "aspas escapadas");
    }

    #[test]
    fn alertas_e_sugestoes() {
        let now = 1_000_000;
        let lim = |p: &str, acc: &str, pct: f64| Limit {
            provider: p.into(),
            account: Some(acc.into()),
            window: "5h".into(),
            title: "Sessão (5 h)".into(),
            used_pct: pct,
            resets_at: Some(now + 7200),
            updated_at: now,
            source: "teste".into(),
            ..Default::default()
        };
        let cfg = AlertConfig { limit_pct: 80.0, daily_budget_usd: Some(10.0), monthly_budget_usd: None };
        let a = alerts(&[lim("claude", "claude:sistema", 85.0), lim("codex", "codex:sistema", 30.0)], 9.0, 9.0, &cfg, now);
        assert_eq!(a.len(), 2, "{a:?}");
        assert!(a[0].text.contains("Claude") && a[0].text.contains("85%") && a[0].text.contains("2 h 0 min"), "{}", a[0].text);
        assert_eq!(a[1].kind, "daily_budget");
        // Expirado não conta.
        let mut old = lim("claude", "claude:sistema", 99.0);
        old.resets_at = Some(now - 1);
        assert!(alerts(&[old], 0.0, 0.0, &cfg, now).is_empty());

        let mut accs = BTreeMap::new();
        accs.insert("claude".to_string(), vec![AccountRef { id: "claude:sistema".into(), nickname: "Padrão".into() }, AccountRef { id: "claude:2".into(), nickname: "Trabalho".into() }]);
        accs.insert("codex".to_string(), vec![AccountRef { id: "codex:sistema".into(), nickname: "Padrão".into() }]);
        let s = suggestions(&[lim("claude", "claude:sistema", 90.0)], &accs, &cfg, now);
        assert_eq!(s[0].to_account.as_ref().unwrap().id, "claude:2");
        // A outra conta também está no limite: sugere outro provedor.
        let s = suggestions(&[lim("claude", "claude:sistema", 90.0), lim("claude", "claude:2", 95.0), lim("codex", "codex:sistema", 10.0)], &accs, &cfg, now);
        assert_eq!(s[0].to_provider.as_deref(), Some("codex"));
        assert!(s[0].text.contains("Codex"));
    }

    #[test]
    fn visao_geral() {
        let now = 1_792_843_200;
        let turns = vec![turn(now - 10, "Opus", "w1", Some(2.0), 100), turn(now - 40 * 86_400, "Opus", "w1", Some(5.0), 100)];
        let o = overview_from(&turns, LimitsSnapshot::default(), &BTreeMap::new(), now, 0, 30, &AlertConfig::default(), &|w| (w == "w1").then(|| "Meu workspace".to_string()));
        assert!((o.today_usd - 2.0).abs() < 1e-9 && (o.month_usd - 2.0).abs() < 1e-9);
        assert_eq!(o.by_day.len(), 30);
        assert_eq!(o.by_workspace[0].label, "Meu workspace");
        assert_eq!(o.sessions.len(), 1);
        assert!(o.tightest.is_none());
        // Claude usado e sem nenhum limite conhecido: o bloco aparece mesmo assim (sem dados).
        assert_eq!(o.expected.len(), 1);
        assert_eq!((o.expected[0].provider.as_str(), o.expected[0].account.as_str(), o.expected[0].has_data), ("claude", "claude:sistema", false));
    }

    #[test]
    fn blocos_esperados_por_conta() {
        let now = 1_000_000;
        let refs = |p: &str, extra: &[(&str, &str)]| {
            let mut v = vec![AccountRef { id: format!("{p}:sistema"), nickname: "Padrão do sistema".into() }];
            v.extend(extra.iter().map(|(id, n)| AccountRef { id: id.to_string(), nickname: n.to_string() }));
            v
        };
        let mut accs = BTreeMap::new();
        accs.insert("claude".to_string(), refs("claude", &[("claude:t", "Trabalho")]));
        accs.insert("codex".to_string(), refs("codex", &[]));
        accs.insert("agy".to_string(), refs("agy", &[]));
        let lim = |p: &str, acc: Option<&str>| Limit { provider: p.into(), account: acc.map(String::from), window: "5h".into(), title: "x".into(), used_pct: 10.0, resets_at: Some(now + 60), updated_at: now, source: "t".into(), ..Default::default() };
        let mut snap = LimitsSnapshot { limits: vec![lim("codex", Some("codex:sistema"))], ..Default::default() };
        // A conta "Trabalho" do Claude falhou por login vencido; a do sistema nem foi usada.
        snap.sources.push(limits::SourceInfo { name: "Claude · Trabalho".into(), ok: false, detail: "venceu".into(), provider: Some("claude".into()), account: Some("claude:t".into()), code: Some("expired".into()) });
        let turns = vec![Turn { provider: "gemini".into(), account: None, ..Default::default() }, Turn { provider: "local".into(), ..Default::default() }];
        let e = expected_blocks(&turns, &snap, &accs, now);
        let ids: Vec<&str> = e.iter().map(|b| b.account.as_str()).collect();
        // Claude: só o perfil cadastrado (o do sistema não foi usado); Codex com dados; Antigravity não usado
        // fica de fora; Gemini usado (sem limites) entra; "local" não tem limite.
        assert_eq!(ids, vec!["claude:t", "codex:sistema", "gemini:sistema"]);
        assert_eq!((e[0].has_data, e[0].code.as_deref(), e[0].label.as_str()), (false, Some("expired"), "Trabalho"));
        assert!(e[1].has_data);
        // Leitura do CodexBar sem perfil (pelo e-mail) cobre a conta do sistema.
        let snap = LimitsSnapshot { limits: vec![lim("claude", None)], ..Default::default() };
        let e = expected_blocks(&[], &snap, &accs, now);
        assert_eq!(e.iter().map(|b| (b.account.as_str(), b.has_data)).collect::<Vec<_>>(), vec![("claude:sistema", true), ("claude:t", false)]);
    }
}
