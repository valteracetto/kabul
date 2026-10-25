//! Proxy autenticado da porta do Run: ver no celular o app que o workspace está rodando.
//!
//! - **Só as portas do workspace** ([`crate::files::proxy_target`]): o destino é sempre
//!   `127.0.0.1:<porta>`, com a porta entre as 10 do workspace. Nada de host arbitrário (SSRF).
//! - **Outro origin**: cada app ganha um listener próprio (porta livre no loopback e nos IPs da
//!   tailnet). O código do app nunca roda no origin do kabuld, então não lê a credencial do aparelho
//!   (`localStorage`) nem fala com o `/ws` como dono.
//! - **Entrada por ingresso**: `proxy_open` (WebSocket autenticado, dono ou editor) emite um link de uso
//!   único e 2 minutos. O resgate troca o ingresso por um cookie `HttpOnly` só daquele listener; cada
//!   conexão nova confere o cookie, a credencial (revogação) e o `Host` (DNS rebinding). Conexões
//!   abertas caem em até 5 s quando a pessoa é revogada.
//! - HTTP/1.1 repassado byte a byte depois da checagem: WebSocket do app (HMR) funciona.
use crate::files::proxy_target;
use crate::net::{self, NetTransport};
use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Validade do link de entrada.
pub const TICKET_TTL: u64 = 120;
/// Validade da sessão (cookie) no navegador.
pub const SESSION_TTL: u64 = 12 * 3600;
/// Maior cabeçalho aceito no primeiro pedido.
const MAX_HEAD: usize = 32 << 10;
/// Caminho do resgate do ingresso.
pub const ENTER_PATH: &str = "/__kabul/entrar";

#[derive(Clone, Debug)]
struct Grant {
    principal: String,
    workspace: String,
    upstream: u16,
    expires_at: u64,
}

type Active = Arc<dyn Fn(&str) -> bool + Send + Sync>;

struct Inner {
    net: Arc<dyn NetTransport>,
    extra_hosts: Vec<String>,
    active: Mutex<Option<Active>>,
    /// Ingressos de uso único (link do celular).
    tickets: Mutex<HashMap<String, Grant>>,
    /// Sessões do navegador (cookie), por listener.
    sessions: Mutex<HashMap<String, Grant>>,
}

impl Inner {
    fn is_active(&self, id: &str) -> bool {
        self.active.lock().unwrap().as_ref().map(|f| f(id)).unwrap_or(false)
    }
    fn session_ok(&self, token: &str, ws: &str, upstream: u16) -> bool {
        let now = crate::auth::now();
        let g = self.sessions.lock().unwrap().get(token).cloned();
        matches!(g, Some(g) if g.expires_at > now && g.workspace == ws && g.upstream == upstream && self.is_active(&g.principal))
    }
}

/// Listeners do proxy por (workspace, porta do app).
pub struct ProxyHub {
    inner: Arc<Inner>,
    rt: Mutex<Option<tokio::runtime::Handle>>,
    listeners: Mutex<HashMap<(String, u16), Listening>>,
}

#[derive(Clone, Debug)]
struct Listening {
    port: u16,
    host: String,
}

/// Resultado de `proxy_open`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Opened {
    /// Link completo (host da tailnet quando houver; senão 127.0.0.1).
    pub url: String,
    /// Caminho com o ingresso, para o cliente montar o link com o host por onde ele chegou.
    pub path: String,
    /// Porta do listener do proxy.
    pub port: u16,
    pub upstream: u16,
    pub expires_at: u64,
}

impl ProxyHub {
    pub fn new(net: Arc<dyn NetTransport>) -> Self {
        let inner = Inner { net, extra_hosts: net::extra_hosts_from_env(), active: Mutex::new(None), tickets: Default::default(), sessions: Default::default() };
        Self { inner: Arc::new(inner), rt: Mutex::new(None), listeners: Mutex::new(HashMap::new()) }
    }

    /// Liga o proxy ao runtime do servidor e à checagem de credencial (chamado ao subir o kabuld).
    pub fn attach(&self, rt: tokio::runtime::Handle, active: Active) {
        *self.rt.lock().unwrap() = Some(rt);
        *self.inner.active.lock().unwrap() = Some(active);
    }

    /// Abre (ou reaproveita) o listener do app e emite um link de entrada para `principal`.
    pub fn open(&self, principal: &str, workspace: &str, ws_port: u16, upstream: u16) -> Result<Opened> {
        proxy_target(ws_port, upstream)?;
        let l = self.listener(workspace, upstream)?;
        let t = crate::auth::now();
        let token = crate::auth::random_token(24);
        let expires_at = t + TICKET_TTL;
        {
            let mut m = self.inner.tickets.lock().unwrap();
            m.retain(|_, g| g.expires_at > t);
            if m.len() >= 500 {
                bail!("muitos links de proxy abertos; espere um pouco");
            }
            m.insert(token.clone(), Grant { principal: principal.into(), workspace: workspace.into(), upstream, expires_at });
        }
        let path = format!("{ENTER_PATH}?t={token}");
        let host = if l.host.contains(':') { format!("[{}]", l.host) } else { l.host.clone() };
        Ok(Opened { url: format!("http://{host}:{}{path}", l.port), path, port: l.port, upstream, expires_at })
    }

