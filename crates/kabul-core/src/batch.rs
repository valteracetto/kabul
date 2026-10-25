//! Coalescência por quadro: com muitos agentes em streaming, cada pedacinho de texto (ou de saída
//! do terminal) virava um evento até a UI/WebSocket. Aqui, eventos que podem ser somados (deltas de
//! texto seguidos, bytes do mesmo pane) saem no máximo um por quadro (~16 ms) por fonte.
//!
//! É um *throttle* com borda de subida: o primeiro pedaço sai na hora; os que chegam dentro do mesmo
//! quadro são juntados e saem no fim dele. Qualquer evento que não soma (ferramenta, fim do turno)
//! descarrega o acumulado antes, então a ordem nunca muda.
use crate::harness::Event;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// Janela padrão (um quadro a 60 fps). `KABUL_COALESCE_MS=0` desliga.
pub fn frame() -> Duration {
    static F: std::sync::OnceLock<Duration> = std::sync::OnceLock::new();
    *F.get_or_init(|| Duration::from_millis(std::env::var("KABUL_COALESCE_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(16)))
}

/// Teto de um pedaço juntado (não cria quadros gigantes).
const MAX_MERGED: usize = 64 * 1024;

/// Junta `next` em `acc` quando os dois somam; senão devolve `next`.
pub trait Merge: Sized {
    fn merge(&mut self, next: Self) -> Result<(), Self>;
    fn mergeable(&self) -> bool;
}

impl Merge for Event {
    fn mergeable(&self) -> bool {
        matches!(self, Event::TextDelta { .. })
    }
    fn merge(&mut self, next: Self) -> Result<(), Self> {
        match (self, next) {
            (Event::TextDelta { text }, Event::TextDelta { text: t }) if text.len() + t.len() <= MAX_MERGED => {
                text.push_str(&t);
                Ok(())
            }
            (_, n) => Err(n),
        }
    }
}

/// Saída do terminal: `(pane, bytes)`.
impl Merge for (String, Vec<u8>) {
    fn mergeable(&self) -> bool {
        true
    }
    fn merge(&mut self, next: Self) -> Result<(), Self> {
        if self.0 == next.0 && self.1.len() + next.1.len() <= MAX_MERGED {
            self.1.extend_from_slice(&next.1);
            Ok(())
        } else {
            Err(next)
        }
    }
}

pub struct Coalesce<T> {
    rx: Receiver<T>,
    window: Duration,
    pending: Option<T>,
    last: Option<Instant>,
    done: bool,
}

/// Itera `rx` juntando o que somar dentro de cada janela.
pub fn coalesce<T: Merge>(rx: Receiver<T>, window: Duration) -> Coalesce<T> {
    Coalesce { rx, window, pending: None, last: None, done: false }
}

impl<T: Merge> Iterator for Coalesce<T> {
    type Item = T;
    fn next(&mut self) -> Option<T> {
        let mut acc = match self.pending.take() {
            Some(x) => x,
            None if self.done => return None,
            None => self.rx.recv().ok()?,
        };
        if !acc.mergeable() || self.window.is_zero() {
            // Mesmo sem janela, junta o que já estiver na fila (sem esperar nada).
            if acc.mergeable() {
                while let Ok(n) = self.rx.try_recv() {
                    if let Err(n) = acc.merge(n) {
                        self.pending = Some(n);
                        break;
                    }
                }
            }
            return Some(acc);
        }
        // Borda de subida: se o último pedaço saiu há mais de uma janela, este sai já (com o que já
        // estiver na fila); senão espera o fim da janela juntando.
        let now = Instant::now();
        let deadline = match self.last {
            Some(l) if now.duration_since(l) < self.window => l + self.window,
            _ => now,
        };
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let got = if left.is_zero() { self.rx.try_recv().map_err(|e| matches!(e, std::sync::mpsc::TryRecvError::Disconnected)) } else { self.rx.recv_timeout(left).map_err(|e| matches!(e, RecvTimeoutError::Disconnected)) };
            match got {
                Ok(n) => {
                    if let Err(n) = acc.merge(n) {
                        self.pending = Some(n);
                        break;
                    }
                }
                Err(disconnected) => {
                    self.done = disconnected;
                    break;
                }
            }
        }
        self.last = Some(Instant::now());
        Some(acc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn d(t: &str) -> Event {
        Event::TextDelta { text: t.into() }
    }

    #[test]
    fn junta_deltas_e_preserva_ordem() {
        let (tx, rx) = channel();
        for e in [d("a"), d("b"), Event::ToolUse { id: "1".into(), name: "x".into(), input: serde_json::Value::Null }, d("c"), d("d")] {
            tx.send(e).unwrap();
        }
        drop(tx);
        let v: Vec<Event> = coalesce(rx, Duration::from_millis(16)).collect();
        assert_eq!(v, vec![d("ab"), Event::ToolUse { id: "1".into(), name: "x".into(), input: serde_json::Value::Null }, d("cd")]);
    }

    #[test]
    fn primeiro_sai_na_hora_e_janela_limita() {
        let (tx, rx) = channel();
        let t0 = Instant::now();
        let h = std::thread::spawn(move || {
            for i in 0..20 {
                tx.send(d(&i.to_string())).unwrap();
                std::thread::sleep(Duration::from_millis(2));
            }
        });
        let mut it = coalesce(rx, Duration::from_millis(16));
        let first = it.next().unwrap();
        assert!(t0.elapsed() < Duration::from_millis(10), "o primeiro não espera a janela");
        assert_eq!(first, d("0"));
        let rest: Vec<Event> = it.collect();
        h.join().unwrap();
        let all: String = std::iter::once(first).chain(rest.iter().cloned()).map(|e| if let Event::TextDelta { text } = e { text } else { String::new() }).collect();
        assert_eq!(all, (0..20).map(|i| i.to_string()).collect::<String>());
        assert!(rest.len() < 10, "juntou: {} pedaços", rest.len());
    }

    #[test]
    fn terminal_por_pane() {
        let (tx, rx) = channel();
        tx.send(("%1".to_string(), b"a".to_vec())).unwrap();
        tx.send(("%1".to_string(), b"b".to_vec())).unwrap();
        tx.send(("%2".to_string(), b"c".to_vec())).unwrap();
        drop(tx);
        let v: Vec<_> = coalesce(rx, Duration::ZERO).collect();
        assert_eq!(v, vec![("%1".to_string(), b"ab".to_vec()), ("%2".to_string(), b"c".to_vec())]);
    }
}
