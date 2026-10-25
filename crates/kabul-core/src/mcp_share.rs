//! MCP compartilhado entre todas as IAs: um registro único, importado das configs nativas de cada CLI,
//! e a injeção no formato de cada harness ao iniciar a sessão.
//!
//! Fontes: Claude (`~/.claude.json` usuário/local e `.mcp.json` do projeto), Codex (`config.toml`
//! `[mcp_servers]`), OpenCode (`opencode.json` `mcp`), Gemini CLI e Qwen Code (`settings.json`
//! `mcpServers`) e Antigravity (`~/.gemini/config/mcp_config.json`).
//!
//! Injeção (só no modo estruturado, por sessão, sem tocar nas configs do usuário):
//! - Claude: `--mcp-config` com os que não são dele; com algo desligado, todos os ligados + `--strict-mcp-config`.
//! - Codex: `-c mcp_servers.<nome>.*`; valores de `env` e cabeçalhos vão pelo ambiente do processo
//!   (`env_vars`, `env_http_headers`), nunca na linha de comando.
//! - ACP (OpenCode, Gemini CLI, Qwen Code, Goose, Cursor): `mcpServers` no `session/new`/`session/load`
//!   (http/sse só se o agente anunciar em `mcpCapabilities`). Desligar os nativos: Qwen
//!   `--disable-mcp-server`, Gemini `--allowed-mcp-server-names`, OpenCode `mcp.<nome>.enabled=false`.
//! - Antigravity: a config de MCP do agy é só global (`~/.gemini/config/mcp_config.json` e plugins
//!   habilitados globalmente; `ANTIGRAVITY_GEMINI_DIR` não muda esse arquivo). Não há injeção por
//!   sessão: o painel oferece "Exportar para o Antigravity" (grava no arquivo global, com backup).
//!
//! Peso no contexto: [`weigh`] abre o servidor (stdio), pede `tools/list` e estima os tokens das
//! definições (≈ 4 caracteres por token). Fica em cache por configuração.
use crate::harness::HarnessKind;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Servidor MCP no formato canônico do Kabul.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Server {
    pub name: String,
    /// stdio | http | sse
    pub transport: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub cwd: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

/// De onde um servidor veio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Origin {
    /// Id do harness (`claude`, `codex`, `agy`…).
    pub harness: String,
    pub scope: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Shared {
    pub server: Server,
    pub origins: Vec<Origin>,
    /// Mesmo nome com configurações diferentes em CLIs diferentes (vale a primeira).
    pub conflict: bool,
}

/// O que o painel mostra (sem valores de `env`/cabeçalhos: só os nomes).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct View {
    pub name: String,
    pub transport: String,
    pub target: String,
    pub origins: Vec<Origin>,
    pub conflict: bool,
    /// Disponível nas outras IAs (padrão). Desligado = só nos CLIs de origem.
    pub shared: bool,
    pub env_keys: Vec<String>,
    pub weight: Option<Weight>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Weight {
    pub tools: usize,
    /// Tokens estimados das definições das ferramentas (enviadas em todo turno).
    pub tokens: usize,
}

pub fn harness_id(k: HarnessKind) -> &'static str {
    match k {
        HarnessKind::Antigravity => "agy",
        k => match k.binary() {
            "cursor-agent" => "cursor",
            b => b,
        },
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(String::from)
}
fn strs(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}
fn map(v: Option<&Value>) -> BTreeMap<String, String> {
    v.and_then(Value::as_object).map(|o| o.iter().filter_map(|(k, x)| x.as_str().map(|x| (k.clone(), x.to_string()))).collect()).unwrap_or_default()
}

/// Config nativa → canônica. `None` se estiver desligada na origem ou não for reconhecida.
pub fn from_native(kind: HarnessKind, name: &str, cfg: &Value) -> Option<Server> {
    if cfg.get("enabled").and_then(Value::as_bool) == Some(false) || cfg.get("disabled").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let mut sv = Server { name: name.into(), ..Default::default() };
    match kind {
        // OpenCode: `{type: local, command: [..], environment}` / `{type: remote, url, headers}`.
        HarnessKind::OpenCode => match s(cfg, "type").as_deref() {
            Some("remote") => {
                sv.transport = "http".into();
                sv.url = s(cfg, "url");
                sv.headers = map(cfg.get("headers"));
            }
            _ => {
                let mut c = strs(cfg.get("command"));
                if c.is_empty() {
                    return None;
                }
                sv.transport = "stdio".into();
                sv.command = Some(c.remove(0));
                sv.args = c;
                sv.env = map(cfg.get("environment"));
            }
        },
        _ => {
            sv.command = s(cfg, "command");
            sv.args = strs(cfg.get("args"));
            sv.env = map(cfg.get("env"));
            sv.cwd = s(cfg, "cwd");
            sv.headers = map(cfg.get("headers").or_else(|| cfg.get("http_headers")));
            // Gemini/Qwen: `httpUrl` = streamable http, `url` = sse. Claude: `type` + `url`. Codex/agy: `url` = http.
            let (url, t) = match (s(cfg, "httpUrl"), s(cfg, "url").or_else(|| s(cfg, "serverUrl"))) {
                (Some(u), _) => (Some(u), "http"),
                (None, Some(u)) => {
                    let ty = s(cfg, "type").unwrap_or_default();
                    let sse = ty == "sse" || (matches!(kind, HarnessKind::GeminiCli | HarnessKind::QwenCode) && ty.is_empty());
                    (Some(u), if sse { "sse" } else { "http" })
                }
                (None, None) => (None, "stdio"),
            };
            sv.url = url;
            sv.transport = t.into();
            if sv.transport == "stdio" && sv.command.is_none() {
                return None;
            }
        }
    }
    Some(sv)
}

impl Server {
    pub fn target(&self) -> String {
        match &self.url {
            Some(u) => u.clone(),
            None => std::iter::once(self.command.clone().unwrap_or_default()).chain(self.args.iter().cloned()).collect::<Vec<_>>().join(" "),
        }
    }
    /// Mesmo servidor (ignora diferenças só de ambiente: o mesmo MCP com o token em outra variável).
    fn same(&self, o: &Server) -> bool {
        self.transport == o.transport && self.command == o.command && self.args == o.args && self.url == o.url
    }
    /// Formato do Claude Code (`.mcp.json` / `--mcp-config`).
    pub fn to_claude(&self) -> Value {
        match &self.url {
            Some(u) => json!({ "type": self.transport, "url": u, "headers": self.headers }),
            None => {
                let mut v = json!({ "command": self.command, "args": self.args, "env": self.env });
                if let Some(c) = &self.cwd {
                    v["cwd"] = json!(c);
                }
                v
            }
        }
    }
    /// Formato do ACP (`mcpServers` do `session/new`).
    pub fn to_acp(&self) -> Value {
        let pairs = |m: &BTreeMap<String, String>| m.iter().map(|(k, v)| json!({ "name": k, "value": v })).collect::<Vec<_>>();
        match &self.url {
            Some(u) => json!({ "type": self.transport, "name": self.name, "url": u, "headers": pairs(&self.headers) }),
            None => json!({ "name": self.name, "command": self.command, "args": self.args, "env": pairs(&self.env) }),
        }
    }
    /// Formato do Antigravity (`mcp_config.json`).
    pub fn to_agy(&self) -> Value {
        match &self.url {
            Some(u) => json!({ "url": u, "headers": self.headers }),
            None => json!({ "command": self.command, "args": self.args, "env": self.env }),
        }
    }
}

fn home() -> PathBuf {
    crate::paths::home()
}

/// `~/.gemini/config/mcp_config.json` do Antigravity (JSONC).
pub fn agy_config_file() -> PathBuf {
    home().join(".gemini/config/mcp_config.json")
}

fn agy_entries() -> Vec<(String, Value, String)> {
    let p = agy_config_file();
    let v: Value = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str(&crate::mcp::strip_jsonc(&t)).ok()).unwrap_or(Value::Null);
    v.get("mcpServers").and_then(Value::as_object).map(|o| o.iter().map(|(k, c)| (k.clone(), c.clone(), p.display().to_string())).collect()).unwrap_or_default()
}

