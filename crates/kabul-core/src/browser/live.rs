//! Lado do humano (app desktop e kabuld): uma conexão por workspace, reaproveitada entre comandos,
//! com screencast (quadros JPEG do `Page.startScreencast`) e entrada de mouse/teclado.
//!
//! Por que screencast e não uma webview acoplada: o Chromium do Kabul é headless e único por
//! workspace (o mesmo dos agentes); o screencast funciona igual no macOS e no Windows, dentro da
//! janela do app, sem depender de WKWebView/WebView2 (que não falam CDP) nem de janelas nativas
//! sobrepostas, e a mesma imagem serve o celular.
use super::page::Page;
use super::{Cdp, Dirs, Endpoint};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

struct Conn {
    ws: String,
    cdp: Arc<Cdp>,
    page: Option<Arc<Page>>,
    cast: Option<Arc<AtomicBool>>,
}

fn conns() -> &'static Mutex<HashMap<String, Conn>> {
    static C: OnceLock<Mutex<HashMap<String, Conn>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Conexão de navegador (sem aba) reaproveitada para o workspace.
pub fn cdp_for(workspace: &str, e: &Endpoint) -> Result<Arc<Cdp>> {
    let mut m = conns().lock().unwrap();
    if let Some(c) = m.get(workspace).filter(|c| c.ws == e.ws && !c.cdp.is_closed()) {
        return Ok(c.cdp.clone());
    }
    let cdp = Cdp::connect(&e.ws)?;
    // Eventos de abas (título/URL mudaram, aba nova/fechada) para a interface se atualizar.
    let _ = cdp.call(None, "Target.setDiscoverTargets", json!({ "discover": true }));
    m.insert(workspace.into(), Conn { ws: e.ws.clone(), cdp: cdp.clone(), page: None, cast: None });
    Ok(cdp)
}

/// Esquece a conexão (o navegador fechou ou foi limpo).
pub fn forget(workspace: &str) {
    if let Some(c) = conns().lock().unwrap().remove(workspace) {
        if let Some(f) = c.cast {
            f.store(false, Ordering::Relaxed);
        }
        c.cdp.close();
    }
}

/// Aba ativa do workspace pela conexão do humano (abre o navegador se preciso).
pub fn page(d: &Dirs) -> Result<Arc<Page>> {
    let e = super::ensure(d)?;
    let cdp = cdp_for(&d.workspace, &e)?;
    let want = super::active_target(d);
    {
        let m = conns().lock().unwrap();
        if let Some(p) = m.get(&d.workspace).and_then(|c| c.page.clone()) {
            if !p.cdp.is_closed() && want.as_deref().is_none_or(|w| w == p.target) {
                return Ok(p);
            }
        }
    }
    let p = Arc::new(match want {
        Some(t) => Page::attach_to(cdp.clone(), d, &t).or_else(|_| Page::attach(cdp, d))?,
        None => Page::attach(cdp, d)?,
    });
    if let Some(c) = conns().lock().unwrap().get_mut(&d.workspace) {
        if let Some(old) = c.page.replace(p.clone()) {
            old.detach();
        }
    }
    Ok(p)
}

/// Evento de entrada vindo da aba Browser (coordenadas em pixels CSS da página).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Input {
    Mouse {
        /// down | up | move | wheel
        kind: String,
        x: f64,
        y: f64,
        #[serde(default)]
        button: Option<String>,
        #[serde(default)]
        clicks: Option<u32>,
        #[serde(default)]
        dx: Option<f64>,
        #[serde(default)]
        dy: Option<f64>,
        #[serde(default)]
        modifiers: Option<u32>,
    },
    Key {
        /// down | up
        kind: String,
        key: String,
        #[serde(default)]
        code: Option<String>,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        modifiers: Option<u32>,
        #[serde(default, rename = "keyCode")]
        key_code: Option<u32>,
    },
    Text {
        text: String,
    },
}

