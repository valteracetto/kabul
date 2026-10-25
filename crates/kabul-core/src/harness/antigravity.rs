//! Antigravity (Gemini): `agy --input-format stream-json --output-format stream-json -p= ...`.
//!
//! Formato confirmado nesta máquina: entrada `{"event":"user","message":{"role":"user","content":...}}`;
//! saída com `event` = `init` | `step_update` | `result`. Atenção: `-p` sozinho consome o próximo
//! argumento como prompt, por isso usamos `-p=` (prompt vazio; os turnos vêm do stdin).
//!
//! Aprovações (agy 1.4.7): no modo headless o agy não pergunta; nega na hora toda ferramenta que
//! precisa de permissão (passo `tool` com `state: ERROR` e "permission check failed … user denied",
//! ou passo `DONE` sem saída) e fecha o turno com `denied_actions`. O Kabul transforma isso num
//! cartão de aprovação: "permitir" grava a allow-rule mínima (`command(<linha>)`,
//! `write_file(<caminho>)`, …) no projeto do agy deste workspace (`--project kabul-<hash>`, arquivo
//! `~/.gemini/config/projects/<id>.json`, que o agy relê a cada ferramenta) e manda uma mensagem
//! pedindo para continuar. "Uma vez" tira a regra no fim do turno seguinte; "sempre" a mantém.
use super::*;
use serde_json::json;
use std::path::{Path, PathBuf};

pub struct Antigravity;

/// Projeto do agy usado pelo Kabul neste workspace: as regras gravadas pelo app valem só nele.
pub fn project_id(cwd: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in cwd.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("kabul-{h:016x}")
}

/// Pasta de configuração do agy: `<HOME>/.gemini`, com o HOME do perfil da conta quando houver
/// (o perfil do agy isola pelo `HOME`).
pub fn gemini_dir(env: &[(String, String)]) -> PathBuf {
    env.iter()
        .rev()
        .find(|(k, _)| k == "HOME")
        .map(|(_, v)| PathBuf::from(v))
        // HOME no macOS/Linux; USERPROFILE no Windows.
        .or_else(|| std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from))
        .unwrap_or_default()
        .join(".gemini")
}

/// Arquivo do projeto do agy deste workspace.
pub fn project_file(env: &[(String, String)], cwd: &str) -> PathBuf {
    gemini_dir(env).join("config/projects").join(format!("{}.json", project_id(cwd)))
}

/// Allow-rules do projeto (`permissionGrants.permissionGrants.allow`), preservando o resto do arquivo.
pub mod rules {
    use super::*;

    fn read(path: &Path) -> Value {
        std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| json!({}))
    }

    fn write(path: &Path, v: &Value) -> std::io::Result<()> {
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(v).unwrap_or_default())?;
        std::fs::rename(tmp, path)
    }

    /// Cria o projeto (vazio) se ainda não existir.
    pub fn ensure(path: &Path, cwd: &str) -> std::io::Result<()> {
        if path.is_file() {
            return Ok(());
        }
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("kabul").to_string();
        let base = Path::new(cwd).file_name().and_then(|s| s.to_str()).unwrap_or("workspace");
        write(path, &json!({ "id": id, "name": format!("Kabul · {base}"), "projectResources": {}, "permissionGrants": { "permissionGrants": { "allow": [] } } }))
    }

    pub fn allowed(path: &Path) -> Vec<String> {
        read(path).pointer("/permissionGrants/permissionGrants/allow").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default()
    }

    fn edit(path: &Path, f: impl FnOnce(&mut Vec<String>)) -> std::io::Result<()> {
        let mut v = read(path);
        let mut list = allowed(path);
        f(&mut list);
        if !v.is_object() {
            v = json!({});
        }
        let pg = v.as_object_mut().unwrap().entry("permissionGrants").or_insert_with(|| json!({}));
        if !pg.is_object() {
            *pg = json!({});
        }
        let inner = pg.as_object_mut().unwrap().entry("permissionGrants").or_insert_with(|| json!({}));
        if !inner.is_object() {
            *inner = json!({});
        }
        inner.as_object_mut().unwrap().insert("allow".into(), json!(list));
        write(path, &v)
    }

    pub fn add(path: &Path, rule: &str) -> std::io::Result<()> {
        edit(path, |l| {
            if !l.iter().any(|r| r == rule) {
                l.push(rule.to_string());
            }
        })
    }

    pub fn remove(path: &Path, rule: &str) -> std::io::Result<()> {
        edit(path, |l| l.retain(|r| r != rule))
    }
}

