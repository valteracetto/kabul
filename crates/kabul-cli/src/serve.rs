//! `kabul serve`: RPC HTTP mínimo (POST /rpc {command, args}) sobre o kabul-core, usado pelo E2E
//! contra o backend real e embrião do kabuld. Sem eventos push (o E2E usa só request/response).
use anyhow::Result;
use kabul_core::store::Store;
use kabul_core::{checkpoint, gitops, history, models, settings, store};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};

fn s(a: &Value, k: &str) -> Result<String> {
    a.get(k).and_then(Value::as_str).map(String::from).ok_or_else(|| anyhow::anyhow!("argumento {k} ausente"))
}

fn dry(a: &Value) -> bool {
    a.get("dryRun").and_then(Value::as_bool).unwrap_or(false)
}

/// Conversas rodando no servidor e os eventos ainda não lidos (o HTTP não tem push: o cliente faz polling).
#[derive(Default)]
pub struct Chats {
    seq: u64,
    running: std::collections::HashMap<String, std::sync::Arc<std::sync::Mutex<kabul_core::harness::Running>>>,
    stopped: std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    queue: std::sync::Arc<std::sync::Mutex<Vec<Value>>>,
}

fn chat_call(chats: &mut Chats, st: &mut Store, home: &Path, cmd: &str, a: &Value) -> Result<Option<Value>> {
    let get = |chats: &Chats, a: &Value| -> Result<std::sync::Arc<std::sync::Mutex<kabul_core::harness::Running>>> { chats.running.get(&s(a, "chatId")?).cloned().ok_or_else(|| anyhow::anyhow!("chat não encontrado (encerrado?)")) };
    Ok(Some(match cmd {
        "chat_start" => {
            let w = st.workspace(&s(a, "workspaceId")?)?.clone();
            let r = st.repo(&w.repo_id)?.clone();
            let req: kabul_core::chat::ChatRequest = serde_json::from_value(a.clone())?;
            let model = req.model.clone().ok_or_else(|| anyhow::anyhow!("argumento model ausente"))?;
            let endpoints = kabul_core::local::load_endpoints(&home.join("endpoints.json"));
            let registry = kabul_core::registry::Registry::load(&home.join("harness-registry.json"));
            // Mesmo caminho do app (core): harness, ambiente, conta e opções.
            let (p, mut running) = kabul_core::chat::start(home, &w, &r, &model, &req, &endpoints, &registry)?;
            chats.seq += 1;
            let id = format!("chat-{}", chats.seq);
            let (_tx, dummy) = std::sync::mpsc::channel();
            let rx = std::mem::replace(&mut running.events, dummy);
            let running = std::sync::Arc::new(std::sync::Mutex::new(running));
            chats.running.insert(id.clone(), running.clone());
            let (queue, stopped, cid, header) = (chats.queue.clone(), chats.stopped.clone(), id.clone(), kabul_core::chat::log_header(&p));
            let log = home.join("logs/agents.log");
            std::thread::spawn(move || {
                let q = queue.clone();
                let c2 = cid.clone();
                kabul_core::chat::pump(rx, move |ev| q.lock().unwrap().push(json!({"channel": "chat-event", "payload": {"chat_id": c2, "event": ev}})), || stopped.lock().unwrap().contains(&cid), move || running.lock().unwrap().wait(), Some((log, header)));
            });
            json!({"chat_id": id, "harness": p.kind, "approvals": p.opts.approvals_via_app, "note": p.note})
        }
        "chat_send" => { get(chats, a)?.lock().unwrap().send(&s(a, "text")?)?; Value::Null }
        "chat_approve" => {
            get(chats, a)?.lock().unwrap().approve_ext(&s(a, "requestId")?, a["allow"].as_bool().unwrap_or(false), a.get("tool").and_then(Value::as_str).unwrap_or(""), a.get("updatedInput").cloned(), a.get("always").and_then(Value::as_bool).unwrap_or(false))?;
            Value::Null
        }
        "chat_stop" => {
            let id = s(a, "chatId")?;
            chats.stopped.lock().unwrap().insert(id.clone());
            if let Some(c) = chats.running.remove(&id) { let _ = c.lock().unwrap().kill(); }
            Value::Null
        }
        // Eventos pendentes: [{channel, payload}].
        "events_poll" => { let _ = st; json!(std::mem::take(&mut *chats.queue.lock().unwrap())) }
        _ => return Ok(None),
    }))
}

