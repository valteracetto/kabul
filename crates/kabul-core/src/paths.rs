//! Pastas do usuário por plataforma. No Windows não há `HOME` (é `USERPROFILE`) e o estado do app vai
//! para `%APPDATA%`; no macOS fica em Application Support; no Linux, em `$XDG_DATA_HOME`.
use std::path::{Path, PathBuf};

/// Pasta pessoal: `HOME`, depois `USERPROFILE` (Windows).
pub fn home() -> PathBuf {
    std::env::var_os("HOME").filter(|h| !h.is_empty()).or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

/// Pasta do estado do Kabul (state.json, settings, logs).
pub fn state_dir() -> PathBuf {
    state_dir_for(std::env::consts::OS, &home(), std::env::var_os("APPDATA").map(PathBuf::from), std::env::var_os("XDG_DATA_HOME").map(PathBuf::from))
}

/// Regra de [`state_dir`] (testável em qualquer sistema).
pub fn state_dir_for(os: &str, home: &Path, appdata: Option<PathBuf>, xdg_data: Option<PathBuf>) -> PathBuf {
    match os {
        "macos" => home.join("Library/Application Support/kabul"),
        "windows" => appdata.unwrap_or_else(|| home.join("AppData").join("Roaming")).join("kabul"),
        _ => xdg_data.filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(".local/share")).join("kabul"),
    }
}

/// Expande `~` no começo de um caminho.
pub fn expand_tilde(p: &str) -> String {
    match p.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') || rest.starts_with('\\') => format!("{}{rest}", home().display()),
        _ => p.to_string(),
    }
}

/// Nomes reservados do Windows (valem com qualquer extensão: `con.txt` também).
const RESERVED: &[&str] = &["con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"];

/// Nome de arquivo válido em qualquer sistema: troca `<>:"/\|?*` e controles por `_`, tira pontos e
/// espaços do fim (o Windows os descarta) e evita os nomes reservados (`CON`, `NUL`, `COM1`...).
pub fn safe_file_name(name: &str) -> String {
    let mut s: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    while s.ends_with('.') || s.ends_with(' ') {
        s.pop();
    }
    let s = s.trim_start().to_string();
    if s.is_empty() || s == "." || s == ".." {
        return "arquivo".into();
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return format!("_{s}");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasta_do_estado() {
        let h = Path::new("/home/dev");
        assert_eq!(state_dir_for("macos", h, None, None), PathBuf::from("/home/dev/Library/Application Support/kabul"));
        assert_eq!(state_dir_for("windows", h, Some("C:/Users/dev/AppData/Roaming".into()), None), PathBuf::from("C:/Users/dev/AppData/Roaming/kabul"));
        assert_eq!(state_dir_for("linux", h, None, None), PathBuf::from("/home/dev/.local/share/kabul"));
        // `is_absolute` segue o sistema que roda o teste: no Windows, `/x/data` não tem unidade.
        let xdg = if cfg!(windows) { "C:/x/data" } else { "/x/data" };
        assert_eq!(state_dir_for("linux", h, None, Some(xdg.into())), Path::new(xdg).join("kabul"));
        assert_eq!(state_dir_for("linux", h, None, Some("relativo".into())), PathBuf::from("/home/dev/.local/share/kabul"));
    }

    #[test]
    fn nomes_validos() {
        assert_eq!(safe_file_name("print: 1/2?.png"), "print_ 1_2_.png");
        assert_eq!(safe_file_name("nota. "), "nota");
        assert_eq!(safe_file_name("CON"), "_CON");
        assert_eq!(safe_file_name("nul.txt"), "_nul.txt");
        assert_eq!(safe_file_name("console.log"), "console.log");
        assert_eq!(safe_file_name(".."), "arquivo");
        assert_eq!(safe_file_name("[LINEAR]-ABC-1.md"), "[LINEAR]-ABC-1.md");
    }
}