/// Ordem de leitura (a primeira config de um nome vence em conflito).
const SOURCES: [HarnessKind; 6] = [HarnessKind::Claude, HarnessKind::Codex, HarnessKind::OpenCode, HarnessKind::GeminiCli, HarnessKind::QwenCode, HarnessKind::Antigravity];

/// Registro único: todos os MCPs de todas as configs nativas, por nome.
pub fn shared(workspace: &Path, repo: &Path) -> Vec<Shared> {
    let mut out: Vec<Shared> = vec![];
    for kind in SOURCES {
        let entries: Vec<(String, Value, String, String)> = if kind == HarnessKind::Antigravity {
            agy_entries().into_iter().map(|(n, c, src)| (n, c, "user".into(), src)).collect()
        } else {
            crate::mcp::list(kind, workspace, repo).into_iter().map(|e| (e.name, e.config, e.scope, e.source)).collect()
        };
        for (name, cfg, scope, source) in entries {
            let Some(sv) = from_native(kind, &name, &cfg) else { continue };
            let origin = Origin { harness: harness_id(kind).into(), scope, source };
            match out.iter_mut().find(|x| x.server.name == name) {
                Some(x) => {
                    x.conflict |= !x.server.same(&sv);
                    if !x.origins.iter().any(|o| o.harness == origin.harness) {
                        x.origins.push(origin);
                    }
                }
                None => out.push(Shared { server: sv, origins: vec![origin], conflict: false }),
            }
        }
    }
    out.sort_by(|a, b| a.server.name.cmp(&b.server.name));
    out
}

