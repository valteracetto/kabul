//! Status e login dos agentes usando o fluxo do próprio CLI, rodando num PTY.
//!
//! - Antigravity: não há subcomando `login`; qualquer `agy -p` sem token imprime a URL
//!   `https://accounts.google.com/o/oauth2/auth?...` e pede o código colado. O status é só a
//!   EXISTÊNCIA de `~/.gemini/antigravity-cli/antigravity-oauth-token` (o conteúdo nunca é lido).
//! - Claude: `claude auth login` / `claude auth status --json` (só `loggedIn` e `authMethod`).
//! - Codex: `codex login` / existência de `~/.codex/auth.json` (a confirmar: binário quebrado aqui).
use crate::harness::{find_urls, strip_ansi, HarnessKind};
use anyhow::{anyhow, Context, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc::{channel, Receiver};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AuthStatus {
    pub logged_in: bool,
    /// Como foi verificado (arquivo, comando).
    pub source: String,
    pub method: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum AuthEvent {
    Url(String),
    /// Código de uso único para colar no navegador (ex.: `gh auth login --web`).
    Codigo(String),
    PedeCodigo,
    Ok,
    Erro(String),
    /// O CLI desistiu de esperar (ex.: agy encerra após 60 s): a UI reinicia o fluxo com link novo.
    Expirou,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

pub fn agy_token_path() -> PathBuf {
    home().join(".gemini/antigravity-cli/antigravity-oauth-token")
}

pub fn codex_auth_path() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex")).join("auth.json")
}

/// Lê só `loggedIn`/`authMethod` de `claude auth status --json`.
pub fn parse_claude_status(json: &str) -> Option<AuthStatus> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(AuthStatus {
        logged_in: v.get("loggedIn")?.as_bool()?,
        source: "claude auth status".into(),
        method: v.get("authMethod").and_then(|m| m.as_str()).map(String::from),
    })
}

pub fn status(kind: HarnessKind) -> Result<AuthStatus> {
    match kind {
        HarnessKind::Antigravity => {
            let p = agy_token_path();
            // metadata apenas: nunca abre o arquivo.
            Ok(AuthStatus { logged_in: std::fs::metadata(&p).map(|m| m.is_file()).unwrap_or(false), source: p.display().to_string(), method: Some("oauth-google".into()) })
        }
        HarnessKind::Codex => {
            let p = codex_auth_path();
            Ok(AuthStatus { logged_in: std::fs::metadata(&p).map(|m| m.is_file()).unwrap_or(false), source: p.display().to_string(), method: None })
        }
        HarnessKind::OpenCode | HarnessKind::QwenCode | HarnessKind::GeminiCli | HarnessKind::Goose | HarnessKind::Cursor => Ok(AuthStatus { logged_in: kind.installed(), source: if kind.installed() { "instalado (credenciais do próprio CLI)".into() } else { "não instalado".into() }, method: None }),
        HarnessKind::Claude => {
            let o = Command::new("claude").args(["auth", "status", "--json"]).output().context("claude auth status")?;
            parse_claude_status(&String::from_utf8_lossy(&o.stdout)).ok_or_else(|| anyhow!("saída inesperada de claude auth status"))
        }
    }
}

/// Comando que dispara o login de cada CLI.
pub fn login_command(kind: HarnessKind) -> Vec<&'static str> {
    match kind {
        HarnessKind::Claude => vec!["claude", "auth", "login"],
        HarnessKind::Codex => vec!["codex", "login"],
        HarnessKind::OpenCode => vec!["opencode", "auth", "login"],
        HarnessKind::QwenCode => vec!["qwen", "--auth"],
        HarnessKind::GeminiCli => vec!["gemini"],
        // A confirmar: `goose configure` e `cursor-agent login`.
        HarnessKind::Goose => vec!["goose", "configure"],
        HarnessKind::Cursor => vec!["cursor-agent", "login"],
        // Sem subcomando de login: um print curto em modo plan dispara o OAuth se faltar token.
        HarnessKind::Antigravity => vec!["agy", "--mode", "plan", "-p=responda apenas ok"],
    }
}

/// Parser incremental da saída do login (alimentado em pedaços vindos do PTY).
#[derive(Default)]
pub struct LoginParser {
    buf: String,
    seen_urls: Vec<String>,
    asked: bool,
    done: bool,
    code: bool,
}

