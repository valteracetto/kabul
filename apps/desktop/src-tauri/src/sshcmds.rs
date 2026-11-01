//! Hosts SSH (Configurações › Hosts SSH), sobre `kabul_core::ssh`: listar, valor efetivo, testar,
//! chaves, prévia/gravação do `~/.ssh/config`, terminal do Kabul com `ssh <alias>` e "Abrir em".
use crate::{e, os, App, R};
use kabul_core::ssh::{self, edit, keys, run, Roots};
use kabul_core::term;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};

/// Roda fora da thread do IPC (ssh pode levar até 15 s).
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> R<T> + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(e)?
}

#[tauri::command]
pub async fn ssh_hosts() -> R<ssh::Overview> {
    blocking(|| Ok(ssh::overview(&Roots::user()))).await
}

#[tauri::command]
pub async fn ssh_effective(aliases: Vec<String>) -> R<Vec<run::Effective>> {
    blocking(move || Ok(run::effective_many(&Roots::user(), &aliases))).await
}

#[tauri::command]
pub async fn ssh_test(alias: String) -> R<run::TestResult> {
    blocking(move || run::test(&Roots::user(), &alias).map_err(e)).await
}

#[tauri::command]
pub async fn ssh_keys() -> R<Vec<keys::KeyInfo>> {
    blocking(|| Ok(keys::list(&Roots::user()))).await
}

#[tauri::command]
pub async fn ssh_preview(op: edit::Op) -> R<edit::Plan> {
    blocking(move || edit::plan(&Roots::user(), &op).map_err(e)).await
}

#[tauri::command]
pub async fn ssh_apply(op: edit::Op, digest: String) -> R<edit::Applied> {
    blocking(move || edit::apply(&Roots::user(), &op, &digest).map_err(e)).await
}

#[tauri::command]
pub async fn ssh_keygen(name: String, comment: String) -> R<keys::KeyInfo> {
    blocking(move || run::keygen(&Roots::user(), &name, &comment).map_err(e)).await
}

/// Sessão de terminal `kabul-ssh-<alias>` (reaproveita a que já estiver aberta). A UI abre como aba.
#[tauri::command]
pub async fn ssh_terminal(alias: String) -> R<String> {
    blocking(move || {
        let l = ssh::terminal_launch(&Roots::user(), &alias).map_err(e)?;
        let b = term::backend();
        if !b.has(&l.name) {
            b.open(&l).map_err(e)?;
        }
        Ok(l.name)
    })
    .await
}

#[derive(Serialize)]
pub struct SshTarget {
    id: &'static str,
    name: &'static str,
}

/// Apps do "Abrir em" que sabem abrir uma sessão SSH (terminais e editores com Remote-SSH).
#[tauri::command]
pub fn ssh_open_targets() -> Vec<SshTarget> {
    os::open_apps().into_iter().filter(|a| a.found().is_some() && os::ssh_capable(a.id)).map(|a| SshTarget { id: a.id, name: a.name }).collect()
}

#[tauri::command]
pub async fn ssh_open_in(app: State<'_, App>, target: String, alias: String) -> R<()> {
    let dir = app.file("ssh-launch");
    blocking(move || {
        let r = Roots::user();
        ssh::ensure_known(&r, &alias).map_err(e)?;
        let t = os::open_apps().into_iter().find(|t| t.id == target && os::ssh_capable(t.id)).ok_or("app desconhecido")?;
        let app_path = t.found().cloned().ok_or(crate::i18n::tr("app não instalado", "app not installed"))?;
        os::open_ssh(&t, &app_path, &alias, r.explicit_config.then_some(r.config.as_path()), &dir)
    })
    .await
}

/// Seletor de arquivo começando em `~/.ssh` (para o IdentityFile). Só o caminho volta; nada é lido.
#[tauri::command]
pub async fn ssh_pick_key(handle: AppHandle) -> R<Option<String>> {
    let dir = Roots::user().ssh_dir;
    pick_in(&handle, &dir)
}

#[cfg(target_os = "macos")]
fn pick_in(_app: &AppHandle, dir: &Path) -> R<Option<String>> {
    let prompt = crate::i18n::tr("Chave SSH (IdentityFile)", "SSH key (IdentityFile)");
    let script = format!("POSIX path of (choose file with prompt {prompt:?} default location (POSIX file {:?}) with showing package contents and invisibles)", dir.display().to_string());
    let o = std::process::Command::new("osascript").args(["-e", script.as_str()]).output().map_err(e)?;
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok((o.status.success() && !s.is_empty()).then_some(s))
}

#[cfg(not(target_os = "macos"))]
fn pick_in(app: &AppHandle, dir: &Path) -> R<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let chosen = app.dialog().file().set_title(crate::i18n::tr("Chave SSH (IdentityFile)", "SSH key (IdentityFile)")).set_directory(dir).blocking_pick_file();
    Ok(chosen.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}
