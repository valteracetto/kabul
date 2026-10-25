//! Governança de recursos (ESCALA: muitos agentes ao mesmo tempo sem o computador engasgar).
//!
//! - **Limite de agentes simultâneos** (turnos rodando), configurável; acima dele a mensagem fica
//!   "aguardando vaga" numa fila única do servidor.
//! - **Prioridade**: na fila, o workspace em foco (a aba aberta) passa na frente; o resto sai na
//!   ordem de chegada.
//! - **Segundo plano com prioridade baixa**: agentes de workspaces fora de foco rodam com prioridade
//!   de CPU/E/S reduzida ([`set_background`]); voltam ao normal ao ganhar foco (quando o sistema deixa).
//! - **Ociosos**: conversas paradas há mais de X min podem ser encerradas ([`Governor::idle`]); o
//!   chamador guarda o id da sessão do agente e retoma no próximo envio.
//!
//! O [`Governor`] só decide (puro, testável); quem roda os agentes aplica as decisões.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Config {
    /// Turnos rodando ao mesmo tempo; `None` = sem limite.
    pub limit: Option<usize>,
    /// Encerrar conversas ociosas depois de N minutos (com retomada); `None` = nunca.
    pub idle_minutes: Option<u64>,
    /// Baixar a prioridade dos agentes fora de foco.
    #[serde(default = "yes")]
    pub nice_background: bool,
}

fn yes() -> bool {
    true
}

impl Config {
    /// Padrão: sem limite e sem encerrar ociosos (nada muda para quem não configurar); prioridade
    /// baixa ligada. `KABUL_MAX_AGENTS` e `KABUL_IDLE_MINUTES` mudam o padrão.
    pub fn from_env() -> Self {
        let num = |k: &str| std::env::var(k).ok().and_then(|v| v.parse().ok()).filter(|n: &u64| *n > 0);
        Self { limit: num("KABUL_MAX_AGENTS").map(|n| n as usize), idle_minutes: num("KABUL_IDLE_MINUTES"), nice_background: std::env::var("KABUL_NICE_BACKGROUND").map(|v| v != "0").unwrap_or(true) }
    }
}

/// Resposta a um pedido de vaga.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Admission {
    Run,
    Queued { position: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct QueuedView {
    pub chat_id: String,
    /// 1 = o próximo a rodar.
    pub position: usize,
    pub workspace_id: String,
}

/// O que o frontend mostra (comando `agents_status`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Status {
    pub limit: Option<usize>,
    pub running: usize,
    pub queued: Vec<QueuedView>,
    pub running_chats: Vec<String>,
    pub suspended: Vec<String>,
    pub focus: Option<String>,
    pub idle_minutes: Option<u64>,
    pub nice_background: bool,
}

#[derive(Debug, Clone)]
struct Waiting {
    chat: String,
    ws: String,
    seq: u64,
}

#[derive(Debug, Default)]
struct Inner {
    cfg: Config,
    /// chat → workspace
    running: HashMap<String, String>,
    queue: Vec<Waiting>,
    seq: u64,
    focus: Option<String>,
    activity: HashMap<String, Instant>,
    suspended: HashSet<String>,
}

impl Inner {
    fn has_slot(&self) -> bool {
        self.cfg.limit.map(|l| self.running.len() < l).unwrap_or(true)
    }
    /// Fila na ordem de saída: foco primeiro, depois chegada.
    fn ordered(&self) -> Vec<&Waiting> {
        let mut v: Vec<&Waiting> = self.queue.iter().collect();
        let focus = self.focus.as_deref();
        v.sort_by_key(|w| (Some(w.ws.as_str()) != focus, w.seq));
        v
    }
    /// Tira da fila quem cabe agora.
    fn admit(&mut self) -> Vec<String> {
        let mut out = vec![];
        while self.has_slot() && !self.queue.is_empty() {
            let next = self.ordered()[0].chat.clone();
            let i = self.queue.iter().position(|w| w.chat == next).unwrap();
            let w = self.queue.remove(i);
            self.running.insert(w.chat.clone(), w.ws);
            out.push(w.chat);
        }
        out
    }
}

#[derive(Debug, Default)]
pub struct Governor {
    inner: Mutex<Inner>,
}

impl Governor {
    pub fn new(cfg: Config) -> Self {
        Self { inner: Mutex::new(Inner { cfg, ..Default::default() }) }
    }

    pub fn config(&self) -> Config {
        self.inner.lock().unwrap().cfg.clone()
    }

    /// Troca a configuração; se o limite subiu, devolve quem sai da fila agora.
    pub fn set_config(&self, cfg: Config) -> Vec<String> {
        let mut g = self.inner.lock().unwrap();
        g.cfg = cfg;
        g.admit()
    }

