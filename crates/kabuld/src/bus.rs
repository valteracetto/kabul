//! Barramento de eventos empurrados aos clientes (mesmos canais do transporte Tauri: `chat-event`,
//! `term-output`, ...). Cada evento pode carregar o workspace e a sessão a que pertence, para que o
//! servidor entregue a cada conexão só o que ela pode ver.
//!
//! O quadro JSON (`{channel, payload}`) é serializado UMA vez por evento, na primeira conexão que o
//! entrega, e compartilhado com as outras (antes cada conexão montava e serializava o seu). O mesmo
//! vale para a versão comprimida (deflate), para os clientes que pedirem compressão.
use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use tokio::sync::broadcast;

/// Quadros menores que isso vão sem compressão mesmo para quem pediu (não compensa).
pub const COMPRESS_MIN: usize = 1024;

#[derive(Debug, Clone, Serialize)]
pub struct BusEvent {
    pub channel: String,
    pub payload: Value,
    #[serde(skip)]
    pub workspace: Option<String>,
    /// Sessão tmux (para `term-output`: só vai a quem abriu aquela sessão).
    #[serde(skip)]
    pub session: Option<String>,
    #[serde(skip)]
    frame: Arc<OnceLock<Arc<str>>>,
    #[serde(skip)]
    deflated: Arc<OnceLock<Arc<[u8]>>>,
}

impl BusEvent {
    pub fn new(channel: &str, payload: Value, workspace: Option<String>, session: Option<String>) -> Self {
        Self { channel: channel.into(), payload, workspace, session, frame: Default::default(), deflated: Default::default() }
    }
    /// `{"channel": ..., "payload": ...}` serializado uma vez só.
    pub fn frame(&self) -> Arc<str> {
        self.frame
            .get_or_init(|| {
                #[derive(Serialize)]
                struct F<'a> {
                    channel: &'a str,
                    payload: &'a Value,
                }
                serde_json::to_string(&F { channel: &self.channel, payload: &self.payload }).unwrap_or_default().into()
            })
            .clone()
    }
    /// O quadro em deflate cru (RFC 1951), também calculado uma vez.
    pub fn deflated(&self) -> Arc<[u8]> {
        self.deflated.get_or_init(|| deflate(self.frame().as_bytes()).into()).clone()
    }
}

pub fn deflate(b: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut e = flate2::write::DeflateEncoder::new(Vec::with_capacity(b.len() / 3), flate2::Compression::fast());
    let _ = e.write_all(b);
    e.finish().unwrap_or_default()
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
        let _ = self.tx.send(BusEvent::new(channel, payload, workspace, session));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quadro_uma_vez_e_deflate() {
        let ev = BusEvent::new("chat-event", serde_json::json!({"chat_id": "c", "event": {"type": "text_delta", "text": "olá ".repeat(400)}}), None, None);
        let a = ev.frame();
        let b = ev.clone().frame();
        assert!(Arc::ptr_eq(&a, &b), "clones compartilham o quadro");
        let v: Value = serde_json::from_str(&a).unwrap();
        assert_eq!(v["channel"], "chat-event");
        let z = ev.deflated();
        assert!(z.len() < a.len() / 4, "{} vs {}", z.len(), a.len());
        let mut out = String::new();
        std::io::Read::read_to_string(&mut flate2::read::DeflateDecoder::new(&z[..]), &mut out).unwrap();
        assert_eq!(out, &*a);
    }
}
