//! Kabul desktop: comandos Tauri finos sobre o `kabul-core`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use i18n::tr;
use kabul_core::auth::{self, AuthEvent, LoginSession};
use kabul_core::harness::{self, HarnessKind, Running};
use kabul_core::history::{self, SessionRecord, SessionSummary};
use kabul_core::import::sessions::{ImportedSession, ImportedWorkspace, SessionImporter};
use kabul_core::local::{self, CustomEndpoint, SourceStatus};
use kabul_core::models::{self, Model};
use kabul_core::registry::Registry;
use kabul_core::settings::{self, AppSettings, Layer, Settings};
use kabul_core::store::{self, Diff, DiffComment, FileChange, PrOptions, PrResult, Repo, Store, Workspace};
use kabul_core::term::{self, Cmd, Launch, Stream, What};
use kabul_core::{agent, checkpoint, speech};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

mod gitcmds;
mod i18n;
mod menu;
mod os;
mod remote;
mod tray;
mod updates;

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

struct App {
    home: PathBuf,
    store: Mutex<Store>,
    chats: Mutex<HashMap<String, Arc<Mutex<Running>>>>,
    logins: Mutex<HashMap<HarnessKind, LoginSession>>,
    terms: Mutex<HashMap<String, Stream>>,
    gh_login: Mutex<Option<LoginSession>>,
    account_logins: Mutex<HashMap<String, LoginSession>>,
    seq: Mutex<u64>,
    /// Processos deixados pelos agentes que o usuário manteve rodando.
    kept: kabul_core::procs::Kept,
    /// Workspace/modelo de cada conversa viva (barra do Kabul: "agentes rodando agora").
    chat_meta: Mutex<HashMap<String, tray::ChatInfo>>,
}

impl App {
    fn file(&self, name: &str) -> PathBuf {
        self.home.join(name)
    }
    fn app_settings(&self) -> AppSettings {
        AppSettings::load(&self.file("app-settings.json"))
    }
    fn next(&self, p: &str) -> String {
        let mut s = self.seq.lock().unwrap();
        *s += 1;
        format!("{p}-{}", *s)
    }
}

fn kind(s: &str) -> R<HarnessKind> {
    HarnessKind::parse(s).ok_or_else(|| format!("harness desconhecido: {s}"))
}

fn ws_repo(app: &App, id: &str) -> R<(Workspace, Repo)> {
    let s = app.store.lock().unwrap();
    let w = s.workspace(id).map_err(e)?.clone();
    let r = s.repo(&w.repo_id).map_err(e)?.clone();
    Ok((w, r))
}

/// Roda o comando numa sessão de terminal própria (recriada se já existir), com `[kabul] saiu com N` no
/// fim e um shell depois. tmux ou PTY, conforme o backend.
fn run_script(name: &str, cwd: &str, cmd: Cmd, env: &[(String, String)], log: Option<&Path>) -> R<String> {
    term::backend().replace(&Launch::new(name, Some(cwd), What::Run { cmd, log: log.map(Path::to_path_buf) }).env(env)).map_err(e)
}

/// Sessões do workspace (`<sessão>` e `<sessão>-*`).
fn workspace_sessions(w: &Workspace) -> Vec<String> {
    let main = w.tmux_session();
    term::backend().sessions().into_iter().filter(|s| s == &main || s.starts_with(&format!("{main}-"))).collect()
}

// ---------------- repos ----------------

#[tauri::command]
fn repos_list(app: State<App>) -> Vec<Repo> {
    app.store.lock().unwrap().state.repos.clone()
}

#[tauri::command]
fn repo_add(app: State<App>, path: String) -> R<Repo> {
    app.store.lock().unwrap().add_repo(&PathBuf::from(shellexpand(&path))).map_err(e)
}

#[tauri::command]
async fn repo_clone(app: State<'_, App>, url: String) -> R<Repo> {
    app.store.lock().unwrap().clone_repo(url.trim()).map_err(e)
}

#[tauri::command]
fn repo_remove(app: State<App>, id: String) -> R<()> {
    app.store.lock().unwrap().remove_repo(&id).map_err(e)
}

#[derive(Serialize)]
struct RepoSettings {
    settings: Settings,
    layers: Vec<Layer>,
}

#[tauri::command]
fn repo_settings(app: State<App>, repo_id: String) -> R<RepoSettings> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    let (settings, layers) = settings::load(Path::new(&r.path), &r.default_branch);
    Ok(RepoSettings { settings, layers })
}

#[tauri::command]
fn repo_settings_save(app: State<App>, repo_id: String, settings: Settings) -> R<String> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    settings::save_local(Path::new(&r.path), &settings).map(|p| p.display().to_string()).map_err(e)
}

// ---------------- workspaces ----------------

#[tauri::command]
fn workspaces_list(app: State<App>) -> Vec<Workspace> {
    app.store.lock().unwrap().state.workspaces.clone()
}

#[tauri::command]
async fn workspace_create(handle: AppHandle, app: State<'_, App>, repo_id: String) -> R<Workspace> {
    let prefix = app.app_settings().branch_prefix();
    let w = {
        let mut s = app.store.lock().unwrap();
        s.branch_prefix = prefix;
        s.create_workspace(&repo_id).map_err(e)?
    };
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    let (set, _) = settings::load(Path::new(&r.path), &r.default_branch);
    if let Some(script) = set.scripts.setup {
        let log = Path::new(&w.path).join(".context/setup-logs.txt");
        run_script(&format!("{}-setup", w.tmux_session()), &w.path, Cmd::Line(script), &w.full_env(&r), Some(&log))?;
        // Acompanha o fim do setup para trocar o estado.
        let (id, h) = (w.id.clone(), handle.clone());
        std::thread::spawn(move || {
            for _ in 0..3600 {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if let Ok(t) = std::fs::read_to_string(&log) {
                    if let Some(l) = t.lines().rev().find(|l| l.starts_with("[kabul] saiu com")) {
                        let ok = l.trim().ends_with(" 0");
                        let _ = h.emit("workspace-state", serde_json::json!({ "id": id, "state": if ok { "ready" } else { "setup_failed" } }));
                        let app = h.state::<App>();
                        let _ = app.store.lock().unwrap().update_workspace(&id, |x| x.state = if ok { "ready".into() } else { "setup_failed".into() });
                        return;
                    }
                }
            }
        });
    }
    Ok(w)
}

#[derive(Deserialize)]
struct WorkspacePatch {
    title: Option<String>,
    status: Option<String>,
    pinned: Option<bool>,
    notes: Option<String>,
    target_branch: Option<String>,
    unread: Option<bool>,
    /// "" tira da seção.
    section: Option<String>,
    pin_order: Option<u32>,
}

#[tauri::command]
fn workspace_update(app: State<App>, id: String, patch: WorkspacePatch) -> R<Workspace> {
    app.store
        .lock()
        .unwrap()
        .update_workspace(&id, |w| {
            if let Some(t) = patch.title {
                w.title = Some(t).filter(|t| !t.trim().is_empty());
            }
            if let Some(s) = patch.status {
                w.status = s;
            }
            if let Some(p) = patch.pinned {
                w.pinned = p;
            }
            if let Some(n) = patch.notes {
                w.notes = n;
            }
            if let Some(t) = patch.target_branch {
                w.target_branch = Some(t).filter(|t| !t.is_empty());
            }
            if let Some(u) = patch.unread {
                w.unread = u;
            }
            if let Some(s) = patch.section {
                w.section = Some(s).filter(|s| !s.is_empty());
            }
            if let Some(o) = patch.pin_order {
                w.pin_order = Some(o);
            }
        })
        .map_err(e)
}

#[tauri::command]
fn workspace_rename_branch(app: State<App>, id: String, name: String, by_user: bool) -> R<Workspace> {
    app.store.lock().unwrap().rename_branch(&id, &name, by_user).map_err(e)
}

