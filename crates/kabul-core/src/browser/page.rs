//! Uma aba do navegador vista por um cliente (servidor MCP ou o app): sessão CDP própria, ações
//! (navegar, clicar, digitar...), snapshot de acessibilidade com refs, console e rede.
//!
//! Refs: `e<backendNodeId>`. O id do nó no Chromium é estável enquanto o elemento existir e vale em
//! qualquer conexão, então um agente pode usar a ref de um snapshot tirado por outro processo.
use super::{cdp::CdpEvent, Cdp, Dirs, Viewport};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_LOG: usize = 300;

#[derive(Debug, Clone)]
pub struct ConsoleMsg {
    pub level: String,
    pub text: String,
    pub at: u64,
}

#[derive(Debug, Clone, Default)]
pub struct NetReq {
    pub id: String,
    pub method: String,
    pub url: String,
    pub kind: String,
    pub status: Option<u16>,
    pub failed: Option<String>,
    pub bytes: u64,
    pub start: f64,
    pub end: Option<f64>,
}

/// Console e rede da aba, coletados por uma thread que lê os eventos.
#[derive(Default)]
pub struct Logs {
    pub console: VecDeque<ConsoleMsg>,
    pub net: VecDeque<NetReq>,
    pub inflight: HashMap<String, Instant>,
    pub last_net: Option<Instant>,
    pub loads: u64,
}

/// Pode abrir esta URL? (política do navegador; pode perguntar ao usuário e esperar a resposta).
pub type NavCheck = Arc<dyn Fn(&str) -> bool + Send + Sync>;

#[derive(Default)]
struct GuardState {
    stop: AtomicBool,
    /// Decisões em andamento (o usuário ainda não respondeu).
    busy: AtomicUsize,
    allowed: AtomicUsize,
    denied: Mutex<Vec<String>>,
    last: Mutex<Option<Instant>>,
    /// Sessão → alvo vigiado: a aba do agente e as abas que a página abriu durante a ação.
    sessions: Mutex<HashMap<String, String>>,
    /// Sessões das abas abertas pela página (desanexadas no fim).
    popups: Mutex<Vec<String>>,
}

/// Só os documentos (navegações), antes de sair a requisição.
fn fetch_patterns() -> Value {
    json!({ "patterns": [{ "urlPattern": "*", "resourceType": "Document", "requestStage": "Request" }] })
}

