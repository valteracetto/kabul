//! O que o app pode entregar ao `open` do macOS. Os links vêm de texto que o Kabul não controla
//! (resposta do agente, issue do Linear, PR, saída do `gh`): `open` com `file://`, um `.app`, um
//! `.command` ou um esquema qualquer (`x-apple...:`, `smb:`) abriria ou executaria coisas locais.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

/// Só `http(s)://` e `mailto:`; sem espaço nem caractere de controle (nada de virar outra opção).
pub fn external_url_ok(target: &str) -> bool {
    let t = target.trim();
    let lower = t.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://")).or_else(|| lower.strip_prefix("mailto:"));
    let scheme_ok = rest.map(|r| !r.is_empty() && !r.starts_with('/')).unwrap_or(false);
    scheme_ok && t.len() <= 8192 && !t.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Pasta (ou arquivo, para editores e Finder) a abrir num app: caminho absoluto que existe, já
/// resolvido (sem `..` nem link simbólico). Terminais só recebem pasta: um arquivo `.command` ou
/// `.sh` aberto no Terminal roda.
pub fn open_in_path(path: &str, kind: &str) -> Result<PathBuf> {
    let p = Path::new(path);
    if !p.is_absolute() {
        bail!("caminho precisa ser absoluto");
    }
    let real = std::fs::canonicalize(p).with_context(|| format!("{path} não existe"))?;
    if kind == "terminal" && !real.is_dir() {
        bail!("o terminal só abre pastas");
    }
    // Windows: o canonicalize devolve `\\?\C:\...`, que vários apps (Explorer, wt, Git Bash) não aceitam.
    #[cfg(windows)]
    let real = match real.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => real,
    };
    Ok(real)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_links_da_web() {
        for ok in ["https://github.com/x/y/pull/1", "http://localhost:41000", "mailto:a@b.c", "HTTPS://linear.app/x"] {
            assert!(external_url_ok(ok), "{ok}");
        }
        for bad in [
            "file:///Applications/Calculator.app",
            "/tmp/x.command",
            "x-apple.systempreferences:com.apple.preference",
            "smb://host/share",
            "-a Calculator",
            "https://",
            "javascript:alert(1)",
            "https://a b",
            "https://a\nb",
            "vscode://file/etc/passwd",
            "",
        ] {
            assert!(!external_url_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn abrir_em_so_pasta_real() {
        let dir = std::env::temp_dir().join(format!("kabul-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("rode.command");
        std::fs::write(&f, "echo oi").unwrap();
        assert!(open_in_path(dir.to_str().unwrap(), "terminal").is_ok());
        assert!(open_in_path(f.to_str().unwrap(), "terminal").is_err(), "arquivo no terminal executa");
        assert!(open_in_path(f.to_str().unwrap(), "editor").is_ok());
        assert!(open_in_path("relativo/x", "editor").is_err());
        assert!(open_in_path("-a", "finder").is_err());
        assert!(open_in_path(&format!("{}/nao-existe", dir.display()), "finder").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
