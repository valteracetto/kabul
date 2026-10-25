//! Servidor MCP `kabul-browser` (stdio, JSON-RPC por linha), servido pelo próprio binário do Kabul:
//! `kabul mcp browser --workspace <id>` (também o app desktop e o `kabuld` com os mesmos argumentos).
//!
//! Cada agente (Claude, Codex, Gemini/agy, ACP...) abre o seu processo; todos conectam no mesmo
//! Chromium do workspace e veem a mesma aba que o humano vê na aba Browser.
//! Saídas compactas: snapshot de acessibilidade em texto com refs, ações respondem uma linha,
//! captura em JPEG.
use super::page::{NavCheck, Page};
use super::policy::{self, Mode};
use super::{Action, Dirs, Viewport};
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub const NAME: &str = "kabul-browser";

/// Ferramentas que só leem (valem em modo plano e com o navegador pausado pelo humano).
pub const READ_ONLY: &[&str] = &["browser_snapshot", "browser_screenshot", "browser_console", "browser_network", "browser_wait_for", "browser_tabs"];

#[derive(Debug, Clone)]
pub struct Options {
    pub home: PathBuf,
    pub workspace: String,
    /// Rótulo de quem chama (harness); se vazio, o `clientInfo.name` do `initialize`.
    pub agent: String,
    /// Modo plano: só as ferramentas de leitura.
    pub read_only: bool,
    /// Modo plano enquanto este arquivo existir (a conversa pode sair do plano sem reiniciar).
    pub plan_flag: Option<PathBuf>,
    /// Domínios do projeto liberados sem perguntar (além de localhost).
    pub allow_hosts: Vec<String>,
    pub approval_timeout: Duration,
}

/// Definições das ferramentas (curtas: vão no contexto do agente a cada turno).
pub fn tools() -> Value {
    let s = |d: &str| json!({ "type": "string", "description": d });
    let target = s("Element ref from browser_snapshot (e.g. e42) or a CSS selector");
    let obj = |props: Value, req: &[&str]| json!({ "type": "object", "properties": props, "required": req });
    json!([
        { "name": "browser_navigate", "description": "Open a URL in the shared Kabul browser (the user sees the same page), or go back/forward/reload.", "inputSchema": obj(json!({ "url": s("URL to open"), "go": { "type": "string", "enum": ["back", "forward", "reload"] } }), &[]) },
        { "name": "browser_snapshot", "description": "Accessibility snapshot of the page as compact text; interactive elements carry [ref=eN] for other tools. Prefer this over screenshots.", "inputSchema": obj(json!({ "root": s("Only the subtree of this ref"), "max_chars": { "type": "integer" } }), &[]) },
        { "name": "browser_screenshot", "description": "JPEG screenshot of the viewport, the full page or one element.", "inputSchema": obj(json!({ "full_page": { "type": "boolean" }, "ref": target.clone() }), &[]) },
        { "name": "browser_click", "description": "Click an element.", "inputSchema": obj(json!({ "ref": target.clone(), "double": { "type": "boolean" }, "button": { "type": "string", "enum": ["left", "right", "middle"] } }), &["ref"]) },
        { "name": "browser_type", "description": "Type text into a field (focuses it first).", "inputSchema": obj(json!({ "ref": target.clone(), "text": s("Text"), "clear": { "type": "boolean", "description": "Clear the field first" }, "submit": { "type": "boolean", "description": "Press Enter after" } }), &["ref", "text"]) },
        { "name": "browser_press", "description": "Press a key or combo (Enter, Tab, Escape, ArrowDown, Control+a).", "inputSchema": obj(json!({ "key": s("Key"), "ref": s("Focus this element first") }), &["key"]) },
        { "name": "browser_hover", "description": "Move the mouse over an element.", "inputSchema": obj(json!({ "ref": target.clone() }), &["ref"]) },
        { "name": "browser_select", "description": "Choose option(s) in a <select> by value or label.", "inputSchema": obj(json!({ "ref": target.clone(), "values": { "type": "array", "items": { "type": "string" } } }), &["ref", "values"]) },
        { "name": "browser_scroll", "description": "Scroll an element into view, or the page by dy/dx pixels (default dy 600).", "inputSchema": obj(json!({ "ref": target, "dy": { "type": "number" }, "dx": { "type": "number" } }), &[]) },
        { "name": "browser_wait_for", "description": "Wait until text or a selector appears (or is gone), or the network is idle.", "inputSchema": obj(json!({ "text": s("Text"), "selector": s("CSS selector"), "gone": { "type": "boolean" }, "network_idle": { "type": "boolean" }, "timeout_ms": { "type": "integer" } }), &[]) },
        { "name": "browser_evaluate", "description": "Run a JavaScript expression in the page and return its JSON value (may need the user's approval).", "inputSchema": obj(json!({ "expression": s("JavaScript expression (await allowed)") }), &["expression"]) },
        { "name": "browser_console", "description": "Recent console messages and page errors.", "inputSchema": obj(json!({ "level": { "type": "string", "enum": ["all", "error", "warn", "info", "log", "debug"] }, "limit": { "type": "integer" } }), &[]) },
        { "name": "browser_network", "description": "Recent requests: method, url, status, type, time, size.", "inputSchema": obj(json!({ "failed_only": { "type": "boolean" }, "filter": s("URL substring"), "limit": { "type": "integer" } }), &[]) },
        { "name": "browser_tabs", "description": "List, open, close or select tabs.", "inputSchema": obj(json!({ "action": { "type": "string", "enum": ["list", "new", "close", "select"] }, "id": s("Tab id"), "url": s("URL for a new tab") }), &[]) },
        { "name": "browser_resize", "description": "Viewport: preset desktop/laptop/tablet/mobile or width/height.", "inputSchema": obj(json!({ "preset": { "type": "string", "enum": ["desktop", "laptop", "tablet", "mobile"] }, "width": { "type": "integer" }, "height": { "type": "integer" } }), &[]) },
    ])
}