    /// Revogação: some com links e sessões da pessoa (as conexões abertas caem pelo vigia).
    pub fn revoke_principal(&self, id: &str) {
        self.inner.tickets.lock().unwrap().retain(|_, g| g.principal != id);
        self.inner.sessions.lock().unwrap().retain(|_, g| g.principal != id);
    }

    fn listener(&self, workspace: &str, upstream: u16) -> Result<Listening> {
        let key = (workspace.to_string(), upstream);
        if let Some(l) = self.listeners.lock().unwrap().get(&key) {
            return Ok(l.clone());
        }
        let rt = self.rt.lock().unwrap().clone().context("o servidor ainda não subiu")?;
        // Loopback numa porta livre e a mesma porta nos IPs da tailnet (se estiver ocupada lá, fica
        // só no loopback).
        let lo = std::net::TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        let port = lo.local_addr()?.port();
        let mut socks = vec![lo];
        let mut host = "127.0.0.1".to_string();
        for ip in self.inner.net.bind_ips().into_iter().filter(|ip| net::is_tailnet(*ip)) {
            match std::net::TcpListener::bind(SocketAddr::new(ip, port)) {
                Ok(s) => {
                    if host == "127.0.0.1" || (host.contains(':') && ip.is_ipv4()) {
                        host = ip.to_string();
                    }
                    socks.push(s);
                }
                Err(e) => eprintln!("kabuld: proxy sem {ip}:{port}: {e}"),
            }
        }
        for s in socks {
            s.set_nonblocking(true)?;
            let inner = self.inner.clone();
            let ws = workspace.to_string();
            rt.spawn(async move {
                let Ok(l) = tokio::net::TcpListener::from_std(s) else { return };
                while let Ok((sock, peer)) = l.accept().await {
                    let (inner, ws) = (inner.clone(), ws.clone());
                    tokio::spawn(async move {
                        let _ = serve_conn(inner, sock, peer, port, ws, upstream).await;
                    });
                }
            });
        }
        let l = Listening { port, host };
        self.listeners.lock().unwrap().insert(key, l.clone());
        Ok(l)
    }
}

/// Portas do workspace que têm algo escutando no 127.0.0.1 agora.
pub fn listening_ports(ws_port: u16) -> Vec<(u16, bool)> {
    if ws_port == 0 {
        return vec![];
    }
    (ws_port..ws_port.saturating_add(crate::files::PORTS_PER_WORKSPACE)).map(|p| (p, std::net::TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), p), Duration::from_millis(250)).is_ok())).collect()
}

/// Primeiro pedido de uma conexão: linha do pedido e cabeçalhos (nomes em minúsculas).
#[derive(Debug, PartialEq)]
pub struct Head {
    pub method: String,
    pub target: String,
    pub headers: Vec<(String, String)>,
}

impl Head {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }
    pub fn cookie(&self, name: &str) -> Option<String> {
        self.headers.iter().filter(|(n, _)| n == "cookie").flat_map(|(_, v)| v.split(';')).find_map(|kv| {
            let (k, v) = kv.trim().split_once('=')?;
            (k == name).then(|| v.to_string())
        })
    }
}

pub fn parse_head(buf: &[u8]) -> Option<Head> {
    let s = std::str::from_utf8(buf).ok()?;
    let mut lines = s.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let (method, target, version) = (first.next()?, first.next()?, first.next()?);
    if !version.starts_with("HTTP/1.") || method.is_empty() || !target.starts_with('/') {
        return None;
    }
    let headers = lines.take_while(|l| !l.is_empty()).filter_map(|l| l.split_once(':').map(|(n, v)| (n.trim().to_lowercase(), v.trim().to_string()))).collect();
    Some(Head { method: method.into(), target: target.into(), headers })
}

fn cookie_name(port: u16) -> String {
    format!("kabul_proxy_{port}")
}

fn simple(status: &str, body: &str, extra: &str) -> Vec<u8> {
    format!("HTTP/1.1 {status}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: {}\r\ncache-control: no-store\r\nx-content-type-options: nosniff\r\nconnection: close\r\n{extra}\r\n{body}", body.len()).into_bytes()
}

