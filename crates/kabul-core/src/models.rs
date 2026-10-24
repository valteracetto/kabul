//! Catálogo de modelos por harness. Codex vem do `model/list` do app-server (da conta logada) e
//! Gemini/Antigravity de `agy models`, os dois com cache (memória e disco) e fallback; o Claude não
//! tem listagem no CLI e usa os aliases estáveis (`opus`, `sonnet`, `haiku`).
use crate::harness::HarnessKind;
use serde::{Deserialize, Serialize};
use std::process::Command;

pub const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Model {
    /// Id estável no app: `<harness>:<modelo base>`.
    pub key: String,
    pub harness: HarnessKind,
    /// Valor passado ao CLI (`--model`). Para o agy, sem o sufixo de esforço.
    pub id: String,
    pub label: String,
    /// anthropic | openai | google | outro
    pub provider: String,
    pub efforts: Vec<String>,
    /// Esforço vai no nome do modelo (`<id>-<esforço>`) em vez de flag.
    pub effort_in_id: bool,
    /// Modelo local/custom (selo "Local" na UI).
    #[serde(default)]
    pub local: Option<LocalRef>,
    /// Janela de contexto (anel de uso no composer).
    #[serde(default)]
    pub context: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalRef {
    /// Runtime ou endpoint custom.
    pub source: String,
    pub source_name: String,
    pub model: String,
    pub family: String,
    /// Explicação da escolha de harness (registro).
    pub note: String,
    /// Harnesses preferidos que faltam instalar.
    pub missing: Vec<HarnessKind>,
    pub size_bytes: Option<u64>,
    pub quant: Option<String>,
    pub fits: Option<bool>,
}

fn m(h: HarnessKind, id: &str, label: &str, provider: &str, efforts: &[&str]) -> Model {
    let context = Some(if provider == "anthropic" { 200_000 } else if provider == "openai" { 272_000 } else { 1_000_000 });
    Model { key: format!("{}:{id}", h.binary()), harness: h, id: id.into(), label: label.into(), provider: provider.into(), efforts: efforts.iter().map(|s| s.to_string()).collect(), effort_in_id: false, local: None, context }
}

pub fn claude_models() -> Vec<Model> {
    vec![
        m(HarnessKind::Claude, "opus", "Opus 5.5", "anthropic", EFFORTS),
        m(HarnessKind::Claude, "sonnet", "Sonnet 5.5", "anthropic", EFFORTS),
        m(HarnessKind::Claude, "haiku", "Haiku", "anthropic", &[]),
    ]
}

/// Último recurso, sem `model/list` nem cache: ids que o Codex aceitava na última verificação.
pub fn codex_models() -> Vec<Model> {
    vec![
        m(HarnessKind::Codex, "gpt-6-luna", "GPT-6-Luna", "openai", &["low", "medium", "high", "xhigh", "max"]),
        m(HarnessKind::Codex, "gpt-5.6-terra", "GPT-5.6-Terra", "openai", &["low", "medium", "high", "xhigh", "max"]),
    ]
}

/// Parse de `agy models`: linhas `id<TAB>Nome (Esforço)`. Agrupa variantes de esforço.
pub fn parse_agy_models(out: &str) -> Vec<Model> {
    let mut v: Vec<Model> = vec![];
    for line in out.lines() {
        let Some((id, name)) = line.split_once('\t') else { continue };
        let (id, name) = (id.trim(), name.trim());
        let (base, effort) = match id.rsplit_once('-') {
            Some((b, e)) if EFFORTS.contains(&e) => (b, Some(e)),
            _ => (id, None),
        };
        let label = name.split(" (").next().unwrap_or(name).to_string();
        let provider = if base.starts_with("gemini") { "google" } else if base.starts_with("claude") { "anthropic" } else if base.starts_with("gpt") { "openai" } else { "outro" };
        let key = format!("agy:{base}");
        let entry = match v.iter_mut().find(|x| x.key == key) {
            Some(e) => e,
            None => {
                v.push(Model { key, harness: HarnessKind::Antigravity, id: base.into(), label, provider: provider.into(), efforts: vec![], effort_in_id: effort.is_some(), local: None, context: Some(1_000_000) });
                v.last_mut().unwrap()
            }
        };
        if let Some(e) = effort {
            if !entry.efforts.iter().any(|x| x == e) {
                entry.efforts.push(e.into());
            }
        }
    }
    for x in &mut v {
        x.efforts.sort_by_key(|e| EFFORTS.iter().position(|y| y == e));
    }
    v
}

pub fn agy_models() -> Vec<Model> {
    let bin = crate::harness::which("agy").map(|p| p.display().to_string()).unwrap_or_else(|| "agy".into());
    Command::new(bin).arg("models").output().ok().filter(|o| o.status.success()).map(|o| parse_agy_models(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

/// Parse da resposta de `model/list` do app-server do Codex (`result.data[]`).
pub fn parse_codex_model_list(v: &serde_json::Value) -> Vec<Model> {
    use serde_json::Value;
    let mut out: Vec<(bool, Model)> = v
        .pointer("/result/data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|d| !d.get("hidden").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|d| {
            let id = d.get("model").or_else(|| d.get("id")).and_then(Value::as_str)?;
            let mut model = m(HarnessKind::Codex, id, d.get("displayName").and_then(Value::as_str).unwrap_or(id), "openai", &[]);
            model.efforts = d.get("supportedReasoningEfforts").and_then(Value::as_array).into_iter().flatten().filter_map(|e| e.get("reasoningEffort").and_then(Value::as_str).map(String::from)).collect();
            model.efforts.sort_by_key(|e| EFFORTS.iter().position(|y| y == e).unwrap_or(EFFORTS.len()));
            Some((d.get("isDefault").and_then(Value::as_bool).unwrap_or(false), model))
        })
        .collect();
    // O padrão da conta vem primeiro (ordenação estável mantém o resto).
    out.sort_by_key(|(default, _)| !default);
    out.into_iter().map(|(_, m)| m).collect()
}

/// Pergunta ao app-server do Codex os modelos da conta (`initialize` → `initialized` → `model/list`).
/// `env` é o do perfil da conta (CODEX_HOME). `None` se o Codex não responder a tempo.
pub fn codex_list(env: &[(String, String)], timeout: std::time::Duration) -> Option<Vec<Model>> {
    use std::io::{BufRead, Write};
    let bin = crate::harness::which("codex")?;
    let mut child = Command::new(bin).args(["app-server", "--listen", "stdio://"]).envs(env.iter().cloned()).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let lines = [
        serde_json::json!({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "kabul", "title": "Kabul", "version": env!("CARGO_PKG_VERSION")}}}),
        serde_json::json!({"method": "initialized"}),
        serde_json::json!({"id": 2, "method": "model/list", "params": {}}),
    ];
    for l in &lines {
        writeln!(stdin, "{l}").ok()?;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if v.get("id").and_then(serde_json::Value::as_i64) == Some(2) {
                    let _ = tx.send(v);
                    return;
                }
            }
        }
    });
    let got = rx.recv_timeout(timeout).ok();
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    got.map(|v| parse_codex_model_list(&v)).filter(|v| !v.is_empty())
}