/// Preferências do registro (`<estado>/mcp-shared.json`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Prefs {
    /// MCPs que ficam só nos CLIs de origem (não vão para as outras IAs).
    #[serde(default)]
    pub local_only: Vec<String>,
    /// Remotos sem cabeçalho fixo (login OAuth) que o usuário pediu para compartilhar. Por padrão
    /// não vão: o token fica no cofre do CLI de origem e o outro CLI travaria abrindo o login (o
    /// Gemini CLI segura o `session/new` até cada MCP conectar).
    #[serde(default)]
    pub share_remote: Vec<String>,
}

impl Prefs {
    /// Vai para as outras IAs?
    pub fn is_shared(&self, sv: &Server) -> bool {
        if self.local_only.contains(&sv.name) {
            return false;
        }
        sv.url.is_none() || !sv.headers.is_empty() || self.share_remote.contains(&sv.name)
    }
    /// Liga/desliga "disponível em todas as IAs".
    pub fn set_shared(&mut self, sv: &Server, on: bool) {
        self.local_only.retain(|n| n != &sv.name);
        self.share_remote.retain(|n| n != &sv.name);
        let oauth = sv.url.is_some() && sv.headers.is_empty();
        match (on, oauth) {
            (false, _) => self.local_only.push(sv.name.clone()),
            (true, true) => self.share_remote.push(sv.name.clone()),
            (true, false) => {}
        }
    }
}

