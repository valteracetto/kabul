//! Comandos de git/GitHub, seções da barra lateral e ajustes de repo (sobre `kabul_core::gitops`).
use crate::{e, ws_repo, App, R};
use kabul_core::gitops::{self, GitStatus, GrepHit, Outcome, PrInfo};
use kabul_core::settings;
use kabul_core::store::{Repo, Section};
use std::collections::BTreeMap;
use std::path::Path;
use tauri::State;

/// Dry-run se pedido ou se "Simular ações do GitHub" estiver ligado.
fn dry(app: &App, asked: Option<bool>) -> bool {
    asked.unwrap_or(false) || app.app_settings().github_dry_run
}

#[tauri::command]
pub async fn git_status(app: State<'_, App>, workspace_id: String) -> R<GitStatus> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    gitops::status_cached(&r, &w).map_err(e)
}

#[tauri::command]
pub async fn git_pull(app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    gitops::pull(&w, &gitops::remote(&r), dry(&app, dry_run)).map_err(e)
}

#[tauri::command]
pub async fn git_push(app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    gitops::push(&w, &gitops::remote(&r), app.app_settings().push_set_upstream, dry(&app, dry_run)).map_err(e)
}

#[tauri::command]
pub async fn workspace_discard(app: State<'_, App>, workspace_id: String, path: String) -> R<()> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::discard(&w, &path).map_err(e)
}

#[tauri::command]
pub async fn workspace_grep(app: State<'_, App>, workspace_id: String, query: String) -> R<Vec<GrepHit>> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::grep(&w, &query, 500).map_err(e)
}

#[tauri::command]
pub async fn pr_view(app: State<'_, App>, workspace_id: String) -> R<Option<PrInfo>> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    let pr = gitops::pr_view_cached(&w).map_err(e)?;
    // Guarda o link e acompanha o estado do PR no status do workspace.
    if let Some(p) = &pr {
        let status = match p.state.as_str() {
            "MERGED" => Some("done"),
            "OPEN" if !p.is_draft => Some("in-review"),
            _ => None,
        };
        let _ = app.store.lock().unwrap().update_workspace(&workspace_id, |x| {
            x.pr_url = Some(p.url.clone());
            if let Some(s) = status {
                if x.status != "canceled" {
                    x.status = s.into();
                }
            }
        });
    }
    Ok(pr)
}

