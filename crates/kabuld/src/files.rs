//! Base segura para o preview de arquivos no celular (árvore, código, Markdown, imagem, PDF, vídeo,
//! CSV/JSON, SVG) e para o proxy da porta do Run.
//!
//! - **Leitura só dentro do workspace**: caminho relativo sem `..` ([`kabul_core::gitops::safe_rel`]),
//!   `canonicalize` do resultado (um link simbólico para fora cai fora do prefixo e é recusado), nada
//!   de `.git/` (o `config` pode ter token no remote). Convidados também não leem arquivos de segredo
//!   (`.env*`, `.npmrc`, chaves).
//! - **Ingresso por arquivo**: o WebSocket autenticado emite (`file_url`) uma URL `/api/file?t=…` de
//!   5 minutos, presa à pessoa, ao workspace e ao caminho. `<img>`/`<video>` não mandam cabeçalho de
//!   autenticação; a URL serve para isso. A cada pedido o kabuld confere de novo se a credencial
//!   vale e refaz a resolução do caminho.
//! - **Nunca executa conteúdo do repositório no origin do kabuld**: HTML e afins saem como
//!   `text/plain`; SVG, imagens e vídeo saem com `Content-Security-Policy: sandbox` (origem opaca, sem
//!   script) e `nosniff`; tipo desconhecido vai como download.
//! - **Limites**: até [`MAX_CHUNK`] por resposta, `Range` para vídeo e paginação de texto.
//! - **Proxy**: só as portas do próprio workspace ([`port_allowed`]), sempre em 127.0.0.1.
use anyhow::{bail, Context, Result};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// Maior resposta (arquivo inteiro ou um pedaço com `Range`).
pub const MAX_CHUNK: u64 = 16 << 20;
/// Validade do ingresso de um arquivo.
pub const TICKET_TTL: u64 = 5 * 60;
/// Cada workspace recebe 10 portas a partir de `port` (ver `Store::free_port`).
pub const PORTS_PER_WORKSPACE: u16 = 10;
/// Itens na árvore de arquivos.
pub const MAX_LIST: usize = 20_000;

/// CSP das respostas de arquivo: documento sem script, sem rede e em origem opaca (`sandbox`).
pub const FILE_CSP: &str = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

/// Nomes que convidados não leem (segredos comuns copiados para o worktree).
pub fn is_secret_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with(".env")
        || matches!(n.as_str(), ".npmrc" | ".netrc" | ".pypirc" | ".pgpass" | "credentials" | "credentials.json")
        || n.starts_with("id_rsa")
        || n.starts_with("id_ed25519")
        || n.starts_with("id_ecdsa")
        || [".pem", ".key", ".p12", ".pfx", ".keystore"].iter().any(|e| n.ends_with(e))
}

/// Caminho relativo permitido (antes de tocar no disco).
pub fn check_rel(rel: &str, guest: bool) -> Result<()> {
    kabul_core::gitops::safe_rel(rel)?;
    for c in Path::new(rel).components() {
        if let Component::Normal(n) = c {
            let n = n.to_string_lossy();
            if n == ".git" {
                bail!("arquivos do .git não são servidos");
            }
            if guest && is_secret_name(&n) {
                bail!("arquivo de segredo: só o dono vê");
            }
        }
    }
    Ok(())
}

/// Resolve `rel` dentro de `root` e devolve o caminho real de um arquivo comum.
pub fn resolve(root: &Path, rel: &str, guest: bool) -> Result<PathBuf> {
    check_rel(rel, guest)?;
    let base = std::fs::canonicalize(root).context("workspace sem pasta")?;
    let real = std::fs::canonicalize(base.join(rel)).with_context(|| format!("{rel} não existe"))?;
    if !real.starts_with(&base) {
        bail!("caminho fora do workspace (link simbólico?)");
    }
    // O destino real também não pode ser .git nem segredo (link interno para `.env`, por exemplo).
    check_rel(&real.strip_prefix(&base).unwrap_or(&real).to_string_lossy(), guest)?;
    if !real.is_file() {
        bail!("{rel} não é um arquivo");
    }
    Ok(real)
}

/// Como o arquivo sai: tipo e se é anexo (download) em vez de exibido.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kind {
    pub mime: &'static str,
    pub attachment: bool,
}

