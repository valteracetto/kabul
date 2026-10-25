//! Cliente síncrono do Chrome DevTools Protocol: uma conexão WebSocket com o navegador (modo
//! `flatten`, uma sessão por aba) e uma thread de E/S que casa respostas por `id` e repassa eventos.
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::ErrorKind;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tungstenite::{Message, WebSocket};

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

/// Evento do CDP: `method`, `params` e a sessão (aba) de origem.
#[derive(Debug, Clone)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
    pub session: Option<String>,
}

pub struct Cdp {
    out: Mutex<Sender<String>>,
    pending: Pending,
    subs: Arc<Mutex<Vec<Sender<CdpEvent>>>>,
    next: AtomicU64,
    closed: Arc<AtomicBool>,
    /// Tempo máximo de uma chamada.
    pub timeout: Duration,
}

impl Cdp {
    /// Conecta no `webSocketDebuggerUrl` do navegador (`ws://127.0.0.1:<porta>/devtools/browser/<id>`).
    pub fn connect(ws_url: &str) -> Result<Arc<Cdp>> {
        let rest = ws_url.strip_prefix("ws://").context("só ws:// local")?;
        let host = rest.split('/').next().unwrap_or_default();
        let addr = host.parse::<std::net::SocketAddr>().or_else(|_| host.replace("localhost", "127.0.0.1").parse()).with_context(|| format!("endereço do DevTools inválido: {host}"))?;
        let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).with_context(|| format!("conectando ao DevTools em {host}"))?;
        stream.set_nodelay(true).ok();
        let (mut ws, _) = tungstenite::client(ws_url, stream).map_err(|e| anyhow!("handshake do DevTools: {e}"))?;
        // Leitura com prazo curto: a mesma thread alterna entre ler e mandar o que estiver na fila.
        ws.get_mut().set_read_timeout(Some(Duration::from_millis(15)))?;
        let (tx, rx) = mpsc::channel::<String>();
        let pending: Pending = Default::default();
        let subs: Arc<Mutex<Vec<Sender<CdpEvent>>>> = Default::default();
        let closed = Arc::new(AtomicBool::new(false));
        let (p2, s2, c2) = (pending.clone(), subs.clone(), closed.clone());
        std::thread::Builder::new().name("kabul-cdp".into()).spawn(move || io_loop(ws, rx, p2, s2, c2))?;
        Ok(Arc::new(Cdp { out: Mutex::new(tx), pending, subs, next: AtomicU64::new(1), closed, timeout: Duration::from_secs(30) }))
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Relaxed)
    }

    /// Recebe todos os eventos a partir de agora.
    pub fn subscribe(&self) -> Receiver<CdpEvent> {
        let (tx, rx) = mpsc::channel();
        self.subs.lock().unwrap().push(tx);
        rx
    }

    /// Chama `method` (no navegador, ou na aba de `session`) e espera a resposta.
    pub fn call(&self, session: Option<&str>, method: &str, params: Value) -> Result<Value> {
        self.call_timeout(session, method, params, self.timeout)
    }

    pub fn call_timeout(&self, session: Option<&str>, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        if self.is_closed() {
            bail!("o navegador fechou a conexão");
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.out.lock().unwrap().send(msg.to_string()).map_err(|_| anyhow!("o navegador fechou a conexão"))?;
        match rx.recv_timeout(timeout) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => bail!("{method}: {e}"),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                bail!("{method}: sem resposta do navegador em {}s", timeout.as_secs())
            }
        }
    }

    /// Manda sem esperar resposta (ack de quadro do screencast, por exemplo).
    pub fn send(&self, session: Option<&str>, method: &str, params: Value) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }
        let _ = self.out.lock().unwrap().send(msg.to_string());
    }

    /// Fecha a conexão (o navegador continua rodando).
    pub fn close(&self) {
        self.closed.store(true, Ordering::Relaxed);
    }
}

impl Drop for Cdp {
    fn drop(&mut self) {
        self.close();
    }
}

fn io_loop(mut ws: WebSocket<TcpStream>, rx: Receiver<String>, pending: Pending, subs: Arc<Mutex<Vec<Sender<CdpEvent>>>>, closed: Arc<AtomicBool>) {
    let fail_all = |why: &str| {
        for (_, tx) in pending.lock().unwrap().drain() {
            let _ = tx.send(Err(why.to_string()));
        }
    };
    loop {
        if closed.load(Ordering::Relaxed) {
            let _ = ws.close(None);
            let _ = ws.flush();
            break;
        }
        // Fila de saída.
        loop {
            match rx.try_recv() {
                Ok(m) => {
                    if ws.send(Message::text(m)).is_err() {
                        closed.store(true, Ordering::Relaxed);
                        break;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => {
                    closed.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }
        match ws.read() {
            Ok(Message::Text(t)) => {
                let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
                if let Some(id) = v.get("id").and_then(Value::as_u64) {
                    if let Some(tx) = pending.lock().unwrap().remove(&id) {
                        let r = match v.get("error") {
                            Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("erro").to_string()),
                            None => Ok(v.get("result").cloned().unwrap_or(Value::Null)),
                        };
                        let _ = tx.send(r);
                    }
                } else if let Some(m) = v.get("method").and_then(Value::as_str) {
                    let ev = CdpEvent { method: m.to_string(), params: v.get("params").cloned().unwrap_or(Value::Null), session: v.get("sessionId").and_then(Value::as_str).map(String::from) };
                    subs.lock().unwrap().retain(|s| s.send(ev.clone()).is_ok());
                }
            }
            Ok(Message::Close(_)) => {
                closed.store(true, Ordering::Relaxed);
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => {
                closed.store(true, Ordering::Relaxed);
            }
        }
        if closed.load(Ordering::Relaxed) {
            fail_all("o navegador fechou a conexão");
            subs.lock().unwrap().clear();
            let _ = ws.close(None);
            break;
        }
    }
    fail_all("o navegador fechou a conexão");
}