/// Cache de listas de modelos: memória (10 min) e disco (fallback quando o CLI não responde).
fn cached(home: Option<&std::path::Path>, name: &str, fetch: impl FnOnce() -> Option<Vec<Model>>) -> Option<Vec<Model>> {
    use std::sync::Mutex;
    static MEM: Mutex<Vec<(String, std::time::Instant, Vec<Model>)>> = Mutex::new(Vec::new());
    if let Some((_, _, v)) = MEM.lock().unwrap().iter().find(|(k, t, _)| k == name && t.elapsed() < std::time::Duration::from_secs(600)) {
        return Some(v.clone());
    }
    let file = home.map(|h| h.join("cache").join(format!("models-{name}.json")));
    match fetch() {
        Some(v) => {
            let mut mem = MEM.lock().unwrap();
            mem.retain(|(k, _, _)| k != name);
            mem.push((name.into(), std::time::Instant::now(), v.clone()));
            if let Some(f) = &file {
                let _ = std::fs::create_dir_all(f.parent().unwrap());
                let _ = std::fs::write(f, serde_json::to_vec(&v).unwrap_or_default());
            }
            Some(v)
        }
        None => file.and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()),
    }
}

/// Catálogo com as listas dinâmicas (Codex pela conta padrão, Gemini pelo agy) e cache em `home`.
pub fn catalog_for(home: &std::path::Path) -> Vec<Model> {
    let mut v = claude_models();
    let accs = crate::accounts::Accounts::open(home);
    let prof = accs.default_for("codex");
    let env = crate::accounts::env_for(&prof);
    let key = format!("codex-{}", prof.id.replace([':', '/'], "_"));
    v.extend(cached(Some(home), &key, || codex_list(&env, std::time::Duration::from_secs(15))).unwrap_or_else(codex_models));
    v.extend(cached(Some(home), "agy", || Some(agy_models()).filter(|x| !x.is_empty())).unwrap_or_default());
    v
}

