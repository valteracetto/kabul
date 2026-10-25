//! Terminais por trás de uma trait: tmux no macOS/Linux e um multiplexador próprio sobre PTY (ConPTY no
//! Windows, via `portable-pty`) onde não há tmux. Todo o Kabul (app, kabuld, CLI) passa por aqui.
//!
//! Escolha do backend: `KABUL_TERMINAL=tmux|pty` (o app aplica o `terminal_backend` das configurações a
//! essa variável antes do primeiro uso); sem ela, PTY no Windows e tmux nos outros sistemas quando ele
//! estiver instalado (senão PTY).
//!
//! Sessões nomeadas, um pane por sessão, ids no formato do tmux (`%3`) para o frontend não mudar.
pub mod pty;
pub mod tmux_backend;

use crate::harness::CmdSpec;
use anyhow::Result;
use std::path::PathBuf;
use std::sync::mpsc::Receiver;
use std::sync::OnceLock;

/// Id de pane (`%3`) nos dois backends: o único alvo aceito de quem está do outro lado da rede.
pub use crate::tmux::is_pane_id;
pub use crate::tmux::{Pane, PaneExt};

/// O que rodar numa sessão nova.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cmd {
    /// Linha de shell (sintaxe sh; no Windows vai para o shell de scripts, de preferência o Git Bash).
    Line(String),
    /// Programa + argumentos: cada backend monta as aspas do seu shell.
    Spec(CmdSpec),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum What {
    /// Shell interativo de login do usuário.
    Shell,
    /// Roda o comando, mostra `[kabul] saiu com N` e fica num shell interativo. `log`: grava a saída
    /// também nesse arquivo.
    Run { cmd: Cmd, log: Option<PathBuf> },
    /// Só o comando: a sessão termina quando ele sair.
    Exec(Cmd),
}

/// Pedido de sessão nova.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub name: String,
    pub cwd: Option<String>,
    /// Variáveis do workspace (KABUL_*, env do repo): pela API do processo no PTY; `export` no tmux.
    pub env: Vec<(String, String)>,
    pub what: What,
}

impl Launch {
    pub fn new(name: &str, cwd: Option<&str>, what: What) -> Self {
        Self { name: name.into(), cwd: cwd.map(String::from), env: vec![], what }
    }
    pub fn env(mut self, env: &[(String, String)]) -> Self {
        self.env.extend(env.iter().cloned());
        self
    }
}

/// Tamanho e última atividade de um pane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaneInfo {
    pub cols: u16,
    pub rows: u16,
    /// Segundos Unix da última saída.
    pub activity: u64,
}

/// Conexão de stream com uma sessão (entrada, redimensionamento; a saída chega em [`Stream::output`]).
pub trait Conn: Send {
    fn input(&mut self, pane: &str, data: &[u8]) -> Result<()>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<()>;
}

/// Stream de uma sessão: `(pane, bytes)` na ordem em que saíram. Fechar (drop) desliga só esta conexão.
pub struct Stream {
    conn: Box<dyn Conn>,
    pub output: Option<Receiver<(String, Vec<u8>)>>,
}

impl Stream {
    pub fn new(conn: Box<dyn Conn>, output: Receiver<(String, Vec<u8>)>) -> Self {
        Self { conn, output: Some(output) }
    }
    pub fn input(&mut self, pane: &str, data: &[u8]) -> Result<()> {
        self.conn.input(pane, data)
    }
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.conn.resize(cols, rows)
    }
}

/// O que o Kabul precisa de um terminal multiplexado.
pub trait TerminalBackend: Send + Sync {
    /// `tmux` ou `pty`.
    fn kind(&self) -> &'static str;
    /// Todos os panes (sessões do usuário inclusive, no tmux). Sem servidor: lista vazia.
    fn list(&self) -> Result<Vec<Pane>>;
    fn has(&self, session: &str) -> bool;
    /// Cria a sessão destacada (erro se o nome já existe).
    fn open(&self, launch: &Launch) -> Result<()>;
    fn kill(&self, session: &str) -> Result<()>;
    /// Texto com `history` linhas de scrollback (para ler a saída de um CLI).
    fn capture(&self, target: &str, history: u32) -> Result<String>;
    /// Tela visível em texto puro.
    fn plain(&self, target: &str) -> Result<String>;
    /// Tela visível pronta para um terminal (cores e cursor posicionado): snapshot do xterm.js.
    fn screen(&self, target: &str) -> Result<String>;
    /// Bytes crus (teclas, escapes, colagens) para o pane.
    fn send(&self, target: &str, data: &[u8]) -> Result<()>;
    fn resize(&self, session: &str, cols: u16, rows: u16) -> Result<()>;
    fn info(&self, target: &str) -> Option<PaneInfo>;
    /// Liga um stream na sessão (vários ao mesmo tempo: desktop, celular, convidado).
    fn attach(&self, session: &str) -> Result<Stream>;

