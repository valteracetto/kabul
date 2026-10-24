//! Notificações Web Push (VAPID + aes128gcm, RFC 8291/8292) quando um agente fica esperando você
//! ou termina o turno. A chave VAPID fica no cofre ([`crate::secrets`]); as inscrições, num arquivo
//! 0600. No iPhone, o push só funciona com a PWA instalada na tela de início e servida por HTTPS.
use crate::auth::Scope;
use crate::bus::Bus;
use crate::secrets::SecretStore;
use anyhow::{Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use web_push_native::jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair};
use web_push_native::p256;
use web_push_native::{Auth, WebPushBuilder};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Subscription {
    pub device_id: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub scope: Scope,
}

pub struct Push {
    file: PathBuf,
    keypair: ES256KeyPair,
    subject: String,
    subs: Mutex<Vec<Subscription>>,
}

fn b64d(s: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).context("base64")
}

impl Push {
    pub fn open(home: &std::path::Path, secrets: &Arc<dyn SecretStore>) -> Result<Self> {
        let keypair = match secrets.get("vapid")?.and_then(|k| b64d(&k).ok()).and_then(|b| ES256KeyPair::from_bytes(&b).ok()) {
            Some(k) => k,
            None => {
                let k = ES256KeyPair::generate();
                secrets.set("vapid", &URL_SAFE_NO_PAD.encode(k.to_bytes()))?;
                k
            }
        };
        let file = home.join("kabuld-push.json");
        let subs = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let subject = std::env::var("KABULD_VAPID_SUBJECT").unwrap_or_else(|_| "mailto:kabuld@users.noreply.github.com".into());
        Ok(Self { file, keypair, subject, subs: Mutex::new(subs) })
    }

