//! Claude Code: `claude -p --input-format stream-json --output-format stream-json --verbose`.
use super::*;
use serde_json::json;

pub struct ClaudeCode;

impl ClaudeCode {
    /// Endpoint Anthropic-compatível (DeepSeek, Kimi, GLM, MiniMax locais ou remotos).
    pub fn endpoint_env(opts: &SessionOptions) -> Vec<(String, String)> {
        let mut env = opts.env.clone();
        if let Some(ep) = &opts.endpoint {
            env.extend([
                ("ANTHROPIC_BASE_URL".into(), ep.base_url.trim_end_matches('/').to_string()),
                ("ANTHROPIC_AUTH_TOKEN".into(), ep.key()),
                ("ANTHROPIC_MODEL".into(), ep.model.clone()),
                ("ANTHROPIC_SMALL_FAST_MODEL".into(), ep.model.clone()),
                ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(), "1".into()),
            ]);
        }
        env
    }

    fn common(opts: &SessionOptions, a: &mut Vec<String>) {
        let model = opts.endpoint.as_ref().map(|e| e.model.clone()).or_else(|| opts.model.clone());
        let mut push = |k: &str, v: &Option<String>| {
            if let Some(v) = v {
                a.push(k.into());
                a.push(v.clone());
            }
        };
        push("--model", &model);
        push("--effort", &opts.effort);
        push("--permission-mode", &opts.permission_mode);
        push("--resume", &opts.resume);
        if opts.fork && opts.resume.is_some() {
            a.push("--fork-session".into());
        }
        for d in &opts.add_dirs {
            a.push("--add-dir".into());
            a.push(d.clone());
        }
        if let Some(c) = &opts.mcp_config {
            a.extend(["--mcp-config".into(), c.clone(), "--strict-mcp-config".into()]);
        }
    }
}

impl Harness for ClaudeCode {
    fn kind(&self) -> HarnessKind {
        HarnessKind::Claude
    }

    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"].map(String::from).to_vec();
        if opts.approvals_via_app {
            a.push("--permission-prompt-tool=stdio".into());
        }
        Self::common(opts, &mut a);
        CmdSpec::new("claude", a).with_cwd(opts.cwd.clone()).with_env(&Self::endpoint_env(opts))
    }

    fn endpoint_apis(&self) -> &'static [Api] {
        &[Api::Anthropic]
    }

    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        if let Some(n) = &opts.remote_control {
            a.push("--remote-control".into());
            a.push(n.clone());
        }
        Self::common(opts, &mut a);
        CmdSpec::new("claude", a).with_cwd(opts.cwd.clone()).with_env(&Self::endpoint_env(opts))
    }

    fn protocol(&self, _opts: &SessionOptions) -> Box<dyn Protocol> {
        Box::new(ClaudeProtocol::default())
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::Native, cloud: Support::Native, teleport: Support::Native, background: Support::Native }
    }

    fn cloud_run(&self, description: &str, environment: Option<&str>) -> Option<CmdSpec> {
        let mut a = vec!["--cloud".to_string(), description.to_string()];
        if let Some(e) = environment {
            a.extend(["--environment".into(), e.into()]);
        }
        Some(CmdSpec::new("claude", a))
    }

    fn teleport(&self, id: &str) -> Option<CmdSpec> {
        Some(CmdSpec::new("claude", ["--teleport", id]))
    }

    fn background(&self, prompt: &str, opts: &SessionOptions) -> Option<CmdSpec> {
        let mut a = vec!["--bg".to_string()];
        Self::common(opts, &mut a);
        a.push(prompt.into());
        Some(CmdSpec::new("claude", a).with_cwd(opts.cwd.clone()))
    }

    fn background_action(&self, action: &str, id: &str) -> Option<CmdSpec> {
        matches!(action, "attach" | "logs" | "stop" | "rm").then(|| CmdSpec::new("claude", [action, id]))
    }

    fn parse_remote_output(&self, out: &str) -> RemoteHandle {
        let clean = strip_ansi(out);
        let url = find_urls(&clean).into_iter().find(|u| u.contains("claude.ai/code"));
        // A URL real traz query (`?from=cli&m=0`): o id é o último segmento sem ela.
        let mut id = url.as_deref().map(|u| u.split(['?', '#']).next().unwrap_or(u)).and_then(|u| u.trim_end_matches('/').rsplit('/').next()).filter(|s| !s.is_empty()).map(String::from);
        if id.is_none() {
            id = clean.split_whitespace().collect::<Vec<_>>().windows(2).find(|w| w[0] == "--teleport").map(|w| w[1].to_string());
        }
        if id.is_none() {
            // `claude --bg`: "... session <id> ..." / "claude attach <id>"
            id = clean.split_whitespace().collect::<Vec<_>>().windows(2).find(|w| w[0] == "attach" || w[0] == "session").map(|w| w[1].trim_end_matches([',', '.', ')']).to_string());
        }
        RemoteHandle { id, url }
    }
}

