//! Camada de rede isolada: por onde o kabuld fica acessível fora do localhost.
//!
//! Hoje: [`Tailscale`] (escuta no IP da tailnet e só aceita pares da tailnet; HTTPS opcional pelo
//! `tailscale serve`). Amanhã: túnel público, implementando a mesma trait. Nada escuta em 0.0.0.0.
use serde::Serialize;
use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::process::Command;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct NetStatus {
    /// Nome do transporte ("tailscale", "localhost").
    pub kind: String,
    /// Transporte ativo (ex.: Tailscale conectado).
    pub up: bool,
    pub ips: Vec<String>,
    /// Nome MagicDNS (ex.: `mac.tailnet.ts.net`).
    pub dns_name: Option<String>,
    /// URL https servida pelo `tailscale serve` apontando para o kabuld.
    pub https_url: Option<String>,
    pub message: Option<String>,
}

pub trait NetTransport: Send + Sync {
    fn kind(&self) -> &'static str;
    /// IPs onde escutar além do loopback.
    fn bind_ips(&self) -> Vec<IpAddr>;
    /// Um par vindo de fora do loopback pode conectar?
    fn accepts_peer(&self, ip: IpAddr) -> bool;
    /// Estado atual (detectado na hora).
    fn status(&self, port: u16) -> NetStatus;
    /// Liga/desliga HTTPS na frente do kabuld (quando o transporte oferece).
    fn set_https(&self, _port: u16, _on: bool) -> anyhow::Result<NetStatus> {
        anyhow::bail!("este transporte não oferece HTTPS")
    }
    /// URL base que o celular abre (prefere HTTPS).
    fn base_url(&self, port: u16) -> String {
        let s = self.status(port);
        if let Some(u) = s.https_url {
            return u;
        }
        match s.ips.iter().find(|i| !i.contains(':')).or(s.ips.first()) {
            Some(ip) if ip.contains(':') => format!("http://[{ip}]:{port}"),
            Some(ip) => format!("http://{ip}:{port}"),
            None => format!("http://127.0.0.1:{port}"),
        }
    }
}

/// Só localhost (Tailscale desligado ou `--no-tailscale`).
pub struct LocalOnly;

impl NetTransport for LocalOnly {
    fn kind(&self) -> &'static str {
        "localhost"
    }
    fn bind_ips(&self) -> Vec<IpAddr> {
        vec![]
    }
    fn accepts_peer(&self, _ip: IpAddr) -> bool {
        false
    }
    fn status(&self, _port: u16) -> NetStatus {
        NetStatus { kind: "localhost".into(), up: true, message: Some("Só neste computador.".into()), ..Default::default() }
    }
}

/// Faixas da tailnet: 100.64.0.0/10 (CGNAT) e fd7a:115c:a1e0::/48.
pub fn is_tailnet(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o[0] == 100 && (o[1] & 0b1100_0000) == 64
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_tailnet(IpAddr::V4(v4));
            }
            let s = v6.segments();
            s[0] == 0xfd7a && s[1] == 0x115c && s[2] == 0xa1e0
        }
    }
}

pub fn is_loopback(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_loopback(),
        IpAddr::V6(v) => v.is_loopback() || v.to_ipv4_mapped().map(|m| m.is_loopback()).unwrap_or(false),
    }
}

/// Origem do navegador que conta como "este computador": sem Origin (cliente nativo), localhost,
/// 127.0.0.1, [::1] e o WebView do Tauri. Qualquer outra (inclusive o https do `tailscale serve`,
/// que chega ao kabuld pelo loopback) precisa de credencial.
pub fn origin_is_local(origin: Option<&str>) -> bool {
    let Some(o) = origin else { return true };
    let o = o.trim().to_lowercase();
    if o.starts_with("tauri://") {
        return true;
    }
    let rest = o.strip_prefix("http://").or_else(|| o.strip_prefix("https://"));
    let Some(rest) = rest else { return false };
    let host = if rest.starts_with('[') { rest.split(']').next().map(|h| format!("{h}]")).unwrap_or_default() } else { rest.split([':', '/']).next().unwrap_or("").to_string() };
    matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]" | "tauri.localhost")
}

/// Dono local sem pareamento: par no loopback, origem local e nenhum proxy no caminho.
pub fn local_trusted(peer: SocketAddr, origin: Option<&str>, forwarded: bool) -> bool {
    is_loopback(peer.ip()) && origin_is_local(origin) && !forwarded
}

pub struct Tailscale {
    cli: Option<std::path::PathBuf>,
}

impl Default for Tailscale {
    fn default() -> Self {
        Self::new()
    }
}