fn call(st: &mut Store, home: &Path, cmd: &str, a: &Value) -> Result<Value> {
    let ws_repo = |st: &Store, id: &str| -> Result<(store::Workspace, store::Repo)> {
        let w = st.workspace(id)?.clone();
        let r = st.repo(&w.repo_id)?.clone();
        Ok((w, r))
    };
    Ok(match cmd {
        "repos_list" => json!(st.state.repos),
        "repo_add" => json!(st.add_repo(&PathBuf::from(s(a, "path")?))?),
        "workspaces_list" => json!(st.state.workspaces),
        "workspace_create" => json!(st.create_workspace(&s(a, "repoId")?)?),
        "workspace_create_ex" => {
            let repo = s(a, "repoId")?;
            match (a.get("branch").and_then(Value::as_str), a.get("base").and_then(Value::as_str)) {
                (Some(b), _) => json!(st.create_workspace_on_branch(&repo, b)?),
                (None, Some(base)) => json!(st.create_workspace_from(&repo, Some(&format!("origin/{base}")))?),
                _ => json!(st.create_workspace(&repo)?),
            }
        }
        "repo_branches" => { let r = st.repo(&s(a, "repoId")?)?.clone(); json!(store::branches(Path::new(&r.path)).unwrap_or_default()) }
        "linear_status" => json!({"connected": false, "who": null, "error": null}),
        "workspace_archive" => json!(st.archive_workspace(&s(a, "id")?).map(|_| ())?),
        "workspace_unarchive" => json!(st.unarchive_workspace(&s(a, "id")?)?),
        "workspace_changes" => { let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::changes(&r, &w, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)))?) }
        "workspace_file_diff" => { let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::file_diff(&r, &w, &s(a, "path")?, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)), a.get("ignoreWs").and_then(Value::as_bool).unwrap_or(false))?) }
        "workspace_read_file" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(store::read_file(&w, &s(a, "path")?)?) }
        "git_status" => { let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::status(&r, &w)?) }
        "git_pull" => { let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::pull(&w, &gitops::remote(&r), dry(a))?) }
        "git_push" => { let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::push(&w, &gitops::remote(&r), settings::AppSettings::load(&home.join("app-settings.json")).push_set_upstream, dry(a))?) }
        "git_identity" => { let r = st.repo(&s(a, "repoId")?)?.clone(); json!(gitops::identity(Path::new(&r.path))) }
        "git_identity_set" => { let r = st.repo(&s(a, "repoId")?)?.clone(); gitops::set_identity(Path::new(&r.path), &s(a, "name")?, &s(a, "email")?)?; json!(gitops::identity(Path::new(&r.path))) }
        "repo_remotes" => { let r = st.repo(&s(a, "repoId")?)?.clone(); json!(gitops::remotes(Path::new(&r.path))) }
        "repo_settings_save" => { let r = st.repo(&s(a, "repoId")?)?.clone(); json!(settings::save_local(Path::new(&r.path), &serde_json::from_value(a["settings"].clone())?)?.display().to_string()) }
        "workspace_discard" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; gitops::discard(&w, &s(a, "path")?)?; Value::Null }
        "workspace_grep" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::grep(&w, &s(a, "query")?, 500)?) }
        "pr_view" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::pr_view(&w).unwrap_or(None)) }
        // O E2E nunca fala com o GitHub: merge/ready/edit/re-run são sempre simulados aqui.
        "pr_merge" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::pr_merge(&w, "squash", false, true)?) }
        "pr_ready" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::pr_ready(&w, true)?) }
        "workspace_update" => {
            let id = s(a, "id")?;
            let p = &a["patch"];
            json!(st.update_workspace(&id, |w| {
                if let Some(v) = p.get("title").and_then(Value::as_str) { w.title = Some(v.to_string()).filter(|t| !t.trim().is_empty()); }
                if let Some(v) = p.get("status").and_then(Value::as_str) { w.status = v.into(); }
                if let Some(v) = p.get("pinned").and_then(Value::as_bool) { w.pinned = v; }
                if let Some(v) = p.get("unread").and_then(Value::as_bool) { w.unread = v; }
                if let Some(v) = p.get("section").and_then(Value::as_str) { w.section = Some(v.to_string()).filter(|s| !s.is_empty()); }
                if let Some(v) = p.get("target_branch").and_then(Value::as_str) { w.target_branch = Some(v.to_string()).filter(|s| !s.is_empty()); }
            })?)
        }
        "gh_repos" => json!(kabul_core::clone::list_repos(&[], 100)?),
        "repo_clone_to" => {
            let dir = s(a, "dir")?;
            let dest = kabul_core::clone::clone(&s(a, "input")?, &kabul_core::clone::expand_home(&dir), &[], |_, _| {})?;
            json!(st.add_repo(&dest)?)
        }
        "repo_quick_start" => { let dest = kabul_core::clone::quick_start(&kabul_core::clone::expand_home(&s(a, "dir")?), &s(a, "name")?)?; json!(st.add_repo(&dest)?) }
        // Seletor de pasta "nativo" do E2E: a pasta vem do ambiente do servidor.
        "pick_folder" => json!(std::env::var("KABUL_PICK_FOLDER").ok()),
        "diagnostics" => {
            let checks = kabul_core::diagnostics::run();
            let report = kabul_core::diagnostics::report(&checks);
            let redacted = kabul_core::diagnostics::redact(&report, &std::env::var("HOME").unwrap_or_default(), &std::env::var("USER").unwrap_or_default(), &kabul_core::machine::computer_name());
            json!({"checks": checks, "report": report, "redacted": redacted})
        }
        "machine_info" => json!(kabul_core::machine::info()),
        "external_sessions" => json!(kabul_core::external::collect(home, 40)),
        "resources_get" => {
            let hints: Vec<_> = st.state.workspaces.iter().map(|w| kabul_core::resources::Hint { pid: None, path: Some(w.path.clone()), workspace_id: w.id.clone(), chat_id: None }).collect();
            json!(kabul_core::resources::snapshot(&hints))
        }
        "sections_list" => json!(st.state.sections),
        "section_save" => json!(st.save_section(serde_json::from_value(a["section"].clone())?)?),
        "section_delete" => { st.delete_section(&s(a, "id")?)?; Value::Null }
        "app_settings_save" => { let set: settings::AppSettings = serde_json::from_value(a["settings"].clone())?; set.save(&home.join("app-settings.json"))?; Value::Null }
        "workspace_files" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(store::files(&w)?) }
        "workspaces_stats" => json!({}),
        "checkpoints_list" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(checkpoint::list(Path::new(&w.path))?) }
        "comments_list" => json!(st.state.comments.iter().filter(|c| Some(c.workspace_id.as_str()) == a.get("workspaceId").and_then(Value::as_str)).collect::<Vec<_>>()),
        "history_list" => json!(history::list(home, &s(a, "workspaceId")?)),
        "history_load" => json!(history::load(home, &s(a, "workspaceId")?, &s(a, "id")?)?),
        "history_save" => { history::save(home, &serde_json::from_value(a["record"].clone())?)?; Value::Null }
        "slash_commands" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(history::slash_commands(Path::new(&w.path))) }
        "models_list" => json!(models::catalog_for(home)),
        "repo_settings" => { let r = st.repo(&s(a, "repoId")?)?.clone(); let (set, layers) = settings::load(Path::new(&r.path), &r.default_branch); json!({"settings": set, "layers": layers}) }
        "app_settings_get" => json!(settings::AppSettings::load(&home.join("app-settings.json"))),
        "open_targets" => json!([]),
        "github_status" => json!(kabul_core::github::status()),
        "github_token_set" => json!(kabul_core::github::get_token().is_some()),
        "github_repo_access" => { let r = st.repo(&s(a, "repoId")?)?.clone(); json!(kabul_core::github::repo_access(Path::new(&r.path))) }
        "mirror_status" => json!({"running": false, "tmux": "", "link": null}),
        "pr_checks" => json!({"checks": [], "message": "Sem PR aberto para esta branch."}),
        _ => anyhow::bail!("kabul serve: comando {cmd} não disponível"),
    })
}