pub struct Server {
    pub opts: Options,
    dirs: Dirs,
    page: Option<Page>,
    client: String,
}

/// Resultado de uma ferramenta: conteúdo MCP + erro.
pub struct Out {
    pub content: Vec<Value>,
    pub is_error: bool,
}

impl Out {
    fn text(t: impl Into<String>) -> Self {
        Out { content: vec![json!({ "type": "text", "text": t.into() })], is_error: false }
    }
    fn err(t: impl Into<String>) -> Self {
        Out { content: vec![json!({ "type": "text", "text": t.into() })], is_error: true }
    }
}

fn arg_s<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}
fn arg_b(a: &Value, k: &str) -> bool {
    a.get(k).and_then(Value::as_bool).unwrap_or(false)
}
fn arg_n(a: &Value, k: &str) -> Option<f64> {
    a.get(k).and_then(Value::as_f64)
}

impl Server {
    pub fn new(opts: Options) -> Self {
        let dirs = Dirs::new(&opts.home, &opts.workspace);
        Server { opts, dirs, page: None, client: String::new() }
    }

    fn agent(&self) -> String {
        if !self.opts.agent.is_empty() {
            self.opts.agent.clone()
        } else if !self.client.is_empty() {
            self.client.clone()
        } else {
            "agente".into()
        }
    }

    fn mode(&self) -> Mode {
        Mode::parse(&crate::settings::AppSettings::load(&self.opts.home.join("app-settings.json")).browser_policy)
    }

    /// Página conectada na aba ativa (reconecta se o navegador fechou ou o humano trocou de aba).
    fn page(&mut self) -> Result<&Page> {
        let want = super::active_target(&self.dirs);
        let stale = match &self.page {
            None => true,
            Some(p) => p.cdp.is_closed() || want.as_deref().is_some_and(|w| w != p.target),
        };
        if stale {
            if let Some(p) = self.page.take() {
                p.detach();
            }
            let cdp = super::connect(&self.dirs)?;
            let p = match want {
                Some(t) => Page::attach_to(cdp.clone(), &self.dirs, &t).or_else(|_| Page::attach(cdp, &self.dirs))?,
                None => Page::attach(cdp, &self.dirs)?,
            };
            self.page = Some(p);
        }
        Ok(self.page.as_ref().unwrap())
    }