pub fn input(d: &Dirs, ev: &Input) -> Result<()> {
    let p = page(d)?;
    match ev {
        Input::Mouse { kind, x, y, button, clicks, dx, dy, modifiers } => {
            let t = match kind.as_str() {
                "down" => "mousePressed",
                "up" => "mouseReleased",
                "wheel" => "mouseWheel",
                _ => "mouseMoved",
            };
            let mut prm = json!({ "type": t, "x": x, "y": y, "modifiers": modifiers.unwrap_or(0), "button": button.as_deref().unwrap_or(if t == "mouseMoved" || t == "mouseWheel" { "none" } else { "left" }), "clickCount": clicks.unwrap_or(if t == "mouseMoved" || t == "mouseWheel" { 0 } else { 1 }) });
            if t == "mouseWheel" {
                prm["deltaX"] = json!(dx.unwrap_or(0.0));
                prm["deltaY"] = json!(dy.unwrap_or(0.0));
            }
            p.call("Input.dispatchMouseEvent", prm)?;
        }
        Input::Key { kind, key, code, text, modifiers, key_code } => {
            let typ = match (kind.as_str(), text.as_deref().filter(|t| !t.is_empty())) {
                ("up", _) => "keyUp",
                (_, Some(_)) => "keyDown",
                _ => "rawKeyDown",
            };
            let mut prm = json!({ "type": typ, "key": key, "code": code.clone().unwrap_or_default(), "modifiers": modifiers.unwrap_or(0), "windowsVirtualKeyCode": key_code.unwrap_or(0), "nativeVirtualKeyCode": key_code.unwrap_or(0) });
            if typ == "keyDown" {
                prm["text"] = json!(text);
                prm["unmodifiedText"] = json!(text);
            }
            p.call("Input.dispatchKeyEvent", prm)?;
        }
        Input::Text { text } => {
            p.call("Input.insertText", json!({ "text": text }))?;
        }
    }
    Ok(())
}

