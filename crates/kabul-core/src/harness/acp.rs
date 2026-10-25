//! Harness genérico do Agent Client Protocol (ACP): JSON-RPC 2.0 em linhas por stdio.
//!
//! O Kabul é o *cliente*: `initialize` → `session/new` (ou `session/load` para retomar) →
//! `session/prompt` por turno. O agente manda `session/update` (texto, pensamento, ferramentas) e
//! pede coisas ao cliente: `session/request_permission` (vira o cartão de aprovação do Kabul),
//! `fs/read_text_file`, `fs/write_text_file` e `terminal/*` (o Kabul roda o processo e guarda a saída).
//!
//! Confirmado de ponta a ponta (initialize, session/new, modo, prompt, tool_call, request_permission
//! aprovado e negado pelo app, session/cancel com o cartão aberto, session/load) com os CLIs de verdade:
//! OpenCode 2.1.4 (`opencode acp`), Gemini CLI 0.65 (`gemini --acp`), Qwen Code 0.26.1 (`qwen --acp`) e
//! Goose 1.55 (`goose acp`), contra o LLM falso de `tests/fake-llm.mjs` (teste ignorado `acp_real`).
//! Cursor (`cursor-agent acp`) segue a mesma especificação; a confirmar (não instalado).
use super::*;
use serde_json::json;
use std::collections::HashMap;
use std::io::Read as _;

/// Escreve linhas no stdin do agente fora do fluxo de `on_line` (respostas adiadas, ex.: `terminal/wait_for_exit`).
pub type Writer = Arc<dyn Fn(Vec<String>) + Send + Sync>;

