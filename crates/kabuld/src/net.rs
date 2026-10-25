//! Camada de rede isolada: por onde o kabuld fica acessível fora do localhost.
//!
//! Hoje: [`Tailscale`] (escuta no IP da tailnet e só aceita pares da tailnet; HTTPS opcional pelo
//! `tailscale serve`). Amanhã: túnel público, implementando a mesma trait. Nada escuta em 0.0.0.0.
use serde::Serialize;
use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

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
    /// A tailnet emite certificados HTTPS (`CertDomains` no `tailscale status`). `None`: não deu
    /// para saber (Tailscale fora do ar, transporte sem HTTPS).
    pub https_supported: Option<bool>,
    /// MagicDNS ligado na tailnet (pré-requisito do HTTPS).
    pub magic_dns: Option<bool>,
    /// O que fazer para ter HTTPS quando falta algo na tailnet (o kabuld nunca muda a tailnet).
    pub https_help: Option<String>,
    /// Painel onde a pessoa liga MagicDNS e HTTPS Certificates.
    pub admin_url: Option<String>,
    /// CLI do Tailscale encontrado (diagnóstico).
    pub cli: Option<String>,
}

/// Painel de DNS da tailnet: MagicDNS e HTTPS Certificates.
pub const TAILSCALE_DNS_ADMIN: &str = "https://login.tailscale.com/admin/dns";

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

/// Host do pedido aceito pelo kabuld (defesa contra DNS rebinding: um site que faz o próprio domínio
/// apontar para 127.0.0.1 chega com `Host: site-do-atacante.com`). Valem IP literal, `localhost` e
/// `*.localhost`, nome de uma parte só (MagicDNS curto, ex.: `mac`), `*.ts.net` e os hosts de
/// `extra` (`KABULD_PUBLIC_URL`, `KABULD_ALLOWED_HOSTS`). Sem `Host` (cliente nativo antigo) passa.
pub fn host_allowed(host: Option<&str>, extra: &[String]) -> bool {
    let Some(h) = host else { return true };
    let h = h.trim().to_lowercase();
    let name = if let Some(rest) = h.strip_prefix('[') { rest.split(']').next().unwrap_or("").to_string() } else { h.rsplit_once(':').filter(|(_, p)| p.bytes().all(|b| b.is_ascii_digit())).map(|(n, _)| n.to_string()).unwrap_or(h.clone()) };
    let name = name.trim_end_matches('.');
    if name.is_empty() {
        return false;
    }
    name.parse::<IpAddr>().is_ok() || name == "localhost" || name.ends_with(".localhost") || !name.contains('.') || name.ends_with(".ts.net") || extra.iter().any(|e| e.eq_ignore_ascii_case(name))
}

/// Hosts extras aceitos: o de `KABULD_PUBLIC_URL` e os de `KABULD_ALLOWED_HOSTS` (separados por vírgula).
pub fn extra_hosts_from_env() -> Vec<String> {
    let mut v: Vec<String> = std::env::var("KABULD_ALLOWED_HOSTS").unwrap_or_default().split(',').map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).collect();
    if let Ok(u) = std::env::var("KABULD_PUBLIC_URL") {
        if let Some(h) = u.split("://").nth(1).and_then(|r| r.split(['/', ':']).next()).filter(|h| !h.is_empty()) {
            v.push(h.to_lowercase());
        }
    }
    v
}

/// Dono local sem pareamento: par no loopback, origem local e nenhum proxy no caminho.
pub fn local_trusted(peer: SocketAddr, origin: Option<&str>, forwarded: bool) -> bool {
    is_loopback(peer.ip()) && origin_is_local(origin) && !forwarded
}

pub struct Tailscale {
    cli: Option<std::path::PathBuf>,
}

/// Onde mais o CLI do Tailscale costuma estar, além do PATH, `/usr/local/bin` e `/opt/homebrew/bin`
/// (que [`kabul_core::harness::which`] já cobre, com `KABUL_BIN_TAILSCALE` para forçar): o executável
/// dentro do app do Mac (o Kabul aberto pelo Finder não herda o PATH do terminal) e as pastas padrão
/// do Linux e do Windows.
pub fn tailscale_candidates() -> Vec<std::path::PathBuf> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    let mut v: Vec<std::path::PathBuf> = vec!["/Applications/Tailscale.app/Contents/MacOS/Tailscale".into(), home.join("Applications/Tailscale.app/Contents/MacOS/Tailscale"), "/usr/bin/tailscale".into(), "/usr/sbin/tailscale".into()];
    // Windows: a pasta do instalador (ProgramFiles pode não ser C:\Program Files).
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        v.push(std::path::PathBuf::from(pf).join("Tailscale").join("tailscale.exe"));
    }
    v.push(r"C:\Program Files\Tailscale\tailscale.exe".into());
    v
}

