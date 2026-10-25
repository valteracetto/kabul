//! Atualização automática (tauri-plugin-updater). O manifesto `latest.json` é assinado no CI
//! (`release.yml`) e publicado nos GitHub Releases:
//!
//! - `stable`: `releases/latest/download/latest.json` (última release publicada, sem pré-releases);
//! - `beta`: `releases/download/beta/latest.json` (release `beta`, regravada a cada versão, inclusive
//!   as estáveis, para quem está no beta não ficar para trás).
//!
//! Sem rede (ou com o GitHub fora do ar) a checagem só devolve um erro curto: nada quebra e a
//! próxima tentativa é na próxima abertura do app.
use kabul_core::settings::AppSettings;
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// `dono/repo` dos Releases. O CI passa `KABUL_UPDATE_REPO=${{ github.repository }}` no build.
const REPO: &str = match option_env!("KABUL_UPDATE_REPO") {
    Some(r) => r,
    None => "valteracetto/kabul",
};

pub fn endpoint(channel: &str) -> String {
    match channel {
        "beta" => format!("https://github.com/{REPO}/releases/download/beta/latest.json"),
        _ => format!("https://github.com/{REPO}/releases/latest/download/latest.json"),
    }
}

/// Atualização encontrada e ainda não instalada.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub current: String,
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub channel: String,
}

#[derive(Serialize)]
pub struct AppVersion {
    pub version: &'static str,
    pub protocol: u32,
    pub channel: String,
    /// `false` em builds de desenvolvimento (o updater só roda no app empacotado).
    pub updater: bool,
}

fn friendly(e: impl std::fmt::Display) -> String {
    let s = e.to_string();
    let l = s.to_lowercase();
    if ["dns", "connect", "timed out", "timeout", "network", "offline", "resolve"].iter().any(|k| l.contains(k)) {
        crate::i18n::tr("Sem conexão com o servidor de atualizações; tente mais tarde.", "Can't reach the update server; try again later.").into()
    } else {
        format!("{}: {s}", crate::i18n::tr("Não deu para procurar atualizações", "Couldn't check for updates"))
    }
}

async fn check(app: &AppHandle, channel: &str) -> Result<Option<UpdateInfo>, String> {
    let url = endpoint(channel).parse().map_err(friendly)?;
    let updater = app.updater_builder().endpoints(vec![url]).map_err(friendly)?.timeout(Duration::from_secs(20)).build().map_err(friendly)?;
    let found = updater.check().await.map_err(friendly)?;
    let info = found.as_ref().map(|u| UpdateInfo { current: u.current_version.clone(), version: u.version.clone(), notes: u.body.clone(), date: u.date.map(|d| d.to_string()), channel: channel.into() });
    *app.state::<Pending>().0.lock().unwrap() = found;
    Ok(info)
}

#[tauri::command]
pub fn app_version(app: State<crate::App>) -> AppVersion {
    AppVersion { version: kabul_core::schema::APP_VERSION, protocol: kabul_core::schema::PROTOCOL, channel: app.app_settings().update_channel, updater: !cfg!(debug_assertions) }
}

/// Procura agora (botão "Procurar atualizações"). `channel` vazio = o das Configurações.
#[tauri::command]
pub async fn update_check(handle: AppHandle, channel: Option<String>) -> Result<Option<UpdateInfo>, String> {
    let channel = channel.unwrap_or_else(|| handle.state::<crate::App>().app_settings().update_channel);
    check(&handle, &channel).await
}

/// Baixa, confere a assinatura, instala e reinicia o app.
#[tauri::command]
pub async fn update_install(handle: AppHandle) -> Result<(), String> {
    let update = handle.state::<Pending>().0.lock().unwrap().take().ok_or(crate::i18n::tr("Nenhuma atualização pendente; procure de novo.", "No pending update; check again."))?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(friendly)?;
    handle.restart();
}

/// Na abertura: com "Atualizações automáticas" ligado, procura em segundo plano e avisa a janela
/// (`update-available`). Em build de desenvolvimento não faz nada.
pub fn autocheck(handle: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let home = handle.state::<crate::App>().home.clone();
    let set = AppSettings::load(&home.join("app-settings.json"));
    if !set.auto_update {
        return;
    }
    let handle = handle.clone();
    std::thread::spawn(move || {
        // Deixa a janela abrir antes de ir à rede.
        std::thread::sleep(Duration::from_secs(8));
        if let Ok(Some(info)) = tauri::async_runtime::block_on(check(&handle, &set.update_channel)) {
            let _ = handle.emit("update-available", info);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn canais() {
        assert!(super::endpoint("stable").ends_with("/releases/latest/download/latest.json"));
        assert!(super::endpoint("beta").ends_with("/releases/download/beta/latest.json"));
        assert_eq!(super::endpoint("qualquer"), super::endpoint("stable"));
    }
}
