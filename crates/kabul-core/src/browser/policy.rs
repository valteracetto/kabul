//! Segurança do navegador: o que um agente pode fazer sem perguntar e a fila de aprovações.
//!
//! Política (Configurações › Navegador, `browser_policy`):
//! - `ask`: toda navegação (fora de `about:blank`) e todo `evaluate` pedem aprovação;
//! - `localhost` (padrão): localhost e os domínios do projeto passam; o resto e o `evaluate` pedem;
//! - `all`: nada pede.
//!
//! Domínios do projeto: `browser_hosts` das configurações do repo (`.kabul/settings.toml`) e os que o
//! usuário liberou com "sempre" neste workspace (`hosts.json`).
//!
//! A fila é de arquivos (`approvals/<id>.json` e `<id>.decision`): o servidor MCP roda dentro do
//! processo de cada agente e o app (ou o kabuld) responde pela aba Browser.
use super::Dirs;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Ask,
    Localhost,
    All,
}

impl Mode {
    pub fn parse(s: &str) -> Self {
        match s {
            "ask" => Mode::Ask,
            "all" => Mode::All,
            _ => Mode::Localhost,
        }
    }
}

/// Host da URL (sem porta, minúsculo). `None` para esquemas sem host (`about:`, `data:`).
pub fn host_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https" | "ws" | "wss") {
        return None;
    }
    let auth = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = auth.rsplit('@').next().unwrap_or(auth);
    let host = if let Some(h) = hostport.strip_prefix('[') { h.split(']').next().unwrap_or("").to_string() } else { hostport.split(':').next().unwrap_or("").to_string() };
    Some(host.to_ascii_lowercase()).filter(|h| !h.is_empty())
}

pub fn is_local_host(h: &str) -> bool {
    h == "localhost" || h.ends_with(".localhost") || h == "127.0.0.1" || h.starts_with("127.") || h == "::1" || h == "0.0.0.0"
}

/// Casa `host` com um padrão (`exemplo.com` vale para subdomínios; `*.exemplo.com` só para eles).
pub fn host_matches(host: &str, pat: &str) -> bool {
    let p = pat.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/').to_ascii_lowercase();
    if p.is_empty() {
        return false;
    }
    match p.strip_prefix("*.") {
        Some(base) => host.ends_with(&format!(".{base}")),
        None => host == p || host.ends_with(&format!(".{p}")),
    }
}

/// Precisa perguntar antes de navegar para `url`?
pub fn needs_approval(mode: Mode, url: &str, allowed: &[String]) -> bool {
    let u = url.trim();
    if u.is_empty() || u == "about:blank" {
        return false;
    }
    match mode {
        Mode::All => false,
        Mode::Ask => true,
        Mode::Localhost => match host_of(u) {
            Some(h) => !(is_local_host(&h) || allowed.iter().any(|p| host_matches(&h, p))),
            // file:, data:, javascript:, chrome:… sempre perguntam.
            None => true,
        },
    }
}

/// Precisa perguntar antes de `evaluate`?
pub fn evaluate_needs_approval(mode: Mode) -> bool {
    mode != Mode::All
}

