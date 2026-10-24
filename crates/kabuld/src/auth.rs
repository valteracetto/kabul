//! Pareamento e credenciais por dispositivo.
//!
//! - **Ingresso** (`issue`): token aleatório de curta duração e uso único, mostrado num QR code (pareamento
//!   do dono) ou num link de convite (amigo, com papel e escopo de um workspace).
//! - **Resgate** (`redeem`): troca o ingresso por uma credencial do dispositivo (`id` + `key`). O kabuld
//!   guarda só o SHA-256 da chave, no cofre do sistema ([`crate::secrets`]); o dispositivo guarda a chave.
//! - **Revogar** apaga o hash: a credencial deixa de valer e as conexões abertas caem.
use crate::secrets::SecretStore;
use anyhow::{bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Dono da máquina: tudo, inclusive parear, convidar e revogar.
    Owner,
    /// Convidado que manda mensagens, aprova e digita no terminal.
    Editor,
    /// Convidado que só acompanha.
    Observer,
}

impl Role {
    pub fn can_write(self) -> bool {
        matches!(self, Role::Owner | Role::Editor)
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Role::Owner),
            "editor" => Some(Role::Editor),
            "observer" | "observador" => Some(Role::Observer),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Scope {
    All,
    Workspace { id: String },
}

impl Scope {
    pub fn allows_workspace(&self, ws: Option<&str>) -> bool {
        match self {
            Scope::All => true,
            Scope::Workspace { id } => ws == Some(id.as_str()),
        }
    }
    pub fn workspace(&self) -> Option<&str> {
        match self {
            Scope::All => None,
            Scope::Workspace { id } => Some(id),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    /// Nome da pessoa (aparece como autor das mensagens e na presença).
    pub user: String,
    /// Aparelho ("iPhone", "Mac do escritório"...).
    pub name: String,
    pub role: Role,
    pub scope: Scope,
    pub color: String,
    pub created_at: u64,
    #[serde(default)]
    pub last_seen: Option<u64>,
}

/// Quem está do outro lado de uma conexão.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Principal {
    /// Id do dispositivo, ou `local` para o dono conectado pelo localhost.
    pub id: String,
    pub user: String,
    pub device: String,
    pub role: Role,
    pub scope: Scope,
    pub color: String,
}

impl Principal {
    pub fn local_owner(user: &str) -> Self {
        Self { id: "local".into(), user: user.into(), device: "mac".into(), role: Role::Owner, scope: Scope::All, color: COLORS[0].into() }
    }
    pub fn is_owner(&self) -> bool {
        self.role == Role::Owner
    }
}

/// Ingresso emitido (o token só existe aqui; o kabuld guarda o hash).
#[derive(Debug, Clone, Serialize)]
pub struct Ticket {
    pub token: String,
    pub expires_at: u64,
    pub role: Role,
    pub scope: Scope,
}

struct Pending {
    hash: String,
    expires_at: u64,
    role: Role,
    scope: Scope,
}

const COLORS: [&str; 8] = ["#7c8cff", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#d946ef", "#84cc16", "#f97316"];

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn random_token(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

pub fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Comparação em tempo constante (o tamanho do hash é fixo).
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub struct Auth {
    file: PathBuf,
    secrets: Arc<dyn SecretStore>,
    devices: Mutex<Vec<Device>>,
    /// Cache id → hash (evita ir ao cofre a cada conexão).
    hashes: Mutex<HashMap<String, String>>,
    pending: Mutex<Vec<Pending>>,
}

impl Auth {
    pub fn open(home: &std::path::Path, secrets: Arc<dyn SecretStore>) -> Result<Self> {
        let file = home.join("kabuld-devices.json");
        let devices: Vec<Device> = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Ok(Self { file, secrets, devices: Mutex::new(devices), hashes: Mutex::new(HashMap::new()), pending: Mutex::new(vec![]) })
    }

    pub fn secrets_kind(&self) -> &'static str {
        self.secrets.kind()
    }

    fn save(&self, devices: &[Device]) -> Result<()> {
        if let Some(d) = self.file.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(&self.file, serde_json::to_vec_pretty(devices)?).context("gravando dispositivos")
    }

    /// Emite um ingresso de uso único válido por `ttl` segundos.
    pub fn issue(&self, role: Role, scope: Scope, ttl: u64) -> Ticket {
        let token = random_token(18);
        let expires_at = now() + ttl;
        let mut p = self.pending.lock().unwrap();
        let t = now();
        p.retain(|x| x.expires_at > t);
        p.push(Pending { hash: sha256_hex(&token), expires_at, role, scope: scope.clone() });
        Ticket { token, expires_at, role, scope }
    }

    /// Ingressos ainda válidos (sem o token).
    pub fn pending_count(&self) -> usize {
        let t = now();
        self.pending.lock().unwrap().iter().filter(|p| p.expires_at > t).count()
    }

    /// Cancela todos os ingressos de pareamento do dono (ao regenerar o QR, o antigo deixa de valer).
    pub fn cancel_owner_tickets(&self) {
        self.pending.lock().unwrap().retain(|p| p.role != Role::Owner);
    }

    /// Troca o ingresso por uma credencial nova. Devolve o dispositivo e a chave (mostrada uma vez só).
    pub fn redeem(&self, token: &str, user: &str, name: &str) -> Result<(Device, String)> {
        let h = sha256_hex(token.trim());
        let t = now();
        let pend = {
            let mut p = self.pending.lock().unwrap();
            p.retain(|x| x.expires_at > t);
            let i = p.iter().position(|x| same(&x.hash, &h)).context("código de pareamento inválido ou expirado")?;
            p.remove(i)
        };
        let key = random_token(32);
        let mut devices = self.devices.lock().unwrap();
        let id = format!("d_{}", random_token(9));
        let user = clean(user, 40).unwrap_or_else(|| if pend.role == Role::Owner { "Você".into() } else { "Convidado".into() });
        let name = clean(name, 40).unwrap_or_else(|| "Aparelho".into());
        let color = COLORS[(devices.len() + 1) % COLORS.len()].to_string();
        let d = Device { id: id.clone(), user, name, role: pend.role, scope: pend.scope, color, created_at: t, last_seen: Some(t) };
        let hash = sha256_hex(&key);
        self.secrets.set(&format!("device:{id}"), &hash)?;
        self.hashes.lock().unwrap().insert(id.clone(), hash);
        devices.push(d.clone());
        self.save(&devices)?;
        Ok((d, key))
    }

    /// Confere a credencial. `None` se não existe, foi revogada ou a chave não bate.
    pub fn verify(&self, id: &str, key: &str) -> Option<Principal> {
        let d = self.devices.lock().unwrap().iter().find(|d| d.id == id).cloned()?;
        let stored = {
            let cached = self.hashes.lock().unwrap().get(id).cloned();
            match cached {
                Some(h) => h,
                None => {
                    let h = self.secrets.get(&format!("device:{id}")).ok().flatten()?;
                    self.hashes.lock().unwrap().insert(id.into(), h.clone());
                    h
                }
            }
        };
        if !same(&stored, &sha256_hex(key)) {
            return None;
        }
        self.touch(id);
        Some(Principal { id: d.id, user: d.user, device: d.name, role: d.role, scope: d.scope, color: d.color })
    }

    fn touch(&self, id: &str) {
        let mut devices = self.devices.lock().unwrap();
        if let Some(d) = devices.iter_mut().find(|d| d.id == id) {
            let t = now();
            // Grava no máximo uma vez por minuto.
            if d.last_seen.map(|l| t.saturating_sub(l) > 60).unwrap_or(true) {
                d.last_seen = Some(t);
                let _ = self.save(&devices);
            }
        }
    }

    pub fn list(&self) -> Vec<Device> {
        self.devices.lock().unwrap().clone()
    }

    pub fn revoke(&self, id: &str) -> Result<()> {
        let mut devices = self.devices.lock().unwrap();
        let before = devices.len();
        devices.retain(|d| d.id != id);
        if devices.len() == before {
            bail!("dispositivo não encontrado");
        }
        self.hashes.lock().unwrap().remove(id);
        self.secrets.delete(&format!("device:{id}"))?;
        self.save(&devices)
    }

    pub fn rename(&self, id: &str, user: Option<&str>, name: Option<&str>) -> Result<Device> {
        let mut devices = self.devices.lock().unwrap();
        let d = devices.iter_mut().find(|d| d.id == id).context("dispositivo não encontrado")?;
        if let Some(u) = user.and_then(|u| clean(u, 40)) {
            d.user = u;
        }
        if let Some(n) = name.and_then(|n| clean(n, 40)) {
            d.name = n;
        }
        let out = d.clone();
        self.save(&devices)?;
        Ok(out)
    }
}

fn clean(s: &str, max: usize) -> Option<String> {
    let t: String = s.chars().filter(|c| !c.is_control()).take(max).collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemStore;

    fn auth() -> (Auth, PathBuf) {
        let dir = std::env::temp_dir().join(format!("kabuld-auth-{}-{}", std::process::id(), random_token(4)));
        (Auth::open(&dir, Arc::new(MemStore::default())).unwrap(), dir)
    }

    #[test]
    fn pareamento_uso_unico() {
        let (a, dir) = auth();
        let t = a.issue(Role::Owner, Scope::All, 300);
        let (d, key) = a.redeem(&t.token, "Dev", "iPhone").unwrap();
        assert_eq!(d.role, Role::Owner);
        assert!(a.redeem(&t.token, "Outro", "x").is_err(), "token vale uma vez só");
        let p = a.verify(&d.id, &key).unwrap();
        assert_eq!((p.user.as_str(), p.device.as_str()), ("Dev", "iPhone"));
        assert!(a.verify(&d.id, "chave-errada").is_none());
        // O arquivo guarda metadados, nunca a chave.
        let raw = std::fs::read_to_string(dir.join("kabuld-devices.json")).unwrap();
        assert!(!raw.contains(&key));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expira_e_revoga() {
        let (a, dir) = auth();
        let t = a.issue(Role::Owner, Scope::All, 0);
        std::thread::sleep(std::time::Duration::from_millis(1100));
        assert!(a.redeem(&t.token, "", "").is_err(), "expirado");
        let t = a.issue(Role::Editor, Scope::Workspace { id: "w1".into() }, 60);
        let (d, key) = a.redeem(&t.token, "", "").unwrap();
        assert_eq!(d.user, "Convidado");
        assert_eq!(d.scope, Scope::Workspace { id: "w1".into() });
        a.revoke(&d.id).unwrap();
        assert!(a.verify(&d.id, &key).is_none());
        assert!(a.revoke(&d.id).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn regenerar_invalida_o_qr_antigo() {
        let (a, dir) = auth();
        let old = a.issue(Role::Owner, Scope::All, 300);
        let invite = a.issue(Role::Observer, Scope::Workspace { id: "w".into() }, 300);
        a.cancel_owner_tickets();
        assert!(a.redeem(&old.token, "", "").is_err());
        assert!(a.redeem(&invite.token, "", "").is_ok(), "convites seguem valendo");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn escopo() {
        let s = Scope::Workspace { id: "w".into() };
        assert!(s.allows_workspace(Some("w")) && !s.allows_workspace(Some("x")) && !s.allows_workspace(None));
        assert!(Scope::All.allows_workspace(None));
    }
}
