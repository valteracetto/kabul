//! Harnesses: rodam um agente em modo estruturado (NDJSON / JSON-RPC por stdio) e emitem eventos.
//!
//! Cada agente tem um [`Harness`] (como montar o comando + capacidades opcionais de nuvem,
//! remote-control, teleport e background) e um [`Protocol`] com estado por sessão
//! (parser das linhas de saída + codificação das mensagens de entrada).
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

pub mod acp;
pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod gemini;
pub mod opencode;
pub mod qwen;

pub use antigravity::Antigravity;
pub use claude::ClaudeCode;
pub use codex::Codex;
pub use gemini::GeminiCli;
pub use opencode::OpenCode;
pub use qwen::QwenCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessKind {
    Claude,
    Codex,
    Antigravity,
    #[serde(rename = "opencode")]
    OpenCode,
    #[serde(rename = "qwen")]
    QwenCode,
    #[serde(rename = "gemini")]
    GeminiCli,
    /// Só pelo ACP (`goose acp`); a confirmar.
    Goose,
    /// Cursor CLI pelo ACP (`cursor-agent acp`); a confirmar.
    Cursor,
}

impl HarnessKind {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "claude" | "claude-code" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "agy" | "antigravity" => Some(Self::Antigravity),
            "opencode" => Some(Self::OpenCode),
            "qwen" | "qwen-code" => Some(Self::QwenCode),
            "gemini" | "gemini-cli" => Some(Self::GeminiCli),
            "goose" => Some(Self::Goose),
            "cursor" | "cursor-agent" => Some(Self::Cursor),
            _ => None,
        }
    }
    pub fn binary(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Antigravity => "agy",
            Self::OpenCode => "opencode",
            Self::QwenCode => "qwen",
            Self::GeminiCli => "gemini",
            Self::Goose => "goose",
            Self::Cursor => "cursor-agent",
        }
    }
    pub const ALL: [HarnessKind; 8] = [Self::Claude, Self::Codex, Self::Antigravity, Self::OpenCode, Self::QwenCode, Self::GeminiCli, Self::Goose, Self::Cursor];
    pub fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Antigravity => "Antigravity",
            Self::OpenCode => "OpenCode",
            Self::QwenCode => "Qwen Code",
            Self::GeminiCli => "Gemini CLI",
            Self::Goose => "Goose",
            Self::Cursor => "Cursor",
        }
    }
    /// Binário no PATH (ou em instalações conhecidas, como `~/.opencode/bin`).
    pub fn installed(self) -> bool {
        which(self.binary()).is_some()
    }
    /// Comando sugerido para instalar o CLI (o app sempre pede confirmação antes).
    pub fn install_command(self) -> &'static str {
        match self {
            Self::Claude => "npm install -g @anthropic-ai/claude-code",
            Self::Codex => "npm install -g @openai/codex",
            Self::Antigravity => "curl -fsSL https://antigravity.google/install.sh | sh",
            Self::OpenCode => "curl -fsSL https://opencode.ai/install | bash",
            Self::QwenCode => "npm install -g @qwen-code/qwen-code",
            Self::GeminiCli => "npm install -g @google/gemini-cli",
            Self::Goose => "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash",
            Self::Cursor => "curl https://cursor.com/install -fsS | bash",
        }
    }
    pub fn harness(self) -> Box<dyn Harness> {
        match self {
            Self::Claude => Box::new(ClaudeCode),
            Self::Codex => Box::new(Codex),
            Self::Antigravity => Box::new(Antigravity),
            Self::OpenCode => Box::new(OpenCode),
            Self::QwenCode => Box::new(QwenCode),
            Self::GeminiCli => Box::new(GeminiCli),
            Self::Goose | Self::Cursor => Box::new(acp::AcpHarness(self)),
        }
    }
}