    /// Chave pública (ponto não comprimido, base64url) para `PushManager.subscribe`.
    pub fn public_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.keypair.public_key().public_key().to_bytes_uncompressed())
    }

    fn save(&self, subs: &[Subscription]) -> Result<()> {
        std::fs::write(&self.file, serde_json::to_vec_pretty(subs)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.file, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    /// Guarda a inscrição do navegador (`{endpoint, keys: {p256dh, auth}}`).
    pub fn subscribe(&self, device_id: &str, scope: Scope, sub: &Value) -> Result<()> {
        let endpoint = sub["endpoint"].as_str().context("endpoint")?.to_string();
        if !endpoint.starts_with("https://") {
            anyhow::bail!("endpoint de push precisa ser https");
        }
        let s = Subscription { device_id: device_id.into(), endpoint, p256dh: sub["keys"]["p256dh"].as_str().context("p256dh")?.into(), auth: sub["keys"]["auth"].as_str().context("auth")?.into(), scope };
        build(&s, &self.keypair, &self.subject, b"teste")?; // valida as chaves agora
        let mut subs = self.subs.lock().unwrap();
        subs.retain(|x| x.endpoint != s.endpoint);
        subs.push(s);
        self.save(&subs)
    }

    pub fn unsubscribe_device(&self, device_id: &str) {
        let mut subs = self.subs.lock().unwrap();
        subs.retain(|x| x.device_id != device_id);
        let _ = self.save(&subs);
    }

    pub fn count(&self) -> usize {
        self.subs.lock().unwrap().len()
    }

    /// Envia para todas as inscrições que podem ver o workspace. Rede em outra thread.
    pub fn notify(self: &Arc<Self>, title: &str, body: &str, url: &str, tag: &str, workspace: Option<&str>) {
        let targets: Vec<Subscription> = self.subs.lock().unwrap().iter().filter(|s| s.scope.allows_workspace(workspace) || s.scope == Scope::All).cloned().collect();
        if targets.is_empty() {
            return;
        }
        let payload = json!({ "title": title, "body": body, "url": url, "tag": tag }).to_string();
        let me = self.clone();
        std::thread::spawn(move || {
            for s in targets {
                match build(&s, &me.keypair, &me.subject, payload.as_bytes()).and_then(send) {
                    Ok(404) | Ok(410) => {
                        let mut subs = me.subs.lock().unwrap();
                        subs.retain(|x| x.endpoint != s.endpoint);
                        let _ = me.save(&subs);
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("kabuld: push falhou: {e:#}"),
                }
            }
        });
    }
}

/// Monta a requisição cifrada e assinada (testável sem rede).
pub fn build(s: &Subscription, kp: &ES256KeyPair, subject: &str, body: &[u8]) -> Result<http::Request<Vec<u8>>> {
    let key = p256::PublicKey::from_sec1_bytes(&b64d(&s.p256dh)?).context("p256dh inválida")?;
    let auth_b = b64d(&s.auth)?;
    if auth_b.len() != 16 {
        anyhow::bail!("auth inválido");
    }
    let auth = Auth::clone_from_slice(&auth_b);
    let req = WebPushBuilder::new(s.endpoint.parse().context("endpoint")?, key, auth).with_vapid(kp, subject).build(body.to_vec()).map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(req)
}

fn send(req: http::Request<Vec<u8>>) -> Result<u16> {
    let mut r = ureq::request(req.method().as_str(), &req.uri().to_string());
    for (k, v) in req.headers() {
        r = r.set(k.as_str(), v.to_str().unwrap_or_default());
    }
    match r.send_bytes(req.body()) {
        Ok(resp) => Ok(resp.status()),
        Err(ureq::Error::Status(code, _)) => Ok(code),
        Err(e) => Err(e.into()),
    }
}

/// Observa `session-status` e notifica nas transições: → esperando você, e trabalhando → ocioso
/// (agente terminou). No máximo uma notificação por sessão a cada 20 s.
pub fn spawn_notifier(bus: &Bus, push: Arc<Push>) {
    let mut rx = bus.subscribe();
    std::thread::spawn(move || {
        let mut last: HashMap<String, String> = HashMap::new();
        let mut sent_at: HashMap<String, u64> = HashMap::new();
        loop {
            let ev = match rx.blocking_recv() {
                Ok(e) => e,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => return,
            };
            if ev.channel != "session-status" {
                continue;
            }
            let p = &ev.payload;
            let id = p["id"].as_str().unwrap_or_default().to_string();
            let status = p["status"].as_str().unwrap_or_default().to_string();
            let agent = p["agent"].as_str().unwrap_or("agente");
            let title = p["title"].as_str().unwrap_or(&id).to_string();
            let now = crate::auth::now();
            let prev = last.insert(id.clone(), status.clone()).unwrap_or_default();
            if status == prev || sent_at.get(&id).map(|t| now.saturating_sub(*t) < 20).unwrap_or(false) {
                continue;
            }
            let url = format!("/m/#s={}", id);
            if status == "waiting" || (status == "idle" && prev == "working" && agent != "shell") {
                sent_at.insert(id.clone(), now);
            }
            if status == "waiting" {
                let body = p["detail"].as_str().unwrap_or("Precisa de uma decisão sua.").to_string();
                push.notify(&format!("{title} está esperando você"), &body, &url, &id, ev.workspace.as_deref());
            } else if status == "idle" && prev == "working" && agent != "shell" {
                push.notify(&format!("{title} terminou"), "O agente concluiu o turno.", &url, &id, ev.workspace.as_deref());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemStore;

    #[test]
    fn chave_persistente_e_requisicao_cifrada() {
        let dir = std::env::temp_dir().join(format!("kabuld-push-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let secrets: Arc<dyn SecretStore> = Arc::new(MemStore::default());
        let p = Push::open(&dir, &secrets).unwrap();
        let p2 = Push::open(&dir, &secrets).unwrap();
        assert_eq!(p.public_key(), p2.public_key(), "a chave VAPID persiste");
        assert_eq!(b64d(&p.public_key()).unwrap().len(), 65);
        // Inscrição sintética: chave do "navegador" gerada aqui.
        let ua = ES256KeyPair::generate();
        let ua_pub = URL_SAFE_NO_PAD.encode(ua.public_key().public_key().to_bytes_uncompressed());
        let sub = json!({"endpoint": "https://push.example.test/abc", "keys": {"p256dh": ua_pub, "auth": URL_SAFE_NO_PAD.encode([7u8; 16])}});
        p.subscribe("d1", Scope::All, &sub).unwrap();
        assert_eq!(p.count(), 1);
        assert!(p.subscribe("d1", Scope::All, &json!({"endpoint": "http://inseguro"})).is_err());
        let s = p.subs.lock().unwrap()[0].clone();
        let req = build(&s, &p.keypair, &p.subject, b"oi").unwrap();
        assert_eq!(req.headers()["content-encoding"], "aes128gcm");
        assert!(req.headers()["authorization"].to_str().unwrap().starts_with("vapid t="));
        assert!(req.body().len() > 2 + 86);
        p.unsubscribe_device("d1");
        assert_eq!(p.count(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }
}