pub fn kind(path: &Path) -> Kind {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let inline = |mime| Kind { mime, attachment: false };
    match ext.as_str() {
        "png" => inline("image/png"),
        "jpg" | "jpeg" => inline("image/jpeg"),
        "gif" => inline("image/gif"),
        "webp" => inline("image/webp"),
        "avif" => inline("image/avif"),
        "ico" => inline("image/x-icon"),
        "bmp" => inline("image/bmp"),
        // SVG pode ter <script>: com a CSP `sandbox` e sem script-src ele só desenha.
        "svg" => inline("image/svg+xml"),
        "pdf" => inline("application/pdf"),
        "mp4" | "m4v" => inline("video/mp4"),
        "webm" => inline("video/webm"),
        "mov" => inline("video/quicktime"),
        "mp3" => inline("audio/mpeg"),
        "wav" => inline("audio/wav"),
        "ogg" | "oga" => inline("audio/ogg"),
        "m4a" => inline("audio/mp4"),
        "json" => inline("application/json"),
        "csv" => inline("text/csv; charset=utf-8"),
        // HTML, XML, JS e qualquer texto: como texto puro (o navegador não interpreta).
        _ if is_text_ext(&ext) => inline("text/plain; charset=utf-8"),
        _ => Kind { mime: "application/octet-stream", attachment: true },
    }
}

fn is_text_ext(ext: &str) -> bool {
    const T: &[&str] = &[
        "",
        "txt",
        "md",
        "markdown",
        "mdx",
        "rst",
        "html",
        "htm",
        "xhtml",
        "xml",
        "js",
        "mjs",
        "cjs",
        "jsx",
        "ts",
        "tsx",
        "css",
        "scss",
        "less",
        "rs",
        "go",
        "py",
        "rb",
        "java",
        "kt",
        "swift",
        "c",
        "h",
        "cc",
        "cpp",
        "hpp",
        "cs",
        "php",
        "sh",
        "bash",
        "zsh",
        "fish",
        "toml",
        "yaml",
        "yml",
        "ini",
        "cfg",
        "conf",
        "lock",
        "log",
        "sql",
        "graphql",
        "proto",
        "vue",
        "svelte",
        "astro",
        "lua",
        "dart",
        "ex",
        "exs",
        "erl",
        "hs",
        "ml",
        "scala",
        "clj",
        "r",
        "jl",
        "tf",
        "gradle",
        "properties",
        "gitignore",
        "dockerfile",
        "makefile",
        "env",
        "tsv",
    ];
    T.contains(&ext)
}

/// `Range: bytes=a-b` (um intervalo só) → `[início, fim]` inclusivos, limitado a [`MAX_CHUNK`].
pub fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || len == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => (s.parse().ok()?, len - 1),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end.min(start + MAX_CHUNK - 1)))
}

/// Porta que o proxy do Run pode abrir para este workspace.
pub fn port_allowed(ws_port: u16, port: u16) -> bool {
    ws_port != 0 && port >= ws_port && port < ws_port.saturating_add(PORTS_PER_WORKSPACE)
}

/// Destino do proxy: só no loopback e só porta do workspace.
pub fn proxy_target(ws_port: u16, port: u16) -> Result<SocketAddr> {
    if !port_allowed(ws_port, port) {
        bail!("porta {port} não é deste workspace");
    }
    Ok(SocketAddr::new(Ipv4Addr::LOCALHOST.into(), port))
}

#[derive(Debug, Clone)]
pub struct FileTicket {
    pub principal: String,
    pub workspace: String,
    pub rel: String,
    pub guest: bool,
    pub expires_at: u64,
}

/// Ingressos de arquivo em memória (somem ao reiniciar).
#[derive(Default)]
pub struct FileTickets(Mutex<HashMap<String, FileTicket>>);

