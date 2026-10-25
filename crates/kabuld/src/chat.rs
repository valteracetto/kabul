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
use kabul_core::governor::{Admission, Governor};
use kabul_core::harness::{Event, HarnessKind, Running};
use kabul_core::transcript::{handoff_prompt, Author, Entry, EntryKind, HandoffInput, Transcript};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, Weak};

/// O processo do agente (no app: `harness::Running`; nos testes: um falso).
pub trait AgentProc: Send {
    fn send(&self, text: &str) -> Result<()>;
    fn approve(&self, request_id: &str, allow: bool, tool: &str, always: bool) -> Result<()>;
    fn kill(&mut self) -> Result<()>;
    /// "Parar": interrompe só o turno pelo protocolo do agente (a sessão continua). Padrão: encerrar.
    fn interrupt(&mut self) -> Result<()> {
        self.kill()
    }
    /// Processo do agente (prioridade de segundo plano).
    fn pid(&self) -> Option<u32> {
        None
    }
}

/// Recria o agente de um chat encerrado por ociosidade, retomando a sessão (`resume`).
pub type Respawn = Box<dyn Fn(&ChatMeta, Option<String>) -> Result<(Box<dyn AgentProc>, Receiver<Event>)> + Send + Sync>;

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
    fn interrupt(&mut self) -> Result<()> {
        Running::interrupt(self)
    }
    fn pid(&self) -> Option<u32> {
        Running::pid(self)
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
    /// A próxima mensagem espera vaga (limite de agentes simultâneos).
    pub waiting_slot: bool,
    /// Agente encerrado por ociosidade; volta (retomando a sessão) no próximo envio.
    pub suspended: bool,
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
    slot_wait: bool,
    suspended: bool,
}

impl ChatState {
    fn view(&self) -> ChatView {
        let detail = self.pending.first().map(|p| format!("Pede aprovação: {}", p.tool));
        ChatView { meta: self.meta.clone(), status: self.status, detail, queue: self.queue.iter().cloned().collect(), pending: self.pending.clone(), waiting_slot: self.slot_wait, suspended: self.suspended }
    }
}

pub struct ChatHub {
    bus: Bus,
    chats: Mutex<HashMap<String, Arc<Mutex<ChatState>>>>,
    seq: AtomicU64,
    /// Limite de agentes simultâneos, fila "aguardando vaga", foco e ociosos.
    pub governor: Arc<Governor>,
    me: Weak<ChatHub>,
    respawn: Mutex<Option<Respawn>>,
}

fn author_of(e: &Entry) -> Value {
    match &e.author {
        Author::User { name, device } => json!({"kind": "user", "name": name, "device": device}),
        Author::Agent { harness, model } => json!({"kind": "agent", "harness": harness, "model": model}),
        Author::System => json!({"kind": "system"}),
    }
}

impl ChatHub {
    /// Sem auto-referência: retomar um chat suspenso não funciona (use [`ChatHub::new_arc`]).
    pub fn new(bus: Bus) -> Self {
        Self { bus, chats: Mutex::new(HashMap::new()), seq: AtomicU64::new(0), governor: Arc::new(Governor::new(kabul_core::governor::Config::from_env())), me: Weak::new(), respawn: Mutex::new(None) }
    }

    pub fn new_arc(bus: Bus) -> Arc<Self> {
        Arc::new_cyclic(|me| Self { me: me.clone(), ..Self::new(bus) })
    }

    /// Como recriar o agente de um chat suspenso (o hub do kabuld instala).
    pub fn set_respawn(&self, f: Respawn) {
        *self.respawn.lock().unwrap() = Some(f);
    }

    /// Estado da governança para o frontend (`agents_status`) e o evento `agents-status`.
    pub fn emit_agents(&self) {
        self.bus.emit("agents-status", serde_json::to_value(self.governor.status()).unwrap_or_default(), None, None);
    }