fn req(id: u64, method: &str, params: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string()
}
fn reply(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}
fn reply_err(id: &Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

/// O que o protocolo está esperando de cada pedido que mandou.
#[derive(Debug, Clone, PartialEq)]
enum Pending {
    Initialize,
    Session,
    Config,
    Prompt,
}

/// Ferramenta em andamento (o `tool_call` chega antes dos parâmetros em alguns agentes).
#[derive(Debug, Clone, Default)]
struct Call {
    kind: String,
    title: String,
    /// Nome interno da ferramenta, quando o agente manda no `_meta` (Goose).
    tool: Option<String>,
    raw: Value,
    locations: Vec<String>,
    content: Vec<Value>,
    shown: bool,
    done: bool,
}

struct Terminal {
    child: std::process::Child,
    output: Arc<Mutex<String>>,
    limit: usize,
}

#[derive(Default)]
pub struct AcpOptions {
    pub cwd: String,
    pub model: Option<String>,
    pub mode: Option<String>,
    pub resume: Option<String>,
    /// "Aprovar tudo" (bypassPermissions/acceptEdits): responde os pedidos sem cartão.
    pub auto_approve: bool,
    /// Não anuncia `fs.readTextFile`/`fs.writeTextFile`: o agente usa o próprio sistema de arquivos.
    /// Gemini CLI 0.65 só reconhece "arquivo não existe" num `Error`, mas o SDK dele rejeita o erro do
    /// cliente como objeto simples; com o `fs` do cliente ele não consegue criar arquivo novo.
    pub no_client_fs: bool,
    /// MCPs de outras IAs para o `mcpServers` do `session/new`/`session/load` (formato ACP).
    pub mcp_servers: Vec<Value>,
}

pub struct AcpProtocol {
    opts: AcpOptions,
    next_id: u64,
    pending: HashMap<u64, Pending>,
    session: Option<String>,
    can_load: bool,
    /// `session/load` reproduz o histórico: o Kabul já tem o dele, então ignora até a resposta.
    replaying: Arc<std::sync::atomic::AtomicBool>,
    /// Depois do `session/load`: prompts seguros até o replay acabar (Gemini CLI continua reproduzindo o
    /// histórico depois de responder o `load`). `Some` = segurando.
    held: Arc<Mutex<Option<Vec<String>>>>,
    /// Quando chegou a última linha do agente (para saber que o replay acabou).
    last_line: Arc<Mutex<std::time::Instant>>,
    /// Mensagens enviadas antes da sessão existir.
    queued: Vec<String>,
    calls: HashMap<String, Call>,
    /// Pedidos de permissão: id do JSON-RPC → opções oferecidas.
    asks: HashMap<String, (Value, Vec<Value>)>,
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
    writer: Option<Writer>,
    turn_open: bool,
    /// Como entrar, pelos `authMethods` do `initialize` (vai na dica do erro de login).
    auth_hint: Option<String>,
    /// `mcpCapabilities` do agente (http/sse); stdio todo agente ACP aceita.
    mcp_caps: Value,
    /// Resposta do `session/new` (modos disponíveis e o atual), para trocar de modo ao vivo.
    modes: Value,
    /// Plan mode emulado (o agente não anuncia modo de planejamento): instrução no prompt e edição/comando negados.
    plan_emulated: bool,
    /// A instrução do plan emulado já foi no prompt.
    plan_told: bool,
    /// Uso que alguns agentes mandam no `_meta.usage` de um `session/update` (Qwen Code) em vez da resposta do prompt.
    meta_usage: Option<Value>,
}

impl AcpProtocol {
    pub fn new(opts: AcpOptions) -> Self {
        Self {
            opts,
            next_id: 0,
            pending: HashMap::new(),
            session: None,
            can_load: false,
            replaying: Default::default(),
            held: Default::default(),
            last_line: Arc::new(Mutex::new(std::time::Instant::now())),
            queued: vec![],
            calls: HashMap::new(),
            asks: HashMap::new(),
            terminals: Default::default(),
            writer: None,
            turn_open: false,
            auth_hint: None,
            mcp_caps: Value::Null,
            modes: Value::Null,
            plan_emulated: false,
            plan_told: false,
            meta_usage: None,
        }
    }

    fn send(&mut self, method: &str, params: Value, what: Pending) -> String {
        self.next_id += 1;
        self.pending.insert(self.next_id, what);
        req(self.next_id, method, params)
    }

    fn prompt(&mut self, text: &str) -> String {
        self.turn_open = true;
        let sid = self.session.clone().unwrap_or_default();
        let text = if self.plan_emulated && !self.plan_told {
            self.plan_told = true;
            format!("{PLAN_EMULATED}\n\n{text}")
        } else {
            text.to_string()
        };
        self.send("session/prompt", json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] }), Pending::Prompt)
    }

    fn on_response(&mut self, v: &Value) -> (Vec<Event>, Vec<String>) {
        let Some(what) = v.get("id").and_then(Value::as_u64).and_then(|i| self.pending.remove(&i)) else { return (vec![], vec![]) };
        let mut ev = vec![];
        let mut out = vec![];
        if let Some(e) = v.get("error") {
            let msg = error_text(e);
            let hint = if is_auth_error(e, &msg) {
                match &self.auth_hint {
                    Some(h) => format!(" (faça login no agente: {h})"),
                    None => " (faça login no CLI do agente em Configurações › Contas ou no terminal)".into(),
                }
            } else {
                String::new()
            };
            match what {
                Pending::Config => ev.push(Event::Log { line: format!("acp: configuração recusada: {msg}") }),
                _ => ev.push(Event::Error { message: format!("{msg}{hint}") }),
            }
            // Sem sessão as mensagens da fila nunca saem: fecha o turno para a UI não ficar "trabalhando".
            let lost = matches!(what, Pending::Initialize | Pending::Session) && !std::mem::take(&mut self.queued).is_empty();
            if what == Pending::Prompt || lost {
                self.turn_open = false;
                ev.push(Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None });
            }
            return (ev, out);
        }
        let r = &v["result"];
        match what {
            Pending::Initialize => {
                self.can_load = r.pointer("/agentCapabilities/loadSession").and_then(Value::as_bool).unwrap_or(false);
                self.auth_hint = auth_hint(r);
                self.mcp_caps = r.pointer("/agentCapabilities/mcpCapabilities").cloned().unwrap_or(Value::Null);
                let cwd = self.opts.cwd.clone();
                let mcp = self.mcp_for_agent();
                match self.opts.resume.clone().filter(|_| self.can_load) {
                    Some(id) => {
                        self.replaying.store(true, std::sync::atomic::Ordering::SeqCst);
                        self.session = Some(id.clone());
                        out.push(self.send("session/load", json!({ "sessionId": id, "cwd": cwd, "mcpServers": mcp }), Pending::Session));
                    }
                    None => out.push(self.send("session/new", json!({ "cwd": cwd, "mcpServers": mcp }), Pending::Session)),
                }
            }
            Pending::Session => {
                let loading = self.replaying.load(std::sync::atomic::Ordering::SeqCst);
                if let Some(id) = r.get("sessionId").and_then(Value::as_str) {
                    self.session = Some(id.to_string());
                }
                let sid = self.session.clone().unwrap_or_default();
                // Modelo: `configOptions` (opencode) ou `models` (instável na especificação).
                let opts = r.get("configOptions").and_then(Value::as_array).cloned().unwrap_or_default();
                let model_opt = opts.iter().find(|o| o.get("category").and_then(Value::as_str) == Some("model") || o.get("id").and_then(Value::as_str) == Some("model"));
                let mut current = model_opt.and_then(option_name).or_else(|| current_model_name(r));
                if let Some(m) = self.opts.model.clone() {
                    if let Some(o) = model_opt {
                        let id = o.get("id").and_then(Value::as_str).unwrap_or("model").to_string();
                        out.push(self.send("session/set_config_option", json!({ "sessionId": sid, "configId": id, "value": m }), Pending::Config));
                        current = Some(m);
                    } else if r.get("models").is_some() {
                        out.push(self.send("session/set_model", json!({ "sessionId": sid, "modelId": m }), Pending::Config));
                        current = Some(m);
                    }
                }
                // Modo equivalente ao do Kabul quando o agente oferece (Qwen Code e Goose nascem em "auto",
                // que aprova sozinho: no modo padrão o Kabul pede o que pergunta antes de cada ferramenta).
                self.modes = r.get("modes").cloned().unwrap_or(Value::Null);
                self.plan_emulated = self.opts.mode.as_deref() == Some("plan") && !has_mode(&self.modes, "plan");
                if let Some(mode) = pick_mode(r, self.opts.mode.as_deref()) {
                    out.push(self.send("session/set_mode", json!({ "sessionId": sid, "modeId": mode.clone() }), Pending::Config));
                    self.modes["currentModeId"] = json!(mode);
                }
                ev.push(Event::SessionStarted { session_id: sid, model: current });
                let prompts: Vec<String> = std::mem::take(&mut self.queued).iter().map(|t| self.prompt(t)).collect();
                match (loading, self.writer.clone()) {
                    // Retomando: segura os prompts até o agente ficar quieto (fim do replay).
                    (true, Some(w)) => {
                        *self.held.lock().unwrap() = Some(prompts);
                        let (held, last, replaying) = (self.held.clone(), self.last_line.clone(), self.replaying.clone());
                        std::thread::spawn(move || {
                            let start = std::time::Instant::now();
                            while last.lock().unwrap().elapsed() < std::time::Duration::from_millis(300) && start.elapsed() < std::time::Duration::from_secs(3) {
                                std::thread::sleep(std::time::Duration::from_millis(50));
                            }
                            let lines = held.lock().unwrap().take().unwrap_or_default();
                            replaying.store(false, std::sync::atomic::Ordering::SeqCst);
                            if !lines.is_empty() {
                                w(lines);
                            }
                        });
                    }
                    _ => {
                        self.replaying.store(false, std::sync::atomic::Ordering::SeqCst);
                        out.extend(prompts);
                    }
                }
            }
            Pending::Config => {}
            Pending::Prompt => {
                self.turn_open = false;
                let stop = r.get("stopReason").and_then(Value::as_str).unwrap_or("end_turn");
                if matches!(stop, "max_tokens" | "max_turn_requests" | "refusal") {
                    ev.push(Event::Error { message: format!("o agente parou: {stop}") });
                }
                let meta = self.meta_usage.take();
                let u = if r["usage"].is_object() { &r["usage"] } else { meta.as_ref().unwrap_or(&Value::Null) };
                if u.is_object() {
                    ev.push(Event::Usage {
                        input: u.get("inputTokens").and_then(Value::as_u64),
                        output: u.get("outputTokens").and_then(Value::as_u64),
                        cache_read: u.get("cachedReadTokens").and_then(Value::as_u64),
                        cache_write: u.get("cachedWriteTokens").and_then(Value::as_u64),
                        duration_ms: None,
                    });
                }
                ev.push(Event::TurnCompleted { result: None, input_tokens: u.get("inputTokens").and_then(Value::as_u64), output_tokens: u.get("outputTokens").and_then(Value::as_u64), cost_usd: None });
            }
        }
        (ev, out)
    }

    /// Os MCPs que o agente aceita: http/sse só com `mcpCapabilities` (o resto fica de fora, com aviso).
    fn mcp_for_agent(&self) -> Vec<Value> {
        self.opts
            .mcp_servers
            .iter()
            .filter(|s| match s.get("type").and_then(Value::as_str) {
                Some(t @ ("http" | "sse")) => self.mcp_caps.get(t).and_then(Value::as_bool).unwrap_or(false),
                _ => true,
            })
            .cloned()
            .collect()
    }

    fn on_update(&mut self, u: &Value) -> Vec<Event> {
        if self.replaying.load(std::sync::atomic::Ordering::SeqCst) {
            return vec![];
        }
        if let Some(m) = u.pointer("/_meta/usage").filter(|m| m.is_object()) {
            self.meta_usage = Some(m.clone());
        }
        let text = |u: &Value| u.pointer("/content/text").and_then(Value::as_str).map(String::from);
        match u.get("sessionUpdate").and_then(Value::as_str).unwrap_or("") {
            // Gemini CLI avisa a troca de modo como texto ("[MODE_UPDATE] plan"): não é resposta.
            "agent_message_chunk" => match text(u).filter(|t| !t.is_empty()) {
                Some(t) if t.starts_with("[MODE_UPDATE]") => vec![Event::Log { line: t }],
                Some(t) => vec![Event::TextDelta { text: t }],
                None => vec![],
            },
            "agent_thought_chunk" => text(u).map(|t| vec![Event::Reasoning { text: t }]).unwrap_or_default(),
            "tool_call" | "tool_call_update" => self.on_tool(u),
            "plan" => {
                let todos: Vec<Value> = u.get("entries").and_then(Value::as_array).map(|a| a.iter().map(|e| json!({ "content": e.get("content"), "status": e.get("status") })).collect()).unwrap_or_default();
                vec![Event::ToolUse { id: format!("plan-{}", self.next_id), name: "TodoWrite".into(), input: json!({ "todos": todos }) }]
            }
            "usage_update" | "available_commands_update" | "current_mode_update" | "config_option_update" | "session_info_update" => vec![],
            _ => vec![Event::Raw { value: u.clone() }],
        }
    }

    fn on_tool(&mut self, u: &Value) -> Vec<Event> {
        let Some(id) = u.get("toolCallId").and_then(Value::as_str).map(String::from) else { return vec![] };
        let c = self.calls.entry(id.clone()).or_default();
        if let Some(k) = u.get("kind").and_then(Value::as_str) {
            c.kind = k.into();
        }
        if let Some(t) = u.get("title").and_then(Value::as_str) {
            c.title = t.into();
        }
        if let Some(t) = u.pointer("/_meta/goose/toolCall/toolName").or_else(|| u.pointer("/_meta/toolName")).and_then(Value::as_str) {
            c.tool = Some(t.into());
        }
        if let Some(r) = u.get("rawInput").filter(|r| r.as_object().is_some_and(|o| !o.is_empty())) {
            c.raw = r.clone();
        }
        if let Some(l) = u.get("locations").and_then(Value::as_array).filter(|l| !l.is_empty()) {
            c.locations = l.iter().filter_map(|x| x.get("path").and_then(Value::as_str).map(String::from)).collect();
        }
        if let Some(ct) = u.get("content").and_then(Value::as_array).filter(|a| !a.is_empty()) {
            c.content = ct.clone();
        }
        let status = u.get("status").and_then(Value::as_str).unwrap_or("");
        let finished = matches!(status, "completed" | "failed");
        let mut out = vec![];
        // Mostra quando os parâmetros chegam (ou no fim, se nunca chegarem).
        // (só `cwd` não conta: o opencode manda o `tool_call` pendente com ele e sem o comando).
        let has_params = c.raw.as_object().is_some_and(|o| o.keys().any(|k| k != "cwd"));
        if !c.shown && (has_params || status == "in_progress" || finished) {
            c.shown = true;
            let (name, input) = tool_card(c);
            out.push(Event::ToolUse { id: id.clone(), name, input });
        }
        if finished && !c.done {
            c.done = true;
            out.push(Event::ToolResult { id, output: content_text(&c.content), is_error: status == "failed" });
        }
        out
    }

    /// Pedido do agente ao cliente.
    fn on_request(&mut self, v: &Value) -> (Vec<Event>, Vec<String>) {
        let id = v["id"].clone();
        let p = &v["params"];
        match v.get("method").and_then(Value::as_str).unwrap_or("") {
            "session/request_permission" => {
                let tc = &p["toolCall"];
                let mut c = tc.get("toolCallId").and_then(Value::as_str).and_then(|t| self.calls.get(t).cloned()).unwrap_or_default();
                if let Some(k) = tc.get("kind").and_then(Value::as_str) {
                    c.kind = k.into();
                }
                if let Some(t) = tc.get("title").and_then(Value::as_str) {
                    c.title = t.into();
                }
                if let Some(t) = tc.pointer("/_meta/toolName").and_then(Value::as_str) {
                    c.tool = Some(t.into());
                }
                if let Some(r) = tc.get("rawInput").filter(|r| r.as_object().is_some_and(|o| !o.is_empty())) {
                    c.raw = r.clone();
                }
                if let Some(ct) = tc.get("content").and_then(Value::as_array) {
                    c.content = ct.clone();
                }
                if let Some(l) = tc.get("locations").and_then(Value::as_array).filter(|l| !l.is_empty()) {
                    c.locations = l.iter().filter_map(|x| x.get("path").and_then(Value::as_str).map(String::from)).collect();
                }
                let (tool, input) = tool_card(&c);
                // Plan emulado: só leitura. Edição e comandos são negados sem cartão, com o motivo.
                if self.plan_emulated && matches!(tool.as_str(), "Edit" | "Write" | "Bash") {
                    let options = p.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
                    let rid = id.to_string();
                    self.asks.insert(rid.clone(), (id, options));
                    return (vec![Event::Log { line: format!("plan mode (emulado): {tool} negado") }], self.approval_ext(&rid, false, &tool, None, false));
                }
                // Guarda o que o pedido trouxe: o Qwen Code manda o `tool_call` vazio e os parâmetros só aqui.
                if let Some(t) = tc.get("toolCallId").and_then(Value::as_str) {
                    self.calls.insert(t.to_string(), c);
                }
                let options = p.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
                let rid = id.to_string();
                self.asks.insert(rid.clone(), (id, options));
                if self.opts.auto_approve {
                    return (vec![], self.approval_ext(&rid, true, &tool, None, false));
                }
                (vec![Event::ApprovalRequest { request_id: rid, tool, input }], vec![])
            }
            "fs/read_text_file" => {
                let path = p.get("path").and_then(Value::as_str).unwrap_or("");
                match std::fs::read_to_string(path) {
                    Ok(t) => {
                        let line = p.get("line").and_then(Value::as_u64).map(|l| l.max(1) as usize - 1).unwrap_or(0);
                        let limit = p.get("limit").and_then(Value::as_u64).map(|l| l as usize).unwrap_or(usize::MAX);
                        let content = if line == 0 && limit == usize::MAX { t } else { t.lines().skip(line).take(limit).collect::<Vec<_>>().join("\n") };
                        (vec![], vec![reply(&id, json!({ "content": content }))])
                    }
                    Err(e) => (vec![], vec![reply_err(&id, -32002, &format!("{path}: {e}"))]),
                }
            }
            "fs/write_text_file" => {
                let path = p.get("path").and_then(Value::as_str).unwrap_or("");
                let r = std::path::Path::new(path).parent().map(std::fs::create_dir_all).unwrap_or(Ok(())).and_then(|_| std::fs::write(path, p.get("content").and_then(Value::as_str).unwrap_or("")));
                (
                    vec![],
                    vec![match r {
                        Ok(_) => reply(&id, Value::Null),
                        Err(e) => reply_err(&id, -32002, &format!("{path}: {e}")),
                    }],
                )
            }
            "terminal/create" => (vec![], vec![self.terminal_create(&id, p)]),
            "terminal/output" => {
                let t = self.terminals.lock().unwrap();
                let tid = p.get("terminalId").and_then(Value::as_str).unwrap_or("");
                (
                    vec![],
                    vec![match t.get(tid) {
                        Some(term) => {
                            let out = term.output.lock().unwrap().clone();
                            reply(&id, json!({ "output": out, "truncated": out.len() >= term.limit }))
                        }
                        None => reply_err(&id, -32002, "terminal não encontrado"),
                    }],
                )
            }
            "terminal/wait_for_exit" => {
                let tid = p.get("terminalId").and_then(Value::as_str).unwrap_or("").to_string();
                // Resposta adiada: o processo pode demorar e o leitor do stdout não pode travar.
                let (terms, writer) = (self.terminals.clone(), self.writer.clone());
                std::thread::spawn(move || {
                    let status = loop {
                        let r = terms.lock().unwrap().get_mut(&tid).map(|t| t.child.try_wait());
                        match r {
                            Some(Ok(Some(s))) => break Some(s),
                            Some(Ok(None)) => std::thread::sleep(std::time::Duration::from_millis(100)),
                            _ => break None,
                        }
                    };
                    let line = match status {
                        Some(s) => reply(&id, json!({ "exitCode": s.code(), "signal": Value::Null })),
                        None => reply_err(&id, -32002, "terminal não encontrado"),
                    };
                    if let Some(w) = writer {
                        w(vec![line]);
                    }
                });
                (vec![], vec![])
            }
            "terminal/kill" | "terminal/release" => {
                let tid = p.get("terminalId").and_then(Value::as_str).unwrap_or("");
                let mut t = self.terminals.lock().unwrap();
                let release = v.get("method").and_then(Value::as_str) == Some("terminal/release");
                if let Some(term) = t.get_mut(tid) {
                    let _ = term.child.kill();
                }
                if release {
                    t.remove(tid);
                }
                (vec![], vec![reply(&id, Value::Null)])
            }
            m => (vec![Event::Log { line: format!("acp: pedido não suportado {m}") }], vec![reply_err(&id, -32601, &format!("método não suportado: {m}"))]),
        }
    }

    fn terminal_create(&mut self, id: &Value, p: &Value) -> String {
        let cmd = p.get("command").and_then(Value::as_str).unwrap_or("");
        let args: Vec<String> = p.get("args").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
        let mut c = if args.is_empty() && cmd.contains(' ') {
            // Linha de shell inteira.
            let mut c = crate::shell::command(if cfg!(windows) { "cmd" } else { "sh" });
            c.args([if cfg!(windows) { "/C" } else { "-c" }, cmd]);
            c
        } else {
            let mut c = crate::shell::command(cmd);
            c.args(&args);
            c
        };
        c.current_dir(p.get("cwd").and_then(Value::as_str).unwrap_or(&self.opts.cwd));
        for e in p.get("env").and_then(Value::as_array).into_iter().flatten() {
            if let (Some(k), Some(v)) = (e.get("name").and_then(Value::as_str), e.get("value").and_then(Value::as_str)) {
                c.env(k, v);
            }
        }
        c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let limit = p.get("outputByteLimit").and_then(Value::as_u64).map(|l| l as usize).unwrap_or(1 << 20);
        match c.spawn() {
            Ok(mut child) => {
                let output = Arc::new(Mutex::new(String::new()));
                for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)].into_iter().flatten() {
                    let out = output.clone();
                    std::thread::spawn(move || {
                        let mut s = stream;
                        let mut b = [0u8; 4096];
                        while let Ok(n) = s.read(&mut b) {
                            if n == 0 {
                                break;
                            }
                            let mut o = out.lock().unwrap();
                            o.push_str(&String::from_utf8_lossy(&b[..n]));
                            // Guarda só o fim, dentro do limite pedido.
                            if o.len() > limit {
                                let cut = o.len() - limit;
                                let cut = (cut..o.len()).find(|i| o.is_char_boundary(*i)).unwrap_or(cut);
                                o.drain(..cut);
                            }
                        }
                    });
                }
                self.next_id += 1;
                let tid = format!("term-{}", self.next_id);
                self.terminals.lock().unwrap().insert(tid.clone(), Terminal { child, output, limit });
                reply(id, json!({ "terminalId": tid }))
            }
            Err(e) => reply_err(id, -32002, &format!("{cmd}: {e}")),
        }
    }
}