    /// O chat quer começar um turno. `Run`: pode rodar já (a vaga fica reservada até [`release`]).
    ///
    /// [`release`]: Governor::release
    pub fn request(&self, chat: &str, ws: &str) -> Admission {
        let mut g = self.inner.lock().unwrap();
        g.activity.insert(chat.to_string(), Instant::now());
        if g.running.contains_key(chat) {
            return Admission::Run;
        }
        if g.queue.iter().any(|w| w.chat == chat) {
            return Admission::Queued { position: g.ordered().iter().position(|w| w.chat == chat).unwrap() + 1 };
        }
        // Com fila, quem chega só passa direto se a fila inteira couber antes (ordem justa).
        if g.has_slot() && g.queue.is_empty() {
            g.running.insert(chat.to_string(), ws.to_string());
            return Admission::Run;
        }
        g.seq += 1;
        let seq = g.seq;
        g.queue.push(Waiting { chat: chat.to_string(), ws: ws.to_string(), seq });
        let admitted = g.admit();
        if admitted.iter().any(|c| c == chat) {
            return Admission::Run;
        }
        Admission::Queued { position: g.ordered().iter().position(|w| w.chat == chat).unwrap() + 1 }
    }

    /// O turno terminou: libera a vaga e devolve quem sai da fila (já marcados como rodando).
    pub fn release(&self, chat: &str) -> Vec<String> {
        let mut g = self.inner.lock().unwrap();
        g.activity.insert(chat.to_string(), Instant::now());
        g.running.remove(chat);
        g.admit()
    }

    /// Chat fechado: some de tudo.
    pub fn remove(&self, chat: &str) -> Vec<String> {
        let mut g = self.inner.lock().unwrap();
        g.running.remove(chat);
        g.queue.retain(|w| w.chat != chat);
        g.activity.remove(chat);
        g.suspended.remove(chat);
        g.admit()
    }

    pub fn is_running(&self, chat: &str) -> bool {
        self.inner.lock().unwrap().running.contains_key(chat)
    }

    /// Workspace em foco (a aba aberta): passa na frente na fila.
    pub fn set_focus(&self, ws: Option<String>) {
        self.inner.lock().unwrap().focus = ws;
    }

    pub fn focus(&self) -> Option<String> {
        self.inner.lock().unwrap().focus.clone()
    }

    /// Algo aconteceu na conversa (evento do agente, mensagem): adia o encerramento por ociosidade.
    pub fn touch(&self, chat: &str) {
        self.inner.lock().unwrap().activity.insert(chat.to_string(), Instant::now());
    }

    /// Conversas paradas (sem turno, fora da fila, não suspensas) há mais que `idle_minutes`.
    pub fn idle(&self) -> Vec<String> {
        self.idle_at(Instant::now())
    }

    pub fn idle_at(&self, now: Instant) -> Vec<String> {
        let g = self.inner.lock().unwrap();
        let Some(m) = g.cfg.idle_minutes.filter(|m| *m > 0) else { return vec![] };
        let limit = Duration::from_secs(m * 60);
        let mut v: Vec<String> = g.activity.iter().filter(|(c, at)| !g.running.contains_key(*c) && !g.queue.iter().any(|w| &w.chat == *c) && !g.suspended.contains(*c) && now.saturating_duration_since(**at) >= limit).map(|(c, _)| c.clone()).collect();
        v.sort();
        v
    }

    pub fn set_suspended(&self, chat: &str, on: bool) {
        let mut g = self.inner.lock().unwrap();
        if on {
            g.suspended.insert(chat.to_string());
        } else {
            g.suspended.remove(chat);
            g.activity.insert(chat.to_string(), Instant::now());
        }
    }

    pub fn is_suspended(&self, chat: &str) -> bool {
        self.inner.lock().unwrap().suspended.contains(chat)
    }

    /// Posição de cada chat na fila (1 = próximo).
    pub fn positions(&self) -> Vec<(String, usize)> {
        let g = self.inner.lock().unwrap();
        g.ordered().iter().enumerate().map(|(i, w)| (w.chat.clone(), i + 1)).collect()
    }

    pub fn status(&self) -> Status {
        let g = self.inner.lock().unwrap();
        let mut running_chats: Vec<String> = g.running.keys().cloned().collect();
        running_chats.sort();
        let mut suspended: Vec<String> = g.suspended.iter().cloned().collect();
        suspended.sort();
        Status {
            limit: g.cfg.limit,
            running: g.running.len(),
            queued: g.ordered().iter().enumerate().map(|(i, w)| QueuedView { chat_id: w.chat.clone(), position: i + 1, workspace_id: w.ws.clone() }).collect(),
            running_chats,
            suspended,
            focus: g.focus.clone(),
            idle_minutes: g.cfg.idle_minutes,
            nice_background: g.cfg.nice_background,
        }
    }
}

