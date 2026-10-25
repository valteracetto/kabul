//! HTTP + WebSocket (axum).
//!
//! - `GET /api/health`: identifica um kabuld (descoberta de máquinas).
//! - `POST /api/pair {token, user, device}`: troca o ingresso do QR/convite por uma credencial.
//! - `GET /ws`: RPC `{id, command, args}` → `{id, ok, value|error}`, eventos `{channel, payload}`,
//!   assinatura `{sub}` / `{unsub}`. A primeira mensagem é sempre
//!   `{hello: {device?, key?, client?: {version, protocol, min_protocol}}}`; a resposta traz
//!   `server: {version, protocol, min_protocol}` (ver `kabul_core::schema`).
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
    /// Hosts aceitos além dos padrões ([`net::host_allowed`]).
    extra_hosts: Vec<String>,
}

const MAX_FAILURES: u32 = 10;
/// Maior mensagem do WebSocket (o ditado manda o áudio como JSON).
pub const MAX_MESSAGE: usize = 16 << 20;
/// Comandos rodando ao mesmo tempo por conexão (o resto espera: uma conexão não esgota as threads).
pub const MAX_INFLIGHT: usize = 16;

/// CSP da PWA: só scripts do próprio kabuld (sem inline/eval), imagens locais e avatares do GitHub,
/// conexões ao próprio kabuld e a outras máquinas (seletor de máquina), nada em iframe.
pub const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://github.com https://avatars.githubusercontent.com; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss: http: https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

impl Srv {
    pub fn new(hub: Arc<Hub>) -> Arc<Self> {
        let trust_local_browser = std::env::var("KABULD_TRUST_LOCAL_BROWSER").map(|v| v != "0").unwrap_or(true);
        Arc::new(Self { hub, trust_local_browser, failures: Mutex::new(HashMap::new()), extra_hosts: net::extra_hosts_from_env() })
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
    let api = Router::new().route("/api/health", get(health)).route("/api/pair", post(pair).options(preflight)).route("/ws", get(ws_handler)).route("/api/file", get(file));
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
    let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok());
    if !net::host_allowed(host, &srv.extra_hosts) {
        return (StatusCode::MISDIRECTED_REQUEST, "kabuld: Host não reconhecido (use localhost, o IP ou o nome da tailnet; ou KABULD_ALLOWED_HOSTS)").into_response();
    }
    let api = req.uri().path().starts_with("/api/");
    let cors = matches!(req.uri().path(), "/api/health" | "/api/pair");
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    if api {
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        // Saúde e pareamento (que exige o token do QR) atendem outras origens: o app desktop pareia
        // com outras máquinas. O resto da API (arquivos) fica só na origem do kabuld.
        if cors {
            h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
        }
    } else {
        h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
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

/// `GET /api/file?t=<ingresso>`: arquivo do workspace para o preview (ver [`crate::files`]).
async fn file(State(srv): State<Arc<Srv>>, ConnectInfo(peer): ConnectInfo<SocketAddr>, headers: HeaderMap, uri: axum::http::Uri) -> Response {
    use crate::files;
    if srv.blocked(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let token = uri.query().unwrap_or("").split('&').find_map(|kv| kv.strip_prefix("t=")).unwrap_or("").to_string();
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).map(String::from);
    let hub = srv.hub.clone();
    let res = tokio::task::spawn_blocking(move || -> anyhow::Result<(files::Kind, u64, u64, u64, Vec<u8>, bool)> {
        use std::io::{Read, Seek, SeekFrom};
        let path = hub.file_for(&token)?;
        let kind = files::kind(&path);
        let mut f = std::fs::File::open(&path)?;
        let len = f.metadata()?.len();
        let (start, end, partial) = match range.as_deref().and_then(|r| files::parse_range(r, len)) {
            Some((a, b)) => (a, b, true),
            None if len > files::MAX_CHUNK => anyhow::bail!("arquivo grande demais: peça por partes (Range)"),
            None => (0, len.saturating_sub(1), false),
        };
        let n = if len == 0 { 0 } else { end - start + 1 };
        f.seek(SeekFrom::Start(start))?;
        let mut buf = Vec::with_capacity(n as usize);
        f.take(n).read_to_end(&mut buf)?;
        Ok((kind, start, end, len, buf, partial))
    })
    .await;
    let (kind, start, end, len, body, partial) = match res {
        Ok(Ok(x)) => x,
        // Ingresso de 192 bits: não conta como tentativa (um link expirado não bloqueia o IP).
        Ok(Err(e)) => return (StatusCode::FORBIDDEN, format!("{e:#}")).into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let mut r = body.into_response();
    *r.status_mut() = if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK };
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(kind.mime));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    h.insert("cross-origin-resource-policy", HeaderValue::from_static("same-origin"));
    // PDF fica fora do `sandbox` (o visualizador do navegador não abre em origem opaca); o resto,
    // inclusive SVG, vira documento sem script.
    if kind.mime != "application/pdf" {
        h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(files::FILE_CSP));
    }
    if kind.attachment {
        h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("attachment"));
    }
    if partial {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes {start}-{end}/{len}")) {
            h.insert(header::CONTENT_RANGE, v);
        }
    }
    r
}