async fn serve_conn(inner: Arc<Inner>, mut sock: TcpStream, peer: SocketAddr, port: u16, ws: String, upstream: u16) -> Result<()> {
    if !net::is_loopback(peer.ip()) && !inner.net.accepts_peer(peer.ip()) {
        return Ok(());
    }
    // 1) Cabeçalho do primeiro pedido.
    let mut buf = Vec::with_capacity(4096);
    let end = tokio::time::timeout(Duration::from_secs(20), async {
        let mut chunk = [0u8; 4096];
        loop {
            let n = sock.read(&mut chunk).await?;
            if n == 0 {
                bail!("fechou");
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                return Ok(i + 4);
            }
            if buf.len() > MAX_HEAD {
                bail!("cabeçalho grande demais");
            }
        }
    })
    .await??;
    let Some(head) = parse_head(&buf[..end]) else {
        sock.write_all(&simple("400 Bad Request", "pedido inválido", "")).await?;
        return Ok(());
    };
    if !net::host_allowed(head.header("host"), &inner.extra_hosts) {
        sock.write_all(&simple("421 Misdirected Request", "kabul: Host não reconhecido", "")).await?;
        return Ok(());
    }
    // 2) Resgate do ingresso → cookie.
    if head.target == ENTER_PATH || head.target.starts_with(&format!("{ENTER_PATH}?")) {
        let t = head.target.split_once('?').map(|(_, q)| q).unwrap_or("").split('&').find_map(|kv| kv.strip_prefix("t=")).unwrap_or("").to_string();
        let now = crate::auth::now();
        let g = inner.tickets.lock().unwrap().remove(&t);
        match g {
            Some(g) if g.expires_at > now && g.workspace == ws && g.upstream == upstream && inner.is_active(&g.principal) => {
                let s = crate::auth::random_token(24);
                {
                    let mut m = inner.sessions.lock().unwrap();
                    m.retain(|_, x| x.expires_at > now);
                    m.insert(s.clone(), Grant { expires_at: now + SESSION_TTL, ..g });
                }
                let extra = format!("location: /\r\nset-cookie: {}={s}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL}\r\nreferrer-policy: no-referrer\r\n", cookie_name(port));
                sock.write_all(&simple("302 Found", "", &extra)).await?;
            }
            _ => sock.write_all(&simple("403 Forbidden", "Kabul: link expirado ou já usado. Abra o app de novo pelo celular.", "")).await?,
        }
        return Ok(());
    }
    // 3) Sessão do navegador.
    let session = head.cookie(&cookie_name(port)).unwrap_or_default();
    if !inner.session_ok(&session, &ws, upstream) {
        sock.write_all(&simple("401 Unauthorized", "Kabul: sem acesso a este app. Abra pelo Kabul no celular (Arquivos › App).", "")).await?;
        return Ok(());
    }
    // 4) Repasse.
    let target = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), upstream);
    let mut up = match tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(target)).await {
        Ok(Ok(s)) => s,
        _ => {
            sock.write_all(&simple("502 Bad Gateway", &format!("Kabul: nada escutando na porta {upstream}. Rode o app (Run) no workspace."), "")).await?;
            return Ok(());
        }
    };
    up.write_all(&buf).await?;
    let pipe = tokio::io::copy_bidirectional(&mut sock, &mut up);
    tokio::pin!(pipe);
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    tick.tick().await;
    loop {
        tokio::select! {
            _ = &mut pipe => return Ok(()),
            _ = tick.tick() => {
                if !inner.session_ok(&session, &ws, upstream) {
                    return Ok(());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cabecalho_e_cookie() {
        let h = parse_head(b"GET /a?b=1 HTTP/1.1\r\nHost: 100.64.0.1:5000\r\nCookie: x=1; kabul_proxy_5000=abc\r\n\r\n").unwrap();
        assert_eq!((h.method.as_str(), h.target.as_str()), ("GET", "/a?b=1"));
        assert_eq!(h.header("host"), Some("100.64.0.1:5000"));
        assert_eq!(h.cookie(&cookie_name(5000)).as_deref(), Some("abc"));
        assert_eq!(h.cookie("kabul_proxy_5001"), None);
        for bad in [&b"GET http://evil/ HTTP/1.1\r\n\r\n"[..], b"lixo\r\n\r\n", b"GET / SPDY\r\n\r\n"] {
            assert!(parse_head(bad).is_none());
        }
    }

    #[test]
    fn so_portas_do_workspace() {
        let p = ProxyHub::new(Arc::new(crate::net::LocalOnly));
        assert!(p.open("d", "w1", 41000, 22).is_err());
        assert!(p.open("d", "w1", 0, 0).is_err());
        assert!(p.open("d", "w1", 41000, 41010).is_err());
        // Porta certa, mas o servidor não subiu: sem runtime, sem listener.
        assert!(p.open("d", "w1", 41000, 41001).unwrap_err().to_string().contains("não subiu"));
        assert!(listening_ports(0).is_empty());
    }
}
