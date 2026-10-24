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
        "git_pull" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::pull(&w, dry(a))?) }
        "git_push" => { let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?; json!(gitops::push(&w, dry(a))?) }
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
        "models_list" => json!(models::claude_models()),
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
            match call(&mut st, &home, cmd, &args) {
                Ok(v) => ("200 OK", json!({"ok": true, "value": v}).to_string()),
                Err(e) => ("200 OK", json!({"ok": false, "error": format!("{e:#}")}).to_string()),
            }
        };
        let _ = write!(c, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
    }
    Ok(())
}
