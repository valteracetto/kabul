//! OpenCode. Modo estruturado pelo ACP (`opencode acp`, ver [`super::acp`]): sessão persistente e
//! aprovações no app (`session/request_permission`). O modo antigo por turno
//! (`opencode run --format json`) fica em [`OpenCode::run_command`] e [`OpenCodeProtocol`].
//!
//! Confirmado nesta máquina (v2.1.4, `opencode run --help` e turno real com qwen3-8b no LM Studio):
//! linhas `step_start` | `text` | `tool_use` (com `state.input/output/status`) | `step_finish` (tokens, custo).
//! Modelos locais entram como provider `kabul` openai-compatible via `OPENCODE_CONFIG_CONTENT`.
//! Aprovações: `run` não pergunta; sem `--auto`, pedidos de permissão são negados (a confirmar). Para
//! aprovação interativa o caminho é `opencode serve` (API HTTP/SSE), ainda pendente no Kabul.
use super::*;
use serde_json::json;

pub struct OpenCode;

pub const PROVIDER: &str = "kabul";

/// Config injetada com o provider do endpoint local/custom.
/// Config com os MCPs desligados nesta sessão (`mcp.<nome>.enabled = false`).
pub fn mcp_overrides(disabled: &[String]) -> serde_json::Map<String, Value> {
    disabled.iter().map(|n| (n.clone(), json!({ "enabled": false }))).collect()
}

pub fn config_for(ep: &Endpoint) -> String {
    let mut models = serde_json::Map::new();
    let mut m = json!({ "name": ep.model });
    if let Some(c) = ep.context {
        m["limit"] = json!({ "context": c, "output": 8192 });
    }
    models.insert(ep.model.clone(), m);
    json!({ "provider": { PROVIDER: { "npm": "@ai-sdk/openai-compatible", "name": "Kabul (local)", "options": { "baseURL": ep.openai_url(), "apiKey": ep.key() }, "models": models } } }).to_string()
}

impl Harness for OpenCode {
    fn kind(&self) -> HarnessKind {
        HarnessKind::OpenCode
    }

    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        // Mesmo ambiente do modo por turno (endpoint local e MCPs desligados via OPENCODE_CONFIG_CONTENT).
        let mut env = self.run_command("", opts).env;
        // O padrão do OpenCode aprova edição e shell sozinho: sem `ask` o cartão de aprovação do Kabul
        // nunca aparece. O modo do Kabul vira `permission` (por cima de um `permission` já passado).
        let mut cfg: Value = env.iter().rev().find(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").and_then(|(_, v)| serde_json::from_str(v).ok()).unwrap_or(json!({}));
        let (edit, bash) = match opts.permission_mode.as_deref() {
            Some("bypassPermissions") => ("allow", "allow"),
            Some("acceptEdits") => ("allow", "ask"),
            _ => ("ask", "ask"),
        };
        let mut perm = json!({ "edit": edit, "bash": bash, "webfetch": bash });
        if let Some(o) = cfg.get("permission").and_then(Value::as_object) {
            for (k, v) in o {
                perm[k] = v.clone();
            }
        }
        cfg["permission"] = perm;
        env.retain(|(k, _)| k != "OPENCODE_CONFIG_CONTENT");
        env.push(("OPENCODE_CONFIG_CONTENT".into(), cfg.to_string()));
        CmdSpec::new("opencode", ["acp"]).with_cwd(opts.cwd.clone()).with_env(&env)
    }

    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        self.tui_command(opts)
    }

    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol> {
        let model = match &opts.endpoint {
            Some(ep) => Some(format!("{PROVIDER}/{}", ep.model)),
            None => opts.model.clone(),
        };
        // MCPs injetados vão pela config (ver `run_command`), não pelo `session/new`.
        Box::new(super::acp::AcpProtocol::new(super::acp::AcpOptions { mcp_servers: vec![], ..super::acp::options(opts, model) }))
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::TmuxMirror, cloud: Support::TmuxMirror, teleport: Support::TmuxMirror, background: Support::TmuxMirror }
    }

    fn endpoint_apis(&self) -> &'static [Api] {
        &[Api::Openai, Api::Anthropic]
    }

    /// O `opencode acp` 2.1.4 não anuncia modos (o agente `plan` do TUI não aparece no ACP): o Kabul
    /// emula (confirmado no teste `plan_real`).
    fn plan_support(&self) -> PlanSupport {
        PlanSupport::Emulated
    }
}