/// Mensagem do erro JSON-RPC com o `data` quando ele explica mais (Goose manda "Internal error" e o motivo no `data`).
fn error_text(e: &Value) -> String {
    let msg = e.get("message").and_then(Value::as_str).unwrap_or("erro do agente").to_string();
    let data = e.get("data").and_then(|d| d.as_str().map(String::from).or_else(|| d.get("message").and_then(Value::as_str).map(String::from)).or_else(|| d.get("details").and_then(Value::as_str).map(String::from)));
    match data.filter(|d| !d.is_empty() && !msg.contains(d.as_str())) {
        Some(d) => format!("{msg}: {d}"),
        None => msg,
    }
}

/// `-32000` é "auth_required" no ACP; Gemini CLI e Goose falam de chave/provedor sem dizer "auth".
fn is_auth_error(e: &Value, msg: &str) -> bool {
    let low = msg.to_lowercase();
    e.get("code").and_then(Value::as_i64) == Some(-32000) || ["auth", "api key", "login", "credential", "goose_provider", "resolve provider"].iter().any(|k| low.contains(k))
}

/// Como entrar, pelos `authMethods` do `initialize` (ex.: "Log in with Google; Gemini API key").
fn auth_hint(r: &Value) -> Option<String> {
    let m = r.get("authMethods").and_then(Value::as_array)?;
    let s: Vec<String> = m.iter().filter_map(|a| a.get("description").and_then(Value::as_str).or_else(|| a.get("name").and_then(Value::as_str)).map(String::from)).take(3).collect();
    (!s.is_empty()).then(|| s.join("; "))
}

/// Modelo atual pelo `models` do `session/new`, com o nome legível (Qwen Code usa ids como `$runtime|openai|qwen3-8b(openai)`).
fn current_model_name(r: &Value) -> Option<String> {
    let id = r.pointer("/models/currentModelId").and_then(Value::as_str)?;
    let name = r.pointer("/models/availableModels").and_then(Value::as_array).and_then(|a| a.iter().find(|m| m.get("modelId").and_then(Value::as_str) == Some(id))).and_then(|m| m.get("name").and_then(Value::as_str));
    Some(name.unwrap_or(id).to_string())
}

/// Valor atual de um `configOptions` com o nome legível da opção.
fn option_name(o: &Value) -> Option<String> {
    let v = o.get("currentValue").and_then(Value::as_str)?;
    let name = o.get("options").and_then(Value::as_array).and_then(|a| a.iter().find(|x| x.get("value").and_then(Value::as_str) == Some(v))).and_then(|x| x.get("name").and_then(Value::as_str));
    // Só troca quando o id é interno (o OpenCode usa `provedor/modelo` como valor e como nome).
    Some(match name {
        Some(n) if v.contains('|') || v.contains('$') => n.to_string(),
        _ => v.to_string(),
    })
}

/// Instrução do plan mode emulado (agente sem modo de planejamento).
pub const PLAN_EMULATED: &str = "[Plan mode] Só leia e investigue: não edite arquivos nem rode comandos que mudem algo (o Kabul nega). Termine com um plano numerado e espere a aprovação antes de implementar.";

fn has_mode(modes: &Value, id: &str) -> bool {
    modes.get("availableModes").and_then(Value::as_array).is_some_and(|a| a.iter().any(|m| m.get("id").and_then(Value::as_str) == Some(id)))
}

