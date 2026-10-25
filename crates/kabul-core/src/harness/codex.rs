//! Codex. Modo principal: `codex app-server --listen stdio://`, JSON-RPC por linha
//! (`initialize` → `thread/start|thread/resume` → `turn/start`). Alternativa: `codex exec --json`.
//!
//! Confirmado com codex-cli 0.164 contra um servidor Responses de teste (`tests/fake-llm.mjs`, teste
//! ignorado `acp_real` com `KABUL_TESTE_ACP_AGENTE=codex`): thread/start, aprovação de comando aceita e
//! recusada, turn/interrupt e thread/resume. As fixtures continuam sintéticas; `codex cloud` a confirmar.
use super::*;
use serde_json::json;

pub struct Codex;

impl Harness for Codex {
    fn kind(&self) -> HarnessKind {
        HarnessKind::Codex
    }

    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = local_overrides(opts);
        // MCPs de outras IAs (`-c mcp_servers.<nome>.*`, segredos pelo ambiente) e nativos desligados.
        let plan = crate::mcp_share::Plan { inject: opts.mcp_inject.clone(), disable_native: opts.disabled_mcp.clone(), ..Default::default() };
        let (mcp, env) = crate::mcp_share::codex_overrides(&plan);
        a.extend(mcp);
        a.extend(["app-server", "--listen", "stdio://"].map(String::from));
        CmdSpec::new("codex", a).with_cwd(opts.cwd.clone()).with_env(&opts.env).with_env(&env)
    }

    fn endpoint_apis(&self) -> &'static [Api] {
        &[Api::Openai]
    }

    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        if let Some(m) = &opts.model {
            a.extend(["--model".to_string(), m.clone()]);
        }
        if let Some(r) = &opts.resume {
            a = vec!["resume".into(), r.clone()];
        }
        CmdSpec::new("codex", a).with_cwd(opts.cwd.clone())
    }

    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol> {
        Box::new(CodexAppServer::new(opts.clone()))
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::TmuxMirror, cloud: Support::Unconfirmed, teleport: Support::Unconfirmed, background: Support::TmuxMirror }
    }

    /// `codex cloud exec` (a confirmar).
    fn cloud_run(&self, description: &str, environment: Option<&str>) -> Option<CmdSpec> {
        let mut a = vec!["cloud".to_string(), "exec".into()];
        if let Some(e) = environment {
            a.extend(["--env".into(), e.into()]);
        }
        a.push(description.into());
        Some(CmdSpec::new("codex", a))
    }

    /// `codex apply <task_id>` aplica o diff da tarefa de nuvem localmente (a confirmar).
    fn teleport(&self, id: &str) -> Option<CmdSpec> {
        Some(CmdSpec::new("codex", ["apply", id]))
    }

    fn parse_remote_output(&self, out: &str) -> RemoteHandle {
        let mut h = parse_remote_generic(out);
        if h.id.is_none() {
            h.id = strip_ansi(out).split_whitespace().find(|w| w.starts_with("task_")).map(String::from);
        }
        h
    }
}

/// Provider local via `-c` (gpt-oss etc.). Confirmado com codex-cli 0.164: `wire_api = "chat"` não é mais
/// aceito (erro ao carregar a config); o servidor precisa da API Responses (`/v1/responses`, que o LM Studio expõe).
pub fn local_overrides(opts: &SessionOptions) -> Vec<String> {
    let Some(ep) = &opts.endpoint else { return vec![] };
    [
        "model_providers.kabul.name=\"Kabul local\"".to_string(),
        format!("model_providers.kabul.base_url=\"{}\"", ep.openai_url()),
        "model_providers.kabul.wire_api=\"responses\"".into(),
        "model_provider=\"kabul\"".into(),
        format!("model=\"{}\"", ep.model),
    ]
    .into_iter()
    .flat_map(|c| ["-c".to_string(), c])
    .collect()
}