/// Modelos locais/custom já com o harness escolhido pelo registro.
pub fn local_models(sources: &[crate::local::SourceStatus], reg: &crate::registry::Registry) -> Vec<Model> {
    let mem = crate::local::total_memory();
    let mut v = vec![];
    for src in sources {
        for m in &src.models {
            let r = reg.resolve(&m.id, &src.apis, &|h| h.installed());
            let harness = r.harness.unwrap_or(HarnessKind::OpenCode);
            let efforts: Vec<String> = if harness == HarnessKind::Claude || harness == HarnessKind::Codex { ["low", "medium", "high"].map(String::from).to_vec() } else { vec![] };
            v.push(Model {
                key: format!("local:{}:{}", src.id, m.id),
                harness,
                id: m.id.clone(),
                label: if m.name.is_empty() { m.id.clone() } else { m.name.clone() },
                provider: "local".into(),
                efforts,
                effort_in_id: false,
                context: m.context,
                local: Some(LocalRef {
                    source: src.id.clone(),
                    source_name: src.name.clone(),
                    model: m.id.clone(),
                    family: crate::local::family_label(&m.id).into(),
                    note: r.note,
                    missing: r.missing,
                    size_bytes: m.size_bytes,
                    quant: m.quant.clone(),
                    fits: m.size_bytes.zip(mem).map(|(s, t)| crate::local::fits(s, t)),
                }),
            });
        }
    }
    v
}

/// Catálogo sem cache em disco (CLI e testes).
pub fn catalog() -> Vec<Model> {
    let mut v = claude_models();
    v.extend(cached(None, "codex-cli", || codex_list(&[], std::time::Duration::from_secs(15))).unwrap_or_else(codex_models));
    v.extend(cached(None, "agy-cli", || Some(agy_models()).filter(|x| !x.is_empty())).unwrap_or_default());
    v
}

/// Valor final de `--model` para um modelo + esforço.
pub fn cli_model(model: &Model, effort: Option<&str>) -> String {
    match effort {
        Some(e) if model.effort_in_id && model.efforts.iter().any(|x| x == e) => format!("{}-{e}", model.id),
        _ if model.effort_in_id => format!("{}-{}", model.id, model.efforts.get(model.efforts.len() / 2).map(String::as_str).unwrap_or("medium")),
        _ => model.id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUT: &str = "Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-argon-high\tGemini 4 Argon (High)\ngemini-4-argon-low\tGemini 4 Argon (Low)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\nsem-esforco\tSem Esforço\n";

    #[test]
    fn lista_do_codex() {
        let v: serde_json::Value = serde_json::from_str(r#"{"id":2,"result":{"data":[
            {"id":"gpt-5.6-terra","model":"gpt-5.6-terra","displayName":"GPT-5.6-Terra","hidden":false,"supportedReasoningEfforts":[{"reasoningEffort":"ultra"},{"reasoningEffort":"high"},{"reasoningEffort":"low"}],"isDefault":false},
            {"id":"gpt-6-luna","model":"gpt-6-luna","displayName":"GPT-6-Luna","hidden":false,"supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"max"}],"isDefault":true},
            {"id":"interno","model":"interno","displayName":"X","hidden":true,"supportedReasoningEfforts":[],"isDefault":false}]}}"#).unwrap();
        let m = parse_codex_model_list(&v);
        assert_eq!(m.iter().map(|x| x.key.as_str()).collect::<Vec<_>>(), ["codex:gpt-6-luna", "codex:gpt-5.6-terra"]);
        assert_eq!(m[1].efforts, ["low", "high", "ultra"]);
        assert_eq!((m[0].label.as_str(), m[0].harness), ("GPT-6-Luna", HarnessKind::Codex));
        assert_eq!(cli_model(&m[0], Some("max")), "gpt-6-luna");
    }

    #[test]
    fn agrupa_agy() {
        let v = parse_agy_models(OUT);
        assert_eq!(v.len(), 4);
        assert_eq!(v[0].id, "gemini-4-argon");
        assert_eq!(v[0].label, "Gemini 4 Argon");
        assert_eq!(v[0].efforts, vec!["low", "medium", "high"]);
        assert_eq!(v[0].provider, "google");
        assert_eq!(v[1].provider, "anthropic");
        assert_eq!(v[2].provider, "openai");
        assert!(!v[3].effort_in_id);
        assert_eq!(cli_model(&v[0], Some("high")), "gemini-4-argon-high");
        assert_eq!(cli_model(&v[0], Some("max")), "gemini-4-argon-medium");
        assert_eq!(cli_model(&claude_models()[0], Some("low")), "opus");
    }
}
