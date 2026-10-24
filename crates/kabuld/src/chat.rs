//! Chats estruturados servidos pelo kabuld, compartilháveis entre vários clientes ao mesmo tempo.
//!
//! - **Transcript canônico** (`kabul_core::transcript`): toda mensagem tem autor (pessoa + aparelho).
//! - **Fila única do servidor**: mensagem que chega com o agente trabalhando (de quem quer que seja)
//!   entra na fila e sai na ordem de chegada quando o turno termina. Não há corrida entre clientes.
//! - **Aprovação**: a primeira decisão vale; as seguintes recebem "já decidido por X".
//! - **Troca de modelo/conta**: encerra o agente atual, abre um segmento novo e o primeiro envio leva o
//!   handoff (últimas mensagens com autor, diff da branch).
use crate::auth::Principal;
use crate::bus::Bus;
use crate::sessions::Status;
use anyhow::{bail, Context, Result};
use kabul_core::harness::{Event, HarnessKind, Running};
use kabul_core::transcript::{handoff_prompt, Author, Entry, EntryKind, HandoffInput, Transcript};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};

/// O processo do agente (no app: `harness::Running`; nos testes: um falso).
pub trait AgentProc: Send {
    fn send(&self, text: &str) -> Result<()>;
    fn approve(&self, request_id: &str, allow: bool, tool: &str, always: bool) -> Result<()>;
    fn kill(&mut self) -> Result<()>;
}