/// Modo do agente equivalente ao do Kabul, quando difere do atual. Nomes vistos: Qwen Code
/// (`plan|default|auto-edit|auto|yolo`), Goose (`auto|approve|smart_approve|chat`), Gemini CLI
/// (`default|autoEdit|yolo|plan`), OpenCode (agentes `build|plan`).
fn pick_mode(r: &Value, kabul: Option<&str>) -> Option<String> {
    let modes = r.pointer("/modes/availableModes").and_then(Value::as_array)?;
    let current = r.pointer("/modes/currentModeId").and_then(Value::as_str).unwrap_or("");
    let want: &[&str] = match kabul {
        // Sem modo de planejamento (Goose): pergunta antes de cada ferramenta e o Kabul emula o plan.
        Some("plan") => &["plan", "default", "approve"],
        Some("acceptEdits") => &["auto-edit", "auto_edit", "autoEdit", "acceptEdits", "smart_approve"],
        Some("bypassPermissions") => &["yolo", "bypassPermissions"],
        // Padrão: perguntar antes de cada ferramenta (o cartão de aprovação do Kabul).
        _ => &["default", "approve"],
    };
    let ids: Vec<&str> = modes.iter().filter_map(|m| m.get("id").and_then(Value::as_str)).collect();
    let m = want.iter().find(|w| ids.contains(w))?;
    (*m != current).then(|| m.to_string())
}

/// `kind` pelo nome da ferramenta quando o agente manda `other` (Goose: `shell`, `write`, `edit`, `read`
/// no `_meta.goose.toolCall.toolName` e no título "edit · caminho"; Qwen Code: `_meta.toolName`).
fn infer_kind(c: &Call) -> &'static str {
    let name = c.tool.clone().unwrap_or_else(|| c.title.split(" · ").next().unwrap_or("").trim().to_string()).to_lowercase();
    let raw = c.raw.as_object();
    let has = |k: &str| raw.is_some_and(|o| o.contains_key(k));
    match name.as_str() {
        "shell" | "bash" | "run_shell_command" | "execute" | "terminal" => "execute",
        "write" | "write_file" | "create_file" | "edit" | "replace" | "str_replace" | "text_editor" => "edit",
        "read" | "read_file" | "read_many_files" | "view" | "cat" => "read",
        "grep" | "grep_search" | "glob" | "search" | "find" | "rg" => "search",
        "fetch" | "web_fetch" => "fetch",
        _ if has("command") && !has("path") => "execute",
        _ => "other",
    }
}

/// Nome e parâmetros no formato dos cartões do Kabul (Bash, Read, Edit, Write…), pelo `kind` do ACP.
fn tool_card(c: &Call) -> (String, Value) {
    let raw = c.raw.as_object().cloned().unwrap_or_default();
    let get = |k: &[&str]| k.iter().find_map(|k| raw.get(*k).and_then(Value::as_str)).map(String::from);
    let path = c.locations.first().cloned().or_else(|| get(&["path", "filePath", "file_path", "abs_path"]));
    let diff = c.content.iter().find(|x| x.get("type").and_then(Value::as_str) == Some("diff"));
    let mut o = raw.clone();
    let mut put = |k: &str, v: Option<String>| {
        if let Some(v) = v {
            o.insert(k.into(), Value::String(v));
        }
    };
    let kind = match c.kind.as_str() {
        "" | "other" => infer_kind(c),
        k => k,
    };
    let name = match kind {
        "execute" => {
            put("command", get(&["command", "cmd"]).or_else(|| Some(c.title.clone())));
            "Bash"
        }
        "read" => {
            put("file_path", path);
            "Read"
        }
        "edit" | "delete" | "move" => {
            put("file_path", path);
            match diff {
                // Arquivo novo: `oldText` nulo (OpenCode) ou vazio (Qwen Code).
                Some(d) if d.get("oldText").is_none_or(|t| t.is_null() || t.as_str() == Some("")) => {
                    put("content", d.get("newText").and_then(Value::as_str).map(String::from));
                    "Write"
                }
                Some(d) => {
                    put("old_string", d.get("oldText").and_then(Value::as_str).map(String::from));
                    put("new_string", d.get("newText").and_then(Value::as_str).map(String::from));
                    "Edit"
                }
                None if raw.contains_key("content") && !raw.contains_key("oldString") => "Write",
                None => "Edit",
            }
        }
        "search" => {
            put("pattern", get(&["pattern", "query"]).or_else(|| Some(c.title.clone())));
            "Grep"
        }
        "fetch" => {
            put("url", get(&["url"]).or_else(|| Some(c.title.clone())));
            "WebFetch"
        }
        _ => {
            if !c.title.is_empty() {
                o.insert("title".into(), Value::String(c.title.clone()));
            }
            // Ferramenta de MCP: o nome `mcp__servidor__ferramenta` (o título do Qwen Code é só o JSON dos argumentos).
            if let Some(t) = c.tool.as_deref().filter(|t| t.starts_with("mcp__")) {
                return (t.to_string(), Value::Object(o));
            }
            return (if c.title.is_empty() { c.kind.clone() } else { c.title.clone() }, Value::Object(o));
        }
    };
    (name.into(), Value::Object(o))
}

fn content_text(content: &[Value]) -> String {
    content
        .iter()
        .filter_map(|x| match x.get("type").and_then(Value::as_str) {
            Some("content") => x.pointer("/content/text").and_then(Value::as_str).map(String::from),
            Some("diff") => Some(format!("{} alterado", x.get("path").and_then(Value::as_str).unwrap_or("arquivo"))),
            Some("terminal") => x.get("terminalId").and_then(Value::as_str).map(|t| format!("(terminal {t})")),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

impl Protocol for AcpProtocol {
    fn startup(&mut self) -> Vec<String> {
        let fs = !self.opts.no_client_fs;
        vec![self.send(
            "initialize",
            json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": fs, "writeTextFile": fs }, "terminal": true }, "clientInfo": { "name": "kabul", "version": env!("CARGO_PKG_VERSION") } }),
            Pending::Initialize,
        )]
    }

    fn attach_writer(&mut self, w: Writer) {
        self.writer = Some(w);
    }

    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        let line = line.trim();
        if line.is_empty() {
            return (vec![], vec![]);
        }
        *self.last_line.lock().unwrap() = std::time::Instant::now();
        let Ok(v) = serde_json::from_str::<Value>(line) else { return (vec![Event::Log { line: line.into() }], vec![]) };
        let has_id = v.get("id").is_some_and(|i| !i.is_null());
        match (v.get("method").and_then(Value::as_str), has_id) {
            (Some("session/update"), _) => (self.on_update(&v["params"]["update"]), vec![]),
            (Some(_), true) => self.on_request(&v),
            (Some(_), false) => (vec![Event::Raw { value: v }], vec![]),
            (None, true) => self.on_response(&v),
            (None, false) => (vec![Event::Raw { value: v }], vec![]),
        }
    }

    fn user_message(&mut self, text: &str) -> Vec<String> {
        if self.session.is_none() || self.pending.values().any(|p| *p == Pending::Session) {
            self.queued.push(text.to_string());
            return vec![];
        }
        let line = self.prompt(text);
        if let Some(h) = self.held.lock().unwrap().as_mut() {
            h.push(line);
            return vec![];
        }
        vec![line]
    }

    fn approval(&mut self, request_id: &str, allow: bool) -> Vec<String> {
        self.approval_ext(request_id, allow, "", None, false)
    }

    /// Troca de modo ao vivo pelo `session/set_mode` (ou liga/desliga o plan emulado).
    fn set_mode(&mut self, mode: &str) -> Option<Vec<String>> {
        let sid = self.session.clone()?;
        let was_emulated = self.plan_emulated;
        self.plan_emulated = mode == "plan" && !has_mode(&self.modes, "plan");
        if self.plan_emulated && !was_emulated {
            self.plan_told = false;
        }
        let wrapped = json!({ "modes": self.modes });
        let mut out = vec![];
        if let Some(m) = pick_mode(&wrapped, Some(mode)) {
            out.push(self.send("session/set_mode", json!({ "sessionId": sid, "modeId": m.clone() }), Pending::Config));
            self.modes["currentModeId"] = json!(m);
        }
        Some(out)
    }

    /// `session/cancel` (notificação): o agente para o turno e responde o `session/prompt` com `cancelled`.
    /// Pedidos de permissão em aberto recebem `cancelled`, como a especificação pede.
    fn interrupt(&mut self) -> Option<Vec<String>> {
        let sid = self.session.clone()?;
        let mut out = vec![json!({ "jsonrpc": "2.0", "method": "session/cancel", "params": { "sessionId": sid } }).to_string()];
        out.extend(self.asks.drain().map(|(_, (id, _))| reply(&id, json!({ "outcome": { "outcome": "cancelled" } }))));
        Some(out)
    }

    fn approval_ext(&mut self, request_id: &str, allow: bool, _tool: &str, _updated: Option<Value>, always: bool) -> Vec<String> {
        let Some((id, options)) = self.asks.remove(request_id) else { return vec![] };
        let kind_of = |o: &Value| o.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
        let want: &[&str] = match (allow, always) {
            (true, true) => &["allow_always", "allow_once"],
            (true, false) => &["allow_once", "allow_always"],
            (false, _) => &["reject_once", "reject_always"],
        };
        let pick = want.iter().find_map(|k| options.iter().find(|o| kind_of(o) == *k)).and_then(|o| o.get("optionId").cloned());
        vec![match pick {
            Some(opt) => reply(&id, json!({ "outcome": { "outcome": "selected", "optionId": opt } })),
            None => reply(&id, json!({ "outcome": { "outcome": "cancelled" } })),
        }]
    }

    fn finish(&mut self) -> Event {
        Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }
    }
}

/// Opções de sessão ACP a partir das do Kabul.
pub fn options(opts: &SessionOptions, model: Option<String>) -> AcpOptions {
    AcpOptions {
        cwd: opts.cwd.clone().unwrap_or_else(|| std::env::current_dir().map(|d| d.display().to_string()).unwrap_or_default()),
        model,
        mode: opts.permission_mode.clone(),
        resume: opts.resume.clone(),
        auto_approve: matches!(opts.permission_mode.as_deref(), Some("bypassPermissions") | Some("acceptEdits")),
        no_client_fs: false,
        mcp_servers: opts.mcp_inject.iter().map(crate::mcp_share::Server::to_acp).collect(),
    }
}

/// Agente que fala ACP: binário + argumentos que abrem o servidor por stdio.
pub struct AcpAgent {
    pub kind: HarnessKind,
    pub program: &'static str,
    pub args: &'static [&'static str],
    /// Visto funcionando com o CLI instalado (senão "a confirmar").
    pub confirmed: bool,
}

