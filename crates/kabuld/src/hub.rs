//! Estado do kabuld e despacho dos comandos (mesmos nomes e argumentos do transporte Tauri, mais os
//! comandos do celular e da colaboração). Chamadas são síncronas; o servidor as roda fora do loop async.
use crate::auth::{self, Auth, Principal, Role, Scope};
use crate::bus::Bus;
use crate::chat::{ChatHub, ChatMeta};
use crate::net::NetTransport;
use crate::presence::Presence;
use crate::push::Push;
use crate::secrets::SecretStore;
use crate::sessions::{Group, LiveSession, Scanner, Status};
use crate::terminal::{key_bytes, TermHub};
use crate::{machines, policy};
use anyhow::{bail, Context, Result};
use kabul_core::harness::{self, HarnessKind, SessionOptions};
use kabul_core::models::{self, Model};
use kabul_core::runs_on::RunsOn;
use kabul_core::settings::AppSettings;
use kabul_core::store::{Repo, Store, Workspace};
use kabul_core::{gitops, history, tmux};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

/// Validade do QR de pareamento e dos convites.
pub const PAIR_TTL: u64 = 5 * 60;
pub const INVITE_TTL: u64 = 30 * 60;

pub struct Hub {
    pub home: PathBuf,
    pub port: u16,
    pub machine: String,
    store: Mutex<(Store, Option<SystemTime>)>,
    pub bus: Bus,
    pub auth: Auth,
    pub terms: TermHub,
    pub chats: Arc<ChatHub>,
    pub presence: Presence,
    pub push: Arc<Push>,
    pub net: Arc<dyn NetTransport>,
    live: RwLock<Vec<LiveSession>>,
    pub alive: AtomicBool,
    conn_seq: AtomicU64,
}

fn s(a: &Value, k: &str) -> Result<String> {
    a.get(k).and_then(Value::as_str).map(String::from).with_context(|| format!("argumento {k} ausente"))
}
fn opt(a: &Value, k: &str) -> Option<String> {
    a.get(k).and_then(Value::as_str).map(String::from).filter(|s| !s.is_empty())
}

pub fn qr_svg(data: &str) -> String {
    match qrcode::QrCode::new(data.as_bytes()) {
        Ok(c) => c.render::<qrcode::render::svg::Color>().min_dimensions(232, 232).quiet_zone(true).dark_color(qrcode::render::svg::Color("#000000")).light_color(qrcode::render::svg::Color("#ffffff")).build(),
        Err(_) => String::new(),
    }
}

impl Hub {
    pub fn new(home: PathBuf, port: u16, net: Arc<dyn NetTransport>, secrets: Arc<dyn SecretStore>) -> Result<Arc<Self>> {
        std::fs::create_dir_all(&home)?;
        let file = home.join("state.json");
        let root = std::env::var_os("KABUL_WORKSPACES").map(PathBuf::from).unwrap_or_else(|| if home.join("workspaces").exists() || std::env::var_os("KABUL_HOME").is_some() { home.join("workspaces") } else { Store::default_paths().1 });
        let prefix = AppSettings::load(&home.join("app-settings.json")).branch_prefix();
        let store = Store::open(file, root, prefix)?;
        let bus = Bus::new();
        let push = Arc::new(Push::open(&home, &secrets)?);
        crate::push::spawn_notifier(&bus, push.clone());
        Ok(Arc::new(Self {
            auth: Auth::open(&home, secrets)?,
            terms: TermHub::new(bus.clone()),
            chats: Arc::new(ChatHub::new(bus.clone())),
            presence: Presence::new(bus.clone()),
            push,
            net,
            home,
            port,
            machine: kabul_core::machine::computer_name(),
            store: Mutex::new((store, None)),
            bus,
            live: RwLock::new(vec![]),
            alive: AtomicBool::new(true),
            conn_seq: AtomicU64::new(0),
        }))
    }