impl Antigravity {
    fn common(opts: &SessionOptions, a: &mut Vec<String>) {
        let mut push = |k: &str, v: &Option<String>| {
            if let Some(v) = v {
                a.push(k.into());
                a.push(v.clone());
            }
        };
        push("--model", &opts.model);
        let skip = opts.permission_mode.as_deref() == Some("bypassPermissions");
        // Configurações › Modelos › "Gemini: aprovar tudo automaticamente" vira --dangerously-skip-permissions.
        let mode = match opts.permission_mode.as_deref() {
            Some("acceptEdits") => Some("accept-edits".to_string()),
            Some("default") | Some("bypassPermissions") | None => None,
            Some(m) => Some(m.to_string()),
        };
        push("--mode", &mode);
        push("--effort", &opts.effort);
        push("--conversation", &opts.resume);
        // Projeto do agy por workspace (regras do Kabul isoladas das do usuário).
        push("--project", &opts.cwd.as_deref().map(project_id));
        if skip {
            a.push("--dangerously-skip-permissions".into());
        }
        for d in &opts.add_dirs {
            a.push("--add-dir".into());
            a.push(d.clone());
        }
    }
}

impl Harness for Antigravity {
    fn kind(&self) -> HarnessKind {
        HarnessKind::Antigravity
    }

    fn command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a: Vec<String> = ["--input-format", "stream-json", "--output-format", "stream-json"].map(String::from).to_vec();
        Self::common(opts, &mut a);
        a.push("-p=".into());
        CmdSpec::new("agy", a).with_cwd(opts.cwd.clone()).with_env(&opts.env)
    }

    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        if opts.remote_control.is_some() {
            // `--remote-control` do agy é booleano (não recebe nome).
            a.push("--remote-control".into());
        }
        Self::common(opts, &mut a);
        CmdSpec::new("agy", a).with_cwd(opts.cwd.clone()).with_env(&opts.env)
    }

    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol> {
        let mut p = AgyProtocol::default();
        // Com "aprovar tudo" o agy não nega nada; sem pasta não há projeto onde gravar regras.
        if opts.permission_mode.as_deref() != Some("bypassPermissions") {
            if let Some(cwd) = &opts.cwd {
                let f = project_file(&opts.env, cwd);
                if rules::ensure(&f, cwd).is_ok() {
                    p.rules = Some(f);
                }
            }
        }
        Box::new(p)
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities { remote_control: Support::Native, cloud: Support::TmuxMirror, teleport: Support::TmuxMirror, background: Support::TmuxMirror }
    }

    fn remote_control_status(&self) -> Option<CmdSpec> {
        Some(CmdSpec::new("agy", ["remote-control", "status"]))
    }
}

/// Comandos do daemon de remote-control: start|status|stop.
pub fn remote_control_daemon(action: &str) -> Option<CmdSpec> {
    matches!(action, "start" | "status" | "stop").then(|| CmdSpec::new("agy", ["remote-control", action]))
}

/// Nome e parâmetros de uma ferramenta do agy no formato dos cartões do Kabul (Bash, Read, Write…),
/// mantendo os parâmetros originais.
pub fn normalize_tool(name: &str, params: &Value) -> (String, Value) {
    let p = |k: &[&str]| k.iter().find_map(|k| params.get(*k).and_then(Value::as_str)).map(String::from);
    let mut o = params.as_object().cloned().unwrap_or_default();
    let mut put = |k: &str, v: Option<String>| {
        if let Some(v) = v {
            o.insert(k.into(), Value::String(v));
        }
    };
    let n = match name {
        "run_command" => {
            put("command", p(&["CommandLine", "Command"]));
            "Bash"
        }
        "read_file" | "view_file" => {
            put("file_path", p(&["Path", "AbsolutePath", "File"]));
            "Read"
        }
        "write_file" | "write_to_file" => {
            put("file_path", p(&["Path", "TargetFile"]));
            put("content", p(&["CodeContent", "Content"]));
            "Write"
        }
        "replace_file_content" | "multi_replace_file_content" | "edit_file" | "sed_file" => {
            put("file_path", p(&["Path", "TargetFile"]));
            "Edit"
        }
        "list_dir" => {
            put("path", p(&["DirectoryPath", "Path"]));
            "LS"
        }
        "grep_search" => {
            put("pattern", p(&["Query", "Pattern"]));
            put("path", p(&["SearchPath", "Path"]));
            "Grep"
        }
        "find_by_name" => {
            put("pattern", p(&["Pattern", "Query"]));
            put("path", p(&["SearchDirectory", "Path"]));
            "Glob"
        }
        "search_web" => {
            put("query", p(&["query", "Query"]));
            "WebSearch"
        }
        "read_url_content" => {
            put("url", p(&["Url", "URL", "url"]));
            "WebFetch"
        }
        "call_mcp_tool" => {
            if let (Some(s), Some(t)) = (p(&["ServerName", "Server"]), p(&["ToolName", "Tool"])) {
                return (format!("mcp__{s}__{t}"), params.get("Arguments").cloned().unwrap_or(Value::Object(o)));
            }
            name
        }
        other => other,
    };
    (n.to_string(), Value::Object(o))
}