/// Navegação pela barra de endereço (o humano não passa pela política: é ele quem digita).
pub fn navigate(d: &Dirs, action: &str, url: Option<&str>) -> Result<String> {
    let p = page(d)?;
    match action {
        "back" => p.history(-1),
        "forward" => p.history(1),
        "reload" => p.reload(),
        "stop" => {
            p.call("Page.stopLoading", json!({}))?;
            Ok(p.where_now())
        }
        _ => {
            let u = url.unwrap_or("about:blank").trim();
            let u = if u.contains("://") || u.starts_with("about:") || u.starts_with("data:") || u.starts_with("file:") {
                u.to_string()
            } else if u.contains(' ') || !u.contains(['.', ':']) && u != "localhost" {
                // Não parece endereço: busca.
                format!("https://duckduckgo.com/?q={}", urlencode(u))
            } else {
                let local = u.starts_with("localhost") || u.starts_with("127.") || u.starts_with("0.0.0.0");
                format!("{}://{u}", if local { "http" } else { "https" })
            };
            p.navigate(&u)
        }
    }
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// Abas: `new` (com url), `close`, `select`.
pub fn tab(d: &Dirs, action: &str, id: Option<&str>, url: Option<&str>) -> Result<()> {
    let e = super::ensure(d)?;
    let cdp = cdp_for(&d.workspace, &e)?;
    match action {
        "new" => {
            let id = cdp.call(None, "Target.createTarget", json!({ "url": url.unwrap_or("about:blank") }))?["targetId"].as_str().unwrap_or("").to_string();
            super::set_active_target(d, &id)?;
        }
        "close" => {
            let id = id.map(String::from).or_else(|| super::active_target(d)).unwrap_or_default();
            cdp.call(None, "Target.closeTarget", json!({ "targetId": id }))?;
            if super::active_target(d).as_deref() == Some(id.as_str()) {
                let _ = std::fs::remove_file(d.file("active.json"));
            }
        }
        "select" => {
            let id = id.unwrap_or_default();
            let _ = cdp.call(None, "Target.activateTarget", json!({ "targetId": id }));
            super::set_active_target(d, id)?;
        }
        _ => anyhow::bail!("ação de aba desconhecida: {action}"),
    }
    Ok(())
}

pub fn resize(d: &Dirs, v: &super::Viewport) -> Result<()> {
    super::set_viewport(d, v)?;
    page(d)?.apply_viewport(v)
}

/// Quadro do screencast (ou captura avulsa).
#[derive(Debug, Clone, Serialize)]
pub struct Frame {
    pub workspace: String,
    /// JPEG em base64.
    pub data: String,
    /// Tamanho da página em pixels CSS (para converter cliques).
    pub width: f64,
    pub height: f64,
    pub url: String,
}

/// Captura avulsa (celular e clientes sem screencast). `None` se o navegador não estiver aberto.
pub fn snapshot_frame(d: &Dirs, quality: u32) -> Result<Option<Frame>> {
    if super::running(d).is_none() {
        return Ok(None);
    }
    let p = page(d)?;
    let data = p.screenshot(false, None, "jpeg", quality)?;
    let v = super::viewport(d);
    let (url, _) = p.url_title();
    Ok(Some(Frame { workspace: d.workspace.clone(), data, width: v.width as f64, height: v.height as f64, url }))
}

/// Liga o screencast do workspace; `emit` recebe cada quadro (e `None` quando a aba muda ou o
/// navegador fecha, para a interface atualizar o estado). Desliga com [`stop_screencast`].
pub fn screencast(home: &Path, workspace: &str, max_w: u32, max_h: u32, emit: impl Fn(Option<Frame>) + Send + 'static) -> Result<()> {
    let d = Dirs::new(home, workspace);
    stop_screencast(workspace);
    let on = Arc::new(AtomicBool::new(true));
    // Garante a conexão antes de registrar a flag.
    page(&d)?;
    if let Some(c) = conns().lock().unwrap().get_mut(workspace) {
        c.cast = Some(on.clone());
    }
    std::thread::Builder::new().name("kabul-screencast".into()).spawn(move || {
        while on.load(Ordering::Relaxed) {
            let p = match page(&d) {
                Ok(p) => p,
                Err(_) => {
                    emit(None);
                    std::thread::sleep(Duration::from_millis(1500));
                    continue;
                }
            };
            let rx = p.cdp.subscribe();
            let _ = p.call("Page.startScreencast", json!({ "format": "jpeg", "quality": 70, "maxWidth": max_w, "maxHeight": max_h, "everyNthFrame": 1 }));
            // Quadro inicial (a página parada não manda quadros novos).
            if let Ok(Some(f)) = snapshot_frame(&d, 70) {
                emit(Some(f));
            }
            let mut last_check = std::time::Instant::now();
            loop {
                if !on.load(Ordering::Relaxed) {
                    let _ = p.call("Page.stopScreencast", json!({}));
                    return;
                }
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(ev) if ev.method == "Page.screencastFrame" && ev.session.as_deref() == Some(p.session.as_str()) => {
                        let sid = ev.params["sessionId"].clone();
                        p.cdp.send(Some(&p.session), "Page.screencastFrameAck", json!({ "sessionId": sid }));
                        let m = &ev.params["metadata"];
                        let v = super::viewport(&d);
                        emit(Some(Frame {
                            workspace: d.workspace.clone(),
                            data: ev.params["data"].as_str().unwrap_or("").to_string(),
                            width: m["deviceWidth"].as_f64().unwrap_or(v.width as f64),
                            height: m["deviceHeight"].as_f64().unwrap_or(v.height as f64),
                            url: String::new(),
                        }));
                    }
                    Ok(ev) if ev.method == "Target.targetInfoChanged" || ev.method == "Target.targetDestroyed" || ev.method == "Target.targetCreated" => emit(None),
                    Ok(_) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => break,
                }
                // Outra aba ficou ativa (agente ou humano) ou a conexão caiu: reconecta.
                if last_check.elapsed() > Duration::from_millis(500) {
                    last_check = std::time::Instant::now();
                    if p.cdp.is_closed() || super::active_target(&d).is_some_and(|t| t != p.target) {
                        let _ = p.call("Page.stopScreencast", json!({}));
                        emit(None);
                        break;
                    }
                }
            }
        }
    })?;
    Ok(())
}