    fn allowed_hosts(&self) -> Vec<String> {
        let mut v = self.opts.allow_hosts.clone();
        v.extend(policy::remembered(&self.dirs));
        v
    }

    /// Navegação liberada pela política (pergunta ao usuário se precisar).
    fn check_url(&self, url: &str) -> Result<()> {
        if policy::needs_approval(self.mode(), url, &self.allowed_hosts()) {
            let d = policy::ask(&self.dirs, "navigate", url, &self.agent(), self.opts.approval_timeout);
            if !d.allow {
                bail!("O usuário não aprovou abrir {url} (ou não respondeu a tempo). Não tente contornar; pergunte a ele.");
            }
        }
        Ok(())
    }

    /// A política de navegação como função (vai para a thread que decide as navegações da página).
    /// `pre`: host já aprovado para esta ação (a URL que o agente pediu em `browser_navigate`).
    fn nav_check(&self, pre: Option<&str>) -> NavCheck {
        let (mode, hosts, dirs, agent, timeout) = (self.mode(), self.opts.allow_hosts.clone(), self.dirs.clone(), self.agent(), self.opts.approval_timeout);
        let pre = pre.and_then(policy::host_of);
        Arc::new(move |url: &str| {
            if pre.is_some() && policy::host_of(url) == pre {
                return true;
            }
            // Relido a cada navegação: um "sempre" dado no meio da ação já vale para a próxima.
            let mut allowed = hosts.clone();
            allowed.extend(policy::remembered(&dirs));
            !policy::needs_approval(mode, url, &allowed) || policy::ask(&dirs, "navigate", url, &agent, timeout).allow
        })
    }

    /// Ação que pode navegar (clique num link, envio de formulário, tecla, voltar...): a navegação que
    /// ela provocar passa pela mesma política de `browser_navigate`, não só a URL pedida direto.
    fn guarded(&mut self, pre: Option<&str>, f: impl FnOnce(&Page) -> Result<String>) -> Result<String> {
        let check = self.nav_check(pre);
        let p = self.page()?;
        let (url0, loads0) = (p.url_title().0, p.loads());
        let guard = p.guard(check)?;
        let r = f(p);
        let rep = guard.finish();
        let mut text = r?;
        if let Some(u) = rep.denied.first() {
            bail!("{text} Mas a página tentou abrir {u} e o usuário não aprovou (ou não respondeu a tempo); a navegação foi bloqueada. Não tente contornar; pergunte a ele.");
        }
        // Navegação aprovada depois da ação (o usuário respondeu): espera e conta onde parou.
        if rep.allowed > 0 && p.url_title().0 != url0 && !text.contains(&p.url_title().0) {
            p.wait_load(loads0, Duration::from_secs(5));
            text = format!("{text} Página agora: {}", p.where_now());
        }
        Ok(text)
    }

    pub fn call_tool(&mut self, name: &str, a: &Value) -> Out {
        let read_only = READ_ONLY.contains(&name) && !(name == "browser_tabs" && arg_s(a, "action").is_some_and(|x| x != "list"));
        let detail = summarize(name, a);
        // Bloqueadas também vão para o log (com ok = false).
        let blocked = if read_only {
            None
        } else if self.opts.read_only || self.opts.plan_flag.as_ref().is_some_and(|f| f.exists()) {
            Some("Modo plano: o navegador está só para leitura (snapshot, screenshot, console, rede).")
        } else if super::control(&self.dirs).paused {
            Some("O usuário assumiu o controle do navegador (pausado na aba Browser do Kabul). Espere ele devolver ou pergunte a ele.")
        } else {
            None
        };
        let r = match blocked {
            Some(why) => Err(anyhow!(why)),
            None => self.run(name, a),
        };
        let ok = r.is_ok();
        super::log_action(&self.dirs, &Action { at: super::now_ms(), agent: self.agent(), tool: name.trim_start_matches("browser_").to_string(), detail, ok });
        match r {
            Ok(o) => o,
            Err(e) => {
                // Conexão caiu: a próxima chamada reconecta.
                if self.page.as_ref().is_some_and(|p| p.cdp.is_closed()) {
                    self.page = None;
                }
                Out::err(format!("{e:#}"))
            }
        }
    }