impl Prefs {
    pub fn load(home: &Path) -> Self {
        std::fs::read_to_string(home.join("mcp-shared.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn save(&self, home: &Path) -> Result<()> {
        std::fs::create_dir_all(home)?;
        std::fs::write(home.join("mcp-shared.json"), serde_json::to_vec_pretty(self)?).context("gravando mcp-shared.json")
    }
}

/// O que fazer com MCP numa sessão de `kind`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Plan {
    /// Servidores de outras IAs para injetar (ligados, compartilhados, sem os nativos deste CLI).
    pub inject: Vec<Server>,
    /// Nativos deste CLI desligados na sessão.
    pub disable_native: Vec<String>,
    /// Nativos deste CLI ligados.
    pub keep_native: Vec<String>,
    /// Ligados de todas as origens (para o Claude em modo estrito).
    pub enabled: Vec<Server>,
}

pub fn plan(kind: HarnessKind, all: &[Shared], disabled: &[String], prefs: &Prefs) -> Plan {
    let id = harness_id(kind);
    let mut p = Plan::default();
    for x in all {
        let native = x.origins.iter().any(|o| o.harness == id);
        let off = disabled.contains(&x.server.name);
        match (native, off) {
            (true, true) => p.disable_native.push(x.server.name.clone()),
            (true, false) => {
                p.keep_native.push(x.server.name.clone());
                p.enabled.push(x.server.clone());
            }
            (false, false) if prefs.is_shared(&x.server) => {
                p.inject.push(x.server.clone());
                p.enabled.push(x.server.clone());
            }
            _ => {}
        }
    }
    p
}

/// Grava o `--mcp-config` do Claude (0600: pode ter tokens) e diz se é estrito.
pub fn claude_config(p: &Plan, dir: &Path) -> Result<Option<(PathBuf, bool)>> {
    let strict = !p.disable_native.is_empty();
    let list = if strict { &p.enabled } else { &p.inject };
    if list.is_empty() && !strict {
        return Ok(None);
    }
    let servers: serde_json::Map<String, Value> = list.iter().map(|s| (s.name.clone(), s.to_claude())).collect();
    std::fs::create_dir_all(dir)?;
    let f = dir.join(format!("mcp-{}.json", crate::store::now_nanos()));
    write_private(&f, &serde_json::to_vec_pretty(&json!({ "mcpServers": servers }))?)?;
    Ok(Some((f, strict)))
}

fn write_private(p: &Path, data: &[u8]) -> Result<()> {
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(p)?.write_all(data).with_context(|| format!("gravando {}", p.display()))
}

/// Chave TOML segura (`mcp_servers.<nome>`): só letras, números, `-` e `_`.
fn toml_key(n: &str) -> Option<&str> {
    (!n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then_some(n)
}

/// Variável de ambiente para um valor secreto do servidor `n` (cabeçalho ou env).
fn env_var(n: &str, k: &str) -> String {
    let clean = |s: &str| s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' }).collect::<String>();
    format!("KABUL_MCP_{}_{}", clean(n), clean(k))
}

/// Codex: argumentos `-c` e o ambiente do processo (valores de `env`/cabeçalhos fora da linha de comando).
pub fn codex_overrides(p: &Plan) -> (Vec<String>, Vec<(String, String)>) {
    let mut a = vec![];
    let mut env = vec![];
    let q = |s: &str| serde_json::to_string(s).unwrap();
    for s in &p.inject {
        let Some(n) = toml_key(&s.name) else { continue };
        let mut set = |k: &str, v: String| a.extend(["-c".to_string(), format!("mcp_servers.{n}.{k}={v}")]);
        match &s.url {
            Some(u) => {
                set("url", q(u));
                if !s.headers.is_empty() {
                    let hs: Vec<String> = s
                        .headers
                        .iter()
                        .map(|(k, v)| {
                            let var = env_var(n, k);
                            env.push((var.clone(), v.clone()));
                            format!("{}={}", q(k), q(&var))
                        })
                        .collect();
                    set("env_http_headers", format!("{{{}}}", hs.join(",")));
                }
            }
            None => {
                set("command", q(s.command.as_deref().unwrap_or("")));
                set("args", format!("[{}]", s.args.iter().map(|x| q(x)).collect::<Vec<_>>().join(",")));
                if let Some(c) = &s.cwd {
                    set("cwd", q(c));
                }
                if !s.env.is_empty() {
                    // `env_vars` repassa do ambiente do Codex para o servidor, com o mesmo nome.
                    set("env_vars", format!("[{}]", s.env.keys().map(|k| q(k)).collect::<Vec<_>>().join(",")));
                    env.extend(s.env.iter().map(|(k, v)| (k.clone(), v.clone())));
                }
            }
        }
    }
    for n in &p.disable_native {
        if let Some(n) = toml_key(n) {
            a.extend(["-c".to_string(), format!("mcp_servers.{n}.enabled=false")]);
        }
    }
    (a, env)
}

/// Exporta um servidor para a config nativa do Antigravity (arquivo global), com backup ao lado.
pub fn export_agy(sv: &Server, file: &Path) -> Result<Option<PathBuf>> {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    let mut v: Value = if text.trim().is_empty() { json!({}) } else { serde_json::from_str(&crate::mcp::strip_jsonc(&text)).context("mcp_config.json inválido")? };
    let backup = if text.is_empty() {
        None
    } else {
        let b = file.with_extension(format!("json.bak-kabul-{}", crate::store::now_nanos()));
        std::fs::write(&b, &text)?;
        Some(b)
    };
    if !v["mcpServers"].is_object() {
        v["mcpServers"] = json!({});
    }
    v["mcpServers"][&sv.name] = sv.to_agy();
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d)?;
    }
    write_private(file, &serde_json::to_vec_pretty(&v)?)?;
    Ok(backup)
}

