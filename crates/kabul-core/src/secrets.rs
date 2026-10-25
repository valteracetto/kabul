//! Segredos do app (chave do Linear, token do GitHub) no cofre do sistema.
//!
//! Windows e Linux: crate `keyring` (Credential Manager / Secret Service), serviço `<service>` e conta
//! `kabul`. macOS: o mesmo item do Keychain pelo `security` (serviço + conta `kabul`), como antes: o
//! acesso fica liberado para o `/usr/bin/security`, então trocar o binário do app (cada build de
//! desenvolvimento) não pede a senha do Keychain de novo.
use anyhow::Result;

const ACCOUNT: &str = "kabul";

/// macOS: [`crate::keychain`] (o segredo vai pelo stdin do `security -i`, nunca na linha de comando).
#[cfg(target_os = "macos")]
pub fn get(service: &str) -> Option<String> {
    crate::keychain::get(service)
}

#[cfg(target_os = "macos")]
pub fn set(service: &str, value: &str) -> Result<()> {
    crate::keychain::set(service, ACCOUNT, value)
}

#[cfg(target_os = "macos")]
pub fn delete(service: &str) {
    crate::keychain::delete(service)
}

#[cfg(not(target_os = "macos"))]
fn entry(service: &str) -> Result<keyring::Entry> {
    use anyhow::Context;
    keyring::Entry::new(service, ACCOUNT).context("cofre do sistema")
}

#[cfg(not(target_os = "macos"))]
pub fn get(service: &str) -> Option<String> {
    entry(service).ok()?.get_password().ok().map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
}

#[cfg(not(target_os = "macos"))]
pub fn set(service: &str, value: &str) -> Result<()> {
    use anyhow::Context;
    entry(service)?.set_password(value.trim()).context("gravando no cofre do sistema")
}

#[cfg(not(target_os = "macos"))]
pub fn delete(service: &str) {
    if let Ok(e) = entry(service) {
        let _ = e.delete_credential();
    }
}

#[cfg(test)]
mod tests {
    /// Grava, lê e apaga no cofre real (só quando pedido: `KABUL_TEST_COFRE=1`, para não mexer no cofre
    /// do usuário em toda execução).
    #[test]
    fn ida_e_volta() {
        if std::env::var("KABUL_TEST_COFRE").is_err() {
            return;
        }
        let svc = format!("kabul-test-{}", std::process::id());
        super::set(&svc, "segredo-1").unwrap();
        assert_eq!(super::get(&svc).as_deref(), Some("segredo-1"));
        super::delete(&svc);
        assert_eq!(super::get(&svc), None);
    }
}