    fn run(&mut self, name: &str, a: &Value) -> Result<Out> {
        Ok(match name {
            "browser_navigate" => {
                if let Some(go) = arg_s(a, "go") {
                    let go = go.to_string();
                    Out::text(self.guarded(None, |p| match go.as_str() {
                        "back" => p.history(-1),
                        "forward" => p.history(1),
                        "reload" => p.reload(),
                        g => bail!("go inválido: {g}"),
                    })?)
                } else {
                    let url = normalize_url(arg_s(a, "url").ok_or_else(|| anyhow!("informe url ou go"))?);
                    self.check_url(&url)?;
                    // Redirecionamento para outro domínio também passa pela política.
                    Out::text(self.guarded(Some(&url), |p| Ok(format!("Aberta: {}", p.navigate(&url)?)))?)
                }
            }
            "browser_snapshot" => {
                let max = arg_n(a, "max_chars").map(|n| n as usize).unwrap_or(12_000).clamp(500, 60_000);
                let root = arg_s(a, "root").map(String::from);
                Out::text(self.page()?.snapshot(max, root.as_deref())?)
            }
            "browser_screenshot" => {
                let target = arg_s(a, "ref").map(String::from);
                let p = self.page()?;
                let data = p.screenshot(arg_b(a, "full_page"), target.as_deref(), "jpeg", 70)?;
                let where_ = p.where_now();
                Out { content: vec![json!({ "type": "image", "data": data, "mimeType": "image/jpeg" }), json!({ "type": "text", "text": where_ })], is_error: false }
            }
            "browser_click" => {
                let t = arg_s(a, "ref").ok_or_else(|| anyhow!("informe ref"))?.to_string();
                let button = arg_s(a, "button").unwrap_or("left").to_string();
                let double = arg_b(a, "double");
                Out::text(self.guarded(None, |p| p.click(&t, double, &button))?)
            }
            "browser_type" => {
                let t = arg_s(a, "ref").ok_or_else(|| anyhow!("informe ref"))?.to_string();
                let text = a.get("text").and_then(Value::as_str).unwrap_or("").to_string();
                let (clear, submit) = (arg_b(a, "clear"), arg_b(a, "submit"));
                Out::text(self.guarded(None, |p| p.type_text(&t, &text, clear, submit))?)
            }
            "browser_press" => {
                let key = arg_s(a, "key").ok_or_else(|| anyhow!("informe key"))?.to_string();
                let focus = arg_s(a, "ref").map(String::from);
                Out::text(self.guarded(None, |p| {
                    if let Some(f) = focus {
                        let n = p.resolve(&f)?;
                        p.call("DOM.focus", json!({ "backendNodeId": n }))?;
                    }
                    p.press(&key)
                })?)
            }
            "browser_hover" => {
                let t = arg_s(a, "ref").ok_or_else(|| anyhow!("informe ref"))?.to_string();
                Out::text(self.page()?.hover(&t)?)
            }
            "browser_select" => {
                let t = arg_s(a, "ref").ok_or_else(|| anyhow!("informe ref"))?.to_string();
                let vals: Vec<String> = a.get("values").and_then(Value::as_array).map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                Out::text(self.guarded(None, |p| p.select(&t, &vals))?)
            }
            "browser_scroll" => {
                let t = arg_s(a, "ref").map(String::from);
                Out::text(self.page()?.scroll(t.as_deref(), arg_n(a, "dy").unwrap_or(if t.is_some() { 0.0 } else { 600.0 }), arg_n(a, "dx").unwrap_or(0.0))?)
            }
            "browser_wait_for" => {
                let timeout = Duration::from_millis(arg_n(a, "timeout_ms").map(|n| n as u64).unwrap_or(10_000).min(60_000));
                let (text, sel) = (arg_s(a, "text").map(String::from), arg_s(a, "selector").map(String::from));
                let idle = arg_b(a, "network_idle") || (text.is_none() && sel.is_none());
                Out::text(self.page()?.wait_for(text.as_deref(), sel.as_deref(), arg_b(a, "gone"), idle, timeout)?)
            }
            "browser_evaluate" => {
                let expr = arg_s(a, "expression").ok_or_else(|| anyhow!("informe expression"))?.to_string();
                if policy::evaluate_needs_approval(self.mode()) {
                    let d = policy::ask(&self.dirs, "evaluate", &expr, &self.agent(), self.opts.approval_timeout);
                    if !d.allow {
                        bail!("O usuário não aprovou rodar JavaScript na página (ou não respondeu a tempo).");
                    }
                }
                let v = self.page()?.eval(&expr)?;
                let s = if let Value::String(s) = &v { s.clone() } else { v.to_string() };
                let n = s.chars().count();
                Out::text(if n > 4000 { format!("{}… ({n} caracteres)", s.chars().take(4000).collect::<String>()) } else { s })
            }
            "browser_console" => {
                let n = arg_n(a, "limit").map(|n| n as usize).unwrap_or(30).min(200);
                let level = arg_s(a, "level").map(String::from);
                Out::text(self.page()?.console(n, level.as_deref()))
            }
            "browser_network" => {
                let n = arg_n(a, "limit").map(|n| n as usize).unwrap_or(30).min(200);
                let filter = arg_s(a, "filter").map(String::from);
                Out::text(self.page()?.network(n, arg_b(a, "failed_only"), filter.as_deref()))
            }
            "browser_tabs" => self.tabs(a)?,
            "browser_resize" => {
                let mut v = arg_s(a, "preset").and_then(Viewport::preset).unwrap_or_else(|| super::viewport(&self.dirs));
                if let Some(w) = arg_n(a, "width") {
                    v.width = (w as u32).clamp(200, 4000);
                }
                if let Some(h) = arg_n(a, "height") {
                    v.height = (h as u32).clamp(200, 4000);
                }
                super::set_viewport(&self.dirs, &v)?;
                self.page()?.apply_viewport(&v)?;
                Out::text(format!("Viewport {}×{}{}.", v.width, v.height, if v.mobile { " (celular, toque)" } else { "" }))
            }
            other => bail!("ferramenta desconhecida: {other}"),
        })
    }