pub fn find_tailscale() -> Option<std::path::PathBuf> {
    kabul_core::harness::which("tailscale").or_else(|| tailscale_candidates().into_iter().find(|p| p.is_file()))
}

/// Suporte a HTTPS da tailnet, lido do `tailscale status --json` (sem efeito colateral: o
/// `tailscale cert` gravaria arquivos e pediria um certificado).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HttpsSupport {
    pub magic_dns: bool,
    pub certs: bool,
}

pub fn https_support(st: &Value) -> HttpsSupport {
    let certs = st.get("CertDomains").and_then(Value::as_array).map(|a| a.iter().any(|d| d.as_str().is_some_and(|s| !s.is_empty()))).unwrap_or(false);
    let magic_dns = st.pointer("/CurrentTailnet/MagicDNSEnabled").and_then(Value::as_bool).unwrap_or_else(|| st.get("MagicDNSSuffix").and_then(Value::as_str).is_some_and(|s| !s.is_empty()));
    HttpsSupport { magic_dns, certs }
}

/// Instrução para quando a tailnet não emite certificado. O kabuld não muda a configuração dela.
pub fn https_help(s: HttpsSupport) -> Option<String> {
    if s.certs {
        return None;
    }
    let dns = if s.magic_dns { "" } else { "ligue o MagicDNS e, na mesma página, " };
    Some(format!("O HTTPS não está habilitado na sua tailnet. No painel do Tailscale ({TAILSCALE_DNS_ADMIN}), {dns}em HTTPS Certificates clique em Enable HTTPS. Depois volte aqui e toque em Tentar de novo."))
}

/// Saída de um comando rodado com prazo (o `tailscale serve` pode ficar esperando um consentimento
/// no navegador e nunca terminar).
pub struct Ran {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

impl Ran {
    pub fn ok(&self) -> bool {
        !self.timed_out && self.code == Some(0)
    }
    /// Saída para mostrar: erro e saída padrão juntos.
    pub fn output(&self) -> String {
        [self.stderr.trim(), self.stdout.trim()].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n")
    }
}

pub fn run_with_timeout(cli: &std::path::Path, args: &[&str], timeout: std::time::Duration) -> std::io::Result<Ran> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = kabul_core::shell::command(cli).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    // Leitores em threads com resposta por canal: se um neto do comando segurar o pipe aberto
    // depois do prazo, não ficamos presos esperando o fim da saída.
    let pipe = |r: Option<Box<dyn Read + Send>>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut b = vec![];
            if let Some(mut r) = r {
                let _ = r.read_to_end(&mut b);
            }
            let _ = tx.send(String::from_utf8_lossy(&b).into_owned());
        });
        rx
    };
    let t_out = pipe(child.stdout.take().map(|o| Box::new(o) as Box<dyn Read + Send>));
    let t_err = pipe(child.stderr.take().map(|o| Box::new(o) as Box<dyn Read + Send>));
    let deadline = std::time::Instant::now() + timeout;
    let (code, timed_out) = loop {
        if let Some(st) = child.try_wait()? {
            break (st.code(), false);
        }
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break (None, true);
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let wait = std::time::Duration::from_millis(if timed_out { 300 } else { 5000 });
    Ok(Ran { code, stdout: t_out.recv_timeout(wait).unwrap_or_default(), stderr: t_err.recv_timeout(wait).unwrap_or_default(), timed_out })
}

