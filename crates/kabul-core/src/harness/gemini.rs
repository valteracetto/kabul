//! Gemini CLI (`gemini`). Estruturado pelo ACP (`gemini --acp`; `--experimental-acp` está depreciado).
//! Confirmado com Gemini CLI 0.65.0 até o login: `initialize` anuncia `loadSession` e os `authMethods`
//! (`oauth-personal`, `gemini-api-key`, `vertex-ai`, `gateway`); sem conta o `session/new` responde
//! `-32000 Gemini API key is missing or not configured.` O modo por turno antigo:
//! `gemini -p <prompt> --output-format stream-json [-m modelo] [--resume id] [--approval-mode ...]`.
//! Eventos documentados: `init` (session_id, model), `message` (role, content, delta),
//! `tool_use` (tool_name, tool_id, parameters), `tool_result` (tool_id, status, output), `error`, `result` (stats).
//! Só fala a API do Gemini; modelos locais (Gemma etc.) caem no fallback do registro.
use super::*;

pub struct GeminiCli;

impl Harness for GeminiCli {
    fn kind(&self) -> HarnessKind {
        HarnessKind::GeminiCli
    }
    /// Modo estruturado pelo ACP (`gemini --acp`). O modo por turno
    /// (`-p --output-format stream-json`) continua em [`GeminiCli::print_command`].
    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut c = super::acp::command(HarnessKind::GeminiCli, opts);
        let model = opts.endpoint.as_ref().map(|e| e.model.clone()).or_else(|| opts.model.clone());
        if let Some(m) = &model {
            c.args.extend(["-m".into(), m.clone()]);
        }
        c.env.extend(Self::endpoint_env(opts));
        // Em pasta não confiável o Gemini CLI desliga todo MCP ("disabled because this folder is
        // untrusted"), inclusive os do `session/new`. Com MCP vindo do Kabul, confia nesta sessão pela
        // variável que o próprio `--skip-trust` usa (sem gravar no trustedFolders.json do usuário).
        if !opts.mcp_inject.is_empty() {
            c.env.push(("GEMINI_CLI_TRUST_WORKSPACE".into(), "true".into()));
        }
        // MCP nativo desligado na sessão: só os ligados (nativos + injetados pelo ACP) ficam permitidos.
        if !opts.disabled_mcp.is_empty() {
            let mut allowed: Vec<String> = opts.mcp_keep.iter().cloned().chain(opts.mcp_inject.iter().map(|s| s.name.clone())).collect();
            if allowed.is_empty() {
                allowed.push("kabul-nenhum".into());
            }
            c.args.push("--allowed-mcp-server-names".into());
            c.args.extend(allowed);
        }
        c
    }
    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol> {
        // Sem o `fs` do cliente: com ele o Gemini CLI não cria arquivo novo (ver `AcpOptions::no_client_fs`).
        Box::new(super::acp::AcpProtocol::new(super::acp::AcpOptions { no_client_fs: true, ..super::acp::options(opts, None) }))
    }
    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        if let Some(m) = &opts.model {
            a.extend(["-m".to_string(), m.clone()]);
        }
        CmdSpec::new("gemini", a).with_cwd(opts.cwd.clone()).with_env(&opts.env)
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::TmuxMirror, cloud: Support::TmuxMirror, teleport: Support::TmuxMirror, background: Support::TmuxMirror }
    }
    fn endpoint_apis(&self) -> &'static [Api] {
        &[Api::Gemini]
    }
}

impl GeminiCli {
    /// Endpoint que fala a API do Gemini (gateway/proxy): `GOOGLE_GEMINI_BASE_URL` + `GEMINI_API_KEY`
    /// (o CLI só aceita http em localhost). Confirmado contra um servidor Gemini-compatível de teste.
    pub fn endpoint_env(opts: &SessionOptions) -> Vec<(String, String)> {
        match &opts.endpoint {
            Some(ep) if ep.apis.contains(&Api::Gemini) => vec![("GOOGLE_GEMINI_BASE_URL".into(), ep.base_url.trim_end_matches('/').to_string()), ("GEMINI_API_KEY".into(), ep.key())],
            _ => vec![],
        }
    }