#[tauri::command]
async fn workspace_archive(app: State<'_, App>, id: String, close_pr: Option<bool>, dry_run: Option<bool>) -> R<()> {
    let (w, r) = ws_repo(&app, &id)?;
    let app_set = app.app_settings();
    // "Archive and close PR": fecha o PR antes de remover o worktree.
    if close_pr.unwrap_or(false) && Path::new(&w.path).exists() {
        kabul_core::gitops::pr_close(&w, dry_run.unwrap_or(false) || app_set.github_dry_run).map_err(e)?;
    }
    let (set, _) = settings::load(Path::new(&r.path), &r.default_branch);
    if let (Some(script), true) = (set.scripts.archive, Path::new(&w.path).exists()) {
        let sh = kabul_core::shell::Shell::for_scripts();
        let o = kabul_core::shell::command(&sh.program).args(sh.run_args(&script, false)).current_dir(&w.path).envs(w.full_env(&r)).output().map_err(e)?;
        let log = Path::new(&w.path).join(".context/archive-logs.txt");
        let _ = std::fs::write(log, [o.stdout, o.stderr].concat());
    }
    app.store.lock().unwrap().archive_workspace_opts(&id, app_set.delete_branch_on_archive).map_err(e)?;
    for s in workspace_sessions(&w) {
        let _ = term::backend().kill(&s);
    }
    Ok(())
}

#[tauri::command]
async fn workspace_unarchive(app: State<'_, App>, id: String) -> R<Workspace> {
    app.store.lock().unwrap().unarchive_workspace(&id).map_err(e)
}

#[tauri::command]
async fn workspace_diff(app: State<'_, App>, workspace_id: String) -> R<Diff> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    store::diff(&r, &w).map_err(e)
}

#[tauri::command]
async fn workspace_changes(app: State<'_, App>, workspace_id: String, scope: Option<String>) -> R<Vec<FileChange>> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    kabul_core::gitops::changes(&r, &w, kabul_core::gitops::Scope::parse(scope.as_deref())).map_err(e)
}

#[tauri::command]
async fn workspace_file_diff(app: State<'_, App>, workspace_id: String, path: String, scope: Option<String>, ignore_ws: Option<bool>) -> R<String> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    kabul_core::gitops::file_diff(&r, &w, &path, kabul_core::gitops::Scope::parse(scope.as_deref()), ignore_ws.unwrap_or(false)).map_err(e)
}

#[tauri::command]
async fn workspace_files(app: State<'_, App>, workspace_id: String) -> R<Vec<String>> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    store::files(&w).map_err(e)
}

#[tauri::command]
async fn workspace_read_file(app: State<'_, App>, workspace_id: String, path: String) -> R<String> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    store::read_file(&w, &path).map_err(e)
}

#[tauri::command]
async fn workspace_busy(app: State<'_, App>, workspace_id: String) -> R<String> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    checkpoint::busy(Path::new(&w.path)).map_err(e)
}

/// Agentes rodando fora do Kabul e o histórico recente dos CLIs (só metadados).
#[tauri::command]
async fn external_sessions(app: State<'_, App>) -> R<kabul_core::external::ExternalSessions> {
    let home = app.home.clone();
    tauri::async_runtime::spawn_blocking(move || kabul_core::external::collect(&home, 40)).await.map_err(e)
}

/// Uso de recursos do app e dos filhos (agentes ligados ao workspace e à conversa).
#[tauri::command]
async fn resources_get(app: State<'_, App>) -> R<kabul_core::resources::Snapshot> {
    let mut hints: Vec<kabul_core::resources::Hint> = app.store.lock().unwrap().state.workspaces.iter().map(|w| kabul_core::resources::Hint { pid: None, path: Some(w.path.clone()), workspace_id: w.id.clone(), chat_id: None }).collect();
    for (id, r) in app.chats.lock().unwrap().iter() {
        if let Some(pid) = r.try_lock().ok().and_then(|r| r.pid()) {
            hints.push(kabul_core::resources::Hint { pid: Some(pid), path: None, workspace_id: String::new(), chat_id: Some(id.clone()) });
        }
    }
    tauri::async_runtime::spawn_blocking(move || kabul_core::resources::snapshot(&hints)).await.map_err(e)
}

#[tauri::command]
async fn workspaces_stats(app: State<'_, App>) -> R<HashMap<String, (u32, u32)>> {
    let pairs: Vec<(Workspace, Repo)> = {
        let s = app.store.lock().unwrap();
        s.state.workspaces.iter().filter(|w| !w.archived).filter_map(|w| Some((w.clone(), s.repo(&w.repo_id).ok()?.clone()))).collect()
    };
    Ok(pairs
        .into_iter()
        .filter_map(|(w, r)| {
            let ch = store::changes(&r, &w).ok()?;
            Some((w.id, ch.iter().fold((0, 0), |(a, d), c| (a + c.added.unwrap_or(0), d + c.removed.unwrap_or(0)))))
        })
        .collect())
}

#[tauri::command]
async fn workspace_pr(app: State<'_, App>, workspace_id: String, mut options: PrOptions) -> R<PrResult> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    // Configurações › Git: link do workspace, auto-merge, upstream e simulação.
    let set = app.app_settings();
    options.workspace_link |= set.pr_include_workspace_link;
    options.automerge |= set.automerge;
    options.merge_method.get_or_insert(set.merge_method.clone());
    options.no_upstream |= !set.push_set_upstream;
    options.dry_run |= set.github_dry_run;
    if !set.stacked_prs {
        options.stack_on = None;
    }
    let res = store::create_pr(&r, &w, &options).map_err(e)?;
    if let Some(u) = &res.url {
        let _ = app.store.lock().unwrap().update_workspace(&workspace_id, |x| {
            x.pr_url = Some(u.clone());
            x.status = "in-review".into();
        });
    }
    Ok(res)
}

// ---------------- comentários e checkpoints ----------------

#[tauri::command]
fn comments_list(app: State<App>, workspace_id: String) -> Vec<DiffComment> {
    app.store.lock().unwrap().state.comments.iter().filter(|c| c.workspace_id == workspace_id).cloned().collect()
}

#[tauri::command]
fn comment_add(app: State<App>, workspace_id: String, path: String, line: u32, end_line: Option<u32>, body: String) -> R<DiffComment> {
    let c = DiffComment { id: store::id(), workspace_id, path, line, end_line, body, resolved: false, created_at: store::now() };
    app.store.lock().unwrap().add_comment(c).map_err(e)
}

#[tauri::command]
fn comment_update(app: State<App>, id: String, resolved: Option<bool>, delete: bool) -> R<()> {
    app.store.lock().unwrap().set_comment(&id, resolved, delete).map_err(e)
}

#[tauri::command]
async fn checkpoints_list(app: State<'_, App>, workspace_id: String) -> R<Vec<checkpoint::Checkpoint>> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    checkpoint::list(Path::new(&w.path)).map_err(e)
}

#[tauri::command]
async fn checkpoint_create(app: State<'_, App>, workspace_id: String, message: String) -> R<checkpoint::Checkpoint> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    checkpoint::create(Path::new(&w.path), &format!("{}-{}", w.name, store::now_nanos()), &message).map_err(e)
}

#[tauri::command]
async fn checkpoint_restore(app: State<'_, App>, workspace_id: String, id: String) -> R<()> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    checkpoint::restore(Path::new(&w.path), &id).map_err(e)
}

// ---------------- anexos ----------------

#[tauri::command]
fn attach_file(app: State<App>, workspace_id: String, path: String) -> R<String> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    store::attach(&w, Path::new(&path)).map_err(e)
}

#[tauri::command]
fn attach_bytes(app: State<App>, workspace_id: String, name: String, data: Vec<u8>) -> R<String> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    store::attach_bytes(&w, &name, &data).map_err(e)
}

// ---------------- scripts ----------------

/// Roda setup | run | archive numa sessão de terminal própria e devolve o nome da sessão.
#[tauri::command]
fn script_run(app: State<App>, workspace_id: String, which: String, run_id: Option<String>) -> R<String> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let (set, _) = settings::load(Path::new(&r.path), &r.default_branch);
    let (name, script, log) = match which.as_str() {
        "setup" => (format!("{}-setup", w.tmux_session()), set.scripts.setup.clone(), Some(Path::new(&w.path).join(".context/setup-logs.txt"))),
        "archive" => (format!("{}-archive", w.tmux_session()), set.scripts.archive.clone(), None),
        _ => {
            let id = run_id.or_else(|| set.scripts.run.iter().find(|(_, s)| s.default).map(|(k, _)| k.clone())).or_else(|| set.scripts.run.keys().next().cloned()).ok_or(tr("nenhum run script configurado", "no run script configured"))?;
            if set.scripts.run_mode.as_deref() == Some("nonconcurrent") {
                let pre = format!("{}-run-", w.tmux_session());
                for s in term::backend().sessions().into_iter().filter(|s| s.starts_with(&pre)) {
                    let _ = term::backend().kill(&s);
                }
            }
            (format!("{}-run-{id}", w.tmux_session()), set.scripts.run.get(&id).map(|s| s.command.clone()), None)
        }
    };
    let script = script.ok_or_else(|| if i18n::is_en() { format!("no {which} script configured") } else { format!("nenhum script de {which} configurado") })?;
    run_script(&name, &w.path, Cmd::Line(script), &w.full_env(&r), log.as_deref())
}