/// Comando `codex exec --json` (modo one-shot).
pub fn exec_command(prompt: &str, opts: &SessionOptions) -> CmdSpec {
    let mut a = vec!["exec".to_string(), "--json".into()];
    if let Some(m) = &opts.model {
        a.extend(["--model".into(), m.clone()]);
    }
    if let Some(r) = &opts.resume {
        a.extend(["resume".into(), r.clone()]);
    }
    a.push(prompt.into());
    CmdSpec::new("codex", a).with_cwd(opts.cwd.clone())
}

const ID_INIT: u64 = 1;
const ID_THREAD: u64 = 2;

pub struct CodexAppServer {
    opts: SessionOptions,
    next_id: u64,
    pub thread_id: Option<String>,
    /// Turno em andamento (`turn/started`), para o `turn/interrupt`.
    pub turn_id: Option<String>,
    queued: Vec<String>,
    /// Pedidos de elicitação MCP em aberto (a resposta tem outro formato).
    elicitations: std::collections::HashSet<String>,
    /// Modelo da thread (o `collaborationMode` pede o modelo).
    thread_model: Option<String>,
    /// Saiu do plan mode: o próximo turno manda `collaborationMode` default.
    left_plan: bool,
}

impl CodexAppServer {
    pub fn new(opts: SessionOptions) -> Self {
        Self { opts, next_id: 3, thread_id: None, turn_id: None, queued: vec![], elicitations: Default::default(), thread_model: None, left_plan: false }
    }

    fn turn(&mut self, text: &str) -> String {
        let id = self.next_id;
        self.next_id += 1;
        let mut p = json!({"threadId": self.thread_id, "input": [{"type":"text","text":text}]});
        if let Some(m) = &self.opts.model {
            p["model"] = json!(m);
        }
        if let Some(e) = &self.opts.effort {
            p["effort"] = json!(e);
        }
        if let Some(c) = &self.opts.cwd {
            p["cwd"] = json!(c);
        }
        // Plan mode nativo do Codex (`collaborationMode/list`: plan | default). Depois de sair do plan,
        // o próximo turno manda `default` uma vez para voltar.
        let plan = self.opts.permission_mode.as_deref() == Some("plan");
        if plan || self.left_plan {
            let model = self.opts.model.clone().or_else(|| self.thread_model.clone()).unwrap_or_default();
            p["collaborationMode"] = json!({ "mode": if plan { "plan" } else { "default" }, "settings": { "model": model, "reasoning_effort": Value::Null, "developer_instructions": Value::Null } });
            self.left_plan = false;
        }
        json!({"id": id, "method": "turn/start", "params": p}).to_string()
    }
}

