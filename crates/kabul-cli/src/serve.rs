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
    kept: kabul_core::procs::Kept,
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
            let meta = kabul_core::usage::Meta::for_chat(home, p.kind, &model, req.account.as_deref(), &w.id);
            let rx = kabul_core::usage::tap(rx, kabul_core::usage::Recorder::new(home, meta), |_| {});
            let running = std::sync::Arc::new(std::sync::Mutex::new(running));
            chats.running.insert(id.clone(), running.clone());
            let (queue, stopped, cid, header) = (chats.queue.clone(), chats.stopped.clone(), id.clone(), kabul_core::chat::log_header(&p));
            let log = home.join("logs/agents.log");
            std::thread::spawn(move || {
                let q = queue.clone();
                let c2 = cid.clone();
                kabul_core::chat::pump(
                    rx,
                    move |ev| q.lock().unwrap().push(json!({"channel": "chat-event", "payload": {"chat_id": c2, "event": ev}})),
                    || stopped.lock().unwrap().contains(&cid),
                    move || running.lock().unwrap().wait(),
                    Some((log, header)),
                );
            });
            json!({"chat_id": id, "harness": p.kind, "approvals": p.opts.approvals_via_app, "note": p.note})
        }
        "chat_send" => {
            get(chats, a)?.lock().unwrap().send(&s(a, "text")?)?;
            Value::Null
        }
        "chat_approve" => {
            get(chats, a)?.lock().unwrap().approve_ext(
                &s(a, "requestId")?,
                a["allow"].as_bool().unwrap_or(false),
                a.get("tool").and_then(Value::as_str).unwrap_or(""),
                a.get("updatedInput").cloned(),
                a.get("always").and_then(Value::as_bool).unwrap_or(false),
            )?;
            Value::Null
        }
        "chat_stop" => {
            let id = s(a, "chatId")?;
            chats.stopped.lock().unwrap().insert(id.clone());
            if let Some(c) = chats.running.remove(&id) {
                let _ = c.lock().unwrap().kill();
            }
            Value::Null
        }
        // Parar só o turno (protocolo do agente) e listar o que ficou rodando; nada é encerrado sozinho.
        "chat_interrupt" => {
            let id = s(a, "chatId")?;
            let Some(r) = chats.running.get(&id).cloned() else { return Ok(Some(json!(kabul_core::procs::StopReport::default()))) };
            let rep = kabul_core::procs::stop_turn(&r, std::time::Duration::from_millis(1500));
            if !rep.alive {
                chats.stopped.lock().unwrap().insert(id.clone());
                chats.running.remove(&id);
            }
            json!(rep)
        }
        "chat_processes" => {
            let ids: Vec<String> = serde_json::from_value(a["chatIds"].clone()).unwrap_or_default();
            json!(ids.iter().filter_map(|id| chats.running.get(id)).flat_map(|r| kabul_core::procs::session_leftovers(r)).collect::<Vec<_>>())
        }
        "processes_keep" => {
            chats.kept.keep(serde_json::from_value(a["items"].clone()).unwrap_or_default(), a.get("workspaceId").and_then(Value::as_str).map(String::from));
            Value::Null
        }
        "processes_kept" => json!(chats.kept.alive()),
        "process_kill" => {
            let keys: Vec<kabul_core::procs::Key> = serde_json::from_value(a["keys"].clone()).unwrap_or_default();
            chats.kept.forget(&keys);
            json!(kabul_core::procs::terminate(&keys, std::time::Duration::from_secs(2)))
        }
        "docker_stop" => {
            kabul_core::procs::docker_stop(&s(a, "id")?)?;
            Value::Null
        }
        // Eventos pendentes: [{channel, payload}].
        "events_poll" => {
            let _ = st;
            json!(std::mem::take(&mut *chats.queue.lock().unwrap()))
        }
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
        "usage_overview" => {
            let cfg = kabul_core::usage::AlertConfig::from_settings(&settings::AppSettings::load(&home.join("app-settings.json")));
            let wss = st.state.workspaces.clone();
            json!(kabul_core::usage::overview(home, a.get("days").and_then(Value::as_u64).unwrap_or(30) as u32, &cfg, &|id| wss.iter().find(|w| w.id == id).map(|w| w.title.clone().unwrap_or_else(|| w.name.clone()))))
        }
        "usage_csv" => {
            let since = store::now().saturating_sub(a.get("days").and_then(Value::as_u64).unwrap_or(30) * 86_400);
            json!(kabul_core::usage::csv(&kabul_core::usage::Ledger::open(home).since(since), kabul_core::usage::local_offset()))
        }
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
        "repo_branches" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            json!(store::branches(Path::new(&r.path)).unwrap_or_default())
        }
        "linear_status" => json!({"connected": false, "who": null, "error": null}),
        "workspace_archive" => json!(st.archive_workspace(&s(a, "id")?).map(|_| ())?),
        "workspace_unarchive" => json!(st.unarchive_workspace(&s(a, "id")?)?),
        "workspace_changes" => {
            let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::changes(&r, &w, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)))?)
        }
        "workspace_file_diff" => {
            let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::file_diff(&r, &w, &s(a, "path")?, gitops::Scope::parse(a.get("scope").and_then(Value::as_str)), a.get("ignoreWs").and_then(Value::as_bool).unwrap_or(false))?)
        }
        "workspace_read_file" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(store::read_file(&w, &s(a, "path")?)?)
        }
        "git_status" => {
            let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::status(&r, &w)?)
        }
        "git_pull" => {
            let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::pull(&w, &gitops::remote(&r), dry(a))?)
        }
        "git_push" => {
            let (w, r) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::push(&w, &gitops::remote(&r), settings::AppSettings::load(&home.join("app-settings.json")).push_set_upstream, dry(a))?)
        }
        "git_identity" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            json!(gitops::identity(Path::new(&r.path)))
        }
        "git_identity_set" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            gitops::set_identity(Path::new(&r.path), &s(a, "name")?, &s(a, "email")?)?;
            json!(gitops::identity(Path::new(&r.path)))
        }
        "repo_remotes" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            json!(gitops::remotes(Path::new(&r.path)))
        }
        "repo_settings_save" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            json!(settings::save_local(Path::new(&r.path), &serde_json::from_value(a["settings"].clone())?)?.display().to_string())
        }
        "workspace_discard" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            gitops::discard(&w, &s(a, "path")?)?;
            Value::Null
        }
        "workspace_grep" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::grep(&w, &s(a, "query")?, 500)?)
        }
        "pr_view" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::pr_view(&w).unwrap_or(None))
        }
        // O E2E nunca fala com o GitHub: merge/ready/edit/re-run são sempre simulados aqui.
        "pr_merge" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::pr_merge(&w, "squash", false, true)?)
        }
        "pr_ready" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(gitops::pr_ready(&w, true)?)
        }
        "workspace_update" => {
            let id = s(a, "id")?;
            let p = &a["patch"];
            json!(st.update_workspace(&id, |w| {
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
                if let Some(v) = p.get("target_branch").and_then(Value::as_str) {
                    w.target_branch = Some(v.to_string()).filter(|s| !s.is_empty());
                }
            })?)
        }
        "gh_repos" => json!(kabul_core::clone::list_repos(&[], 100)?),
        "repo_clone_to" => {
            let dir = s(a, "dir")?;
            let dest = kabul_core::clone::clone(&s(a, "input")?, &kabul_core::clone::expand_home(&dir), &[], |_, _| {})?;
            json!(st.add_repo(&dest)?)
        }
        "repo_quick_start" => {
            let dest = kabul_core::clone::quick_start(&kabul_core::clone::expand_home(&s(a, "dir")?), &s(a, "name")?)?;
            json!(st.add_repo(&dest)?)
        }
        // Seletor de pasta "nativo" do E2E: a pasta vem do ambiente do servidor.
        "pick_folder" => json!(std::env::var("KABUL_PICK_FOLDER").ok()),
        "diagnostics" => {
            let checks = kabul_core::diagnostics::run();
            let report = kabul_core::diagnostics::report(&checks);
            let redacted = kabul_core::diagnostics::redact(&report, &kabul_core::paths::home().display().to_string(), &kabul_core::machine::user_name(), &kabul_core::machine::computer_name());
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
        "section_delete" => {
            st.delete_section(&s(a, "id")?)?;
            Value::Null
        }
        "app_settings_save" => {
            let set: settings::AppSettings = serde_json::from_value(a["settings"].clone())?;
            set.save(&home.join("app-settings.json"))?;
            Value::Null
        }
        "workspace_files" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(store::files(&w)?)
        }
        "workspaces_stats" => json!({}),
        "checkpoints_list" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(checkpoint::list(Path::new(&w.path))?)
        }
        "comments_list" => json!(st.state.comments.iter().filter(|c| Some(c.workspace_id.as_str()) == a.get("workspaceId").and_then(Value::as_str)).collect::<Vec<_>>()),
        "history_list" => json!(history::list(home, &s(a, "workspaceId")?)),
        "history_load" => json!(history::load(home, &s(a, "workspaceId")?, &s(a, "id")?)?),
        "history_save" => {
            history::save(home, &serde_json::from_value(a["record"].clone())?)?;
            Value::Null
        }
        "slash_commands" => {
            let (w, _) = ws_repo(st, &s(a, "workspaceId")?)?;
            json!(history::slash_commands(Path::new(&w.path)))
        }
        "models_list" => json!(models::catalog_for(home)),
        "repo_settings" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            let (set, layers) = settings::load(Path::new(&r.path), &r.default_branch);
            json!({"settings": set, "layers": layers})
        }
        "app_settings_get" => json!(settings::AppSettings::load(&home.join("app-settings.json"))),
        "open_targets" => json!([]),
        "github_status" => json!(kabul_core::github::status()),
        "github_token_set" => json!(kabul_core::github::get_token().is_some()),
        "github_repo_access" => {
            let r = st.repo(&s(a, "repoId")?)?.clone();
            json!(kabul_core::github::repo_access(Path::new(&r.path)))
        }
        "mirror_status" => json!({"running": false, "tmux": "", "link": null}),
        "pr_checks" => json!({"checks": [], "message": "Sem PR aberto para esta branch."}),
        _ => anyhow::bail!("kabul serve: comando {cmd} não disponível"),
    })
}