#[tauri::command]
fn script_stop(session: String) -> R<()> {
    term::backend().kill(&session).map_err(e)
}

// ---------------- terminal (stream) ----------------

#[derive(Serialize, Clone)]
struct TermOut {
    session: String,
    pane: String,
    data: Vec<u8>,
}

#[derive(Serialize)]
struct TermInfo {
    session: String,
    pane: String,
    snapshot: String,
}

/// Abre (ou cria) a sessão de terminal e liga o stream. `name` nulo = terminal principal do workspace.
#[tauri::command]
fn term_open(handle: AppHandle, app: State<App>, workspace_id: String, name: Option<String>) -> R<TermInfo> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let session = name.unwrap_or_else(|| w.tmux_session());
    let b = term::backend();
    if !b.has(&session) {
        b.open(&Launch::new(&session, Some(&w.path), What::Shell).env(&w.full_env(&r))).map_err(e)?;
    }
    // A sessão acabou de nascer: espera o pane aparecer (até ~1 s) antes de desistir.
    let mut pane = None;
    for _ in 0..20 {
        pane = b.pane_of(&session);
        if pane.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let pane = pane.ok_or_else(|| if i18n::is_en() { format!("terminal {session} did not open (the session ended right after starting)") } else { format!("o terminal {session} não abriu (a sessão terminou logo ao iniciar)") })?;
    let snapshot = b.screen(&pane).unwrap_or_default();
    let mut terms = app.terms.lock().unwrap();
    if !terms.contains_key(&session) {
        let mut t = b.attach(&session).map_err(e)?;
        let rx = t.output.take().unwrap();
        let s2 = session.clone();
        std::thread::spawn(move || {
            for (pane, data) in kabul_core::batch::coalesce(rx, kabul_core::batch::frame()) {
                let _ = handle.emit("term-output", TermOut { session: s2.clone(), pane, data });
            }
        });
        terms.insert(session.clone(), t);
    }
    Ok(TermInfo { session, pane, snapshot })
}

#[tauri::command]
fn term_input(app: State<App>, session: String, pane: String, data: String) -> R<()> {
    match app.terms.lock().unwrap().get_mut(&session) {
        Some(t) => t.input(&pane, data.as_bytes()).map_err(e),
        None => term::backend().send(&pane, data.as_bytes()).map_err(e),
    }
}

#[tauri::command]
fn term_resize(app: State<App>, session: String, cols: u16, rows: u16) -> R<()> {
    if let Some(t) = app.terms.lock().unwrap().get_mut(&session) {
        t.resize(cols.max(20), rows.max(5)).map_err(e)?;
    }
    Ok(())
}

#[tauri::command]
fn term_close(app: State<App>, session: String) {
    app.terms.lock().unwrap().remove(&session);
}

/// Captura (para o agente ou para a PWA): tela atual do pane.
#[tauri::command]
async fn term_capture(target: String) -> R<String> {
    term::backend().screen(&target).map_err(e)
}

// ---------------- modelos, IAs locais e registro ----------------

fn registry(app: &App) -> Registry {
    Registry::load(&app.file("harness-registry.json"))
}

fn endpoints(app: &App) -> Vec<CustomEndpoint> {
    local::load_endpoints(&app.file("endpoints.json"))
}

#[tauri::command]
async fn models_list(app: State<'_, App>) -> R<Vec<Model>> {
    let mut v = models::catalog_for(&app.home);
    v.extend(models::local_models(&local::discover(&endpoints(&app)), &registry(&app)));
    Ok(v)
}

