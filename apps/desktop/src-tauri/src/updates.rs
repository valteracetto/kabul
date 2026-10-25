//! Atualização automática (tauri-plugin-updater). O manifesto `latest.json` é assinado no CI
//! (`release.yml`) e publicado nos GitHub Releases:
//!
//! - `stable`: `releases/latest/download/latest.json` (última release publicada, sem pré-releases);
//! - `beta`: `releases/download/beta/latest.json` (release `beta`, regravada a cada versão, inclusive
//!   as estáveis, para quem está no beta não ficar para trás).
//!
//! Sem rede (ou com o GitHub fora do ar) a checagem só devolve um erro curto: nada quebra e a
//! próxima tentativa é na próxima abertura do app. Release sem `latest.json` (404), sem a plataforma
//! ou sem assinatura vira "Não foi possível verificar agora" e a tela oferece a página de releases.
//!
//! "Procurar atualizações…" (menu Kabul — Ajuda no Windows/Linux —, barra do Kabul, rodapé da barra
//! lateral e ⌘K) usa o canal das Configurações, estável por padrão ([`pick_channel`]). Achou versão
//! nova: grava `update-available.json` na pasta do Kabul, que o kabuld mostra ao celular
//! (Configurações › Sobre).
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

/// Marcador lido pelo kabuld (`/api/health`): o celular mostra "atualização disponível" no Mac.
pub const MARKER: &str = "update-available.json";

/// Página dos Releases (link dos erros e das notas completas).
pub fn releases_url() -> String {
    format!("https://github.com/{REPO}/releases")
}

/// Canal da checagem: o pedido (se vier) ou o das Configurações. Só "beta" é beta; vazio, ausente ou
/// qualquer outro valor é o estável — o beta só vale quando o usuário o escolheu.
pub fn pick_channel(requested: Option<&str>, configured: &str) -> &'static str {
    match requested.map(str::trim).filter(|c| !c.is_empty()).unwrap_or(configured.trim()) {
        "beta" => "beta",
        _ => "stable",
    }
}

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
    /// Data da release em segundos desde 1970 (`date` é o texto cru do manifesto).
    pub published_at: Option<i64>,
    /// Tamanho do pacote em bytes (HEAD no link do download; `None` se o servidor não disser).
    pub size: Option<u64>,
    /// Página da release desta versão (notas completas / changelog).
    pub release_url: String,
}

