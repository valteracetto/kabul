//! Barra do Kabul: ícone na barra de menus (macOS) / bandeja (Windows, Linux) pelo tray do Tauri.
//! Clique esquerdo abre um popover (janela `tray`, a mesma PWA em modo compacto); clique direito, um
//! menu nativo com as ações rápidas. O ícone mostra os limites escolhidos na aba Uso (ou, no automático,
//! os dois mais apertados) no estilo escolhido (core `usage::icon`); no macOS, as porcentagens e o gasto
//! do dia em texto ao lado; no Windows, tudo na dica.
//!
//! Também aqui: os comandos de uso (`usage_*`), a lista de agentes rodando e o laço que relê os limites
//! (a cada 5 min) e avisa quando um alerta novo aparece.
use crate::i18n::tr;
use crate::App;
use kabul_core::usage::{self, AlertConfig, LimitsSnapshot, Overview};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const TRAY_ID: &str = "kabul";
const POP_W: f64 = 340.0;
const POP_H: f64 = 520.0;

type R<T> = Result<T, String>;

/// Alertas já avisados (não repete até o reset da janela / virar o dia).
#[derive(Default)]
pub struct TrayState {
    notified: Mutex<HashSet<String>>,
    /// Quando o popover sumiu por perder o foco: o clique no próprio ícone tira o foco antes de chegar
    /// aqui, e sem isso o mesmo clique o reabriria.
    hidden_at: Mutex<Option<std::time::Instant>>,
}

/// Conversa viva no app (para "agentes rodando agora").
#[derive(Clone, Serialize)]
pub struct ChatInfo {
    pub workspace_id: String,
    pub model: String,
    pub harness: String,
    pub since: u64,
    pub working: bool,
}

#[derive(Serialize)]
pub struct RunningAgent {
    chat_id: String,
    workspace_id: String,
    workspace: String,
    model: String,
    harness: String,
    since: u64,
    working: bool,
}

fn workspace_label(app: &App, id: &str) -> Option<String> {
    let st = app.store.lock().unwrap();
    st.workspace(id).ok().map(|w| w.title.clone().unwrap_or_else(|| w.name.clone()))
}

fn overview(app: &App, days: u32) -> Overview {
    let cfg = AlertConfig::from_settings(&app.app_settings());
    usage::overview(&app.home, days, &cfg, &|id| workspace_label(app, id))
}

// ---------------- comandos ----------------

#[tauri::command]
pub async fn usage_overview(handle: AppHandle, days: Option<u32>) -> R<Overview> {
    tauri::async_runtime::spawn_blocking(move || overview(&handle.state::<App>(), days.unwrap_or(30))).await.map_err(|e| e.to_string())
}

/// Relê os limites (app-server do Codex, CodexBar). Leva alguns segundos.
#[tauri::command]
pub async fn usage_refresh(handle: AppHandle) -> R<LimitsSnapshot> {
    let h = handle.clone();
    let snap = tauri::async_runtime::spawn_blocking(move || {
        let app = h.state::<App>();
        usage::limits::refresh(&app.home, app.app_settings().usage_codexbar)
    })
    .await
    .map_err(|e| e.to_string())?;
    changed(&handle);
    Ok(snap)
}

#[tauri::command]
pub async fn usage_csv(handle: AppHandle, days: Option<u32>) -> R<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app = handle.state::<App>();
        let since = kabul_core::store::now().saturating_sub(days.unwrap_or(30) as u64 * 86_400);
        usage::csv(&usage::Ledger::open(&app.home).since(since), usage::local_offset())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Grava o CSV em Downloads e devolve o caminho.
