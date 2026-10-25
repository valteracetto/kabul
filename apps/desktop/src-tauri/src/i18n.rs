//! Idioma dos textos nativos (menu, barra do Kabul, notificações, seletores de arquivo e erros do app).
//! O frontend resolve o idioma (Configurações › Geral: Sistema/English/Português) e manda via
//! `set_ui_lang` a cada abertura; o valor fica gravado em `ui-lang` para o menu já nascer certo na próxima.
//! Antes disso (primeira abertura), vale o idioma do sistema; fora do português, inglês.
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static EN: AtomicBool = AtomicBool::new(true);

pub fn is_en() -> bool {
    EN.load(Ordering::Relaxed)
}

/// Escolhe o texto do idioma atual: `tr("Sair", "Quit")`.
pub fn tr(pt: &'static str, en: &'static str) -> &'static str {
    if is_en() {
        en
    } else {
        pt
    }
}

/// Idioma do sistema: macOS pelas preferências (`AppleLanguages`), os outros pelo ambiente.
fn system_is_pt() -> bool {
    #[cfg(target_os = "macos")]
    if let Ok(o) = std::process::Command::new("defaults").args(["read", "-g", "AppleLanguages"]).output() {
        let s = String::from_utf8_lossy(&o.stdout);
        if let Some(first) = s.split('"').nth(1) {
            return first.to_ascii_lowercase().starts_with("pt");
        }
    }
    ["LC_ALL", "LC_MESSAGES", "LANG"].iter().filter_map(|k| std::env::var(k).ok()).find(|v| !v.is_empty()).is_some_and(|v| v.to_ascii_lowercase().starts_with("pt"))
}

/// Na abertura: o último idioma que o frontend mandou ou, na primeira vez, o do sistema.
pub fn init(home: &Path) {
    let saved = std::fs::read_to_string(home.join("ui-lang")).ok();
    let en = match saved.as_deref().map(str::trim) {
        Some("pt-BR") | Some("pt") => false,
        Some("en") => true,
        _ => !system_is_pt(),
    };
    EN.store(en, Ordering::Relaxed);
}

/// O frontend avisa o idioma em uso; se mudou, refaz o menu do app e o da barra.
#[tauri::command]
pub fn set_ui_lang(handle: AppHandle, app: tauri::State<crate::App>, lang: String) -> Result<(), String> {
    let en = !lang.to_ascii_lowercase().starts_with("pt");
    let _ = std::fs::write(app.file("ui-lang"), if en { "en" } else { "pt-BR" });
    if EN.swap(en, Ordering::Relaxed) == en {
        return Ok(());
    }
    if let Ok(m) = crate::menu::build(&handle) {
        let _ = handle.set_menu(m);
    }
    crate::tray::relabel(&handle);
    Ok(())
}
