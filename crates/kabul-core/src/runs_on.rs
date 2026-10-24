//! Onde uma sessão de agente roda. A UI mostra um selo diferente para cada caso.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunsOn {
    /// Neste Mac (tmux/stdio). `mirrored`: espelhada via remote-control (claude.ai/code, celular).
    Local { #[serde(default)] mirrored: bool },
    /// Na nuvem do próprio provedor de IA (ex.: `claude --cloud` → claude.ai).
    ProviderCloud { provider: String },
    /// Nuvem própria do Kabul (futuro).
    KabulCloud { host: String },
    /// Outra máquina (ex.: via Tailscale).
    Remote { host: String },
}

impl RunsOn {
    pub fn tooltip(&self) -> String {
        match self {
            RunsOn::Local { mirrored: false } => "Rodando neste Mac".into(),
            RunsOn::Local { mirrored: true } => "Rodando neste Mac, espelhada no claude.ai e no celular".into(),
            RunsOn::ProviderCloud { provider } => match provider.as_str() {
                "claude" => "Rodando na nuvem da Anthropic (claude.ai)".into(),
                "codex" => "Rodando na nuvem da OpenAI (Codex)".into(),
                "gemini" => "Rodando na nuvem do Google (Gemini)".into(),
                p => format!("Rodando na nuvem do provedor ({p})"),
            },
            RunsOn::KabulCloud { host } => format!("Rodando na nuvem do Kabul ({host})"),
            RunsOn::Remote { host } => format!("Rodando em {host}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializa_com_tag() {
        let r = RunsOn::ProviderCloud { provider: "claude".into() };
        assert_eq!(serde_json::to_string(&r).unwrap(), r#"{"kind":"provider_cloud","provider":"claude"}"#);
        assert_eq!(r.tooltip(), "Rodando na nuvem da Anthropic (claude.ai)");
        assert_eq!(serde_json::from_str::<RunsOn>(r#"{"kind":"local"}"#).unwrap(), RunsOn::Local { mirrored: false });
    }
}