/// Allow-rule mínima para um passo negado: a que o agy cita no erro, senão a montada pela ferramenta.
pub fn rule_for(name: &str, params: &Value, error: Option<&str>) -> Option<String> {
    if let Some(e) = error {
        let first = e.lines().next().unwrap_or("");
        if let Some(i) = first.find("permission for ") {
            let r = first[i + "permission for ".len()..].trim();
            if r.ends_with(')') && r.contains('(') {
                return Some(r.to_string());
            }
        }
    }
    let p = |k: &[&str]| k.iter().find_map(|k| params.get(*k).and_then(Value::as_str)).map(String::from);
    match name {
        "run_command" => p(&["CommandLine", "Command"]).map(|c| format!("command({})", c.trim())),
        "read_file" | "view_file" | "list_dir" => p(&["Path", "AbsolutePath", "DirectoryPath"]).map(|c| format!("read_file({c})")),
        "write_file" | "write_to_file" | "replace_file_content" | "multi_replace_file_content" | "edit_file" | "sed_file" => p(&["Path", "TargetFile"]).map(|c| format!("write_file({c})")),
        "call_mcp_tool" => match (p(&["ServerName", "Server"]), p(&["ToolName", "Tool"])) {
            (Some(s), Some(t)) => Some(format!("mcp({s}/{t})")),
            _ => None,
        },
        _ => None,
    }
}

fn is_permission_error(msg: &str) -> bool {
    msg.contains("permission check failed") || msg.contains("user denied permission")
}

#[derive(Debug, Clone)]
struct Step {
    id: String,
    name: String,
    params: Value,
    output: Option<String>,
    error: Option<String>,
    finished: bool,
}

#[derive(Debug, Clone)]
struct Denial {
    id: String,
    rule: String,
}

#[derive(Default)]
pub struct AgyProtocol {
    pub conversation_id: Option<String>,
    /// Projeto do agy onde gravar as regras aprovadas (None = sem fluxo de aprovação).
    pub rules: Option<PathBuf>,
    /// Passos de ferramenta do turno atual, por `step_index`.
    steps: Vec<(i64, Step)>,
    /// Texto do bloco de resposta atual (desde a última ferramenta).
    text: String,
    /// O último evento emitido foi texto (o `Text` final pode substituir o bloco).
    text_open: bool,
    /// Algum passo deste turno produziu texto ou saída.
    produced: bool,
    pending: Vec<Denial>,
    decided: Vec<(Denial, bool)>,
    /// Regras "permitir uma vez": saem no fim do próximo turno.
    temporary: Vec<String>,
    /// O turno atual já emitiu `TurnCompleted` (evita o fim de turno em dobro).
    turn_done: bool,
}

impl AgyProtocol {
    fn step_mut(&mut self, idx: i64) -> Option<&mut Step> {
        self.steps.iter_mut().find(|(i, _)| *i == idx).map(|(_, s)| s)
    }

