//! HTTP + WebSocket (axum).
//!
//! - `GET /api/health`: identifica um kabuld (descoberta de máquinas).
//! - `POST /api/pair {token, user, device}`: troca o ingresso do QR/convite por uma credencial.
//! - `GET /ws`: RPC `{id, command, args}` → `{id, ok, value|error}`, eventos `{channel, payload}`,
//!   assinatura `{sub}` / `{unsub}`. A primeira mensagem é sempre `{hello: {device?, key?}}`.
//! - Resto: arquivos da PWA (`apps/web/dist`), com `index.html` como fallback (rota `/m/`).
use crate::auth::Principal;
use crate::hub::Hub;
use crate::net;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;

/// Arquivos da PWA vindos de outro lugar que não uma pasta (ex.: assets embutidos no app desktop).
pub type Assets = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;

pub struct Srv {
    pub hub: Arc<Hub>,
    /// Navegador no próprio computador vira dono sem parear (padrão). `KABULD_TRUST_LOCAL_BROWSER=0`
    /// exige pareamento de toda página web; clientes nativos (sem Origin) no loopback seguem donos.
    trust_local_browser: bool,
    /// Falhas de autenticação por IP (janela de 10 min) contra adivinhação de tokens.
    failures: Mutex<HashMap<IpAddr, (u32, u64)>>,
}

const MAX_FAILURES: u32 = 10;

impl Srv {
    pub fn new(hub: Arc<Hub>) -> Arc<Self> {
        let trust_local_browser = std::env::var("KABULD_TRUST_LOCAL_BROWSER").map(|v| v != "0").unwrap_or(true);
        Arc::new(Self { hub, trust_local_browser, failures: Mutex::new(HashMap::new()) })
    }
    fn blocked(&self, ip: IpAddr) -> bool {
        let now = crate::auth::now();
        let mut f = self.failures.lock().unwrap();
        f.retain(|_, (_, t)| now.saturating_sub(*t) < 600);
        f.get(&ip).map(|(n, _)| *n >= MAX_FAILURES).unwrap_or(false)
    }
    fn fail(&self, ip: IpAddr) {
        let mut f = self.failures.lock().unwrap();
        let e = f.entry(ip).or_insert((0, crate::auth::now()));
        e.0 += 1;
    }
}

pub fn router(srv: Arc<Srv>, web_dir: Option<PathBuf>, assets: Option<Assets>) -> Router {
    let api = Router::new().route("/api/health", get(health)).route("/api/pair", post(pair).options(preflight)).route("/ws", get(ws_handler));
    let app = match (web_dir.filter(|d| d.join("index.html").is_file()), assets) {
        (Some(d), _) => {
            let index = d.join("index.html");
            api.fallback_service(tower_http::services::ServeDir::new(d).fallback(tower_http::services::ServeFile::new(index)))
        }
        (None, Some(assets)) => api.fallback(move |uri: axum::http::Uri| {
            let assets = assets.clone();
            async move { serve_asset(&assets, uri.path()) }
        }),
        (None, None) => api.fallback(|| async { (StatusCode::NOT_FOUND, "kabuld: PWA não encontrada (rode `npm run build` em apps/web ou passe --web)") }),
    };
    app.layer(middleware::from_fn_with_state(srv.clone(), guard)).with_state(srv)
}

/// Fora do loopback, só pares aceitos pelo transporte (tailnet). Cabeçalhos de segurança em tudo.
async fn guard(State(srv): State<Arc<Srv>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, req: Request, next: Next) -> Response {
    let ip = peer.ip();
    if !net::is_loopback(ip) && !srv.hub.net.accepts_peer(ip) {
        return (StatusCode::FORBIDDEN, "kabuld: só localhost e a sua tailnet").into_response();
    }
    let api = req.uri().path().starts_with("/api/");
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    if api {
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    }
    res
}