/// Procura um executável no PATH e em pastas de instalação conhecidas.
pub fn which(bin: &str) -> Option<std::path::PathBuf> {
    if let Some(p) = std::env::var_os(bin_override_var(bin)).map(std::path::PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    let extra = [home.join(".opencode/bin"), home.join(".lmstudio/bin"), home.join(".local/bin"), "/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(extra)
        .map(|d| d.join(bin))
        .find(|p| p.is_file())
}

/// API que um endpoint fala.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Api {
    Openai,
    Anthropic,
    Gemini,
}

/// Endpoint de modelo (local, em outra máquina da rede ou custom) que o harness deve usar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct Endpoint {
    /// Raiz do servidor, sem `/v1` (ex.: `http://127.0.0.1:1234`).
    pub base_url: String,
    pub apis: Vec<Api>,
    pub api_key: Option<String>,
    /// Id do modelo no servidor.
    pub model: String,
    /// Janela de contexto, quando conhecida.
    pub context: Option<u64>,
}

impl Endpoint {
    pub fn openai_url(&self) -> String {
        format!("{}/v1", self.base_url.trim_end_matches('/'))
    }
    pub fn key(&self) -> String {
        self.api_key.clone().unwrap_or_else(|| "kabul-local".into())
    }
}

/// Evento normalizado, igual para todos os agentes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Sessão/conversa/thread iniciada (id para retomar).
    SessionStarted { session_id: String, model: Option<String> },
    /// Texto completo de uma mensagem do agente.
    Text { text: String },
    /// Pedaço de texto em streaming.
    TextDelta { text: String },
    Reasoning { text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { id: String, output: String, is_error: bool },
    /// O agente pede aprovação; responder com [`Protocol::approval`].
    ApprovalRequest { request_id: String, tool: String, input: Value },
    /// Detalhe de tokens do turno (popover do tempo): entrada nova, saída, cache lido e gravado.
    Usage { input: Option<u64>, output: Option<u64>, cache_read: Option<u64>, cache_write: Option<u64>, duration_ms: Option<u64> },
    /// Ferramentas e servidores MCP ativos na sessão (Claude: evento `init`).
    SessionInfo { tools: Vec<String>, mcp_servers: Vec<McpStatus> },
    TurnCompleted { result: Option<String>, input_tokens: Option<u64>, output_tokens: Option<u64>, cost_usd: Option<f64> },
    Error { message: String },
    /// Linha reconhecida como JSON mas sem mapeamento.
    Raw { value: Value },
    /// Linha que não é JSON (stderr misturado, logs).
    Log { line: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct McpStatus {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Default)]
pub struct SessionOptions {
    pub cwd: Option<String>,
    pub model: Option<String>,
    /// low|medium|high|xhigh|max
    pub effort: Option<String>,
    /// Claude: default|plan|acceptEdits|bypassPermissions. Antigravity: auto|plan|accept-edits.
    pub permission_mode: Option<String>,
    /// Retomar sessão/conversa/thread existente.
    pub resume: Option<String>,
    /// Claude: com `resume`, cria um fork (`--fork-session`).
    pub fork: bool,
    /// Aprovações de ferramentas vêm para o app (Claude: `--permission-prompt-tool=stdio`).
    pub approvals_via_app: bool,
    /// Liga o remote-control nativo (Claude/agy) com esse nome.
    pub remote_control: Option<String>,
    pub add_dirs: Vec<String>,
    /// Modelo servido por um endpoint local/custom (o harness configura env/flags).
    pub endpoint: Option<Endpoint>,
    /// Variáveis extras (ex.: `KABUL_WORKSPACE_*`, `KABUL_PORT`).
    pub env: Vec<(String, String)>,
    /// Claude: arquivo `--mcp-config` (com `--strict-mcp-config`) só com os MCPs habilitados na sessão.
    pub mcp_config: Option<String>,
    /// MCPs desligados nesta sessão (OpenCode/Codex aplicam por config).
    pub disabled_mcp: Vec<String>,
    /// Claude: JSON de `--settings` (ex.: `{"outputStyle":"Explanatory"}`).
    pub settings_json: Option<String>,
    /// Claude: `--append-system-prompt` (preferências gerais do repo).
    pub system_prompt: Option<String>,
}

/// Variável que aponta o executável de um agente (Configurações › Avançado): `KABUL_BIN_CLAUDE` etc.
pub fn bin_override_var(bin: &str) -> String {
    format!("KABUL_BIN_{}", bin.to_uppercase().replace('-', "_"))
}

/// Programa + argumentos, sem executar (testável).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CmdSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
}