impl Protocol for CodexAppServer {
    /// `turn/interrupt` do app-server: para o turno; a thread continua.
    fn interrupt(&mut self) -> Option<Vec<String>> {
        let (thread, turn) = (self.thread_id.clone()?, self.turn_id.clone()?);
        let id = self.next_id;
        self.next_id += 1;
        Some(vec![json!({"id": id, "method": "turn/interrupt", "params": {"threadId": thread, "turnId": turn}}).to_string()])
    }
    fn startup(&mut self) -> Vec<String> {
        // `experimentalApi`: sem ela o app-server descarta em silêncio o `turn/start` com `collaborationMode`
        // (o turno nunca começa; confirmado com codex-cli 0.164).
        let init = json!({"id": ID_INIT, "method": "initialize", "params": {"clientInfo": {"name": "kabul", "title": "Kabul", "version": env!("CARGO_PKG_VERSION")}, "capabilities": {"experimentalApi": true}}});
        let thread = match &self.opts.resume {
            Some(t) => json!({"id": ID_THREAD, "method": "thread/resume", "params": {"threadId": t}}),
            None => {
                let mut p = json!({});
                if let Some(c) = &self.opts.cwd {
                    p["cwd"] = json!(c);
                }
                if let Some(m) = &self.opts.model {
                    p["model"] = json!(m);
                }
                // O app-server só aceita `untrusted|on-request|granular|never` (confirmado com codex-cli 0.164:
                // "unknown variant `default`"). Plan mode é o `collaborationMode` plan de cada turno.
                if let Some(m) = &self.opts.permission_mode {
                    let (policy, sandbox): (&str, Option<&str>) = match m.as_str() {
                        "plan" => ("untrusted", None),
                        "acceptEdits" => ("on-request", None),
                        "bypassPermissions" => ("never", None),
                        "default" => ("untrusted", None),
                        other => (other, None),
                    };
                    p["approvalPolicy"] = json!(policy);
                    if let Some(s) = sandbox {
                        p["sandbox"] = json!(s);
                    }
                }
                json!({"id": ID_THREAD, "method": "thread/start", "params": p})
            }
        };
        vec![init.to_string(), json!({"method":"initialized"}).to_string(), thread.to_string()]
    }

    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        let line = line.trim();
        if line.is_empty() {
            return (vec![], vec![]);
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return (vec![Event::Log { line: line.into() }], vec![]),
        };
        let method = v.get("method").and_then(Value::as_str);
        let mut out = vec![];
        let mut replies = vec![];
        match (v.get("id"), method) {
            // Resposta a uma requisição nossa.
            (Some(id), None) => {
                if let Some(e) = v.get("error") {
                    out.push(Event::Error { message: friendly_error(&s(e, "message").unwrap_or_else(|| e.to_string())) });
                } else if id.as_u64() == Some(ID_THREAD) {
                    if let Some(t) = v.pointer("/result/thread/id").and_then(Value::as_str) {
                        self.thread_id = Some(t.into());
                        self.thread_model = v.pointer("/result/model").and_then(Value::as_str).map(String::from);
                        out.push(Event::SessionStarted { session_id: t.into(), model: v.pointer("/result/model").and_then(Value::as_str).map(String::from) });
                        for q in std::mem::take(&mut self.queued) {
                            replies.push(self.turn(&q));
                        }
                    }
                }
            }
            // Requisição do servidor (aprovação).
            // Plan mode: o modo plan do Codex não impede o comando se o app aprovar; o Kabul recusa sozinho.
            (Some(id), Some(m)) if m.ends_with("requestApproval") && self.opts.permission_mode.as_deref() == Some("plan") => {
                replies.push(json!({"id": id, "result": {"decision": "decline"}}).to_string());
                out.push(Event::Log { line: format!("plan mode: {m} recusado") });
            }
            (Some(id), Some(m)) if m.ends_with("requestApproval") => {
                let p = &v["params"];
                let tool = if m.contains("commandExecution") {
                    "commandExecution"
                } else if m.contains("fileChange") {
                    "fileChange"
                } else {
                    m
                };
                out.push(Event::ApprovalRequest { request_id: id.to_string().trim_matches('"').into(), tool: tool.into(), input: p.clone() });
            }
            // Ferramenta de MCP: o Codex 0.164 pergunta por elicitação MCP (`_meta.codex_approval_kind =
            // mcp_tool_call`), não por `*requestApproval`. Sem resposta o turno fica parado.
            (Some(id), Some("mcpServer/elicitation/request")) => {
                let p = &v["params"];
                let rid = id.to_string().trim_matches('"').to_string();
                self.elicitations.insert(rid.clone());
                let server = s(p, "serverName").unwrap_or_default();
                let msg = s(p, "message").unwrap_or_default();
                let tool = msg.split('"').nth(1).map(|t| format!("mcp__{server}__{t}")).unwrap_or_else(|| format!("mcp__{server}"));
                let mut input = p.pointer("/_meta/tool_params").cloned().unwrap_or(json!({}));
                if let Some(o) = input.as_object_mut() {
                    o.insert("message".into(), json!(msg));
                }
                out.push(Event::ApprovalRequest { request_id: rid, tool, input });
            }
            (_, Some("item/agentMessage/delta")) => out.push(Event::TextDelta { text: v.pointer("/params/delta").and_then(Value::as_str).unwrap_or_default().into() }),
            (_, Some("item/reasoning/textDelta")) | (_, Some("item/reasoning/summaryTextDelta")) => out.push(Event::Reasoning { text: v.pointer("/params/delta").and_then(Value::as_str).unwrap_or_default().into() }),
            (_, Some("item/started")) => {
                let it = &v["params"]["item"];
                match it.get("type").and_then(Value::as_str) {
                    Some("commandExecution") => out.push(Event::ToolUse { id: s(it, "id").unwrap_or_default(), name: "commandExecution".into(), input: json!({"command": it.get("command")}) }),
                    Some("fileChange") | Some("mcpToolCall") | Some("webSearch") => out.push(Event::ToolUse { id: s(it, "id").unwrap_or_default(), name: s(it, "type").unwrap_or_default(), input: it.clone() }),
                    _ => {}
                }
            }
            (_, Some("item/completed")) => {
                let it = &v["params"]["item"];
                let id = s(it, "id").unwrap_or_default();
                match it.get("type").and_then(Value::as_str) {
                    Some("agentMessage") => out.push(Event::Text { text: s(it, "text").unwrap_or_default() }),
                    Some("reasoning") => {}
                    // A própria mensagem do usuário volta como item: não é ferramenta.
                    Some("userMessage") => {}
                    Some("commandExecution") => out.push(Event::ToolResult { id, output: s(it, "aggregatedOutput").unwrap_or_default(), is_error: it.get("exitCode").and_then(Value::as_i64).is_some_and(|c| c != 0) }),
                    Some(t) => out.push(Event::ToolResult { id, output: t.into(), is_error: it.get("status").and_then(Value::as_str) == Some("failed") }),
                    None => {}
                }
            }
            (_, Some("turn/completed")) => {
                self.turn_id = None;
                let t = &v["params"]["turn"];
                if t.get("status").and_then(Value::as_str) == Some("failed") {
                    out.push(Event::Error { message: friendly_error(t.pointer("/error/message").and_then(Value::as_str).unwrap_or("turno falhou")) });
                }
                out.push(Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None });
            }
            (_, Some("error")) => out.push(Event::Error { message: friendly_error(v.pointer("/params/error/message").and_then(Value::as_str).unwrap_or("erro")) }),
            (_, Some("turn/started")) => self.turn_id = v.pointer("/params/turn/id").and_then(Value::as_str).map(String::from),
            (_, Some("thread/started")) => {}
            _ => out.push(Event::Raw { value: v }),
        }
        (out, replies)
    }

    fn user_message(&mut self, text: &str) -> Vec<String> {
        if self.thread_id.is_none() {
            self.queued.push(text.into());
            return vec![];
        }
        vec![self.turn(text)]
    }

    fn approval(&mut self, request_id: &str, allow: bool) -> Vec<String> {
        self.approval_ext(request_id, allow, "", None, false)
    }

    /// Vale no próximo `turn/start` (o modo é por turno no app-server).
    fn set_mode(&mut self, mode: &str) -> Option<Vec<String>> {
        let was_plan = self.opts.permission_mode.as_deref() == Some("plan");
        self.left_plan = was_plan && mode != "plan";
        self.opts.permission_mode = Some(mode.to_string());
        Some(vec![])
    }

    fn approval_ext(&mut self, request_id: &str, allow: bool, _tool: &str, _updated: Option<Value>, always: bool) -> Vec<String> {
        let id: Value = request_id.parse::<u64>().map(Value::from).unwrap_or_else(|_| Value::from(request_id));
        if self.elicitations.remove(request_id) {
            // Resposta de elicitação MCP; "sempre" vale para a sessão (`_meta.persist`).
            let mut r = json!({ "action": if allow { "accept" } else { "decline" }, "content": {} });
            if allow && always {
                r["_meta"] = json!({ "persist": "session" });
            }
            return vec![json!({ "id": id, "result": r }).to_string()];
        }
        vec![json!({"id": id, "result": {"decision": if allow { "accept" } else { "decline" }}}).to_string()]
    }
}