#[derive(Serialize)]
pub struct AppVersion {
    pub version: &'static str,
    pub protocol: u32,
    pub channel: String,
    /// `false` em builds de desenvolvimento (o updater só roda no app empacotado).
    pub updater: bool,
    pub releases_url: String,
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn no_conn() -> String {
    crate::i18n::tr("Sem conexão com o servidor de atualizações; tente mais tarde.", "Can't reach the update server; try again later.").into()
}

fn not_now() -> String {
    crate::i18n::tr("Não foi possível verificar agora.", "Couldn't check right now.").into()
}

/// Erro do updater em texto curto. Rede → "sem conexão"; release sem `latest.json` (404), sem a
/// plataforma, com assinatura ou JSON inválido → "não foi possível verificar agora".
fn friendly(e: tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match &e {
        E::Reqwest(r) if r.is_connect() || r.is_timeout() || r.is_request() => no_conn(),
        E::Network(_) => no_conn(),
        E::ReleaseNotFound | E::TargetNotFound(_) | E::TargetsNotFound(_) | E::Serialization(_) | E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::Semver(_) | E::Reqwest(_) => not_now(),
        _ => friendly_text(&e.to_string()),
    }
}

fn friendly_text(s: &str) -> String {
    let l = s.to_lowercase();
    if ["dns", "connect", "timed out", "timeout", "network", "offline", "resolve"].iter().any(|k| l.contains(k)) {
        no_conn()
    } else {
        format!("{}: {s}", crate::i18n::tr("Não deu para procurar atualizações", "Couldn't check for updates"))
    }
}

/// Tamanho do pacote: HEAD no link do download (o GitHub redireciona para o arquivo). Melhor esforço;
/// roda depois do `check`, que já deixou o provedor de criptografia do rustls instalado.
async fn size_of(url: &str) -> Option<u64> {
    let client = reqwest::Client::builder().user_agent("kabul-updater").timeout(Duration::from_secs(6)).build().ok()?;
    let r = client.head(url).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.content_length().filter(|n| *n > 0)
}

fn marker(app: &AppHandle) -> std::path::PathBuf {
    app.state::<crate::App>().home.join(MARKER)
}

async fn check(app: &AppHandle, channel: &str) -> Result<Option<UpdateInfo>, String> {
    let url = endpoint(channel).parse::<tauri::Url>().map_err(|e| friendly_text(&e.to_string()))?;
    let updater = app.updater_builder().endpoints(vec![url]).map_err(friendly)?.timeout(Duration::from_secs(20)).build().map_err(friendly)?;
    let found = updater.check().await.map_err(friendly)?;
    let info = match &found {
        Some(u) => Some(UpdateInfo {
            current: u.current_version.clone(),
            version: u.version.clone(),
            notes: u.body.clone().filter(|n| !n.trim().is_empty()),
            date: u.date.map(|d| d.to_string()),
            published_at: u.date.map(|d| d.unix_timestamp()),
            channel: channel.into(),
            size: size_of(u.download_url.as_str()).await,
            release_url: format!("{}/tag/v{}", releases_url(), u.version),
        }),
        None => None,
    };
    match &info {
        Some(i) => {
            let _ = std::fs::write(marker(app), serde_json::json!({ "version": i.version, "channel": i.channel }).to_string());
        }
        None => {
            let _ = std::fs::remove_file(marker(app));
        }
    }
    *app.state::<Pending>().0.lock().unwrap() = found;
    Ok(info)
}

#[tauri::command]
pub fn app_version(app: State<crate::App>) -> AppVersion {
    AppVersion { version: kabul_core::schema::APP_VERSION, protocol: kabul_core::schema::PROTOCOL, channel: pick_channel(None, &app.app_settings().update_channel).into(), updater: !cfg!(debug_assertions), releases_url: releases_url() }
}

/// Procura agora ("Procurar atualizações…"). Sem `channel`, o das Configurações (estável por padrão).
#[tauri::command]
pub async fn update_check(handle: AppHandle, channel: Option<String>) -> Result<Option<UpdateInfo>, String> {
    let configured = handle.state::<crate::App>().app_settings().update_channel;
    let channel = pick_channel(channel.as_deref(), &configured);
    check(&handle, channel).await
}

/// Baixa (avisando o progresso em `update-progress`), confere a assinatura, instala, para os agentes
/// e reinicia o app. A tela já perguntou antes, se havia agente rodando.
#[tauri::command]
pub async fn update_install(handle: AppHandle) -> Result<(), String> {
    let update = handle.state::<Pending>().0.lock().unwrap().take().ok_or(crate::i18n::tr("Nenhuma atualização pendente; procure de novo.", "No pending update; check again."))?;
    let (mut downloaded, mut last) = (0u64, u64::MAX);
    let h = handle.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                // Um evento por ponto percentual (ou a cada 512 KB sem o total), não um por pedaço.
                let step = total.filter(|t| *t > 0).map(|t| downloaded * 100 / t).unwrap_or(downloaded >> 19);
                if step != last {
                    last = step;
                    let _ = h.emit("update-progress", Progress { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(friendly)?;
    let _ = std::fs::remove_file(marker(&handle));
    for (_, c) in handle.state::<crate::App>().chats.lock().unwrap().drain() {
        let _ = c.lock().unwrap().kill();
    }
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
        if let Ok(Some(info)) = tauri::async_runtime::block_on(check(&handle, pick_channel(None, &set.update_channel))) {
            let _ = handle.emit("update-available", info);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::pick_channel;

    #[test]
    fn canal_estavel_por_padrao_beta_so_se_escolhido() {
        // Configurações novas: canal estável.
        assert_eq!(pick_channel(None, "stable"), "stable");
        // Configuração vazia ou estranha (arquivo antigo, valor digitado à mão) não vira beta.
        assert_eq!(pick_channel(None, ""), "stable");
        assert_eq!(pick_channel(None, "nightly"), "stable");
        assert_eq!(pick_channel(None, "Beta"), "stable");
        // Quem escolheu o beta recebe o beta.
        assert_eq!(pick_channel(None, "beta"), "beta");
        assert_eq!(pick_channel(None, " beta "), "beta");
        // Pedido explícito vale sobre a configuração; pedido vazio cai na configuração.
        assert_eq!(pick_channel(Some("stable"), "beta"), "stable");
        assert_eq!(pick_channel(Some("beta"), "stable"), "beta");
        assert_eq!(pick_channel(Some(""), "beta"), "beta");
        assert_eq!(pick_channel(Some("  "), "stable"), "stable");
        assert_eq!(pick_channel(Some("qualquer"), "beta"), "stable");
    }

    #[test]
    fn padrao_das_configuracoes_e_estavel() {
        let s = kabul_core::settings::AppSettings::default();
        assert_eq!(pick_channel(None, &s.update_channel), "stable");
    }

    #[test]
    fn pagina_de_releases() {
        assert!(super::releases_url().starts_with("https://github.com/"));
        assert!(super::releases_url().ends_with("/releases"));
    }

    #[test]
    fn canais() {
        assert!(super::endpoint("stable").ends_with("/releases/latest/download/latest.json"));
        assert!(super::endpoint("beta").ends_with("/releases/download/beta/latest.json"));
        assert_eq!(super::endpoint("qualquer"), super::endpoint("stable"));
    }
}