/// Maior corpo aceito (o ditado manda áudio como JSON).
const MAX_BODY: usize = 32 << 20;

fn local_host(name: &str) -> bool {
    matches!(name, "127.0.0.1" | "localhost" | "[::1]")
}

/// `host[:porta]` → host (IPv6 fica com os colchetes).
fn host_part(h: &str) -> String {
    let h = h.trim().to_lowercase();
    if h.starts_with('[') {
        return h.split(']').next().map(|x| format!("{x}]")).unwrap_or_default();
    }
    h.split(':').next().unwrap_or("").to_string()
}

type Headers = std::collections::HashMap<String, String>;

/// Quem pode chamar o RPC. Ele roda comandos e agentes sem senha, então só o próprio computador:
/// `Host` local (barra DNS rebinding), `Origin` local ou ausente (barra qualquer site aberto no
/// navegador) e POST só com `content-type: application/json` (barra formulário e `text/plain`, que
/// o navegador manda entre origens sem preflight). Devolve a origem a ecoar no CORS.
pub fn check_request(method: &str, headers: &Headers) -> std::result::Result<Option<String>, &'static str> {
    match headers.get("host") {
        Some(h) if local_host(&host_part(h)) => {}
        _ => return Err("Host não local"),
    }
    let origin = match headers.get("origin").map(|o| o.trim().to_string()) {
        None => None,
        Some(o) => {
            let rest = o.strip_prefix("http://").or_else(|| o.strip_prefix("https://")).ok_or("origem não local")?;
            if !local_host(&host_part(rest.split('/').next().unwrap_or(""))) {
                return Err("origem não local");
            }
            Some(o)
        }
    };
    match method {
        "OPTIONS" => {}
        "POST" if headers.get("content-type").map(|c| c.to_lowercase().starts_with("application/json")).unwrap_or(false) => {}
        "POST" => return Err("content-type precisa ser application/json"),
        _ => return Err("método não aceito"),
    }
    Ok(origin)
}