impl FileTickets {
    pub fn issue(&self, principal: &str, workspace: &str, rel: &str, guest: bool) -> (String, u64) {
        let t = crate::auth::now();
        let mut m = self.0.lock().unwrap();
        m.retain(|_, x| x.expires_at > t);
        if m.len() >= 2000 {
            if let Some(k) = m.iter().min_by_key(|(_, x)| x.expires_at).map(|(k, _)| k.clone()) {
                m.remove(&k);
            }
        }
        let token = crate::auth::random_token(24);
        let expires_at = t + TICKET_TTL;
        m.insert(token.clone(), FileTicket { principal: principal.into(), workspace: workspace.into(), rel: rel.into(), guest, expires_at });
        (token, expires_at)
    }
    pub fn get(&self, token: &str) -> Option<FileTicket> {
        let t = crate::auth::now();
        self.0.lock().unwrap().get(token).filter(|x| x.expires_at > t).cloned()
    }
    pub fn revoke_principal(&self, id: &str) {
        self.0.lock().unwrap().retain(|_, x| x.principal != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("kabuld-files-{}-{}", std::process::id(), crate::auth::random_token(4)));
        let root = dir.join("ws");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        std::fs::write(root.join(".env.local"), "TOKEN=x").unwrap();
        std::fs::write(root.join(".git/config"), "[remote] url=https://token@x").unwrap();
        std::fs::write(dir.join("fora.txt"), "segredo de fora").unwrap();
        (dir, root)
    }

    #[test]
    fn so_dentro_do_workspace() {
        let (dir, root) = ws();
        assert!(resolve(&root, "src/main.rs", true).is_ok());
        assert!(resolve(&root, "./src/main.rs", true).is_ok());
        for bad in ["../fora.txt", "src/../../fora.txt", "/etc/passwd", "", "-x", "src", ".git/config", "src/.git/x"] {
            assert!(resolve(&root, bad, false).is_err(), "{bad}");
        }
        // Link simbólico para fora do workspace (ou para o .git / segredo) é recusado.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("fora.txt"), root.join("link-fora")).unwrap();
            std::os::unix::fs::symlink(root.join(".git/config"), root.join("link-git")).unwrap();
            std::os::unix::fs::symlink(root.join(".env.local"), root.join("leia-me.txt")).unwrap();
            assert!(resolve(&root, "link-fora", false).is_err());
            assert!(resolve(&root, "link-git", false).is_err());
            assert!(resolve(&root, "leia-me.txt", true).is_err(), "convidado via link para .env");
            assert!(resolve(&root, "leia-me.txt", false).is_ok(), "dono vê");
        }
        // Segredos: o dono vê, o convidado não.
        assert!(resolve(&root, ".env.local", false).is_ok());
        assert!(resolve(&root, ".env.local", true).is_err());
        for s in [".env", ".npmrc", "id_rsa", "server.pem", "tls.key"] {
            assert!(is_secret_name(s), "{s}");
        }
        assert!(!is_secret_name("environment.md"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn conteudo_do_repo_nao_executa() {
        for f in ["index.html", "a.htm", "x.xhtml", "app.js", "README.md", "Makefile"] {
            assert_eq!(kind(Path::new(f)).mime, "text/plain; charset=utf-8", "{f}");
        }
        assert_eq!(kind(Path::new("logo.svg")).mime, "image/svg+xml");
        assert_eq!(kind(Path::new("v.mp4")).mime, "video/mp4");
        assert_eq!(kind(Path::new("a.pdf")).mime, "application/pdf");
        assert_eq!(kind(Path::new("dados.csv")).mime, "text/csv; charset=utf-8");
        assert_eq!(kind(Path::new("bin.exe")), Kind { mime: "application/octet-stream", attachment: true });
        assert!(FILE_CSP.contains("sandbox") && FILE_CSP.contains("default-src 'none'"));
    }

    #[test]
    fn faixas_e_portas() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-", 100 << 20), Some((0, MAX_CHUNK - 1)), "pedaço limitado");
        for bad in ["bytes=1000-", "bytes=5-1", "items=0-1", "bytes=0-1,4-5", "bytes=a-b"] {
            assert_eq!(parse_range(bad, 1000), None, "{bad}");
        }
        assert!(port_allowed(41000, 41000) && port_allowed(41000, 41009));
        assert!(!port_allowed(41000, 41010) && !port_allowed(41000, 40999) && !port_allowed(0, 0) && !port_allowed(41000, 22));
        assert_eq!(proxy_target(41000, 41003).unwrap(), "127.0.0.1:41003".parse().unwrap());
        assert!(proxy_target(41000, 5432).is_err());
    }

    #[test]
    fn ingresso_expira_e_cai_com_a_pessoa() {
        let t = FileTickets::default();
        let (tok, _) = t.issue("d1", "w1", "a.txt", true);
        assert_eq!(t.get(&tok).unwrap().rel, "a.txt");
        assert!(t.get("outro").is_none());
        t.revoke_principal("d1");
        assert!(t.get(&tok).is_none());
    }
}