#[tauri::command]
pub async fn usage_csv_save(handle: AppHandle, days: Option<u32>) -> R<String> {
    let csv = usage_csv(handle, days).await?;
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(std::path::PathBuf::from).ok_or(tr("sem pasta do usuário", "no home folder"))?;
    let dir = home.join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("kabul-uso-{}.csv", usage::day_of(kabul_core::store::now(), usage::local_offset()));
    let path = dir.join(name);
    std::fs::write(&path, csv).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn agents_running(app: State<App>) -> Vec<RunningAgent> {
    let live: Vec<String> = app.chats.lock().unwrap().keys().cloned().collect();
    let meta = app.chat_meta.lock().unwrap().clone();
    let mut v: Vec<RunningAgent> = live
        .into_iter()
        .filter_map(|id| {
            let m = meta.get(&id)?;
            Some(RunningAgent {
                workspace: workspace_label(&app, &m.workspace_id).unwrap_or_else(|| m.workspace_id.clone()),
                chat_id: id,
                workspace_id: m.workspace_id.clone(),
                model: m.model.clone(),
                harness: m.harness.clone(),
                since: m.since,
                working: m.working,
            })
        })
        .collect();
    v.sort_by(|a, b| b.working.cmp(&a.working).then(a.since.cmp(&b.since)));
    v
}

/// Ações do popover: abrir o Kabul (opcionalmente num workspace), novo workspace, pausar todos,
/// procurar atualizações.
#[tauri::command]
pub fn tray_action(handle: AppHandle, action: String, workspace_id: Option<String>) -> R<()> {
    if let Some(p) = handle.get_webview_window("tray") {
        let _ = p.hide();
    }
    let main = handle.get_webview_window("main").ok_or(tr("janela principal não encontrada", "main window not found"))?;
    match action.as_str() {
        "open" | "open-workspace" | "new-workspace" | "usage" | "check-updates" => {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
        "pause-all" => {}
        other => return Err(format!("{}: {other}", tr("ação desconhecida", "unknown action"))),
    }
    // O frontend da janela principal faz o resto (rota, modal, parar com o mesmo fluxo do botão Parar).
    let _ = main.emit("tray-action", serde_json::json!({ "action": action, "workspace_id": workspace_id }));
    Ok(())
}

#[tauri::command]
pub fn tray_hide(handle: AppHandle) {
    if let Some(p) = handle.get_webview_window("tray") {
        let _ = p.hide();
    }
}

// ---------------- ícone ----------------

/// Uso mudou (turno terminou, limites relidos): redesenha o ícone e avisa as janelas.
pub fn changed(handle: &AppHandle) {
    refresh_icon(handle);
    let _ = handle.emit("usage-changed", ());
}

fn refresh_icon(handle: &AppHandle) {
    let Some(tray) = handle.tray_by_id(TRAY_ID) else { return };
    let app = handle.state::<App>();
    let prefs = app.app_settings().tray_icon;
    let snap = usage::limits::load(&app.home);
    let now = kabul_core::store::now();
    // O que vai no ícone: automático (os dois mais apertados) ou os limites escolhidos na aba Uso.
    let slots = usage::icon::select(&snap.limits, &prefs, now);
    let spend = prefs.show_spend.then(|| money(usage::today_usd(&app.home)));
    let _ = tray.set_icon(Some(icon_image(&slots, &prefs)));
    let _ = tray.set_tooltip(Some(&tooltip(&slots, spend.as_deref(), now)));
    // Texto ao lado do ícone: só macOS (no Windows a bandeja não tem título; tudo vai na dica).
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(usage::icon::title_text(&slots, &prefs, spend.as_deref()));
}

/// "US$ 1,20" (pt-BR) / "$1.20" (en).
fn money(v: f64) -> String {
    if crate::i18n::is_en() {
        format!("${v:.2}")
    } else {
        format!("US$ {v:.2}").replace('.', ",")
    }
}

/// "Padrão do sistema" no idioma da interface.
fn sys_label(l: &str) -> String {
    if l == "Padrão do sistema" {
        tr("Padrão do sistema", "System default").to_string()
    } else {
        l.to_string()
    }
}

/// Dica do ícone: uma linha por limite do ícone e o gasto de hoje. No Windows a dica é o único texto
/// (a bandeja não tem título) e o sistema corta em 127 caracteres.
fn tooltip(slots: &[usage::icon::Slot], spend: Option<&str>, now: u64) -> String {
    let mut lines = vec!["Kabul".to_string()];
    let several = |p: &str| slots.iter().filter(|s| s.provider == p).map(|s| &s.account).collect::<HashSet<_>>().len() > 1;
    for s in slots {
        let who = s.account_label.as_ref().filter(|_| several(&s.provider)).map(|l| format!(" ({})", sys_label(l))).unwrap_or_default();
        let head = format!("{}{who} {}", usage::limits::provider_label(&s.provider), limit_title(&s.window, &s.title));
        lines.push(match s.used_pct {
            Some(p) => {
                let resets = s.resets_at.map(|r| format!(" ({} {})", tr("reinicia em", "resets in"), countdown(r.saturating_sub(now)))).unwrap_or_default();
                format!("{head}: {p:.0}%{resets}")
            }
            None => format!("{head}: {}", tr("sem dado agora", "no data now")),
        });
    }
    if let Some(sp) = spend {
        lines.push(format!("{}: {sp}", tr("Hoje", "Today")));
    }
    let tip = lines.join("\n");
    if cfg!(windows) && tip.chars().count() > 127 {
        return tip.chars().take(126).collect::<String>() + "…";
    }
    tip
}

fn icon_image(slots: &[usage::icon::Slot], prefs: &kabul_core::settings::TrayIconPrefs) -> tauri::image::Image<'static> {
    // macOS: template (o sistema pinta). Windows/Linux: cinza claro, legível na barra escura e na clara.
    let rgb = if cfg!(target_os = "macos") { [0, 0, 0] } else { [200, 200, 200] };
    tauri::image::Image::new_owned(usage::icon::render_for(slots, prefs, rgb), usage::icon::SIZE, usage::icon::SIZE)
}

// ---------------- popover ----------------

fn popover(handle: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = handle.get_webview_window("tray") {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(handle, "tray", WebviewUrl::App("index.html".into())).title("Kabul").inner_size(POP_W, POP_H).resizable(false).decorations(false).always_on_top(true).skip_taskbar(true).visible(false).focused(true).build()?;
    let (w2, h2) = (w.clone(), handle.clone());
    w.on_window_event(move |e| {
        if let WindowEvent::Focused(false) = e {
            if w2.is_visible().unwrap_or(false) {
                *h2.state::<TrayState>().hidden_at.lock().unwrap() = Some(std::time::Instant::now());
            }
            let _ = w2.hide();
        }
    });
    Ok(w)
}

/// Mostra o popover encostado no ícone: abaixo (barra de menus no topo) ou acima (bandeja embaixo).
fn toggle_popover(handle: &AppHandle, rect: tauri::Rect) {
    let Ok(w) = popover(handle) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    if handle.state::<TrayState>().hidden_at.lock().unwrap().is_some_and(|t| t.elapsed() < std::time::Duration::from_millis(300)) {
        return;
    }
    let scale = w.scale_factor().unwrap_or(1.0);
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let (pw, ph) = (POP_W * scale, POP_H * scale);
    let mon = w.monitor_from_point(pos.x, pos.y).ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    let (mx, my, mw, mh) = mon.map(|m| (m.position().x as f64, m.position().y as f64, m.size().width as f64, m.size().height as f64)).unwrap_or((0.0, 0.0, 1920.0 * scale, 1080.0 * scale));
    let below = pos.y - my < mh / 2.0;
    let x = (pos.x + size.width / 2.0 - pw / 2.0).clamp(mx + 8.0, mx + mw - pw - 8.0);
    let y = if below { pos.y + size.height + 4.0 } else { pos.y - ph - 4.0 };
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("usage-changed", ());
}

// ---------------- liga/desliga ----------------

/// Cria ou remove o ícone conforme Configurações › Geral › "Ícone na barra de menus".
pub fn apply(handle: &AppHandle) {
    let on = handle.state::<App>().app_settings().tray;
    let exists = handle.tray_by_id(TRAY_ID).is_some();
    if on && !exists {
        if let Err(e) = build(handle) {
            eprintln!("kabul: barra de menus: {e}");
        }
    } else if !on && exists {
        let _ = handle.remove_tray_by_id(TRAY_ID);
        if let Some(p) = handle.get_webview_window("tray") {
            let _ = p.close();
        }
    }
}

fn tray_menu(handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::with_items(
        handle,
        &[
            &MenuItem::with_id(handle, "tray-open", tr("Abrir o Kabul", "Open Kabul"), true, None::<&str>)?,
            &MenuItem::with_id(handle, "tray-new", tr("Novo workspace", "New workspace"), true, None::<&str>)?,
            &MenuItem::with_id(handle, "tray-usage", tr("Uso e limites", "Usage and limits"), true, None::<&str>)?,
            &MenuItem::with_id(handle, "tray-pause", tr("Pausar todos os agentes", "Pause all agents"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "tray-refresh", tr("Atualizar limites", "Refresh limits"), true, None::<&str>)?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "tray-updates", tr("Procurar atualizações…", "Check for Updates…"), true, None::<&str>)?,
        ],
    )
}

/// Idioma trocou: menu e dica do ícone no idioma novo.
pub fn relabel(handle: &AppHandle) {
    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
        if let Ok(m) = tray_menu(handle) {
            let _ = tray.set_menu(Some(m));
        }
        refresh_icon(handle);
    }
}

/// Título da janela de limite no idioma da interface (o core guarda em português).
pub fn limit_title(window: &str, title: &str) -> String {
    if !crate::i18n::is_en() {
        return title.to_string();
    }
    let num = |suffix: &str| window.strip_suffix(suffix).and_then(|n| n.parse::<u64>().ok());
    match window {
        "5h" => "Session (5h)".into(),
        "semana" | "seven_day" => "Week".into(),
        "mes" => "Month".into(),
        "seven_day_opus" => "Week (Opus)".into(),
        "seven_day_sonnet" => "Week (Sonnet)".into(),
        "extra" => "Extra usage".into(),
        // Semana de um modelo ("Semana (Fable)"): o nome do modelo vem no título.
        w if w.starts_with("seven_day_") => title.strip_prefix("Semana (").and_then(|m| m.strip_suffix(')')).map(|m| format!("Week ({m})")).unwrap_or_else(|| title.to_string()),
        _ => match (num("d"), num("h"), num("m")) {
            (Some(d), _, _) => format!("{d} days"),
            (_, Some(h), _) => format!("{h}h"),
            (_, _, Some(m)) => format!("{m} min"),
            _ => title.to_string(),
        },
    }
}

/// "3 h 20 min" (pt-BR) / "3h 20m" (en).
pub fn countdown(secs: u64) -> String {
    if !crate::i18n::is_en() {
        return usage::countdown(secs);
    }
    let (d, h, m) = (secs / 86_400, secs % 86_400 / 3600, secs % 3600 / 60);
    if d > 0 {
        format!("{d}d {h}h")
    } else if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{}m", m.max(1))
    }
}

