//! Navegador baixado pelo Kabul quando não há Chrome/Edge/Chromium instalado: o
//! `chrome-headless-shell` do Chrome for Testing (projeto oficial do Chromium para automação), só
//! com o consentimento do usuário (botão em Configurações › Navegador ou `kabul browser install`).
//!
//! Vai para `<estado>/browser/bin/chrome-headless-shell-<plataforma>/` (~100 MB descompactado).
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};

const INDEX: &str = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";

/// Plataforma no formato do Chrome for Testing.
pub fn platform() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "mac-arm64",
        ("macos", _) => "mac-x64",
        ("windows", "x86") => "win32",
        ("windows", _) => "win64",
        ("linux", "x86_64") => "linux64",
        _ => return None,
    })
}

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "chrome-headless-shell.exe"
    } else {
        "chrome-headless-shell"
    }
}

pub fn dir(home: &Path) -> PathBuf {
    home.join("browser").join("bin")
}

/// Executável já baixado, se houver.
pub fn installed(home: &Path) -> Option<PathBuf> {
    let p = dir(home).join(format!("chrome-headless-shell-{}", platform()?)).join(exe_name());
    p.is_file().then_some(p)
}

/// URL do zip na versão estável mais recente.
pub fn download_url(index: &Value, plat: &str) -> Option<String> {
    index.pointer("/channels/Stable/downloads/chrome-headless-shell")?.as_array()?.iter().find(|d| d["platform"] == plat).and_then(|d| d["url"].as_str()).map(String::from)
}

/// Baixa e descompacta (bloqueia; ~30–60 s numa conexão comum). Devolve o executável.
pub fn install(home: &Path) -> Result<PathBuf> {
    if let Some(p) = installed(home) {
        return Ok(p);
    }
    let plat = platform().context("plataforma sem chrome-headless-shell oficial")?;
    let idx: Value =
        ureq::get(INDEX).timeout(std::time::Duration::from_secs(20)).call().context("consultando o Chrome for Testing")?.into_string().ok().and_then(|s| serde_json::from_str(&s).ok()).context("resposta inválida do Chrome for Testing")?;
    let url = download_url(&idx, plat).context("versão estável sem download para esta plataforma")?;
    let d = dir(home);
    std::fs::create_dir_all(&d)?;
    let zip = d.join("download.zip");
    let mut r = ureq::get(&url).timeout(std::time::Duration::from_secs(600)).call().context("baixando o navegador")?.into_reader();
    let mut f = std::fs::File::create(&zip)?;
    std::io::copy(&mut r, &mut f).context("gravando o download")?;
    drop(f);
    // `unzip` no macOS/Linux; no Windows 10+ o `tar` do sistema (bsdtar) abre zip.
    let st = if cfg!(windows) { crate::shell::command("tar").arg("-xf").arg(&zip).arg("-C").arg(&d).status() } else { crate::shell::command("unzip").arg("-q").arg("-o").arg(&zip).arg("-d").arg(&d).status() };
    let _ = std::fs::remove_file(&zip);
    if !st.map(|s| s.success()).unwrap_or(false) {
        bail!("não consegui descompactar o navegador baixado");
    }
    let exe = installed(home).context("download sem o executável esperado")?;
    #[cfg(target_os = "macos")]
    {
        // Baixado pelo próprio Kabul (sem quarentena do navegador), mas por garantia.
        let _ = std::process::Command::new("xattr").args(["-dr", "com.apple.quarantine"]).arg(exe.parent().unwrap_or(&d)).status();
    }
    Ok(exe)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn acha_o_zip_da_plataforma() {
        let idx = json!({ "channels": { "Stable": { "downloads": { "chrome-headless-shell": [
            { "platform": "mac-arm64", "url": "https://x/mac-arm64/chrome-headless-shell-mac-arm64.zip" },
            { "platform": "win64", "url": "https://x/win64/chrome-headless-shell-win64.zip" }
        ] } } } });
        assert_eq!(download_url(&idx, "win64").unwrap(), "https://x/win64/chrome-headless-shell-win64.zip");
        assert!(download_url(&idx, "linux64").is_none());
        assert!(installed(Path::new("/nao/existe")).is_none());
    }
}