/// Agentes com ACP conhecidos. Claude (stream-json), Codex (app-server) e agy (stream-json) seguem nativos.
pub const AGENTS: &[AcpAgent] = &[
    AcpAgent { kind: HarnessKind::OpenCode, program: "opencode", args: &["acp"], confirmed: true },
    AcpAgent { kind: HarnessKind::GeminiCli, program: "gemini", args: &["--acp"], confirmed: true },
    AcpAgent { kind: HarnessKind::QwenCode, program: "qwen", args: &["--acp"], confirmed: true },
    AcpAgent { kind: HarnessKind::Goose, program: "goose", args: &["acp"], confirmed: true },
    AcpAgent { kind: HarnessKind::Cursor, program: "cursor-agent", args: &["acp"], confirmed: false },
];

pub fn agent(kind: HarnessKind) -> Option<&'static AcpAgent> {
    AGENTS.iter().find(|a| a.kind == kind)
}

/// Comando ACP do agente (sem o ambiente específico de cada harness).
pub fn command(kind: HarnessKind, opts: &SessionOptions) -> CmdSpec {
    let a = agent(kind).expect("agente sem ACP");
    CmdSpec::new(a.program, a.args.iter().copied()).with_cwd(opts.cwd.clone()).with_env(&opts.env)
}

/// Harness ACP genérico para agentes sem nada específico além do comando (Goose, Cursor).
pub struct AcpHarness(pub HarnessKind);

