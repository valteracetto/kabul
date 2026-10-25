//! Integração com o sistema por plataforma: notificação, som, "Abrir em", abrir link/arquivo e
//! seletor de pasta/arquivo. No macOS continua o que já funcionava (osascript, afplay, `open`); no
//! Windows e no Linux entram os plugins do Tauri (notificação e diálogo) e as APIs do sistema.
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

// ---------------- notificação e som ----------------

/// Notificação do sistema pelo plugin do Tauri (sai em nome do app, então o clique traz o Kabul para a
/// frente); `sound`: nome do som de conclusão (ou nada). No macOS o som vai na própria notificação
/// (nomes de /System/Library/Sounds); fora dele, o equivalente do sistema por [`play_sound`].
pub fn notify(app: &AppHandle, title: &str, body: &str, sound: Option<&str>) -> R<()> {
    use tauri_plugin_notification::NotificationExt;
    let mut n = app.notification().builder().title(title).body(body);
    if cfg!(target_os = "macos") {
        if let Some(s) = sound {
            n = n.sound(s.to_string());
        }
    }
    n.show().map_err(e)?;
    if !cfg!(target_os = "macos") {
        if let Some(s) = sound {
            let _ = play_sound(s);
        }
    }
    Ok(())
}

/// Sons do sistema no Windows para cada nome da lista (os nomes vêm do macOS).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_sound_alias(name: &str) -> &'static str {
    match name {
        "Basso" | "Sosumi" | "Funk" => "SystemHand",
        "Blow" | "Bottle" | "Frog" | "Submarine" => "SystemExclamation",
        "Ping" | "Tink" | "Pop" | "Morse" => "SystemAsterisk",
        "Glass" | "Hero" | "Purr" => "SystemNotification",
        _ => "SystemDefault",
    }
}

/// Toca o som de conclusão (botão "Testar" e fim de tarefa fora do macOS).
pub fn play_sound(name: &str) -> R<()> {
    if name == "none" || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("afplay").arg(format!("/System/Library/Sounds/{name}.aiff")).spawn().map_err(e)?;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT};
        let alias: Vec<u16> = windows_sound_alias(name).encode_utf16().chain([0]).collect();
        unsafe {
            PlaySoundW(alias.as_ptr(), std::ptr::null_mut(), SND_ALIAS | SND_ASYNC | SND_NODEFAULT);
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let file = "/usr/share/sounds/freedesktop/stereo/complete.oga";
        if let Some(p) = ["paplay", "pw-play", "aplay"].iter().find_map(|b| kabul_core::harness::which(b)) {
            if Path::new(file).exists() {
                Command::new(p).arg(file).spawn().map_err(e)?;
            }
        }
    }
    Ok(())
}

// ---------------- abrir link, arquivo e pasta ----------------

/// Abre um link ou caminho no app padrão.
pub fn open_external(target: &str) -> R<()> {
    let mut c = if cfg!(target_os = "macos") {
        Command::new("open")
    } else if cfg!(windows) {
        // O Explorer abre pasta, arquivo (no app associado) e URL (no navegador padrão).
        Command::new("explorer.exe")
    } else {
        Command::new("xdg-open")
    };
    c.arg(target).spawn().map_err(e)?;
    Ok(())
}

// ---------------- "Abrir em" ----------------

/// App do menu "Abrir em". `id` "finder" é o gerenciador de arquivos em qualquer sistema.
pub struct AppSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: &'static str,
    pub candidates: Vec<PathBuf>,
}

impl AppSpec {
    fn new(id: &'static str, name: &'static str, kind: &'static str, candidates: Vec<PathBuf>) -> Self {
        Self { id, name, kind, candidates }
    }
    pub fn found(&self) -> Option<&PathBuf> {
        self.candidates.iter().find(|p| p.exists())
    }
}

#[cfg(target_os = "macos")]
pub fn open_apps() -> Vec<AppSpec> {
    let p = |v: &[&str]| v.iter().map(PathBuf::from).collect::<Vec<_>>();
    vec![
        AppSpec::new("finder", "Finder", "finder", p(&["/System/Library/CoreServices/Finder.app"])),
        AppSpec::new("vscode", "VS Code", "editor", p(&["/Applications/Visual Studio Code.app"])),
        AppSpec::new("cursor", "Cursor", "editor", p(&["/Applications/Cursor.app"])),
        AppSpec::new("zed", "Zed", "editor", p(&["/Applications/Zed.app", "/Applications/Zed Preview.app"])),
        AppSpec::new("windsurf", "Windsurf", "editor", p(&["/Applications/Windsurf.app"])),
        AppSpec::new("sublime", "Sublime Text", "editor", p(&["/Applications/Sublime Text.app"])),
        AppSpec::new("xcode", "Xcode", "editor", p(&["/Applications/Xcode.app"])),
        AppSpec::new("terminal", "Terminal", "terminal", p(&["/System/Applications/Utilities/Terminal.app"])),
        AppSpec::new("iterm", "iTerm", "terminal", p(&["/Applications/iTerm.app"])),
        AppSpec::new("warp", "Warp", "terminal", p(&["/Applications/Warp.app"])),
        AppSpec::new("ghostty", "Ghostty", "terminal", p(&["/Applications/Ghostty.app"])),
    ]
}