    fn tabs(&mut self, a: &Value) -> Result<Out> {
        let action = arg_s(a, "action").unwrap_or("list").to_string();
        let cdp = super::connect(&self.dirs)?;
        match action.as_str() {
            "new" => {
                let url = normalize_url(arg_s(a, "url").unwrap_or("about:blank"));
                self.check_url(&url)?;
                let id = cdp.call(None, "Target.createTarget", json!({ "url": url }))?["targetId"].as_str().unwrap_or("").to_string();
                super::set_active_target(&self.dirs, &id)?;
            }
            "close" => {
                let id = arg_s(a, "id").map(String::from).or_else(|| super::active_target(&self.dirs)).ok_or_else(|| anyhow!("informe id"))?;
                cdp.call(None, "Target.closeTarget", json!({ "targetId": id }))?;
                // O Chromium responde antes de tirar a aba da lista (ainda mais se ela estava carregando).
                let t0 = std::time::Instant::now();
                while t0.elapsed() < Duration::from_secs(3) && super::tabs(&cdp, &self.dirs)?.iter().any(|t| t.id == id) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                if super::active_target(&self.dirs).as_deref() == Some(id.as_str()) {
                    let _ = std::fs::remove_file(self.dirs.file("active.json"));
                }
                self.page = None;
            }
            "select" => {
                let id = arg_s(a, "id").ok_or_else(|| anyhow!("informe id"))?.to_string();
                let _ = cdp.call(None, "Target.activateTarget", json!({ "targetId": id }));
                super::set_active_target(&self.dirs, &id)?;
            }
            "list" => {}
            o => bail!("action inválida: {o}"),
        }
        let tabs = super::tabs(&cdp, &self.dirs)?;
        cdp.close();
        let lines: Vec<String> = tabs.iter().map(|t| format!("{} {} {} — {}", if t.active { "*" } else { " " }, t.id, t.url, t.title)).collect();
        Ok(Out::text(if lines.is_empty() { "Nenhuma aba.".into() } else { lines.join("\n") }))
    }