/// Erro do `tailscale serve` com a saída real do comando e, quando ela fala de HTTPS ou traz um link
/// do painel, o que fazer.
pub fn serve_error(r: &Ran, secs: u64) -> String {
    let out = r.output();
    let head = if r.timed_out { format!("tailscale serve não terminou em {secs} s") } else { format!("tailscale serve falhou (código {})", r.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())) };
    let mut msg = if out.is_empty() { head } else { format!("{head}: {out}") };
    let lower = out.to_lowercase();
    if (lower.contains("https") && (lower.contains("not enabled") || lower.contains("cert"))) || lower.contains("login.tailscale.com") {
        msg.push_str(&format!("\n\nSe a saída trouxer um link do painel do Tailscale, abra-o para autorizar. Para HTTPS, a tailnet precisa de MagicDNS e HTTPS Certificates ligados em {TAILSCALE_DNS_ADMIN}."));
    }
    msg
}

impl Default for Tailscale {
    fn default() -> Self {
        Self::new()
    }
}

impl Tailscale {
    pub fn new() -> Self {
        Self { cli: find_tailscale() }
    }
    fn run(&self, args: &[&str]) -> Option<String> {
        let r = run_with_timeout(self.cli.as_ref()?, args, std::time::Duration::from_secs(8)).ok()?;
        r.ok().then_some(r.stdout)
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

/// O `tailscale serve` já tem algo na 443 (`TCP."443"`)?
pub fn serve_uses_443(json: &str) -> bool {
    serde_json::from_str::<Value>(json).ok().is_some_and(|v| v.pointer("/TCP/443").is_some())
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
        let Some(cli) = self.cli.as_ref() else {
            return NetStatus { kind: "tailscale".into(), message: Some("Tailscale não instalado (procurei no PATH, em /usr/local/bin e em /Applications/Tailscale.app): só este computador acessa.".into()), ..Default::default() };
        };
        let cli = Some(cli.display().to_string());
        let ips = self.ips();
        if ips.is_empty() {
            return NetStatus { kind: "tailscale".into(), message: Some("Tailscale desconectado: abra o app do Tailscale e entre.".into()), cli, ..Default::default() };
        }
        let st = self.status_json();
        let dns = st.as_ref().and_then(|v| v.pointer("/Self/DNSName").and_then(Value::as_str).map(|s| s.trim_end_matches('.').to_string())).filter(|s| !s.is_empty());
        let support = st.as_ref().map(https_support);
        let https = self.run(&["serve", "status", "--json"]).filter(|j| serve_points_to(j, port)).and(dns.clone()).map(|d| format!("https://{d}"));
        // Já servindo por HTTPS: a tailnet tem certificado, mesmo que o status não liste.
        let supported = support.map(|s| s.certs || https.is_some());
        let help = support.filter(|_| supported == Some(false)).and_then(https_help);
        NetStatus {
            kind: "tailscale".into(),
            up: true,
            ips: ips.iter().map(|i| i.to_string()).collect(),
            dns_name: dns,
            https_url: https,
            message: None,
            https_supported: supported,
            magic_dns: support.map(|s| s.magic_dns),
            admin_url: help.as_ref().map(|_| TAILSCALE_DNS_ADMIN.to_string()),
            https_help: help,
            cli,
        }
    }
    fn set_https(&self, port: u16, on: bool) -> anyhow::Result<NetStatus> {
        let cli = self.cli.as_ref().ok_or_else(|| anyhow::anyhow!("Tailscale não instalado (procurei no PATH, em /usr/local/bin e em /Applications/Tailscale.app)"))?;
        if on {
            // Já servido (pelo Kabul antes ou configurado à mão): reaproveita, sem rodar nada.
            let now = self.status(port);
            if now.https_url.is_some() {
                return Ok(now);
            }
            // Antes do `serve`: sem certificado na tailnet ele falha (ou fica esperando) sem dizer por quê.
            let st = self.status_json().ok_or_else(|| anyhow::anyhow!("não consegui ler o `tailscale status`: o Tailscale está aberto e conectado?"))?;
            if let Some(help) = https_help(https_support(&st)) {
                anyhow::bail!(help);
            }
            // A 443 já serve outra coisa: não sobrescreve a configuração da pessoa.
            if let Some(other) = self.run(&["serve", "status", "--json"]).filter(|j| serve_uses_443(j)) {
                anyhow::bail!(
                    "o `tailscale serve` já usa a porta 443 para outro destino; o Kabul não mexe nisso. Aponte-o para http://127.0.0.1:{port} (ou libere a 443) e tente de novo. Configuração atual: {}",
                    other.split_whitespace().collect::<Vec<_>>().join(" ")
                );
            }
        }
        let target = format!("http://127.0.0.1:{port}");
        let args: Vec<&str> = if on { vec!["serve", "--bg", "--https=443", &target] } else { vec!["serve", "--https=443", "off"] };
        const SECS: u64 = 25;
        let r = run_with_timeout(cli, &args, std::time::Duration::from_secs(SECS))?;
        if !r.ok() {
            anyhow::bail!(serve_error(&r, SECS));
        }
        let s = self.status(port);
        if on && s.https_url.is_none() {
            let now = self.run(&["serve", "status"]).unwrap_or_default();
            anyhow::bail!("tailscale serve terminou, mas não aponta para {target}. Estado do serve: {}", if now.trim().is_empty() { "vazio" } else { now.trim() });
        }
        Ok(s)
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
    fn host_contra_dns_rebinding() {
        let none: Vec<String> = vec![];
        for ok in ["127.0.0.1:7777", "localhost:7777", "[::1]:7777", "100.100.1.2:7777", "mac:7777", "mac", "mac.tailnet-exemplo.ts.net", "tauri.localhost", "MAC.TAILNET.TS.NET."] {
            assert!(host_allowed(Some(ok), &none), "{ok}");
        }
        for bad in ["evil.example:7777", "evil.example", "localhost.evil.example", "127.0.0.1.nip.io:7777", "ts.net.evil.example", ""] {
            assert!(!host_allowed(Some(bad), &none), "{bad}");
        }
        assert!(host_allowed(None, &none));
        assert!(host_allowed(Some("kabul.minha-empresa.com"), &["kabul.minha-empresa.com".into()]));
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
    fn https_da_tailnet() {
        let com = serde_json::json!({"CertDomains": ["mac.tailnet-exemplo.ts.net"], "MagicDNSSuffix": "tailnet-exemplo.ts.net", "CurrentTailnet": {"MagicDNSEnabled": true}});
        assert_eq!(https_support(&com), HttpsSupport { magic_dns: true, certs: true });
        assert!(https_help(https_support(&com)).is_none());
        let sem = serde_json::json!({"CertDomains": null, "CurrentTailnet": {"MagicDNSEnabled": true}});
        let h = https_help(https_support(&sem)).unwrap();
        assert!(h.contains(TAILSCALE_DNS_ADMIN) && h.contains("HTTPS Certificates") && !h.contains("ligue o MagicDNS"), "{h}");
        assert!(https_help(https_support(&serde_json::json!({}))).unwrap().contains("ligue o MagicDNS"));
    }

    #[cfg(unix)]
    #[test]
    fn comando_com_prazo_e_erro_real() {
        let sh = std::path::Path::new("/bin/sh");
        let r = run_with_timeout(sh, &["-c", "echo saida; echo erro >&2; exit 3"], std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(r.code, Some(3));
        let m = serve_error(&r, 5);
        assert!(m.contains("código 3") && m.contains("erro") && m.contains("saida"), "{m}");
        let t = std::time::Instant::now();
        let r = run_with_timeout(sh, &["-c", "echo 'Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=x'; exec sleep 30"], std::time::Duration::from_millis(500)).unwrap();
        assert!(r.timed_out && t.elapsed() < std::time::Duration::from_secs(5));
        let m = serve_error(&r, 1);
        assert!(m.contains("não terminou") && m.contains("login.tailscale.com/f/serve") && m.contains(TAILSCALE_DNS_ADMIN), "{m}");
        assert!(tailscale_candidates().iter().any(|p| p.ends_with("Tailscale.app/Contents/MacOS/Tailscale")));
    }

    #[test]
    fn ips_e_serve() {
        let ips = parse_ips("100.101.102.103\nfd7a:115c:a1e0::abcd\n192.168.1.2\nlixo\n");
        assert_eq!(ips.len(), 2);
        assert!(serve_points_to(r#"{"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:7777"}}}}}"#, 7777));
        assert!(!serve_points_to("{}", 7777));
        assert!(serve_uses_443(r#"{"TCP":{"443":{"HTTPS":true}},"Web":{"mac.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3000"}}}}}"#));
        assert!(!serve_uses_443("{}") && !serve_uses_443("lixo"));
        assert_eq!(listen_addrs(&LocalOnly, 7777), vec!["127.0.0.1:7777".parse::<SocketAddr>().unwrap()]);
    }
}