#[derive(Serialize)]
struct LocalOverview {
    sources: Vec<SourceStatus>,
    memory: Option<u64>,
    harnesses: Vec<(HarnessKind, bool, &'static str)>,
}

#[tauri::command]
async fn local_overview(app: State<'_, App>) -> R<LocalOverview> {
    Ok(LocalOverview { sources: local::discover(&endpoints(&app)), memory: local::total_memory(), harnesses: HarnessKind::ALL.iter().map(|k| (*k, k.installed(), k.install_command())).collect() })
}

#[tauri::command]
fn local_endpoint_save(app: State<App>, endpoint: CustomEndpoint) -> R<()> {
    let mut v = endpoints(&app);
    v.retain(|x| x.id != endpoint.id);
    v.push(endpoint);
    local::save_endpoints(&app.file("endpoints.json"), &v).map_err(e)
}

#[tauri::command]
fn local_endpoint_remove(app: State<App>, id: String) -> R<()> {
    let mut v = endpoints(&app);
    v.retain(|x| x.id != id);
    local::save_endpoints(&app.file("endpoints.json"), &v).map_err(e)
}

/// Baixa um modelo numa sessão de terminal visível (a UI pede confirmação antes).
#[tauri::command]
fn local_pull(source: String, model: String) -> R<String> {
    let rt = local::runtime(&source).ok_or("runtime desconhecido")?;
    let spec = rt.pull_command(&model).ok_or(tr("este runtime não baixa modelos", "this runtime does not download models"))?;
    let name = format!("kabul-pull-{}", store::slug(&model));
    term::backend().open(&Launch::new(&name, None, What::Exec(Cmd::Spec(spec)))).map_err(e)?;
    Ok(name)
}

#[tauri::command]
async fn local_start(source: String) -> R<()> {
    let rt = local::runtime(&source).ok_or("runtime desconhecido")?;
    let spec = rt.start_command().ok_or(tr("sem comando para iniciar", "no start command"))?;
    spec.command().stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().map_err(e)?;
    Ok(())
}

#[tauri::command]
fn harness_install(kind: String) -> R<String> {
    let k = self::kind(&kind)?;
    let name = format!("kabul-install-{}", k.binary());
    term::backend().replace(&Launch::new(&name, None, What::Run { cmd: Cmd::Line(k.install_command().into()), log: None })).map_err(e)?;
    Ok(name)
}

#[tauri::command]
fn registry_get(app: State<App>) -> String {
    std::fs::read_to_string(app.file("harness-registry.json")).unwrap_or_else(|_| kabul_core::registry::DEFAULT.to_string())
}

#[tauri::command]
fn registry_save(app: State<App>, text: String) -> R<()> {
    Registry::parse(&text).map_err(e)?;
    std::fs::write(app.file("harness-registry.json"), text).map_err(e)
}

#[tauri::command]
fn registry_reset(app: State<App>) -> R<()> {
    let _ = std::fs::remove_file(app.file("harness-registry.json"));
    Ok(())
}

// ---------------- chat ----------------

#[derive(Serialize, Clone)]
struct ChatPayload {
    chat_id: String,
    event: serde_json::Value,
}

#[derive(Serialize)]
struct ChatStarted {
    chat_id: String,
    harness: HarnessKind,
    approvals: bool,
    note: Option<String>,
    /// Como o plan mode chega a este agente: `native` ou `emulated` (só leitura + instrução).
    plan: kabul_core::harness::PlanSupport,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn chat_start(
    handle: AppHandle,
    app: State<'_, App>,
    workspace_id: String,
    model: Model,
    effort: Option<String>,
    fast: Option<bool>,
    resume: Option<String>,
    plan: Option<bool>,
    disabled_mcp: Option<Vec<String>>,
    fork: Option<bool>,
    account: Option<String>,
) -> R<ChatStarted> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let req = kabul_core::chat::ChatRequest { model: None, effort, fast, resume, plan, disabled_mcp, fork, account };
    // Mesmo caminho do `kabul serve` (core): harness, ambiente, conta e opções.
    let (p, mut running) = kabul_core::chat::start(&app.home, &w, &r, &model, &req, &endpoints(&app), &registry(&app)).map_err(e)?;
    let header = kabul_core::chat::log_header(&p);
    let (_tx, dummy) = std::sync::mpsc::channel();
    let rx = std::mem::replace(&mut running.events, dummy);
    let id = app.next("chat");
    // Uso: cada fim de turno vira um registro (tokens, custo, duração) e atualiza a barra.
    let meta = kabul_core::usage::Meta::for_chat(&app.home, p.kind, &model, req.account.as_deref(), &w.id);
    app.chat_meta.lock().unwrap().insert(id.clone(), tray::ChatInfo { workspace_id: w.id.clone(), model: model.label.clone(), harness: meta.harness.clone(), since: store::now(), working: false });
    let (h3, c3) = (handle.clone(), id.clone());
    let rx = kabul_core::usage::tap(rx, kabul_core::usage::Recorder::new(&app.home, meta), move |_| {
        if let Some(m) = h3.state::<App>().chat_meta.lock().unwrap().get_mut(&c3) {
            m.working = false;
        }
        tray::changed(&h3);
    });
    let running = Arc::new(Mutex::new(running));
    app.chats.lock().unwrap().insert(id.clone(), running.clone());
    remote::mirror_chat(&handle, &id, &w, p.kind, &model.label, p.opts.approvals_via_app, running.clone());
    let cid = id.clone();
    let caffeinate = app.app_settings().caffeinate;
    let log = app.file("logs/agents.log");
    std::thread::spawn(move || {
        // Mantém o computador acordado enquanto o agente roda (criado e solto nesta thread).
        let coffee = if caffeinate { kabul_core::power::KeepAwake::start() } else { None };
        let h2 = handle.clone();
        let emit = |ev: serde_json::Value| {
            let _ = handle.emit("chat-event", ChatPayload { chat_id: cid.clone(), event: ev });
        };
        // "Parado pelo usuário" = o chat_stop já tirou a conversa da lista.
        let stopped = || !h2.state::<App>().chats.lock().unwrap().contains_key(&cid);
        let r2 = running.clone();
        // Espelho no kabuld embutido (celular): vê cada evento e fecha quando o agente sai.
        let tap = |ev: &kabul_core::harness::Event| remote::feed(&h2, &cid, ev);
        kabul_core::chat::pump_with(rx, tap, emit, stopped, move || r2.lock().unwrap().wait(), Some((log, format!("{header} · {cid}"))));
        remote::close_chat(&h2, &cid);
        h2.state::<App>().chat_meta.lock().unwrap().remove(&cid);
        drop(coffee);
    });
    Ok(ChatStarted { chat_id: id, harness: p.kind, approvals: p.opts.approvals_via_app, note: p.note, plan: p.kind.harness().plan_support() })
}

fn chat(app: &App, id: &str) -> R<Arc<Mutex<Running>>> {
    app.chats.lock().unwrap().get(id).cloned().ok_or_else(|| tr("chat não encontrado (encerrado?)", "chat not found (ended?)").into())
}

#[tauri::command]
fn chat_send(handle: AppHandle, app: State<App>, chat_id: String, text: String) -> R<()> {
    chat(&app, &chat_id)?.lock().unwrap().send(&text).map_err(e)?;
    if let Some(m) = app.chat_meta.lock().unwrap().get_mut(&chat_id) {
        m.working = true;
    }
    remote::local_send(&handle, &chat_id, &text);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn chat_approve(handle: AppHandle, app: State<App>, chat_id: String, request_id: String, allow: bool, tool: Option<String>, updated_input: Option<serde_json::Value>, always: Option<bool>) -> R<()> {
    chat(&app, &chat_id)?.lock().unwrap().approve_ext(&request_id, allow, tool.as_deref().unwrap_or(""), updated_input, always.unwrap_or(false)).map_err(e)?;
    remote::local_approval(&handle, &chat_id, &request_id, allow);
    Ok(())
}

/// Troca o modo da sessão ao vivo (ex.: sair do plan mode ao aprovar o plano). `false`: o agente não
/// troca sem reiniciar (o app retoma a sessão com o modo novo).
#[tauri::command]
fn chat_set_mode(app: State<App>, chat_id: String, mode: String) -> R<bool> {
    chat(&app, &chat_id)?.lock().unwrap().set_mode(&mode).map_err(e)
}

#[tauri::command]
fn chat_stop(app: State<App>, chat_id: String) -> R<()> {
    if let Some(c) = app.chats.lock().unwrap().remove(&chat_id) {
        let _ = c.lock().unwrap().kill();
    }
    Ok(())
}

/// "Parar": interrompe só o turno pelo protocolo do agente (a sessão continua e é retomável) e devolve o
/// que ficou rodando. Se o agente saiu, a conversa sai da lista (o próximo envio retoma com --resume).
#[tauri::command]
async fn chat_interrupt(app: State<'_, App>, chat_id: String) -> R<kabul_core::procs::StopReport> {
    let Some(r) = app.chats.lock().unwrap().get(&chat_id).cloned() else { return Ok(Default::default()) };
    let rep = tauri::async_runtime::spawn_blocking(move || kabul_core::procs::stop_turn(&r, std::time::Duration::from_millis(1500))).await.map_err(e)?;
    if !rep.alive {
        app.chats.lock().unwrap().remove(&chat_id);
    }
    Ok(rep)
}

/// Processos que as conversas abriram e que continuariam vivos ao encerrá-las (fechar aba, arquivar, sair).
#[tauri::command]
async fn chat_processes(app: State<'_, App>, chat_ids: Vec<String>) -> R<Vec<kabul_core::procs::Leftover>> {
    let rs: Vec<_> = {
        let c = app.chats.lock().unwrap();
        chat_ids.iter().filter_map(|id| c.get(id).cloned()).collect()
    };
    tauri::async_runtime::spawn_blocking(move || rs.iter().flat_map(|r| kabul_core::procs::session_leftovers(r)).collect()).await.map_err(e)
}

#[tauri::command]
fn processes_keep(app: State<App>, items: Vec<kabul_core::procs::Leftover>, workspace_id: Option<String>) {
    app.kept.keep(items, workspace_id);
}

#[tauri::command]
async fn processes_kept(app: State<'_, App>) -> R<Vec<kabul_core::procs::Leftover>> {
    Ok(app.kept.alive())
}

/// Encerra os processos escolhidos e os filhos deles (SIGTERM, depois SIGKILL).
#[tauri::command]
async fn process_kill(app: State<'_, App>, keys: Vec<kabul_core::procs::Key>) -> R<usize> {
    app.kept.forget(&keys);
    let k = keys.clone();
    tauri::async_runtime::spawn_blocking(move || kabul_core::procs::terminate(&k, std::time::Duration::from_secs(2))).await.map_err(e)
}

#[tauri::command]
async fn docker_stop(id: String) -> R<()> {
    tauri::async_runtime::spawn_blocking(move || kabul_core::procs::docker_stop(&id)).await.map_err(e)?.map_err(e)
}

/// Ao primeiro envio: renomeia a branch a partir da mensagem, se o usuário não fixou um nome.
#[tauri::command]
fn workspace_auto_branch(app: State<App>, workspace_id: String, text: String) -> R<Option<Workspace>> {
    let set = app.app_settings();
    if !set.auto_rename_branch {
        return Ok(None);
    }
    app.store.lock().unwrap().auto_branch(&workspace_id, &text, set.rename_ws_on_branch).map_err(e)
}

// ---------------- histórico ----------------

#[tauri::command]
fn history_list(app: State<App>, workspace_id: String) -> Vec<SessionSummary> {
    history::list(&app.home, &workspace_id)
}

#[tauri::command]
fn history_load(app: State<App>, workspace_id: String, id: String) -> R<SessionRecord> {
    history::load(&app.home, &workspace_id, &id).map_err(e)
}

#[tauri::command]
fn history_save(app: State<App>, record: SessionRecord) -> R<()> {
    history::save(&app.home, &record).map_err(e)
}

#[tauri::command]
fn history_delete(app: State<App>, workspace_id: String, id: String) -> R<()> {
    history::delete(&app.home, &workspace_id, &id).map_err(e)
}

#[tauri::command]
fn history_search(app: State<App>, q: String) -> Vec<(String, String, String, String)> {
    if q.trim().len() < 2 {
        return vec![];
    }
    history::search(&app.home, &q)
}

#[tauri::command]
fn slash_commands(app: State<App>, workspace_id: String) -> R<Vec<(String, String)>> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    Ok(history::slash_commands(Path::new(&w.path)))
}

// ---------------- sessões ----------------

#[derive(Serialize)]
struct TmuxSession {
    #[serde(flatten)]
    pane: term::Pane,
    agent: &'static str,
}

#[derive(Serialize)]
struct Sessions {
    tmux: Vec<TmuxSession>,
    imported_workspaces: Vec<ImportedWorkspace>,
    imported_sessions: Vec<ImportedSession>,
    imported_error: Option<String>,
}

#[tauri::command]
async fn sessions_list() -> R<Sessions> {
    let panes = term::backend().list().map_err(e)?;
    // Uma leitura da tabela de processos para todos os panes (antes: uma por pane).
    let agents = agent::detect_panes(&panes);
    let tmux = panes.into_iter().zip(agents).map(|(p, a)| TmuxSession { agent: a.label(), pane: p }).collect();
    let (mut cw, mut cs, mut err) = (vec![], vec![], None);
    match SessionImporter::open_detected(None).and_then(|db| Ok((db.workspaces()?, db.sessions()?))) {
        Ok((w, s)) => (cw, cs) = (w, s),
        Err(x) => err = Some(e(x)),
    }
    Ok(Sessions { tmux, imported_workspaces: cw, imported_sessions: cs, imported_error: err })
}

// ---------------- contas ----------------

#[derive(Serialize)]
struct AuthRow {
    kind: HarnessKind,
    logged_in: bool,
    source: String,
    method: Option<String>,
    error: Option<String>,
    installed: bool,
}

#[tauri::command]
async fn auth_status() -> Vec<AuthRow> {
    HarnessKind::ALL
        .into_iter()
        .map(|k| match auth::status(k) {
            Ok(s) => AuthRow { kind: k, logged_in: s.logged_in, source: s.source, method: s.method, error: None, installed: k.installed() },
            Err(x) => AuthRow { kind: k, logged_in: false, source: String::new(), method: None, error: Some(e(x)), installed: k.installed() },
        })
        .collect()
}

#[derive(Serialize, Clone)]
struct AuthPayload {
    kind: HarnessKind,
    event: AuthEvent,
}

#[tauri::command]
fn auth_login(handle: AppHandle, app: State<App>, kind: String) -> R<()> {
    let k = self::kind(&kind)?;
    if let Some(mut old) = app.logins.lock().unwrap().remove(&k) {
        let _ = old.cancelar();
    }
    let mut s = auth::login(k).map_err(e)?;
    let (_tx, dummy) = std::sync::mpsc::channel();
    let rx = std::mem::replace(&mut s.events, dummy);
    app.logins.lock().unwrap().insert(k, s);
    std::thread::spawn(move || {
        for ev in rx {
            let _ = handle.emit("auth-event", AuthPayload { kind: k, event: ev });
        }
    });
    Ok(())
}

#[tauri::command]
fn auth_code(app: State<App>, kind: String, code: String) -> R<()> {
    let k = self::kind(&kind)?;
    app.logins.lock().unwrap().get_mut(&k).ok_or(tr("nenhum login em andamento", "no login in progress"))?.enviar_codigo(&code).map_err(e)
}

#[tauri::command]
fn auth_cancel(app: State<App>, kind: String) -> R<()> {
    if let Some(mut s) = app.logins.lock().unwrap().remove(&self::kind(&kind)?) {
        let _ = s.cancelar();
    }
    Ok(())
}

// ---------------- nuvem, teleport e espelhamento ----------------

fn capture(session: &str) -> String {
    let b = term::backend();
    b.pane_of(session).and_then(|p| b.capture(&p, 400).ok()).unwrap_or_default()
}

#[derive(Serialize)]
struct CloudStarted {
    tmux: String,
    info: kabul_core::cloud::CloudInfo,
}

/// `claude --cloud` exige TTY: roda numa sessão de terminal e lê o id/URL da saída (até 90 s).
#[tauri::command]
async fn cloud_start(app: State<'_, App>, workspace_id: String, prompt: String, environment: Option<String>) -> R<CloudStarted> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let name = format!("{}-cloud-{}", w.tmux_session(), store::now() % 100000);
    run_script(&name, &w.path, Cmd::Spec(kabul_core::cloud::cloud_spec(&prompt, environment.as_deref().filter(|e| !e.trim().is_empty()))), &w.full_env(&r), None)?;
    for _ in 0..180 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let info = kabul_core::cloud::parse(&capture(&name));
        if info.id.is_some() || info.exited.is_some() {
            return Ok(CloudStarted { tmux: name, info });
        }
    }
    Ok(CloudStarted { info: kabul_core::cloud::parse(&capture(&name)), tmux: name })
}