    /// Uma mensagem JSON-RPC → resposta (ou nada, para notificações).
    pub fn handle(&mut self, msg: &Value) -> Option<Value> {
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let result: Result<Value, (i64, String)> = match method {
            "initialize" => {
                if let Some(n) = msg.pointer("/params/clientInfo/name").and_then(Value::as_str) {
                    self.client = n.to_string();
                }
                let pv = msg.pointer("/params/protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18");
                Ok(json!({
                    "protocolVersion": pv,
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": NAME, "version": env!("CARGO_PKG_VERSION") },
                    "instructions": "Kabul's browser, shared live with the user (Browser tab). Read pages with browser_snapshot and act with the [ref=eN] it returns."
                }))
            }
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => {
                let name = msg.pointer("/params/name").and_then(Value::as_str).unwrap_or("").to_string();
                let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
                let o = self.call_tool(&name, &args);
                Ok(json!({ "content": o.content, "isError": o.is_error }))
            }
            "resources/list" => Ok(json!({ "resources": [] })),
            "prompts/list" => Ok(json!({ "prompts": [] })),
            m if m.starts_with("notifications/") => return None,
            m => Err((-32601, format!("método desconhecido: {m}"))),
        };
        let id = id?;
        Some(match result {
            Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
            Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
        })
    }
}

fn normalize_url(u: &str) -> String {
    let u = u.trim();
    if u.contains("://") || u.starts_with("about:") || u.starts_with("data:") || u.starts_with("file:") || u.starts_with("javascript:") {
        return u.to_string();
    }
    let host = u.split(['/', '?']).next().unwrap_or("");
    let local = host.starts_with("localhost") || host.starts_with("127.") || host.starts_with("0.0.0.0") || host.starts_with('[');
    format!("{}://{u}", if local { "http" } else { "https" })
}

fn summarize(name: &str, a: &Value) -> String {
    let pick = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let s = match name {
        "browser_navigate" => {
            let u = pick("url");
            if u.is_empty() {
                pick("go")
            } else {
                u
            }
        }
        "browser_type" => format!("{} ← {} caracteres", pick("ref"), pick("text").chars().count()),
        "browser_press" => pick("key"),
        "browser_evaluate" => pick("expression"),
        "browser_tabs" => format!("{} {}", pick("action"), pick("url")),
        "browser_wait_for" => format!("{}{}", pick("text"), pick("selector")),
        "browser_resize" => pick("preset"),
        _ => pick("ref"),
    };
    s.chars().take(160).collect()
}

/// Workspace a partir da pasta atual (para quando o MCP é registrado globalmente, como no agy).
pub fn workspace_from_cwd(home: &Path, cwd: &Path) -> Option<String> {
    let st: Value = serde_json::from_slice(&std::fs::read(home.join("state.json")).ok()?).ok()?;
    let cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    st["workspaces"]
        .as_array()?
        .iter()
        .filter_map(|w| Some((w["id"].as_str()?.to_string(), PathBuf::from(w["path"].as_str()?))))
        .filter(|(_, p)| {
            let p = p.canonicalize().unwrap_or_else(|_| p.clone());
            cwd.starts_with(&p)
        })
        .max_by_key(|(_, p)| p.components().count())
        .map(|(id, _)| id)
}

/// Pasta de estado padrão do Kabul (ou `KABUL_HOME`).
pub fn default_home() -> PathBuf {
    std::env::var_os("KABUL_HOME").map(PathBuf::from).unwrap_or_else(|| crate::store::Store::default_paths().0.parent().map(PathBuf::from).unwrap_or_default())
}