impl AgentProc for Running {
    fn send(&self, text: &str) -> Result<()> {
        Running::send(self, text)
    }
    fn approve(&self, request_id: &str, allow: bool, tool: &str, always: bool) -> Result<()> {
        self.approve_ext(request_id, allow, tool, None, always)
    }
    fn kill(&mut self) -> Result<()> {
        Running::kill(self)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMeta {
    pub id: String,
    pub workspace_id: String,
    /// Caminho do worktree (diff para o handoff).
    #[serde(skip)]
    pub path: String,
    pub branch: String,
    pub title: String,
    pub harness: HarnessKind,
    pub model: String,
    pub approvals: bool,
    pub account: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthorView {
    pub id: String,
    pub name: String,
    pub device: String,
    pub color: String,
}

impl From<&Principal> for AuthorView {
    fn from(p: &Principal) -> Self {
        Self { id: p.id.clone(), name: p.user.clone(), device: p.device.clone(), color: p.color.clone() }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Queued {
    pub id: String,
    pub text: String,
    pub author: AuthorView,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingApproval {
    pub request_id: String,
    pub tool: String,
    pub input: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatView {
    #[serde(flatten)]
    pub meta: ChatMeta,
    pub status: Status,
    pub detail: Option<String>,
    pub queue: Vec<Queued>,
    pub pending: Vec<PendingApproval>,
}

struct ChatState {
    meta: ChatMeta,
    transcript: Transcript,
    status: Status,
    queue: VecDeque<Queued>,
    pending: Vec<PendingApproval>,
    /// Handoff a anexar ao próximo envio (depois de trocar de modelo/conta).
    handoff: Option<String>,
    agent: Box<dyn AgentProc>,
    /// Geração do agente: eventos de um agente já trocado são ignorados.
    gen: u64,
}

impl ChatState {
    fn view(&self) -> ChatView {
        let detail = self.pending.first().map(|p| format!("Pede aprovação: {}", p.tool));
        ChatView { meta: self.meta.clone(), status: self.status, detail, queue: self.queue.iter().cloned().collect(), pending: self.pending.clone() }
    }
}

pub struct ChatHub {
    bus: Bus,
    chats: Mutex<HashMap<String, Arc<Mutex<ChatState>>>>,
    seq: AtomicU64,
}

fn author_of(e: &Entry) -> Value {
    match &e.author {
        Author::User { name, device } => json!({"kind": "user", "name": name, "device": device}),
        Author::Agent { harness, model } => json!({"kind": "agent", "harness": harness, "model": model}),
        Author::System => json!({"kind": "system"}),
    }
}

impl ChatHub {
    pub fn new(bus: Bus) -> Self {
        Self { bus, chats: Mutex::new(HashMap::new()), seq: AtomicU64::new(0) }
    }

    fn next(&self, p: &str) -> String {
        format!("{p}-{}-{}", crate::auth::random_token(3), self.seq.fetch_add(1, Ordering::Relaxed) + 1)
    }

    fn get(&self, id: &str) -> Result<Arc<Mutex<ChatState>>> {
        self.chats.lock().unwrap().get(id).cloned().context("chat não encontrado (encerrado?)")
    }

    pub fn workspace_of(&self, id: &str) -> Option<String> {
        self.chats.lock().unwrap().get(id).map(|c| c.lock().unwrap().meta.workspace_id.clone())
    }

    fn emit(&self, st: &ChatState, event: Value) {
        self.bus.emit("chat-event", json!({ "chat_id": st.meta.id, "event": event }), Some(st.meta.workspace_id.clone()), None);
    }

    fn emit_status(&self, st: &ChatState) {
        let v = st.view();
        self.bus.emit("session-status", json!({ "id": format!("chat:{}", st.meta.id), "title": st.meta.title, "status": v.status, "detail": v.detail, "workspace_id": st.meta.workspace_id }), Some(st.meta.workspace_id.clone()), None);
        self.bus.emit("chat-state", serde_json::to_value(&v).unwrap_or_default(), Some(st.meta.workspace_id.clone()), None);
    }

    /// Registra um chat novo com o agente já iniciado; os eventos chegam por `events`.
    pub fn start(self: &Arc<Self>, mut meta: ChatMeta, agent: Box<dyn AgentProc>, events: Receiver<Event>) -> ChatView {
        if meta.id.is_empty() {
            meta.id = self.next("chat");
        }
        let mut transcript = Transcript { id: meta.id.clone(), workspace_id: meta.workspace_id.clone(), ..Default::default() };
        transcript.start_segment(meta.harness, &meta.model, None);
        let st = ChatState { meta: meta.clone(), transcript, status: Status::Idle, queue: VecDeque::new(), pending: vec![], handoff: None, agent, gen: 0 };
        let view = st.view();
        let st = Arc::new(Mutex::new(st));
        self.chats.lock().unwrap().insert(meta.id.clone(), st.clone());
        self.pump(meta.id, 0, events);
        view
    }

    /// Chat que roda fora do kabuld (no app desktop). O kabuld não lê os eventos: o app os repassa
    /// com [`ChatHub::feed`]. Envios e aprovações vindos do celular vão ao mesmo processo do agente.
    pub fn attach_external(&self, meta: ChatMeta, agent: Box<dyn AgentProc>) -> ChatView {
        let mut transcript = Transcript { id: meta.id.clone(), workspace_id: meta.workspace_id.clone(), ..Default::default() };
        transcript.start_segment(meta.harness, &meta.model, None);
        let st = ChatState { meta: meta.clone(), transcript, status: Status::Idle, queue: VecDeque::new(), pending: vec![], handoff: None, agent, gen: 0 };
        let view = st.view();
        self.chats.lock().unwrap().insert(meta.id, Arc::new(Mutex::new(st)));
        view
    }

    /// Evento de um chat externo (o app já mostrou na própria tela).
    pub fn feed(&self, id: &str, ev: &Event) {
        if let Ok(st) = self.get(id) {
            self.on_event(&mut st.lock().unwrap(), ev);
        }
    }

    /// O app mandou uma mensagem direto ao agente: registra com autor e marca "trabalhando".
    pub fn record_local_send(&self, id: &str, who: &Principal, text: &str) {
        let Ok(st) = self.get(id) else { return };
        let mut st = st.lock().unwrap();
        st.transcript.user_message(&who.user, &who.device, text, None);
        let seq = st.transcript.entries.last().map(|e| e.seq).unwrap_or(0);
        self.emit(&st, json!({"type": "user_message", "id": format!("local-{seq}"), "seq": seq, "text": text, "author": AuthorView::from(who)}));
        st.status = Status::Working;
        self.emit_status(&st);
    }

    /// O app decidiu uma aprovação direto no agente.
    pub fn record_local_approval(&self, id: &str, who: &Principal, request_id: &str, allow: bool) {
        let Ok(st) = self.get(id) else { return };
        let mut st = st.lock().unwrap();
        st.pending.retain(|p| p.request_id != request_id);
        let decision = format!("{} por {}", if allow { "aprovado" } else { "negado" }, who.user);
        for e in st.transcript.entries.iter_mut().rev() {
            if let EntryKind::Approval { request_id: r, decision: d, .. } = &mut e.kind {
                if r == request_id {
                    *d = Some(decision.clone());
                    break;
                }
            }
        }
        self.emit(&st, json!({"type": "approval_decided", "request_id": request_id, "allow": allow, "by": AuthorView::from(who)}));
        if st.pending.is_empty() && st.status == Status::Waiting {
            st.status = Status::Working;
        }
        self.emit_status(&st);
    }

    fn pump(self: &Arc<Self>, id: String, gen: u64, events: Receiver<Event>) {
        let hub = self.clone();
        std::thread::spawn(move || {
            for ev in events {
                let Ok(st) = hub.get(&id) else { return };
                let mut st = st.lock().unwrap();
                if st.gen != gen {
                    return;
                }
                hub.on_event(&mut st, &ev);
            }
            if let Ok(st) = hub.get(&id) {
                let mut st = st.lock().unwrap();
                if st.gen == gen {
                    st.status = Status::Idle;
                    st.pending.clear();
                    hub.emit(&st, json!({"type": "exited", "code": null}));
                    hub.emit_status(&st);
                }
            }
        });
    }

    fn on_event(&self, st: &mut ChatState, ev: &Event) {
        st.transcript.apply(ev);
        let mut changed = false;
        match ev {
            Event::ApprovalRequest { request_id, tool, input } => {
                st.pending.push(PendingApproval { request_id: request_id.clone(), tool: tool.clone(), input: input.clone() });
                st.status = Status::Waiting;
                changed = true;
            }
            Event::TurnCompleted { .. } => {
                st.status = Status::Idle;
                st.pending.clear();
                changed = true;
            }
            _ => {}
        }
        self.emit(st, serde_json::to_value(ev).unwrap_or_default());
        if changed {
            self.emit_status(st);
        }
        if st.status == Status::Idle {
            if let Some(q) = st.queue.pop_front() {
                self.bus.emit("chat-queue", json!({"chat_id": st.meta.id, "queue": st.queue}), Some(st.meta.workspace_id.clone()), None);
                if let Err(e) = self.dispatch(st, q) {
                    self.emit(st, json!({"type": "error", "message": format!("{e:#}")}));
                }
            }
        }
    }

    /// Entrega a mensagem ao agente agora (registra no transcript com autor).
    fn dispatch(&self, st: &mut ChatState, q: Queued) -> Result<()> {
        st.transcript.user_message(&q.author.name, &q.author.device, &q.text, None);
        let seq = st.transcript.entries.last().map(|e| e.seq).unwrap_or(0);
        self.emit(st, json!({"type": "user_message", "id": q.id, "seq": seq, "text": q.text, "author": q.author}));
        let text = match st.handoff.take() {
            Some(h) => format!("{h}\n\n---\n\n{}", q.text),
            None => q.text.clone(),
        };
        st.status = Status::Working;
        self.emit_status(st);
        st.agent.send(&text)
    }

    /// Manda (ou enfileira) uma mensagem. Devolve `queued: true` se foi para a fila.
    pub fn send(&self, id: &str, who: &Principal, text: &str) -> Result<Value> {
        let text = text.trim();
        if text.is_empty() {
            bail!("mensagem vazia");
        }
        let st = self.get(id)?;
        let mut st = st.lock().unwrap();
        let q = Queued { id: self.next("m"), text: text.into(), author: who.into(), at: crate::auth::now() };
        if st.status == Status::Idle && st.queue.is_empty() {
            let qid = q.id.clone();
            self.dispatch(&mut st, q)?;
            return Ok(json!({"queued": false, "id": qid}));
        }
        let qid = q.id.clone();
        st.queue.push_back(q);
        self.bus.emit("chat-queue", json!({"chat_id": id, "queue": st.queue}), Some(st.meta.workspace_id.clone()), None);
        Ok(json!({"queued": true, "id": qid, "position": st.queue.len()}))
    }

    pub fn queue_remove(&self, id: &str, qid: &str) -> Result<()> {
        let st = self.get(id)?;
        let mut st = st.lock().unwrap();
        st.queue.retain(|q| q.id != qid);
        self.bus.emit("chat-queue", json!({"chat_id": id, "queue": st.queue}), Some(st.meta.workspace_id.clone()), None);
        Ok(())
    }

    /// Primeira decisão vale. `always`: libera a ferramenta na sessão (quando o harness permite).
    pub fn approve(&self, id: &str, who: &Principal, request_id: &str, allow: bool, always: bool) -> Result<()> {
        let st = self.get(id)?;
        let mut st = st.lock().unwrap();
        let Some(i) = st.pending.iter().position(|p| p.request_id == request_id) else {
            let by = st.transcript.entries.iter().rev().find_map(|e| match &e.kind {
                EntryKind::Approval { request_id: r, decision: Some(d), .. } if r == request_id => Some(d.clone()),
                _ => None,
            });
            bail!("já decidido{}", by.map(|b| format!(" ({b})")).unwrap_or_default());
        };
        let p = st.pending.remove(i);
        st.agent.approve(request_id, allow, &p.tool, always)?;
        let decision = format!("{} por {}", if allow { "aprovado" } else { "negado" }, who.user);
        for e in st.transcript.entries.iter_mut().rev() {
            if let EntryKind::Approval { request_id: r, decision: d, .. } = &mut e.kind {
                if r == request_id {
                    *d = Some(decision.clone());
                    break;
                }
            }
        }
        self.emit(&st, json!({"type": "approval_decided", "request_id": request_id, "allow": allow, "by": AuthorView::from(who)}));
        if st.pending.is_empty() {
            st.status = Status::Working;
        }
        self.emit_status(&st);
        Ok(())
    }

    pub fn stop(&self, id: &str) -> Result<()> {
        let st = self.get(id)?;
        let mut st = st.lock().unwrap();
        st.agent.kill()?;
        st.status = Status::Idle;
        st.pending.clear();
        self.emit_status(&st);
        Ok(())
    }

    /// Tira da lista um chat externo que acabou (sem matar: o processo é do app).
    pub fn close_external(&self, id: &str) {
        self.chats.lock().unwrap().remove(id);
    }

    /// Fecha o chat de vez.
    pub fn close(&self, id: &str) {
        if let Some(c) = self.chats.lock().unwrap().remove(id) {
            let mut c = c.lock().unwrap();
            let _ = c.agent.kill();
            c.gen += 1;
        }
    }

    /// Troca de modelo/harness/conta no mesmo chat: novo segmento + handoff no próximo envio.
    #[allow(clippy::too_many_arguments)]
    pub fn switch(self: &Arc<Self>, id: &str, harness: HarnessKind, model: &str, account: Option<String>, agent: Box<dyn AgentProc>, events: Receiver<Event>, diff_stat: &str) -> Result<ChatView> {
        let st = self.get(id)?;
        let gen = {
            let mut st = st.lock().unwrap();
            let _ = st.agent.kill();
            st.gen += 1;
            let account_changed = st.meta.account != account;
            st.transcript.start_segment(harness, model, None);
            if account_changed && st.meta.harness == harness && st.meta.model == model {
                let seq = st.transcript.entries.last().map(|e| e.seq + 1).unwrap_or(1);
                let segment = st.transcript.segments.len().saturating_sub(1);
                st.transcript.entries.push(Entry {
                    seq,
                    at: crate::auth::now(),
                    author: Author::System,
                    segment,
                    checkpoint: None,
                    kind: EntryKind::Notice { text: format!("Trocou para a conta {}", account.clone().unwrap_or_else(|| "padrão".into())) },
                });
            }
            let entries: Vec<&Entry> = st.transcript.entries.iter().collect();
            let prompt = handoff_prompt(&HandoffInput { entries: &entries, summary: None, last_n: 12, diff_stat, branch: &st.meta.branch, context_files: &[] });
            st.handoff = Some(prompt);
            st.meta.harness = harness;
            st.meta.model = model.into();
            st.meta.account = account;
            st.agent = agent;
            st.status = Status::Idle;
            st.pending.clear();
            let last = st.transcript.entries.last().map(|e| (author_of(e), e.kind.clone()));
            self.emit(&st, json!({"type": "handoff", "to": format!("{model} · {}", harness.label()), "entry": last.map(|(a, k)| json!({"author": a, "kind": k}))}));
            self.emit_status(&st);
            st.gen
        };
        self.pump(id.to_string(), gen, events);
        let v = st.lock().unwrap().view();
        Ok(v)
    }

    pub fn list(&self, ws: Option<&str>) -> Vec<ChatView> {
        let chats = self.chats.lock().unwrap();
        let mut v: Vec<ChatView> = chats.values().map(|c| c.lock().unwrap().view()).filter(|c| ws.map(|w| c.meta.workspace_id == w).unwrap_or(true)).collect();
        v.sort_by(|a, b| a.meta.id.cmp(&b.meta.id));
        v
    }

    /// Transcript completo (para quem entra no meio) com o estado atual.
    pub fn transcript(&self, id: &str) -> Result<Value> {
        let st = self.get(id)?;
        let st = st.lock().unwrap();
        Ok(json!({ "chat": st.view(), "transcript": st.transcript }))
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::auth::{Role, Scope};
    use std::sync::mpsc::{channel, Sender};

    /// Agente falso: registra o que recebeu.
    pub struct Fake {
        pub sent: Arc<Mutex<Vec<String>>>,
        pub approvals: Arc<Mutex<Vec<(String, bool)>>>,
    }
    impl AgentProc for Fake {
        fn send(&self, text: &str) -> Result<()> {
            self.sent.lock().unwrap().push(text.into());
            Ok(())
        }
        fn approve(&self, r: &str, allow: bool, _t: &str, _a: bool) -> Result<()> {
            self.approvals.lock().unwrap().push((r.into(), allow));
            Ok(())
        }
        fn kill(&mut self) -> Result<()> {
            Ok(())
        }
    }

    pub fn person(id: &str, name: &str, role: Role) -> Principal {
        Principal { id: id.into(), user: name.into(), device: "celular".into(), role, scope: Scope::All, color: "#fff".into() }
    }

    fn meta() -> ChatMeta {
        ChatMeta { id: String::new(), workspace_id: "w1".into(), path: "/tmp".into(), branch: "dev/x".into(), title: "x".into(), harness: HarnessKind::Claude, model: "opus".into(), approvals: true, account: None }
    }

    type Setup = (Arc<ChatHub>, String, Sender<Event>, Arc<Mutex<Vec<String>>>, Arc<Mutex<Vec<(String, bool)>>>);

    fn setup() -> Setup {
        let hub = Arc::new(ChatHub::new(Bus::new()));
        let (tx, rx) = channel();
        let sent = Arc::new(Mutex::new(vec![]));
        let approvals = Arc::new(Mutex::new(vec![]));
        let v = hub.start(meta(), Box::new(Fake { sent: sent.clone(), approvals: approvals.clone() }), rx);
        (hub, v.meta.id, tx, sent, approvals)
    }

    fn wait(f: impl Fn() -> bool) {
        let t = std::time::Instant::now();
        while !f() && t.elapsed().as_secs() < 3 {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(f(), "condição não atingida");
    }

    #[test]
    fn fila_unica_e_autoria() {
        let (hub, id, tx, sent, _) = setup();
        let ana = person("d1", "Ana", Role::Owner);
        let bia = person("d2", "Bia", Role::Editor);
        assert_eq!(hub.send(&id, &ana, "primeira").unwrap()["queued"], false);
        // Agente trabalhando: as duas seguintes vão para a fila, na ordem de chegada.
        assert_eq!(hub.send(&id, &bia, "segunda").unwrap()["queued"], true);
        assert_eq!(hub.send(&id, &ana, "terceira").unwrap()["position"], 2);
        assert_eq!(sent.lock().unwrap().len(), 1);
        tx.send(Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }).unwrap();
        wait(|| sent.lock().unwrap().len() == 2);
        assert_eq!(sent.lock().unwrap()[1], "segunda");
        tx.send(Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }).unwrap();
        wait(|| sent.lock().unwrap().len() == 3);
        let t = hub.transcript(&id).unwrap();
        let users: Vec<String> = t["transcript"]["entries"].as_array().unwrap().iter().filter(|e| e["kind"]["type"] == "user_message").map(|e| format!("{}:{}", e["author"]["name"].as_str().unwrap(), e["kind"]["text"].as_str().unwrap())).collect();
        assert_eq!(users, vec!["Ana:primeira", "Bia:segunda", "Ana:terceira"]);
    }

    #[test]
    fn primeira_aprovacao_vale() {
        let (hub, id, tx, _, approvals) = setup();
        let ana = person("d1", "Ana", Role::Owner);
        let bia = person("d2", "Bia", Role::Editor);
        hub.send(&id, &ana, "rode os testes").unwrap();
        tx.send(Event::ApprovalRequest { request_id: "r1".into(), tool: "Bash".into(), input: json!({"command": "npm test"}) }).unwrap();
        wait(|| hub.list(None)[0].status == Status::Waiting);
        assert_eq!(hub.list(Some("w1"))[0].detail.as_deref(), Some("Pede aprovação: Bash"));
        hub.approve(&id, &bia, "r1", true, false).unwrap();
        let err = hub.approve(&id, &ana, "r1", false, false).unwrap_err().to_string();
        assert!(err.contains("aprovado por Bia"), "{err}");
        assert_eq!(*approvals.lock().unwrap(), vec![("r1".to_string(), true)]);
        assert_eq!(hub.list(None)[0].status, Status::Working);
    }

    #[test]
    fn chat_externo_espelhado() {
        let hub = Arc::new(ChatHub::new(Bus::new()));
        let sent = Arc::new(Mutex::new(vec![]));
        let approvals = Arc::new(Mutex::new(vec![]));
        let mut m = meta();
        m.id = "chat-1".into();
        hub.attach_external(m, Box::new(Fake { sent: sent.clone(), approvals: approvals.clone() }));
        let dono = person("local", "Dev", Role::Owner);
        let bia = person("d2", "Bia", Role::Editor);
        // Mensagem digitada no app: só registra (o app já mandou ao agente).
        hub.record_local_send("chat-1", &dono, "oi do Mac");
        assert!(sent.lock().unwrap().is_empty());
        assert_eq!(hub.list(None)[0].status, Status::Working);
        // Do celular, com o agente trabalhando: entra na fila do servidor.
        assert_eq!(hub.send("chat-1", &bia, "do celular").unwrap()["queued"], true);
        hub.feed("chat-1", &Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None });
        assert_eq!(*sent.lock().unwrap(), vec!["do celular".to_string()]);
        hub.feed("chat-1", &Event::ApprovalRequest { request_id: "r1".into(), tool: "Bash".into(), input: Value::Null });
        hub.record_local_approval("chat-1", &dono, "r1", true);
        assert!(hub.approve("chat-1", &bia, "r1", true, false).unwrap_err().to_string().contains("aprovado por Dev"));
        assert!(approvals.lock().unwrap().is_empty(), "a aprovação do app já foi direto ao agente");
    }

    #[test]
    fn troca_de_modelo_leva_handoff() {
        let (hub, id, _tx, _, _) = setup();
        let ana = person("d1", "Ana", Role::Owner);
        hub.send(&id, &ana, "corrija o login").unwrap();
        let (tx2, rx2) = channel();
        let sent2 = Arc::new(Mutex::new(vec![]));
        let v = hub.switch(&id, HarnessKind::Codex, "gpt-5", None, Box::new(Fake { sent: sent2.clone(), approvals: Default::default() }), rx2, " a.rs | 2 +-").unwrap();
        assert_eq!(v.meta.harness, HarnessKind::Codex);
        hub.send(&id, &ana, "continue").unwrap();
        let first = sent2.lock().unwrap()[0].clone();
        assert!(first.contains("**Ana:** corrija o login") && first.contains("a.rs") && first.ends_with("continue"), "{first}");
        drop(tx2);
    }
}
