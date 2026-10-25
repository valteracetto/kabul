//! Harness genérico do Agent Client Protocol (ACP): JSON-RPC 2.0 em linhas por stdio.
//!
//! O Kabul é o *cliente*: `initialize` → `session/new` (ou `session/load` para retomar) →
//! `session/prompt` por turno. O agente manda `session/update` (texto, pensamento, ferramentas) e
//! pede coisas ao cliente: `session/request_permission` (vira o cartão de aprovação do Kabul),
//! `fs/read_text_file`, `fs/write_text_file` e `terminal/*` (o Kabul roda o processo e guarda a saída).
//!
//! Confirmado com `opencode acp` 2.1.4 nesta máquina (initialize, session/new com `configOptions`,
//! `session/set_config_option` do modelo, `tool_call`/`tool_call_update`, `request_permission` com
//! `allow_once`/`allow_always`/`reject_once`, `usage_update`, resposta do prompt com `stopReason` e
//! `usage`). Gemini CLI (`--experimental-acp`), Qwen Code (`--experimental-acp`), Goose (`goose acp`)
//! e Cursor (`cursor-agent acp`) seguem a mesma especificação; a confirmar com os CLIs instalados.
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
}

pub struct AcpProtocol {
    opts: AcpOptions,
    next_id: u64,
    pending: HashMap<u64, Pending>,
    session: Option<String>,
    can_load: bool,
    /// `session/load` reproduz o histórico: o Kabul já tem o dele, então ignora até a resposta.
    replaying: bool,
    /// Mensagens enviadas antes da sessão existir.
    queued: Vec<String>,
    calls: HashMap<String, Call>,
    /// Pedidos de permissão: id do JSON-RPC → opções oferecidas.
    asks: HashMap<String, (Value, Vec<Value>)>,
    terminals: Arc<Mutex<HashMap<String, Terminal>>>,
    writer: Option<Writer>,
    turn_open: bool,
}

impl AcpProtocol {
    pub fn new(opts: AcpOptions) -> Self {
        Self { opts, next_id: 0, pending: HashMap::new(), session: None, can_load: false, replaying: false, queued: vec![], calls: HashMap::new(), asks: HashMap::new(), terminals: Default::default(), writer: None, turn_open: false }
    }

    fn send(&mut self, method: &str, params: Value, what: Pending) -> String {
        self.next_id += 1;
        self.pending.insert(self.next_id, what);
        req(self.next_id, method, params)
    }

