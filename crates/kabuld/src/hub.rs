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
use kabul_core::term::{self, Launch, What};
use kabul_core::{gitops, history, usage};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;

/// Validade do QR de pareamento e dos convites.
pub const PAIR_TTL: u64 = 5 * 60;
pub const INVITE_TTL: u64 = 30 * 60;

/// Modelo, esforço e conta de um chat.
type ChatModel = (Model, Option<String>, Option<String>);

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
    /// Ingressos de arquivo para o preview no celular ([`crate::files`]).
    pub files: crate::files::FileTickets,
    /// Proxy da porta do Run para o celular ([`crate::proxy`]).
    pub proxy: crate::proxy::ProxyHub,
    live: RwLock<Vec<LiveSession>>,
    pub alive: AtomicBool,
    conn_seq: AtomicU64,
    /// Modelo/esforço/conta de cada chat do kabuld: para retomar um chat suspenso por ociosidade.
    chat_models: Mutex<HashMap<String, ChatModel>>,
    /// Um watcher de arquivos por repo: invalida o cache do git e avisa `workspace-fs-changed`.
    pub watchers: kabul_core::watch::RepoWatchers,
}

fn s(a: &Value, k: &str) -> Result<String> {
    a.get(k).and_then(Value::as_str).map(String::from).with_context(|| format!("argumento {k} ausente"))
}
fn fast(a: &Value) -> bool {
    a.get("fast").and_then(Value::as_bool).unwrap_or(false)
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
        let watchers = {
            let bus = bus.clone();
            kabul_core::watch::RepoWatchers::new(Arc::new(move |ws: &str| bus.emit("workspace-fs-changed", json!({"workspace_id": ws}), Some(ws.to_string()), None)))
        };
        Ok(Arc::new(Self {
            auth: Auth::open(&home, secrets)?,
            terms: TermHub::new(bus.clone()),
            chats: ChatHub::new_arc(bus.clone()),
            presence: Presence::new(bus.clone()),
            push,
            files: Default::default(),
            proxy: crate::proxy::ProxyHub::new(net.clone()),
            net,
            home,
            port,
            machine: kabul_core::machine::computer_name(),
            store: Mutex::new((store, None)),
            bus,
            live: RwLock::new(vec![]),
            alive: AtomicBool::new(true),
            conn_seq: AtomicU64::new(0),
            chat_models: Mutex::new(HashMap::new()),
            watchers,
        })
        .init())
    }

    /// Governança (configuração salva em `agents.json`) e retomada dos chats suspensos.
    fn init(self: Arc<Self>) -> Arc<Self> {
        if let Some(cfg) = std::fs::read_to_string(self.home.join("agents.json")).ok().and_then(|t| serde_json::from_str::<kabul_core::governor::Config>(&t).ok()) {
            self.chats.governor.set_config(cfg);
        }
        let weak = Arc::downgrade(&self);
        self.chats.set_respawn(Box::new(move |meta, resume| {
            let hub = weak.upgrade().context("servidor encerrado")?;
            let (model, effort, account) = hub.chat_models.lock().unwrap().get(&meta.id).cloned().context("modelo do chat desconhecido")?;
            let (w, r) = hub.ws_repo(&meta.workspace_id)?;
            let (k, opts) = hub.options_for(&w, &r, &model, effort, resume, false, account.as_deref(), false)?;
            let (agent, rx) = Self::spawn_agent(k, &opts)?;
            // A conversa retomada continua contando no uso.
            Ok((agent, hub.record_usage(rx, k, &model, account.as_deref(), &w.id)))
        }));
        self
    }

    fn agents_config(&self, a: &Value) -> Result<Value> {
        let mut cfg = self.chats.governor.config();
        if let Some(v) = a.get("limit") {
            cfg.limit = v.as_u64().filter(|n| *n > 0).map(|n| n as usize);
        }
        if let Some(v) = a.get("idleMinutes") {
            cfg.idle_minutes = v.as_u64().filter(|n| *n > 0);
        }
        if let Some(v) = a.get("niceBackground").and_then(Value::as_bool) {
            cfg.nice_background = v;
        }
        std::fs::write(self.home.join("agents.json"), serde_json::to_vec_pretty(&cfg)?)?;
        let granted = self.chats.governor.set_config(cfg);
        self.chats.start_granted(granted);
        self.chats.emit_agents();
        Ok(json!(self.chats.governor.status()))
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
            let mut watched = String::new();
            while hub.alive.load(Ordering::Relaxed) {
                let (repos, wss) = hub.snapshot();
                // Watchers acompanham repos/workspaces (só quando a lista muda).
                let sig: String = repos.iter().map(|r| format!("{}={};", r.id, r.path)).chain(wss.iter().map(|w| format!("{}={}:{};", w.id, w.path, w.archived))).collect();
                if sig != watched {
                    hub.watchers.sync(&repos, &wss);
                    watched = sig;
                }
                let now = sc.scan(&repos, &wss);
                let mut changed = now.len() != hub.live.read().unwrap().len();
                for s in &now {
                    if prev.get(&s.id) != Some(&s.status) {
                        changed = true;
                        hub.bus.emit("session-status", json!({"id": s.id, "title": s.name, "agent": s.agent, "status": s.status, "detail": s.detail, "workspace_id": s.group.workspace_id}), s.group.workspace_id.clone(), None);
                    }
                }
                prev = now.iter().map(|s| (s.id.clone(), s.status)).collect();
                hub.chats.reap_idle();
                *hub.live.write().unwrap() = now;
                if changed {
                    hub.bus.emit("sessions-changed", json!({}), None, None);
                }
                std::thread::sleep(every);
            }
        });
    }

    /// Workspaces a que o comando se refere (para a política dos convidados): um por identificador
    /// presente (`workspaceId`, `chatId`, `session`). Todos precisam estar no escopo do convidado:
    /// mandar `workspaceId` do próprio workspace junto com o `chatId` de outro não passa. Chat ou
    /// sessão que não pertence a workspace nenhum vira `None` (negado para convidados).
    fn targets(&self, a: &Value) -> Vec<Option<String>> {
        let mut v = vec![];
        if let Some(w) = opt(a, "workspaceId") {
            v.push(Some(w));
        }
        if let Some(c) = opt(a, "chatId") {
            v.push(self.chats.workspace_of(&c));
        }
        if let Some(sess) = opt(a, "session") {
            v.push(self.session_workspace(&sess));
        }
        if v.is_empty() {
            v.push(None);
        }
        v
    }

    pub fn base_url(&self) -> String {
        std::env::var("KABULD_PUBLIC_URL").ok().filter(|u| !u.is_empty()).unwrap_or_else(|| self.net.base_url(self.port))
    }

    pub fn call(&self, who: &Principal, conn: u64, cmd: &str, a: &Value) -> Result<Value> {
        for target in self.targets(a) {
            policy::check(who, cmd, target.as_deref())?;
        }
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
                self.files.revoke_principal(&id);
                self.proxy.revoke_principal(&id);
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
                let panes = term::backend().list().unwrap_or_default();
                // Uma leitura da tabela de processos para todos os panes (antes: uma por pane).
                let agents = kabul_core::agent::detect_panes(&panes);
                let tmux: Vec<Value> = panes
                    .into_iter()
                    .zip(agents)
                    .map(|(p, a)| {
                        let agent = a.label();
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
                if !term::backend().has(&session) {
                    term::backend().open(&Launch::new(&session, Some(&w.path), What::Shell).env(&w.full_env(&r)))?;
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
            // ---------- governança (ESCALA) ----------
            "agents_status" => json!(self.chats.governor.status()),
            "agents_config" => self.agents_config(a)?,
            "agents_focus" => {
                self.chats.set_focus(opt(a, "workspaceId"));
                json!(self.chats.governor.status())
            }
            "chats_interrupt" => {
                let ids: Vec<String> = a.get("chatIds").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default();
                self.chats.interrupt_many(&ids)
            }
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
            // ---------- workspaces e contas (só o dono; a política barra convidados) ----------
            "workspace_create" => {
                let repo = s(a, "repoId")?;
                let title = opt(a, "title").map(|t| t.trim().chars().take(60).collect::<String>()).filter(|t| !t.is_empty());
                let w = self.with_store(|st| {
                    let w = st.create_workspace(&repo)?;
                    match title {
                        Some(t) => st.update_workspace(&w.id, |x| x.title = Some(t)),
                        None => Ok(w),
                    }
                })?;
                self.bus.emit("workspaces-changed", json!({}), None, None);
                json!(w)
            }
            "workspace_archive" | "workspace_unarchive" => {
                let id = s(a, "id")?;
                let w = self.with_store(|st| if cmd == "workspace_archive" { st.archive_workspace(&id) } else { st.unarchive_workspace(&id) })?;
                self.bus.emit("workspaces-changed", json!({}), None, None);
                json!(w)
            }
            "workspace_update" => {
                let id = s(a, "id")?;
                let p = a["patch"].clone();
                let w = self.with_store(|st| {
                    st.update_workspace(&id, |w| {
                        if let Some(v) = p.get("title").and_then(Value::as_str) {
                            w.title = Some(v.to_string()).filter(|t| !t.trim().is_empty());
                        }
                        if let Some(v) = p.get("status").and_then(Value::as_str) {
                            w.status = v.into();
                        }
                        if let Some(v) = p.get("pinned").and_then(Value::as_bool) {
                            w.pinned = v;
                        }
                        if let Some(v) = p.get("unread").and_then(Value::as_bool) {
                            w.unread = v;
                        }
                        if let Some(v) = p.get("section").and_then(Value::as_str) {
                            w.section = Some(v.to_string()).filter(|s| !s.is_empty());
                        }
                        if let Some(v) = p.get("pin_order") {
                            w.pin_order = v.as_u64().map(|n| n as u32);
                        }
                    })
                })?;
                self.bus.emit("workspaces-changed", json!({}), None, None);
                json!(w)
            }
            "accounts_list" => {
                let acc = kabul_core::accounts::Accounts::open(&self.home);
                let rows: Vec<Value> = acc
                    .of(&s(a, "provider")?)
                    .into_iter()
                    .map(|p| {
                        let mut v = json!(p);
                        v["logged_in"] = json!(kabul_core::accounts::logged_in(&p));
                        v
                    })
                    .collect();
                json!(rows)
            }
            "account_update" => {
                let mut acc = kabul_core::accounts::Accounts::open(&self.home);
                if a.get("makeDefault").and_then(Value::as_bool).unwrap_or(false) {
                    acc.set_default(&s(a, "id")?)?;
                }
                Value::Null
            }
            // `claude --cloud` exige terminal: roda numa sessão do workspace (backend de terminal do
            // sistema: tmux ou PTY), que o celular abre. Depois do comando fica um shell.
            "cloud_start" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                let env = opt(a, "environment").filter(|e| !e.trim().is_empty());
                let spec = kabul_core::cloud::cloud_spec(&s(a, "prompt")?, env.as_deref());
                let name = format!("{}-cloud-{}", w.tmux_session(), now() % 100000);
                term::backend().open(&Launch::new(&name, Some(&w.path), What::Run { cmd: term::Cmd::Spec(spec), log: None }).env(&w.full_env(&r)))?;
                json!({ "tmux": name })
            }
            "machine_info" => json!(kabul_core::machine::info()),
            "models_list" => json!(models::catalog()),
            "sections_list" => self.with_store(|s| Ok(json!(s.state.sections)))?,
            "workspaces_stats" => json!({}),
            "app_settings_get" => json!(AppSettings::load(&self.home.join("app-settings.json"))),
            "git_status" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                json!(gitops::status_cached(&r, &w)?)
            }
            "workspace_changes" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                let mut v = gitops::changes(&r, &w, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)))?;
                // Convidado não vê nem o nome de arquivo de segredo (mesma regra do preview).
                if !who.is_owner() {
                    v.retain(|c| crate::files::check_rel(&c.path, true).is_ok());
                }
                json!(v)
            }
            "workspace_file_diff" => {
                let (w, r) = self.ws_repo(&s(a, "workspaceId")?)?;
                crate::files::check_rel(&s(a, "path")?, !who.is_owner())?;
                json!(gitops::file_diff(&r, &w, &s(a, "path")?, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)), a.get("ignoreWs").and_then(Value::as_bool).unwrap_or(false))?)
            }
            // ---------- preview de arquivos (celular) ----------
            "file_list" => {
                let (w, _) = self.ws_repo(&s(a, "workspaceId")?)?;
                let guest = !who.is_owner();
                let v: Vec<String> = kabul_core::store::files(&w)?.into_iter().filter(|f| crate::files::check_rel(f, guest).is_ok()).take(crate::files::MAX_LIST).collect();
                json!(v)
            }
            "file_url" => {
                let ws = s(a, "workspaceId")?;
                let rel = s(a, "path")?;
                let (w, _) = self.ws_repo(&ws)?;
                let real = crate::files::resolve(Path::new(&w.path), &rel, !who.is_owner())?;
                let size = std::fs::metadata(&real)?.len();
                let (t, expires_at) = self.files.issue(&who.id, &ws, &rel, !who.is_owner());
                json!({"url": format!("/api/file?t={t}"), "size": size, "mime": crate::files::kind(&real).mime, "expires_at": expires_at, "max_chunk": crate::files::MAX_CHUNK})
            }
            // ---------- app rodando (proxy da porta do Run) ----------
            "proxy_ports" => {
                let (w, _) = self.ws_repo(&s(a, "workspaceId")?)?;
                let ports: Vec<Value> = crate::proxy::listening_ports(w.port).into_iter().map(|(port, listening)| json!({"port": port, "listening": listening && port != self.port})).collect();
                json!({"base": w.port, "ports": ports})
            }
            "proxy_open" => {
                let ws = s(a, "workspaceId")?;
                let (w, _) = self.ws_repo(&ws)?;
                let port = a.get("port").and_then(Value::as_u64).filter(|p| *p <= u16::MAX as u64).context("argumento port ausente")? as u16;
                if port == self.port {
                    bail!("a porta {port} é do próprio kabuld");
                }
                json!(self.proxy.open(&who.id, &ws, w.port, port)?)
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
            // ---------- uso, custos e limites (só o dono: o policy não libera a convidados) ----------
            "usage_overview" => self.usage_overview(a),
            "usage_csv" => {
                let since = now().saturating_sub(a.get("days").and_then(Value::as_u64).unwrap_or(30) * 86_400);
                json!(usage::csv(&usage::Ledger::open(&self.home).since(since), usage::local_offset()))
            }
            "usage_refresh" => {
                let snap = usage::limits::refresh(&self.home, AppSettings::load(&self.home.join("app-settings.json")).usage_codexbar);
                self.bus.emit("usage-changed", json!({}), None, None);
                json!(snap)
            }
            _ => bail!("kabuld: comando {cmd} não disponível"),
        })
    }

    /// Mesmo caminho do app e do `kabul serve` (core): harness (inclusive modelos locais), ambiente,
    /// conta, MCP, estilo de saída e prompt geral do repo.
    #[allow(clippy::too_many_arguments)]
    fn options_for(&self, w: &Workspace, r: &Repo, model: &Model, effort: Option<String>, resume: Option<String>, plan: bool, account: Option<&str>, fast: bool) -> Result<(HarnessKind, SessionOptions)> {
        let req = kabul_core::chat::ChatRequest { effort, resume, plan: Some(plan), account: account.map(str::to_string), fast: Some(fast), ..Default::default() };
        let endpoints = kabul_core::local::load_endpoints(&self.home.join("endpoints.json"));
        let registry = kabul_core::registry::Registry::load(&self.home.join("harness-registry.json"));
        let p = kabul_core::chat::prepare(&self.home, w, r, model, &req, &endpoints, &registry)?;
        Ok((p.kind, p.opts))
    }

    /// Uso: cada fim de turno das conversas do kabuld vira um registro (`kabul_core::usage`). As do app
    /// desktop são gravadas pelo próprio app (aqui chegam só pelo espelho, sem gravar de novo).
    fn record_usage(&self, rx: std::sync::mpsc::Receiver<harness::Event>, k: HarnessKind, model: &Model, account: Option<&str>, ws: &str) -> std::sync::mpsc::Receiver<harness::Event> {
        let meta = usage::Meta::for_chat(&self.home, k, model, account, ws);
        let bus = self.bus.clone();
        usage::tap(rx, usage::Recorder::new(&self.home, meta), move |_| bus.emit("usage-changed", json!({}), None, None))
    }

    fn usage_overview(&self, a: &Value) -> Value {
        let days = a.get("days").and_then(Value::as_u64).unwrap_or(30) as u32;
        let cfg = usage::AlertConfig::from_settings(&AppSettings::load(&self.home.join("app-settings.json")));
        let (_, wss) = self.snapshot();
        json!(usage::overview(&self.home, days, &cfg, &|id| wss.iter().find(|w| w.id == id).map(|w| w.title.clone().unwrap_or_else(|| w.name.clone()))))
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
        let (k, opts) = self.options_for(&w, &r, &model, opt(a, "effort"), opt(a, "resume"), a.get("plan").and_then(Value::as_bool).unwrap_or(false), account.as_deref(), fast(a))?;
        let (agent, rx) = Self::spawn_agent(k, &opts)?;
        let rx = self.record_usage(rx, k, &model, account.as_deref(), &w.id);
        let effort = opt(a, "effort");
        let meta = ChatMeta {
            id: String::new(),
            workspace_id: w.id.clone(),
            path: w.path.clone(),
            branch: w.branch.clone(),
            title: opt(a, "title").unwrap_or_else(|| w.title.clone().unwrap_or_else(|| w.name.clone())),
            harness: k,
            model: model.label.clone(),
            approvals: k.harness().app_approvals(),
            account,
        };
        let view = self.chats.start(meta, agent, rx);
        self.chat_models.lock().unwrap().insert(view.meta.id.clone(), (model, effort, view.meta.account.clone()));
        Ok(view)
    }

    fn chat_switch(&self, a: &Value) -> Result<crate::chat::ChatView> {
        let id = s(a, "chatId")?;
        let ws = self.chats.workspace_of(&id).context("chat não encontrado")?;
        let (w, r) = self.ws_repo(&ws)?;
        let model: Model = serde_json::from_value(a["model"].clone()).context("modelo")?;
        let account = opt(a, "account");
        let (k, opts) = self.options_for(&w, &r, &model, opt(a, "effort"), None, false, account.as_deref(), fast(a))?;
        let (agent, rx) = Self::spawn_agent(k, &opts)?;
        let rx = self.record_usage(rx, k, &model, account.as_deref(), &w.id);
        let diff = kabul_core::shell::command("git").args(["-C", &w.path, "diff", "--stat", "HEAD"]).output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
        self.chat_models.lock().unwrap().insert(id.clone(), (model.clone(), opt(a, "effort"), account.clone()));
        self.chats.switch(&id, k, &model.label, account, agent, rx, &diff)
    }

    /// Arquivo de um ingresso (`/api/file`): confere de novo a credencial, o escopo e o caminho.
    pub fn file_for(&self, token: &str) -> Result<PathBuf> {
        let t = self.files.get(token).context("link expirado: abra o arquivo de novo")?;
        if !self.auth.is_active(&t.principal) {
            bail!("credencial revogada");
        }
        let (w, _) = self.ws_repo(&t.workspace)?;
        crate::files::resolve(Path::new(&w.path), &t.rel, t.guest)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::tests::Fake;

    fn hub() -> (Arc<Hub>, PathBuf) {
        let home = std::env::temp_dir().join(format!("kabuld-hub-{}-{}", std::process::id(), auth::random_token(4)));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join("state.json"), r#"{"repos":[],"workspaces":[]}"#).unwrap();
        let h = Hub::new(home.clone(), 0, Arc::new(crate::net::LocalOnly), Arc::new(crate::secrets::MemStore::default())).unwrap();
        (h, home)
    }

    fn chat_in(h: &Hub, id: &str, ws: &str) -> Arc<Mutex<Vec<String>>> {
        let sent = Arc::new(Mutex::new(vec![]));
        let meta = ChatMeta { id: id.into(), workspace_id: ws.into(), path: "/tmp".into(), branch: "b".into(), title: "t".into(), harness: HarnessKind::Claude, model: "m".into(), approvals: true, account: None };
        h.chats.attach_external(meta, Box::new(Fake { sent: sent.clone(), approvals: Arc::new(Mutex::new(vec![])) }));
        sent
    }

    /// Segurança: o convidado do w1 não alcança o chat do w2 mandando `workspaceId: w1` junto.
    #[test]
    fn convidado_nao_mistura_alvos() {
        let (h, home) = hub();
        let mine = chat_in(&h, "c1", "w1");
        let other = chat_in(&h, "c2", "w2");
        let ed = Principal { id: "d".into(), user: "Bia".into(), device: "x".into(), role: Role::Editor, scope: Scope::Workspace { id: "w1".into() }, color: String::new() };
        assert!(h.call(&ed, 1, "chat_send", &json!({"chatId": "c1", "text": "oi"})).is_ok());
        for args in [json!({"workspaceId": "w1", "chatId": "c2", "text": "x"}), json!({"chatId": "c2", "text": "x"}), json!({"workspaceId": "w1", "chatId": "nao-existe", "text": "x"})] {
            assert!(h.call(&ed, 1, "chat_send", &args).is_err(), "{args}");
        }
        assert!(h.call(&ed, 1, "chat_transcript", &json!({"workspaceId": "w1", "chatId": "c2"})).is_err());
        // Sessão tmux sem workspace (ou de outro) também não passa, mesmo com o workspaceId certo.
        assert!(h.call(&ed, 1, "term_input", &json!({"workspaceId": "w1", "session": "qualquer", "pane": "%0", "data": "x"})).is_err());
        assert_eq!(mine.lock().unwrap().len(), 1);
        assert!(other.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(home);
    }
}