    pub fn next_conn(&self) -> u64 {
        self.conn_seq.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Estado do Kabul relido do disco quando o arquivo muda (o app desktop também escreve nele).
    fn with_store<T>(&self, f: impl FnOnce(&mut Store) -> Result<T>) -> Result<T> {
        let mut g = self.store.lock().unwrap();
        let mtime = std::fs::metadata(&g.0.file).and_then(|m| m.modified()).ok();
        if mtime != g.1 {
            if let Ok(fresh) = Store::open(g.0.file.clone(), g.0.root.clone(), g.0.branch_prefix.clone()) {
                g.0 = fresh;
            }
            g.1 = mtime;
        }
        let out = f(&mut g.0);
        g.1 = std::fs::metadata(&g.0.file).and_then(|m| m.modified()).ok();
        out
    }

    fn snapshot(&self) -> (Vec<Repo>, Vec<Workspace>) {
        self.with_store(|s| Ok((s.state.repos.clone(), s.state.workspaces.clone()))).unwrap_or_default()
    }

    fn ws_repo(&self, id: &str) -> Result<(Workspace, Repo)> {
        self.with_store(|s| {
            let w = s.workspace(id)?.clone();
            let r = s.repo(&w.repo_id)?.clone();
            Ok((w, r))
        })
    }

    pub fn live(&self) -> Vec<LiveSession> {
        let mut v = self.live.read().unwrap().clone();
        let (_, wss) = self.snapshot();
        for c in self.chats.list(None) {
            let w = wss.iter().find(|w| w.id == c.meta.workspace_id);
            v.push(LiveSession {
                id: format!("chat:{}", c.meta.id),
                kind: "chat",
                name: c.meta.title.clone(),
                agent: c.meta.harness.binary().replace("agy", "antigravity"),
                status: c.status,
                detail: c.detail.clone(),
                runs_on: RunsOn::Local { mirrored: false },
                group: Group { key: c.meta.workspace_id.clone(), repo: w.map(|w| w.name.clone()).unwrap_or_default(), workspace: w.map(|w| w.title.clone().unwrap_or_else(|| w.name.clone())), workspace_id: Some(c.meta.workspace_id.clone()) },
                path: c.meta.path.clone(),
                pane: None,
                cols: 0,
                rows: 0,
                idle_secs: 0,
                preview: format!("{} · {}", c.meta.model, c.meta.harness.label()),
            });
        }
        // Repo do grupo de chat: nome do repo, não do workspace.
        let (repos, _) = self.snapshot();
        for s in v.iter_mut().filter(|s| s.kind == "chat") {
            if let Some(w) = wss.iter().find(|w| Some(&w.id) == s.group.workspace_id.as_ref()) {
                if let Some(r) = repos.iter().find(|r| r.id == w.repo_id) {
                    s.group.repo = r.name.clone();
                }
            }
        }
        v
    }

    fn session_workspace(&self, session: &str) -> Option<String> {
        self.live.read().unwrap().iter().find(|s| s.name == session && s.kind == "tmux").and_then(|s| s.group.workspace_id.clone())
    }

    /// Varre as sessões a cada `every` e publica mudanças de status (o push escuta `session-status`).
    pub fn spawn_monitor(self: &Arc<Self>, every: std::time::Duration) {
        let hub = self.clone();
        std::thread::spawn(move || {
            let mut sc = Scanner::new();
            let mut prev: HashMap<String, Status> = HashMap::new();
            while hub.alive.load(Ordering::Relaxed) {
                let (repos, wss) = hub.snapshot();
                let now = sc.scan(&repos, &wss);
                let mut changed = now.len() != hub.live.read().unwrap().len();
                for s in &now {
                    if prev.get(&s.id) != Some(&s.status) {
                        changed = true;
                        hub.bus.emit("session-status", json!({"id": s.id, "title": s.name, "agent": s.agent, "status": s.status, "detail": s.detail, "workspace_id": s.group.workspace_id}), s.group.workspace_id.clone(), None);
                    }
                }
                prev = now.iter().map(|s| (s.id.clone(), s.status)).collect();
                *hub.live.write().unwrap() = now;
                if changed {
                    hub.bus.emit("sessions-changed", json!({}), None, None);
                }
                std::thread::sleep(every);
            }
        });
    }

    /// Workspace a que o comando se refere (para a política dos convidados).
    fn target_ws(&self, a: &Value) -> Option<String> {
        if let Some(w) = opt(a, "workspaceId") {
            return Some(w);
        }
        if let Some(c) = opt(a, "chatId") {
            return self.chats.workspace_of(&c);
        }
        if let Some(sess) = opt(a, "session") {
            return self.session_workspace(&sess);
        }
        None
    }

    pub fn base_url(&self) -> String {
        std::env::var("KABULD_PUBLIC_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| self.net.base_url(self.port))
    }

    pub fn call(&self, who: &Principal, conn: u64, cmd: &str, a: &Value) -> Result<Value> {
        let target = self.target_ws(a);
        policy::check(who, cmd, target.as_deref())?;
        let scope_ws = who.scope.workspace().map(String::from);
        Ok(match cmd {
            // ---------- identidade e servidor ----------
            "whoami" => json!({"principal": who, "machine": self.machine}),
            "remote_status" => {
                let net = self.net.status(self.port);
                json!({"running": true, "port": self.port, "net": net, "base_url": self.base_url(), "machine": self.machine, "devices": self.auth.list().len(), "secrets": self.auth.secrets_kind(), "push": self.push.count(), "https": self.base_url().starts_with("https://")})
            }
            "remote_https" => json!(self.net.set_https(self.port, a.get("on").and_then(Value::as_bool).unwrap_or(true))?),
            "pair_create" => {
                self.auth.cancel_owner_tickets();
                let t = self.auth.issue(Role::Owner, Scope::All, PAIR_TTL);
                let url = format!("{}/m/#pair={}", self.base_url(), t.token);
                json!({"token": t.token, "url": url, "qr_svg": qr_svg(&url), "expires_at": t.expires_at, "ttl": PAIR_TTL})
            }
            "invite_create" => {
                let ws = s(a, "workspaceId")?;
                self.ws_repo(&ws)?;
                let role = a.get("role").and_then(Value::as_str).and_then(Role::parse).filter(|r| *r != Role::Owner).unwrap_or(Role::Editor);
                let t = self.auth.issue(role, Scope::Workspace { id: ws.clone() }, INVITE_TTL);
                let url = format!("{}/m/#pair={}&w={}", self.base_url(), t.token, ws);
                json!({"token": t.token, "url": url, "qr_svg": qr_svg(&url), "expires_at": t.expires_at, "ttl": INVITE_TTL, "role": role})
            }
            "devices_list" => json!(self.auth.list()),
            "device_revoke" => {
                let id = s(a, "id")?;
                self.auth.revoke(&id)?;
                self.push.unsubscribe_device(&id);
                self.bus.emit("__revoked", json!({"id": id}), None, None);
                Value::Null
            }
            "device_rename" => json!(self.auth.rename(&s(a, "id")?, opt(a, "user").as_deref(), opt(a, "name").as_deref())?),
            "machines_discover" => {
                let st = crate::net::Tailscale::new().status_json();
                json!(machines::discover(st, self.port))
            }
            "push_key" => json!(self.push.public_key()),
            "push_subscribe" => {
                self.push.subscribe(&who.id, who.scope.clone(), &a["subscription"])?;
                Value::Null
            }
            "push_test" => {
                self.push.notify("Kabul", "Notificações ligadas neste aparelho.", "/m/", "teste", None);
                json!(self.push.count())
            }

            // ---------- colaboração ----------
            "presence_set" => {
                let ws = opt(a, "workspaceId");
                if !who.scope.allows_workspace(ws.as_deref()) && ws.is_some() {
                    bail!("fora do workspace compartilhado com você");
                }
                self.presence.set(conn, who, ws, opt(a, "target"), a.get("typing").and_then(Value::as_bool).unwrap_or(false));
                Value::Null
            }
            "presence_list" => json!(self.presence.list(&s(a, "workspaceId")?)),

            // ---------- sessões ----------
            "live_sessions" => {
                let v: Vec<LiveSession> = self.live().into_iter().filter(|s| who.scope.allows_workspace(s.group.workspace_id.as_deref())).collect();
                json!({"machine": self.machine, "os": std::env::consts::OS, "sessions": v})
            }
            "sessions_list" => {
                let panes = tmux::list_panes().unwrap_or_default();
                let tmux: Vec<Value> = panes
                    .into_iter()
                    .map(|p| {
                        let agent = kabul_core::agent::detect_pane(&p.command, p.pid).label();
                        let mut v = serde_json::to_value(&p).unwrap_or_default();
                        v["agent"] = json!(agent);
                        v
                    })
                    .collect();
                json!({"tmux": tmux, "imported_workspaces": [], "imported_sessions": [], "imported_error": null})
            }

            // Agentes e sessões de fora do Kabul (só o dono: o policy não libera a convidados).
            "external_sessions" => json!(kabul_core::external::collect(&self.home, 40)),

            // ---------- terminal ----------
            "term_attach" => {
                let session = s(a, "session")?;
                json!(self.terms.attach(&session, self.session_workspace(&session))?)
            }
            "term_open" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                let session = opt(a, "name").unwrap_or_else(|| w.tmux_session());
                if !tmux::has_session(&session) {
                    let exports: String = w.full_env(&r).iter().map(|(k, v)| format!("export {k}={}; ", harness::shell_quote(v))).collect();
                    tmux::new_session(&session, Some(&w.path), Some(&format!("sh -c {}", harness::shell_quote(&format!("{exports}exec \"${{SHELL:-sh}}\" -l")))))?;
                }
                json!(self.terms.attach(&session, Some(w.id.clone()))?)
            }
            "term_input" => {
                let data = s(a, "data")?;
                self.terms.input(&s(a, "session")?, &s(a, "pane")?, data.as_bytes())?;
                Value::Null
            }
            "term_keys" => {
                let mut bytes = vec![];
                for k in a.get("keys").and_then(Value::as_array).cloned().unwrap_or_default() {
                    let k = k.as_str().unwrap_or_default();
                    bytes.extend_from_slice(key_bytes(k).with_context(|| format!("tecla desconhecida: {k}"))?);
                }
                self.terms.input(&s(a, "session")?, &s(a, "pane")?, &bytes)?;
                Value::Null
            }
            "term_resize" => {
                let n = |k: &str| a.get(k).and_then(Value::as_u64).unwrap_or(0) as u16;
                if a.get("apply").and_then(Value::as_bool).unwrap_or(false) {
                    self.terms.resize(&s(a, "session")?, n("cols"), n("rows"))?;
                }
                Value::Null
            }
            "term_close" => Value::Null,
            "term_capture" => json!(self.terms.snapshot(&s(a, "target")?)?),

            // ---------- chat ----------
            "chat_start" => json!(self.chat_start(a)?),
            "chat_send" => self.chats.send(&s(a, "chatId")?, who, &s(a, "text")?)?,
            "chat_approve" => {
                self.chats.approve(&s(a, "chatId")?, who, &s(a, "requestId")?, a.get("allow").and_then(Value::as_bool).unwrap_or(false), a.get("always").and_then(Value::as_bool).unwrap_or(false))?;
                Value::Null
            }
            "chat_stop" => {
                self.chats.stop(&s(a, "chatId")?)?;
                Value::Null
            }
            "chat_close" => {
                self.chats.close(&s(a, "chatId")?);
                Value::Null
            }
            "chat_switch" => json!(self.chat_switch(a)?),
            "chat_list" => json!(self.chats.list(scope_ws.as_deref().or(opt(a, "workspaceId").as_deref()))),
            "chat_transcript" => self.chats.transcript(&s(a, "chatId")?)?,
            "chat_queue_remove" => {
                self.chats.queue_remove(&s(a, "chatId")?, &s(a, "id")?)?;
                Value::Null
            }

            // ---------- estado do Kabul (mesmos comandos do app) ----------
            "repos_list" => {
                let (repos, wss) = self.snapshot();
                match &scope_ws {
                    None => json!(repos),
                    Some(w) => {
                        let rid = wss.iter().find(|x| &x.id == w).map(|x| x.repo_id.clone());
                        json!(repos.into_iter().filter(|r| Some(&r.id) == rid.as_ref()).collect::<Vec<_>>())
                    }
                }
            }
            "workspaces_list" => {
                let (_, wss) = self.snapshot();
                json!(wss.into_iter().filter(|w| who.scope.allows_workspace(Some(&w.id))).collect::<Vec<_>>())
            }
            "machine_info" => json!(kabul_core::machine::info()),
            "models_list" => json!(models::catalog()),
            "sections_list" => self.with_store(|s| Ok(json!(s.state.sections)))?,
            "workspaces_stats" => json!({}),
            "app_settings_get" => json!(AppSettings::load(&self.home.join("app-settings.json"))),
            "git_status" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                json!(gitops::status(&r, &w)?)
            }
            "workspace_changes" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                json!(gitops::changes(&r, &w, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)))?)
            }
            "workspace_file_diff" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                json!(gitops::file_diff(&r, &w, &s(a, "path")?, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)), a.get("ignoreWs").and_then(Value::as_bool).unwrap_or(false))?)
            }
            "history_list" => json!(history::list(&self.home, &s(a, "workspaceId")?)),
            "history_load" => json!(history::load(&self.home, &s(a, "workspaceId")?, &s(a, "id")?)?),
            // Ditado sem Web Speech (ex.: PWA fora do Safari): whisper local, como no app.
            "transcribe" => {
                let audio: Vec<u8> = serde_json::from_value(a["audio"].clone()).context("áudio")?;
                json!(kabul_core::speech::transcribe(&audio, &opt(a, "ext").unwrap_or_else(|| "webm".into()), "pt")?)
            }
            "slash_commands" => {
                let (w, _) = self.ws_repo(&s(a, "workspaceId")?)?;
                json!(history::slash_commands(Path::new(&w.path)))
            }
            _ => bail!("kabuld: comando {cmd} não disponível"),
        })
    }

    /// Mesmo caminho do app e do `kabul serve` (core): harness (inclusive modelos locais), ambiente,
    /// conta, MCP, estilo de saída e prompt geral do repo.
    #[allow(clippy::too_many_arguments)]
    fn options_for(&self, w: &Workspace, r: &Repo, model: &Model, effort: Option<String>, resume: Option<String>, plan: bool, account: Option<&str>) -> Result<(HarnessKind, SessionOptions)> {
        let req = kabul_core::chat::ChatRequest { effort, resume, plan: Some(plan), account: account.map(str::to_string), ..Default::default() };
        let endpoints = kabul_core::local::load_endpoints(&self.home.join("endpoints.json"));
        let registry = kabul_core::registry::Registry::load(&self.home.join("harness-registry.json"));
        let p = kabul_core::chat::prepare(&self.home, w, r, model, &req, &endpoints, &registry)?;
        Ok((p.kind, p.opts))
    }

    fn spawn_agent(k: HarnessKind, opts: &SessionOptions) -> Result<(Box<dyn crate::chat::AgentProc>, std::sync::mpsc::Receiver<harness::Event>)> {
        let mut running = harness::spawn(k.harness().as_ref(), opts)?;
        let (_tx, dummy) = std::sync::mpsc::channel();
        let rx = std::mem::replace(&mut running.events, dummy);
        Ok((Box::new(running), rx))
    }

    fn chat_start(&self, a: &Value) -> Result<crate::chat::ChatView> {
        let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
        let model: Model = serde_json::from_value(a["model"].clone()).context("modelo")?;
        let account = opt(a, "account");
        let (k, opts) = self.options_for(&w, &r, &model, opt(a, "effort"), opt(a, "resume"), a.get("plan").and_then(Value::as_bool).unwrap_or(false), account.as_deref())?;
        let (agent, rx) = Self::spawn_agent(k, &opts)?;
        let meta = ChatMeta { id: String::new(), workspace_id: w.id.clone(), path: w.path.clone(), branch: w.branch.clone(), title: opt(a, "title").unwrap_or_else(|| w.title.clone().unwrap_or_else(|| w.name.clone())), harness: k, model: model.label.clone(), approvals: k.harness().app_approvals(), account };
        Ok(self.chats.start(meta, agent, rx))
    }

    fn chat_switch(&self, a: &Value) -> Result<crate::chat::ChatView> {
        let id = s(a, "chatId")?;
        let ws = self.chats.workspace_of(&id).context("chat não encontrado")?;
        let (w, r) = self.ws_repo(&ws)?;
        let model: Model = serde_json::from_value(a["model"].clone()).context("modelo")?;
        let account = opt(a, "account");
        let (k, opts) = self.options_for(&w, &r, &model, opt(a, "effort"), None, false, account.as_deref())?;
        let (agent, rx) = Self::spawn_agent(k, &opts)?;
        let diff = std::process::Command::new("git").args(["-C", &w.path, "diff", "--stat", "HEAD"]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        self.chats.switch(&id, k, &model.label, account, agent, rx, &diff)
    }

    /// Resgata um ingresso (rota HTTP `/api/pair`).
    pub fn pair(&self, token: &str, user: &str, device: &str) -> Result<Value> {
        let (d, key) = self.auth.redeem(token, user, device)?;
        self.bus.emit("devices-changed", json!({}), None, None);
        Ok(json!({"device": d, "key": key, "machine": self.machine}))
    }
}

pub fn now() -> u64 {
    auth::now()
}