/// Lê método, cabeçalhos (em minúsculas) e corpo.
fn read_request(c: &std::net::TcpStream) -> Result<(String, Headers, Vec<u8>)> {
    c.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
    let mut r = BufReader::new(c.try_clone()?);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let method = line.split_whitespace().next().unwrap_or("").to_string();
    let mut headers = Headers::new();
    for _ in 0..100 {
        let mut h = String::new();
        r.read_line(&mut h)?;
        if h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").map(|v| v.parse().unwrap_or(usize::MAX)).unwrap_or(0);
    anyhow::ensure!(len <= MAX_BODY, "corpo grande demais");
    let mut body = vec![0; len];
    r.read_exact(&mut body)?;
    Ok((method, headers, body))
}

pub fn serve(port: u16, home: PathBuf) -> Result<()> {
    let mut st = Store::open(home.join("state.json"), home.join("workspaces"), std::env::var("USER").unwrap_or_else(|_| "kabul".into()))?;
    let l = TcpListener::bind(("127.0.0.1", port))?;
    let mut chats = Chats::default();
    eprintln!("kabul serve em http://127.0.0.1:{port} (estado em {}; só este computador)", home.display());
    for conn in l.incoming() {
        let mut c = match conn {
            Ok(c) => c,
            Err(_) => continue,
        };
        // Conexão ruim (cabeçalho torto, corpo enorme) responde 400 e não derruba o servidor.
        let (method, headers, body) = match read_request(&c) {
            Ok(x) => x,
            Err(_) => {
                let _ = write!(c, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
        };
        let origin = match check_request(&method, &headers) {
            Ok(o) => o,
            Err(why) => {
                let _ = write!(c, "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{why}", why.len());
                continue;
            }
        };
        let (status, out) = if method == "OPTIONS" {
            ("204 No Content", String::new())
        } else {
            let req: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let cmd = req["command"].as_str().unwrap_or("");
            let args = req.get("args").cloned().unwrap_or(json!({}));
            // Recarrega o estado a cada chamada (o app pode ter mudado o arquivo).
            if let Ok(fresh) = Store::open(st.file.clone(), st.root.clone(), st.branch_prefix.clone()) {
                st = fresh;
            }
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
        // CORS só para a origem local que pediu (nunca `*`).
        let cors = origin.map(|o| format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\n")).unwrap_or_default();
        let _ = write!(c, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{cors}Content-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(pairs: &[(&str, &str)]) -> Headers {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// Segurança: site qualquer no navegador (CSRF), DNS rebinding e POST "simples" não chegam ao RPC.
    #[test]
    fn so_o_proprio_computador() {
        let json = ("content-type", "application/json");
        assert_eq!(check_request("POST", &h(&[("host", "127.0.0.1:7790"), json])), Ok(None), "cliente nativo");
        assert_eq!(check_request("POST", &h(&[("host", "127.0.0.1:7790"), ("origin", "http://localhost:5174"), json])), Ok(Some("http://localhost:5174".into())));
        assert!(check_request("OPTIONS", &h(&[("host", "localhost:7790"), ("origin", "http://127.0.0.1:5173")])).is_ok());
        assert!(check_request("POST", &h(&[("host", "127.0.0.1:7790"), ("origin", "https://evil.example"), json])).is_err());
        assert!(check_request("POST", &h(&[("host", "127.0.0.1:7790"), ("origin", "http://localhost.evil.example"), json])).is_err());
        assert!(check_request("POST", &h(&[("host", "127.0.0.1:7790"), ("origin", "null"), json])).is_err());
        assert!(check_request("POST", &h(&[("host", "evil.example:7790"), json])).is_err(), "DNS rebinding");
        assert!(check_request("POST", &h(&[json])).is_err(), "sem Host");
        assert!(check_request("POST", &h(&[("host", "127.0.0.1:7790"), ("content-type", "text/plain")])).is_err(), "POST simples sem preflight");
        assert!(check_request("GET", &h(&[("host", "127.0.0.1:7790")])).is_err());
    }

    /// Servidor de verdade: pedido de outra origem recebe 403 e nada é gravado.
    #[test]
    fn recusa_origem_de_fora_no_servidor() {
        let home = std::env::temp_dir().join(format!("kabul-serve-sec-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let h2 = home.clone();
        std::thread::spawn(move || serve(port, h2));
        std::thread::sleep(std::time::Duration::from_millis(300));
        let send = |extra: &str, body: &str| {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(s, "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra}Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out);
            out
        };
        let rec = r#"{"command":"history_save","args":{"record":{"id":"s1","workspace_id":"w1","title":"invadido","model_key":null,"agent_session":null,"updated_at":0,"items":[]}}}"#;
        let saved = || home.join("sessions/w1/s1.json").exists();
        assert!(send("Origin: https://evil.example\r\nContent-Type: application/json\r\n", rec).starts_with("HTTP/1.1 403"));
        assert!(send("Content-Type: text/plain\r\n", rec).starts_with("HTTP/1.1 403"));
        assert!(!saved(), "nada gravado");
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "POST /rpc HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 99999999999\r\n\r\n").unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        assert!(out.starts_with("HTTP/1.1 400"), "corpo enorme: {out}");
        let ok = send("Origin: http://localhost:5174\r\nContent-Type: application/json\r\n", rec);
        assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("Access-Control-Allow-Origin: http://localhost:5174") && !ok.contains("Allow-Origin: *"), "{ok}");
        assert!(saved(), "origem local continua funcionando");
        let _ = std::fs::remove_dir_all(&home);
    }
}