    fn on_step(&mut self, st: &Value) -> Vec<Event> {
        let step_type = st.get("step_type").and_then(Value::as_str).unwrap_or("");
        let state = st.get("state").and_then(Value::as_str).unwrap_or("");
        let mut out = vec![];
        match step_type {
            "user_input" | "system_message" => {}
            "agent_response" => {
                if let Some(t) = st.get("text_delta").and_then(Value::as_str).filter(|t| !t.is_empty()) {
                    self.text.push_str(t);
                    self.text_open = true;
                    self.produced = true;
                    out.push(Event::TextDelta { text: t.into() });
                }
            }
            "thinking" | "planner_response" => {
                if let Some(t) = st.get("text_delta").and_then(Value::as_str) {
                    out.push(Event::Reasoning { text: t.into() });
                }
            }
            _ => {
                let idx = st.get("step_index").and_then(Value::as_i64).unwrap_or(-1);
                let info = st.get("tool_info").cloned().unwrap_or(Value::Null);
                let name = info.get("name").and_then(Value::as_str).or_else(|| st.get("tool_name").and_then(Value::as_str)).unwrap_or(step_type).to_string();
                let params = info.get("parameters").cloned().unwrap_or_else(|| json!({}));
                let conv = st.get("conversation_id").and_then(Value::as_str).or(self.conversation_id.as_deref()).unwrap_or("");
                let id = format!("{}:{idx}", conv.get(..8).unwrap_or(conv));
                if self.step_mut(idx).is_none() {
                    self.steps.push((idx, Step { id: id.clone(), name: name.clone(), params: params.clone(), output: None, error: None, finished: false }));
                    let (n, input) = normalize_tool(&name, &params);
                    self.text.clear();
                    self.text_open = false;
                    out.push(Event::ToolUse { id: id.clone(), name: n, input });
                }
                if matches!(state, "DONE" | "ERROR" | "CANCELED" | "CANCELLED") {
                    let output = info.get("output").and_then(Value::as_str).map(String::from);
                    let error = info.pointer("/error/message").and_then(Value::as_str).map(String::from).or_else(|| (state == "ERROR").then(|| "falhou".to_string()));
                    let rules_on = self.rules.is_some();
                    let s = self.step_mut(idx).unwrap();
                    if s.finished {
                        return out;
                    }
                    s.finished = true;
                    s.output = output.clone();
                    s.error = error.clone();
                    let denied = error.as_deref().is_some_and(is_permission_error);
                    if output.is_some() {
                        self.produced = true;
                    }
                    let shown = match (&output, &error) {
                        (_, Some(e)) if denied => format!("Bloqueado pelo agy: precisa de permissão{}.\n\n{}", if rules_on { " (aprove no cartão abaixo)" } else { "" }, e.lines().next().unwrap_or("")),
                        (_, Some(e)) => e.clone(),
                        (Some(o), None) => o.clone(),
                        (None, None) => String::new(),
                    };
                    if denied {
                        if let Some(rule) = rule_for(&name, &params, error.as_deref()) {
                            self.pending.push(Denial { id: format!("agy-perm-{id}"), rule });
                        }
                    }
                    out.push(Event::ToolResult { id, output: shown, is_error: error.is_some() });
                }
            }
        }
        out
    }

