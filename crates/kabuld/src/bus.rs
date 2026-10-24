//! Barramento de eventos empurrados aos clientes (mesmos canais do transporte Tauri: `chat-event`,
//! `term-output`, ...). Cada evento pode carregar o workspace e a sessão a que pertence, para que o
//! servidor entregue a cada conexão só o que ela pode ver.
use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
pub struct BusEvent {
    pub channel: String,
    pub payload: Value,
    #[serde(skip)]
    pub workspace: Option<String>,
    /// Sessão tmux (para `term-output`: só vai a quem abriu aquela sessão).
    #[serde(skip)]
    pub session: Option<String>,
}

#[derive(Clone)]
pub struct Bus {
    tx: broadcast::Sender<BusEvent>,
}

impl Default for Bus {
    fn default() -> Self {
        Self::new()
    }
}

impl Bus {
    pub fn new() -> Self {
        Self { tx: broadcast::channel(8192).0 }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<BusEvent> {
        self.tx.subscribe()
    }
    /// Pode ser chamado de qualquer thread (inclusive fora do runtime do tokio).
    pub fn emit(&self, channel: &str, payload: Value, workspace: Option<String>, session: Option<String>) {
        let _ = self.tx.send(BusEvent { channel: channel.into(), payload, workspace, session });
    }
}