/// Parser de `codex exec --json` (NDJSON: thread.started, item.*, turn.completed).
pub fn parse_exec_line(line: &str) -> Vec<Event> {
    let line = line.trim();
    if line.is_empty() {
        return vec![];
    }
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return vec![Event::Log { line: line.into() }],
    };
    let it = &v["item"];
    let id = s(it, "id").unwrap_or_default();
    match (v.get("type").and_then(Value::as_str), it.get("type").and_then(Value::as_str)) {
        (Some("thread.started"), _) => vec![Event::SessionStarted { session_id: s(&v, "thread_id").unwrap_or_default(), model: None }],
        (Some("turn.started"), _) => vec![],
        (Some("item.started"), Some("command_execution")) => vec![Event::ToolUse { id, name: "command_execution".into(), input: json!({"command": it.get("command")}) }],
        (Some("item.completed"), Some("command_execution")) => vec![Event::ToolResult { id, output: s(it, "aggregated_output").unwrap_or_default(), is_error: it.get("exit_code").and_then(Value::as_i64).is_some_and(|c| c != 0) }],
        (Some("item.completed"), Some("agent_message")) => vec![Event::Text { text: s(it, "text").unwrap_or_default() }],
        (Some("item.completed"), Some("reasoning")) => vec![Event::Reasoning { text: s(it, "text").unwrap_or_default() }],
        (Some("turn.completed"), _) => vec![Event::TurnCompleted { result: None, input_tokens: v.pointer("/usage/input_tokens").and_then(Value::as_u64), output_tokens: v.pointer("/usage/output_tokens").and_then(Value::as_u64), cost_usd: None }],
        (Some("turn.failed"), _) | (Some("error"), _) => vec![Event::Error { message: v.pointer("/error/message").or(v.get("message")).and_then(Value::as_str).unwrap_or("erro").into() }],
        _ => vec![Event::Raw { value: v }],
    }
}