    fn prompt(&mut self, text: &str) -> String {
        self.turn_open = true;
        let sid = self.session.clone().unwrap_or_default();
        self.send("session/prompt", json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": text }] }), Pending::Prompt)
    }

    fn on_response(&mut self, v: &Value) -> (Vec<Event>, Vec<String>) {
        let Some(what) = v.get("id").and_then(Value::as_u64).and_then(|i| self.pending.remove(&i)) else { return (vec![], vec![]) };
        let mut ev = vec![];
        let mut out = vec![];
        if let Some(e) = v.get("error") {
            let msg = e.get("message").and_then(Value::as_str).unwrap_or("erro do agente").to_string();
            let hint = if msg.to_lowercase().contains("auth") { " (faça login no CLI do agente em Configurações › Contas ou no terminal)" } else { "" };
            match what {
                Pending::Config => ev.push(Event::Log { line: format!("acp: configuração recusada: {msg}") }),
                _ => ev.push(Event::Error { message: format!("{msg}{hint}") }),
            }
            if what == Pending::Prompt {
                self.turn_open = false;
                ev.push(Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None });
            }
            return (ev, out);
        }
        let r = &v["result"];
        match what {
            Pending::Initialize => {
                self.can_load = r.pointer("/agentCapabilities/loadSession").and_then(Value::as_bool).unwrap_or(false);
                let cwd = self.opts.cwd.clone();
                match self.opts.resume.clone().filter(|_| self.can_load) {
                    Some(id) => {
                        self.replaying = true;
                        self.session = Some(id.clone());
                        out.push(self.send("session/load", json!({ "sessionId": id, "cwd": cwd, "mcpServers": [] }), Pending::Session));
                    }
                    None => out.push(self.send("session/new", json!({ "cwd": cwd, "mcpServers": [] }), Pending::Session)),
                }
            }
            Pending::Session => {
                self.replaying = false;
                if let Some(id) = r.get("sessionId").and_then(Value::as_str) {
                    self.session = Some(id.to_string());
                }
                let sid = self.session.clone().unwrap_or_default();
                // Modelo: `configOptions` (opencode) ou `models` (instável na especificação).
                let opts = r.get("configOptions").and_then(Value::as_array).cloned().unwrap_or_default();
                let model_opt = opts.iter().find(|o| o.get("category").and_then(Value::as_str) == Some("model") || o.get("id").and_then(Value::as_str) == Some("model"));
                let mut current = model_opt.and_then(|o| o.get("currentValue")).and_then(Value::as_str).map(String::from).or_else(|| r.pointer("/models/currentModelId").and_then(Value::as_str).map(String::from));
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
                // Modo (ex.: plan) quando o agente oferece.
                if let Some(mode) = self.opts.mode.clone() {
                    let has = r.pointer("/modes/availableModes").and_then(Value::as_array).is_some_and(|a| a.iter().any(|x| x.get("id").and_then(Value::as_str) == Some(mode.as_str())));
                    if has {
                        out.push(self.send("session/set_mode", json!({ "sessionId": sid, "modeId": mode }), Pending::Config));
                    }
                }
                ev.push(Event::SessionStarted { session_id: sid, model: current });
                for text in std::mem::take(&mut self.queued) {
                    out.push(self.prompt(&text));
                }
            }
            Pending::Config => {}
            Pending::Prompt => {
                self.turn_open = false;
                let stop = r.get("stopReason").and_then(Value::as_str).unwrap_or("end_turn");
                if matches!(stop, "max_tokens" | "max_turn_requests" | "refusal") {
                    ev.push(Event::Error { message: format!("o agente parou: {stop}") });
                }
                let u = &r["usage"];
                if u.is_object() {
                    ev.push(Event::Usage { input: u.get("inputTokens").and_then(Value::as_u64), output: u.get("outputTokens").and_then(Value::as_u64), cache_read: u.get("cachedReadTokens").and_then(Value::as_u64), cache_write: u.get("cachedWriteTokens").and_then(Value::as_u64), duration_ms: None });
                }
                ev.push(Event::TurnCompleted { result: None, input_tokens: u.get("inputTokens").and_then(Value::as_u64), output_tokens: u.get("outputTokens").and_then(Value::as_u64), cost_usd: None });
            }
        }
        (ev, out)
    }