async fn preflight() -> Response {
    let mut r = StatusCode::NO_CONTENT.into_response();
    let h = r.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("POST, OPTIONS"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type"));
    r
}

async fn health(State(srv): State<Arc<Srv>>) -> Json<Value> {
    Json(json!({"kabuld": true, "name": srv.hub.machine, "version": kabul_core::schema::APP_VERSION, "protocol": kabul_core::schema::PROTOCOL, "min_protocol": kabul_core::schema::MIN_PEER_PROTOCOL}))
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
    ws.max_message_size(MAX_MESSAGE).max_frame_size(MAX_MESSAGE).on_upgrade(move |socket| conn(srv, socket, local, peer))
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
    // Handshake de versão: o cliente manda `client: {version, protocol, min_protocol}` (opcional;
    // clientes de antes do handshake falam o protocolo 1). Cliente antigo demais é recusado com uma
    // mensagem amigável; o caso contrário (este kabuld antigo demais) quem avisa é o cliente.
    let server_info = kabul_core::schema::hello_info("kabuld");
    let c = &h["client"];
    let compat = kabul_core::schema::compat(c["version"].as_str(), c["protocol"].as_u64().map(|n| n as u32), c["min_protocol"].as_u64().map(|n| n as u32));
    if let kabul_core::schema::Compat::PeerOutdated { .. } = compat {
        let msg = kabul_core::schema::compat_message(&compat, "Este aparelho").unwrap_or_default();
        let _ = sink.send(Message::Text(json!({"hello": {"ok": false, "error": msg, "incompatible": true, "server": server_info}}).to_string().into())).await;
        let _ = sink.close().await;
        return;
    }
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
            let _ = sink.send(Message::Text(json!({"hello": {"ok": false, "error": e, "server": server_info}}).to_string().into())).await;
            let _ = sink.close().await;
            return;
        }
    };
    if sink.send(Message::Text(json!({"hello": {"ok": true, "principal": who, "machine": srv.hub.machine, "server": server_info}}).to_string().into())).await.is_err() {
        return;
    }
    let compress = h["compress"].as_str() == Some("deflate");
    let hub = srv.hub.clone();
    let conn_id = hub.next_conn();
    let state = Arc::new(Mutex::new(ConnState::default()));
    // Fila limitada por cliente: um celular lento no 4G não acumula memória sem fim no servidor.
    let (out_tx, mut out_rx) = mpsc::channel::<Out>(OUT_CAP);

    // 2) escritor: junta o que estiver na fila num único flush (menos syscalls e quadros TCP).
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            let mut batch = Some(m);
            let mut n = 0;
            while let Some(m) = batch.take() {
                let msg = match m {
                    Out::Text(t) => Message::Text(t.as_ref().into()),
                    Out::Binary(b) => Message::Binary(b.to_vec().into()),
                    Out::Close => {
                        let _ = sink.close().await;
                        return;
                    }
                };
                if sink.feed(msg).await.is_err() {
                    return;
                }
                n += 1;
                if n < WRITE_BATCH {
                    batch = out_rx.try_recv().ok();
                }
            }
            if sink.flush().await.is_err() {
                return;
            }
        }
    });

    // 3) eventos do barramento
    let (kill_tx, mut kill_rx) = tokio::sync::watch::channel(false);
    let events = {
        let mut rx = hub.bus.subscribe();
        let (who, state, out, auth_hub) = (who.clone(), state.clone(), out_tx.clone(), hub.clone());
        tokio::spawn(async move {
            let mut missed: u64 = 0;
            loop {
                match rx.recv().await {
                    Ok(ev) => {
                        if ev.channel == "__revoked" {
                            if ev.payload["id"].as_str() == Some(who.id.as_str()) {
                                let _ = out.send(Out::Text(json!({"channel": "revoked", "payload": {}}).to_string().into())).await;
                                let _ = out.send(Out::Close).await;
                                let _ = kill_tx.send(true);
                                return;
                            }
                            continue;
                        }
                        if !deliver(&who, &state.lock().unwrap(), &ev) {
                            continue;
                        }
                        if missed > 0 {
                            // O cliente perdeu eventos (fila cheia): avisa para ele reler o estado.
                            if out.send(Out::Text(json!({"channel": "lagged", "payload": {"missed": missed}}).to_string().into())).await.is_err() {
                                return;
                            }
                            missed = 0;
                        }
                        let frame = if compress && ev.frame().len() >= crate::bus::COMPRESS_MIN { Out::Binary(ev.deflated()) } else { Out::Text(ev.frame()) };
                        match out.try_send(frame) {
                            Ok(()) => {}
                            Err(mpsc::error::TrySendError::Closed(_)) => return,
                            // Status se repete (o próximo substitui): com a fila cheia, descarta.
                            Err(mpsc::error::TrySendError::Full(_)) if droppable(&ev.channel) => {}
                            // Conteúdo (chat, terminal): espera a vez; se o barramento passar na frente,
                            // o `Lagged` abaixo vira o aviso `lagged`.
                            Err(mpsc::error::TrySendError::Full(f)) => {
                                if out.send(f).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                    // Eventos perdidos (conexão lenta) podem incluir a revogação: confere de novo. Se
                    // continua valendo, o próximo evento entregue leva o aviso `lagged`.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        if !auth_hub.auth.is_active(&who.id) {
                            let _ = out.send(Out::Text(json!({"channel": "revoked", "payload": {}}).to_string().into())).await;
                            let _ = out.send(Out::Close).await;
                            let _ = kill_tx.send(true);
                            return;
                        }
                        missed += n;
                    }
                    Err(_) => return,
                }
            }
        })
    };
    // 4) leitor
    let permits = Arc::new(tokio::sync::Semaphore::new(MAX_INFLIGHT));
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
            let mut st = state.lock().unwrap();
            if st.subs.len() < MAX_SUBS {
                st.subs.insert(c.to_string());
            }
            continue;
        }
        if let Some(c) = v["unsub"].as_str() {
            state.lock().unwrap().subs.remove(c);
            continue;
        }
        let Some(command) = v["command"].as_str().map(String::from) else { continue };
        // Revogado no meio da conexão: nenhum comando a mais passa.
        if !hub.auth.is_active(&who.id) {
            let _ = out_tx.send(Out::Text(json!({"channel": "revoked", "payload": {}}).to_string().into())).await;
            break;
        }
        let id = v["id"].clone();
        let args = v.get("args").cloned().filter(|a| a.is_object()).unwrap_or_else(|| json!({}));
        // Limite de comandos simultâneos por cliente: o excesso espera (não esgota o pool de threads).
        let Ok(permit) = permits.clone().acquire_owned().await else { break };
        let (hub, who, out, state) = (hub.clone(), who.clone(), out_tx.clone(), state.clone());
        tokio::spawn(async move {
            let _permit = permit;
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
            let text = msg.to_string();
            let frame = if compress && text.len() >= crate::bus::COMPRESS_MIN { Out::Binary(crate::bus::deflate(text.as_bytes()).into()) } else { Out::Text(text.into()) };
            let _ = out.send(frame).await;
        });
    }
    hub.presence.remove(conn_id);
    events.abort();
    let _ = out_tx.send(Out::Close).await;
    let _ = writer.await;
}

/// Quadros na fila de saída de uma conexão (texto/binário compartilhados entre conexões).
enum Out {
    Text(Arc<str>),
    Binary(Arc<[u8]>),
    Close,
}

/// Quadros na fila de saída por cliente.
const OUT_CAP: usize = 1024;
/// Quadros juntados num flush.
const WRITE_BATCH: usize = 64;
/// Canais assinados por cliente.
const MAX_SUBS: usize = 64;

/// Canais de estado que o próximo evento substitui: podem ser descartados com a fila cheia.
fn droppable(channel: &str) -> bool {
    matches!(channel, "session-status" | "sessions-changed" | "chat-state" | "presence" | "presence-changed" | "devices-changed" | "agents-status" | "workspace-fs-changed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{Role, Scope};
    use crate::bus::BusEvent;

    fn ev(channel: &str, ws: Option<&str>, session: Option<&str>) -> BusEvent {
        BusEvent::new(channel, Value::Null, ws.map(String::from), session.map(String::from))
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
