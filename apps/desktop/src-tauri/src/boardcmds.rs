//! Quadro: colunas configuráveis e sincronia com Linear/GitHub (sobre `kabul_core::board`).
//! A rede (rastreadores) roda fora do lock do estado; eventos do Kabul e o polling avisam a
//! interface por `board-moved` (e `workspace-state` para recarregar a lista).
use crate::{e, App, R};
use kabul_core::board::{self, AutoEvent, Board, Config, MoveResult, Previews, Snapshot, SyncResult};
use kabul_core::store::Workspace;
use kabul_core::tracker::Trackers;
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn board_get(app: State<App>) -> Config {
    board::config(&app.store.lock().unwrap().state)
}

#[tauri::command]
pub fn board_save(app: State<App>, repo_id: Option<String>, board: Option<Board>, reassign: Option<BTreeMap<String, String>>) -> R<Config> {
    let mut st = app.store.lock().unwrap();
    board::save(&mut st, repo_id.as_deref().filter(|r| !r.is_empty()), board, &reassign.unwrap_or_default()).map_err(e)
}

#[tauri::command]
pub async fn board_move(app: State<'_, App>, workspace_id: String, column: String, restore: Option<Snapshot>) -> R<MoveResult> {
    board::move_card(&app.store, &Trackers::real(), &workspace_id, &column, restore.as_ref()).map_err(e)
}

#[tauri::command]
pub async fn board_sync(app: State<'_, App>, workspace_id: String) -> R<SyncResult> {
    board::sync_card(&app.store, &Trackers::real(), &workspace_id).map_err(e)
}

#[tauri::command]
pub async fn board_preview(app: State<'_, App>, repo_id: Option<String>) -> R<Previews> {
    let b = {
        let st = app.store.lock().unwrap();
        match repo_id.as_deref().filter(|r| !r.is_empty()) {
            Some(r) => board::effective(&st.state, r),
            None => board::global(&st.state),
        }
    };
    Ok(board::previews(&Trackers::real(), &b))
}

#[tauri::command]
pub async fn workspace_link_issue(app: State<'_, App>, workspace_id: String, input: String) -> R<Workspace> {
    board::link_issue(&app.store, &Trackers::real(), &workspace_id, &input).map_err(e)
}

/// Evento do Kabul (agente começou, PR aberto, merge): move o card para a frente e sincroniza em
/// segundo plano; a interface recebe `board-moved` com o resultado.
pub fn event(h: &AppHandle, workspace_id: &str, ev: AutoEvent) {
    let (h, id) = (h.clone(), workspace_id.to_string());
    std::thread::spawn(move || {
        if let Some(m) = board::on_event(&h.state::<App>().store, &Trackers::real(), &id, ev) {
            let _ = h.emit("board-moved", serde_json::json!({ "source": "event", "event": ev, "result": m }));
            let _ = h.emit("workspace-state", serde_json::json!({ "id": "", "state": "changed" }));
        }
    });
}

/// Sincronia inversa: a cada 90 s lê as issues dos quadros com a opção ligada (o Linear numa
/// requisição só; só mexe no card se o `updatedAt` mudou).
pub fn start_poller(h: &AppHandle) {
    let h = h.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(90));
        let moved = board::poll_once(&h.state::<App>().store, &Trackers::real());
        if !moved.is_empty() {
            let _ = h.emit("board-moved", serde_json::json!({ "source": "poll", "moved": moved }));
            let _ = h.emit("workspace-state", serde_json::json!({ "id": "", "state": "changed" }));
        }
    });
}
