//! Registro "melhor harness por família" (JSON versionado em `config/harness-registry.json`,
//! sobrescrito pelo usuário em `<estado>/harness-registry.json`, editável na UI).
use crate::harness::{Api, HarnessKind};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT: &str = include_str!("../config/harness-registry.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Family {
    pub family: String,
    /// Trechos procurados no id do modelo (minúsculo). Vazio = coringa.
    #[serde(rename = "match")]
    pub matches: Vec<String>,
    /// Ordem de preferência: `claude`, `codex`, `qwen`, `opencode`, `gemini`, `agy`.
    pub harnesses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Registry {
    pub version: u32,
    #[serde(default)]
    pub comment: Option<String>,
    pub families: Vec<Family>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Resolution {
    pub family: String,
    /// Harness escolhido (primeiro instalado e compatível com o endpoint).
    pub harness: Option<HarnessKind>,
    /// Preferidos que não estão instalados mas seriam compatíveis (oferecer instalação).
    pub missing: Vec<HarnessKind>,
    pub note: String,
}

impl Registry {
    pub fn parse(s: &str) -> Result<Self> {
        let r: Registry = serde_json::from_str(s).context("registro de harness inválido")?;
        for f in &r.families {
            for h in &f.harnesses {
                HarnessKind::parse(h).with_context(|| format!("harness desconhecido no registro: {h}"))?;
            }
        }
        Ok(r)
    }

    pub fn load(user_file: &Path) -> Self {
        std::fs::read_to_string(user_file).ok().and_then(|s| Self::parse(&s).ok()).unwrap_or_else(|| Self::parse(DEFAULT).unwrap())
    }

    pub fn family_of(&self, model_id: &str) -> &Family {
        let id = model_id.to_lowercase();
        self.families.iter().find(|f| !f.matches.is_empty() && f.matches.iter().any(|m| id.contains(m.as_str()))).or_else(|| self.families.iter().find(|f| f.matches.is_empty())).unwrap_or(&self.families[0])
    }

    /// Escolhe o harness para um modelo servido com `apis`. `installed` diz se o CLI existe.
    pub fn resolve(&self, model_id: &str, apis: &[Api], installed: &dyn Fn(HarnessKind) -> bool) -> Resolution {
        let f = self.family_of(model_id);
        let mut missing = vec![];
        let mut chosen = None;
        let mut skipped = vec![];
        for h in f.harnesses.iter().filter_map(|h| HarnessKind::parse(h)) {
            let compatible = h.harness().endpoint_apis().iter().any(|a| apis.contains(a));
            if !compatible {
                skipped.push(format!("{} não fala {}", h.label(), apis.iter().map(|a| format!("{a:?}").to_lowercase()).collect::<Vec<_>>().join("/")));
                continue;
            }
            if installed(h) {
                chosen.get_or_insert(h);
            } else if chosen.is_none() {
                missing.push(h);
            }
        }
        let note = match (&chosen, missing.first()) {
            (Some(h), None) => format!("{} → {}", f.family, h.label()),
            (Some(h), Some(m)) => format!("{} → {} ({} preferido, não instalado)", f.family, h.label(), m.label()),
            (None, _) => format!("nenhum harness compatível instalado para {}{}", f.family, if skipped.is_empty() { String::new() } else { format!(": {}", skipped.join("; ")) }),
        };
        Resolution { family: f.family.clone(), harness: chosen, missing, note }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn padrao_e_resolucao() {
        let r = Registry::parse(DEFAULT).unwrap();
        assert_eq!(r.family_of("qwen3-coder-30b-a3b-instruct").family, "qwen");
        assert_eq!(r.family_of("openai/gpt-oss-20b").family, "gpt-oss");
        assert_eq!(r.family_of("llama-3.3-70b").family, "outros");
        let all = |_: HarnessKind| true;
        let none_but_oc = |h: HarnessKind| h == HarnessKind::OpenCode;
        // Qwen com Qwen Code instalado.
        assert_eq!(r.resolve("qwen3-8b", &[Api::Openai], &all).harness, Some(HarnessKind::QwenCode));
        // Sem Qwen Code: OpenCode, oferecendo instalar o Qwen Code.
        let q = r.resolve("qwen3-8b", &[Api::Openai], &none_but_oc);
        assert_eq!((q.harness, q.missing.clone()), (Some(HarnessKind::OpenCode), vec![HarnessKind::QwenCode]));
        // DeepSeek: Claude só se o endpoint falar Anthropic.
        assert_eq!(r.resolve("deepseek-v3", &[Api::Openai, Api::Anthropic], &all).harness, Some(HarnessKind::Claude));
        assert_eq!(r.resolve("deepseek-v3", &[Api::Openai], &all).harness, Some(HarnessKind::OpenCode));
        // Gemma: Gemini CLI não fala OpenAI → OpenCode.
        assert_eq!(r.resolve("gemma-3-27b", &[Api::Openai], &all).harness, Some(HarnessKind::OpenCode));
        // ...e com um gateway que fala a API do Gemini, o Gemini CLI.
        assert_eq!(r.resolve("gemma-3-27b", &[Api::Gemini], &all).harness, Some(HarnessKind::GeminiCli));
        // LM Studio (OpenAI + Anthropic): Qwen → Qwen Code; outros → OpenCode, depois Goose.
        let lms = [Api::Openai, Api::Anthropic];
        assert_eq!(r.resolve("qwen3-coder-30b-a3b-instruct", &lms, &all).harness, Some(HarnessKind::QwenCode));
        assert_eq!(r.resolve("llama-3.3-70b", &lms, &all).harness, Some(HarnessKind::OpenCode));
        assert_eq!(r.resolve("llama-3.3-70b", &lms, &|h| h == HarnessKind::Goose).harness, Some(HarnessKind::Goose));
        // gpt-oss → Codex.
        assert_eq!(r.resolve("gpt-oss:20b", &[Api::Openai], &all).harness, Some(HarnessKind::Codex));
        assert!(Registry::parse(r#"{"version":1,"families":[{"family":"x","match":[],"harnesses":["nada"]}]}"#).is_err());
    }
}