#[tauri::command]
fn cloud_poll(tmux: String) -> kabul_core::cloud::CloudInfo {
    kabul_core::cloud::parse(&capture(&tmux))
}

fn run_in_workspace(app: &App, workspace_id: &str, name: &str, cmd: Cmd) -> R<String> {
    let (w, r) = ws_repo(app, workspace_id)?;
    let session = format!("{}-{}", w.tmux_session(), store::slug(name));
    run_script(&session, &w.path, cmd, &w.full_env(&r), None)
}

/// Roda uma linha de shell numa sessão de terminal do workspace.
#[tauri::command]
fn term_run(app: State<App>, workspace_id: String, name: String, command: String) -> R<String> {
    run_in_workspace(&app, &workspace_id, &name, Cmd::Line(command))
}

/// Traz a sessão da nuvem para cá (`claude --teleport <id>`).
#[tauri::command]
fn teleport(app: State<App>, workspace_id: String, id: String) -> R<String> {
    let tail: String = id.chars().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
    run_in_workspace(&app, &workspace_id, &format!("teleport-{tail}"), Cmd::Spec(kabul_core::cloud::teleport_spec(&id)))
}

#[derive(Serialize)]
struct Mirror {
    running: bool,
    tmux: String,
    link: Option<String>,
}

fn mirror_name(w: &Workspace) -> String {
    format!("{}-mirror", w.tmux_session())
}

#[tauri::command]
fn mirror_status(app: State<App>, workspace_id: String) -> R<Mirror> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    let name = mirror_name(&w);
    let running = term::backend().has(&name);
    Ok(Mirror { link: running.then(|| kabul_core::cloud::parse_remote_link(&capture(&name))).flatten(), running, tmux: name })
}

/// Espelha no claude.ai/code e no celular: sessão interativa com `--remote-control kabul-<workspace>`
/// (retoma a conversa atual quando há id).
#[tauri::command]
async fn mirror_start(app: State<'_, App>, workspace_id: String, resume: Option<String>) -> R<Mirror> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let name = mirror_name(&w);
    run_script(&name, &w.path, Cmd::Spec(kabul_core::cloud::remote_control_spec(&w.tmux_session(), resume.as_deref())), &w.full_env(&r), None)?;
    // A TUI do Claude não imprime o link (confirmado): a sessão aparece como `kabul-<ws>` em claude.ai/code.
    for _ in 0..6 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if let Some(link) = kabul_core::cloud::parse_remote_link(&capture(&name)) {
            return Ok(Mirror { running: true, tmux: name, link: Some(link) });
        }
    }
    Ok(Mirror { running: term::backend().has(&name), tmux: name, link: None })
}

#[tauri::command]
fn mirror_stop(app: State<App>, workspace_id: String) -> R<()> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    term::backend().kill(&mirror_name(&w)).map_err(e)
}

/// Fork para um workspace novo: worktree no commit do checkpoint, arquivos do checkpoint e a sessão
/// do Claude copiada para o projeto novo (para `--resume <id> --fork-session` funcionar lá).
#[tauri::command]
async fn workspace_fork(handle: AppHandle, app: State<'_, App>, workspace_id: String, checkpoint_id: Option<String>, agent_session: Option<String>) -> R<Workspace> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let ck = checkpoint_id.and_then(|c| checkpoint::list(Path::new(&w.path)).ok()?.into_iter().find(|x| x.id == c));
    let base = ck.as_ref().map(|c| c.head.clone()).unwrap_or_else(|| "HEAD".into());
    let base = if base == "HEAD" { kabul_core::shell::command("git").arg("-C").arg(&w.path).args(["rev-parse", "HEAD"]).output().map_err(e).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())? } else { base };
    let prefix = app.app_settings().branch_prefix();
    let nw = {
        let mut st = app.store.lock().unwrap();
        st.branch_prefix = prefix;
        st.create_workspace_from(&r.id, Some(&base)).map_err(e)?
    };
    if let Some(c) = &ck {
        checkpoint::restore(Path::new(&nw.path), &c.id).map_err(e)?;
    }
    if let Some(sid) = &agent_session {
        let _ = harness::claude::copy_session(sid, Path::new(&w.path), Path::new(&nw.path));
    }
    let _ = handle.emit("workspace-state", serde_json::json!({ "id": nw.id, "state": nw.state }));
    let title = format!("{} (fork)", w.title.clone().unwrap_or_else(|| w.name.clone()));
    app.store.lock().unwrap().update_workspace(&nw.id, |x| x.title = Some(title)).map_err(e)
}

