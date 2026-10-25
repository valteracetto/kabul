//! kabuld embutido no app desktop (Configurações › Celular e remoto): liga/desliga, lembra a escolha
//! em `kabuld.json` e repassa ao kabuld as chamadas do painel (`kabuld_call`). A PWA servida ao
//! celular sai dos próprios assets do app.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct Remote {
    server: Mutex<Option<kabuld::Server>>,
    error: Mutex<Option<String>>,
}

#[derive(Serialize, Deserialize, Default)]
struct Conf {
    enabled: bool,
    port: Option<u16>,
}

#[derive(Serialize)]
pub struct Status {
    running: bool,
    port: u16,
    enabled: bool,
    error: Option<String>,
}

fn conf(home: &Path) -> Conf {
    std::fs::read_to_string(home.join("kabuld.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(home: &Path, c: &Conf) {
    let _ = std::fs::write(home.join("kabuld.json"), serde_json::to_vec_pretty(c).unwrap_or_default());
}

fn status(home: &Path, r: &Remote) -> Status {
    let c = conf(home);
    let s = r.server.lock().unwrap();
    Status { running: s.is_some(), port: s.as_ref().map(|s| s.port()).or(c.port).unwrap_or(kabuld::DEFAULT_PORT), enabled: c.enabled, error: r.error.lock().unwrap().clone() }
}

fn start(handle: &AppHandle, home: &Path, r: &Remote) -> Result<(), String> {
    if r.server.lock().unwrap().is_some() {
        return Ok(());
    }
    let mut cfg = kabuld::Config::from_env();
    cfg.home = home.to_path_buf();
    cfg.port = conf(home).port.unwrap_or(cfg.port);
    let h = handle.clone();
    cfg.assets = Some(Arc::new(move |p: &str| h.asset_resolver().get(p.to_string()).map(|a| (a.bytes, a.mime_type))));
    match kabuld::start(cfg) {
        Ok(s) => {
            *r.server.lock().unwrap() = Some(s);
            *r.error.lock().unwrap() = None;
            Ok(())
        }
        Err(e) => {
            let msg = format!("kabuld: {e:#}");
            *r.error.lock().unwrap() = Some(msg.clone());
            Err(msg)
        }
    }
}

/// Sobe o kabuld na abertura do app se ele estava ligado.
pub fn autostart(handle: &AppHandle) {
    let home = handle.state::<crate::App>().home.clone();
    if conf(&home).enabled {
        let _ = start(handle, &home, &handle.state::<Remote>());
    }
}

#[tauri::command]
pub fn kabuld_status(app: State<crate::App>, remote: State<Remote>) -> Status {
    status(&app.home, &remote)
}

#[tauri::command]
pub async fn kabuld_start(handle: AppHandle, app: State<'_, crate::App>, remote: State<'_, Remote>) -> Result<Status, String> {
    let mut c = conf(&app.home);
    c.enabled = true;
    save(&app.home, &c);
    start(&handle, &app.home, &remote)?;
    Ok(status(&app.home, &remote))
}

#[tauri::command]
pub async fn kabuld_stop(app: State<'_, crate::App>, remote: State<'_, Remote>) -> Result<Status, String> {
    let mut c = conf(&app.home);
    c.enabled = false;
    save(&app.home, &c);
    if let Some(s) = remote.server.lock().unwrap().take() {
        s.stop();
    }
    Ok(status(&app.home, &remote))
}

/// O painel do desktop fala com o kabuld embutido como dono local.
#[tauri::command]
pub async fn kabuld_call(remote: State<'_, Remote>, command: String, args: Option<Value>) -> Result<Value, String> {
    let hub = remote.server.lock().unwrap().as_ref().map(|s| s.hub.clone()).ok_or("o servidor está desligado")?;
    let owner = kabuld::auth::Principal::local_owner(&std::env::var("USER").unwrap_or_else(|_| "Você".into()));
    let args = args.unwrap_or(Value::Null);
    tauri::async_runtime::spawn_blocking(move || hub.call(&owner, 0, &command, &args)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

// ---------- chats do app espelhados no kabuld (celular vê, aprova e manda mensagem) ----------

/// O processo do agente é do app; o kabuld só repassa envios e aprovações para ele.
struct Shared(Arc<Mutex<kabul_core::harness::Running>>);

impl kabuld::chat::AgentProc for Shared {
    fn send(&self, text: &str) -> anyhow::Result<()> {
        self.0.lock().unwrap().send(text)
    }
    fn approve(&self, request_id: &str, allow: bool, tool: &str, always: bool) -> anyhow::Result<()> {
        self.0.lock().unwrap().approve_ext(request_id, allow, tool, None, always)
    }
    fn kill(&mut self) -> anyhow::Result<()> {
        self.0.lock().unwrap().kill()
    }
    fn interrupt(&mut self) -> anyhow::Result<()> {
        self.0.lock().unwrap().interrupt()
    }
}

fn hub(handle: &AppHandle) -> Option<Arc<kabuld::hub::Hub>> {
    handle.state::<Remote>().server.lock().unwrap().as_ref().map(|s| s.hub.clone())
}

fn me() -> kabuld::auth::Principal {
    kabuld::auth::Principal::local_owner(&std::env::var("USER").unwrap_or_else(|_| "Você".into()))
}

/// Chat aberto no app: passa a aparecer no celular (só se o kabuld estiver ligado).
pub fn mirror_chat(handle: &AppHandle, id: &str, w: &kabul_core::store::Workspace, harness: kabul_core::harness::HarnessKind, model: &str, approvals: bool, running: Arc<Mutex<kabul_core::harness::Running>>) {
    if let Some(h) = hub(handle) {
        let meta = kabuld::chat::ChatMeta { id: id.into(), workspace_id: w.id.clone(), path: w.path.clone(), branch: w.branch.clone(), title: w.title.clone().unwrap_or_else(|| w.name.clone()), harness, model: model.into(), approvals, account: None };
        h.chats.attach_external(meta, Box::new(Shared(running)));
    }
}

pub fn feed(handle: &AppHandle, id: &str, ev: &kabul_core::harness::Event) {
    if let Some(h) = hub(handle) {
        h.chats.feed(id, ev);
    }
}

pub fn local_send(handle: &AppHandle, id: &str, text: &str) {
    if let Some(h) = hub(handle) {
        h.chats.record_local_send(id, &me(), text);
    }
}

pub fn local_approval(handle: &AppHandle, id: &str, request_id: &str, allow: bool) {
    if let Some(h) = hub(handle) {
        h.chats.record_local_approval(id, &me(), request_id, allow);
    }
}

pub fn close_chat(handle: &AppHandle, id: &str) {
    if let Some(h) = hub(handle) {
        h.chats.close_external(id);
    }
}
