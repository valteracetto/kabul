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
    gitops::status(&r, &w).map_err(e)
}

#[tauri::command]
pub async fn git_pull(app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::pull(&w, dry(&app, dry_run)).map_err(e)
}

#[tauri::command]
pub async fn git_push(app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    gitops::push(&w, dry(&app, dry_run)).map_err(e)
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
    let pr = gitops::pr_view(&w).map_err(e)?;
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
pub async fn pr_merge(app: State<'_, App>, workspace_id: String, dry_run: Option<bool>) -> R<Outcome> {
    let (w, _) = ws_repo(&app, &workspace_id)?;
    let set = app.app_settings();
    let out = gitops::pr_merge(&w, &set.merge_method, false, dry(&app, dry_run)).map_err(e)?;
    if !out.dry_run {
        let _ = app.store.lock().unwrap().update_workspace(&workspace_id, |x| x.status = "done".into());
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
