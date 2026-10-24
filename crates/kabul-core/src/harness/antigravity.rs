//! Antigravity (Gemini): `agy --input-format stream-json --output-format stream-json -p= ...`.
//!
//! Formato confirmado nesta máquina: entrada `{"event":"user","message":{"role":"user","content":...}}`;
//! saída com `event` = `init` | `step_update` | `result`. Atenção: `-p` sozinho consome o próximo
//! argumento como prompt, por isso usamos `-p=` (prompt vazio; os turnos vêm do stdin).
use super::*;
use serde_json::json;

pub struct Antigravity;

impl Antigravity {
    fn common(opts: &SessionOptions, a: &mut Vec<String>) {
        let mut push = |k: &str, v: &Option<String>| {
            if let Some(v) = v {
                a.push(k.into());
                a.push(v.clone());
            }
        };
        push("--model", &opts.model);
        push("--mode", &opts.permission_mode);
        push("--effort", &opts.effort);
        push("--conversation", &opts.resume);
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
        CmdSpec::new("agy", a).with_cwd(opts.cwd.clone())
    }

    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec {
        let mut a = vec![];
        if opts.remote_control.is_some() {
            // `--remote-control` do agy é booleano (não recebe nome).
            a.push("--remote-control".into());
        }
        Self::common(opts, &mut a);
        CmdSpec::new("agy", a).with_cwd(opts.cwd.clone())
    }

    fn protocol(&self, _opts: &SessionOptions) -> Box<dyn Protocol> {
        Box::new(AgyProtocol::default())
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

#[derive(Default)]
pub struct AgyProtocol {
    pub conversation_id: Option<String>,
}

impl Protocol for AgyProtocol {
    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>) {
        (parse_agy_line(line, &mut self.conversation_id), vec![])
    }
    fn user_message(&mut self, text: &str) -> Vec<String> {
        vec![json!({"event":"user","message":{"role":"user","content":text}}).to_string()]
    }
}

pub fn parse_agy_line(line: &str, conv: &mut Option<String>) -> Vec<Event> {
    let line = line.trim();
    if line.is_empty() {
        return vec![];
    }
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return vec![Event::Log { line: line.into() }],
    };
    match v.get("event").and_then(Value::as_str) {
        Some("init") => {
            let id = s(&v, "conversation_id").unwrap_or_default();
            *conv = Some(id.clone());
            vec![Event::SessionStarted { session_id: id, model: v.pointer("/init/model").and_then(Value::as_str).map(String::from) }]
        }
        Some("step_update") => {
            let st = &v["step_update"];
            let step_type = st.get("step_type").and_then(Value::as_str).unwrap_or("");
            let mut out = vec![];
            match step_type {
                "user_input" => {}
                "agent_response" => {
                    if let Some(t) = st.get("text_delta").and_then(Value::as_str) {
                        out.push(Event::TextDelta { text: t.into() });
                    }
                }
                "thinking" | "planner_response" => {
                    if let Some(t) = st.get("text_delta").and_then(Value::as_str) {
                        out.push(Event::Reasoning { text: t.into() });
                    }
                }
                _ => {
                    // Passos de ferramenta: formato não confirmado; repassa como ToolUse genérico.
                    let id = st.get("step_index").map(|i| i.to_string()).unwrap_or_default();
                    if st.get("state").and_then(Value::as_str) == Some("ACTIVE") || st.get("state").is_none() {
                        out.push(Event::ToolUse { id, name: step_type.into(), input: st.clone() });
                    } else {
                        out.push(Event::Raw { value: v.clone() });
                    }
                }
            }
            out
        }
        Some("result") => {
            let r = &v["result"];
            let mut out = vec![];
            if r.get("status").and_then(Value::as_str) == Some("ERROR") {
                out.push(Event::Error { message: s(r, "error").unwrap_or_default() });
            }
            out.push(Event::TurnCompleted {
                result: s(r, "response"),
                input_tokens: r.pointer("/usage/input_tokens").and_then(Value::as_u64),
                output_tokens: r.pointer("/usage/output_tokens").and_then(Value::as_u64),
                cost_usd: None,
            });
            out
        }
        _ => vec![Event::Raw { value: v }],
    }
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
    }
}