// ---------------- várias contas por provedor ----------------

#[derive(Serialize)]
struct AccountRow {
    #[serde(flatten)]
    p: kabul_core::accounts::AccountProfile,
    logged_in: Option<bool>,
    env_var: Option<&'static str>,
    env_confirmed: bool,
}

#[tauri::command]
async fn accounts_list(app: State<'_, App>, provider: String) -> R<Vec<AccountRow>> {
    let a = kabul_core::accounts::Accounts::open(&app.home);
    let iso = kabul_core::accounts::isolation(&provider);
    Ok(a.of(&provider).into_iter().map(|p| AccountRow { logged_in: kabul_core::accounts::logged_in(&p), env_var: iso.map(|i| i.0), env_confirmed: iso.map(|i| i.1).unwrap_or(false), p }).collect())
}

#[tauri::command]
fn account_add(app: State<App>, provider: String, nickname: String) -> R<kabul_core::accounts::AccountProfile> {
    kabul_core::accounts::Accounts::open(&app.home).add(&provider, &nickname).map_err(e)
}

#[tauri::command]
fn account_update(app: State<App>, id: String, nickname: Option<String>, make_default: Option<bool>, remove: Option<bool>) -> R<()> {
    let mut a = kabul_core::accounts::Accounts::open(&app.home);
    if remove.unwrap_or(false) {
        return a.remove(&id).map_err(e);
    }
    if let Some(n) = nickname {
        a.rename(&id, &n).map_err(e)?;
    }
    if make_default.unwrap_or(false) {
        a.set_default(&id).map_err(e)?;
    }
    Ok(())
}

/// Login de um perfil pelo fluxo do próprio CLI, com a config isolada do perfil.
#[tauri::command]
fn account_login(handle: AppHandle, app: State<App>, id: String) -> R<()> {
    let a = kabul_core::accounts::Accounts::open(&app.home);
    let p = a.get(&id).ok_or(tr("conta não encontrada", "account not found"))?;
    let (argv, kick) = kabul_core::accounts::login_argv(&p.provider).ok_or(tr("este provedor não tem login pelo CLI", "this provider has no CLI login"))?;
    if let Some(mut old) = app.account_logins.lock().unwrap().remove(&id) {
        let _ = old.cancelar();
    }
    let mut s = auth::login_argv(&argv, kick, &kabul_core::accounts::env_for(&p), kabul_core::accounts::login_check(&p)).map_err(e)?;
    let (_tx, dummy) = std::sync::mpsc::channel();
    let rx = std::mem::replace(&mut s.events, dummy);
    app.account_logins.lock().unwrap().insert(id.clone(), s);
    std::thread::spawn(move || {
        for ev in rx {
            let _ = handle.emit("account-auth-event", serde_json::json!({ "id": id, "event": ev }));
        }
    });
    Ok(())
}

#[tauri::command]
fn account_code(app: State<App>, id: String, code: String) -> R<()> {
    app.account_logins.lock().unwrap().get_mut(&id).ok_or(tr("nenhum login em andamento", "no login in progress"))?.enviar_codigo(&code).map_err(e)
}

#[tauri::command]
fn account_cancel(app: State<App>, id: String) {
    if let Some(mut s) = app.account_logins.lock().unwrap().remove(&id) {
        let _ = s.cancelar();
    }
}

// ---------------- GitHub ----------------

#[tauri::command]
async fn github_status() -> Vec<kabul_core::github::GhAccount> {
    kabul_core::github::status()
}

#[tauri::command]
fn github_login(handle: AppHandle, app: State<App>) -> R<()> {
    let gh_ok = auth::LoginCheck { done: std::sync::Arc::new(|| kabul_core::github::status().iter().any(|a| a.active && a.ok)), poll: false };
    let mut s = auth::login_argv(&["gh", "auth", "login", "--web", "-h", "github.com", "-p", "https", "--skip-ssh-key"], b"\n", &[], gh_ok).map_err(e)?;
    let (_tx, dummy) = std::sync::mpsc::channel();
    let rx = std::mem::replace(&mut s.events, dummy);
    *app.gh_login.lock().unwrap() = Some(s);
    std::thread::spawn(move || {
        for ev in rx {
            let _ = handle.emit("github-auth-event", ev);
        }
    });
    Ok(())
}

#[tauri::command]
fn github_cancel(app: State<App>) {
    if let Some(mut s) = app.gh_login.lock().unwrap().take() {
        let _ = s.cancelar();
    }
}

#[tauri::command]
fn github_switch(login: String) -> R<()> {
    kabul_core::github::switch(&login).map_err(e)
}

/// Token pessoal: Keychain + GH_TOKEN para os `gh`/`git` que o Kabul roda.
#[tauri::command]
fn github_token(token: Option<String>) -> R<bool> {
    match token.filter(|t| !t.trim().is_empty()) {
        Some(t) => {
            kabul_core::github::set_token(&t).map_err(e)?;
            std::env::set_var("GH_TOKEN", t.trim());
            Ok(true)
        }
        None => {
            kabul_core::github::clear_token();
            std::env::remove_var("GH_TOKEN");
            Ok(false)
        }
    }
}

#[tauri::command]
fn github_token_set() -> bool {
    kabul_core::github::get_token().is_some()
}

#[tauri::command]
async fn github_repo_access(app: State<'_, App>, repo_id: String) -> R<kabul_core::github::RepoAccess> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    Ok(kabul_core::github::repo_access(Path::new(&r.path)))
}

// ---------------- criar a partir de branch / PR ----------------

#[tauri::command]
async fn repo_branches(app: State<'_, App>, repo_id: String) -> R<Vec<String>> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    store::branches(Path::new(&r.path)).map_err(e)
}

#[tauri::command]
async fn repo_prs(app: State<'_, App>, repo_id: String) -> R<Vec<serde_json::Value>> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    let o = kabul_core::shell::command("gh").args(["pr", "list", "--limit", "40", "--json", "number,title,headRefName,author,isDraft,updatedAt,url"]).current_dir(&r.path).output().map_err(e)?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    serde_json::from_slice(&o.stdout).map_err(e)
}

/// Criar workspace: base alternativa, branch existente ou PR (`pull/N/head`).
#[tauri::command]
async fn workspace_create_ex(handle: AppHandle, app: State<'_, App>, repo_id: String, base: Option<String>, branch: Option<String>, pr: Option<u32>, pr_head: Option<String>) -> R<Workspace> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    if let Some(n) = pr {
        let b = store::fetch_pr(Path::new(&r.path), n, pr_head.as_deref().unwrap_or("")).map_err(e)?;
        return app.store.lock().unwrap().create_workspace_on_branch(&repo_id, &b).map_err(e);
    }
    if let Some(b) = branch {
        return app.store.lock().unwrap().create_workspace_on_branch(&repo_id, &b).map_err(e);
    }
    if let Some(b) = base {
        let prefix = app.app_settings().branch_prefix();
        let mut st = app.store.lock().unwrap();
        st.branch_prefix = prefix;
        let base = if b.starts_with("origin/") { b } else { format!("origin/{b}") };
        return st.create_workspace_from(&repo_id, Some(&base)).map_err(e);
    }
    workspace_create(handle, app, repo_id).await
}

// ---------------- MCP ----------------

#[tauri::command]
async fn mcp_list(app: State<'_, App>, workspace_id: String, harness: String) -> R<Vec<kabul_core::mcp::McpEntry>> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    Ok(kabul_core::mcp::list(kind(&harness)?, Path::new(&w.path), Path::new(&r.path)))
}

#[tauri::command]
fn mcp_add(app: State<App>, workspace_id: String, name: String, command: String, args: Vec<String>) -> R<()> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    kabul_core::mcp::add_project(Path::new(&w.path), name.trim(), command.trim(), &args, &[]).map_err(e)
}

/// Registro único de MCP (todas as configs nativas), com origem, compartilhamento e peso em cache.
#[tauri::command]
async fn mcp_shared(app: State<'_, App>, workspace_id: String) -> R<Vec<kabul_core::mcp_share::View>> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let all = kabul_core::mcp_share::shared(Path::new(&w.path), Path::new(&r.path));
    Ok(kabul_core::mcp_share::views(&app.home, &all, &kabul_core::mcp_share::Prefs::load(&app.home)))
}

