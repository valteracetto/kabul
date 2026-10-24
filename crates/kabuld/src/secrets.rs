//! Onde o kabuld guarda segredos (hash da credencial de cada dispositivo, chave VAPID do push).
//!
//! Padrão: cofre do sistema pela crate `keyring` (Keychain no macOS, Credential Manager no Windows,
//! Secret Service no Linux). Para testes e máquinas sem cofre: arquivo `secrets.json` com permissão
//! 0600 (`KABULD_SECRETS=file`) ou memória.
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, value: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
    fn kind(&self) -> &'static str;
}

/// Cofre do sistema. `service` separa instâncias (ex.: `kabuld` e `kabuld-dev`).
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: &str) -> Self {
        Self { service: service.into() }
    }
    fn entry(&self, key: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service, key).context("cofre do sistema")
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        match self.entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e).context("lendo do cofre do sistema"),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.entry(key)?.set_password(value).context("gravando no cofre do sistema")
    }
    fn delete(&self, key: &str) -> Result<()> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e).context("apagando do cofre do sistema"),
        }
    }
    fn kind(&self) -> &'static str {
        "keyring"
    }
}

/// Arquivo JSON com permissão 0600 (testes, CI, servidores sem cofre).
pub struct FileStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl FileStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path, lock: Mutex::new(()) }
    }
    fn load(&self) -> HashMap<String, String> {
        std::fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    fn save(&self, m: &HashMap<String, String>) -> Result<()> {
        if let Some(d) = self.path.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&self.path, serde_json::to_vec_pretty(m)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }
}

impl SecretStore for FileStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        let _g = self.lock.lock().unwrap();
        Ok(self.load().get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let mut m = self.load();
        m.insert(key.into(), value.into());
        self.save(&m)
    }
    fn delete(&self, key: &str) -> Result<()> {
        let _g = self.lock.lock().unwrap();
        let mut m = self.load();
        m.remove(key);
        self.save(&m)
    }
    fn kind(&self) -> &'static str {
        "file"
    }
}

#[derive(Default)]
pub struct MemStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemStore {
    fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<()> {
        self.0.lock().unwrap().insert(key.into(), value.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.0.lock().unwrap().remove(key);
        Ok(())
    }
    fn kind(&self) -> &'static str {
        "memory"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arquivo_com_0600() {
        let dir = std::env::temp_dir().join(format!("kabuld-secrets-{}", std::process::id()));
        let s = FileStore::new(dir.join("secrets.json"));
        assert_eq!(s.get("a").unwrap(), None);
        s.set("a", "1").unwrap();
        assert_eq!(s.get("a").unwrap().as_deref(), Some("1"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(dir.join("secrets.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        s.delete("a").unwrap();
        assert_eq!(s.get("a").unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