#[derive(Default)]
pub struct ClaudeProtocol {
    pub session_id: Option<String>,
}

impl Protocol for ClaudeProtocol {
    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        (parse_claude_line(line, &mut self.session_id), vec![])
    }

    fn user_message(&mut self, text: &str) -> Vec<String> {
        vec![json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":text}]}}).to_string()]
    }

    fn approval_ext(&mut self, request_id: &str, allow: bool, tool: &str, updated_input: Option<Value>, always: bool) -> Vec<String> {
        let mut resp = if allow { json!({"behavior":"allow","updatedInput": updated_input.unwrap_or_else(|| json!({}))}) } else { json!({"behavior":"deny","message":"Negado pelo usuário no Kabul"}) };
        if allow && always {
            resp["updatedPermissions"] = json!([{"type":"addRules","rules":[{"toolName": tool}],"behavior":"allow","destination":"session"}]);
        }
        vec![json!({"type":"control_response","response":{"subtype":"success","request_id":request_id,"response":resp}}).to_string()]
    }

    fn approval(&mut self, request_id: &str, allow: bool) -> Vec<String> {
        let resp = if allow { json!({"behavior":"allow","updatedInput":{}}) } else { json!({"behavior":"deny","message":"Negado pelo usuário no Kabul"}) };
        vec![json!({"type":"control_response","response":{"subtype":"success","request_id":request_id,"response":resp}}).to_string()]
    }
}

/// Nome da pasta do projeto em `~/.claude/projects` (caminho com `/` e `.` trocados por `-`).
pub fn project_dir_name(cwd: &std::path::Path) -> String {
    cwd.display().to_string().chars().map(|c| if c == '/' || c == '.' { '-' } else { c }).collect()
}

/// Copia o transcript de uma sessão para o projeto de outro diretório, para `--resume` funcionar lá
/// (fork para um workspace novo).
pub fn copy_session(id: &str, from_cwd: &std::path::Path, to_cwd: &std::path::Path) -> anyhow::Result<()> {
    let base = std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".claude/projects");
    let src = base.join(project_dir_name(from_cwd)).join(format!("{id}.jsonl"));
    let dir = base.join(project_dir_name(to_cwd));
    std::fs::create_dir_all(&dir)?;
    std::fs::copy(&src, dir.join(format!("{id}.jsonl"))).map(|_| ()).map_err(|e| anyhow::anyhow!("transcript {} não encontrado: {e}", src.display()))
}