/// Roda o servidor no stdin/stdout até o cliente fechar.
pub fn serve(opts: Options) -> Result<()> {
    let mut srv = Server::new(opts);
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    // Diagnóstico: `KABUL_MCP_TRACE=<arquivo>` anota cada mensagem (entrada e saída, cortadas).
    let trace = std::env::var_os("KABUL_MCP_TRACE").map(PathBuf::from);
    let log = |dir: &str, s: &str| {
        if let Some(f) = &trace {
            let line = format!("{} {} {dir} {}\n", super::now_ms(), std::process::id(), s.chars().take(400).collect::<String>());
            let _ = std::fs::OpenOptions::new().create(true).append(true).open(f).and_then(|mut h| h.write_all(line.as_bytes()));
        }
    };
    log("*", "início");
    for line in stdin.lock().lines() {
        let line = line?;
        log("<", &line);
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                writeln!(out, "{}", json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "JSON inválido" } }))?;
                out.flush()?;
                continue;
            }
        };
        // Lote (JSON-RPC batch).
        let replies: Vec<Value> = match &msg {
            Value::Array(a) => a.iter().filter_map(|m| srv.handle(m)).collect(),
            m => srv.handle(m).into_iter().collect(),
        };
        for r in replies {
            log(">", &r.to_string());
            writeln!(out, "{r}")?;
            out.flush()?;
        }
    }
    log("*", "fim (stdin fechado)");
    if let Some(p) = srv.page.take() {
        p.detach();
    }
    Ok(())
}

/// Argumentos da linha de comando (`mcp browser ...`), compartilhados pelo CLI, app e kabuld.
pub fn parse_args(args: &[String]) -> Result<Options> {
    let mut o = Options { home: default_home(), workspace: String::new(), agent: String::new(), read_only: false, plan_flag: None, allow_hosts: vec![], approval_timeout: Duration::from_secs(120) };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut val = || it.next().cloned().ok_or_else(|| anyhow!("{a} precisa de um valor"));
        match a.as_str() {
            "--workspace" | "-w" => o.workspace = val()?,
            "--home" => o.home = PathBuf::from(val()?),
            "--agent" => o.agent = val()?,
            "--read-only" | "--plan" => o.read_only = true,
            "--plan-flag" => o.plan_flag = Some(PathBuf::from(val()?)),
            "--allow-host" => o.allow_hosts.push(val()?),
            "--approval-timeout" => o.approval_timeout = Duration::from_secs(val()?.parse().unwrap_or(120)),
            x => bail!("argumento desconhecido: {x}"),
        }
    }
    if o.workspace.is_empty() || o.workspace == "auto" {
        let cwd = std::env::current_dir()?;
        o.workspace = workspace_from_cwd(&o.home, &cwd).unwrap_or_else(|| format!("pasta-{}", short_hash(&cwd.display().to_string())));
    }
    Ok(o)
}

fn short_hash(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:x}", h & 0xffff_ffff)
}