/// Mede o peso de um MCP (abre o servidor stdio e pede `tools/list`); guarda em cache.
#[tauri::command]
async fn mcp_weigh(app: State<'_, App>, workspace_id: String, name: String) -> R<kabul_core::mcp_share::Weight> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let all = kabul_core::mcp_share::shared(Path::new(&w.path), Path::new(&r.path));
    let sv = all.into_iter().find(|x| x.server.name == name).ok_or_else(|| if i18n::is_en() { format!("MCP {name} not found") } else { format!("MCP {name} não encontrado") })?.server;
    let home = app.home.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let wt = kabul_core::mcp_share::weigh(&sv, std::time::Duration::from_secs(15)).map_err(e)?;
        kabul_core::mcp_share::store_weight(&home, &sv, wt).map_err(e)?;
        Ok(wt)
    })
    .await
    .map_err(e)?
}

/// "Disponível em todas as IAs" de um MCP.
#[tauri::command]
fn mcp_set_shared(app: State<App>, workspace_id: String, name: String, on: bool) -> R<()> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let all = kabul_core::mcp_share::shared(Path::new(&w.path), Path::new(&r.path));
    let sv = all.into_iter().find(|x| x.server.name == name).ok_or_else(|| if i18n::is_en() { format!("MCP {name} not found") } else { format!("MCP {name} não encontrado") })?.server;
    let mut p = kabul_core::mcp_share::Prefs::load(&app.home);
    p.set_shared(&sv, on);
    p.save(&app.home).map_err(e)
}

/// Exporta um MCP para a config global do Antigravity (com backup). Devolve o caminho do backup.
#[tauri::command]
fn mcp_export_agy(app: State<App>, workspace_id: String, name: String) -> R<Option<String>> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let all = kabul_core::mcp_share::shared(Path::new(&w.path), Path::new(&r.path));
    let sv = all.into_iter().find(|x| x.server.name == name).ok_or_else(|| if i18n::is_en() { format!("MCP {name} not found") } else { format!("MCP {name} não encontrado") })?.server;
    Ok(kabul_core::mcp_share::export_agy(&sv, &kabul_core::mcp_share::agy_config_file()).map_err(e)?.map(|b| b.display().to_string()))
}

// ---------------- Linear ----------------

#[derive(Serialize)]
struct LinearStatus {
    connected: bool,
    who: Option<String>,
    error: Option<String>,
}

#[tauri::command]
async fn linear_status() -> LinearStatus {
    if kabul_core::linear::get_key().is_none() {
        return LinearStatus { connected: false, who: None, error: None };
    }
    match kabul_core::linear::viewer() {
        Ok(w) => LinearStatus { connected: true, who: Some(w), error: None },
        Err(x) => LinearStatus { connected: true, who: None, error: Some(e(x)) },
    }
}

#[tauri::command]
async fn linear_connect(key: String) -> R<String> {
    kabul_core::linear::set_key(&key).map_err(e)?;
    kabul_core::linear::viewer().map_err(|x| {
        kabul_core::linear::clear_key();
        e(x)
    })
}

#[tauri::command]
fn linear_disconnect() {
    kabul_core::linear::clear_key();
}

#[tauri::command]
async fn linear_issues(search: Option<String>) -> R<Vec<kabul_core::linear::Issue>> {
    kabul_core::linear::issues(search.as_deref()).map_err(e)
}

/// Workspace a partir de uma issue: branch e título da issue, contexto em `.context/[LINEAR]-<ID>.md`.
#[tauri::command]
async fn workspace_from_issue(handle: AppHandle, app: State<'_, App>, repo_id: String, issue: kabul_core::linear::Issue) -> R<Workspace> {
    let w = workspace_create(handle, app.clone(), repo_id).await?;
    let prefix = w.branch.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
    let tail = issue.branch_name.as_deref().map(|b| b.rsplit('/').next().unwrap_or(b).to_string()).unwrap_or_else(|| format!("{}-{}", issue.identifier.to_lowercase(), store::slug(&issue.title)));
    let mut st = app.store.lock().unwrap();
    let branch = if prefix.is_empty() { tail } else { format!("{prefix}/{tail}") };
    let _ = st.rename_branch(&w.id, &branch, true);
    let _ = std::fs::write(Path::new(&w.path).join(format!(".context/[LINEAR]-{}.md", issue.identifier)), kabul_core::linear::context_markdown(&issue));
    st.update_workspace(&w.id, |x| {
        x.title = Some(format!("{} {}", issue.identifier, issue.title));
        x.linear = Some(store::LinearLink { identifier: issue.identifier.clone(), title: issue.title.clone(), url: issue.url.clone() });
    })
    .map_err(e)
}

// ---------------- abrir em (Finder, editores, terminais) ----------------

#[derive(Serialize)]
struct OpenTarget {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    app: String,
    /// PNG do ícone real do app (data URL), extraído com NSWorkspace (só no macOS por enquanto).
    icon: Option<String>,
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            o.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    o
}

#[tauri::command]
async fn open_targets(app: State<'_, App>) -> R<Vec<OpenTarget>> {
    let found: Vec<(os::AppSpec, String)> = os::open_apps().into_iter().filter_map(|t| t.found().map(|p| p.display().to_string()).map(|p| (t, p))).collect();
    let dir = app.file("icons");
    os::ensure_icons(&dir, &found.iter().map(|(t, p)| (t.id.to_string(), p.clone())).collect::<Vec<_>>());
    Ok(found.into_iter().map(|(t, p)| OpenTarget { id: t.id, name: t.name, kind: t.kind, icon: std::fs::read(dir.join(format!("{}.png", t.id))).ok().map(|b| format!("data:image/png;base64,{}", b64(&b))), app: p }).collect())
}

#[tauri::command]
fn open_in(target: String, path: String) -> R<()> {
    let t = os::open_apps().into_iter().find(|t| t.id == target).ok_or("app desconhecido")?;
    let app_path = t.found().cloned().ok_or(tr("app não instalado", "app not installed"))?;
    // Só caminho absoluto real; terminal só recebe pasta ([`kabul_core::open::open_in_path`]).
    let path = kabul_core::open::open_in_path(&path, t.kind).map_err(e)?;
    os::open_in(&t, &app_path, &path.display().to_string())
}

// ---------------- checks do PR ----------------

#[derive(Serialize)]
struct PrChecks {
    checks: Vec<serde_json::Value>,
    message: Option<String>,
}

#[tauri::command]
async fn pr_checks(app: State<'_, App>, workspace_id: String) -> R<PrChecks> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    let (checks, message) = kabul_core::gitops::pr_checks_cached(&w).map_err(e)?;
    Ok(PrChecks { checks, message })
}

// ---------------- app ----------------

#[tauri::command]
fn app_settings_get(app: State<App>) -> AppSettings {
    app.app_settings()
}

#[tauri::command]
fn app_settings_save(handle: AppHandle, app: State<App>, settings: AppSettings) -> R<()> {
    settings.apply_bin_overrides();
    settings.save(&app.file("app-settings.json")).map_err(e)?;
    // Liga/desliga o ícone da barra de menus na hora.
    tray::apply(&handle);
    Ok(())
}

#[tauri::command]
fn notify(handle: AppHandle, app: State<App>, title: String, body: String) -> R<()> {
    send_notification(&handle, &app, &title, &body)
}

/// Notificação do sistema (respeita Configurações › Notificações): conversas e alertas de uso da barra.
fn send_notification(handle: &AppHandle, app: &App, title: &str, body: &str) -> R<()> {
    let s = app.app_settings();
    if !s.notifications {
        return Ok(());
    }
    // Plugin de notificação do Tauri (macOS, Windows, Linux): a notificação sai em nome do app, então o
    // clique traz o Kabul para a frente e o frontend abre a conversa que avisou (ver `useNotifyFocus`).
    let sound = (s.sound && s.completion_sound != "none").then_some(s.completion_sound.as_str());
    os::notify(handle, title, body, sound)
}

/// Contador no ícone do Dock/barra de tarefas (conversas que terminaram ou pedem atenção fora da tela).
#[tauri::command]
fn badge_set(handle: AppHandle, count: i64) -> R<()> {
    if let Some(w) = handle.get_webview_window("main") {
        // macOS e Linux: número no ícone. Windows: sem número (o Tauri usa ícone de sobreposição); ver docs/windows.md.
        let _ = w.set_badge_count(if count > 0 { Some(count) } else { None });
    }
    Ok(())
}

#[derive(Serialize)]
struct Diagnostics {
    checks: Vec<kabul_core::diagnostics::Check>,
    report: String,
    redacted: String,
}