    /// Panes com atividade e tamanho numa leitura só (varredura das sessões do kabuld). O tmux faz uma
    /// listagem; o padrão junta `list` e `info` de cada pane.
    fn list_ext(&self) -> Result<Vec<PaneExt>> {
        Ok(self
            .list()?
            .into_iter()
            .map(|pane| {
                let i = self.info(&pane.pane_id);
                PaneExt { activity: i.map(|i| i.activity).unwrap_or(0), cols: i.map(|i| i.cols).unwrap_or(80), rows: i.map(|i| i.rows).unwrap_or(24), pane }
            })
            .collect())
    }
    /// Tela visível (sem cores) de vários panes de uma vez, por id. O tmux usa um processo só; o padrão
    /// lê cada um com [`TerminalBackend::plain`]. Pane que sumiu não aparece no resultado.
    fn capture_many(&self, panes: &[&str]) -> std::collections::HashMap<String, String> {
        panes.iter().filter_map(|p| self.plain(p).ok().map(|t| (p.to_string(), t))).collect()
    }

    /// Pane principal da sessão (o ativo).
    fn pane_of(&self, session: &str) -> Option<String> {
        self.list().ok()?.into_iter().filter(|p| p.session == session).max_by_key(|p| p.active).map(|p| p.pane_id)
    }
    /// Nomes das sessões (sem repetição).
    fn sessions(&self) -> Vec<String> {
        let mut v: Vec<String> = self.list().unwrap_or_default().into_iter().map(|p| p.session).collect();
        v.dedup();
        v
    }
    /// Recria a sessão: mata a anterior com o mesmo nome e abre a nova. Devolve o nome.
    fn replace(&self, launch: &Launch) -> Result<String> {
        if self.has(&launch.name) {
            let _ = self.kill(&launch.name);
        }
        self.open(launch)?;
        Ok(launch.name.clone())
    }
}

/// Qual backend usar, pela variável e pelo sistema (testável).
pub fn choose(var: Option<&str>, windows: bool, has_tmux: bool) -> &'static str {
    match var.map(|v| v.trim().to_ascii_lowercase()) {
        Some(v) if v == "tmux" => "tmux",
        Some(v) if v == "pty" || v == "conpty" => "pty",
        _ if windows => "pty",
        _ if has_tmux => "tmux",
        _ => "pty",
    }
}

static BACKEND: OnceLock<Box<dyn TerminalBackend>> = OnceLock::new();

/// O backend do processo (escolhido no primeiro uso).
pub fn backend() -> &'static dyn TerminalBackend {
    BACKEND
        .get_or_init(|| {
            let var = std::env::var("KABUL_TERMINAL").ok();
            match choose(var.as_deref(), cfg!(windows), crate::harness::which("tmux").is_some()) {
                "tmux" => Box::new(tmux_backend::Tmux),
                _ => Box::new(pty::Mux::global()),
            }
        })
        .as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escolha() {
        assert_eq!(choose(None, true, false), "pty");
        assert_eq!(choose(None, true, true), "pty", "no Windows o tmux do WSL não enxerga o C:\\");
        assert_eq!(choose(None, false, true), "tmux");
        assert_eq!(choose(None, false, false), "pty");
        assert_eq!(choose(Some("PTY"), false, true), "pty");
        assert_eq!(choose(Some("conpty"), false, true), "pty");
        assert_eq!(choose(Some("tmux"), true, false), "tmux");
        assert_eq!(choose(Some("??"), false, true), "tmux");
    }
}
