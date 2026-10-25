//! Segredos do app (token do GitHub, chave do Linear) no Keychain do macOS pelo `security`.
//!
//! O segredo nunca vai na linha de comando: `security add-generic-password -w <segredo>` deixaria o
//! valor visível em `ps` para qualquer usuário da máquina. A gravação usa `security -i` com o
//! comando pela entrada padrão.
use anyhow::{bail, Context, Result};
use std::io::Write;
use std::process::{Command, Stdio};

/// Tokens de API são ASCII imprimível sem espaço, aspas ou barra invertida. Recusar o resto evita
/// qualquer escape na linha do `security -i` (e pega colagens com lixo).
pub fn valid_secret(s: &str) -> bool {
    !s.is_empty() && s.len() <= 4096 && s.bytes().all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
}

/// Linha enviada ao `security -i` (testável sem Keychain).
pub fn add_command(service: &str, account: &str, secret: &str) -> Result<String> {
    for (what, v) in [("serviço", service), ("conta", account), ("segredo", secret)] {
        if !valid_secret(v) {
            bail!("{what} com caracteres inválidos (cole só o token, sem espaços ou aspas)");
        }
    }
    Ok(format!("add-generic-password -U -s \"{service}\" -a \"{account}\" -w \"{secret}\"\n"))
}

pub fn get(service: &str) -> Option<String> {
    let o = Command::new("security").args(["find-generic-password", "-s", service, "-w"]).output().ok()?;
    let k = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !k.is_empty()).then_some(k)
}

pub fn set(service: &str, account: &str, secret: &str) -> Result<()> {
    let line = add_command(service, account, secret.trim())?;
    let mut child = Command::new("security").arg("-i").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().context("security")?;
    child.stdin.take().context("stdin")?.write_all(line.as_bytes())?;
    let o = child.wait_with_output()?;
    let err = String::from_utf8_lossy(&o.stderr);
    if !o.status.success() || err.contains("error") {
        bail!("Keychain: {}", err.trim());
    }
    Ok(())
}

pub fn delete(service: &str) {
    let _ = Command::new("security").args(["delete-generic-password", "-s", service]).output();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segredo_fora_da_linha_de_comando() {
        let l = add_command("kabul-github", "kabul", "ghp_abcDEF123_x").unwrap();
        assert_eq!(l, "add-generic-password -U -s \"kabul-github\" -a \"kabul\" -w \"ghp_abcDEF123_x\"\n");
        for bad in ["", "a b", "a\"; delete-keychain", "a\\b", "a\nb", "ção"] {
            assert!(add_command("s", "a", bad).is_err(), "{bad:?}");
        }
    }

    /// Grava e lê de verdade num item de teste (só macOS com Keychain destravado; pula no CI).
    #[test]
    fn grava_pelo_stdin() {
        if !cfg!(target_os = "macos") || std::env::var_os("KABUL_TEST_KEYCHAIN").is_none() {
            return;
        }
        let svc = format!("kabul-test-{}", std::process::id());
        set(&svc, "kabul", "tok_123").unwrap();
        assert_eq!(get(&svc).as_deref(), Some("tok_123"));
        delete(&svc);
        assert_eq!(get(&svc), None);
    }
}
