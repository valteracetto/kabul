//! Qwen Code (`qwen`, fork do Gemini CLI). A CONFIRMAR: o CLI não está instalado nesta máquina.
//! Pela documentação do projeto, `--input-format stream-json --output-format stream-json` segue o
//! mesmo esquema do Claude Code (system/init, assistant, user/tool_result, result, control_request),
//! então reaproveitamos o parser do Claude. Endpoint local: `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL`.
//! Aprovações: `--approval-mode default|plan|auto-edit|yolo`.
use super::claude::ClaudeProtocol;
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
            env.extend([("OPENAI_BASE_URL".into(), ep.openai_url()), ("OPENAI_API_KEY".into(), ep.key()), ("OPENAI_MODEL".into(), ep.model.clone())]);
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
    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a: Vec<String> = ["--input-format", "stream-json", "--output-format", "stream-json"].map(String::from).to_vec();
        let env = Self::common(opts, &mut a);
        CmdSpec::new("qwen", a).with_cwd(opts.cwd.clone()).with_env(&env)
    }
    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        let env = Self::common(opts, &mut a);
        CmdSpec::new("qwen", a).with_cwd(opts.cwd.clone()).with_env(&env)
    }
    fn protocol(&self, _opts: &SessionOptions) -> Box<dyn Protocol> {
        Box::new(ClaudeProtocol::default())
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
        assert!(c.args.windows(2).any(|w| w == ["--model", "qwen3-coder:30b"]));
        assert!(c.args.windows(2).any(|w| w == ["--approval-mode", "auto-edit"]));
    }
}