/// Erros comuns do Codex em português, com o que fazer (o original vai no fim, entre parênteses).
pub fn friendly_error(raw: &str) -> String {
    // Às vezes a mensagem é o JSON da API: usa o `error.message` de dentro.
    let inner = serde_json::from_str::<Value>(raw).ok().and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(String::from));
    let msg = inner.as_deref().unwrap_or(raw);
    let l = msg.to_lowercase();
    if l.contains("model") && (l.contains("not supported") || l.contains("does not exist") || l.contains("not found") || l.contains("unknown model")) {
        // "The 'x' model ..." ou "model 'x' ...": o trecho entre aspas.
        let model = msg.split(['\'', '"', '`']).nth(1).filter(|m| !m.contains(' ')).unwrap_or("escolhido");
        return format!("O modelo {model} não está disponível na sua conta do Codex. Escolha outro no seletor de modelos (a lista vem da sua conta). ({msg})");
    }
    if l.contains("not logged in") || l.contains("unauthorized") || l.contains("401") {
        return format!("O Codex não está logado nesta conta. Entre em Configurações › Contas. ({msg})");
    }
    msg.to_string()
}

#[cfg(test)]
mod tests {

    #[test]
    fn plan_por_collaboration_mode_e_saida_ao_vivo() {
        let mut p = CodexAppServer::new(SessionOptions { permission_mode: Some("plan".into()), ..Default::default() });
        let st = p.startup();
        let init: Value = serde_json::from_str(&st[0]).unwrap();
        assert_eq!(init.pointer("/params/capabilities/experimentalApi"), Some(&Value::Bool(true)));
        let th: Value = serde_json::from_str(&st[2]).unwrap();
        assert_eq!((th.pointer("/params/approvalPolicy").and_then(Value::as_str), th.pointer("/params/sandbox")), (Some("untrusted"), None));
        p.on_line(r#"{"id":2,"result":{"thread":{"id":"t1"},"model":"gpt-x"}}"#);
        let t: Value = serde_json::from_str(&p.user_message("planeje")[0]).unwrap();
        assert_eq!((t.pointer("/params/collaborationMode/mode").and_then(Value::as_str), t.pointer("/params/collaborationMode/settings/model").and_then(Value::as_str)), (Some("plan"), Some("gpt-x")));
        // Em plan, aprovação de comando é recusada pelo Kabul.
        let (ev, out) = p.on_line(r#"{"id":9,"method":"item/commandExecution/requestApproval","params":{"command":"touch x"}}"#);
        assert!(!ev.iter().any(|e| matches!(e, Event::ApprovalRequest { .. })));
        assert!(out[0].contains("decline"));
        // Sai do plan: o próximo turno manda `default` uma vez, depois nada.
        assert_eq!(p.set_mode("default"), Some(vec![]));
        let t: Value = serde_json::from_str(&p.user_message("implemente")[0]).unwrap();
        assert_eq!(t.pointer("/params/collaborationMode/mode").and_then(Value::as_str), Some("default"));
        let t: Value = serde_json::from_str(&p.user_message("de novo")[0]).unwrap();
        assert!(t.pointer("/params/collaborationMode").is_none());
    }
    use super::*;

    #[test]
    fn erro_de_modelo_amigavel() {
        let m = friendly_error("The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.");
        assert!(m.starts_with("O modelo gpt-6.1-sol não está disponível na sua conta do Codex"), "{m}");
        assert_eq!(friendly_error("outra coisa"), "outra coisa");
        let j = r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}}"#;
        assert!(friendly_error(j).starts_with("O modelo gpt-6.1-sol não está disponível"));
    }