impl OpenCode {
    /// Modo antigo, um processo por turno: `opencode run --format json … -- <mensagem>`.
    pub fn run_command(&self, prompt: &str, opts: &SessionOptions) -> CmdSpec {
        let mut a: Vec<String> = ["run", "--format", "json"].map(String::from).to_vec();
        let mut env = opts.env.clone();
        if let Some(ep) = &opts.endpoint {
            // Servidor privado: o serviço de fundo do opencode não enxerga a config injetada.
            a.push("--standalone".into());
            a.extend(["-m".into(), format!("{PROVIDER}/{}", ep.model)]);
            env.push(("OPENCODE_CONFIG_CONTENT".into(), config_for(ep)));
        } else if let Some(m) = &opts.model {
            a.extend(["-m".into(), m.clone()]);
        }
        if let Some(e) = &opts.effort {
            if let Some(i) = a.iter().position(|x| x == "-m") {
                a[i + 1] = format!("{}#{e}", a[i + 1]);
            }
        }
        if let Some(s) = &opts.resume {
            a.extend(["--session".into(), s.clone()]);
            if opts.fork {
                a.push("--fork".into());
            }
        }
        if !opts.disabled_mcp.is_empty() || !opts.mcp_inject.is_empty() {
            let mut cfg: Value = env.iter().find(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").and_then(|(_, v)| serde_json::from_str(v).ok()).unwrap_or(json!({}));
            // MCPs de outras IAs pela config do próprio OpenCode: o `opencode acp` 2.1.4 ignora o
            // `mcpServers` do `session/new` (confirmado com um servidor de teste).
            let mut m = mcp_overrides(&opts.disabled_mcp);
            for s in &opts.mcp_inject {
                m.insert(
                    s.name.clone(),
                    match &s.url {
                        Some(u) => json!({ "type": "remote", "url": u, "headers": s.headers }),
                        None => json!({ "type": "local", "command": std::iter::once(s.command.clone().unwrap_or_default()).chain(s.args.iter().cloned()).collect::<Vec<_>>(), "environment": s.env }),
                    },
                );
            }
            cfg["mcp"] = Value::Object(m);
            env.retain(|(k, _)| k != "OPENCODE_CONFIG_CONTENT");
            env.push(("OPENCODE_CONFIG_CONTENT".into(), cfg.to_string()));
            if !a.contains(&"--standalone".to_string()) {
                a.insert(3, "--standalone".into());
            }
        }
        match opts.permission_mode.as_deref() {
            Some("plan") => a.extend(["--agent".into(), "plan".into()]),
            Some("bypassPermissions") | Some("acceptEdits") => a.push("--auto".into()),
            _ => {}
        }
        a.push("--".into());
        a.push(prompt.into());
        CmdSpec::new("opencode", a).with_cwd(opts.cwd.clone()).with_env(&env)
    }

    fn tui_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        let mut env = opts.env.clone();
        if let Some(ep) = &opts.endpoint {
            a.extend(["-m".into(), format!("{PROVIDER}/{}", ep.model)]);
            env.push(("OPENCODE_CONFIG_CONTENT".into(), config_for(ep)));
        } else if let Some(m) = &opts.model {
            a.extend(["-m".to_string(), m.clone()]);
        }
        if let Some(s) = &opts.resume {
            a.extend(["--session".into(), s.clone()]);
        }
        CmdSpec::new("opencode", a).with_cwd(opts.cwd.clone()).with_env(&env)
    }
}

#[derive(Default)]
pub struct OpenCodeProtocol {
    session: Option<String>,
    input: u64,
    output: u64,
    cost: f64,
}

