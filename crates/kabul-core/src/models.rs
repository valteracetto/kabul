//! Catálogo de modelos por harness. Gemini/Antigravity vem de `agy models`; os outros são fixos.
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

/// Ids do Codex não confirmados nesta máquina (o binário do codex está quebrado aqui).
pub fn codex_models() -> Vec<Model> {
    vec![
        m(HarnessKind::Codex, "gpt-6.1-sol", "GPT-6.1 Sol", "openai", &["low", "medium", "high", "xhigh"]),
        m(HarnessKind::Codex, "gpt-6.1", "GPT-6.1", "openai", &["low", "medium", "high", "xhigh"]),
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
    Command::new("agy").arg("models").output().ok().filter(|o| o.status.success()).map(|o| parse_agy_models(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
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

pub fn catalog() -> Vec<Model> {
    let mut v = claude_models();
    v.extend(codex_models());
    v.extend(agy_models());
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