/// Prioridade de CPU/E/S do processo e dos descendentes: `background = true` baixa, `false` volta ao
/// normal. Devolve quantos processos mudaram.
///
/// - macOS: `setpriority(PRIO_DARWIN_PROCESS, pid, PRIO_DARWIN_BG)` (CPU e disco em segundo plano,
///   reversível pelo próprio usuário).
/// - Linux: `nice` 10; voltar a 0 exige permissão (`CAP_SYS_NICE`/`RLIMIT_NICE`) e pode falhar em
///   silêncio, como o `renice` sem sudo.
/// - Windows: ainda não (ver docs/windows.md: `SetPriorityClass` com
///   `PROCESS_MODE_BACKGROUND_BEGIN`/`BELOW_NORMAL_PRIORITY_CLASS`).
pub fn set_background(pid: u32, background: bool) -> usize {
    let procs = crate::resources::processes();
    let mut pids = vec![pid];
    pids.extend(crate::procs::descendants(&procs, pid).iter().map(|p| p.pid));
    pids.into_iter().filter(|p| set_one(*p, background)).count()
}

#[cfg(target_os = "macos")]
fn set_one(pid: u32, background: bool) -> bool {
    // SAFETY: chamada de sistema sem ponteiros; pid inválido só devolve erro.
    unsafe { libc::setpriority(libc::PRIO_DARWIN_PROCESS, pid as libc::id_t, if background { libc::PRIO_DARWIN_BG } else { 0 }) == 0 }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn set_one(pid: u32, background: bool) -> bool {
    // SAFETY: chamada de sistema sem ponteiros; pid inválido só devolve erro.
    unsafe { libc::setpriority(libc::PRIO_PROCESS, pid as libc::id_t, if background { 10 } else { 0 }) == 0 }
}

#[cfg(not(unix))]
fn set_one(_pid: u32, _background: bool) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gov(limit: usize) -> Governor {
        Governor::new(Config { limit: Some(limit), idle_minutes: Some(1), nice_background: true })
    }

    #[test]
    fn limite_e_fila_por_chegada() {
        let g = gov(2);
        assert_eq!(g.request("a", "w1"), Admission::Run);
        assert_eq!(g.request("b", "w2"), Admission::Run);
        assert_eq!(g.request("c", "w3"), Admission::Queued { position: 1 });
        assert_eq!(g.request("d", "w4"), Admission::Queued { position: 2 });
        assert_eq!(g.request("c", "w3"), Admission::Queued { position: 1 }, "pedir de novo não muda a posição");
        assert_eq!(g.request("a", "w1"), Admission::Run, "já está rodando");
        assert_eq!(g.release("a"), vec!["c".to_string()]);
        assert!(g.is_running("c"));
        let s = g.status();
        assert_eq!((s.running, s.queued.len(), s.queued[0].chat_id.as_str(), s.queued[0].position), (2, 1, "d", 1));
    }

    #[test]
    fn foco_passa_na_frente() {
        let g = gov(1);
        g.request("a", "w1");
        g.request("b", "w2");
        g.request("c", "w3");
        g.set_focus(Some("w3".into()));
        assert_eq!(g.positions(), vec![("c".to_string(), 1), ("b".to_string(), 2)]);
        assert_eq!(g.release("a"), vec!["c".to_string()]);
    }

    #[test]
    fn sem_limite_e_limite_maior_libera_fila() {
        let g = Governor::new(Config::default());
        for i in 0..50 {
            assert_eq!(g.request(&format!("c{i}"), "w"), Admission::Run);
        }
        let g = gov(1);
        g.request("a", "w");
        g.request("b", "w");
        g.request("c", "w");
        let mut started = g.set_config(Config { limit: Some(3), ..g.config() });
        started.sort();
        assert_eq!(started, vec!["b".to_string(), "c".to_string()]);
        assert!(g.remove("a").is_empty());
        assert_eq!(g.status().running, 2);
    }

    #[test]
    fn ociosos_e_suspensos() {
        let g = gov(5);
        g.request("a", "w");
        g.request("b", "w");
        g.release("b");
        let later = Instant::now() + Duration::from_secs(61);
        assert_eq!(g.idle_at(later), vec!["b".to_string()], "quem está rodando não é ocioso");
        g.set_suspended("b", true);
        assert!(g.idle_at(later).is_empty());
        assert_eq!(g.status().suspended, vec!["b".to_string()]);
        g.set_suspended("b", false);
        assert!(g.idle().is_empty(), "retomar conta como atividade");
    }

    #[cfg(unix)]
    #[test]
    fn prioridade_de_um_filho() {
        let mut c = std::process::Command::new("sleep").arg("5").spawn().unwrap();
        assert!(set_background(c.id(), true) >= 1);
        set_background(c.id(), false);
        let _ = c.kill();
        let _ = c.wait();
    }
}
