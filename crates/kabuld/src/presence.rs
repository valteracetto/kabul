//! Presença na colaboração em tempo real: quem está conectado em cada workspace, o que está vendo
//! (chat ou terminal) e quem está digitando. Vive só na memória; some quando a conexão cai.
use crate::auth::{Principal, Role};
use crate::bus::Bus;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Present {
    pub conn: u64,
    pub id: String,
    pub name: String,
    pub device: String,
    pub color: String,
    pub role: Role,
    pub workspace: Option<String>,
    /// `chat:<id>` ou `tmux:<sessão>`.
    pub target: Option<String>,
    pub typing: bool,
    #[serde(skip)]
    pub typing_until: u64,
}

pub struct Presence {
    bus: Bus,
    conns: Mutex<HashMap<u64, Present>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Presence {
    pub fn new(bus: Bus) -> Self {
        Self { bus, conns: Mutex::new(HashMap::new()) }
    }

    /// Atualiza a presença da conexão. `typing` vale por 5 s (o cliente repete enquanto digita).
    pub fn set(&self, conn: u64, who: &Principal, workspace: Option<String>, target: Option<String>, typing: bool) {
        let old_ws = {
            let mut m = self.conns.lock().unwrap();
            let old = m.get(&conn).and_then(|p| p.workspace.clone());
            m.insert(conn, Present { conn, id: who.id.clone(), name: who.user.clone(), device: who.device.clone(), color: who.color.clone(), role: who.role, workspace: workspace.clone(), target, typing, typing_until: if typing { now_ms() + 5000 } else { 0 } });
            old
        };
        if old_ws != workspace {
            if let Some(w) = old_ws {
                self.broadcast(&w);
            }
        }
        if let Some(w) = workspace {
            self.broadcast(&w);
        }
    }

    pub fn remove(&self, conn: u64) {
        let ws = self.conns.lock().unwrap().remove(&conn).and_then(|p| p.workspace);
        if let Some(w) = ws {
            self.broadcast(&w);
        }
    }

    pub fn list(&self, workspace: &str) -> Vec<Present> {
        let t = now_ms();
        let mut v: Vec<Present> = self
            .conns
            .lock()
            .unwrap()
            .values()
            .filter(|p| p.workspace.as_deref() == Some(workspace))
            .cloned()
            .map(|mut p| {
                p.typing = p.typing && p.typing_until > t;
                p
            })
            .collect();
        v.sort_by_key(|p| p.conn);
        v
    }

    fn broadcast(&self, workspace: &str) {
        self.bus.emit("presence", json!({ "workspace_id": workspace, "users": self.list(workspace) }), Some(workspace.into()), None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::Scope;

    #[test]
    fn entra_digita_e_sai() {
        let bus = Bus::new();
        let mut rx = bus.subscribe();
        let p = Presence::new(bus);
        let ana = Principal { id: "d1".into(), user: "Ana".into(), device: "iPhone".into(), role: Role::Owner, scope: Scope::All, color: "#f00".into() };
        let bia = Principal { id: "d2".into(), user: "Bia".into(), device: "Mac".into(), role: Role::Observer, scope: Scope::Workspace { id: "w".into() }, color: "#0f0".into() };
        p.set(1, &ana, Some("w".into()), Some("chat:c1".into()), false);
        p.set(2, &bia, Some("w".into()), None, true);
        let l = p.list("w");
        assert_eq!(l.len(), 2);
        assert!(l[1].typing && !l[0].typing);
        p.remove(2);
        assert_eq!(p.list("w").len(), 1);
        let mut last = None;
        while let Ok(e) = rx.try_recv() {
            last = Some(e);
        }
        assert_eq!(last.unwrap().payload["users"].as_array().unwrap().len(), 1);
    }
}
