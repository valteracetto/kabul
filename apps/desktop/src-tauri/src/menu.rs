//! Menu nativo: Kabul (Sobre, Configurações ⌘,, Ocultar, Sair ⌘Q com confirmação), Arquivo, Editar,
//! Ver (barra lateral, painel direito, zen, zoom, tela cheia), Janela e Ajuda. Os itens próprios viram
//! o evento `menu` para o frontend (que já tem os mesmos atalhos); "Sair" vira `quit-requested`.
//! Textos no idioma da interface (`i18n`); trocar o idioma refaz o menu (`i18n::set_ui_lang`).
use crate::i18n::tr;
use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let kabul = SubmenuBuilder::new(app, "Kabul")
        .item(&PredefinedMenuItem::about(app, Some(tr("Sobre o Kabul", "About Kabul")), Some(AboutMetadata { name: Some("Kabul".into()), ..Default::default() }))?)
        .separator()
        .item(&item("settings", tr("Configurações…", "Settings…"), Some("CmdOrCtrl+,"))?)
        .separator();
    #[cfg(target_os = "macos")]
    let kabul =
        kabul.services_with_text(tr("Serviços", "Services")).separator().hide_with_text(tr("Ocultar o Kabul", "Hide Kabul")).hide_others_with_text(tr("Ocultar os outros", "Hide Others")).show_all_with_text(tr("Mostrar tudo", "Show All")).separator();
    let kabul = kabul.item(&item("quit", tr("Sair do Kabul", "Quit Kabul"), Some("CmdOrCtrl+Q"))?).build()?;
    let file = SubmenuBuilder::new(app, tr("Arquivo", "File"))
        .item(&item("new-workspace", tr("Novo workspace", "New Workspace"), None)?)
        .item(&item("add-project", tr("Adicionar projeto…", "Add Project…"), None)?)
        .separator()
        .close_window_with_text(tr("Fechar janela", "Close Window"))
        .build()?;
    let edit = SubmenuBuilder::new(app, tr("Editar", "Edit"))
        .undo_with_text(tr("Desfazer", "Undo"))
        .redo_with_text(tr("Refazer", "Redo"))
        .separator()
        .cut_with_text(tr("Recortar", "Cut"))
        .copy_with_text(tr("Copiar", "Copy"))
        .paste_with_text(tr("Colar", "Paste"))
        .select_all_with_text(tr("Selecionar tudo", "Select All"))
        .build()?;
    let view = SubmenuBuilder::new(app, tr("Ver", "View"))
        .item(&item("toggle-sidebar", tr("Alternar barra lateral", "Toggle Sidebar"), None)?)
        .item(&item("toggle-right", tr("Alternar painel direito", "Toggle Right Panel"), None)?)
        .item(&item("zen", tr("Modo zen", "Zen Mode"), None)?)
        .separator()
        .item(&item("zoom-in", tr("Aumentar zoom", "Zoom In"), None)?)
        .item(&item("zoom-out", tr("Diminuir zoom", "Zoom Out"), None)?)
        .item(&item("zoom-reset", tr("Tamanho real", "Actual Size"), None)?)
        .separator()
        .fullscreen_with_text(tr("Tela cheia", "Enter Full Screen"))
        .build()?;
    let window = SubmenuBuilder::new(app, tr("Janela", "Window")).minimize_with_text(tr("Minimizar", "Minimize")).maximize_with_text(tr("Zoom", "Zoom")).build()?;
    let help = SubmenuBuilder::new(app, tr("Ajuda", "Help"))
        .item(&item("shortcuts", tr("Atalhos de teclado", "Keyboard Shortcuts"), None)?)
        .item(&item("diagnostics", tr("Diagnóstico…", "Diagnostics…"), None)?)
        .item(&item("feedback", tr("Enviar feedback…", "Send Feedback…"), None)?)
        .item(&item("devtools", tr("Abrir ferramentas de depuração", "Open Developer Tools"), None)?)
        .build()?;
    Menu::with_items(app, &[&kabul, &file, &edit, &view, &window, &help])
}

/// Repassa o clique ao frontend. Os atalhos ficam no frontend (exceto ⌘, e ⌘Q), para valerem também no navegador.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = if id == "quit" { app.emit("quit-requested", ()) } else { app.emit("menu", id) };
}