    pub fn print_command(&self, prompt: &str, opts: &SessionOptions) -> Option<CmdSpec> {
        let mut a: Vec<String> = vec!["--output-format".into(), "stream-json".into()];
        if let Some(m) = &opts.model {
            a.extend(["-m".into(), m.clone()]);
        }
        if let Some(r) = &opts.resume {
            a.extend(["--resume".into(), r.clone()]);
        }
        let mode = match opts.permission_mode.as_deref() {
            Some("plan") => "plan",
            Some("acceptEdits") => "auto_edit",
            Some("bypassPermissions") => "yolo",
            _ => "default",
        };
        a.extend(["--approval-mode".into(), mode.into(), "-p".into(), prompt.into()]);
        Some(CmdSpec::new("gemini", a).with_cwd(opts.cwd.clone()).with_env(&opts.env))
    }
}

#[derive(Default)]
pub struct GeminiProtocol {
    usage: (Option<u64>, Option<u64>),
}

impl Protocol for GeminiProtocol {
    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        let line = line.trim();
        if line.is_empty() {
            return (vec![], vec![]);
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { return (vec![Event::Log { line: line.into() }], vec![]) };
        let ev = match v.get("type").and_then(Value::as_str) {
            Some("init") => Event::SessionStarted { session_id: s(&v, "session_id").unwrap_or_default(), model: s(&v, "model") },
            Some("message") if s(&v, "role").as_deref() == Some("assistant") => {
                let text = s(&v, "content").unwrap_or_default();
                if v.get("delta").and_then(Value::as_bool).unwrap_or(false) {
                    Event::TextDelta { text }
                } else {
                    Event::Text { text }
                }
            }
            Some("message") => return (vec![], vec![]),
            Some("tool_use") => Event::ToolUse { id: s(&v, "tool_id").unwrap_or_default(), name: s(&v, "tool_name").unwrap_or_default(), input: v.get("parameters").cloned().unwrap_or(Value::Null) },
            Some("tool_result") => Event::ToolResult { id: s(&v, "tool_id").unwrap_or_default(), output: s(&v, "output").unwrap_or_default(), is_error: s(&v, "status").as_deref() == Some("error") },
            Some("error") => Event::Error { message: s(&v, "message").unwrap_or_else(|| line.into()) },
            Some("result") => {
                let st = v.get("stats").cloned().unwrap_or(Value::Null);
                self.usage = (st.get("input_tokens").and_then(Value::as_u64), st.get("output_tokens").and_then(Value::as_u64));
                Event::TurnCompleted { result: None, input_tokens: self.usage.0, output_tokens: self.usage.1, cost_usd: None }
            }
            _ => Event::Raw { value: v },
        };
        (vec![ev], vec![])
    }
    fn user_message(&mut self, _text: &str) -> Vec<String> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_json_sintetico() {
        let fx = r#"{"type":"init","session_id":"g1","model":"gemini-3-pro"}
{"type":"message","role":"user","content":"oi"}
{"type":"message","role":"assistant","content":"Ol","delta":true}
{"type":"tool_use","tool_name":"list_directory","tool_id":"t1","parameters":{"path":"."}}
{"type":"tool_result","tool_id":"t1","status":"success","output":"a.txt"}
{"type":"result","status":"success","stats":{"input_tokens":10,"output_tokens":3}}"#;
        let (ev, _) = run_fixture(&mut GeminiProtocol::default(), fx);
        assert_eq!(ev.len(), 5);
        assert!(matches!(&ev[1], Event::TextDelta { text } if text == "Ol"));
        assert!(matches!(&ev[4], Event::TurnCompleted { input_tokens: Some(10), .. }));
        let c = GeminiCli.print_command("faz", &SessionOptions { resume: Some("g1".into()), ..Default::default() }).unwrap();
        assert_eq!(c.args.last().unwrap(), "faz");
        let acp = GeminiCli.command(&SessionOptions { model: Some("gemini-x".into()), ..Default::default() });
        assert_eq!(acp.args, vec!["--acp", "-m", "gemini-x"]);
        let ep = Endpoint { base_url: "http://127.0.0.1:9/".into(), apis: vec![Api::Gemini], api_key: None, model: "gemma-x".into(), context: None };
        let acp = GeminiCli.command(&SessionOptions { endpoint: Some(ep), ..Default::default() });
        assert_eq!(acp.args, vec!["--acp", "-m", "gemma-x"]);
        assert!(acp.env.contains(&("GOOGLE_GEMINI_BASE_URL".into(), "http://127.0.0.1:9".into())));
        assert!(GeminiCli.turn_command("x", &SessionOptions::default()).is_none() && GeminiCli.app_approvals());
    }
}