pub fn parse_claude_line(line: &str, session: &mut Option<String>) -> Vec<Event> {
    let line = line.trim();
    if line.is_empty() {
        return vec![];
    }
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return vec![Event::Log { line: line.into() }],
    };
    let mut out = vec![];
    match v.get("type").and_then(Value::as_str) {
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
            let id = s(&v, "session_id").unwrap_or_default();
            *session = Some(id.clone());
            out.push(Event::SessionStarted { session_id: id, model: s(&v, "model") });
            let tools: Vec<String> = v.get("tools").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
            let mcp_servers = v.get("mcp_servers").and_then(Value::as_array).map(|a| a.iter().filter_map(|m| Some(McpStatus { name: s(m, "name")?, status: s(m, "status").unwrap_or_default() })).collect()).unwrap_or_default();
            out.push(Event::SessionInfo { tools, mcp_servers });
        }
        Some("assistant") => {
            for b in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => out.push(Event::Text { text: s(b, "text").unwrap_or_default() }),
                    Some("thinking") => out.push(Event::Reasoning { text: s(b, "thinking").unwrap_or_default() }),
                    Some("tool_use") => out.push(Event::ToolUse { id: s(b, "id").unwrap_or_default(), name: s(b, "name").unwrap_or_default(), input: b.get("input").cloned().unwrap_or(Value::Null) }),
                    _ => {}
                }
            }
        }
        Some("user") => {
            for b in v.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                if b.get("type").and_then(Value::as_str) == Some("tool_result") {
                    let output = match b.get("content") {
                        Some(Value::String(t)) => t.clone(),
                        Some(Value::Array(a)) => a.iter().filter_map(|x| x.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"),
                        _ => String::new(),
                    };
                    out.push(Event::ToolResult { id: s(b, "tool_use_id").unwrap_or_default(), output, is_error: b.get("is_error").and_then(Value::as_bool).unwrap_or(false) });
                }
            }
        }
        Some("stream_event") => {
            if let Some(t) = v.pointer("/event/delta/text").and_then(Value::as_str) {
                out.push(Event::TextDelta { text: t.into() });
            }
        }
        Some("control_request") if v.pointer("/request/subtype").and_then(Value::as_str) == Some("can_use_tool") => {
            out.push(Event::ApprovalRequest {
                request_id: s(&v, "request_id").unwrap_or_default(),
                tool: v.pointer("/request/tool_name").and_then(Value::as_str).unwrap_or_default().into(),
                input: v.pointer("/request/input").cloned().unwrap_or(Value::Null),
            });
        }
        Some("result") => {
            if v.get("is_error").and_then(Value::as_bool) == Some(true) {
                out.push(Event::Error { message: s(&v, "result").unwrap_or_else(|| s(&v, "subtype").unwrap_or_default()) });
            }
            out.push(Event::Usage {
                input: v.pointer("/usage/input_tokens").and_then(Value::as_u64),
                output: v.pointer("/usage/output_tokens").and_then(Value::as_u64),
                cache_read: v.pointer("/usage/cache_read_input_tokens").and_then(Value::as_u64),
                cache_write: v.pointer("/usage/cache_creation_input_tokens").and_then(Value::as_u64),
                duration_ms: v.get("duration_ms").and_then(Value::as_u64),
            });
            out.push(Event::TurnCompleted {
                result: s(&v, "result"),
                // Contexto usado = entrada nova + lida do cache + gravada no cache.
                input_tokens: v.pointer("/usage/input_tokens").and_then(Value::as_u64).map(|i| {
                    i + ["/usage/cache_read_input_tokens", "/usage/cache_creation_input_tokens"].iter().filter_map(|k| v.pointer(k).and_then(Value::as_u64)).sum::<u64>()
                }),
                output_tokens: v.pointer("/usage/output_tokens").and_then(Value::as_u64),
                cost_usd: v.get("total_cost_usd").and_then(Value::as_f64),
            });
        }
        _ => out.push(Event::Raw { value: v }),
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_stream() {
        let mut p = ClaudeProtocol::default();
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/claude_stream.ndjson"));
        assert_eq!(p.session_id.as_deref(), Some("c0ffee00-0000-4000-8000-000000000001"));
        assert!(matches!(&ev[0], Event::SessionStarted { model: Some(m), .. } if m == "claude-opus-5-5"));
        assert_eq!(ev[1], Event::SessionInfo { tools: vec!["Bash".into(), "Read".into()], mcp_servers: vec![] });
        assert_eq!(ev[2], Event::Text { text: "Vou listar.".into() });
        assert!(matches!(&ev[3], Event::ToolUse { name, .. } if name == "Bash"));
        assert!(matches!(&ev[4], Event::ToolResult { output, is_error: false, .. } if output.contains("b.txt")));
        assert!(matches!(&ev[6], Event::Usage { .. }));
        assert!(matches!(&ev[7], Event::TurnCompleted { cost_usd: Some(c), output_tokens: Some(20), .. } if *c > 0.01));
    }

    #[test]
    fn init_com_mcp() {
        let mut sid = None;
        let ev = parse_claude_line(r#"{"type":"system","subtype":"init","session_id":"s","tools":["Bash","mcp__linear__list_issues","mcp__linear__get_issue"],"mcp_servers":[{"name":"linear","status":"connected"},{"name":"quebrado","status":"failed"}]}"#, &mut sid);
        assert!(matches!(&ev[1], Event::SessionInfo { tools, mcp_servers } if tools.len() == 3 && mcp_servers[1].status == "failed"));
    }

    #[test]
    fn sempre_permitir_e_respostas() {
        let l = ClaudeProtocol::default().approval_ext("r2", true, "Bash", Some(json!({"answers":{"Q":"A"}})), true);
        let r: Value = serde_json::from_str(&l[0]).unwrap();
        assert_eq!(r.pointer("/response/response/updatedPermissions/0/rules/0/toolName").unwrap(), "Bash");
        assert_eq!(r.pointer("/response/response/updatedInput/answers/Q").unwrap(), "A");
        let d = std::env::temp_dir().join(format!("kabul-proj-{}", std::process::id()));
        assert_eq!(project_dir_name(std::path::Path::new("/home/dev/a.b/c")), "-home-dev-a-b-c");
        let _ = d;
    }

    #[test]
    fn mcp_config_estrito() {
        let o = SessionOptions { mcp_config: Some("/tmp/m.json".into()), ..Default::default() };
        let c = ClaudeCode.command(&o);
        assert!(c.args.windows(3).any(|w| w == ["--mcp-config", "/tmp/m.json", "--strict-mcp-config"]));
    }

    #[test]
    fn aprovacao() {
        let mut sid = None;
        let ev = parse_claude_line(r#"{"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm -rf x"}}}"#, &mut sid);
        assert!(matches!(&ev[0], Event::ApprovalRequest { request_id, tool, .. } if request_id == "r1" && tool == "Bash"));
        let r: Value = serde_json::from_str(&ClaudeProtocol::default().approval("r1", false)[0]).unwrap();
        assert_eq!(r.pointer("/response/request_id").unwrap(), "r1");
        assert_eq!(r.pointer("/response/response/behavior").unwrap(), "deny");
    }

    #[test]
    fn comandos() {
        let o = SessionOptions { model: Some("opus".into()), effort: Some("high".into()), resume: Some("abc".into()), fork: true, approvals_via_app: true, permission_mode: Some("plan".into()), ..Default::default() };
        let c = ClaudeCode.command(&o).args.join(" ");
        assert!(c.starts_with("-p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool=stdio"));
        assert!(c.contains("--resume abc --fork-session") && c.contains("--effort high") && c.contains("--permission-mode plan"));
        let i = ClaudeCode.interactive_command(&SessionOptions { remote_control: Some("kabul-x".into()), ..Default::default() });
        assert_eq!(i.args, vec!["--remote-control", "kabul-x"]);
        assert_eq!(ClaudeCode.cloud_run("faz x", Some("env1")).unwrap().args, vec!["--cloud", "faz x", "--environment", "env1"]);
        assert_eq!(ClaudeCode.teleport("s1").unwrap().args, vec!["--teleport", "s1"]);
        assert_eq!(ClaudeCode.background("oi", &SessionOptions::default()).unwrap().args, vec!["--bg", "oi"]);
        assert!(ClaudeCode.background_action("format-disk", "x").is_none());
    }

    #[test]
    fn saida_nuvem_e_bg() {
        let r = ClaudeCode.parse_remote_output(include_str!("../../tests/fixtures/claude_cloud_cli.txt"));
        assert_eq!(r.id.as_deref(), Some("session_01AbcDefGhiJklMnoPqrStu"));
        assert!(r.url.as_deref().unwrap().starts_with("https://claude.ai/code/session_01AbcDefGhiJklMnoPqrStu"));
        let h = ClaudeCode.parse_remote_output(include_str!("../../tests/fixtures/claude_cloud.txt"));
        assert_eq!(h.id.as_deref(), Some("session_01AbCdEfGh123"));
        assert_eq!(h.url.as_deref(), Some("https://claude.ai/code/session_01AbCdEfGh123"));
        let b = ClaudeCode.parse_remote_output(include_str!("../../tests/fixtures/claude_bg.txt"));
        assert_eq!(b.id.as_deref(), Some("bg-7f3a"));
        assert!(b.url.is_none());
    }
}
