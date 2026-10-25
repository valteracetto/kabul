//! Transcript canônico do Kabul: a conversa independe do harness. Cada trecho rodado por um agente é
//! um [`Segment`]; trocar de LLM (inclusive de harness) no mesmo chat abre um segmento novo e o
//! agente novo recebe um handoff (resumo, últimas mensagens, diff da branch e `.context/`).
//! Toda entrada tem autor (colaboração em tempo real virá pelo kabuld).
use crate::harness::{Event, HarnessKind};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Author {
    /// Pessoa (local ou, no futuro, um colaborador conectado). `device`: "mac", "celular", ...
    User {
        name: String,
        device: String,
    },
    Agent {
        harness: HarnessKind,
        model: String,
    },
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EntryKind {
    UserMessage {
        text: String,
        #[serde(default)]
        attachments: Vec<String>,
    },
    AssistantText {
        text: String,
    },
    Reasoning {
        text: String,
    },
    ToolCall {
        call_id: String,
        name: String,
        input: Value,
        output: Option<String>,
        is_error: bool,
    },
    Approval {
        request_id: String,
        tool: String,
        input: Value,
        decision: Option<String>,
    },
    /// Troca de LLM/harness no mesmo chat.
    Handoff {
        from: Option<String>,
        to: String,
        summary: String,
    },
    TurnEnd {
        duration_ms: Option<u64>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        cost_usd: Option<f64>,
    },
    Notice {
        text: String,
    },
    Error {
        text: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub seq: u64,
    pub at: u64,
    pub author: Author,
    pub segment: usize,
    /// Checkpoint gravado antes da mensagem do usuário (restaurar / fork).
    #[serde(default)]
    pub checkpoint: Option<String>,
    pub kind: EntryKind,
}

/// Trecho da conversa rodado por um harness/modelo, com o id de sessão daquele agente (para `--resume`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub harness: HarnessKind,
    pub model: String,
    pub agent_session: Option<String>,
    pub started_seq: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transcript {
    /// Versão do formato (ver `crate::schema`); ausente = 0. Leia com [`Transcript::from_json`].
    #[serde(default)]
    pub schema_version: u32,
    pub id: String,
    pub workspace_id: String,
    pub entries: Vec<Entry>,
    pub segments: Vec<Segment>,
}

impl Default for Transcript {
    fn default() -> Self {
        Self { schema_version: crate::schema::TRANSCRIPT, id: String::new(), workspace_id: String::new(), entries: vec![], segments: vec![] }
    }
}

impl Transcript {
    /// Lê um transcript gravado (ou recebido de outro kabuld), migrando formatos antigos.
    /// Formato mais novo que este Kabul: lido no melhor esforço (campos novos ignorados).
    pub fn from_json(text: &str) -> anyhow::Result<Self> {
        let mut doc: Value = serde_json::from_str(text)?;
        crate::schema::migrate(&mut doc, crate::schema::TRANSCRIPT, crate::schema::TRANSCRIPT_MIGRATIONS)?;
        let mut t: Self = serde_json::from_value(doc)?;
        t.schema_version = crate::schema::TRANSCRIPT;
        Ok(t)
    }
}

fn now() -> u64 {
    crate::store::now()
}

impl Transcript {
    fn push(&mut self, author: Author, kind: EntryKind) -> &mut Entry {
        let seq = self.entries.last().map(|e| e.seq + 1).unwrap_or(1);
        let segment = self.segments.len().saturating_sub(1);
        self.entries.push(Entry { seq, at: now(), author, segment, checkpoint: None, kind });
        self.entries.last_mut().unwrap()
    }

    pub fn current(&self) -> Option<&Segment> {
        self.segments.last()
    }

    pub fn user_message(&mut self, name: &str, device: &str, text: &str, checkpoint: Option<String>) {
        self.push(Author::User { name: name.into(), device: device.into() }, EntryKind::UserMessage { text: text.into(), attachments: vec![] }).checkpoint = checkpoint;
    }

    /// Começa (ou troca) o agente. Se já havia outro segmento, registra o handoff.
    pub fn start_segment(&mut self, harness: HarnessKind, model: &str, summary: Option<String>) {
        let from = self.current().map(|s| format!("{} · {}", s.model, s.harness.label()));
        let started_seq = self.entries.last().map(|e| e.seq + 1).unwrap_or(1);
        let changed = self.current().map(|s| s.harness != harness || s.model != model).unwrap_or(true);
        if !changed {
            return;
        }
        let had = !self.segments.is_empty();
        self.segments.push(Segment { harness, model: model.into(), agent_session: None, started_seq });
        if had {
            self.push(Author::System, EntryKind::Handoff { from, to: format!("{model} · {}", harness.label()), summary: summary.unwrap_or_default() });
        }
    }

    /// Autor "agente" do segmento atual.
    fn agent(&self) -> Option<Author> {
        self.current().map(|seg| Author::Agent { harness: seg.harness, model: seg.model.clone() })
    }

    /// Aplica um evento normalizado do harness atual. Caminho quente (cada delta de texto passa
    /// aqui): o autor só é montado quando uma entrada nova nasce.
    pub fn apply(&mut self, ev: &Event) {
        if self.current().is_none() {
            return;
        }
        match ev {
            Event::SessionStarted { session_id, .. } => {
                if let Some(s) = self.segments.last_mut() {
                    s.agent_session = Some(session_id.clone());
                }
            }
            Event::Text { text } => {
                let a = self.agent().unwrap();
                self.push(a, EntryKind::AssistantText { text: text.clone() });
            }
            Event::TextDelta { text } => match self.entries.last_mut() {
                Some(Entry { kind: EntryKind::AssistantText { text: t }, .. }) => t.push_str(text),
                _ => {
                    let a = self.agent().unwrap();
                    self.push(a, EntryKind::AssistantText { text: text.clone() });
                }
            },
            Event::Reasoning { text } if !text.trim().is_empty() => {
                let a = self.agent().unwrap();
                self.push(a, EntryKind::Reasoning { text: text.clone() });
            }
            Event::ToolUse { id, name, input } => {
                let a = self.agent().unwrap();
                self.push(a, EntryKind::ToolCall { call_id: id.clone(), name: name.clone(), input: input.clone(), output: None, is_error: false });
            }
            Event::ToolResult { id, output, is_error } => {
                if let Some(EntryKind::ToolCall { output: o, is_error: e, .. }) = self.entries.iter_mut().rev().map(|x| &mut x.kind).find(|k| matches!(k, EntryKind::ToolCall { call_id, .. } if call_id == id)) {
                    *o = Some(output.clone());
                    *e = *is_error;
                }
            }
            Event::ApprovalRequest { request_id, tool, input } => {
                let a = self.agent().unwrap();
                self.push(a, EntryKind::Approval { request_id: request_id.clone(), tool: tool.clone(), input: input.clone(), decision: None });
            }
            Event::TurnCompleted { input_tokens, output_tokens, cost_usd, .. } => {
                self.push(Author::System, EntryKind::TurnEnd { duration_ms: None, input_tokens: *input_tokens, output_tokens: *output_tokens, cost_usd: *cost_usd });
            }
            Event::Error { message } => {
                self.push(Author::System, EntryKind::Error { text: message.clone() });
            }
            _ => {}
        }
    }

    /// Entradas até a mensagem do usuário `upto_seq` (exclusive): base do fork e do "reset chat".
    pub fn upto(&self, upto_seq: u64) -> Vec<&Entry> {
        self.entries.iter().filter(|e| e.seq < upto_seq).collect()
    }
}

/// Material para o agente novo continuar a conversa (handoff ou replay de fork).
pub struct HandoffInput<'a> {
    pub entries: &'a [&'a Entry],
    /// Resumo da conversa até aqui (gerado pelo agente anterior com /compact ou pelo Kabul).
    pub summary: Option<&'a str>,
    /// Quantas mensagens recentes vão literais.
    pub last_n: usize,
    /// `git diff --stat` contra a base e branch atual.
    pub diff_stat: &'a str,
    pub branch: &'a str,
    /// Arquivos em `.context/` que o agente deve ler.
    pub context_files: &'a [String],
}