/// Abre o servidor (stdio), pede `tools/list` e estima o peso das definições.
pub fn weigh(sv: &Server, timeout: Duration) -> Result<Weight> {
    let Some(cmd) = sv.command.as_deref() else { bail!("só stdio é medido (http precisa de login/sessão)") };
    let spec = crate::harness::CmdSpec::new(cmd, sv.args.iter().cloned()).with_cwd(sv.cwd.clone()).with_env(&sv.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect::<Vec<_>>());
    let mut child = spec.command().stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().with_context(|| format!("iniciando {cmd}"))?;
    let mut stdin = child.stdin.take().context("stdin")?;
    let out = child.stdout.take().context("stdout")?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for l in BufReader::new(out).lines().map_while(Result::ok) {
            if tx.send(l).is_err() {
                return;
            }
        }
    });
    let send = |w: &mut std::process::ChildStdin, v: Value| writeln!(w, "{v}").and_then(|_| w.flush());
    send(&mut stdin, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "kabul", "version": env!("CARGO_PKG_VERSION") } } }))?;
    let t0 = std::time::Instant::now();
    let mut result = Err(anyhow::anyhow!("sem resposta em {}s", timeout.as_secs()));
    while let Some(left) = timeout.checked_sub(t0.elapsed()) {
        let Ok(l) = rx.recv_timeout(left) else { break };
        let Ok(v) = serde_json::from_str::<Value>(&l) else { continue };
        match v.get("id").and_then(Value::as_u64) {
            Some(1) => {
                send(&mut stdin, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;
                send(&mut stdin, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }))?;
            }
            Some(2) => {
                let tools = v.pointer("/result/tools").cloned().unwrap_or(json!([]));
                let n = tools.as_array().map(Vec::len).unwrap_or(0);
                result = Ok(Weight { tools: n, tokens: tools.to_string().len().div_ceil(4) });
                break;
            }
            _ => {}
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    result
}