impl CmdSpec {
    pub fn new<I, S>(program: &str, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self { program: program.into(), args: args.into_iter().map(Into::into).collect(), cwd: None, env: vec![] }
    }
    pub fn with_cwd(mut self, cwd: Option<String>) -> Self {
        self.cwd = cwd;
        self
    }
    pub fn with_env(mut self, env: &[(String, String)]) -> Self {
        self.env.extend(env.iter().cloned());
        self
    }
    pub fn command(&self) -> Command {
        let prog = which(&self.program).map(|p| p.display().to_string()).unwrap_or_else(|| self.program.clone());
        let mut c = Command::new(prog);
        c.envs(self.env.iter().map(|(k, v)| (k, v)));
        c.args(&self.args);
        if let Some(d) = &self.cwd {
            c.current_dir(d);
        }
        c
    }
    /// Linha de shell (para rodar dentro do tmux).
    pub fn shell_line(&self) -> String {
        let env: String = self.env.iter().map(|(k, v)| format!("{k}={} ", shell_quote(v))).collect();
        env + &std::iter::once(self.program.as_str()).chain(self.args.iter().map(String::as_str)).map(shell_quote).collect::<Vec<_>>().join(" ")
    }
}

pub fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:@%+,".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Grau de suporte de uma capacidade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Support {
    /// O CLI oferece (confirmado no `--help`).
    Native,
    /// Existe no CLI segundo a documentação, mas não foi confirmado nesta máquina.
    Unconfirmed,
    /// Não existe; o Kabul cobre espelhando a sessão tmux.
    TmuxMirror,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Capabilities {
    pub remote_control: Support,
    pub cloud: Support,
    pub teleport: Support,
    pub background: Support,
}

/// Resultado de iniciar uma sessão em nuvem/background, extraído da saída do CLI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct RemoteHandle {
    pub id: Option<String>,
    pub url: Option<String>,
}

pub trait Harness: Send + Sync {
    fn kind(&self) -> HarnessKind;
    /// Comando do modo estruturado (stdio).
    fn command(&self, opts: &SessionOptions) -> CmdSpec;
    /// Comando interativo (TUI) para rodar dentro do tmux.
    fn interactive_command(&self, opts: &SessionOptions) -> CmdSpec;
    fn protocol(&self, opts: &SessionOptions) -> Box<dyn Protocol>;
    fn capabilities(&self) -> Capabilities;

    /// Harness sem sessão persistente por stdio: um processo por turno (`opts.resume` = sessão).
    fn turn_command(&self, _prompt: &str, _opts: &SessionOptions) -> Option<CmdSpec> {
        None
    }
    /// APIs de endpoint que o harness sabe usar para modelos locais/custom.
    fn endpoint_apis(&self) -> &'static [Api] {
        &[]
    }
    /// Aprovações de ferramenta podem ser respondidas pelo app.
    fn app_approvals(&self) -> bool {
        true
    }

    /// Sessão em nuvem a partir de uma descrição.
    fn cloud_run(&self, _description: &str, _environment: Option<&str>) -> Option<CmdSpec> {
        None
    }
    /// Traz uma sessão remota para o Mac (rodar no tmux).
    fn teleport(&self, _id: &str) -> Option<CmdSpec> {
        None
    }
    /// Inicia em background com um prompt.
    fn background(&self, _prompt: &str, _opts: &SessionOptions) -> Option<CmdSpec> {
        None
    }
    /// Ação sobre sessão em background: attach|logs|stop|rm.
    fn background_action(&self, _action: &str, _id: &str) -> Option<CmdSpec> {
        None
    }
    /// Status do remote-control (daemon) quando houver.
    fn remote_control_status(&self) -> Option<CmdSpec> {
        None
    }
    /// Extrai id/URL da saída de cloud_run/background.
    fn parse_remote_output(&self, out: &str) -> RemoteHandle {
        parse_remote_generic(out)
    }
}

