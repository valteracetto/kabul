//! Terminais compartilhados: um stream por sessão, seja quantos forem os espectadores (desktop,
//! celular, amigo). A saída vai para o barramento como `term-output`; a entrada são os bytes exatos.
//! O backend é o do core (`kabul_core::term`): `tmux -C` no macOS/Linux, PTY próprio (ConPTY) no Windows.
use crate::bus::Bus;
use anyhow::{Context, Result};
use kabul_core::term::{self, Stream};
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
    streams: Arc<Mutex<HashMap<String, Stream>>>,
}

/// Maior colagem aceita de uma vez no terminal (1 MB).
pub const MAX_INPUT: usize = 1 << 20;

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
    term::backend().info(pane).map(|i| (i.cols, i.rows)).unwrap_or((80, 24))
}

impl TermHub {
    pub fn new(bus: Bus) -> Self {
        Self { bus, streams: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Liga o stream da sessão (se ainda não houver) e devolve a tela atual.
    pub fn attach(&self, session: &str, workspace: Option<String>) -> Result<TermInfo> {
        let b = term::backend();
        if !b.has(session) {
            anyhow::bail!("sessão {session} não existe mais");
        }
        let pane = b.pane_of(session).context("pane não encontrado")?;
        let snapshot = b.screen(&pane).unwrap_or_default();
        let (cols, rows) = pane_size(&pane);
        let mut streams = self.streams.lock().unwrap();
        if !streams.contains_key(session) {
            let mut t = b.attach(session)?;
            let rx = t.output.take().context("stream")?;
            let bus = self.bus.clone();
            let s2 = session.to_string();
            let map = self.streams.clone();
            std::thread::spawn(move || {
                // Saída juntada por quadro (um `term-output` a cada ~16 ms por pane, no máximo).
                for (pane, data) in kabul_core::batch::coalesce(rx, kabul_core::batch::frame()) {
                    bus.emit("term-output", json!({ "session": s2, "pane": pane, "data": data }), workspace.clone(), Some(s2.clone()));
                }
                // Sessão acabou (ou o stream caiu): o próximo attach liga um stream novo.
                map.lock().unwrap().remove(&s2);
                bus.emit("term-closed", json!({ "session": s2 }), workspace, Some(s2.clone()));
            });
            streams.insert(session.to_string(), t);
        }
        Ok(TermInfo { session: session.into(), pane, snapshot, cols, rows })
    }

    /// O pane pertence à sessão? A política confere a sessão; sem isto um convidado mandaria o
    /// `session` do workspace dele e o `pane` de outra sessão qualquer (ex.: `%0`). Vale para os dois
    /// backends (tmux e PTY usam ids `%N`).
    pub fn pane_in_session(session: &str, pane: &str) -> bool {
        term::is_pane_id(pane) && term::backend().list().map(|v| v.iter().any(|p| p.session == session && p.pane_id == pane)).unwrap_or(false)
    }

    pub fn input(&self, session: &str, pane: &str, data: &[u8]) -> Result<()> {
        anyhow::ensure!(data.len() <= MAX_INPUT, "entrada grande demais para o terminal");
        anyhow::ensure!(Self::pane_in_session(session, pane), "pane {pane:?} não é da sessão {session}");
        match self.streams.lock().unwrap().get_mut(session) {
            Some(t) => t.input(pane, data),
            None => term::backend().send(pane, data),
        }
    }

    /// Redimensiona a janela (só quando o usuário pede: mexe no tamanho para todos os espectadores).
    pub fn resize(&self, session: &str, cols: u16, rows: u16) -> Result<()> {
        term::backend().resize(session, cols.clamp(20, 400), rows.clamp(5, 200))
    }

    pub fn close(&self, session: &str) {
        self.streams.lock().unwrap().remove(session);
    }

    pub fn snapshot(&self, pane: &str) -> Result<String> {
        term::backend().screen(pane)
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

    /// Dois espectadores da mesma sessão recebem a mesma saída (backend do sistema: tmux no macOS,
    /// PTY no Windows ou sem tmux).
    #[test]
    fn stream_compartilhado() {
        use kabul_core::harness::CmdSpec;
        use kabul_core::term::{Cmd, Launch, What};
        let name = format!("kabul-test-hub-{}", std::process::id());
        let shell = if cfg!(windows) { CmdSpec::new("cmd.exe", ["/Q"]) } else { CmdSpec::new("sh", Vec::<String>::new()) };
        term::backend().open(&Launch::new(&name, None, What::Exec(Cmd::Spec(shell)))).unwrap();
        let bus = Bus::new();
        let mut a = bus.subscribe();
        let mut b = bus.subscribe();
        let hub = TermHub::new(bus);
        let info = hub.attach(&name, None).unwrap();
        hub.attach(&name, None).unwrap(); // segundo espectador: mesmo stream
        assert_eq!(hub.streams.lock().unwrap().len(), 1);
        let line: &[u8] = if cfg!(windows) { b"echo kabul-4^2\r" } else { b"echo kabul-$((40+2))\r" };
        hub.input(&name, &info.pane, line).unwrap();
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
        let _ = term::backend().kill(&name);
        assert!(ga.contains("kabul-42") && gb.contains("kabul-42"), "{ga:?} / {gb:?}");
    }

    /// Segurança: digitar exige que o pane seja da sessão informada (a que a política conferiu).
    #[test]
    fn pane_de_outra_sessao_recusado() {
        use kabul_core::harness::CmdSpec;
        use kabul_core::term::{Cmd, Launch, What};
        let (a, b) = (format!("kabul-test-pa-{}", std::process::id()), format!("kabul-test-pb-{}", std::process::id()));
        let shell = if cfg!(windows) { CmdSpec::new("cmd.exe", ["/Q"]) } else { CmdSpec::new("sh", Vec::<String>::new()) };
        let be = term::backend();
        be.open(&Launch::new(&a, None, What::Exec(Cmd::Spec(shell.clone())))).unwrap();
        be.open(&Launch::new(&b, None, What::Exec(Cmd::Spec(shell)))).unwrap();
        let hub = TermHub::new(Bus::new());
        let pa = hub.attach(&a, None).unwrap().pane;
        let pb = be.pane_of(&b).unwrap();
        assert!(hub.input(&a, &pa, b"").is_ok());
        assert!(hub.input(&a, &pb, b"x").is_err(), "pane da outra sessão");
        assert!(hub.input(&a, &format!("{pa} ; run-shell true"), b"x").is_err());
        assert!(hub.input(&a, &pa, &vec![b'x'; MAX_INPUT + 1]).is_err());
        hub.close(&a);
        let _ = be.kill(&a);
        let _ = be.kill(&b);
    }
}
