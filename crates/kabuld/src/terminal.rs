//! Terminais compartilhados: um cliente `tmux -C` por sessão, seja quantos forem os espectadores
//! (desktop, celular, amigo). A saída vai para o barramento como `term-output`; a entrada é
//! `send-keys -H` (bytes exatos). Ver docs/windows.md: no Windows entra um backend ConPTY.
use crate::bus::Bus;
use anyhow::{Context, Result};
use kabul_core::tmux::{self, stream::TermStream};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct TermInfo {
    pub session: String,
    pub pane: String,
    pub snapshot: String,
    pub cols: u16,
    pub rows: u16,
}

pub struct TermHub {
    bus: Bus,
    streams: Arc<Mutex<HashMap<String, TermStream>>>,
}

/// Bytes de cada tecla da barra do celular.
pub fn key_bytes(key: &str) -> Option<&'static [u8]> {
    Some(match key {
        "Escape" | "Esc" => b"\x1b",
        "C-c" | "CtrlC" => b"\x03",
        "C-d" => b"\x04",
        "C-z" => b"\x1a",
        "C-l" => b"\x0c",
        "C-r" => b"\x12",
        "Tab" => b"\t",
        "BTab" | "S-Tab" => b"\x1b[Z",
        "Enter" => b"\r",
        "Up" => b"\x1b[A",
        "Down" => b"\x1b[B",
        "Right" => b"\x1b[C",
        "Left" => b"\x1b[D",
        "BSpace" => b"\x7f",
        "y" => b"y",
        "n" => b"n",
        "1" => b"1",
        "2" => b"2",
        "3" => b"3",
        _ => return None,
    })
}

pub fn pane_size(pane: &str) -> (u16, u16) {
    let o = std::process::Command::new("tmux").args(["display-message", "-p", "-t", pane, "#{pane_width} #{pane_height}"]).output();
    o.ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_string();
            let mut it = s.split_whitespace();
            Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
        })
        .unwrap_or((80, 24))
}

impl TermHub {
    pub fn new(bus: Bus) -> Self {
        Self { bus, streams: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Liga o stream da sessão (se ainda não houver) e devolve a tela atual.
    pub fn attach(&self, session: &str, workspace: Option<String>) -> Result<TermInfo> {
        if !tmux::has_session(session) {
            anyhow::bail!("sessão {session} não existe mais");
        }
        let pane = tmux::list_panes()?.into_iter().filter(|p| p.session == session).max_by_key(|p| p.active).map(|p| p.pane_id).context("pane não encontrado")?;
        let snapshot = tmux::screen(&pane).unwrap_or_default();
        let (cols, rows) = pane_size(&pane);
        let mut streams = self.streams.lock().unwrap();
        if !streams.contains_key(session) {
            let mut t = TermStream::attach(session)?;
            let rx = t.output.take().context("stream")?;
            let bus = self.bus.clone();
            let s2 = session.to_string();
            let map = self.streams.clone();
            std::thread::spawn(move || {
                for (pane, data) in rx {
                    bus.emit("term-output", json!({ "session": s2, "pane": pane, "data": data }), workspace.clone(), Some(s2.clone()));
                }
                // Sessão acabou (ou o cliente -C caiu): o próximo attach liga um stream novo.
                map.lock().unwrap().remove(&s2);
                bus.emit("term-closed", json!({ "session": s2 }), workspace, Some(s2.clone()));
            });
            streams.insert(session.to_string(), t);
        }
        Ok(TermInfo { session: session.into(), pane, snapshot, cols, rows })
    }

    pub fn input(&self, session: &str, pane: &str, data: &[u8]) -> Result<()> {
        match self.streams.lock().unwrap().get_mut(session) {
            Some(t) => t.input(pane, data),
            None => tmux::send_bytes(pane, data),
        }
    }

    /// Redimensiona a janela (só quando o usuário pede: mexe no tamanho para todos os espectadores).
    pub fn resize(&self, session: &str, cols: u16, rows: u16) -> Result<()> {
        tmux::resize(&tmux::exact(session), cols.clamp(20, 400), rows.clamp(5, 200))
    }

    pub fn close(&self, session: &str) {
        self.streams.lock().unwrap().remove(session);
    }

    pub fn snapshot(&self, pane: &str) -> Result<String> {
        tmux::screen(pane)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn teclas() {
        assert_eq!(key_bytes("Escape"), Some(&b"\x1b"[..]));
        assert_eq!(key_bytes("C-c"), Some(&b"\x03"[..]));
        assert_eq!(key_bytes("Up"), Some(&b"\x1b[A"[..]));
        assert_eq!(key_bytes("rm -rf"), None);
    }

    /// Dois espectadores da mesma sessão recebem a mesma saída (tmux real; pula sem tmux).
    #[test]
    fn stream_compartilhado() {
        if kabul_core::harness::which("tmux").is_none() {
            return;
        }
        let name = format!("kabul-test-hub-{}", std::process::id());
        tmux::new_session(&name, None, Some("sh")).unwrap();
        let bus = Bus::new();
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();
        let hub = TermHub::new(bus);
        let info = hub.attach(&name, None).unwrap();
        hub.attach(&name, None).unwrap(); // segundo espectador: mesmo stream
        assert_eq!(hub.streams.lock().unwrap().len(), 1);
        hub.input(&name, &info.pane, b"echo kabul-$((40+2))\r").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let (mut ga, mut gb) = (String::new(), String::new());
        while std::time::Instant::now() < deadline && !(ga.contains("kabul-42") && gb.contains("kabul-42")) {
            for (rx, got) in [(&mut a, &mut ga), (&mut b, &mut gb)] {
                while let Ok(ev) = rx.try_recv() {
                    if ev.channel == "term-output" {
                        let bytes: Vec<u8> = serde_json::from_value(ev.payload["data"].clone()).unwrap();
                        got.push_str(&String::from_utf8_lossy(&bytes));
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        hub.close(&name);
        let _ = tmux::kill_session(&name);
        assert!(ga.contains("kabul-42") && gb.contains("kabul-42"), "{ga:?} / {gb:?}");
    }
}