    fn on_update(&mut self, u: &Value) -> Vec<Event> {
        if self.replaying {
            return vec![];
        }
        let text = |u: &Value| u.pointer("/content/text").and_then(Value::as_str).map(String::from);
        match u.get("sessionUpdate").and_then(Value::as_str).unwrap_or("") {
            "agent_message_chunk" => text(u).filter(|t| !t.is_empty()).map(|t| vec![Event::TextDelta { text: t }]).unwrap_or_default(),
            "agent_thought_chunk" => text(u).map(|t| vec![Event::Reasoning { text: t }]).unwrap_or_default(),
            "tool_call" | "tool_call_update" => self.on_tool(u),
            "plan" => {
                let todos: Vec<Value> = u.get("entries").and_then(Value::as_array).map(|a| a.iter().map(|e| json!({ "content": e.get("content"), "status": e.get("status") })).collect()).unwrap_or_default();
                vec![Event::ToolUse { id: format!("plan-{}", self.next_id), name: "TodoWrite".into(), input: json!({ "todos": todos }) }]
            }
            "usage_update" => vec![],
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
                (vec![], vec![match r {
                    Ok(_) => reply(&id, Value::Null),
                    Err(e) => reply_err(&id, -32002, &format!("{path}: {e}")),
                }])
            }
            "terminal/create" => (vec![], vec![self.terminal_create(&id, p)]),
            "terminal/output" => {
                let t = self.terminals.lock().unwrap();
                let tid = p.get("terminalId").and_then(Value::as_str).unwrap_or("");
                (vec![], vec![match t.get(tid) {
                    Some(term) => {
                        let out = term.output.lock().unwrap().clone();
                        reply(&id, json!({ "output": out, "truncated": out.len() >= term.limit }))
                    }
                    None => reply_err(&id, -32002, "terminal não encontrado"),
                }])
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
            let mut c = std::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" });
            c.args([if cfg!(windows) { "/C" } else { "-c" }, cmd]);
            c
        } else {
            let mut c = std::process::Command::new(cmd);
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
    let name = match c.kind.as_str() {
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
                Some(d) if d.get("oldText").is_none_or(Value::is_null) => {
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
        vec![self.send("initialize", json!({ "protocolVersion": 1, "clientCapabilities": { "fs": { "readTextFile": true, "writeTextFile": true }, "terminal": true }, "clientInfo": { "name": "kabul", "version": env!("CARGO_PKG_VERSION") } }), Pending::Initialize)]
    }

    fn attach_writer(&mut self, w: Writer) {
        self.writer = Some(w);
    }

    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        let line = line.trim();
        if line.is_empty() {
            return (vec![], vec![]);
        }
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
        vec![self.prompt(text)]
    }

    fn approval(&mut self, request_id: &str, allow: bool) -> Vec<String> {
        self.approval_ext(request_id, allow, "", None, false)
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
        mode: opts.permission_mode.as_deref().filter(|m| *m == "plan").map(String::from),
        resume: opts.resume.clone(),
        auto_approve: matches!(opts.permission_mode.as_deref(), Some("bypassPermissions") | Some("acceptEdits")),
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
    AcpAgent { kind: HarnessKind::GeminiCli, program: "gemini", args: &["--experimental-acp"], confirmed: false },
    AcpAgent { kind: HarnessKind::QwenCode, program: "qwen", args: &["--experimental-acp"], confirmed: false },
    AcpAgent { kind: HarnessKind::Goose, program: "goose", args: &["acp"], confirmed: false },
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
        let rid = ev.iter().find_map(|e| if let Event::ApprovalRequest { request_id, input, .. } = e { assert_eq!(input["command"], "rm -rf build"); Some(request_id.clone()) } else { None }).unwrap();
        let r = lines(&p.approval(&rid, false));
        assert_eq!(r[0]["result"]["outcome"]["optionId"], "nao");
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

    /// OpenCode real pelo ACP com aprovação pelo app:
    /// `KABUL_TESTE_ACP_MODELO=opencode/<modelo> cargo test -p kabul-core opencode_acp_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn opencode_acp_real() {
        let Ok(model) = std::env::var("KABUL_TESTE_ACP_MODELO") else { return };
        if crate::harness::which("opencode").is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("kabul-acp-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let opts = SessionOptions { cwd: Some(dir.display().to_string()), model: Some(model), env: vec![("OPENCODE_CONFIG_CONTENT".into(), r#"{"permission":{"bash":"ask","edit":"ask"}}"#.into())], ..Default::default() };
        let h = HarnessKind::OpenCode.harness();
        let r = crate::harness::spawn(h.as_ref(), &opts).unwrap();
        r.send("Rode no terminal `echo kabul-acp` e responda só com a saída.").unwrap();
        let mut asked = 0;
        let mut text = String::new();
        loop {
            match r.events.recv_timeout(std::time::Duration::from_secs(180)).expect("sem eventos") {
                Event::ApprovalRequest { request_id, tool, input } => {
                    eprintln!("aprovação: {tool} {input}");
                    asked += 1;
                    r.approve_ext(&request_id, true, &tool, None, false).unwrap();
                }
                Event::TextDelta { text: t } => text.push_str(&t),
                Event::TurnCompleted { .. } => break,
                Event::Error { message } => panic!("{message}"),
                e => eprintln!("{e:?}"),
            }
        }
        assert!(asked >= 1, "esperava pedido de permissão");
        assert!(text.contains("kabul-acp"), "{text}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn comandos_dos_agentes() {
        let o = SessionOptions { cwd: Some("/w".into()), env: vec![("K".into(), "v".into())], ..Default::default() };
        assert_eq!(command(HarnessKind::OpenCode, &o).args, vec!["acp"]);
        assert_eq!(command(HarnessKind::GeminiCli, &o).args, vec!["--experimental-acp"]);
        assert_eq!(AcpHarness(HarnessKind::Goose).command(&o).program, "goose");
        assert_eq!(AcpHarness(HarnessKind::Cursor).command(&o).program, "cursor-agent");
        assert!(agent(HarnessKind::Claude).is_none() && agent(HarnessKind::Codex).is_none() && agent(HarnessKind::Antigravity).is_none());
    }
}