/// Estado do protocolo de uma sessão.
pub trait Protocol: Send {
    /// Linhas a escrever logo após o spawn (handshake).
    fn startup(&mut self) -> Vec<String> {
        vec![]
    }
    /// Escritor para respostas fora do fluxo de `on_line` (ex.: ACP `terminal/wait_for_exit`).
    fn attach_writer(&mut self, _w: acp::Writer) {}
    /// Processa uma linha de stdout: eventos + linhas de resposta para stdin.
    fn on_line(&mut self, line: &str) -> (Vec<Event>, Vec<String>);
    /// Codifica uma mensagem do usuário.
    fn user_message(&mut self, text: &str) -> Vec<String>;
    /// Resposta a um [`Event::ApprovalRequest`].
    fn approval(&mut self, _request_id: &str, _allow: bool) -> Vec<String> {
        vec![]
    }
    /// Aprovação com entrada alterada (ex.: respostas do AskUserQuestion) e/ou "sempre permitir" na sessão.
    fn approval_ext(&mut self, request_id: &str, allow: bool, _tool: &str, _updated_input: Option<Value>, _always: bool) -> Vec<String> {
        self.approval(request_id, allow)
    }
    /// Fim do processo (modo por turno) sem `TurnCompleted` explícito.
    fn finish(&mut self) -> Event {
        Event::TurnCompleted { result: None, input_tokens: None, output_tokens: None, cost_usd: None }
    }
}

/// Procura URL https e um id plausível na saída de um comando.
pub fn parse_remote_generic(out: &str) -> RemoteHandle {
    let url = find_urls(out).into_iter().next();
    let id = url.as_deref().and_then(|u| u.trim_end_matches('/').rsplit('/').next()).filter(|s| !s.is_empty() && !s.contains('?')).map(String::from);
    RemoteHandle { id, url }
}

/// Todas as URLs https do texto (remove sequências ANSI antes).
pub fn find_urls(text: &str) -> Vec<String> {
    let clean = strip_ansi(text);
    clean
        .split(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '<' || c == '>' || c == ')' || c == '(')
        .filter(|w| w.starts_with("https://"))
        .map(|w| w.trim_end_matches(['.', ',', ';']).to_string())
        .collect()
}

pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\x1b' {
            match it.peek() {
                Some('[') => {
                    it.next();
                    for d in it.by_ref() {
                        if ('@'..='~').contains(&d) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    it.next();
                    while let Some(d) = it.next() {
                        if d == '\x07' || (d == '\x1b' && it.peek() == Some(&'\\')) {
                            if d == '\x1b' {
                                it.next();
                            }
                            break;
                        }
                    }
                }
                _ => {
                    it.next();
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub(crate) fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(String::from)
}

enum Mode {
    /// Sessão persistente: linhas JSON por stdin/stdout.
    Stdio { child: Child, stdin: Arc<Mutex<ChildStdin>>, protocol: Arc<Mutex<Box<dyn Protocol>>> },
    /// Um processo por turno (OpenCode, Gemini CLI). A sessão continua via `resume`.
    PerTurn { kind: HarnessKind, opts: SessionOptions, session: Arc<Mutex<Option<String>>>, child: Arc<Mutex<Option<Child>>>, tx: Option<Sender<Event>> },
}

/// Agente rodando; eventos chegam em `events`.
pub struct Running {
    mode: Mode,
    pub events: Receiver<Event>,
}

fn write_lines(stdin: &Arc<Mutex<ChildStdin>>, lines: &[String]) -> Result<()> {
    let mut w = stdin.lock().unwrap();
    for l in lines {
        w.write_all(l.as_bytes())?;
        w.write_all(b"\n")?;
    }
    w.flush()?;
    Ok(())
}

impl Running {
    pub fn send(&self, text: &str) -> Result<()> {
        match &self.mode {
            Mode::Stdio { stdin, protocol, .. } => {
                let lines = protocol.lock().unwrap().user_message(text);
                write_lines(stdin, &lines)
            }
            Mode::PerTurn { kind, opts, session, child, tx } => {
                let tx = tx.clone().context("sessão encerrada")?;
                let mut o = opts.clone();
                if let Some(s) = session.lock().unwrap().clone() {
                    o.resume = Some(s);
                }
                let h = kind.harness();
                let spec = h.turn_command(text, &o).context("harness sem modo por turno")?;
                let mut c = spec.command().stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().with_context(|| format!("iniciando {}", spec.program))?;
                let out = c.stdout.take().context("stdout")?;
                let err = c.stderr.take().context("stderr")?;
                *child.lock().unwrap() = Some(c);
                let (session, child, tx2) = (session.clone(), child.clone(), tx.clone());
                let mut proto = h.protocol(&o);
                std::thread::spawn(move || {
                    for line in BufReader::new(err).lines().map_while(Result::ok) {
                        let _ = tx2.send(Event::Log { line });
                    }
                });
                std::thread::spawn(move || {
                    let mut completed = false;
                    for line in BufReader::new(out).lines().map_while(Result::ok) {
                        for e in proto.on_line(&line).0 {
                            if let Event::SessionStarted { session_id, .. } = &e {
                                let mut s = session.lock().unwrap();
                                if s.as_deref() == Some(session_id.as_str()) {
                                    continue;
                                }
                                *s = Some(session_id.clone());
                            }
                            completed |= matches!(e, Event::TurnCompleted { .. });
                            let _ = tx.send(e);
                        }
                    }
                    let code = child.lock().unwrap().take().and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
                    if !completed {
                        if let Some(c) = code.filter(|c| *c != 0) {
                            let _ = tx.send(Event::Error { message: format!("processo terminou com código {c}") });
                        }
                        // Todo turno termina com TurnCompleted (a UI sai do estado "trabalhando").
                        let _ = tx.send(proto.finish());
                    }
                });
                Ok(())
            }
        }
    }
    pub fn approve_ext(&self, request_id: &str, allow: bool, tool: &str, updated_input: Option<Value>, always: bool) -> Result<()> {
        match &self.mode {
            Mode::Stdio { stdin, protocol, .. } => {
                let lines = protocol.lock().unwrap().approval_ext(request_id, allow, tool, updated_input, always);
                write_lines(stdin, &lines)
            }
            Mode::PerTurn { .. } => anyhow::bail!("este harness não recebe aprovações pelo app"),
        }
    }
    pub fn approve(&self, request_id: &str, allow: bool) -> Result<()> {
        match &self.mode {
            Mode::Stdio { stdin, protocol, .. } => {
                let lines = protocol.lock().unwrap().approval(request_id, allow);
                write_lines(stdin, &lines)
            }
            Mode::PerTurn { .. } => anyhow::bail!("este harness não recebe aprovações pelo app"),
        }
    }
    /// Interrompe o turno atual (ou a sessão inteira, no modo stdio).
    pub fn kill(&mut self) -> Result<()> {
        match &mut self.mode {
            Mode::Stdio { child, .. } => child.kill().context("kill"),
            Mode::PerTurn { child, tx, .. } => {
                *tx = None;
                if let Some(c) = child.lock().unwrap().as_mut() {
                    c.kill().ok();
                }
                Ok(())
            }
        }
    }
    /// Espera o processo (stdio) e devolve o código de saída.
    pub fn wait(&mut self) -> Option<i32> {
        match &mut self.mode {
            Mode::Stdio { child, .. } => child.wait().ok().and_then(|s| s.code()),
            Mode::PerTurn { .. } => None,
        }
    }
    /// Processo do agente (sessão persistente ou turno em andamento), para o painel de recursos.
    pub fn pid(&self) -> Option<u32> {
        match &self.mode {
            Mode::Stdio { child, .. } => Some(child.id()),
            Mode::PerTurn { child, .. } => child.lock().unwrap().as_ref().map(|c| c.id()),
        }
    }
    /// Id da sessão do agente (para retomar), quando o modo guarda.
    pub fn session_id(&self) -> Option<String> {
        match &self.mode {
            Mode::PerTurn { session, .. } => session.lock().unwrap().clone(),
            _ => None,
        }
    }
}

/// Inicia o agente no modo estruturado e devolve eventos parseados.
pub fn spawn(h: &dyn Harness, opts: &SessionOptions) -> Result<Running> {
    if h.turn_command("", opts).is_some() {
        let (tx, rx) = channel();
        let session = Arc::new(Mutex::new(opts.resume.clone()));
        return Ok(Running { mode: Mode::PerTurn { kind: h.kind(), opts: opts.clone(), session, child: Default::default(), tx: Some(tx) }, events: rx });
    }
    let spec = h.command(opts);
    let mut child = spec
        .command()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("iniciando {}", spec.program))?;
    let stdin = Arc::new(Mutex::new(child.stdin.take().context("stdin")?));
    let stdout = child.stdout.take().context("stdout")?;
    let stderr = child.stderr.take().context("stderr")?;
    let protocol = Arc::new(Mutex::new(h.protocol(opts)));
    let (tx, rx) = channel();

    {
        let w = stdin.clone();
        protocol.lock().unwrap().attach_writer(Arc::new(move |lines: Vec<String>| {
            let _ = write_lines(&w, &lines);
        }));
    }
    write_lines(&stdin, &protocol.lock().unwrap().startup())?;

    {
        let (tx, protocol, stdin) = (tx.clone(), protocol.clone(), stdin.clone());
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let (evs, replies) = protocol.lock().unwrap().on_line(&line);
                if !replies.is_empty() && write_lines(&stdin, &replies).is_err() {
                    let _ = tx.send(Event::Error { message: "stdin fechado".into() });
                }
                for e in evs {
                    if tx.send(e).is_err() {
                        return;
                    }
                }
            }
        });
    }
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if tx.send(Event::Log { line }).is_err() {
                return;
            }
        }
    });
    Ok(Running { mode: Mode::Stdio { child, stdin, protocol }, events: rx })
}