/// Cache do peso por configuração (`<estado>/mcp-weights.json`).
pub fn cached_weight(home: &Path, sv: &Server) -> Option<Weight> {
    let m: BTreeMap<String, Weight> = std::fs::read_to_string(home.join("mcp-weights.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    m.get(&weight_key(sv)).copied()
}

pub fn store_weight(home: &Path, sv: &Server, w: Weight) -> Result<()> {
    let f = home.join("mcp-weights.json");
    let mut m: BTreeMap<String, Weight> = std::fs::read_to_string(&f).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    m.insert(weight_key(sv), w);
    std::fs::create_dir_all(home)?;
    std::fs::write(f, serde_json::to_vec(&m)?)?;
    Ok(())
}

/// Chave do cache: nome + alvo (sem valores de env: mudar o token não muda as ferramentas).
fn weight_key(sv: &Server) -> String {
    format!("{}|{}|{}", sv.name, sv.transport, sv.target())
}

pub fn views(home: &Path, all: &[Shared], prefs: &Prefs) -> Vec<View> {
    all.iter()
        .map(|x| View {
            name: x.server.name.clone(),
            transport: x.server.transport.clone(),
            target: x.server.target(),
            origins: x.origins.clone(),
            conflict: x.conflict,
            shared: prefs.is_shared(&x.server),
            env_keys: x.server.env.keys().chain(x.server.headers.keys()).cloned().collect(),
            weight: cached_weight(home, &x.server),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formatos_nativos() {
        let c = from_native(HarnessKind::Claude, "a", &json!({ "command": "npx", "args": ["-y", "x"], "env": { "T": "1" } })).unwrap();
        assert_eq!((c.transport.as_str(), c.command.as_deref(), c.args.len(), c.env["T"].as_str()), ("stdio", Some("npx"), 2, "1"));
        let h = from_native(HarnessKind::Claude, "h", &json!({ "type": "http", "url": "https://m/mcp", "headers": { "Authorization": "Bearer t" } })).unwrap();
        assert_eq!((h.transport.as_str(), h.url.as_deref()), ("http", Some("https://m/mcp")));
        let o = from_native(HarnessKind::OpenCode, "o", &json!({ "type": "local", "command": ["node", "s.js"], "environment": { "K": "v" } })).unwrap();
        assert_eq!((o.command.as_deref(), o.args.clone(), o.env["K"].as_str()), (Some("node"), vec!["s.js".to_string()], "v"));
        assert!(from_native(HarnessKind::OpenCode, "x", &json!({ "type": "local", "command": ["a"], "enabled": false })).is_none());
        assert_eq!(from_native(HarnessKind::GeminiCli, "g", &json!({ "url": "https://m/sse" })).unwrap().transport, "sse");
        assert_eq!(from_native(HarnessKind::GeminiCli, "g", &json!({ "httpUrl": "https://m/mcp" })).unwrap().transport, "http");
        assert!(from_native(HarnessKind::Antigravity, "d", &json!({ "command": "a", "disabled": true })).is_none());
        // Saídas.
        assert_eq!(c.to_acp(), json!({ "name": "a", "command": "npx", "args": ["-y", "x"], "env": [{ "name": "T", "value": "1" }] }));
        assert_eq!(h.to_acp()["headers"][0]["name"], "Authorization");
        assert_eq!(c.to_claude()["env"]["T"], "1");
    }

    fn sh(name: &str, origin: &str) -> Shared {
        Shared {
            server: Server { name: name.into(), transport: "stdio".into(), command: Some("node".into()), env: [("TOKEN".to_string(), "segredo".to_string())].into(), ..Default::default() },
            origins: vec![Origin { harness: origin.into(), scope: "user".into(), source: "x".into() }],
            conflict: false,
        }
    }

    #[test]
    fn plano_por_harness() {
        let all = vec![sh("eco", "claude"), sh("linear", "codex"), sh("local", "codex")];
        let prefs = Prefs { local_only: vec!["local".into()], ..Default::default() };
        // Codex: eco vem do Claude; linear é nativo; local é nativo dele (só origem).
        let p = plan(HarnessKind::Codex, &all, &["linear".into()], &prefs);
        assert_eq!(p.inject.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["eco"]);
        assert_eq!((p.disable_native.clone(), p.keep_native.clone()), (vec!["linear".to_string()], vec!["local".to_string()]));
        let (a, env) = codex_overrides(&p);
        let joined = a.join(" ");
        assert!(joined.contains(r#"mcp_servers.eco.command="node""#) && joined.contains(r#"mcp_servers.eco.env_vars=["TOKEN"]"#) && joined.contains("mcp_servers.linear.enabled=false"));
        assert!(!joined.contains("segredo"), "segredo fora da linha de comando");
        assert_eq!(env, vec![("TOKEN".to_string(), "segredo".to_string())]);
        // Claude: "local" não é compartilhado, então não chega.
        let p = plan(HarnessKind::Claude, &all, &[], &prefs);
        assert_eq!(p.inject.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), vec!["linear"]);
        let d = std::env::temp_dir().join(format!("kabul-mcpshare-{}", std::process::id()));
        let (f, strict) = claude_config(&p, &d).unwrap().unwrap();
        assert!(!strict);
        let j: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(j["mcpServers"]["linear"].is_object() && j["mcpServers"].get("eco").is_none());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // Desligar um nativo do Claude: estrito com todos os ligados.
        let p = plan(HarnessKind::Claude, &all, &["eco".into()], &prefs);
        let (f, strict) = claude_config(&p, &d).unwrap().unwrap();
        let j: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(strict && j["mcpServers"].get("eco").is_none() && j["mcpServers"]["linear"].is_object());
        // Remoto com OAuth (sem cabeçalho): só compartilha quando pedido.
        let mut remoto = sh("figma", "claude");
        remoto.server = Server { name: "figma".into(), transport: "http".into(), url: Some("https://m/mcp".into()), ..Default::default() };
        let mut pr = Prefs::default();
        assert!(plan(HarnessKind::GeminiCli, std::slice::from_ref(&remoto), &[], &pr).inject.is_empty());
        pr.set_shared(&remoto.server, true);
        assert_eq!(plan(HarnessKind::GeminiCli, std::slice::from_ref(&remoto), &[], &pr).inject.len(), 1);
        pr.set_shared(&remoto.server, false);
        assert!(pr.local_only.contains(&"figma".to_string()) && pr.share_remote.is_empty());
        // Nada a fazer: sem arquivo.
        assert!(claude_config(&plan(HarnessKind::Claude, &[sh("eco", "claude")], &[], &Prefs::default()), &d).unwrap().is_none());
        // Exportar para o agy com backup.
        let f = d.join("mcp_config.json");
        std::fs::write(&f, "{\n  // comentário\n  \"mcpServers\": { \"x\": { \"command\": \"a\" } }\n}").unwrap();
        let b = export_agy(&all[0].server, &f).unwrap().unwrap();
        let j: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert!(j["mcpServers"]["x"].is_object() && j["mcpServers"]["eco"]["command"] == "node");
        assert!(std::fs::read_to_string(b).unwrap().contains("comentário"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn registro_une_e_marca_conflito() {
        let d = std::env::temp_dir().join(format!("kabul-mcpreg-{}", std::process::id()));
        std::fs::create_dir_all(d.join(".gemini")).unwrap();
        std::fs::write(d.join(".mcp.json"), r#"{"mcpServers":{"eco":{"command":"node","args":["eco.mjs"]}}}"#).unwrap();
        std::fs::write(d.join(".gemini/settings.json"), r#"{"mcpServers":{"eco":{"command":"node","args":["outro.mjs"]},"so-gemini":{"httpUrl":"https://m/mcp"}}}"#).unwrap();
        let all: Vec<Shared> = shared(&d, &d).into_iter().filter(|x| x.origins.iter().any(|o| o.source.starts_with(&d.display().to_string()))).collect();
        let eco = all.iter().find(|x| x.server.name == "eco").unwrap();
        assert_eq!(eco.origins.iter().map(|o| o.harness.as_str()).collect::<Vec<_>>(), vec!["claude", "gemini"]);
        assert!(eco.conflict, "mesmo nome, comando diferente");
        assert_eq!(eco.server.args, vec!["eco.mjs"], "vale a primeira (Claude)");
        assert_eq!(all.iter().find(|x| x.server.name == "so-gemini").unwrap().server.transport, "http");
        std::fs::remove_dir_all(&d).ok();
    }

    /// MCP configurado só no Claude e chamado por outro agente via Kabul, com o CLI de verdade e o LLM
    /// falso: `KABUL_TESTE_MCP_AGENTE=<gemini|codex|qwen|goose|opencode> cargo test -p kabul-core mcp_compartilhado_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn mcp_compartilhado_real() {
        use crate::harness::{Api, Endpoint, Event, SessionOptions};
        let Some(kind) = std::env::var("KABUL_TESTE_MCP_AGENTE").ok().and_then(|a| HarnessKind::parse(&a)) else { return };
        let dir = std::env::temp_dir().join(format!("kabul-mcp-real-{}-{}", kind.binary(), std::process::id())).canonicalize_or_create();
        let log = dir.join("eco.log");
        let eco = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/eco-mcp.mjs");
        // Só no Claude (escopo do projeto).
        std::fs::write(dir.join(".mcp.json"), json!({ "mcpServers": { "eco": { "command": "node", "args": [eco], "env": { "ECO_LOG": log.display().to_string() } } } }).to_string()).unwrap();
        // Só o que está no workspace de teste (os MCPs reais do usuário ficam de fora).
        let all: Vec<Shared> = shared(&dir, &dir).into_iter().filter(|x| x.origins.iter().all(|o| o.source.starts_with(&dir.display().to_string()))).collect();
        let eco_sh = all.iter().find(|x| x.server.name == "eco").expect("eco no registro");
        assert_eq!(eco_sh.origins[0].harness, "claude");
        let p = plan(kind, &all, &[], &Prefs::default());
        assert!(p.inject.iter().any(|s| s.name == "eco"), "eco vai para {kind:?}");
        // LLM falso.
        let mut fake = std::process::Command::new("node").arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake-llm.mjs")).arg("0").stdout(std::process::Stdio::piped()).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(fake.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let port = line.trim().trim_start_matches("PORTA ").to_string();
        let opts = SessionOptions {
            cwd: Some(dir.display().to_string()),
            approvals_via_app: true,
            permission_mode: Some("default".into()),
            endpoint: Some(Endpoint { base_url: format!("http://127.0.0.1:{port}"), apis: vec![Api::Openai, Api::Anthropic, Api::Gemini], api_key: None, model: "fake-model".into(), context: Some(128_000) }),
            mcp_inject: p.inject.clone(),
            disabled_mcp: p.disable_native.clone(),
            mcp_keep: p.keep_native.clone(),
            ..Default::default()
        };
        let h = kind.harness();
        let mut r = crate::harness::spawn(h.as_ref(), &opts).unwrap();
        std::thread::sleep(Duration::from_secs(std::env::var("KABUL_TESTE_MCP_PAUSA").ok().and_then(|s| s.parse().ok()).unwrap_or(0)));
        r.send(&format!("Use a ferramenta eco com o texto oi-{}. [KABUL-MCP eco oi-{}]", kind.binary(), kind.binary())).unwrap();
        let mut text = String::new();
        loop {
            match r.events.recv_timeout(Duration::from_secs(60)).expect("sem eventos") {
                Event::ApprovalRequest { request_id, tool, input } => {
                    eprintln!("aprovação: {tool} {input}");
                    r.approve_ext(&request_id, true, &tool, None, false).unwrap();
                }
                Event::ToolUse { name, input, .. } => eprintln!("ferramenta: {name} {input}"),
                Event::ToolResult { output, is_error, .. } => eprintln!("resultado ({is_error}): {output}"),
                Event::TextDelta { text: t } | Event::Text { text: t } => text.push_str(&t),
                Event::TurnCompleted { .. } => break,
                Event::Error { message } => panic!("{message}"),
                e => eprintln!("{e:?}"),
            }
        }
        eprintln!("texto: {text}");
        let _ = r.kill();
        let _ = fake.kill();
        let _ = fake.wait();
        let called = std::fs::read_to_string(&log).unwrap_or_default();
        assert!(called.contains(&format!("oi-{}", kind.binary())), "eco não foi chamado pelo {kind:?}: {text}");
        std::fs::remove_dir_all(&dir).ok();
    }

    trait CreateDir {
        fn canonicalize_or_create(self) -> PathBuf;
    }
    impl CreateDir for PathBuf {
        fn canonicalize_or_create(self) -> PathBuf {
            std::fs::create_dir_all(&self).unwrap();
            self.canonicalize().unwrap()
        }
    }

    #[test]
    fn peso_do_servidor_de_teste() {
        if crate::harness::which("node").is_none() {
            return;
        }
        let sv = Server { name: "eco".into(), transport: "stdio".into(), command: Some("node".into()), args: vec![concat!(env!("CARGO_MANIFEST_DIR"), "/tests/eco-mcp.mjs").into()], ..Default::default() };
        let w = weigh(&sv, Duration::from_secs(10)).unwrap();
        assert_eq!(w.tools, 1);
        assert!(w.tokens > 20 && w.tokens < 200, "{w:?}");
        let d = std::env::temp_dir().join(format!("kabul-mcpw-{}", std::process::id()));
        store_weight(&d, &sv, w).unwrap();
        assert_eq!(cached_weight(&d, &sv), Some(w));
        std::fs::remove_dir_all(&d).ok();
    }
}