pub fn serve(port: u16, home: PathBuf) -> Result<()> {
    let mut st = Store::open(home.join("state.json"), home.join("workspaces"), std::env::var("USER").unwrap_or_else(|_| "kabul".into()))?;
    let l = TcpListener::bind(("127.0.0.1", port))?;
    let mut chats = Chats::default();
    eprintln!("kabul serve em http://127.0.0.1:{port} (estado em {})", home.display());
    for conn in l.incoming() {
        let mut c = match conn { Ok(c) => c, Err(_) => continue };
        let mut r = BufReader::new(c.try_clone()?);
        let mut line = String::new();
        r.read_line(&mut line)?;
        let mut len = 0usize;
        loop {
            let mut h = String::new();
            r.read_line(&mut h)?;
            if h.trim().is_empty() { break; }
            if let Some(v) = h.to_lowercase().strip_prefix("content-length:") { len = v.trim().parse().unwrap_or(0); }
        }
        let mut body = vec![0; len];
        r.read_exact(&mut body)?;
        let (status, out) = if line.starts_with("OPTIONS") {
            ("204 No Content", String::new())
        } else {
            let req: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let cmd = req["command"].as_str().unwrap_or("");
            let args = req.get("args").cloned().unwrap_or(json!({}));
            // Recarrega o estado a cada chamada (o app pode ter mudado o arquivo).
            if let Ok(fresh) = Store::open(st.file.clone(), st.root.clone(), st.branch_prefix.clone()) { st = fresh; }
            let res = match chat_call(&mut chats, &mut st, &home, cmd, &args) {
                Ok(Some(v)) => Ok(v),
                Ok(None) => call(&mut st, &home, cmd, &args),
                Err(e) => Err(e),
            };
            match res {
                Ok(v) => ("200 OK", json!({"ok": true, "value": v}).to_string()),
                Err(e) => ("200 OK", json!({"ok": false, "error": format!("{e:#}")}).to_string()),
            }
        };
        let _ = write!(c, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
    }
    Ok(())
}