#[tauri::command]
async fn diagnostics() -> Diagnostics {
    let checks = kabul_core::diagnostics::run();
    let report = kabul_core::diagnostics::report(&checks);
    let redacted = kabul_core::diagnostics::redact(&report, &kabul_core::paths::home().display().to_string(), &kabul_core::machine::user_name(), &kabul_core::machine::computer_name());
    Diagnostics { checks, report, redacted }
}

/// Abre as ferramentas de depuração da janela (Ajuda › ⌘⌥I).
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// Sai do app (depois de o frontend confirmar, se havia agentes rodando). Para os agentes antes.
#[tauri::command]
fn app_quit(handle: AppHandle, app: State<App>) {
    for (_, c) in app.chats.lock().unwrap().drain() {
        let _ = c.lock().unwrap().kill();
    }
    handle.exit(0);
}

#[tauri::command]
async fn machine_info() -> kabul_core::machine::MachineInfo {
    kabul_core::machine::info()
}

/// Toca o som de conclusão ("Testar" nas configurações).
#[tauri::command]
fn sound_play(name: String) -> R<()> {
    os::play_sound(&name)
}

#[tauri::command]
fn open_external(target: String) -> R<()> {
    // Links vêm de texto de fora (agente, Linear, PR): só web e e-mail ([`kabul_core::open`]).
    if !kabul_core::open::external_url_ok(&target) {
        return Err(format!("{}: {}", tr("link não aberto (só http, https e mailto)", "link not opened (only http, https and mailto)"), target.chars().take(80).collect::<String>()));
    }
    os::open_external(target.trim())
}

#[tauri::command]
async fn transcribe(audio: Vec<u8>, ext: String) -> R<String> {
    speech::transcribe(&audio, &ext, if i18n::is_en() { "en" } else { "pt" }).map_err(e)
}

#[tauri::command]
async fn pick_folder(handle: AppHandle) -> R<Option<String>> {
    os::pick(&handle, true)
}

#[tauri::command]
async fn pick_file(handle: AppHandle) -> R<Option<String>> {
    os::pick(&handle, false)
}

fn shellexpand(p: &str) -> String {
    kabul_core::paths::expand_tilde(p)
}

fn main() {
    // Aberto pelo Dock o app herda um ambiente mínimo: carrega o do shell de login (PATH, LANG...). No
    // Windows, o PATH do usuário e do sistema direto do registro (CLIs instalados depois do login).
    let home = kabul_core::paths::home();
    let mut extra = vec![home.join(".local").join("bin"), home.join(".cargo").join("bin")];
    extra.extend(harness::extra_bin_dirs());
    kabul_core::shell_env::apply(&extra.iter().map(|p| p.display().to_string()).collect::<Vec<_>>());
    if let Some(t) = kabul_core::github::get_token() {
        std::env::set_var("GH_TOKEN", t);
    }
    // KABUL_HOME isola estado e worktrees (testes); padrão: Application Support + ~/kabul/workspaces.
    let (file, root) = match std::env::var_os("KABUL_HOME").map(PathBuf::from) {
        Some(h) => (h.join("state.json"), h.join("workspaces")),
        None => Store::default_paths(),
    };
    let home = file.parent().unwrap().to_path_buf();
    // Idioma dos textos nativos (menu, barra, notificações) até o frontend confirmar o dele.
    i18n::init(&home);
    AppSettings::load(&home.join("app-settings.json")).apply_bin_overrides();
    let prefix = AppSettings::load(&home.join("app-settings.json")).branch_prefix();
    let store = Store::open(file, root, prefix).expect("abrindo o estado do Kabul");
    let builder = tauri::Builder::default();
    // Seletor de arquivos pelo plugin fora do macOS (lá continua o osascript).
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_dialog::init());
    builder
        .manage(App {
            home,
            store: Mutex::new(store),
            chats: Default::default(),
            logins: Default::default(),
            terms: Default::default(),
            gh_login: Default::default(),
            account_logins: Default::default(),
            seq: Default::default(),
            kept: Default::default(),
            chat_meta: Default::default(),
        })
        .manage(remote::Remote::default())
        .manage(tray::TrayState::default())
        .manage(updates::Pending::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            remote::autostart(app.handle());
            tray::apply(app.handle());
            tray::start_loop(app.handle());
            updates::autocheck(app.handle());
            // Links kabul:// (abrir workspace/conversa, criar workspace): repassados ao frontend.
            use tauri_plugin_deep_link::DeepLinkExt;
            let h = app.handle().clone();
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let first: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
                let h2 = h.clone();
                // O frontend ainda está carregando: entrega depois que a janela abrir.
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    for u in first {
                        let _ = h2.emit("deep-link", u);
                    }
                });
            }
            app.deep_link().on_open_url(move |ev| {
                for u in ev.urls() {
                    let _ = h.emit("deep-link", u.to_string());
                }
                if let Some(w) = h.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            repos_list,
            repo_add,
            repo_clone,
            repo_remove,
            repo_settings,
            repo_settings_save,
            workspaces_list,
            workspace_create,
            workspace_update,
            workspace_rename_branch,
            workspace_archive,
            workspace_unarchive,
            resources_get,
            external_sessions,
            workspace_diff,
            workspace_changes,
            workspace_file_diff,
            workspace_files,
            workspace_read_file,
            workspace_busy,
            workspaces_stats,
            workspace_pr,
            workspace_auto_branch,
            comments_list,
            comment_add,
            comment_update,
            checkpoints_list,
            checkpoint_create,
            checkpoint_restore,
            attach_file,
            attach_bytes,
            script_run,
            script_stop,
            term_open,
            term_input,
            term_resize,
            term_close,
            term_capture,
            models_list,
            local_overview,
            local_endpoint_save,
            local_endpoint_remove,
            local_pull,
            local_start,
            harness_install,
            registry_get,
            registry_save,
            registry_reset,
            chat_start,
            chat_send,
            chat_approve,
            chat_stop,
            chat_interrupt,
            chat_processes,
            processes_keep,
            processes_kept,
            process_kill,
            docker_stop,
            history_list,
            history_load,
            history_save,
            history_delete,
            history_search,
            slash_commands,
            sessions_list,
            open_targets,
            open_in,
            pr_checks,
            chat_set_mode,
            mcp_list,
            mcp_add,
            mcp_shared,
            mcp_weigh,
            mcp_set_shared,
            mcp_export_agy,
            repo_branches,
            repo_prs,
            workspace_create_ex,
            cloud_start,
            cloud_poll,
            term_run,
            teleport,
            mirror_status,
            mirror_start,
            mirror_stop,
            workspace_fork,
            accounts_list,
            account_add,
            account_update,
            account_login,
            account_code,
            account_cancel,
            github_status,
            github_login,
            github_cancel,
            github_switch,
            github_token,
            github_token_set,
            github_repo_access,
            linear_status,
            linear_connect,
            linear_disconnect,
            linear_issues,
            workspace_from_issue,
            auth_status,
            auth_login,
            auth_code,
            auth_cancel,
            app_settings_get,
            app_settings_save,
            notify,
            badge_set,
            open_external,
            transcribe,
            pick_folder,
            pick_file,
            sound_play,
            machine_info,
            diagnostics,
            open_devtools,
            app_quit,
            gitcmds::git_status,
            gitcmds::git_pull,
            gitcmds::git_push,
            gitcmds::workspace_discard,
            gitcmds::workspace_grep,
            gitcmds::pr_view,
            gitcmds::pr_merge,
            gitcmds::pr_ready,
            gitcmds::pr_edit,
            gitcmds::checks_rerun,
            gitcmds::check_log,
            gitcmds::sections_list,
            gitcmds::section_save,
            gitcmds::section_delete,
            gitcmds::repo_update,
            gitcmds::repo_env_layers,
            gitcmds::gh_repos,
            gitcmds::repo_clone_to,
            gitcmds::repo_quick_start,
            gitcmds::git_identity,
            gitcmds::git_identity_set,
            gitcmds::repo_remotes,
            gitcmds::pr_open_url,
            remote::kabuld_status,
            remote::kabuld_start,
            remote::kabuld_stop,
            remote::kabuld_call,
            tray::usage_overview,
            tray::usage_refresh,
            tray::usage_csv,
            tray::usage_csv_save,
            tray::agents_running,
            tray::tray_action,
            tray::tray_hide,
            updates::app_version,
            updates::update_check,
            updates::update_install,
            i18n::set_ui_lang
        ])
        .menu(menu::build)
        .on_menu_event(|app, ev| menu::on_event(app, ev.id().as_ref()))
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Kabul");
}