#[cfg(test)]
pub(crate) fn run_fixture(p: &mut dyn Protocol, text: &str) -> (Vec<Event>, Vec<String>) {
    let mut evs = vec![];
    let mut out = vec![];
    for l in text.lines() {
        let (e, o) = p.on_line(l);
        evs.extend(e);
        out.extend(o);
    }
    (evs, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ansi_e_urls() {
        let t = "\x1b[2mabra\x1b[0m https://x.com/a?b=1. e (https://y.org/z)";
        assert_eq!(find_urls(t), vec!["https://x.com/a?b=1", "https://y.org/z"]);
    }

    #[test]
    fn quote() {
        assert_eq!(shell_quote("abc"), "abc");
        assert_eq!(shell_quote("a b'c"), "'a b'\\''c'");
        assert_eq!(CmdSpec::new("claude", ["--cloud", "faz x"]).shell_line(), "claude --cloud 'faz x'");
    }

    #[test]
    fn kinds() {
        assert_eq!(HarnessKind::parse("gemini"), Some(HarnessKind::GeminiCli));
        assert_eq!(HarnessKind::parse("agy"), Some(HarnessKind::Antigravity));
        assert_eq!(HarnessKind::parse("opencode"), Some(HarnessKind::OpenCode));
        assert_eq!(HarnessKind::parse("x"), None);
    }
}