pub fn stop_screencast(workspace: &str) {
    if let Some(c) = conns().lock().unwrap().get_mut(workspace) {
        if let Some(f) = c.cast.take() {
            f.store(false, Ordering::Relaxed);
        }
    }
}

/// Comandos da aba Browser, iguais no app (Tauri) e no kabuld: `cmd` sem o prefixo `browser_`.
pub fn command(home: &Path, cmd: &str, a: &Value) -> Result<Value> {
    let ws = a.get("workspaceId").and_then(Value::as_str).unwrap_or_default();
    if ws.is_empty() && !matches!(cmd, "install" | "pending") {
        anyhow::bail!("argumento workspaceId ausente");
    }
    let d = Dirs::new(home, ws);
    let s = |k: &str| a.get(k).and_then(Value::as_str);
    Ok(match cmd {
        "status" => json!(super::status(&d)),
        "open" => {
            page(&d)?;
            if let Some(u) = s("url").filter(|u| !u.is_empty()) {
                navigate(&d, "goto", Some(u))?;
            }
            json!(super::status(&d))
        }
        "nav" => json!(navigate(&d, s("action").unwrap_or("goto"), s("url"))?),
        "input" => {
            let ev: Input = serde_json::from_value(a.get("event").cloned().unwrap_or(Value::Null))?;
            input(&d, &ev)?;
            Value::Null
        }
        "tab" => {
            tab(&d, s("action").unwrap_or("select"), s("id"), s("url"))?;
            json!(super::status(&d))
        }
        "resize" => {
            let mut v = s("preset").and_then(super::Viewport::preset).unwrap_or_else(|| super::viewport(&d));
            if let Some(w) = a.get("width").and_then(Value::as_u64) {
                v.width = (w as u32).clamp(200, 4000);
            }
            if let Some(h) = a.get("height").and_then(Value::as_u64) {
                v.height = (h as u32).clamp(200, 4000);
            }
            resize(&d, &v)?;
            json!(v)
        }
        "screenshot" => json!(snapshot_frame(&d, a.get("quality").and_then(Value::as_u64).unwrap_or(60) as u32)?),
        "control" => {
            super::set_paused(&d, a.get("paused").and_then(Value::as_bool).unwrap_or(false))?;
            json!(super::control(&d))
        }
        "approve" => {
            super::policy::decide(&d, s("id").unwrap_or_default(), super::policy::Decision { allow: a.get("allow").and_then(Value::as_bool).unwrap_or(false), always: a.get("always").and_then(Value::as_bool).unwrap_or(false) })?;
            Value::Null
        }
        // Pedidos de aprovação de todos os workspaces (o app mostra mesmo sem a aba aberta).
        "pending" => {
            let mut v = vec![];
            if let Ok(it) = std::fs::read_dir(home.join("browser")) {
                for e in it.flatten() {
                    let w = e.file_name().to_string_lossy().to_string();
                    for r in super::policy::pending(&Dirs::new(home, &w)) {
                        let mut j = json!(r);
                        j["workspaceId"] = json!(w);
                        v.push(j);
                    }
                }
            }
            json!(v)
        }
        "stop" => {
            stop_screencast(ws);
            json!(super::stop(&d)?)
        }
        "clear" => {
            stop_screencast(ws);
            super::clear(&d)?;
            Value::Null
        }
        "install" => json!(super::install::install(home)?.display().to_string()),
        other => anyhow::bail!("comando do navegador desconhecido: {other}"),
    })
}