    #[test]
    fn app_server_fluxo() {
        let mut p = CodexAppServer::new(SessionOptions { cwd: Some("/tmp".into()), effort: Some("high".into()), ..Default::default() });
        let st = p.startup();
        assert!(st[0].contains("\"initialize\"") && st[2].contains("thread/start"));
        assert!(p.user_message("liste").is_empty(), "fica na fila até ter thread");
        let (ev, replies) = run_fixture(&mut p, include_str!("../../tests/fixtures/codex_app_server.ndjson"));
        assert_eq!(p.thread_id.as_deref(), Some("thr_123"));
        let turn: Value = serde_json::from_str(&replies[0]).unwrap();
        assert_eq!(turn["method"], "turn/start");
        assert_eq!(turn["params"]["threadId"], "thr_123");
        assert_eq!(turn["params"]["effort"], "high");
        assert!(matches!(&ev[0], Event::SessionStarted { model: Some(m), .. } if m == "gpt-5.5-codex"));
        assert!(ev.iter().any(|e| matches!(e, Event::ApprovalRequest { request_id, tool, .. } if request_id == "srv-0" && tool == "commandExecution")));
        assert!(ev.iter().any(|e| matches!(e, Event::ToolResult { output, is_error: false, .. } if output.contains("b.txt"))));
        assert!(ev.contains(&Event::Text { text: "Dois arquivos.".into() }));
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { .. }));
        let a: Value = serde_json::from_str(&p.approval("srv-0", true)[0]).unwrap();
        assert_eq!(a, json!({"id":"srv-0","result":{"decision":"accept"}}));
        let a: Value = serde_json::from_str(&p.approval("7", false)[0]).unwrap();
        assert_eq!(a["id"], 7);
    }

    #[test]
    fn exec_fixture() {
        let ev: Vec<Event> = include_str!("../../tests/fixtures/codex_exec.ndjson").lines().flat_map(parse_exec_line).collect();
        assert!(matches!(&ev[0], Event::SessionStarted { session_id, .. } if session_id.starts_with("0199")));
        assert!(ev.contains(&Event::Text { text: "Dois arquivos.".into() }));
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { output_tokens: Some(122), .. }));
        assert_eq!(exec_command("oi", &SessionOptions::default()).args, vec!["exec", "--json", "oi"]);
    }

    #[test]
    fn nuvem_a_confirmar() {
        assert_eq!(Codex.capabilities().cloud, Support::Unconfirmed);
        assert_eq!(Codex.cloud_run("faz x", None).unwrap().args, vec!["cloud", "exec", "faz x"]);
        assert_eq!(Codex.parse_remote_output("Created task task_e_abc123").id.as_deref(), Some("task_e_abc123"));
    }
}