impl Harness for AcpHarness {
    fn kind(&self) -> HarnessKind {
        self.0
    }
    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut c = command(self.0, opts);
        if self.0 == HarnessKind::Goose {
            if let Some(ep) = &opts.endpoint {
                // Goose com endpoint OpenAI-compatível (a confirmar).
                c.env.extend([("GOOSE_PROVIDER".into(), "openai".into()), ("OPENAI_HOST".into(), ep.base_url.clone()), ("OPENAI_API_KEY".into(), ep.key()), ("GOOSE_MODEL".into(), ep.model.clone())]);
            }
        }
        c
    }
    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let program = agent(self.0).map(|a| a.program).unwrap_or("sh");
        let args: Vec<&str> = if self.0 == HarnessKind::Goose { vec!["session"] } else { vec![] };
        CmdSpec::new(program, args).with_cwd(opts.cwd.clone()).with_env(&opts.env)
    }
    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol> {
        let model = if opts.endpoint.is_some() { None } else { opts.model.clone() };
        Box::new(AcpProtocol::new(options(opts, model)))
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::TmuxMirror, cloud: Support::TmuxMirror, teleport: Support::TmuxMirror, background: Support::TmuxMirror }
    }
    /// Goose não tem modo de planejamento (`auto|approve|smart_approve|chat`); Cursor a confirmar.
    fn plan_support(&self) -> PlanSupport {
        PlanSupport::Emulated
    }
    fn endpoint_apis(&self) -> &'static [Api] {
        if self.0 == HarnessKind::Goose {
            &[Api::Openai]
        } else {
            &[]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(out: &[String]) -> Vec<Value> {
        out.iter().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    /// Roda a fixture como se fosse o agente: cada linha do agente gera eventos e respostas do Kabul.
    fn conversa(p: &mut AcpProtocol, fx: &str) -> (Vec<Event>, Vec<Value>) {
        let mut ev = vec![];
        let mut out = lines(&p.startup());
        for l in fx.lines() {
            let (e, o) = p.on_line(l);
            ev.extend(e);
            out.extend(lines(&o));
        }
        (ev, out)
    }

    #[test]
    fn handshake_modelo_turno_e_aprovacao() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/tmp/exemplo".into(), model: Some("provedor/modelo-b".into()), ..Default::default() });
        // Mensagem antes da sessão: fica na fila e sai depois do session/new.
        assert!(p.user_message("oi").is_empty());
        let (ev, out) = conversa(&mut p, include_str!("../../tests/fixtures/acp_opencode.ndjson"));
        assert_eq!(out[0]["method"], "initialize");
        assert_eq!(out[0]["params"]["clientCapabilities"]["terminal"], true);
        assert_eq!(out[1]["method"], "session/new");
        assert_eq!(out[1]["params"]["cwd"], "/tmp/exemplo");
        assert_eq!(out[2]["method"], "session/set_config_option");
        assert_eq!(out[2]["params"]["value"], "provedor/modelo-b");
        assert_eq!(out[3]["method"], "session/prompt");
        assert_eq!(out[3]["params"]["prompt"][0]["text"], "oi");
        assert!(ev.iter().any(|e| matches!(e, Event::SessionStarted { session_id, model: Some(m) } if session_id == "ses_teste" && m == "provedor/modelo-b")));
        assert!(ev.contains(&Event::TextDelta { text: "Vou rodar.".into() }));
        // Ferramenta só aparece com os parâmetros (o tool_call pendente chega vazio).
        let tools: Vec<_> = ev.iter().filter_map(|e| if let Event::ToolUse { name, input, .. } = e { Some((name.clone(), input.clone())) } else { None }).collect();
        assert_eq!(tools.len(), 2);
        assert_eq!((tools[0].0.as_str(), tools[0].1["command"].as_str()), ("Bash", Some("echo acp-ok")));
        assert_eq!((tools[1].0.as_str(), tools[1].1["file_path"].as_str()), ("Write", Some("/tmp/exemplo/x.txt")));
        // Pedido de permissão vira cartão; ⌘↵ escolhe allow_always.
        let ap = ev.iter().find_map(|e| if let Event::ApprovalRequest { request_id, tool, input } = e { Some((request_id.clone(), tool.clone(), input.clone())) } else { None }).unwrap();
        assert_eq!(ap.1, "Write");
        assert_eq!(ap.2["content"], "abc");
        let r = lines(&p.approval_ext(&ap.0, true, "Write", None, true));
        assert_eq!(r[0]["result"]["outcome"]["optionId"], "always");
        assert_eq!(r[0]["id"], 0);
        assert!(p.approval_ext(&ap.0, true, "", None, false).is_empty(), "responde uma vez só");
        let res: Vec<_> = ev.iter().filter_map(|e| if let Event::ToolResult { output, is_error, .. } = e { Some((output.clone(), *is_error)) } else { None }).collect();
        assert!(res.contains(&("acp-ok\n".into(), false)) && res.contains(&("Created file successfully: x.txt".into(), false)));
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { input_tokens: Some(10731), output_tokens: Some(74), .. }));
        assert!(ev.iter().any(|e| matches!(e, Event::Usage { cache_read: Some(12698), .. })));
        // Turno seguinte vai direto.
        assert_eq!(lines(&p.user_message("de novo"))[0]["method"], "session/prompt");
    }

    #[test]
    fn negar_e_retomar_sem_replay() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), resume: Some("ses_velha".into()), mode: Some("plan".into()), ..Default::default() });
        let fx = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"ses_velha","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"histórico"}}}}
{"jsonrpc":"2.0","id":2,"result":{"modes":{"currentModeId":"default","availableModes":[{"id":"default"},{"id":"plan"}]}}}
{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"sessionId":"ses_velha","toolCall":{"toolCallId":"t9","title":"rm -rf build","kind":"execute","rawInput":{"command":"rm -rf build"}},"options":[{"optionId":"sim","kind":"allow_once","name":"Allow"},{"optionId":"nao","kind":"reject_once","name":"Reject"}]}}"#;
        let (ev, out) = conversa(&mut p, fx);
        assert_eq!(out[1]["method"], "session/load");
        assert_eq!(out[1]["params"]["sessionId"], "ses_velha");
        assert_eq!(out[2]["method"], "session/set_mode");
        assert!(!ev.iter().any(|e| matches!(e, Event::TextDelta { .. })), "histórico reproduzido não entra de novo");
        let rid = ev
            .iter()
            .find_map(|e| {
                if let Event::ApprovalRequest { request_id, input, .. } = e {
                    assert_eq!(input["command"], "rm -rf build");
                    Some(request_id.clone())
                } else {
                    None
                }
            })
            .unwrap();
        let r = lines(&p.approval(&rid, false));
        assert_eq!(r[0]["result"]["outcome"]["optionId"], "nao");
    }

    fn tools_of(ev: &[Event]) -> Vec<(String, Value)> {
        ev.iter().filter_map(|e| if let Event::ToolUse { name, input, .. } = e { Some((name.clone(), input.clone())) } else { None }).collect()
    }
    fn ask_of(ev: &[Event]) -> (String, String, Value) {
        ev.iter().find_map(|e| if let Event::ApprovalRequest { request_id, tool, input } = e { Some((request_id.clone(), tool.clone(), input.clone())) } else { None }).expect("sem pedido de permissão")
    }

    /// Saída real do Qwen Code 0.26.1 (`qwen --acp`, servidor OpenAI de teste): `tool_call` vazio e os
    /// parâmetros só no `request_permission`, negar, uso no `_meta.usage`, pedido próprio `craft/*`.
    #[test]
    fn fixture_real_qwen() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/tmp/exemplo".into(), ..Default::default() });
        assert!(p.user_message("Rode.").is_empty());
        let fx = include_str!("../../tests/fixtures/acp_qwen.ndjson");
        let mut ev = vec![];
        let mut out = lines(&p.startup());
        let mut rid = None;
        for l in fx.lines() {
            let (e, o) = p.on_line(l);
            if let Some(Event::ApprovalRequest { request_id, .. }) = e.iter().find(|e| matches!(e, Event::ApprovalRequest { .. })) {
                rid = Some(request_id.clone());
            }
            ev.extend(e);
            out.extend(lines(&o));
            // Nega na hora, como o usuário no cartão.
            if let Some(r) = rid.take() {
                out.extend(lines(&p.approval(&r, false)));
            }
        }
        // Já nasce em `default` (o Kabul passa `--approval-mode default`): sem set_mode, prompt é o 3.
        assert_eq!(out.iter().map(|o| o["method"].as_str().unwrap_or("resposta")).collect::<Vec<_>>(), vec!["initialize", "session/new", "session/prompt", "resposta", "resposta"]);
        assert!(ev.iter().any(|e| matches!(e, Event::SessionStarted { model: Some(m), .. } if m == "fake-model")), "nome legível do modelo");
        let (_, tool, input) = ask_of(&ev);
        assert_eq!((tool.as_str(), input["command"].as_str()), ("Bash", Some("ping -c 1 127.0.0.1")));
        // Resposta: `cancel` é o reject_once do Qwen; `craft/drainMidTurnQueue` recebe método não suportado.
        assert_eq!(out[3]["result"]["outcome"]["optionId"], "cancel");
        assert_eq!(out[4]["error"]["code"], -32601);
        // O cartão da ferramenta fica com o comando (o tool_call chegou vazio).
        assert_eq!(tools_of(&ev), vec![("Bash".to_string(), json!({ "command": "ping -c 1 127.0.0.1" }))]);
        assert!(ev.iter().any(|e| matches!(e, Event::ToolResult { is_error: true, output, .. } if output.contains("canceled"))));
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { input_tokens: Some(42), output_tokens: Some(7), .. }), "uso pelo _meta.usage");
    }

    /// Saída real do Goose 1.55 (`goose acp`): nasce em `auto` (o Kabul troca para `approve`), `kind: other`
    /// com o nome no `_meta.goose`, escrita pelo `fs/write_text_file` do cliente.
    #[test]
    fn fixture_real_goose() {
        let dir = std::env::temp_dir().join(format!("kabul-acp-goose-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.display().to_string();
        let fx = include_str!("../../tests/fixtures/acp_goose.ndjson").replace("/tmp/exemplo", &d);
        let mut p = AcpProtocol::new(AcpOptions { cwd: d.clone(), ..Default::default() });
        assert!(p.user_message("Crie.").is_empty());
        let (ev, out) = conversa(&mut p, &fx);
        assert_eq!(out[2]["method"], "session/set_mode");
        assert_eq!(out[2]["params"]["modeId"], "approve");
        assert_eq!(out[3]["method"], "session/prompt");
        let (rid, tool, input) = ask_of(&ev);
        assert_eq!((tool.as_str(), input["file_path"].as_str(), input["content"].as_str()), ("Write", Some(format!("{d}/x.txt").as_str()), Some("abc")));
        assert_eq!(lines(&p.approval(&rid, true))[0]["result"]["outcome"]["optionId"], "allow_once");
        // O Kabul gravou o arquivo que o Goose pediu e respondeu o pedido.
        assert_eq!(std::fs::read_to_string(dir.join("x.txt")).unwrap(), "abc");
        assert!(out.iter().any(|o| o["id"] == "00000000-0000-4000-8000-000000000003" && o["result"].is_null()));
        assert_eq!(tools_of(&ev)[0].0, "Write");
        assert!(ev.contains(&Event::TextDelta { text: "feito".into() }));
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { input_tokens: Some(42), .. }));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Saída real do Gemini CLI 0.65 (`gemini --acp`, gateway Gemini de teste, sem `fs` do cliente) e o
    /// replay do `session/load`, que começa antes da resposta e continua depois dela.
    #[test]
    fn fixture_real_gemini() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/tmp/exemplo".into(), no_client_fs: true, ..Default::default() });
        assert!(p.user_message("Crie.").is_empty());
        let (ev, out) = conversa(&mut p, include_str!("../../tests/fixtures/acp_gemini.ndjson"));
        assert_eq!(out[0]["params"]["clientCapabilities"]["fs"]["readTextFile"], false);
        assert_eq!(out[2]["method"], "session/prompt");
        assert!(ev.iter().any(|e| matches!(e, Event::SessionStarted { model: Some(m), .. } if m == "fake-model")));
        let (rid, tool, input) = ask_of(&ev);
        assert_eq!((tool.as_str(), input["file_path"].as_str(), input["content"].as_str()), ("Write", Some("/tmp/exemplo/x.txt"), Some("abc")));
        assert_eq!(lines(&p.approval_ext(&rid, true, &tool, None, true))[0]["result"]["outcome"]["optionId"], "proceed_always");
        assert!(ev.iter().any(|e| matches!(e, Event::ToolResult { is_error: false, .. })));
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { input_tokens: Some(84), output_tokens: Some(14), .. }));
        // Erro de login real (sem chave): dica pelos authMethods.
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), ..Default::default() });
        p.startup();
        p.user_message("oi");
        p.on_line(include_str!("../../tests/fixtures/acp_gemini.ndjson").lines().next().unwrap());
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Gemini API key is missing or not configured."}}"#);
        assert!(matches!(&ev[0], Event::Error { message } if message.contains("Log in with your Google account")), "{ev:?}");
        assert!(matches!(ev[1], Event::TurnCompleted { .. }), "sem sessão o turno fecha");
    }

    /// Plan mode: nativo pelo `session/set_mode` e troca ao vivo; emulado quando o agente não tem o modo.
    #[test]
    fn plan_nativo_emulado_e_troca_ao_vivo() {
        // Qwen: tem `plan` → set_mode plan; depois sai ao vivo para `default`.
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), mode: Some("plan".into()), ..Default::default() });
        p.startup();
        p.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}"#);
        let (_, out) = p.on_line(r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"s","modes":{"currentModeId":"auto","availableModes":[{"id":"plan"},{"id":"default"},{"id":"auto"}]}}}"#);
        assert_eq!(lines(&out)[0]["params"]["modeId"], "plan");
        let back = lines(&p.set_mode("default").unwrap());
        assert_eq!((back[0]["method"].as_str(), back[0]["params"]["modeId"].as_str()), (Some("session/set_mode"), Some("default")));
        assert!(!lines(&p.user_message("x"))[0]["params"]["prompt"][0]["text"].as_str().unwrap().contains("[Plan mode]"));
        // Goose: sem `plan` → `approve` + plan emulado (instrução no prompt e escrita negada sem cartão).
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), mode: Some("plan".into()), ..Default::default() });
        p.startup();
        p.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}"#);
        let (_, out) = p.on_line(r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"g","modes":{"currentModeId":"auto","availableModes":[{"id":"auto"},{"id":"approve"},{"id":"chat"}]}}}"#);
        assert_eq!(lines(&out)[0]["params"]["modeId"], "approve");
        let first = lines(&p.user_message("planeje"));
        assert!(first[0]["params"]["prompt"][0]["text"].as_str().unwrap().starts_with("[Plan mode]"));
        let (ev, out) = p.on_line(r#"{"jsonrpc":"2.0","id":"q1","method":"session/request_permission","params":{"sessionId":"g","toolCall":{"toolCallId":"c1","kind":"other","title":"write · /w/x","rawInput":{"path":"/w/x","content":"a"},"_meta":{"goose":{"toolCall":{"toolName":"write"}}}},"options":[{"optionId":"ok","kind":"allow_once"},{"optionId":"nao","kind":"reject_once"}]}}"#);
        assert!(!ev.iter().any(|e| matches!(e, Event::ApprovalRequest { .. })), "sem cartão em plan emulado");
        assert_eq!(lines(&out)[0]["result"]["outcome"]["optionId"], "nao");
        // Leitura continua indo para o cartão.
        let (ev, _) = p.on_line(
            r#"{"jsonrpc":"2.0","id":"q2","method":"session/request_permission","params":{"sessionId":"g","toolCall":{"toolCallId":"c2","kind":"read","title":"read","rawInput":{"path":"/w/x"}},"options":[{"optionId":"ok","kind":"allow_once"}]}}"#,
        );
        assert!(ev.iter().any(|e| matches!(e, Event::ApprovalRequest { tool, .. } if tool == "Read")));
        // Plano aprovado: sai do emulado; escrita volta a pedir cartão.
        p.set_mode("default");
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","id":"q3","method":"session/request_permission","params":{"sessionId":"g","toolCall":{"toolCallId":"c3","kind":"other","title":"write · /w/y","rawInput":{"path":"/w/y","content":"a"}},"options":[{"optionId":"ok","kind":"allow_once"}]}}"#);
        assert!(ev.iter().any(|e| matches!(e, Event::ApprovalRequest { tool, .. } if tool == "Write")));
        assert_eq!(AcpHarness(HarnessKind::Goose).plan_support(), PlanSupport::Emulated);
        assert_eq!(HarnessKind::QwenCode.harness().plan_support(), PlanSupport::Native);
        // Gemini avisa a troca de modo como texto: vira log.
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"g","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"[MODE_UPDATE] plan"}}}}"#);
        assert!(matches!(&ev[0], Event::Log { .. }));
    }

    /// Erros reais sem conta: Goose ("Internal error" + motivo no `data`) e Qwen Code (`-32000`).
    #[test]
    fn erros_de_login_reais() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), ..Default::default() });
        p.startup();
        p.user_message("oi");
        p.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true},"authMethods":[{"id":"goose-provider","name":"Configure Provider","description":"Run `goose configure` to set up your AI provider and API key"}],"agentInfo":{"name":"goose","version":"1.55.0"}}}"#);
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"Internal error","data":"Failed to resolve provider: Configuration value not found: GOOSE_PROVIDER"}}"#);
        assert!(matches!(&ev[0], Event::Error { message } if message.contains("GOOSE_PROVIDER") && message.contains("goose configure")), "{ev:?}");
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), ..Default::default() });
        p.startup();
        p.on_line(
            r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"authMethods":[{"id":"openai","name":"Use OpenAI API key","description":"Requires setting the `OPENAI_API_KEY` environment variable"}],"agentCapabilities":{"loadSession":true}}}"#,
        );
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Authentication required: Use Qwen Code CLI to authenticate first.","data":{"authMethods":[{"id":"openai"}]}}}"#);
        assert!(matches!(&ev[0], Event::Error { message } if message.contains("OPENAI_API_KEY")));
        assert_eq!(ev.len(), 1, "sem mensagem na fila, nada de turno para fechar");
    }

    /// Replay real do Gemini CLI no `session/load` (fixture), com o prompt segurado até ele acabar.
    #[test]
    fn fixture_real_gemini_load() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/tmp/exemplo".into(), resume: Some("00000000-0000-4000-8000-000000000001".into()), ..Default::default() });
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
        let tx = Mutex::new(tx);
        p.attach_writer(Arc::new(move |l| {
            let _ = tx.lock().unwrap().send(l);
        }));
        assert_eq!(lines(&p.startup())[0]["method"], "initialize");
        p.user_message("De novo.");
        let fx: Vec<&str> = include_str!("../../tests/fixtures/acp_gemini_load.ndjson").lines().collect();
        // initialize, replay (antes e depois da resposta do load), resposta do load.
        let mut ev = vec![];
        let (i, rest) = fx.split_at(fx.iter().position(|l| l.contains(r#""id":3,"#) || l.contains("agent_message_chunk")).unwrap());
        for l in i {
            ev.extend(p.on_line(l).0);
        }
        // O replay do último turno (texto antigo) chega depois da resposta do load e não entra.
        let (old, new) = rest.split_at(1);
        ev.extend(p.on_line(old[0]).0);
        assert!(!ev.iter().any(|e| matches!(e, Event::TextDelta { .. })), "replay ignorado: {ev:?}");
        let sent = lines(&rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap());
        assert_eq!(sent[0]["method"], "session/prompt");
        for l in new {
            ev.extend(p.on_line(l).0);
        }
        assert_eq!(ev.iter().filter(|e| matches!(e, Event::TextDelta { .. })).count(), 1, "só o texto do turno novo");
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { .. }));
    }

    /// Gemini CLI: o replay do `session/load` continua depois da resposta; o prompt espera ele acabar.
    #[test]
    fn replay_depois_do_load() {
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), resume: Some("s1".into()), ..Default::default() });
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
        let tx = Mutex::new(tx);
        p.attach_writer(Arc::new(move |l| {
            let _ = tx.lock().unwrap().send(l);
        }));
        p.startup();
        assert!(p.user_message("de novo").is_empty());
        p.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true}}}"#);
        let (ev, out) = p.on_line(r#"{"jsonrpc":"2.0","id":2,"result":{"modes":{"currentModeId":"default","availableModes":[{"id":"default"}]}}}"#);
        assert!(matches!(&ev[0], Event::SessionStarted { session_id, .. } if session_id == "s1"));
        assert!(out.is_empty(), "prompt segurado durante o replay");
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"antigo"}}}}"#);
        assert!(ev.is_empty(), "replay depois da resposta também é ignorado");
        // Mensagem nova durante o replay entra na mesma fila.
        assert!(p.user_message("mais uma").is_empty());
        let sent = lines(&rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap());
        assert_eq!(sent.iter().map(|l| l["params"]["prompt"][0]["text"].as_str().unwrap()).collect::<Vec<_>>(), vec!["de novo", "mais uma"]);
        let (ev, _) = p.on_line(r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"novo"}}}}"#);
        assert_eq!(ev, vec![Event::TextDelta { text: "novo".into() }]);
        assert_eq!(lines(&p.user_message("depois"))[0]["method"], "session/prompt");
    }

    #[test]
    fn cliente_fs_terminal_e_erros() {
        let dir = std::env::temp_dir().join(format!("kabul-acp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut p = AcpProtocol::new(AcpOptions { cwd: dir.display().to_string(), ..Default::default() });
        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();
        let tx = Mutex::new(tx);
        p.attach_writer(Arc::new(move |l| {
            let _ = tx.lock().unwrap().send(l);
        }));
        let f = dir.join("a.txt");
        let w = format!(r#"{{"jsonrpc":"2.0","id":"w1","method":"fs/write_text_file","params":{{"sessionId":"s","path":"{}","content":"um\ndois\ntres"}}}}"#, f.display());
        assert_eq!(lines(&p.on_line(&w).1)[0]["result"], Value::Null);
        let r = format!(r#"{{"jsonrpc":"2.0","id":"r1","method":"fs/read_text_file","params":{{"sessionId":"s","path":"{}","line":2,"limit":1}}}}"#, f.display());
        assert_eq!(lines(&p.on_line(&r).1)[0]["result"]["content"], "dois");
        let (_, o) = p.on_line(r#"{"jsonrpc":"2.0","id":3,"method":"terminal/create","params":{"sessionId":"s","command":"echo","args":["ola-terminal"]}}"#);
        let tid = lines(&o)[0]["result"]["terminalId"].as_str().unwrap().to_string();
        let (_, o) = p.on_line(&format!(r#"{{"jsonrpc":"2.0","id":4,"method":"terminal/wait_for_exit","params":{{"sessionId":"s","terminalId":"{tid}"}}}}"#));
        assert!(o.is_empty(), "resposta adiada");
        let late = lines(&rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap());
        assert_eq!((late[0]["id"].as_i64(), late[0]["result"]["exitCode"].as_i64()), (Some(4), Some(0)));
        std::thread::sleep(std::time::Duration::from_millis(100));
        let (_, o) = p.on_line(&format!(r#"{{"jsonrpc":"2.0","id":5,"method":"terminal/output","params":{{"sessionId":"s","terminalId":"{tid}"}}}}"#));
        assert_eq!(lines(&o)[0]["result"]["output"], "ola-terminal\n");
        assert_eq!(lines(&p.on_line(&format!(r#"{{"jsonrpc":"2.0","id":6,"method":"terminal/release","params":{{"terminalId":"{tid}"}}}}"#)).1)[0]["result"], Value::Null);
        assert_eq!(lines(&p.on_line(r#"{"jsonrpc":"2.0","id":8,"method":"x/y","params":{}}"#).1)[0]["error"]["code"], -32601);
        // Erro de autenticação no prompt fecha o turno com dica.
        let mut p = AcpProtocol::new(AcpOptions { cwd: "/w".into(), ..Default::default() });
        p.startup();
        p.on_line(r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{}}}"#);
        p.on_line(r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"s1"}}"#);
        let id = lines(&p.user_message("x"))[0]["id"].as_u64().unwrap();
        let (ev, _) = p.on_line(&format!(r#"{{"jsonrpc":"2.0","id":{id},"error":{{"code":-32000,"message":"Authentication required"}}}}"#));
        assert!(matches!(&ev[0], Event::Error { message } if message.contains("login")));
        assert!(matches!(ev[1], Event::TurnCompleted { .. }));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Agente ACP real de ponta a ponta, com aprovação e negação pelo app, cancelar e retomar:
    /// `KABUL_TESTE_ACP_AGENTE=goose KABUL_TESTE_ACP_FALSO=1 cargo test -p kabul-core acp_real -- --ignored --nocapture`
    /// `KABUL_TESTE_ACP_AGENTE` = opencode | qwen | goose | gemini | cursor. O modelo vem de um destes:
    /// `KABUL_TESTE_ACP_FALSO=1` sobe `tests/fake-llm.mjs` (LLM falso OpenAI/Anthropic com roteiro, sem
    /// modelo nenhum: o CLI é o de verdade); `KABUL_TESTE_ACP_LOCAL` = id de um modelo local (LM Studio,
    /// Ollama…); `KABUL_TESTE_ACP_MODELO` = modelo da conta do agente.
    /// Plan mode de ponta a ponta com o CLI de verdade e o LLM falso: começa em plan (escrita não acontece,
    /// mesmo aprovando o que aparecer), sai do plan ao vivo e a escrita acontece na mesma sessão.
    /// `KABUL_TESTE_PLAN_AGENTE=<claude|codex|gemini|qwen|opencode|goose> cargo test -p kabul-core plan_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn plan_real() {
        let Some(kind) = std::env::var("KABUL_TESTE_PLAN_AGENTE").ok().and_then(|a| HarnessKind::parse(&a)) else { return };
        let dir = std::env::temp_dir().join(format!("kabul-plan-real-{}-{}", kind.binary(), std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.canonicalize().unwrap().display().to_string();
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-llm.mjs");
        let mut child = std::process::Command::new("node").arg(script).arg("0").stdout(Stdio::piped()).spawn().expect("node");
        let mut line = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(child.stdout.take().unwrap()), &mut line).unwrap();
        let _fake = KillOnDrop(child);
        let port = line.trim().trim_start_matches("PORTA ").to_string();
        let opts = SessionOptions {
            cwd: Some(d.clone()),
            approvals_via_app: true,
            permission_mode: Some("plan".into()),
            endpoint: Some(Endpoint { base_url: format!("http://127.0.0.1:{port}"), apis: vec![Api::Openai, Api::Anthropic, Api::Gemini], api_key: None, model: "fake-model".into(), context: Some(128_000) }),
            ..Default::default()
        };
        let h = kind.harness();
        eprintln!("plan: {:?}", h.plan_support());
        let mut r = crate::harness::spawn(h.as_ref(), &opts).unwrap();
        let turn = |r: &mut Running, prompt: &str| -> (usize, String) {
            r.send(prompt).unwrap();
            let (mut asked, mut text) = (0, String::new());
            loop {
                match r.events.recv_timeout(std::time::Duration::from_secs(60)).expect("sem eventos") {
                    Event::ApprovalRequest { request_id, tool, input } => {
                        eprintln!("aprovação: {tool} {input} -> aprovar");
                        asked += 1;
                        r.approve_ext(&request_id, true, &tool, None, false).unwrap();
                    }
                    Event::ToolResult { output, is_error, .. } => eprintln!("resultado ({is_error}): {}", output.chars().take(160).collect::<String>()),
                    Event::TextDelta { text: t } | Event::Text { text: t } => text.push_str(&t),
                    Event::Log { line } if line.contains("plan") => eprintln!("log: {line}"),
                    Event::TurnCompleted { .. } => break,
                    _ => {}
                }
            }
            eprintln!("texto: {text}");
            (asked, text)
        };
        turn(&mut r, &format!("Crie {d}/plano.txt. [KABUL-ESCREVER {d}/plano.txt kabul]"));
        assert!(!dir.join("plano.txt").exists(), "{kind:?} escreveu em plan mode");
        // Aprovou o plano: sai do plan ao vivo (sem reiniciar) e a mesma sessão escreve.
        let live = r.set_mode("default").unwrap();
        eprintln!("troca ao vivo: {live}");
        assert!(live, "{kind:?} não troca de modo ao vivo");
        turn(&mut r, &format!("Plano aprovado, pode criar {d}/feito.txt. [KABUL-ESCREVER {d}/feito.txt kabul]"));
        assert!(dir.join("feito.txt").exists(), "{kind:?} não escreveu depois de sair do plan");
        r.kill().ok();
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Encerra o servidor falso mesmo se o teste falhar (senão ele segura o stderr do cargo).
    struct KillOnDrop(std::process::Child);
    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            self.0.kill().ok();
            self.0.wait().ok();
        }
    }

    #[test]
    #[ignore]
    fn acp_real() {
        let Some(kind) = std::env::var("KABUL_TESTE_ACP_AGENTE").ok().and_then(|a| HarnessKind::parse(&a)) else { return };
        if !kind.installed() {
            eprintln!("{} não instalado", kind.binary());
            return;
        }
        let dir = std::env::temp_dir().join(format!("kabul-acp-real-{}-{}", kind.binary(), std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut opts = SessionOptions { cwd: Some(dir.display().to_string()), model: std::env::var("KABUL_TESTE_ACP_MODELO").ok(), approvals_via_app: true, permission_mode: Some("default".into()), ..Default::default() };
        let mut fake = None;
        if std::env::var("KABUL_TESTE_ACP_FALSO").is_ok() {
            let script = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-llm.mjs");
            let mut child = std::process::Command::new("node").arg(script).arg("0").stdout(Stdio::piped()).spawn().expect("node");
            let mut line = String::new();
            std::io::BufRead::read_line(&mut std::io::BufReader::new(child.stdout.take().unwrap()), &mut line).unwrap();
            let port = line.trim().trim_start_matches("PORTA ").to_string();
            opts.endpoint = Some(Endpoint { base_url: format!("http://127.0.0.1:{port}"), apis: vec![Api::Openai, Api::Anthropic, Api::Gemini], api_key: None, model: "fake-model".into(), context: Some(128_000) });
            fake = Some(KillOnDrop(child));
        }
        if let Ok(id) = std::env::var("KABUL_TESTE_ACP_LOCAL") {
            let src = crate::local::discover(&[]);
            let s = src.iter().find(|s| s.models.iter().any(|m| m.id == id)).expect("modelo local não encontrado");
            opts.endpoint = Some(crate::local::prepare(s, s.models.iter().find(|m| m.id == id).unwrap(), None).unwrap());
        }
        let wait = std::time::Duration::from_secs(std::env::var("KABUL_TESTE_ACP_ESPERA").ok().and_then(|s| s.parse().ok()).unwrap_or(600));
        let h = kind.harness();
        let mut r = crate::harness::spawn(h.as_ref(), &opts).unwrap();
        // Um turno: aprova ou nega cada pedido; `cancel` interrompe na primeira ferramenta.
        let turn = |r: &mut Running, prompt: &str, allow: bool, cancel: bool| -> (usize, String, Option<String>) {
            r.send(prompt).unwrap();
            let (mut asked, mut text, mut session) = (0, String::new(), None);
            loop {
                match r.events.recv_timeout(wait).expect("sem eventos") {
                    Event::ApprovalRequest { request_id, tool, input } => {
                        eprintln!(
                            "aprovação: {tool} {input} -> {}",
                            if cancel {
                                "cancelar"
                            } else if allow {
                                "aprovar"
                            } else {
                                "negar"
                            }
                        );
                        asked += 1;
                        if cancel {
                            r.interrupt().unwrap();
                        } else {
                            r.approve_ext(&request_id, allow, &tool, None, false).unwrap();
                        }
                    }
                    Event::ToolUse { name, input, .. } => {
                        eprintln!("ferramenta: {name} {input}");
                        if cancel && asked == 0 {
                            asked += 1;
                            r.interrupt().unwrap();
                        }
                    }
                    Event::SessionStarted { session_id, model } => {
                        eprintln!("sessão {session_id} ({model:?})");
                        session = Some(session_id);
                    }
                    Event::TextDelta { text: t } | Event::Text { text: t } => text.push_str(&t),
                    Event::TurnCompleted { .. } => break,
                    Event::Error { message } if !cancel => panic!("{message}"),
                    Event::Log { .. } | Event::Reasoning { .. } | Event::Raw { .. } => {}
                    e => eprintln!("{e:?}"),
                }
            }
            eprintln!("texto: {text}");
            (asked, text, session)
        };
        // Os marcadores [KABUL-…] guiam o LLM falso; um modelo de verdade segue o texto.
        let d = dir.canonicalize().unwrap().display().to_string();
        let (asked, _, session) = turn(&mut r, &format!("Use a ferramenta de escrever arquivo para criar {d}/aprovado.txt com o conteúdo kabul. Não explique. [KABUL-ESCREVER {d}/aprovado.txt kabul]"), true, false);
        assert!(asked >= 1, "esperava pedido de permissão");
        assert!(dir.join("aprovado.txt").exists(), "arquivo aprovado não foi criado");
        let (asked, _, _) = turn(&mut r, &format!("Agora use a ferramenta de escrever arquivo para criar {d}/negado.txt com o conteúdo x. Se for negado, só diga 'negado'. [KABUL-ESCREVER {d}/negado.txt x]"), false, false);
        assert!(asked >= 1, "esperava pedido de permissão");
        assert!(!dir.join("negado.txt").exists(), "arquivo negado foi criado");
        // `ping` e não `sleep`: o Qwen Code bloqueia `sleep` sozinho, antes de pedir permissão.
        let (asked, _, _) = turn(&mut r, "Rode no terminal: ping -c 20 127.0.0.1 [KABUL-SHELL ping -c 20 127.0.0.1]", true, true);
        assert!(asked >= 1, "esperava a ferramenta para cancelar");
        assert!(r.alive(), "cancelar não pode matar a sessão");
        // Depois de cancelar a mesma sessão aceita outro turno.
        let (_, text, _) = turn(&mut r, "Responda só ok.", true, false);
        assert!(!text.is_empty(), "sessão não respondeu depois de cancelar");
        // Espera sair: o Codex recusa retomar a thread enquanto o processo anterior a segura.
        r.kill().ok();
        r.wait();
        // Retomar: session/load com o mesmo id, sem reproduzir o histórico.
        let session = session.expect("sem id de sessão");
        let mut r = crate::harness::spawn(h.as_ref(), &SessionOptions { resume: Some(session.clone()), ..opts.clone() }).unwrap();
        let (_, text, resumed) = turn(&mut r, "Qual arquivo você criou com sucesso nesta conversa? Responda só o nome. [KABUL-LEMBRAR]", true, false);
        assert_eq!(resumed.as_deref(), Some(session.as_str()));
        assert!(text.contains("aprovado"), "não lembrou da conversa: {text}");
        if fake.is_some() {
            assert!(text.starts_with("arquivos:"), "histórico reproduzido entrou como texto novo: {text}");
        }
        r.kill().ok();
        drop(fake);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn comandos_dos_agentes() {
        let o = SessionOptions { cwd: Some("/w".into()), env: vec![("K".into(), "v".into())], ..Default::default() };
        assert_eq!(command(HarnessKind::OpenCode, &o).args, vec!["acp"]);
        assert_eq!(command(HarnessKind::GeminiCli, &o).args, vec!["--acp"]);
        assert_eq!(AcpHarness(HarnessKind::Goose).command(&o).program, "goose");
        assert_eq!(AcpHarness(HarnessKind::Cursor).command(&o).program, "cursor-agent");
        assert!(agent(HarnessKind::Claude).is_none() && agent(HarnessKind::Codex).is_none() && agent(HarnessKind::Antigravity).is_none());
    }
}