/// Texto do alerta no idioma da interface (o `text` do core é a versão em português).
fn alert_text(a: &usage::Alert) -> String {
    if !crate::i18n::is_en() {
        return a.text.clone();
    }
    match (a.kind.as_str(), a.spent_usd, a.budget_usd) {
        ("daily_budget", Some(s), Some(b)) => format!("Today's spend: ${s:.2} of ${b:.2} ({:.0}%)", a.pct),
        ("monthly_budget", Some(s), Some(b)) => format!("This month's spend: ${s:.2} of ${b:.2} ({:.0}%)", a.pct),
        ("limit", _, _) => {
            let who = a.account_label.as_ref().map(|x| format!(" ({x})")).unwrap_or_default();
            let provider = a.provider.as_deref().map(usage::limits::provider_label).unwrap_or("");
            let title = limit_title(a.window.as_deref().unwrap_or(""), a.title.as_deref().unwrap_or(""));
            let resets = a.resets_in_secs.map(|s| format!(", resets in {}", countdown(s))).unwrap_or_default();
            format!("{provider}{who}: {title} at {:.0}%{resets}", a.pct)
        }
        _ => a.text.clone(),
    }
}

fn build(handle: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(handle)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(&[], &Default::default()))
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Kabul")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| {
            let act = match ev.id().as_ref() {
                "tray-open" => "open",
                "tray-new" => "new-workspace",
                "tray-usage" => "usage",
                "tray-pause" => "pause-all",
                "tray-updates" => "check-updates",
                "tray-refresh" => {
                    let h = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = usage_refresh(h).await;
                    });
                    return;
                }
                _ => return,
            };
            let _ = tray_action(app.clone(), act.into(), None);
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { rect, button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                toggle_popover(tray.app_handle(), rect);
            }
        })
        .build(handle)?;
    refresh_icon(handle);
    Ok(())
}

// ---------------- laço de fundo ----------------

/// Relê os limites ao abrir e de tempos em tempos; redesenha a cada minuto (contagens e janelas que venceram)
/// e manda notificação para alerta novo.
pub fn start_loop(handle: &AppHandle) {
    let h = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let mut tick: u64 = 0;
        loop {
            // App-server do Codex a cada 5 min; CodexBar (consulta as APIs dos provedores) a cada 15.
            if tick.is_multiple_of(5) {
                let app = h.state::<App>();
                usage::limits::refresh(&app.home, app.app_settings().usage_codexbar && tick.is_multiple_of(15));
            }
            changed(&h);
            check_alerts(&h);
            tick += 1;
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    });
}

fn check_alerts(handle: &AppHandle) {
    let app = handle.state::<App>();
    let o = overview(&app, 1);
    let st = handle.state::<TrayState>();
    let mut seen = st.notified.lock().unwrap();
    for a in o.alerts {
        if seen.insert(a.key.clone()) {
            let title = if a.level == "crit" { tr("Limite atingido", "Limit reached") } else { tr("Uso de IA", "AI usage") };
            let _ = crate::send_notification(handle, &app, title, &alert_text(&a));
        }
    }
}