    /// Chats que ganharam vaga: a mensagem que esperava sai agora (fora do lock de quem liberou).
    pub fn start_granted(&self, ids: Vec<String>) {
        if ids.is_empty() {
            return;
        }
        for id in ids {
            let Ok(st) = self.get(&id) else {
                self.start_granted(self.governor.remove(&id));
                continue;
            };
            let mut st = st.lock().unwrap();
            if !st.slot_wait {
                continue;
            }
            match st.queue.pop_front() {
                Some(q) => {
                    self.bus.emit("chat-queue", json!({"chat_id": st.meta.id, "queue": st.queue}), Some(st.meta.workspace_id.clone()), None);
                    if let Err(e) = self.dispatch(&mut st, q) {
                        self.emit(&st, json!({"type": "error", "message": format!("{e:#}")}));
                        st.status = Status::Idle;
                        let more = self.governor.release(&id);
                        drop(st);
                        self.start_granted(more);
                    }
                }
                None => {
                    st.slot_wait = false;
                    let more = self.governor.release(&id);
                    drop(st);
                    self.start_granted(more);
                }
            }
        }
        self.emit_agents();
    }

    /// Workspace em foco: passa na frente na fila; os agentes dos outros ficam com prioridade baixa.
    pub fn set_focus(&self, ws: Option<String>) {
        self.governor.set_focus(ws.clone());
        if self.governor.config().nice_background {
            let pids: Vec<(u32, bool)> = self.chats.lock().unwrap().values().filter_map(|c| c.try_lock().ok().and_then(|c| c.agent.pid().map(|p| (p, ws.is_some() && ws.as_deref() != Some(c.meta.workspace_id.as_str()))))).collect();
            std::thread::spawn(move || {
                for (pid, bg) in pids {
                    kabul_core::governor::set_background(pid, bg);
                }
            });
        }
        self.emit_agents();
    }

    /// Encerra os agentes parados há mais que o limite (o chat continua; retoma no próximo envio).
    pub fn reap_idle(&self) -> usize {
        self.reap_idle_at(std::time::Instant::now())
    }

    pub fn reap_idle_at(&self, now: std::time::Instant) -> usize {
        let mut n = 0;
        for id in self.governor.idle_at(now) {
            let Ok(st) = self.get(&id) else {
                self.governor.remove(&id);
                continue;
            };
            let mut st = st.lock().unwrap();
            if st.status != Status::Idle || !st.queue.is_empty() || st.suspended || st.slot_wait {
                continue;
            }
            let _ = st.agent.kill();
            st.gen += 1;
            st.suspended = true;
            self.governor.set_suspended(&id, true);
            self.emit(&st, json!({"type": "suspended"}));
            self.emit_status(&st);
            n += 1;
        }
        if n > 0 {
            self.emit_agents();
        }
        n
    }

    /// "Parar em lote" (painel Agentes).
    pub fn interrupt_many(&self, ids: &[String]) -> Value {
        let mut stopped = vec![];
        let mut errors = vec![];
        for id in ids {
            match self.stop(id) {
                Ok(()) => stopped.push(id.clone()),
                Err(e) => errors.push(json!({"chat_id": id, "error": format!("{e:#}")})),
            }
        }
        json!({"stopped": stopped, "errors": errors})
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
        let st = ChatState { meta: meta.clone(), transcript, status: Status::Idle, queue: VecDeque::new(), pending: vec![], handoff: None, agent, gen: 0, slot_wait: false, suspended: false };
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
        let st = ChatState { meta: meta.clone(), transcript, status: Status::Idle, queue: VecDeque::new(), pending: vec![], handoff: None, agent, gen: 0, slot_wait: false, suspended: false };
        let view = st.view();
        self.chats.lock().unwrap().insert(meta.id, Arc::new(Mutex::new(st)));
        view
    }