impl Protocol for OpenCodeProtocol {
    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        let line = line.trim();
        if line.is_empty() {
            return (vec![], vec![]);
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return (vec![Event::Log { line: line.into() }], vec![]),
        };
        let mut out = vec![];
        if let Some(sid) = s(&v, "sessionID") {
            if self.session.as_deref() != Some(&sid) {
                self.session = Some(sid.clone());
                out.push(Event::SessionStarted { session_id: sid, model: None });
            }
        }
        let part = v.get("part").cloned().unwrap_or(Value::Null);
        match v.get("type").and_then(Value::as_str) {
            Some("text") => {
                let t = s(&part, "text").unwrap_or_default();
                if !t.trim().is_empty() {
                    out.push(Event::Text { text: t.trim().to_string() });
                }
            }
            Some("reasoning") => out.push(Event::Reasoning { text: s(&part, "text").unwrap_or_default() }),
            Some("tool_use") => {
                let id = s(&part, "id").or_else(|| s(&part, "callID")).unwrap_or_default();
                let st = part.get("state").cloned().unwrap_or(Value::Null);
                out.push(Event::ToolUse { id: id.clone(), name: s(&part, "tool").unwrap_or_default(), input: st.get("input").cloned().unwrap_or(Value::Null) });
                match st.get("status").and_then(Value::as_str) {
                    Some("completed") => out.push(Event::ToolResult { id, output: s(&st, "output").unwrap_or_default(), is_error: false }),
                    Some("error") => out.push(Event::ToolResult { id, output: s(&st, "error").unwrap_or_default(), is_error: true }),
                    _ => {}
                }
            }
            Some("step_finish") => {
                let t = part.get("tokens").cloned().unwrap_or(Value::Null);
                self.input += t.get("input").and_then(Value::as_u64).unwrap_or(0);
                self.output += t.get("output").and_then(Value::as_u64).unwrap_or(0);
                self.cost += part.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
            }
            Some("error") => out.push(Event::Error { message: v.pointer("/error/data/message").or_else(|| v.pointer("/error/message")).and_then(Value::as_str).unwrap_or(line).to_string() }),
            Some("step_start") => {}
            _ => out.push(Event::Raw { value: v }),
        }
        (out, vec![])
    }

    fn user_message(&mut self, _text: &str) -> Vec<String> {
        vec![]
    }

    fn finish(&mut self) -> Event {
        Event::TurnCompleted { result: None, input_tokens: Some(self.input), output_tokens: Some(self.output), cost_usd: Some(self.cost) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_real_qwen3_8b() {
        let mut p = OpenCodeProtocol::default();
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/opencode_run.ndjson"));
        assert!(matches!(&ev[0], Event::SessionStarted { session_id, .. } if session_id.starts_with("ses_")));
        assert!(ev.iter().any(|e| matches!(e, Event::ToolUse { name, .. } if name == "glob")));
        assert!(ev.iter().any(|e| matches!(e, Event::ToolResult { output, .. } if output.contains("main.rs"))));
        assert!(ev.iter().any(|e| matches!(e, Event::Text { text } if text.contains("README.md"))));
        assert!(matches!(p.finish(), Event::TurnCompleted { input_tokens: Some(12709), .. }));
    }

    #[test]
    fn comando_com_endpoint() {
        let ep = Endpoint { base_url: "http://127.0.0.1:1234".into(), apis: vec![Api::Openai], api_key: None, model: "qwen3-8b".into(), context: Some(40960) };
        let o = SessionOptions { endpoint: Some(ep), resume: Some("ses_1".into()), permission_mode: Some("plan".into()), ..Default::default() };
        let c = OpenCode.run_command("oi", &o);
        assert_eq!(c.args[..6], ["run", "--format", "json", "--standalone", "-m", "kabul/qwen3-8b"]);
        assert!(c.args.windows(2).any(|w| w == ["--session", "ses_1"]));
        assert!(c.args.windows(2).any(|w| w == ["--agent", "plan"]));
        assert_eq!(c.args.last().unwrap(), "oi");
        let cfg = &c.env.iter().find(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").unwrap().1;
        assert!(cfg.contains("http://127.0.0.1:1234/v1") && cfg.contains("40960"));
        // Modo estruturado pelo ACP, com o mesmo ambiente; o turno não é mais um processo.
        let acp = OpenCode.command(&o);
        assert_eq!(acp.args, vec!["acp"]);
        let cfg: Value = serde_json::from_str(&acp.env.iter().find(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").unwrap().1).unwrap();
        assert_eq!((cfg["permission"]["edit"].as_str(), cfg["permission"]["bash"].as_str()), (Some("ask"), Some("ask")));
        assert!(cfg["provider"]["kabul"].is_object(), "endpoint continua na mesma config");
        let auto = OpenCode.command(&SessionOptions { permission_mode: Some("bypassPermissions".into()), env: vec![("OPENCODE_CONFIG_CONTENT".into(), r#"{"permission":{"bash":"deny"}}"#.into())], ..Default::default() });
        let cfg: Value = serde_json::from_str(&auto.env.iter().find(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").unwrap().1).unwrap();
        assert_eq!((cfg["permission"]["edit"].as_str(), cfg["permission"]["bash"].as_str()), (Some("allow"), Some("deny")));
        assert_eq!(auto.env.iter().filter(|(k, _)| k == "OPENCODE_CONFIG_CONTENT").count(), 1);
        assert!(OpenCode.turn_command("oi", &o).is_none());
        assert!(OpenCode.app_approvals());
    }
}