impl Tailscale {
    pub fn new() -> Self {
        let cli = kabul_core::harness::which("tailscale").or_else(|| {
            // App do Mac sem o CLI no PATH.
            let p = std::path::PathBuf::from("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
            p.is_file().then_some(p)
        });
        Self { cli }
    }
    fn run(&self, args: &[&str]) -> Option<String> {
        let o = Command::new(self.cli.as_ref()?).args(args).output().ok()?;
        o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
    }
    pub fn ips(&self) -> Vec<IpAddr> {
        parse_ips(&self.run(&["ip"]).unwrap_or_default())
    }
    pub fn status_json(&self) -> Option<Value> {
        serde_json::from_str(&self.run(&["status", "--json"])?).ok()
    }
}

pub fn parse_ips(out: &str) -> Vec<IpAddr> {
    out.lines().filter_map(|l| l.trim().parse::<IpAddr>().ok()).filter(|ip| is_tailnet(*ip)).collect()
}

/// `tailscale serve status --json` aponta algum handler para o nosso porto?
pub fn serve_points_to(json: &str, port: u16) -> bool {
    json.contains(&format!("127.0.0.1:{port}")) || json.contains(&format!("localhost:{port}"))
}

impl NetTransport for Tailscale {
    fn kind(&self) -> &'static str {
        "tailscale"
    }
    fn bind_ips(&self) -> Vec<IpAddr> {
        self.ips()
    }
    fn accepts_peer(&self, ip: IpAddr) -> bool {
        is_tailnet(ip)
    }
    fn status(&self, port: u16) -> NetStatus {
        if self.cli.is_none() {
            return NetStatus { kind: "tailscale".into(), message: Some("Tailscale não instalado: só este computador acessa.".into()), ..Default::default() };
        }
        let ips = self.ips();
        if ips.is_empty() {
            return NetStatus { kind: "tailscale".into(), message: Some("Tailscale desconectado: abra o app do Tailscale e entre.".into()), ..Default::default() };
        }
        let dns = self.status_json().and_then(|v| v.pointer("/Self/DNSName").and_then(Value::as_str).map(|s| s.trim_end_matches('.').to_string())).filter(|s| !s.is_empty());
        let https = self.run(&["serve", "status", "--json"]).filter(|j| serve_points_to(j, port)).and(dns.clone()).map(|d| format!("https://{d}"));
        NetStatus { kind: "tailscale".into(), up: true, ips: ips.iter().map(|i| i.to_string()).collect(), dns_name: dns, https_url: https, message: None }
    }
    fn set_https(&self, port: u16, on: bool) -> anyhow::Result<NetStatus> {
        let cli = self.cli.as_ref().ok_or_else(|| anyhow::anyhow!("Tailscale não instalado"))?;
        let target = format!("http://127.0.0.1:{port}");
        let args: Vec<&str> = if on { vec!["serve", "--bg", "--https=443", &target] } else { vec!["serve", "--https=443", "off"] };
        let o = Command::new(cli).args(&args).output()?;
        if !o.status.success() {
            anyhow::bail!("tailscale serve: {}", String::from_utf8_lossy(&o.stderr).trim());
        }
        Ok(self.status(port))
    }
}

/// Endereços onde escutar: loopback sempre; IPs do transporte quando houver.
pub fn listen_addrs(net: &dyn NetTransport, port: u16) -> Vec<SocketAddr> {
    let mut v = vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)];
    for ip in net.bind_ips() {
        if is_tailnet(ip) {
            v.push(SocketAddr::new(ip, port));
        }
    }
    let _ = Ipv6Addr::LOCALHOST;
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faixas_da_tailnet() {
        assert!(is_tailnet("100.64.0.1".parse().unwrap()));
        assert!(is_tailnet("100.127.255.254".parse().unwrap()));
        assert!(!is_tailnet("100.128.0.1".parse().unwrap()));
        assert!(!is_tailnet("192.168.0.10".parse().unwrap()));
        assert!(!is_tailnet("8.8.8.8".parse().unwrap()));
        assert!(is_tailnet("fd7a:115c:a1e0::1".parse().unwrap()));
        assert!(!is_tailnet("fd00::1".parse().unwrap()));
        assert!(is_tailnet("::ffff:100.100.1.1".parse().unwrap()));
    }

    #[test]
    fn origem_local() {
        assert!(origin_is_local(None));
        assert!(origin_is_local(Some("http://localhost:5173")));
        assert!(origin_is_local(Some("http://127.0.0.1:7777")));
        assert!(origin_is_local(Some("tauri://localhost")));
        assert!(origin_is_local(Some("http://tauri.localhost")));
        assert!(origin_is_local(Some("http://[::1]:7777")));
        assert!(!origin_is_local(Some("https://evil.example")));
        assert!(!origin_is_local(Some("http://localhost.evil.example")));
        assert!(!origin_is_local(Some("https://mac.tailnet.ts.net")));
        assert!(!origin_is_local(Some("null")));
    }

    #[test]
    fn confianca_local() {
        let lo: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        let ts: SocketAddr = "100.100.1.2:5000".parse().unwrap();
        assert!(local_trusted(lo, None, false));
        assert!(!local_trusted(lo, None, true), "proxy (tailscale serve) não é local");
        assert!(!local_trusted(lo, Some("https://site.example"), false), "página qualquer no navegador do Mac");
        assert!(!local_trusted(ts, None, false));
    }

    #[test]
    fn ips_e_serve() {
        let ips = parse_ips("100.101.102.103\nfd7a:115c:a1e0::abcd\n192.168.1.2\nlixo\n");
        assert_eq!(ips.len(), 2);
        assert!(serve_points_to(r#"{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7777"}}}}}"#, 7777));
        assert!(!serve_points_to("{}", 7777));
        assert_eq!(listen_addrs(&LocalOnly, 7777), vec!["127.0.0.1:7777".parse::<SocketAddr>().unwrap()]);
    }
}