/// Busca o arquivo; rotas sem extensão (ex.: `/m/`) caem no `index.html` (SPA).
fn serve_asset(assets: &Assets, path: &str) -> Response {
    let p = path.trim_start_matches('/');
    let hit = if p.is_empty() { None } else { assets(p) };
    let hit = hit.or_else(|| (!p.rsplit('/').next().unwrap_or("").contains('.')).then(|| assets("index.html")).flatten());
    match hit {
        Some((bytes, mime)) => {
            let mut r = bytes.into_response();
            if let Ok(v) = HeaderValue::from_str(&mime) {
                r.headers_mut().insert(header::CONTENT_TYPE, v);
            }
            r
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn preflight() -> Response {
    let mut r = StatusCode::NO_CONTENT.into_response();
    let h = r.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("POST, OPTIONS"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type"));
    r
}

async fn health(State(srv): State<Arc<Srv>>) -> Json<Value> {
    Json(json!({"kabuld": true, "name": srv.hub.machine, "version": env!("CARGO_PKG_VERSION")}))
}

async fn pair(State(srv): State<Arc<Srv>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, Json(body): Json<Value>) -> Response {
    if srv.blocked(peer.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({"ok": false, "error": "muitas tentativas; espere alguns minutos"}))).into_response();
    }
    let token = body["token"].as_str().unwrap_or_default().to_string();
    let user = body["user"].as_str().unwrap_or_default().to_string();
    let device = body["device"].as_str().unwrap_or_default().to_string();
    let hub = srv.hub.clone();
    match tokio::task::spawn_blocking(move || hub.pair(&token, &user, &device)).await {
        Ok(Ok(v)) => Json(json!({"ok": true, "value": v})).into_response(),
        Ok(Err(e)) => {
            srv.fail(peer.ip());
            (StatusCode::UNAUTHORIZED, Json(json!({"ok": false, "error": format!("{e:#}")}))).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"ok": false, "error": e.to_string()}))).into_response(),
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(srv): State<Arc<Srv>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, method: Method) -> Response {
    let _ = method;
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(String::from);
    let forwarded = ["x-forwarded-for", "forwarded", "tailscale-user-login", "x-forwarded-host"].iter().any(|h| headers.contains_key(*h));
    let local = net::local_trusted(peer, origin.as_deref(), forwarded) && (origin.is_none() || srv.trust_local_browser);
    ws.max_message_size(32 << 20).on_upgrade(move |socket| conn(srv, socket, local, peer))
}

#[derive(Default)]
struct ConnState {
    subs: HashSet<String>,
    terms: HashSet<String>,
}

fn deliver(who: &Principal, st: &ConnState, ev: &crate::bus::BusEvent) -> bool {
    if !(st.subs.contains(&ev.channel) || st.subs.contains("*")) {
        return false;
    }
    if ev.channel.starts_with("term-") && !ev.session.as_ref().map(|s| st.terms.contains(s)).unwrap_or(false) {
        return false;
    }
    who.scope.workspace().map(|w| ev.workspace.as_deref() == Some(w)).unwrap_or(true)
}