/// Despacha `mcp browser ...` (argv sem o nome do programa). `None` se não for esse comando.
pub fn dispatch(argv: &[String]) -> Option<Result<()>> {
    match argv {
        [m, b, rest @ ..] if m == "mcp" && b == "browser" => Some(parse_args(rest).and_then(serve)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn srv(read_only: bool) -> Server {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let home = std::env::temp_dir().join(format!("kabul-mcpb-{}-{n}-{read_only}", std::process::id()));
        Server::new(Options { home, workspace: "w".into(), agent: String::new(), read_only, plan_flag: None, allow_hosts: vec![], approval_timeout: Duration::from_millis(200) })
    }

    #[test]
    fn protocolo_basico() {
        let mut s = srv(false);
        let r = s.handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26", "clientInfo": { "name": "codex-mcp-client" } } })).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], NAME);
        assert_eq!(s.agent(), "codex-mcp-client");
        assert!(s.handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let l = s.handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = l["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        for n in [
            "browser_navigate",
            "browser_snapshot",
            "browser_screenshot",
            "browser_click",
            "browser_type",
            "browser_press",
            "browser_hover",
            "browser_select",
            "browser_scroll",
            "browser_wait_for",
            "browser_evaluate",
            "browser_console",
            "browser_network",
            "browser_tabs",
            "browser_resize",
        ] {
            assert!(names.contains(&n), "{n}");
        }
        // Peso: as definições cabem em ~2 mil tokens.
        let tokens = l["result"]["tools"].to_string().len() / 4;
        assert!(tokens < 2000, "{tokens} tokens");
        let e = s.handle(&json!({ "jsonrpc": "2.0", "id": 3, "method": "x/y" })).unwrap();
        assert_eq!(e["error"]["code"], -32601);
        let u = s.handle(&json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "nada", "arguments": {} } })).unwrap();
        assert_eq!(u["result"]["isError"], true);
    }

    #[test]
    fn modo_plano_e_pausa_bloqueiam_acoes() {
        let mut s = srv(true);
        let o = s.call_tool("browser_click", &json!({ "ref": "e1" }));
        assert!(o.is_error && o.content[0]["text"].as_str().unwrap().contains("Modo plano"));
        let o = s.call_tool("browser_tabs", &json!({ "action": "new" }));
        assert!(o.is_error);
        // Plano ao vivo: vale enquanto o arquivo existir (pausado para o teste não abrir navegador).
        let mut s = srv(false);
        let flag = s.opts.home.join("plano");
        super::super::set_paused(&s.dirs, true).unwrap();
        std::fs::write(&flag, "plan").unwrap();
        s.opts.plan_flag = Some(flag.clone());
        assert!(s.call_tool("browser_click", &json!({ "ref": "e1" })).content[0]["text"].as_str().unwrap().contains("Modo plano"));
        std::fs::remove_file(&flag).unwrap();
        assert!(s.call_tool("browser_click", &json!({ "ref": "e1" })).content[0]["text"].as_str().unwrap().contains("assumiu o controle"));
        std::fs::remove_dir_all(&s.opts.home).ok();
        let mut s = srv(false);
        super::super::set_paused(&s.dirs, true).unwrap();
        let o = s.call_tool("browser_navigate", &json!({ "url": "http://localhost:1" }));
        assert!(o.is_error && o.content[0]["text"].as_str().unwrap().contains("assumiu o controle"));
        // Registrado no log da sessão.
        assert_eq!(super::super::actions(&s.dirs, 5).last().unwrap().tool, "navigate");
        std::fs::remove_dir_all(&s.opts.home).ok();
    }

    #[test]
    fn argumentos_e_urls() {
        let o = parse_args(&["--workspace".into(), "w1".into(), "--agent".into(), "codex".into(), "--read-only".into(), "--allow-host".into(), "exemplo.com".into(), "--home".into(), "/tmp/h".into()]).unwrap();
        assert_eq!((o.workspace.as_str(), o.agent.as_str(), o.read_only, o.allow_hosts.len()), ("w1", "codex", true, 1));
        assert!(parse_args(&["--xyz".into()]).is_err());
        assert_eq!(normalize_url("localhost:5173"), "http://localhost:5173");
        assert_eq!(normalize_url("exemplo.com/a"), "https://exemplo.com/a");
        assert_eq!(normalize_url("about:blank"), "about:blank");
        assert!(dispatch(&["mcp".into(), "outro".into()]).is_none());
        // Workspace pela pasta (registro global, como no agy).
        let h = std::env::temp_dir().join(format!("kabul-mcpb-ws-{}", std::process::id()));
        let ws = h.join("ws1");
        std::fs::create_dir_all(ws.join("sub")).unwrap();
        std::fs::write(h.join("state.json"), json!({ "workspaces": [{ "id": "abc", "path": ws.display().to_string() }] }).to_string()).unwrap();
        assert_eq!(workspace_from_cwd(&h, &ws.join("sub")).as_deref(), Some("abc"));
        assert_eq!(workspace_from_cwd(&h, &h), None);
        std::fs::remove_dir_all(&h).ok();
    }
}