/// Política de navegação ligada durante uma ação do agente (ver [`Page::guard`]).
pub struct NavGuard {
    cdp: Arc<Cdp>,
    session: String,
    st: Arc<GuardState>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// O que aconteceu com as navegações durante a ação.
#[derive(Debug, Default)]
pub struct GuardReport {
    /// Navegações do documento principal que seguiram.
    pub allowed: usize,
    /// URLs barradas (o usuário negou ou não respondeu).
    pub denied: Vec<String>,
}

impl NavGuard {
    /// Espera as navegações que a ação disparou serem decididas (inclusive as que aguardam o usuário)
    /// e desliga a interceptação.
    pub fn finish(mut self) -> GuardReport {
        let quiet = Duration::from_millis(250);
        let t0 = Instant::now();
        std::thread::sleep(Duration::from_millis(100));
        loop {
            let busy = self.st.busy.load(Ordering::SeqCst) > 0;
            let recent = self.st.last.lock().unwrap().is_some_and(|t| t.elapsed() < quiet);
            if (!busy && !recent) || self.cdp.is_closed() || t0.elapsed() > Duration::from_secs(600) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        self.stop();
        GuardReport { allowed: self.st.allowed.load(Ordering::SeqCst), denied: std::mem::take(&mut *self.st.denied.lock().unwrap()) }
    }

    fn stop(&mut self) {
        let t = Duration::from_secs(5);
        let _ = self.cdp.call_timeout(None, "Target.setAutoAttach", json!({ "autoAttach": false, "waitForDebuggerOnStart": false, "flatten": true }), t);
        let _ = self.cdp.call_timeout(Some(&self.session), "Fetch.disable", json!({}), t);
        for s in std::mem::take(&mut *self.st.popups.lock().unwrap()) {
            let _ = self.cdp.call_timeout(Some(&s), "Fetch.disable", json!({}), t);
            self.cdp.send(None, "Target.detachFromTarget", json!({ "sessionId": s }));
        }
        self.st.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for NavGuard {
    fn drop(&mut self) {
        if self.thread.is_some() {
            self.stop();
        }
    }
}

pub struct Page {
    pub cdp: Arc<Cdp>,
    pub dirs: Dirs,
    pub target: String,
    pub session: String,
    pub logs: Arc<Mutex<Logs>>,
}

fn push<T>(q: &mut VecDeque<T>, x: T) {
    if q.len() >= MAX_LOG {
        q.pop_front();
    }
    q.push_back(x);
}

fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

impl Page {
    /// Conecta na aba ativa do workspace (cria uma se não houver nenhuma).
    pub fn attach(cdp: Arc<Cdp>, dirs: &Dirs) -> Result<Page> {
        let tabs = super::tabs(&cdp, dirs)?;
        let target = match tabs.iter().find(|t| t.active) {
            Some(t) => t.id.clone(),
            None => cdp.call(None, "Target.createTarget", json!({ "url": "about:blank" }))?["targetId"].as_str().unwrap_or_default().to_string(),
        };
        Self::attach_to(cdp, dirs, &target)
    }

    pub fn attach_to(cdp: Arc<Cdp>, dirs: &Dirs, target: &str) -> Result<Page> {
        let events = cdp.subscribe();
        let r = cdp.call(None, "Target.attachToTarget", json!({ "targetId": target, "flatten": true }))?;
        let session = r["sessionId"].as_str().context("sem sessionId")?.to_string();
        let logs: Arc<Mutex<Logs>> = Default::default();
        let (l2, s2) = (logs.clone(), session.clone());
        std::thread::Builder::new().name("kabul-cdp-ev".into()).spawn(move || collect(events, &s2, &l2))?;
        let p = Page { cdp, dirs: dirs.clone(), target: target.to_string(), session, logs };
        for m in ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"] {
            let _ = p.call(m, json!({}));
        }
        let _ = p.call("Page.setLifecycleEventsEnabled", json!({ "enabled": true }));
        p.apply_viewport(&super::viewport(dirs))?;
        let _ = super::set_active_target(dirs, target);
        Ok(p)
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.cdp.call(Some(&self.session), method, params)
    }

    pub fn detach(&self) {
        let _ = self.cdp.call_timeout(None, "Target.detachFromTarget", json!({ "sessionId": self.session }), Duration::from_secs(2));
    }

    pub fn apply_viewport(&self, v: &Viewport) -> Result<()> {
        self.call("Emulation.setDeviceMetricsOverride", json!({ "width": v.width, "height": v.height, "deviceScaleFactor": if v.mobile { v.scale } else { 1.0 }, "mobile": v.mobile }))?;
        let _ = self.call("Emulation.setTouchEmulationEnabled", json!({ "enabled": v.mobile, "maxTouchPoints": if v.mobile { 5 } else { 1 } }));
        Ok(())
    }

    pub fn eval(&self, expr: &str) -> Result<Value> {
        let r = self.call("Runtime.evaluate", json!({ "expression": expr, "returnByValue": true, "awaitPromise": true, "userGesture": true }))?;
        if let Some(ex) = r.get("exceptionDetails") {
            let msg = ex.pointer("/exception/description").and_then(Value::as_str).or_else(|| ex.get("text").and_then(Value::as_str)).unwrap_or("erro");
            bail!("{}", cut(msg, 500));
        }
        Ok(r.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    pub fn url_title(&self) -> (String, String) {
        let v = self.eval("[location.href, document.title]").unwrap_or(Value::Null);
        (v[0].as_str().unwrap_or("").into(), v[1].as_str().unwrap_or("").into())
    }

    /// Liga a política de navegação para uma ação do agente: toda navegação da aba (link clicado,
    /// formulário enviado, `location = ...`, redirecionamento) para no CDP (`Fetch.requestPaused` do
    /// documento principal) e só segue se `check` deixar — que pode perguntar ao usuário. Abas que a
    /// página abrir durante a ação (`target=_blank`, `window.open`) nascem pausadas
    /// (`Target.setAutoAttach` com `waitForDebuggerOnStart`) e passam pela mesma política; negada, a
    /// aba nova é fechada. Iframes e recursos passam. Desligue com [`NavGuard::finish`] (espera as
    /// decisões pendentes).
    pub fn guard(&self, check: NavCheck) -> Result<NavGuard> {
        let events = self.cdp.subscribe();
        let st = Arc::new(GuardState::default());
        st.sessions.lock().unwrap().insert(self.session.clone(), self.target.clone());
        let (cdp, main_session, st2) = (self.cdp.clone(), self.session.clone(), st.clone());
        let thread = std::thread::Builder::new().name("kabul-cdp-guard".into()).spawn(move || {
            while !st2.stop.load(Ordering::Relaxed) {
                let Ok(ev) = events.recv_timeout(Duration::from_millis(50)) else { continue };
                let p = &ev.params;
                match ev.method.as_str() {
                    // Alvo novo (pausado antes de carregar) ou um que já existia (anexado pelo auto-attach).
                    "Target.attachedToTarget" if ev.session.is_none() => {
                        let child = p["sessionId"].as_str().unwrap_or("").to_string();
                        let info = &p["targetInfo"];
                        let tid = info["targetId"].as_str().unwrap_or("").to_string();
                        let waiting = p["waitingForDebugger"].as_bool().unwrap_or(false);
                        if waiting && info["type"] == "page" {
                            st2.busy.fetch_add(1, Ordering::SeqCst);
                            let _ = cdp.call_timeout(Some(&child), "Fetch.enable", fetch_patterns(), Duration::from_secs(5));
                            st2.sessions.lock().unwrap().insert(child.clone(), tid);
                            st2.popups.lock().unwrap().push(child.clone());
                            cdp.send(Some(&child), "Runtime.runIfWaitingForDebugger", json!({}));
                            *st2.last.lock().unwrap() = Some(Instant::now());
                            st2.busy.fetch_sub(1, Ordering::SeqCst);
                        } else {
                            if waiting {
                                cdp.send(Some(&child), "Runtime.runIfWaitingForDebugger", json!({}));
                            }
                            cdp.send(None, "Target.detachFromTarget", json!({ "sessionId": child }));
                        }
                    }
                    "Fetch.requestPaused" => {
                        let Some(session) = ev.session.clone() else { continue };
                        let Some(target) = st2.sessions.lock().unwrap().get(&session).cloned() else { continue };
                        st2.busy.fetch_add(1, Ordering::SeqCst);
                        let id = p["requestId"].clone();
                        let url = p.pointer("/request/url").and_then(Value::as_str).unwrap_or("").to_string();
                        // Só o documento principal de cada aba (frameId do quadro principal = id do alvo).
                        let main = p["frameId"].as_str() == Some(target.as_str()) && p["resourceType"].as_str().is_none_or(|t| t == "Document");
                        if !main || check(&url) {
                            if main {
                                st2.allowed.fetch_add(1, Ordering::SeqCst);
                            }
                            cdp.send(Some(&session), "Fetch.continueRequest", json!({ "requestId": id }));
                        } else {
                            st2.denied.lock().unwrap().push(url);
                            // Aborted (e não BlockedByClient): a aba fica onde estava, sem página de erro.
                            cdp.send(Some(&session), "Fetch.failRequest", json!({ "requestId": id, "errorReason": "Aborted" }));
                            if session != main_session {
                                cdp.send(None, "Target.closeTarget", json!({ "targetId": target }));
                            }
                        }
                        *st2.last.lock().unwrap() = Some(Instant::now());
                        st2.busy.fetch_sub(1, Ordering::SeqCst);
                    }
                    _ => {}
                }
            }
        })?;
        let g = NavGuard { cdp: self.cdp.clone(), session: self.session.clone(), st, thread: Some(thread) };
        self.call("Fetch.enable", fetch_patterns())?;
        let _ = self.cdp.call(None, "Target.setAutoAttach", json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }));
        Ok(g)
    }

    /// Espera o carregamento (`load`) depois de uma navegação, com prazo.
    pub(crate) fn wait_load(&self, before: u64, timeout: Duration) {
        let t0 = Instant::now();
        while t0.elapsed() < timeout {
            if self.logs.lock().unwrap().loads > before {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    pub(crate) fn loads(&self) -> u64 {
        self.logs.lock().unwrap().loads
    }

    pub fn navigate(&self, url: &str) -> Result<String> {
        let before = self.loads();
        let r = self.call("Page.navigate", json!({ "url": url }))?;
        if let Some(e) = r.get("errorText").and_then(Value::as_str).filter(|e| !e.is_empty()) {
            bail!("não abriu {url}: {e}");
        }
        self.wait_load(before, Duration::from_secs(15));
        Ok(self.where_now())
    }

    pub fn where_now(&self) -> String {
        let (u, t) = self.url_title();
        if t.is_empty() {
            u
        } else {
            format!("{u} — {}", cut(&t, 80))
        }
    }

    pub fn history(&self, delta: i64) -> Result<String> {
        let h = self.call("Page.getNavigationHistory", json!({}))?;
        let cur = h["currentIndex"].as_i64().unwrap_or(0);
        let entries = h["entries"].as_array().cloned().unwrap_or_default();
        let i = cur + delta;
        if i < 0 || i as usize >= entries.len() {
            bail!("{}", if delta < 0 { "não há página anterior" } else { "não há próxima página" });
        }
        let before = self.loads();
        self.call("Page.navigateToHistoryEntry", json!({ "entryId": entries[i as usize]["id"] }))?;
        self.wait_load(before, Duration::from_secs(10));
        Ok(self.where_now())
    }

    pub fn reload(&self) -> Result<String> {
        let before = self.loads();
        self.call("Page.reload", json!({}))?;
        self.wait_load(before, Duration::from_secs(15));
        Ok(self.where_now())
    }

    // ---------- elementos ----------

    /// `e123` (ref do snapshot) ou seletor CSS → backendNodeId.
    pub fn resolve(&self, target: &str) -> Result<i64> {
        let t = target.trim();
        if let Some(n) = t.strip_prefix('e').and_then(|n| n.parse::<i64>().ok()) {
            return Ok(n);
        }
        let r = self.call("Runtime.evaluate", json!({ "expression": format!("document.querySelector({})", serde_json::to_string(t)?) }))?;
        if r.get("exceptionDetails").is_some() {
            bail!("seletor inválido: {t}");
        }
        let oid = r.pointer("/result/objectId").and_then(Value::as_str).ok_or_else(|| anyhow!("nenhum elemento casa com {t}"))?;
        let d = self.call("DOM.describeNode", json!({ "objectId": oid }))?;
        d.pointer("/node/backendNodeId").and_then(Value::as_i64).context("elemento sem id")
    }

    fn object(&self, node: i64) -> Result<String> {
        let r = self.call("DOM.resolveNode", json!({ "backendNodeId": node })).map_err(|_| anyhow!("ref e{node} não existe mais (a página mudou): tire outro snapshot"))?;
        r.pointer("/object/objectId").and_then(Value::as_str).map(String::from).context("elemento sem objeto")
    }

    fn call_on(&self, node: i64, func: &str, args: Vec<Value>) -> Result<Value> {
        let oid = self.object(node)?;
        let r = self.call(
            "Runtime.callFunctionOn",
            json!({ "objectId": oid, "functionDeclaration": func, "arguments": args.into_iter().map(|v| json!({ "value": v })).collect::<Vec<_>>(), "returnByValue": true, "awaitPromise": true, "userGesture": true }),
        )?;
        if let Some(ex) = r.get("exceptionDetails") {
            bail!("{}", ex.pointer("/exception/description").and_then(Value::as_str).unwrap_or("erro"));
        }
        Ok(r.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    /// Centro visível do elemento (rola até ele antes).
    fn center(&self, node: i64) -> Result<(f64, f64)> {
        let _ = self.call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": node }));
        let q = self.call("DOM.getContentQuads", json!({ "backendNodeId": node })).map_err(|_| anyhow!("ref e{node} não existe mais ou não está visível: tire outro snapshot"))?;
        let quad = q["quads"].as_array().and_then(|a| a.first()).and_then(Value::as_array).ok_or_else(|| anyhow!("elemento sem área visível"))?;
        let n: Vec<f64> = quad.iter().filter_map(Value::as_f64).collect();
        if n.len() < 8 {
            bail!("elemento sem área visível");
        }
        Ok(((n[0] + n[2] + n[4] + n[6]) / 4.0, (n[1] + n[3] + n[5] + n[7]) / 4.0))
    }

    fn describe(&self, node: i64) -> String {
        self.call_on(node, "function(){const t=(this.innerText||this.value||this.getAttribute('aria-label')||this.getAttribute('placeholder')||'').trim().replace(/\\s+/g,' ').slice(0,60);return this.tagName.toLowerCase()+(t?` \"${t}\"`:'')}", vec![])
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| format!("e{node}"))
    }

    pub fn mouse(&self, kind: &str, x: f64, y: f64, button: &str, clicks: u32, modifiers: u32) -> Result<()> {
        self.call("Input.dispatchMouseEvent", json!({ "type": kind, "x": x, "y": y, "button": button, "clickCount": clicks, "modifiers": modifiers, "buttons": if kind == "mousePressed" { 1 } else { 0 } }))?;
        Ok(())
    }

    pub fn click_at(&self, x: f64, y: f64, button: &str, clicks: u32) -> Result<()> {
        self.mouse("mouseMoved", x, y, "none", 0, 0)?;
        for c in 1..=clicks.max(1) {
            self.mouse("mousePressed", x, y, button, c, 0)?;
            self.mouse("mouseReleased", x, y, button, c, 0)?;
        }
        Ok(())
    }

    /// Depois de uma ação: dá um tempo para a página reagir (navegação, rede).
    fn settle(&self, before_url: &str, before_loads: u64) -> String {
        std::thread::sleep(Duration::from_millis(150));
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_millis(1500) {
            if self.logs.lock().unwrap().inflight.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(80));
        }
        let (u, t) = self.url_title();
        if u != before_url {
            if self.loads() == before_loads {
                self.wait_load(before_loads, Duration::from_secs(5));
            }
            format!(" Página agora: {u}{}", if t.is_empty() { String::new() } else { format!(" — {}", cut(&t, 80)) })
        } else {
            String::new()
        }
    }

    pub fn click(&self, target: &str, double: bool, button: &str) -> Result<String> {
        let node = self.resolve(target)?;
        let what = self.describe(node);
        let (x, y) = self.center(node)?;
        let (u, l) = (self.url_title().0, self.loads());
        self.click_at(x, y, button, if double { 2 } else { 1 })?;
        Ok(format!("Clicou em {what}.{}", self.settle(&u, l)))
    }

    pub fn hover(&self, target: &str) -> Result<String> {
        let node = self.resolve(target)?;
        let (x, y) = self.center(node)?;
        self.mouse("mouseMoved", x, y, "none", 0, 0)?;
        Ok(format!("Mouse sobre {}.", self.describe(node)))
    }

    pub fn type_text(&self, target: &str, text: &str, clear: bool, submit: bool) -> Result<String> {
        let node = self.resolve(target)?;
        let _ = self.call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": node }));
        self.call("DOM.focus", json!({ "backendNodeId": node })).map_err(|_| anyhow!("não deu para focar {target}: não é um campo editável?"))?;
        if clear {
            self.call_on(node, "function(){if('value' in this){this.value='';this.dispatchEvent(new Event('input',{bubbles:true}))}else if(this.isContentEditable){this.textContent=''}}", vec![])?;
        }
        self.call("Input.insertText", json!({ "text": text }))?;
        let what = self.describe(node);
        if submit {
            let (u, l) = (self.url_title().0, self.loads());
            self.press("Enter")?;
            return Ok(format!("Digitou em {what} e enviou.{}", self.settle(&u, l)));
        }
        Ok(format!("Digitou {} caracteres em {what}.", text.chars().count()))
    }

    /// Tecla com modificadores: `Enter`, `Tab`, `Control+a`, `Meta+Shift+K`.
    pub fn press(&self, combo: &str) -> Result<String> {
        let parts: Vec<&str> = combo.split('+').map(str::trim).filter(|s| !s.is_empty()).collect();
        let Some((key, mods)) = parts.split_last() else { bail!("tecla vazia") };
        let mut m = 0u32;
        for x in mods {
            m |= match x.to_ascii_lowercase().as_str() {
                "alt" | "option" => 1,
                "control" | "ctrl" => 2,
                "meta" | "cmd" | "command" => 4,
                "shift" => 8,
                o => bail!("modificador desconhecido: {o}"),
            };
        }
        let k = key_info(key, m & 8 != 0);
        let text = if m & (1 | 2 | 4) != 0 { String::new() } else { k.text.clone() };
        let base = json!({ "key": k.key, "code": k.code, "windowsVirtualKeyCode": k.vk, "nativeVirtualKeyCode": k.vk, "modifiers": m });
        let mut down = base.clone();
        down["type"] = json!(if text.is_empty() { "rawKeyDown" } else { "keyDown" });
        if !text.is_empty() {
            down["text"] = json!(text);
            down["unmodifiedText"] = json!(text);
        }
        self.call("Input.dispatchKeyEvent", down)?;
        let mut up = base;
        up["type"] = json!("keyUp");
        self.call("Input.dispatchKeyEvent", up)?;
        Ok(format!("Tecla {combo}."))
    }

    pub fn select(&self, target: &str, values: &[String]) -> Result<String> {
        let node = self.resolve(target)?;
        let r = self.call_on(
            node,
            "function(vals){if(this.tagName!=='SELECT')throw new Error('não é um <select>');const got=[];for(const o of this.options){const on=vals.includes(o.value)||vals.includes(o.label)||vals.includes(o.text.trim());o.selected=on;if(on)got.push(o.label||o.value)}if(!got.length)throw new Error('nenhuma opção casa com '+vals.join(', '));this.dispatchEvent(new Event('input',{bubbles:true}));this.dispatchEvent(new Event('change',{bubbles:true}));return got}",
            vec![json!(values)],
        )?;
        Ok(format!("Selecionou {} em {}.", r.as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default(), self.describe(node)))
    }

    pub fn scroll(&self, target: Option<&str>, dy: f64, dx: f64) -> Result<String> {
        if let Some(t) = target {
            let node = self.resolve(t)?;
            self.call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": node }))?;
            return Ok(format!("Rolou até {}.", self.describe(node)));
        }
        let v = super::viewport(&self.dirs);
        self.call("Input.dispatchMouseEvent", json!({ "type": "mouseWheel", "x": v.width as f64 / 2.0, "y": v.height as f64 / 2.0, "deltaX": dx, "deltaY": dy }))?;
        std::thread::sleep(Duration::from_millis(120));
        let pos = self.eval("[Math.round(scrollY), Math.round(document.documentElement.scrollHeight - innerHeight)]").unwrap_or(Value::Null);
        Ok(format!("Rolou. Posição {} de {} px.", pos[0], pos[1]))
    }

    /// Espera um texto/seletor aparecer (ou sumir, com `gone`) ou a rede ficar ociosa (500 ms).
    pub fn wait_for(&self, text: Option<&str>, selector: Option<&str>, gone: bool, idle: bool, timeout: Duration) -> Result<String> {
        let t0 = Instant::now();
        let check = if let Some(t) = text { Some(format!("(document.body?.innerText||'').includes({})", serde_json::to_string(t)?)) } else { selector.map(|s| format!("!!document.querySelector({})", serde_json::to_string(s).unwrap_or_default())) };
        loop {
            let mut ok = true;
            if let Some(c) = &check {
                let found = self.eval(c).ok().and_then(|v| v.as_bool()).unwrap_or(false);
                ok &= found != gone;
            }
            if idle {
                let l = self.logs.lock().unwrap();
                ok &= l.inflight.is_empty() && l.last_net.is_none_or(|t| t.elapsed() > Duration::from_millis(500));
            }
            if ok {
                let what = text.map(|t| format!("texto \"{}\"", cut(t, 60))).or(selector.map(|s| format!("seletor {s}"))).unwrap_or_else(|| "rede ociosa".into());
                return Ok(format!("Pronto ({what}{}) em {} ms.", if gone { " sumiu" } else { "" }, t0.elapsed().as_millis()));
            }
            if t0.elapsed() > timeout {
                bail!("tempo esgotado ({} ms) esperando {}", timeout.as_millis(), text.or(selector).unwrap_or("a rede ficar ociosa"));
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }

    pub fn screenshot(&self, full: bool, target: Option<&str>, format: &str, quality: u32) -> Result<String> {
        let mut p = json!({ "format": format, "captureBeyondViewport": full });
        if format == "jpeg" {
            p["quality"] = json!(quality);
        }
        if let Some(t) = target {
            let node = self.resolve(t)?;
            let _ = self.call("DOM.scrollIntoViewIfNeeded", json!({ "backendNodeId": node }));
            let b = self.call("DOM.getBoxModel", json!({ "backendNodeId": node }))?;
            let c: Vec<f64> = b.pointer("/model/border").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
            if c.len() >= 8 {
                let (x0, y0) = (c[0].min(c[6]), c[1].min(c[3]));
                let (x1, y1) = (c[2].max(c[4]), c[5].max(c[7]));
                let sc = self.eval("[scrollX, scrollY]").unwrap_or(json!([0, 0]));
                p["clip"] = json!({ "x": x0 + sc[0].as_f64().unwrap_or(0.0), "y": y0 + sc[1].as_f64().unwrap_or(0.0), "width": (x1 - x0).max(1.0), "height": (y1 - y0).max(1.0), "scale": 1 });
                p["captureBeyondViewport"] = json!(true);
            }
        } else if full {
            let m = self.call("Page.getLayoutMetrics", json!({}))?;
            let w = m.pointer("/cssContentSize/width").and_then(Value::as_f64).unwrap_or(1280.0);
            let h = m.pointer("/cssContentSize/height").and_then(Value::as_f64).unwrap_or(800.0).min(8000.0);
            p["clip"] = json!({ "x": 0, "y": 0, "width": w, "height": h, "scale": 1 });
        }
        let r = self.call("Page.captureScreenshot", p)?;
        r["data"].as_str().map(String::from).context("captura vazia")
    }

    // ---------- snapshot de acessibilidade ----------

    /// Árvore de acessibilidade compacta: uma linha por nó com papel, nome e `[ref=eN]` nos
    /// interativos. `max` limita o tamanho (o resto é cortado com aviso).
    pub fn snapshot(&self, max: usize, root: Option<&str>) -> Result<String> {
        let _ = self.call("Accessibility.enable", json!({}));
        let tree = self.call("Accessibility.getFullAXTree", json!({}))?;
        let nodes = tree["nodes"].as_array().cloned().unwrap_or_default();
        let (u, t) = self.url_title();
        let body = render_ax(&nodes, root.and_then(|r| r.strip_prefix('e')).and_then(|n| n.parse().ok()), max);
        Ok(format!("URL: {u}\nTítulo: {t}\n{body}"))
    }

    // ---------- console e rede ----------

    pub fn console(&self, n: usize, level: Option<&str>) -> String {
        let l = self.logs.lock().unwrap();
        let v: Vec<String> = l
            .console
            .iter()
            .filter(|m| level.is_none_or(|lv| lv == "all" || m.level == lv || (lv == "error" && m.level == "exception")))
            .rev()
            .take(n)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|m| format!("[{}] {}", m.level, cut(&m.text, 300)))
            .collect();
        if v.is_empty() {
            "Console vazio (desde que este agente conectou).".into()
        } else {
            v.join("\n")
        }
    }

    pub fn network(&self, n: usize, failed_only: bool, filter: Option<&str>) -> String {
        let l = self.logs.lock().unwrap();
        let v: Vec<String> = l
            .net
            .iter()
            .filter(|r| !failed_only || r.failed.is_some() || r.status.is_some_and(|s| s >= 400))
            .filter(|r| filter.is_none_or(|f| r.url.contains(f)))
            .rev()
            .take(n)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|r| {
                let st = r.failed.clone().map(|f| format!("FALHOU {f}")).unwrap_or_else(|| r.status.map(|s| s.to_string()).unwrap_or_else(|| "…".into()));
                let ms = r.end.map(|e| format!(" {}ms", ((e - r.start) * 1000.0).round() as i64)).unwrap_or_default();
                let kb = if r.bytes > 0 { format!(" {:.1}KB", r.bytes as f64 / 1024.0) } else { String::new() };
                format!("{} {} {} [{}]{ms}{kb}", r.method, cut(&r.url, 140), st, r.kind)
            })
            .collect();
        if v.is_empty() {
            "Nenhuma requisição registrada (desde que este agente conectou).".into()
        } else {
            v.join("\n")
        }
    }
}

/// Lê os eventos da sessão e guarda console, rede e carregamentos.
fn collect(rx: std::sync::mpsc::Receiver<CdpEvent>, session: &str, logs: &Mutex<Logs>) {
    for ev in rx {
        if ev.session.as_deref() != Some(session) {
            if ev.method == "Target.detachedFromTarget" && ev.params["sessionId"] == session {
                return;
            }
            continue;
        }
        let p = &ev.params;
        let mut l = logs.lock().unwrap();
        match ev.method.as_str() {
            "Page.loadEventFired" => l.loads += 1,
            "Runtime.consoleAPICalled" => {
                let text = p["args"].as_array().map(|a| a.iter().map(remote_text).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                let level = match p["type"].as_str().unwrap_or("log") {
                    "warning" => "warn",
                    t => t,
                }
                .to_string();
                push(&mut l.console, ConsoleMsg { level, text, at: super::now_ms() });
            }
            "Runtime.exceptionThrown" => {
                let d = &p["exceptionDetails"];
                let text = d.pointer("/exception/description").and_then(Value::as_str).or_else(|| d["text"].as_str()).unwrap_or("exceção").to_string();
                push(&mut l.console, ConsoleMsg { level: "exception".into(), text, at: super::now_ms() });
            }
            "Log.entryAdded" => {
                let e = &p["entry"];
                let level = match e["level"].as_str().unwrap_or("info") {
                    "warning" => "warn",
                    "verbose" => "debug",
                    x => x,
                }
                .to_string();
                let text = format!("{}{}", e["text"].as_str().unwrap_or(""), e["url"].as_str().map(|u| format!(" ({u})")).unwrap_or_default());
                push(&mut l.console, ConsoleMsg { level, text, at: super::now_ms() });
            }
            "Network.requestWillBeSent" => {
                let id = p["requestId"].as_str().unwrap_or("").to_string();
                l.inflight.insert(id.clone(), Instant::now());
                l.last_net = Some(Instant::now());
                let r = NetReq {
                    id,
                    method: p.pointer("/request/method").and_then(Value::as_str).unwrap_or("GET").into(),
                    url: p.pointer("/request/url").and_then(Value::as_str).unwrap_or("").into(),
                    kind: p["type"].as_str().unwrap_or("Other").into(),
                    start: p["timestamp"].as_f64().unwrap_or(0.0),
                    ..Default::default()
                };
                push(&mut l.net, r);
            }
            "Network.responseReceived" => {
                let id = p["requestId"].as_str().unwrap_or("");
                if let Some(r) = l.net.iter_mut().rev().find(|r| r.id == id) {
                    r.status = p.pointer("/response/status").and_then(Value::as_u64).map(|s| s as u16);
                }
            }
            "Network.loadingFinished" | "Network.loadingFailed" => {
                let id = p["requestId"].as_str().unwrap_or("").to_string();
                l.inflight.remove(&id);
                l.last_net = Some(Instant::now());
                if let Some(r) = l.net.iter_mut().rev().find(|r| r.id == id) {
                    r.end = p["timestamp"].as_f64();
                    r.bytes = p["encodedDataLength"].as_f64().unwrap_or(0.0) as u64;
                    if ev.method == "Network.loadingFailed" {
                        r.failed = Some(p["errorText"].as_str().unwrap_or("erro").to_string());
                    }
                }
            }
            _ => {}
        }
    }
}

fn remote_text(v: &Value) -> String {
    match v.get("value") {
        Some(Value::String(s)) => s.clone(),
        Some(x) if !x.is_null() => x.to_string(),
        _ => v.get("description").and_then(Value::as_str).or_else(|| v.get("unserializableValue").and_then(Value::as_str)).unwrap_or(v["type"].as_str().unwrap_or("")).to_string(),
    }
}

struct Key {
    key: String,
    code: String,
    vk: u32,
    text: String,
}

fn key_info(k: &str, shift: bool) -> Key {
    let named: &[(&str, &str, u32, &str)] = &[
        ("Enter", "Enter", 13, "\r"),
        ("Tab", "Tab", 9, "\t"),
        ("Escape", "Escape", 27, ""),
        ("Backspace", "Backspace", 8, ""),
        ("Delete", "Delete", 46, ""),
        ("ArrowUp", "ArrowUp", 38, ""),
        ("ArrowDown", "ArrowDown", 40, ""),
        ("ArrowLeft", "ArrowLeft", 37, ""),
        ("ArrowRight", "ArrowRight", 39, ""),
        ("Home", "Home", 36, ""),
        ("End", "End", 35, ""),
        ("PageUp", "PageUp", 33, ""),
        ("PageDown", "PageDown", 34, ""),
        ("Space", "Space", 32, " "),
        (" ", "Space", 32, " "),
    ];
    let norm = match k.to_ascii_lowercase().as_str() {
        "esc" => "Escape".to_string(),
        "return" => "Enter".to_string(),
        "up" => "ArrowUp".to_string(),
        "down" => "ArrowDown".to_string(),
        "left" => "ArrowLeft".to_string(),
        "right" => "ArrowRight".to_string(),
        _ => k.to_string(),
    };
    if let Some((key, code, vk, text)) = named.iter().find(|(n, ..)| n.eq_ignore_ascii_case(&norm)) {
        return Key { key: if *key == "Space" { " ".into() } else { (*key).into() }, code: (*code).into(), vk: *vk, text: (*text).into() };
    }
    if let Some(n) = norm.strip_prefix(['F', 'f']).and_then(|n| n.parse::<u32>().ok()).filter(|n| (1..=12).contains(n)) {
        return Key { key: format!("F{n}"), code: format!("F{n}"), vk: 111 + n, text: String::new() };
    }
    let c = norm.chars().next().unwrap_or(' ');
    let ch = if shift { c.to_ascii_uppercase() } else { c };
    let (code, vk) = if c.is_ascii_alphabetic() {
        (format!("Key{}", c.to_ascii_uppercase()), c.to_ascii_uppercase() as u32)
    } else if c.is_ascii_digit() {
        (format!("Digit{c}"), c as u32)
    } else {
        (String::new(), 0)
    };
    Key { key: ch.to_string(), code, vk, text: ch.to_string() }
}

const INTERACTIVE: &[&str] =
    &["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem", "textarea", "ComboBoxSelect"];
const SKIP: &[&str] = &["none", "generic", "InlineTextBox", "LineBreak", "presentation", "RootWebArea", "WebArea", "MenuListPopup"];
/// Só aparecem com nome.
const SKIP_UNNAMED: &[&str] = &["LabelText", "paragraph", "Section", "group", "list", "listitem", "region", "contentinfo", "banner", "main", "navigation", "article", "figure", "Pre", "blockquote"];

fn ax_str(n: &Value, k: &str) -> String {
    n.pointer(&format!("/{k}/value"))
        .map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            x => x.to_string(),
        })
        .unwrap_or_default()
}

/// Monta o texto do snapshot a partir dos nós do `Accessibility.getFullAXTree`.
pub fn render_ax(nodes: &[Value], root_backend: Option<i64>, max: usize) -> String {
    let by_id: HashMap<&str, &Value> = nodes.iter().filter_map(|n| n["nodeId"].as_str().map(|id| (id, n))).collect();
    let root = match root_backend {
        Some(b) => nodes.iter().find(|n| n["backendDOMNodeId"].as_i64() == Some(b)),
        None => nodes.iter().find(|n| n["parentId"].is_null()),
    };
    let Some(root) = root else { return "(página vazia)".into() };
    let mut out = String::new();
    let mut truncated = false;
    fn walk(n: &Value, by_id: &HashMap<&str, &Value>, depth: usize, out: &mut String, max: usize, truncated: &mut bool, parent: &[String; 2]) {
        if *truncated {
            return;
        }
        let role = ax_str(n, "role");
        let name = ax_str(n, "name").trim().replace('\n', " ");
        let ignored = n["ignored"].as_bool().unwrap_or(false);
        let props: HashMap<String, Value> = n["properties"].as_array().map(|a| a.iter().filter_map(|p| Some((p["name"].as_str()?.to_string(), p.pointer("/value/value").cloned().unwrap_or(Value::Null)))).collect()).unwrap_or_default();
        let focusable = props.get("focusable").and_then(Value::as_bool).unwrap_or(false);
        let interactive = INTERACTIVE.contains(&role.as_str()) || (focusable && !SKIP.contains(&role.as_str()) && role != "StaticText");
        let mut line = None;
        let mut next_depth = depth;
        if !ignored {
            if role == "StaticText" {
                if !name.is_empty() && !parent.contains(&name) {
                    line = Some(format!("text: {}", cut(&name, 200)));
                }
            } else if (!SKIP.contains(&role.as_str()) && !(name.is_empty() && SKIP_UNNAMED.contains(&role.as_str()))) || (role == "generic" && interactive) {
                let mut l = role.clone();
                if !name.is_empty() {
                    l.push_str(&format!(" \"{}\"", cut(&name, 120)));
                }
                let value = ax_str(n, "value");
                if !value.is_empty() {
                    l.push_str(&format!(" value=\"{}\"", cut(&value, 80)));
                }
                for (k, show) in [("level", "level"), ("checked", "checked"), ("expanded", "expanded"), ("selected", "selected"), ("disabled", "disabled"), ("required", "required"), ("pressed", "pressed")] {
                    match props.get(k) {
                        Some(Value::Bool(true)) => l.push_str(&format!(" [{show}]")),
                        Some(Value::String(s)) if s != "false" => l.push_str(&format!(" [{show}={s}]")),
                        Some(Value::Number(x)) => l.push_str(&format!(" [{show}={x}]")),
                        _ => {}
                    }
                }
                if let Some(b) = n["backendDOMNodeId"].as_i64().filter(|_| interactive) {
                    l.push_str(&format!(" [ref=e{b}]"));
                }
                line = Some(l);
            }
        }
        if let Some(l) = line {
            let s = format!("{}- {l}\n", "  ".repeat(depth));
            if out.len() + s.len() > max {
                *truncated = true;
                return;
            }
            out.push_str(&s);
            next_depth = depth + 1;
        }
        // Filhos de controles com nome (ex.: o texto de um botão) repetem o nome: pula o texto igual.
        let value = ax_str(n, "value");
        let pname = if name.is_empty() && value.is_empty() { parent.clone() } else { [name.clone(), value] };
        if let Some(kids) = n["childIds"].as_array() {
            for k in kids {
                if let Some(c) = k.as_str().and_then(|id| by_id.get(id)) {
                    walk(c, by_id, next_depth, out, max, truncated, &pname);
                }
            }
        }
    }
    walk(root, &by_id, 0, &mut out, max, &mut truncated, &[String::new(), String::new()]);
    if out.is_empty() {
        out.push_str("(nada visível na árvore de acessibilidade)\n");
    }
    if truncated {
        out.push_str(&format!("… (cortado em {max} caracteres: use `root` com uma ref para ver só um trecho)\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_compacto_com_refs() {
        let n = |id: &str, role: &str, name: &str, kids: &[&str], b: i64, parent: Option<&str>| json!({ "nodeId": id, "role": { "value": role }, "name": { "value": name }, "childIds": kids, "backendDOMNodeId": b, "parentId": parent, "ignored": false, "properties": [] });
        let nodes = vec![
            n("1", "RootWebArea", "Teste", &["2", "3", "5"], 1, None),
            n("2", "heading", "Olá", &["6"], 2, Some("1")),
            n("6", "StaticText", "Olá", &[], 6, Some("2")),
            n("3", "generic", "", &["4"], 3, Some("1")),
            n("4", "button", "Enviar", &[], 42, Some("3")),
            n("5", "StaticText", "rodapé", &[], 5, Some("1")),
        ];
        let s = render_ax(&nodes, None, 10_000);
        assert_eq!(s, "- heading \"Olá\"\n- button \"Enviar\" [ref=e42]\n- text: rodapé\n");
        assert!(render_ax(&nodes, None, 20).contains("cortado"));
        assert_eq!(render_ax(&nodes, Some(42), 1000), "- button \"Enviar\" [ref=e42]\n");
    }

    #[test]
    fn teclas() {
        let k = key_info("Enter", false);
        assert_eq!((k.key.as_str(), k.vk, k.text.as_str()), ("Enter", 13, "\r"));
        assert_eq!(key_info("a", true).key, "A");
        assert_eq!(key_info("esc", false).key, "Escape");
        assert_eq!(key_info("F5", false).vk, 116);
    }
}