/// Apps do Windows: instalações por usuário (`%LOCALAPPDATA%\Programs`) e por máquina (`%ProgramFiles%`).
#[cfg(windows)]
pub fn open_apps() -> Vec<AppSpec> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let local = env("LOCALAPPDATA").unwrap_or_default();
    let pf = env("ProgramFiles").unwrap_or_else(|| PathBuf::from("C:\\Program Files"));
    let win = env("WINDIR").unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    vec![
        AppSpec::new("finder", "Explorador de Arquivos", "finder", vec![win.join("explorer.exe")]),
        AppSpec::new("vscode", "VS Code", "editor", vec![local.join("Programs\\Microsoft VS Code\\Code.exe"), pf.join("Microsoft VS Code\\Code.exe")]),
        AppSpec::new("cursor", "Cursor", "editor", vec![local.join("Programs\\cursor\\Cursor.exe"), pf.join("Cursor\\Cursor.exe")]),
        AppSpec::new("windsurf", "Windsurf", "editor", vec![local.join("Programs\\Windsurf\\Windsurf.exe")]),
        AppSpec::new("zed", "Zed", "editor", vec![local.join("Programs\\Zed\\zed.exe")]),
        AppSpec::new("sublime", "Sublime Text", "editor", vec![pf.join("Sublime Text\\sublime_text.exe")]),
        AppSpec::new("wt", "Windows Terminal", "terminal", vec![local.join("Microsoft\\WindowsApps\\wt.exe")]),
        AppSpec::new("pwsh", "PowerShell", "terminal", vec![pf.join("PowerShell\\7\\pwsh.exe"), win.join("System32\\WindowsPowerShell\\v1.0\\powershell.exe")]),
        AppSpec::new("gitbash", "Git Bash", "terminal", vec![pf.join("Git\\git-bash.exe")]),
    ]
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn open_apps() -> Vec<AppSpec> {
    let w = |b: &str| kabul_core::harness::which(b).into_iter().collect::<Vec<_>>();
    vec![
        AppSpec::new("finder", "Arquivos", "finder", w("xdg-open")),
        AppSpec::new("vscode", "VS Code", "editor", w("code")),
        AppSpec::new("cursor", "Cursor", "editor", w("cursor")),
        AppSpec::new("zed", "Zed", "editor", w("zed")),
        AppSpec::new("terminal", "Terminal", "terminal", w("x-terminal-emulator")),
    ]
}

/// Abre `path` no app escolhido.
pub fn open_in(spec: &AppSpec, app: &Path, path: &str) -> R<()> {
    let mut c = launch_command(spec.id, app, path);
    c.spawn().map_err(e)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_command(id: &str, app: &Path, path: &str) -> Command {
    let mut c = Command::new("open");
    if id != "finder" {
        c.arg("-a").arg(app);
    }
    c.arg(path);
    c
}

#[cfg(windows)]
fn launch_command(id: &str, app: &Path, path: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let mut c = Command::new(app);
    match id {
        "wt" => {
            c.args(["-d", path]);
        }
        "gitbash" => {
            c.arg(format!("--cd={path}"));
        }
        // Janela própria do console, já na pasta.
        "pwsh" => {
            c.arg("-NoExit").current_dir(path).creation_flags(CREATE_NEW_CONSOLE);
        }
        _ => {
            c.arg(path);
        }
    }
    c
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_command(id: &str, app: &Path, path: &str) -> Command {
    let mut c = Command::new(app);
    if id == "terminal" {
        c.current_dir(path);
    } else {
        c.arg(path);
    }
    c
}

/// Ícones dos apps (PNG em `dir/<id>.png`). Só no macOS por enquanto (JXA + NSWorkspace); nos outros a
/// UI mostra a inicial.
#[cfg(target_os = "macos")]
pub fn ensure_icons(dir: &Path, apps: &[(String, String)]) {
    let missing: Vec<&(String, String)> = apps.iter().filter(|(id, _)| !dir.join(format!("{id}.png")).exists()).collect();
    if missing.is_empty() {
        return;
    }
    let _ = std::fs::create_dir_all(dir);
    let pairs: Vec<String> = missing.iter().map(|(id, app)| format!("[{:?},{:?}]", app, dir.join(format!("{id}.png")).display().to_string())).collect();
    let js = format!(
        "ObjC.import('AppKit'); [{}].forEach(function(p){{ var img = $.NSWorkspace.sharedWorkspace.iconForFile(p[0]); img.setSize($.NSMakeSize(64,64)); var rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation); var png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()); png.writeToFileAtomically(p[1], true); }});",
        pairs.join(",")
    );
    let _ = Command::new("osascript").args(["-l", "JavaScript", "-e", &js]).output();
}

#[cfg(not(target_os = "macos"))]
pub fn ensure_icons(_dir: &Path, _apps: &[(String, String)]) {}

// ---------------- seletor de pasta e arquivo ----------------

#[cfg(target_os = "macos")]
pub fn pick(_app: &AppHandle, folder: bool) -> R<Option<String>> {
    let script = if folder { "POSIX path of (choose folder with prompt \"Repositório git\")" } else { "POSIX path of (choose file with prompt \"Anexar ao chat\")" };
    let o = Command::new("osascript").args(["-e", script]).output().map_err(e)?;
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    Ok((o.status.success() && !s.is_empty()).then_some(s))
}

#[cfg(not(target_os = "macos"))]
pub fn pick(app: &AppHandle, folder: bool) -> R<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let d = app.dialog().file();
    let chosen = if folder { d.set_title("Repositório git").blocking_pick_folder() } else { d.set_title("Anexar ao chat").blocking_pick_file() };
    Ok(chosen.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sons_do_windows() {
        assert_eq!(windows_sound_alias("Glass"), "SystemNotification");
        assert_eq!(windows_sound_alias("Basso"), "SystemHand");
        assert_eq!(windows_sound_alias("outro"), "SystemDefault");
    }

    #[test]
    fn lista_tem_o_gerenciador_de_arquivos() {
        assert!(open_apps().iter().any(|a| a.id == "finder" && a.kind == "finder"));
    }
}