/// Monta a primeira mensagem do agente novo. Só texto: funciona em qualquer harness.
pub fn handoff_prompt(h: &HandoffInput) -> String {
    let msgs: Vec<String> = h
        .entries
        .iter()
        .filter_map(|e| match (&e.author, &e.kind) {
            (Author::User { name, .. }, EntryKind::UserMessage { text, .. }) => Some(format!("**{name}:** {text}")),
            (Author::Agent { model, .. }, EntryKind::AssistantText { text }) => Some(format!("**Agente ({model}):** {text}")),
            (_, EntryKind::ToolCall { name, output, is_error, .. }) => Some(format!(
                "_(ferramenta {name}{})_",
                if *is_error {
                    ", falhou"
                } else if output.is_some() {
                    ", ok"
                } else {
                    ""
                }
            )),
            _ => None,
        })
        .collect();
    let tail = &msgs[msgs.len().saturating_sub(h.last_n)..];
    let mut s = String::from("Você está continuando uma conversa que começou com outro agente, no mesmo repositório e na mesma branch. Leia o contexto abaixo e continue de onde parou; não refaça o que já foi feito.\n\n");
    if let Some(sum) = h.summary.filter(|s| !s.trim().is_empty()) {
        s.push_str(&format!("## Resumo até aqui\n\n{sum}\n\n"));
    }
    s.push_str(&format!("## Últimas mensagens ({} de {})\n\n{}\n\n", tail.len(), msgs.len(), tail.join("\n\n")));
    s.push_str(&format!("## Estado do código\n\nBranch `{}`. Mudanças em relação à base:\n\n```\n{}\n```\n", h.branch, h.diff_stat.trim()));
    if !h.context_files.is_empty() {
        s.push_str(&format!("\nArquivos de contexto em `.context/`: {}\n", h.context_files.join(", ")));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segmentos_autor_e_handoff() {
        let mut t = Transcript::default();
        t.start_segment(HarnessKind::Claude, "opus", None);
        t.user_message("dev", "mac", "corrija o login", Some("ck1".into()));
        t.apply(&Event::SessionStarted { session_id: "s1".into(), model: None });
        t.apply(&Event::ToolUse { id: "t1".into(), name: "Edit".into(), input: Value::Null });
        t.apply(&Event::ToolResult { id: "t1".into(), output: "ok".into(), is_error: false });
        t.apply(&Event::TextDelta { text: "Corri".into() });
        t.apply(&Event::TextDelta { text: "gi.".into() });
        assert_eq!(t.current().unwrap().agent_session.as_deref(), Some("s1"));
        assert!(matches!(&t.entries[0].author, Author::User { name, device } if name == "dev" && device == "mac"));
        assert_eq!(t.entries[0].checkpoint.as_deref(), Some("ck1"));
        assert!(matches!(&t.entries[2].kind, EntryKind::AssistantText { text } if text == "Corrigi."));
        // Troca de LLM e harness no mesmo chat.
        t.start_segment(HarnessKind::OpenCode, "qwen3-coder", Some("Login corrigido em auth.ts".into()));
        assert_eq!(t.segments.len(), 2);
        assert!(matches!(&t.entries.last().unwrap().kind, EntryKind::Handoff { from: Some(f), to, .. } if f == "opus · Claude Code" && to == "qwen3-coder · OpenCode"));
        t.start_segment(HarnessKind::OpenCode, "qwen3-coder", None);
        assert_eq!(t.segments.len(), 2, "mesmo modelo não abre segmento");
        let entries: Vec<&Entry> = t.entries.iter().collect();
        let p = handoff_prompt(&HandoffInput { entries: &entries, summary: Some("Login corrigido"), last_n: 10, diff_stat: " src/auth.ts | 4 ++--", branch: "dev/login", context_files: &["[LINEAR]-ENG-1.md".into()] });
        assert!(p.contains("**dev:** corrija o login") && p.contains("**Agente (opus):** Corrigi.") && p.contains("_(ferramenta Edit, ok)_"));
        assert!(p.contains("dev/login") && p.contains("src/auth.ts") && p.contains("[LINEAR]-ENG-1.md"));
        assert_eq!(t.upto(2).len(), 1);
        // Ida e volta pelo JSON mantém tudo e a versão.
        assert_eq!(Transcript::from_json(&serde_json::to_string(&t).unwrap()).unwrap(), t);
    }

    #[test]
    fn transcript_sem_versao_migra() {
        let v0 = r#"{"id":"chat-1","workspace_id":"w1","entries":[{"seq":1,"at":5,"author":{"kind":"system"},"segment":0,"kind":{"type":"notice","text":"oi"}}],"segments":[]}"#;
        let t = Transcript::from_json(v0).unwrap();
        assert_eq!((t.schema_version, t.id.as_str(), t.entries.len()), (crate::schema::TRANSCRIPT, "chat-1", 1));
        assert_eq!(Transcript::default().schema_version, crate::schema::TRANSCRIPT);
        let novo = r#"{"schema_version":50,"id":"c","workspace_id":"w","entries":[],"segments":[],"futuro":1}"#;
        assert_eq!(Transcript::from_json(novo).unwrap().id, "c");
    }
}