#[tauri::command]
pub async fn pr_merge(handle: tauri::AppHandle, app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, r) = ws_repo(&app, &workspace_id)?;
    let set = app.app_settings();
    let out = gitops::pr_merge(&w, &set.merge_method, false, dry(&app, dry_run)).map_err(e)?;
    if !out.dry_run {
        // "Archive on merge" e "Delete branch on archive": a opção do repo vence a do usuário.
        let (rs, _) = settings::load(Path::new(&r.path), &r.default_branch);
        let archive = rs.archive_on_merge.unwrap_or(set.archive_on_merge);
        let delete = rs.delete_branch_on_archive.unwrap_or(set.delete_branch_on_archive);
        // Arquivar depois do merge: o mesmo caminho em segundo plano do botão Arquivar.
        let plan = {
            let mut st = app.store.lock().unwrap();
            let w = st.update_workspace(&workspace_id, |x| x.status = "done".into()).map_err(e)?;
            if archive && !w.archived {
                Some(st.begin_archive(&workspace_id, delete).map_err(e)?)
            } else {
                None
            }
        };
        if let Some(p) = plan {
            crate::start_archive(&handle, p, kabul_core::archive::Options::app());
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn pr_ready(app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::pr_ready(&w, dry(&app, dry_run)).map_err(e)
}

#[tauri::command]
pub async fn pr_edit(app: State<'_, App>, workspace_id: String, title: String, body: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::pr_edit(&w, &title, &body, dry(&app, dry_run)).map_err(e)
}

#[tauri::command]
pub async fn checks_rerun(app: State<'_, App>, workspace_id: String, links: Vec<String>, dry_run: Option<bool>) -> R<Outcome> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::checks_rerun(&w, &links, dry(&app, dry_run)).map_err(e)
}

#[tauri::command]
pub async fn check_log(app: State<'_, App>, workspace_id: String, link: String) -> R<String> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::check_log(&w, &link, 400).map_err(e)
}

#[tauri::command]
pub fn sections_list(app: State<App>) -> Vec<Section> {
    let mut v = app.store.lock().unwrap().state.sections.clone();
    v.sort_by_key(|s| s.order);
    v
}

#[tauri::command]
pub fn section_save(app: State<App>, section: Section) -> R<Section> {
    app.store.lock().unwrap().save_section(section).map_err(e)
}

#[tauri::command]
pub fn section_delete(app: State<App>, id: String) -> R<()> {
    app.store.lock().unwrap().delete_section(&id).map_err(e)
}

#[tauri::command]
pub fn repo_update(app: State<App>, id: String, hidden: Option<bool>, icon: Option<String>) -> R<Repo> {
    app.store
        .lock()
        .unwrap()
        .update_repo(&id, |r| {
            if let Some(h) = hidden {
                r.hidden = h;
            }
            if let Some(i) = icon {
                r.icon = Some(i).filter(|i| !i.trim().is_empty());
            }
        })
        .map_err(e)
}

/// Variáveis do repo por camada ("repo" compartilhada, "repo local"), para a tela de Environment.
#[tauri::command]
pub fn repo_env_layers(app: State<App>, repo_id: String) -> R<Vec<(String, BTreeMap<String, String>)>> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    Ok(settings::load_layers(Path::new(&r.path), &r.default_branch).into_iter().map(|(n, s)| (n, s.env)).collect())
}

// ---------------- adicionar projeto: GitHub e início rápido ----------------

fn gh_env(app: &App) -> Vec<(String, String)> {
    let accs = kabul_core::accounts::Accounts::open(&app.home);
    kabul_core::accounts::env_for(&accs.default_for("gh"))
}

#[tauri::command]
pub async fn gh_repos(app: State<'_, App>) -> R<Vec<kabul_core::clone::GhRepo>> {
    kabul_core::clone::list_repos(&gh_env(&app), 100).map_err(e)
}

/// Clona (`owner/repo` ou URL) em `dir`, emitindo `clone-progress` {phase, pct}; adiciona o repo e lembra a pasta.
#[tauri::command]
pub async fn repo_clone_to(handle: tauri::AppHandle, app: State<'_, App>, input: String, dir: String) -> R<Repo> {
    use tauri::Emitter;
    let env = gh_env(&app);
    let base = kabul_core::clone::expand_home(&dir);
    let dest = kabul_core::clone::clone(&input, &base, &env, |phase, pct| {
        let _ = handle.emit("clone-progress", serde_json::json!({ "phase": phase, "pct": pct }));
    })
    .map_err(e)?;
    let mut set = app.app_settings();
    set.clone_dir = dir;
    let _ = set.save(&app.file("app-settings.json"));
    app.store.lock().unwrap().add_repo(&dest).map_err(e)
}

#[tauri::command]
pub async fn repo_quick_start(app: State<'_, App>, name: String, dir: String) -> R<Repo> {
    let dest = kabul_core::clone::quick_start(&kabul_core::clone::expand_home(&dir), &name).map_err(e)?;
    let mut set = app.app_settings();
    set.clone_dir = dir;
    let _ = set.save(&app.file("app-settings.json"));
    app.store.lock().unwrap().add_repo(&dest).map_err(e)
}

// ---------------- Configurações › Git ----------------

#[tauri::command]
pub fn git_identity(app: State<App>, repo_id: String) -> R<gitops::Identity> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    Ok(gitops::identity(Path::new(&r.path)))
}

#[tauri::command]
pub fn git_identity_set(app: State<App>, repo_id: String, name: String, email: String) -> R<gitops::Identity> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    gitops::set_identity(Path::new(&r.path), &name, &email).map_err(e)?;
    Ok(gitops::identity(Path::new(&r.path)))
}

#[tauri::command]
pub fn repo_remotes(app: State<App>, repo_id: String) -> R<Vec<String>> {
    let r = app.store.lock().unwrap().repo(&repo_id).map_err(e)?.clone();
    Ok(gitops::remotes(Path::new(&r.path)))
}

/// URL para "Abrir PR" (⌘⇧G) conforme "Abrir PRs em" (GitHub, Linear ou Graphite).
#[tauri::command]
pub fn pr_open_url(app: State<App>, workspace_id: String, pr_url: String) -> R<String> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    Ok(gitops::pr_open_url(&app.app_settings().open_prs_in, &pr_url, w.linear.as_ref().map(|l| l.url.as_str())))
}