impl LoginParser {
    pub fn feed(&mut self, chunk: &str) -> Vec<AuthEvent> {
        self.buf.push_str(chunk);
        let clean = strip_ansi(&self.buf);
        let mut out = vec![];
        // Só considera URLs em linhas completas (a URL pode chegar cortada).
        let complete = match clean.rfind(['\n', '\r']) {
            Some(i) => &clean[..i],
            None => "",
        };
        for u in find_urls(complete) {
            let auth = ["accounts.google.com", "claude.ai/oauth", "console.anthropic.com/oauth", "auth.openai.com", "/oauth", "/device"].iter().any(|h| u.contains(h));
            if auth && !self.seen_urls.contains(&u) {
                self.seen_urls.push(u.clone());
                out.push(AuthEvent::Url(u));
            }
        }
        let low = clean.to_lowercase();
        if !self.code {
            if let Some(c) = clean.lines().find_map(|l| l.split_once("one-time code:").map(|(_, c)| c.trim().to_string())).filter(|c| c.len() >= 8 && c.contains('-')) {
                self.code = true;
                out.push(AuthEvent::Codigo(c));
            }
        }
        if !self.asked && (low.contains("paste") && low.contains("code") || low.contains("cole o código")) {
            self.asked = true;
            out.push(AuthEvent::PedeCodigo);
        }
        if !self.done {
            let tail = low.rsplit("paste").next().unwrap_or(&low);
            if ["login successful", "successfully logged in", "logged in as", "authentication successful", "authenticated successfully"].iter().any(|p| tail.contains(p)) {
                self.done = true;
                out.push(AuthEvent::Ok);
            } else if let Some(l) = tail.lines().find(|l| ["invalid code", "authentication failed", "login failed", "timed out", "error:"].iter().any(|p| l.contains(p))) {
                self.done = true;
                // "authentication timed out" (sem "failed") é tempo esgotado, não erro do código.
                out.push(if l.contains("timed out") && !l.contains("failed") { AuthEvent::Expirou } else { AuthEvent::Erro(l.trim().to_string()) });
            }
        }
        // Evita crescer sem limite: mantém o fim.
        if self.buf.len() > 64 * 1024 {
            let cut = self.buf.len() - 16 * 1024;
            let cut = (cut..self.buf.len()).find(|i| self.buf.is_char_boundary(*i)).unwrap_or(cut);
            self.buf.drain(..cut);
        }
        out
    }
    pub fn finished(&self) -> bool {
        self.done
    }
}

/// Login em andamento: eventos no canal; código colado via [`LoginSession::enviar_codigo`].
pub struct LoginSession {
    pub events: Receiver<AuthEvent>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Fim de linha do código colado: `\n` para quem lê linha (agy), `\r` para TUIs em modo raw.
    enter: &'static [u8],
}

/// Como confirmar que o login terminou quando o CLI não diz (ex.: agy segue rodando o prompt).
pub struct LoginCheck {
    pub done: std::sync::Arc<dyn Fn() -> bool + Send + Sync>,
    /// Confere a cada 500 ms enquanto o CLI roda (só para checagens baratas, como existência de arquivo).
    pub poll: bool,
}

impl LoginCheck {
    /// Status padrão do agente (arquivo de credencial ou comando de status).
    pub fn status(kind: HarnessKind) -> Self {
        Self { done: std::sync::Arc::new(move || status(kind).map(|s| s.logged_in).unwrap_or(false)), poll: kind == HarnessKind::Antigravity }
    }
    /// Existência de um arquivo (nunca lido).
    pub fn file(path: PathBuf) -> Self {
        Self { done: std::sync::Arc::new(move || std::fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false)), poll: true }
    }
}

impl LoginSession {
    pub fn enviar_codigo(&mut self, code: &str) -> Result<()> {
        self.writer.write_all(code.trim().as_bytes())?;
        self.writer.write_all(self.enter)?;
        self.writer.flush()?;
        Ok(())
    }
    pub fn cancelar(&mut self) -> Result<()> {
        self.child.kill().context("kill")
    }
}

/// Inicia o login do CLI num PTY. Não abre navegador (BROWSER=true): o app mostra a URL.
pub fn login(kind: HarnessKind) -> Result<LoginSession> {
    let argv = login_command(kind);
    login_argv(&argv, b"", &[], LoginCheck::status(kind))
}