/// Domínios liberados com "sempre" neste workspace.
pub fn remembered(d: &Dirs) -> Vec<String> {
    std::fs::read(d.file("hosts.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn remember(d: &Dirs, host: &str) -> Result<()> {
    let mut v = remembered(d);
    if !v.iter().any(|h| h == host) {
        v.push(host.to_string());
    }
    super::write_atomic(&d.file("hosts.json"), &serde_json::to_vec(&v)?)
}

/// Pedido de aprovação na fila.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Request {
    pub id: String,
    /// navigate | evaluate
    pub kind: String,
    /// URL ou o código (cortado).
    pub detail: String,
    pub agent: String,
    pub at: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Decision {
    pub allow: bool,
    #[serde(default)]
    pub always: bool,
}

/// Pedidos esperando resposta (os de processos que já desistiram somem com o arquivo).
pub fn pending(d: &Dirs) -> Vec<Request> {
    let mut v: Vec<Request> = std::fs::read_dir(d.approvals())
        .map(|it| {
            it.flatten().filter(|e| e.path().extension().is_some_and(|x| x == "json")).filter(|e| !e.path().with_extension("decision").exists()).filter_map(|e| std::fs::read(e.path()).ok().and_then(|b| serde_json::from_slice(&b).ok())).collect()
        })
        .unwrap_or_default();
    v.sort_by_key(|r: &Request| r.at);
    v
}

/// Responde um pedido (app/kabuld). "Sempre" numa navegação libera o domínio neste workspace.
pub fn decide(d: &Dirs, id: &str, dec: Decision) -> Result<()> {
    let clean: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let req: Option<Request> = std::fs::read(d.approvals().join(format!("{clean}.json"))).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let Some(req) = req else { anyhow::bail!("pedido de aprovação não encontrado (expirou?)") };
    if dec.allow && dec.always && req.kind == "navigate" {
        if let Some(h) = host_of(&req.detail) {
            remember(d, &h)?;
        }
    }
    super::write_atomic(&d.approvals().join(format!("{clean}.decision")), &serde_json::to_vec(&dec)?)
}

/// Pede e espera a resposta (até `timeout`; sem resposta = negado). Devolve a decisão.
pub fn ask(d: &Dirs, kind: &str, detail: &str, agent: &str, timeout: Duration) -> Decision {
    let id = format!("{}-{}", super::now_ms(), std::process::id());
    let dir = d.approvals();
    let _ = std::fs::create_dir_all(&dir);
    let req = Request { id: id.clone(), kind: kind.into(), detail: detail.chars().take(2000).collect(), agent: agent.into(), at: super::now_ms() };
    let f = dir.join(format!("{id}.json"));
    let dec_f = dir.join(format!("{id}.decision"));
    if super::write_atomic(&f, &serde_json::to_vec(&req).unwrap_or_default()).is_err() {
        return Decision { allow: false, always: false };
    }
    let t0 = std::time::Instant::now();
    let out = loop {
        if let Some(dec) = read_decision(&dec_f) {
            break dec;
        }
        if t0.elapsed() > timeout {
            break Decision { allow: false, always: false };
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let _ = std::fs::remove_file(&f);
    let _ = std::fs::remove_file(&dec_f);
    out
}

fn read_decision(p: &Path) -> Option<Decision> {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_e_politica() {
        assert_eq!(host_of("http://localhost:5173/x").as_deref(), Some("localhost"));
        assert_eq!(host_of("https://user:pw@App.Example.com:8443/a?b").as_deref(), Some("app.example.com"));
        assert_eq!(host_of("http://[::1]:3000/").as_deref(), Some("::1"));
        assert_eq!(host_of("about:blank"), None);
        assert!(host_matches("api.exemplo.com", "exemplo.com") && host_matches("exemplo.com", "https://exemplo.com/"));
        assert!(!host_matches("exemplo.com", "*.exemplo.com") && !host_matches("malexemplo.com", "exemplo.com"));
        let allowed = vec!["staging.exemplo.com".to_string()];
        assert!(!needs_approval(Mode::Localhost, "http://127.0.0.1:8080", &allowed));
        assert!(!needs_approval(Mode::Localhost, "http://app.localhost:3000/", &allowed));
        assert!(!needs_approval(Mode::Localhost, "https://staging.exemplo.com/login", &allowed));
        assert!(needs_approval(Mode::Localhost, "https://example.org", &allowed));
        assert!(needs_approval(Mode::Localhost, "file:///etc/passwd", &allowed));
        assert!(needs_approval(Mode::Localhost, "javascript:alert(1)", &allowed));
        assert!(needs_approval(Mode::Ask, "http://localhost:3000", &allowed));
        assert!(!needs_approval(Mode::Ask, "about:blank", &allowed));
        assert!(!needs_approval(Mode::All, "https://example.org", &[]));
        assert!(evaluate_needs_approval(Mode::Localhost) && !evaluate_needs_approval(Mode::All));
    }

    #[test]
    fn fila_de_aprovacao_entre_processos() {
        let h = std::env::temp_dir().join(format!("kabul-browser-pol-{}", std::process::id()));
        let d = Dirs::new(&h, "w");
        let d2 = d.clone();
        let t = std::thread::spawn(move || ask(&d2, "navigate", "https://example.org/x", "codex", Duration::from_secs(10)));
        let req = loop {
            if let Some(r) = pending(&d).pop() {
                break r;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        assert_eq!((req.kind.as_str(), req.agent.as_str()), ("navigate", "codex"));
        decide(&d, &req.id, Decision { allow: true, always: true }).unwrap();
        assert!(t.join().unwrap().allow);
        assert_eq!(remembered(&d), vec!["example.org".to_string()]);
        assert!(pending(&d).is_empty());
        // Sem resposta: negado.
        assert!(!ask(&d, "evaluate", "1+1", "x", Duration::from_millis(300)).allow);
        assert!(decide(&d, "nao-existe", Decision { allow: true, always: false }).is_err());
        std::fs::remove_dir_all(&h).ok();
    }
}
