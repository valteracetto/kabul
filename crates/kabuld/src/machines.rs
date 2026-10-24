//! Outras máquinas com kabuld na tailnet: lê os pares do `tailscale status --json` e pergunta a cada
//! um, em paralelo e com timeout curto, se responde em `/api/health`.
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Peer {
    pub name: String,
    pub dns_name: Option<String>,
    pub ip: String,
    pub os: String,
    pub online: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Found {
    #[serde(flatten)]
    pub peer: Peer,
    pub kabuld: bool,
    /// Nome que o kabuld daquela máquina informa (nome do computador).
    pub machine: Option<String>,
    pub url: String,
}

/// Pares da tailnet (sem a própria máquina).
pub fn parse_peers(status: &Value) -> Vec<Peer> {
    let Some(peers) = status.get("Peer").and_then(Value::as_object) else { return vec![] };
    let mut v: Vec<Peer> = peers
        .values()
        .filter_map(|p| {
            let ip = p.get("TailscaleIPs")?.as_array()?.iter().filter_map(Value::as_str).find(|i| !i.contains(':'))?.to_string();
            Some(Peer {
                name: p.get("HostName").and_then(Value::as_str).unwrap_or(&ip).to_string(),
                dns_name: p.get("DNSName").and_then(Value::as_str).map(|s| s.trim_end_matches('.').to_string()).filter(|s| !s.is_empty()),
                ip,
                os: p.get("OS").and_then(Value::as_str).unwrap_or_default().to_string(),
                online: p.get("Online").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect();
    v.sort_by(|a, b| b.online.cmp(&a.online).then(a.name.cmp(&b.name)));
    v
}

/// GET /api/health com timeout; devolve o JSON se for um kabuld.
pub fn probe(ip: &str, port: u16, timeout: Duration) -> Option<Value> {
    let addr: SocketAddr = format!("{ip}:{port}").parse().ok()?;
    let mut s = TcpStream::connect_timeout(&addr, timeout).ok()?;
    s.set_read_timeout(Some(timeout)).ok()?;
    s.set_write_timeout(Some(timeout)).ok()?;
    write!(s, "GET /api/health HTTP/1.1\r\nHost: {ip}:{port}\r\nConnection: close\r\n\r\n").ok()?;
    let mut buf = Vec::new();
    let _ = s.take(64 * 1024).read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let body = text.split("\r\n\r\n").nth(1)?;
    let v: Value = serde_json::from_str(body.trim()).ok()?;
    (v.get("kabuld").and_then(Value::as_bool) == Some(true)).then_some(v)
}

pub fn discover(status: Option<Value>, port: u16) -> Vec<Found> {
    let peers = status.as_ref().map(parse_peers).unwrap_or_default();
    let handles: Vec<_> = peers
        .into_iter()
        .map(|p| {
            std::thread::spawn(move || {
                let h = if p.online { probe(&p.ip, port, Duration::from_millis(900)) } else { None };
                let host = p.dns_name.clone().unwrap_or_else(|| p.ip.clone());
                Found { kabuld: h.is_some(), machine: h.as_ref().and_then(|v| v["name"].as_str().map(String::from)), url: format!("ws://{host}:{port}/ws"), peer: p }
            })
        })
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pares_da_tailnet() {
        let st: Value = serde_json::from_str(include_str!("../tests/fixtures/tailscale_status.json")).unwrap();
        let p = parse_peers(&st);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].name, "mac-escritorio");
        assert!(p[0].online);
        assert_eq!(p[0].dns_name.as_deref(), Some("mac-escritorio.tailnet-exemplo.ts.net"));
        assert_eq!(p[1].ip, "100.100.0.3");
        assert!(parse_peers(&Value::Null).is_empty());
    }

    #[test]
    fn probe_sem_servidor() {
        assert!(probe("127.0.0.1", 1, Duration::from_millis(200)).is_none());
    }
}