    fn on_result(&mut self, r: &Value) -> Vec<Event> {
        // Resultado de outra conversa (subagente) não fecha o turno da principal.
        if let (Some(mine), Some(theirs)) = (self.conversation_id.as_deref(), r.get("conversation_id").and_then(Value::as_str)) {
            if mine != theirs && !theirs.is_empty() {
                return vec![];
            }
        }
        let mut out = vec![];
        if r.get("status").and_then(Value::as_str) == Some("ERROR") {
            out.push(Event::Error { message: s(r, "error").unwrap_or_default() });
        }
        let response = s(r, "response").unwrap_or_default();
        // O agy às vezes recomeça a resposta (retry) e o stream fica "P + resposta" com P prefixo
        // da resposta: o texto final substitui o bloco.
        if self.text_open && !response.is_empty() && self.text != response && self.text.ends_with(&response) && response.starts_with(&self.text[..self.text.len() - response.len()]) {
            out.push(Event::Text { text: response.clone() });
            self.text = response.clone();
        }
        let denied_any = r.get("denied_actions").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
        // Negação sem passo em ERROR (ex.: passo DONE sem saída): deduz pela ferramenta.
        if denied_any && self.pending.is_empty() {
            for (_, s) in self.steps.iter().filter(|(_, s)| s.finished && s.output.is_none() && s.error.is_none()) {
                if let Some(rule) = rule_for(&s.name, &s.params, None) {
                    self.pending.push(Denial { id: format!("agy-perm-{}", s.id), rule });
                }
            }
            if self.pending.is_empty() && !self.produced && response.is_empty() {
                let names: Vec<&str> = r["denied_actions"].as_array().unwrap().iter().filter_map(|d| d.get("display_name").and_then(Value::as_str)).collect();
                out.push(Event::Error { message: format!("O agy negou {} (no modo sem terminal ele não pergunta). Ative \"Gemini: aprovar tudo automaticamente\" em Configurações › Modelos ou use o terminal.", names.join(", ")) });
            }
        }
        // As regras "uma vez" valeram para o turno que acabou.
        if let Some(f) = &self.rules {
            for rule in self.temporary.drain(..) {
                let _ = rules::remove(f, &rule);
            }
        }
        let steps = std::mem::take(&mut self.steps);
        if !self.pending.is_empty() {
            match &self.rules {
                Some(f) => {
                    let have = rules::allowed(f);
                    let (again, ask): (Vec<Denial>, Vec<Denial>) = std::mem::take(&mut self.pending).into_iter().partition(|d| have.contains(&d.rule));
                    if !again.is_empty() {
                        out.push(Event::Error { message: format!("O agy negou {} mesmo com a regra gravada no projeto do Kabul. Conversas criadas antes (fora do projeto deste workspace) não usam essas regras: abra uma conversa nova ou ative \"Gemini: aprovar tudo automaticamente\".", again.iter().map(|d| d.rule.as_str()).collect::<Vec<_>>().join(", ")) });
                    }
                    for d in &ask {
                        let step = steps.iter().map(|(_, s)| s).find(|s| d.id.ends_with(&s.id));
                        let (tool, mut input) = step.map(|s| normalize_tool(&s.name, &s.params)).unwrap_or_else(|| ("agy".into(), json!({})));
                        if let Some(o) = input.as_object_mut() {
                            o.insert("rule".into(), json!(d.rule));
                            o.insert("scope".into(), json!("workspace"));
                        }
                        out.push(Event::ApprovalRequest { request_id: d.id.clone(), tool, input });
                    }
                    self.pending = ask;
                    if !self.pending.is_empty() {
                        // O turno continua depois da decisão (o fim vem do turno de continuação).
                        return out;
                    }
                }
                None => {
                    let list: Vec<String> = std::mem::take(&mut self.pending).into_iter().map(|d| d.rule).collect();
                    out.push(Event::Error { message: format!("O agy negou {} (no modo sem terminal ele não pergunta). Ative \"Gemini: aprovar tudo automaticamente\" em Configurações › Modelos ou use o terminal.", list.join(", ")) });
                }
            }
        }
        if !self.turn_done {
            self.turn_done = true;
            out.push(Event::TurnCompleted {
                result: Some(response).filter(|r| !r.is_empty()),
                input_tokens: r.pointer("/usage/input_tokens").and_then(Value::as_u64),
                output_tokens: r.pointer("/usage/output_tokens").and_then(Value::as_u64),
                cost_usd: None,
            });
        }
        out
    }

    fn continuation(&mut self) -> Vec<String> {
        let decided = std::mem::take(&mut self.decided);
        let lines: Vec<String> =
            decided.iter().map(|(d, allow)| if *allow { format!("Permissão concedida para `{}`.", d.rule) } else { format!("Permissão negada para `{}`: não tente contornar (outro comando, script ou ferramenta); siga sem isso.", d.rule) }).collect();
        let any_allow = decided.iter().any(|(_, a)| *a);
        let tail = if any_allow { "Continue de onde parou." } else { "Continue sem essa ação e diga o que ficou faltando." };
        self.user_message(&format!("{}\n{tail}", lines.join("\n")))
    }
}

impl Protocol for AgyProtocol {
    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        let line = line.trim();
        if line.is_empty() {
            return (vec![], vec![]);
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return (vec![Event::Log { line: line.into() }], vec![]),
        };
        let evs = match v.get("event").and_then(Value::as_str) {
            Some("init") => {
                let id = s(&v, "conversation_id").unwrap_or_default();
                self.conversation_id = Some(id.clone());
                vec![Event::SessionStarted { session_id: id, model: v.pointer("/init/model").and_then(Value::as_str).map(String::from) }]
            }
            Some("step_update") => self.on_step(&v["step_update"]),
            Some("result") => self.on_result(&v["result"]),
            _ => vec![Event::Raw { value: v }],
        };
        (evs, vec![])
    }

    fn user_message(&mut self, text: &str) -> Vec<String> {
        // Mensagem nova com aprovação em aberto: o pedido antigo perde o efeito.
        self.pending.clear();
        self.decided.clear();
        self.steps.clear();
        self.text.clear();
        self.text_open = false;
        self.produced = false;
        self.turn_done = false;
        vec![json!({"event":"user","message":{"role":"user","content":text}}).to_string()]
    }

    fn approval(&mut self, request_id: &str, allow: bool) -> Vec<String> {
        self.approval_ext(request_id, allow, "", None, false)
    }

    fn approval_ext(&mut self, request_id: &str, allow: bool, _tool: &str, _updated_input: Option<Value>, always: bool) -> Vec<String> {
        let Some(i) = self.pending.iter().position(|d| d.id == request_id) else { return vec![] };
        let d = self.pending.remove(i);
        if allow {
            if let Some(f) = &self.rules {
                if rules::add(f, &d.rule).is_ok() && !always {
                    self.temporary.push(d.rule.clone());
                }
            }
        }
        self.decided.push((d, allow));
        if self.pending.is_empty() {
            self.continuation()
        } else {
            vec![]
        }
    }
}