    /// Evento de um chat externo (o app já mostrou na própria tela).
    pub fn feed(&self, id: &str, ev: &Event) {
        if let Ok(st) = self.get(id) {
            let granted = self.on_event(&mut st.lock().unwrap(), ev);
            self.start_granted(granted);
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
            for ev in kabul_core::batch::coalesce(events, kabul_core::batch::frame()) {
                let Ok(st) = hub.get(&id) else { return };
                let mut st = st.lock().unwrap();
                if st.gen != gen {
                    return;
                }
                let granted = hub.on_event(&mut st, &ev);
                drop(st);
                hub.start_granted(granted);
            }
            if let Ok(st) = hub.get(&id) {
                let mut st = st.lock().unwrap();
                if st.gen == gen {
                    st.status = Status::Idle;
                    st.pending.clear();
                    hub.emit(&st, json!({"type": "exited", "code": null}));
                    hub.emit_status(&st);
                    let granted = hub.governor.release(&id);
                    drop(st);
                    hub.start_granted(granted);
                }
            }
        });
    }

    /// Aplica um evento; devolve os chats que ganharam vaga (o chamador os inicia sem este lock).
    fn on_event(&self, st: &mut ChatState, ev: &Event) -> Vec<String> {
        st.transcript.apply(ev);
        self.governor.touch(&st.meta.id);
        let mut granted = vec![];
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
                granted = self.governor.release(&st.meta.id);
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
        if !granted.is_empty() {
            self.emit_agents();
        }
        granted
    }

    /// Entrega a mensagem ao agente agora (registra no transcript com autor).
    fn dispatch(&self, st: &mut ChatState, q: Queued) -> Result<()> {
        // Vaga: acima do limite, a mensagem espera na frente da fila do chat.
        if let Admission::Queued { position } = self.governor.request(&st.meta.id, &st.meta.workspace_id) {
            st.queue.push_front(q);
            st.slot_wait = true;
            self.emit(st, json!({"type": "queued", "position": position, "limit": self.governor.config().limit}));
            self.bus.emit("chat-queue", json!({"chat_id": st.meta.id, "queue": st.queue}), Some(st.meta.workspace_id.clone()), None);
            self.emit_agents();
            return Ok(());
        }
        if st.slot_wait {
            st.slot_wait = false;
            self.emit(st, json!({"type": "slot_acquired"}));
        }
        if st.suspended {
            self.resume(st)?;
        }
        if self.governor.config().nice_background {
            if let (Some(pid), Some(focus)) = (st.agent.pid(), self.governor.focus()) {
                let bg = focus != st.meta.workspace_id;
                std::thread::spawn(move || kabul_core::governor::set_background(pid, bg));
            }
        }
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

    /// Recria o agente encerrado por ociosidade, retomando a sessão dele.
    fn resume(&self, st: &mut ChatState) -> Result<()> {
        let hub = self.me.upgrade().context("retomada indisponível")?;
        let session = st.transcript.current().and_then(|s| s.agent_session.clone());
        let (agent, rx) = {
            let f = self.respawn.lock().unwrap();
            let f = f.as_ref().context("retomada indisponível neste servidor")?;
            f(&st.meta, session)?
        };
        st.agent = agent;
        st.gen += 1;
        st.suspended = false;
        self.governor.set_suspended(&st.meta.id, false);
        hub.pump(st.meta.id.clone(), st.gen, rx);
        self.emit(st, json!({"type": "resumed"}));
        Ok(())
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
        if st.status == Status::Idle && st.queue.is_empty() && !st.slot_wait {
            let qid = q.id.clone();
            self.dispatch(&mut st, q)?;
            if st.slot_wait {
                let position = self.governor.positions().iter().find(|(c, _)| c == id).map(|(_, p)| *p).unwrap_or(1);
                return Ok(json!({"queued": true, "waiting_slot": true, "id": qid, "position": position}));
            }
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
        if !st.suspended {
            st.agent.interrupt()?;
        }
        st.status = Status::Idle;
        st.pending.clear();
        self.emit_status(&st);
        let granted = self.governor.release(id);
        drop(st);
        self.start_granted(granted);
        Ok(())
    }

    /// Tira da lista um chat externo que acabou (sem matar: o processo é do app).
    pub fn close_external(&self, id: &str) {
        self.chats.lock().unwrap().remove(id);
        self.start_granted(self.governor.remove(id));
    }

    /// Fecha o chat de vez.
    pub fn close(&self, id: &str) {
        let removed = self.chats.lock().unwrap().remove(id);
        if let Some(c) = removed {
            let mut c = c.lock().unwrap();
            let _ = c.agent.kill();
            c.gen += 1;
        }
        self.start_granted(self.governor.remove(id));
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
            st.suspended = false;
            self.governor.set_suspended(id, false);
            let last = st.transcript.entries.last().map(|e| (author_of(e), e.kind.clone()));
            self.emit(&st, json!({"type": "handoff", "to": format!("{model} · {}", harness.label()), "entry": last.map(|(a, k)| json!({"author": a, "kind": k}))}));
            self.emit_status(&st);
            st.gen
        };
        self.start_granted(self.governor.release(id));
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
        let hub = ChatHub::new_arc(Bus::new());
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
        let hub = ChatHub::new_arc(Bus::new());
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
    fn limite_de_agentes_fila_aguardando_vaga() {
        let bus = Bus::new();
        let mut rx_bus = bus.subscribe();
        let hub = ChatHub::new_arc(bus);
        hub.governor.set_config(kabul_core::governor::Config { limit: Some(1), idle_minutes: None, nice_background: false });
        let mk = |ws: &str| {
            let (tx, rx) = channel();
            let sent = Arc::new(Mutex::new(vec![]));
            let mut m = meta();
            m.workspace_id = ws.into();
            let v = hub.start(m, Box::new(Fake { sent: sent.clone(), approvals: Default::default() }), rx);
            (v.meta.id, tx, sent)
        };
        let (a, ta, sa) = mk("w1");
        let (b, _tb, sb) = mk("w2");
        let ana = person("d1", "Ana", Role::Owner);
        assert_eq!(hub.send(&a, &ana, "um").unwrap()["queued"], false);
        let r = hub.send(&b, &ana, "dois").unwrap();
        assert_eq!((r["queued"].as_bool(), r["waiting_slot"].as_bool(), r["position"].as_u64()), (Some(true), Some(true), Some(1)));
        assert!(sb.lock().unwrap().is_empty(), "b espera vaga");
        assert!(hub.list(Some("w2"))[0].waiting_slot);
        let st = hub.governor.status();
        assert_eq!((st.running, st.queued.len()), (1, 1));
        // Mensagem nova no chat em espera não fura a fila.
        assert_eq!(hub.send(&b, &ana, "três").unwrap()["queued"], true);
        ta.send(Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }).unwrap();
        wait(|| sb.lock().unwrap().len() == 1);
        assert_eq!(sb.lock().unwrap()[0], "dois");
        assert_eq!(sa.lock().unwrap().len(), 1);
        assert!(!hub.list(Some("w2"))[0].waiting_slot);
        let mut kinds = vec![];
        while let Ok(ev) = rx_bus.try_recv() {
            if ev.channel == "chat-event" {
                kinds.push(ev.payload["event"]["type"].as_str().unwrap_or_default().to_string());
            }
        }
        assert!(kinds.iter().any(|k| k == "queued") && kinds.iter().any(|k| k == "slot_acquired"), "{kinds:?}");
    }

    #[test]
    fn ocioso_encerrado_e_retomado() {
        let hub = ChatHub::new_arc(Bus::new());
        let respawned = Arc::new(Mutex::new(vec![]));
        let (sent2, r2) = (Arc::new(Mutex::new(vec![])), respawned.clone());
        let s2 = sent2.clone();
        hub.set_respawn(Box::new(move |m, resume| {
            r2.lock().unwrap().push((m.id.clone(), resume));
            let (_tx, rx) = channel();
            std::mem::forget(_tx);
            Ok((Box::new(Fake { sent: s2.clone(), approvals: Default::default() }) as Box<dyn AgentProc>, rx))
        }));
        let (tx, rx) = channel();
        let v = hub.start(meta(), Box::new(Fake { sent: Default::default(), approvals: Default::default() }), rx);
        let id = v.meta.id;
        tx.send(Event::SessionStarted { session_id: "sess-1".into(), model: None }).unwrap();
        wait(|| hub.transcript(&id).unwrap()["transcript"]["segments"][0]["agent_session"] == "sess-1");
        hub.governor.set_config(kabul_core::governor::Config { limit: None, idle_minutes: Some(1), nice_background: false });
        // Sem esperar um minuto: ociosos calculados "daqui a 2 min".
        let later = std::time::Instant::now() + std::time::Duration::from_secs(120);
        assert_eq!(hub.governor.idle_at(later), vec![id.clone()]);
        assert_eq!(hub.reap_idle(), 0, "ainda não passou o tempo");
        assert_eq!(hub.reap_idle_at(later), 1);
        assert!(hub.list(None)[0].suspended);
        assert_eq!(hub.reap_idle_at(later), 0, "já suspenso");
        let ana = person("d1", "Ana", Role::Owner);
        hub.send(&id, &ana, "voltei").unwrap();
        assert_eq!(*respawned.lock().unwrap(), vec![(id.clone(), Some("sess-1".to_string()))]);
        assert_eq!(*sent2.lock().unwrap(), vec!["voltei".to_string()]);
        assert!(!hub.list(None)[0].suspended);
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