/// Login de qualquer CLI num PTY. `kick` é escrito logo após iniciar (ex.: Enter para o `gh`).
/// `check` confirma o sucesso quando o CLI não imprime "logado" (e, com `poll`, antes de ele sair).
pub fn login_argv(argv: &[&str], kick: &[u8], env: &[(String, String)], check: LoginCheck) -> Result<LoginSession> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    let pty = native_pty_system().openpty(PtySize { rows: 40, cols: 4000, pixel_width: 0, pixel_height: 0 })?;
    // Caminho completo (o app aberto pelo Finder pode não ter ~/.local/bin no PATH).
    let program = crate::harness::which(argv[0]).map(|p| p.display().to_string()).unwrap_or_else(|| argv[0].to_string());
    let mut cmd = CommandBuilder::new(program);
    cmd.args(&argv[1..]);
    cmd.env("BROWSER", "true");
    for (k, v) in env {
        cmd.env(k, v);
    }
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    let mut child = pty.slave.spawn_command(cmd).context("spawn no PTY")?;
    drop(pty.slave);
    let mut reader = pty.master.try_clone_reader()?;
    let mut writer = pty.master.take_writer()?;
    if !kick.is_empty() {
        let k = kick.to_vec();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let _ = writer.write_all(&k);
        let _ = writer.flush();
    }
    let (tx, rx) = channel();
    let finished = Arc::new(AtomicBool::new(false));
    let LoginCheck { done, poll } = check;
    if poll {
        // Credencial apareceu: login concluído, mesmo com o CLI ainda rodando o prompt.
        let (tx, finished, done, mut killer) = (tx.clone(), finished.clone(), done.clone(), child.clone_killer());
        std::thread::spawn(move || {
            while !finished.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if done() && !finished.swap(true, Ordering::SeqCst) {
                    let _ = tx.send(AuthEvent::Ok);
                    let _ = killer.kill();
                }
            }
        });
    }
    let mut killer = child.clone_killer();
    std::thread::spawn(move || {
        let _master = pty.master; // mantém o PTY vivo
        let mut p = LoginParser::default();
        let mut b = [0u8; 4096];
        loop {
            match reader.read(&mut b) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if finished.load(Ordering::SeqCst) {
                        continue;
                    }
                    for e in p.feed(&String::from_utf8_lossy(&b[..n])) {
                        // Erro/expirou do CLI, mas a credencial existe: vale o sucesso.
                        let e = match e {
                            AuthEvent::Erro(_) | AuthEvent::Expirou if done() => AuthEvent::Ok,
                            e => e,
                        };
                        let last = matches!(e, AuthEvent::Ok | AuthEvent::Erro(_) | AuthEvent::Expirou);
                        if last && finished.swap(true, Ordering::SeqCst) {
                            continue;
                        }
                        if tx.send(e).is_err() {
                            let _ = killer.kill();
                            return;
                        }
                    }
                }
            }
        }
        if !finished.swap(true, Ordering::SeqCst) {
            let _ = tx.send(if done() { AuthEvent::Ok } else { AuthEvent::Erro("processo de login terminou sem confirmar".into()) });
        }
    });
    let _ = &mut child;
    let enter: &'static [u8] = if argv[0] == "agy" { b"\n" } else { b"\r" };
    Ok(LoginSession { events: rx, writer, child, enter })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_all(p: &mut LoginParser, s: &str, step: usize) -> Vec<AuthEvent> {
        let chars: Vec<char> = s.chars().collect();
        chars.chunks(step).flat_map(|c| p.feed(&c.iter().collect::<String>())).collect()
    }

    #[test]
    fn agy_login_em_pedacos() {
        let mut p = LoginParser::default();
        let ev = feed_all(&mut p, include_str!("../tests/fixtures/agy_login.txt"), 37);
        assert_eq!(ev.len(), 2, "{ev:?}");
        assert!(matches!(&ev[0], AuthEvent::Url(u) if u.starts_with("https://accounts.google.com/o/oauth2/auth?") && u.ends_with("state=xyz")));
        assert_eq!(ev[1], AuthEvent::PedeCodigo);
        assert_eq!(p.feed("\r\nLogin successful\r\n"), vec![AuthEvent::Ok]);
        // 60 s sem código: expira (a UI reinicia); código errado é erro.
        let mut p = LoginParser::default();
        feed_all(&mut p, include_str!("../tests/fixtures/agy_login.txt"), 50);
        assert_eq!(p.feed("Error: authentication timed out.\r\nerror: authentication failed or timed out\r\n"), vec![AuthEvent::Expirou]);
        let mut p = LoginParser::default();
        feed_all(&mut p, include_str!("../tests/fixtures/agy_login.txt"), 50);
        let ev = p.feed("4/0ABC\r\nError: authentication failed: token exchange failed: oauth2: \"invalid_grant\"\r\nerror: authentication failed or timed out\r\n");
        assert!(matches!(&ev[..], [AuthEvent::Erro(m)] if m.contains("invalid_grant")), "{ev:?}");
    }

    #[test]
    fn claude_login_com_ansi() {
        let mut p = LoginParser::default();
        let ev = feed_all(&mut p, include_str!("../tests/fixtures/claude_login.txt"), 11);
        assert!(matches!(&ev[0], AuthEvent::Url(u) if u.starts_with("https://claude.ai/oauth/authorize?") && u.ends_with("state=s1")));
        assert!(ev.contains(&AuthEvent::PedeCodigo));
        assert!(matches!(&p.feed("\r\nOAuth error: invalid code\r\n")[0], AuthEvent::Erro(_)));
    }

    #[test]
    fn codex_login_sem_pedido_de_codigo() {
        let mut p = LoginParser::default();
        let ev = p.feed(include_str!("../tests/fixtures/codex_login.txt"));
        assert_eq!(ev.len(), 1, "localhost não é URL de auth: {ev:?}");
        assert!(matches!(&ev[0], AuthEvent::Url(u) if u.contains("auth.openai.com")));
        assert_eq!(p.feed("Successfully logged in\n"), vec![AuthEvent::Ok]);
    }

    #[test]
    fn gh_codigo_do_dispositivo() {
        let mut p = LoginParser::default();
        let ev = p.feed("! First copy your one-time code: ABCD-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n");
        assert!(ev.contains(&AuthEvent::Codigo("ABCD-1234".into())));
        assert!(ev.iter().any(|e| matches!(e, AuthEvent::Url(u) if u.ends_with("/login/device"))));
        assert_eq!(p.feed("✓ Logged in as dev\n"), vec![AuthEvent::Ok]);
    }

    #[test]
    fn status_claude() {
        let s = parse_claude_status(r#"{"loggedIn":true,"authMethod":"claude.ai","email":"x@y"}"#).unwrap();
        assert!(s.logged_in);
        assert_eq!(s.method.as_deref(), Some("claude.ai"));
        assert!(parse_claude_status("lixo").is_none());
    }

    /// agy real com HOME temporário: link, pedido de código e código inválido (sem concluir login).
    /// `KABUL_TESTE_AGY_LOGIN=1 cargo test -p kabul-core agy_login_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn agy_login_real() {
        if std::env::var("KABUL_TESTE_AGY_LOGIN").is_err() || crate::harness::which("agy").is_none() {
            return;
        }
        let home = std::env::temp_dir().join(format!("kabul-agy-login-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let tok = home.join(".gemini/antigravity-cli/antigravity-oauth-token");
        let env = vec![("HOME".to_string(), home.display().to_string())];
        let recv = |s: &LoginSession, secs| s.events.recv_timeout(std::time::Duration::from_secs(secs)).unwrap();
        let mut s = login_argv(&login_command(HarnessKind::Antigravity), b"", &env, LoginCheck::file(tok.clone())).unwrap();
        assert!(matches!(recv(&s, 30), AuthEvent::Url(u) if u.starts_with("https://accounts.google.com/")));
        assert_eq!(recv(&s, 10), AuthEvent::PedeCodigo);
        s.enviar_codigo("4/0AFAKE-codigo-de-teste").unwrap();
        assert!(matches!(recv(&s, 30), AuthEvent::Erro(m) if m.contains("authentication failed")));
        // Sem código: expira em 60 s.
        let s = login_argv(&login_command(HarnessKind::Antigravity), b"", &env, LoginCheck::file(tok.clone())).unwrap();
        assert!(matches!(recv(&s, 30), AuthEvent::Url(_)));
        assert_eq!(recv(&s, 10), AuthEvent::PedeCodigo);
        assert_eq!(recv(&s, 90), AuthEvent::Expirou);
        assert!(!tok.exists());
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn comandos_login() {
        assert_eq!(login_command(HarnessKind::Claude), vec!["claude", "auth", "login"]);
        assert!(login_command(HarnessKind::Antigravity)[3].starts_with("-p="));
    }
}