/// Parser sem estado de aprovação (usado em testes e por quem só quer os eventos).
pub fn parse_agy_line(line: &str, conv: &mut Option<String>) -> Vec<Event> {
    let mut p = AgyProtocol { conversation_id: conv.clone(), ..Default::default() };
    let ev = p.on_line(line).0;
    *conv = p.conversation_id;
    ev
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture_stream() {
        let mut p = AgyProtocol::default();
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/agy_stream.ndjson"));
        assert_eq!(p.conversation_id.as_deref(), Some("0978521f-0450-4920-a798-de1be58870b1"));
        assert!(matches!(&ev[0], Event::SessionStarted { model: Some(m), .. } if m == "gemini-3.8-flash-low"));
        assert_eq!(ev[1], Event::TextDelta { text: "oi".into() });
        assert!(matches!(ev.last().unwrap(), Event::TurnCompleted { result: Some(r), input_tokens: Some(8991), .. } if r == "oi\n"));
    }

    #[test]
    fn erro() {
        let ev = parse_agy_line(r#"{"event":"result","result":{"status":"ERROR","error":"falhou","usage":{}}}"#, &mut None);
        assert_eq!(ev[0], Event::Error { message: "falhou".into() });
    }

    #[test]
    fn comando() {
        let o = SessionOptions { model: Some("gemini-4-argon-high".into()), permission_mode: Some("auto".into()), resume: Some("c1".into()), ..Default::default() };
        let a = Antigravity.command(&o).args.join(" ");
        assert_eq!(a, "--input-format stream-json --output-format stream-json --model gemini-4-argon-high --mode auto --conversation c1 -p=");
        let v: Value = serde_json::from_str(&AgyProtocol::default().user_message("oi")[0]).unwrap();
        assert_eq!(v["event"], "user");
        assert_eq!(Antigravity.remote_control_status().unwrap().args, vec!["remote-control", "status"]);
        assert!(remote_control_daemon("start").is_some() && remote_control_daemon("x").is_none());
        assert_eq!(Antigravity.interactive_command(&SessionOptions { remote_control: Some("x".into()), ..Default::default() }).args, vec!["--remote-control"]);
        // Projeto por workspace, ambiente repassado e "aprovar tudo".
        let o = SessionOptions { cwd: Some("/tmp/ws".into()), permission_mode: Some("bypassPermissions".into()), env: vec![("K".into(), "v".into())], ..Default::default() };
        let c = Antigravity.command(&o);
        assert!(c.args.contains(&"--dangerously-skip-permissions".to_string()) && !c.args.contains(&"--mode".to_string()));
        let at = c.args.iter().position(|a| a == "--project").unwrap();
        assert_eq!(c.args[at + 1], project_id("/tmp/ws"));
        assert_eq!(project_id("/tmp/ws"), project_id("/tmp/ws"));
        assert_ne!(project_id("/tmp/ws"), project_id("/tmp/ws2"));
        assert_eq!(c.env, vec![("K".to_string(), "v".to_string())]);
        assert!(Antigravity.command(&SessionOptions { permission_mode: Some("default".into()), ..Default::default() }).args.iter().all(|a| a != "--mode"));
    }

    #[test]
    fn cartoes_de_ferramenta() {
        let (n, i) = normalize_tool("run_command", &json!({"CommandLine": "ls -la"}));
        assert_eq!((n.as_str(), i["command"].as_str()), ("Bash", Some("ls -la")));
        let (n, i) = normalize_tool("read_file", &json!({"Path": "/w/a.txt"}));
        assert_eq!((n.as_str(), i["file_path"].as_str(), i["Path"].as_str()), ("Read", Some("/w/a.txt"), Some("/w/a.txt")));
        assert_eq!(normalize_tool("ferramenta_nova", &json!({"X": 1})).0, "ferramenta_nova");
        let mut p = AgyProtocol::default();
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/agy_tools.ndjson"));
        let tools: Vec<_> = ev.iter().filter_map(|e| if let Event::ToolUse { name, input, .. } = e { Some((name.clone(), input.clone())) } else { None }).collect();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].0, "Read");
        assert_eq!(tools[1].1["command"], "echo oi");
        let res: Vec<_> = ev.iter().filter_map(|e| if let Event::ToolResult { output, is_error, .. } = e { Some((output.clone(), *is_error)) } else { None }).collect();
        assert_eq!(res[0], ("1 lines, 9 bytes".into(), false));
        assert!(res[1].0.contains("oi"));
        assert_eq!(ev.iter().filter(|e| matches!(e, Event::TurnCompleted { .. })).count(), 1, "um fim de turno só, mesmo com result repetido");
        assert!(!ev.iter().any(|e| matches!(e, Event::Raw { .. })));
    }

    #[test]
    fn resposta_recomecada_vira_texto_final() {
        let mut p = AgyProtocol::default();
        let fx = r#"{"event":"init","conversation_id":"c-1","init":{}}
{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Eu sou o **"}}
{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Eu sou o **Gemini**."}}
{"event":"result","result":{"conversation_id":"c-1","status":"SUCCESS","response":"Eu sou o **Gemini**.","usage":{}}}"#;
        let (ev, _) = run_fixture(&mut p, fx);
        assert!(ev.contains(&Event::Text { text: "Eu sou o **Gemini**.".into() }));
    }

    fn tmp_rules(nome: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kabul-agy-{nome}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let f = d.join("config/projects/kabul-x.json");
        rules::ensure(&f, "/w/repo").unwrap();
        f
    }

    #[test]
    fn negado_vira_aprovacao_e_regra_uma_vez() {
        let f = tmp_rules("uma");
        let mut p = AgyProtocol { rules: Some(f.clone()), ..Default::default() };
        p.user_message("roda");
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/agy_denied.ndjson"));
        let ap: Vec<_> = ev.iter().filter_map(|e| if let Event::ApprovalRequest { request_id, tool, input } = e { Some((request_id.clone(), tool.clone(), input.clone())) } else { None }).collect();
        assert_eq!(ap.len(), 1);
        assert_eq!(ap[0].1, "Bash");
        assert_eq!(ap[0].2["command"], "echo ola");
        assert_eq!(ap[0].2["rule"], "command(echo ola)");
        assert!(!ev.iter().any(|e| matches!(e, Event::TurnCompleted { .. })), "turno fica aberto esperando a decisão");
        assert!(ev.iter().any(|e| matches!(e, Event::ToolResult { is_error: true, .. })));
        // Permitir uma vez: grava a regra, pede para continuar e tira a regra no fim do turno seguinte.
        let out = p.approval_ext(&ap[0].0, true, "Bash", None, false);
        assert_eq!(rules::allowed(&f), vec!["command(echo ola)"]);
        let msg: Value = serde_json::from_str(&out[0]).unwrap();
        assert!(msg["message"]["content"].as_str().unwrap().contains("Continue de onde parou"));
        let (ev2, _) = run_fixture(
            &mut p,
            r#"{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":5,"state":"DONE","step_type":"tool","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo ola"},"output":"ola"}}}
{"event":"result","result":{"conversation_id":"c-1","status":"SUCCESS","response":"ola","usage":{},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}"#,
        );
        assert_eq!(ev2.iter().filter(|e| matches!(e, Event::TurnCompleted { .. })).count(), 1);
        assert!(!ev2.iter().any(|e| matches!(e, Event::ApprovalRequest { .. } | Event::Error { .. })), "denied_actions acumulado não gera pedido novo");
        assert!(rules::allowed(&f).is_empty());
        // Aprovação desconhecida não envia nada.
        assert!(p.approval_ext("x", true, "", None, false).is_empty());
    }

    #[test]
    fn sempre_permitir_mantem_e_negar_avisa() {
        let f = tmp_rules("sempre");
        let mut p = AgyProtocol { rules: Some(f.clone()), ..Default::default() };
        p.user_message("roda");
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/agy_denied.ndjson"));
        let rid = ev.iter().find_map(|e| if let Event::ApprovalRequest { request_id, .. } = e { Some(request_id.clone()) } else { None }).unwrap();
        p.approval_ext(&rid, true, "Bash", None, true);
        run_fixture(&mut p, r#"{"event":"result","result":{"conversation_id":"c-1","status":"SUCCESS","response":"ok","usage":{}}}"#);
        assert_eq!(rules::allowed(&f), vec!["command(echo ola)"]);
        // Negar: nada gravado, mensagem dizendo para não contornar.
        p.user_message("de novo");
        let (ev, _) = run_fixture(&mut p, &include_str!("../../tests/fixtures/agy_denied.ndjson").replace("echo ola", "rm -rf build"));
        let rid = ev.iter().find_map(|e| if let Event::ApprovalRequest { request_id, .. } = e { Some(request_id.clone()) } else { None }).unwrap();
        let out = p.approval(&rid, false);
        assert!(out[0].contains("não tente contornar"));
        assert_eq!(rules::allowed(&f), vec!["command(echo ola)"]);
        // Negado de novo com a regra já gravada (conversa de fora do projeto): erro explicativo, sem cartão.
        p.user_message("mais uma");
        let (ev, _) = run_fixture(&mut p, include_str!("../../tests/fixtures/agy_denied.ndjson"));
        assert!(!ev.iter().any(|e| matches!(e, Event::ApprovalRequest { .. })));
        assert!(ev.iter().any(|e| matches!(e, Event::Error { message } if message.contains("conversa nova"))));
    }

    #[test]
    fn negado_sem_passo_em_erro_e_regra_de_arquivo() {
        let f = tmp_rules("done");
        let mut p = AgyProtocol { rules: Some(f), ..Default::default() };
        p.user_message("x");
        let fx = r#"{"event":"init","conversation_id":"c-2","init":{}}
{"event":"step_update","step_update":{"conversation_id":"c-2","step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo ola"}}}}
{"event":"step_update","step_update":{"conversation_id":"c-2","step_index":2,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo ola"}}}}
{"event":"result","result":{"conversation_id":"c-2","status":"SUCCESS","response":"","usage":{},"denied_actions":[{"action":"command","display_name":"RunCommand"}]}}"#;
        let (ev, _) = run_fixture(&mut p, fx);
        assert!(ev.iter().any(|e| matches!(e, Event::ApprovalRequest { input, .. } if input["rule"] == "command(echo ola)")));
        assert_eq!(rule_for("write_file", &json!({"Path": "/w/a"}), Some("permission check failed for write_file \"/p/w/a\": user denied permission for write_file(/p/w/a)\nDo not")).as_deref(), Some("write_file(/p/w/a)"));
        assert_eq!(rule_for("write_file", &json!({"Path": "/w/a"}), None).as_deref(), Some("write_file(/w/a)"));
        // Sem projeto (ex.: sem pasta): sem cartão, só o erro legível.
        let mut p = AgyProtocol::default();
        let (ev, _) = run_fixture(&mut p, fx);
        assert!(ev.iter().any(|e| matches!(e, Event::Error { message } if message.contains("aprovar tudo") && message.contains("command(echo ola)"))));
        assert!(!ev.iter().any(|e| matches!(e, Event::ApprovalRequest { .. })));
        // Ferramenta sem regra conhecida: erro com o nome que o agy deu.
        let mut p = AgyProtocol { rules: Some(tmp_rules("browser")), ..Default::default() };
        let (ev, _) = run_fixture(&mut p, &fx.replace("run_command", "browser_click"));
        assert!(ev.iter().any(|e| matches!(e, Event::Error { message } if message.contains("RunCommand"))));
        assert!(ev.iter().any(|e| matches!(e, Event::TurnCompleted { .. })));
    }

    #[test]
    fn arquivo_do_projeto_preserva_campos() {
        let f = tmp_rules("campos");
        std::fs::write(&f, r#"{"id":"kabul-x","name":"n","extra":{"a":1},"permissionGrants":{"permissionGrants":{"allow":["command(ls)"],"deny":["command(rm)"]}}}"#).unwrap();
        rules::add(&f, "command(git status)").unwrap();
        rules::add(&f, "command(git status)").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(v["extra"]["a"], 1);
        assert_eq!(v["permissionGrants"]["permissionGrants"]["deny"][0], "command(rm)");
        assert_eq!(rules::allowed(&f), vec!["command(ls)", "command(git status)"]);
        rules::remove(&f, "command(ls)").unwrap();
        assert_eq!(rules::allowed(&f), vec!["command(git status)"]);
        assert_eq!(gemini_dir(&[("HOME".into(), "/perfis/a".into())]), PathBuf::from("/perfis/a/.gemini"));
        assert!(project_file(&[("HOME".into(), "/perfil".into())], "/w").starts_with("/perfil/.gemini/config/projects"));
    }
}
