//! Menu nativo: Kabul (Sobre, Configurações ⌘,, Ocultar, Sair ⌘Q com confirmação), Arquivo, Editar,
//! Ver (barra lateral, painel direito, zen, zoom, tela cheia), Janela e Ajuda. Os itens próprios viram
//! o evento `menu` para o frontend (que já tem os mesmos atalhos); "Sair" vira `quit-requested`.
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
        .item(&PredefinedMenuItem::about(app, Some("Sobre o Kabul"), Some(AboutMetadata { name: Some("Kabul".into()), ..Default::default() }))?)
        .separator()
        .item(&item("settings", "Configurações…", Some("CmdOrCtrl+,"))?)
        .separator();
    #[cfg(target_os = "macos")]
    let kabul = kabul.services().separator().hide().hide_others().show_all().separator();
    let kabul = kabul.item(&item("quit", "Sair do Kabul", Some("CmdOrCtrl+Q"))?).build()?;
    let file = SubmenuBuilder::new(app, "Arquivo")
        .item(&item("new-workspace", "Novo workspace", None)?)
        .item(&item("add-project", "Adicionar projeto…", None)?)
        .separator()
        .close_window()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Editar").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let view = SubmenuBuilder::new(app, "Ver")
        .item(&item("toggle-sidebar", "Alternar barra lateral", None)?)
        .item(&item("toggle-right", "Alternar painel direito", None)?)
        .item(&item("zen", "Modo zen", None)?)
        .separator()
        .item(&item("zoom-in", "Aumentar zoom", None)?)
        .item(&item("zoom-out", "Diminuir zoom", None)?)
        .item(&item("zoom-reset", "Tamanho real", None)?)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Janela").minimize().maximize().build()?;
    let help = SubmenuBuilder::new(app, "Ajuda")
        .item(&item("shortcuts", "Atalhos de teclado", None)?)
        .item(&item("diagnostics", "Diagnóstico…", None)?)
        .item(&item("feedback", "Enviar feedback…", None)?)
        .item(&item("devtools", "Abrir ferramentas de depuração", None)?)
        .build()?;
    Menu::with_items(app, &[&kabul, &file, &edit, &view, &window, &help])
}

/// Repassa o clique ao frontend. Os atalhos ficam no frontend (exceto ⌘, e ⌘Q), para valerem também no navegador.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = if id == "quit" { app.emit("quit-requested", ()) } else { app.emit("menu", id) };
}