async fn conn(srv: Arc<Srv>, socket: WebSocket, local: bool, peer: SocketAddr) {
    let (mut sink, mut stream) = socket.split();
    // 1) hello
    let hello = match tokio::time::timeout(Duration::from_secs(15), stream.next()).await {
        Ok(Some(Ok(Message::Text(t)))) => serde_json::from_str::<Value>(&t).unwrap_or(Value::Null),
        _ => return,
    };
    let h = &hello["hello"];
    let who = match (h["device"].as_str(), h["key"].as_str()) {
        _ if srv.blocked(peer.ip()) => Err("muitas tentativas; espere alguns minutos"),
        (Some(d), Some(k)) if !d.is_empty() => {
            let hub = srv.hub.clone();
            let (d, k) = (d.to_string(), k.to_string());
            match tokio::task::spawn_blocking(move || hub.auth.verify(&d, &k)).await.ok().flatten() {
                Some(p) => Ok(p),
                None => {
                    srv.fail(peer.ip());
                    Err("credencial inválida ou revogada: pareie de novo")
                }
            }
        }
        _ if local => Ok(Principal::local_owner(&std::env::var("USER").unwrap_or_else(|_| "Você".into()))),
        _ => Err("pareamento necessário"),
    };
    let who = match who {
        Ok(p) => p,
        Err(e) => {
            let _ = sink.send(Message::Text(json!({"hello": {"ok": false, "error": e}}).to_string().into())).await;
            let _ = sink.close().await;
            return;
        }
    };
    if sink.send(Message::Text(json!({"hello": {"ok": true, "principal": who, "machine": srv.hub.machine}}).to_string().into())).await.is_err() {
        return;
    }
    let hub = srv.hub.clone();
    let conn_id = hub.next_conn();
    let state = Arc::new(Mutex::new(ConnState::default()));
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Option<String>>();

    // 2) escritor
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            match m {
                Some(t) => {
                    if sink.send(Message::Text(t.into())).await.is_err() {
                        break;
                    }
                }
                None => {
                    let _ = sink.close().await;
                    break;
                }
            }
        }
    });

    // 3) eventos do barramento
    let (kill_tx, mut kill_rx) = tokio::sync::watch::channel(false);
    let events = {
        let mut rx = hub.bus.subscribe();
        let (who, state, out) = (who.clone(), state.clone(), out_tx.clone());
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(ev) => {
                        if ev.channel == "__revoked" {
                            if ev.payload["id"].as_str() == Some(who.id.as_str()) {
                                let _ = out.send(Some(json!({"channel": "revoked", "payload": {}}).to_string()));
                                let _ = out.send(None);
                                let _ = kill_tx.send(true);
                                return;
                            }
                            continue;
                        }
                        let ok = deliver(&who, &state.lock().unwrap(), &ev);
                        if ok && out.send(Some(json!({"channel": ev.channel, "payload": ev.payload}).to_string())).is_err() {
                            return;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => return,
                }
            }
        })
    };

    // 4) leitor
    loop {
        let msg = tokio::select! {
            m = stream.next() => m,
            _ = kill_rx.changed() => break,
        };
        let Some(Ok(msg)) = msg else { break };
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let v: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(c) = v["sub"].as_str() {
            state.lock().unwrap().subs.insert(c.to_string());
            continue;
        }
        if let Some(c) = v["unsub"].as_str() {
            state.lock().unwrap().subs.remove(c);
            continue;
        }
        let Some(command) = v["command"].as_str().map(String::from) else { continue };
        let id = v["id"].clone();
        let args = v.get("args").cloned().filter(|a| a.is_object()).unwrap_or_else(|| json!({}));
        let (hub, who, out, state) = (hub.clone(), who.clone(), out_tx.clone(), state.clone());
        tokio::spawn(async move {
            let cmd = command.clone();
            let res = tokio::task::spawn_blocking(move || hub.call(&who, conn_id, &cmd, &args)).await;
            let msg = match res {
                Ok(Ok(value)) => {
                    if matches!(command.as_str(), "term_attach" | "term_open") {
                        if let Some(s) = value["session"].as_str() {
                            state.lock().unwrap().terms.insert(s.to_string());
                        }
                    }
                    json!({"id": id, "ok": true, "value": value})
                }
                Ok(Err(e)) => json!({"id": id, "ok": false, "error": format!("{e:#}")}),
                Err(e) => json!({"id": id, "ok": false, "error": e.to_string()}),
            };
            let _ = out.send(Some(msg.to_string()));
        });
    }
    hub.presence.remove(conn_id);
    events.abort();
    let _ = out_tx.send(None);
    let _ = writer.await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{Role, Scope};
    use crate::bus::BusEvent;

    fn ev(channel: &str, ws: Option<&str>, session: Option<&str>) -> BusEvent {
        BusEvent { channel: channel.into(), payload: Value::Null, workspace: ws.map(String::from), session: session.map(String::from) }
    }

    #[test]
    fn entrega_por_assinatura_escopo_e_terminal() {
        let dono = Principal::local_owner("dev");
        let conv = Principal { id: "d".into(), user: "x".into(), device: "y".into(), role: Role::Observer, scope: Scope::Workspace { id: "w1".into() }, color: String::new() };
        let mut st = ConnState::default();
        assert!(!deliver(&dono, &st, &ev("chat-event", Some("w1"), None)), "sem assinatura");
        st.subs.insert("chat-event".into());
        st.subs.insert("term-output".into());
        assert!(deliver(&dono, &st, &ev("chat-event", Some("w2"), None)));
        assert!(deliver(&conv, &st, &ev("chat-event", Some("w1"), None)));
        assert!(!deliver(&conv, &st, &ev("chat-event", Some("w2"), None)), "outro workspace");
        assert!(!deliver(&conv, &st, &ev("chat-event", None, None)));
        assert!(!deliver(&dono, &st, &ev("term-output", None, Some("s1"))), "não abriu o terminal");
        st.terms.insert("s1".into());
        assert!(deliver(&dono, &st, &ev("term-output", None, Some("s1"))));
    }
}
