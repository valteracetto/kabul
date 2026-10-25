//! Qwen Code (`qwen`, fork do Gemini CLI) pelo ACP (`qwen --acp`; `--experimental-acp` ainda funciona
//! mas avisa que vai sair), com aprovações no app.
//!
//! Confirmado com Qwen Code 0.26.1 contra o LM Studio (qwen3-8b): sem conta, o `session/new` responde
//! `-32000 Authentication required` com o método `openai`; com `--auth-type openai` e
//! `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL` a sessão abre. O modo nasce `auto` (um classificador
//! aprova sozinho), então o Kabul passa `--approval-mode` e o protocolo acerta o modo pelo `session/set_mode`.
//! O uso do turno chega no `_meta.usage` de um `session/update`, não na resposta do prompt.
use super::*;

pub struct QwenCode;

impl QwenCode {
    fn common(opts: &SessionOptions, a: &mut Vec<String>) -> Vec<(String, String)> {
        let mut env = opts.env.clone();
        let model = opts.endpoint.as_ref().map(|e| e.model.clone()).or_else(|| opts.model.clone());
        if let Some(m) = &model {
            a.extend(["--model".into(), m.clone()]);
        }
        if let Some(ep) = &opts.endpoint {
            // Sem isso o ACP pede login mesmo com as variáveis OPENAI_*.
            a.extend(["--auth-type".into(), "openai".into()]);
            env.extend([("OPENAI_BASE_URL".into(), ep.openai_url()), ("OPENAI_API_KEY".into(), ep.key()), ("OPENAI_MODEL".into(), ep.model.clone())]);
            // O pedido cai em 120 s por padrão; o prompt do Qwen Code (~20 mil tokens) num modelo local
            // passa disso só para ser processado ("Connection error" no meio do turno).
            env.push(("QWEN_CODE_API_TIMEOUT_MS".into(), "900000".into()));
        }
        let mode = match opts.permission_mode.as_deref() {
            Some("plan") => "plan",
            Some("acceptEdits") => "auto-edit",
            Some("bypassPermissions") => "yolo",
            _ => "default",
        };
        a.extend(["--approval-mode".into(), mode.into()]);
        if let Some(r) = &opts.resume {
            a.extend(["--resume".into(), r.clone()]);
        }
        env
    }
}

impl Harness for QwenCode {
    fn kind(&self) -> HarnessKind {
        HarnessKind::QwenCode
    }
    /// Modo estruturado pelo ACP (`qwen --acp`). A retomada é pelo `session/load` do ACP, não por `--resume`.
    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a: Vec<String> = vec!["--acp".into()];
        let env = Self::common(&SessionOptions { resume: None, ..opts.clone() }, &mut a);
        // MCP nativo desligado na sessão.
        for n in &opts.disabled_mcp {
            a.extend(["--disable-mcp-server".into(), n.clone()]);
        }
        CmdSpec::new("qwen", a).with_cwd(opts.cwd.clone()).with_env(&env)
    }
    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        let env = Self::common(opts, &mut a);
        CmdSpec::new("qwen", a).with_cwd(opts.cwd.clone()).with_env(&env)
    }
    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol> {
        Box::new(super::acp::AcpProtocol::new(super::acp::options(opts, None)))
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::TmuxMirror, cloud: Support::TmuxMirror, teleport: Support::TmuxMirror, background: Support::TmuxMirror }
    }
    fn endpoint_apis(&self) -> &'static [Api] {
        &[Api::Openai]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_vira_env_openai() {
        let ep = Endpoint { base_url: "http://h:11434".into(), apis: vec![Api::Openai], api_key: None, model: "qwen3-coder:30b".into(), context: None };
        let c = QwenCode.command(&SessionOptions { endpoint: Some(ep), permission_mode: Some("acceptEdits".into()), ..Default::default() });
        assert!(c.env.contains(&("OPENAI_BASE_URL".into(), "http://h:11434/v1".into())));
        assert!(c.env.iter().any(|(k, _)| k == "QWEN_CODE_API_TIMEOUT_MS"));
        assert!(c.args.windows(2).any(|w| w == ["--model", "qwen3-coder:30b"]));
        assert!(c.args.windows(2).any(|w| w == ["--approval-mode", "auto-edit"]));
        assert!(c.args.windows(2).any(|w| w == ["--auth-type", "openai"]));
        assert_eq!(c.args[0], "--acp");
    }
}
