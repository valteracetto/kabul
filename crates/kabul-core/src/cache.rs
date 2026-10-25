//! Cache com validade (TTL) para o que é caro e muda pouco: `gh pr view`, checks do PR, `git status`
//! (vários processos git por chamada). Quem escreve (push, merge, watcher de arquivos) invalida.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct TtlCache<V> {
    map: Mutex<Option<HashMap<String, (Instant, V)>>>,
    max: usize,
}

impl<V: Clone> TtlCache<V> {
    pub const fn new(max: usize) -> Self {
        // O mapa nasce no primeiro uso (permite `static`).
        Self { map: Mutex::new(None), max }
    }

    pub fn get(&self, key: &str, ttl: Duration) -> Option<V> {
        let g = self.map.lock().unwrap();
        g.as_ref()?.get(key).filter(|(at, _)| at.elapsed() < ttl).map(|(_, v)| v.clone())
    }

    pub fn put(&self, key: &str, v: V) {
        let mut g = self.map.lock().unwrap();
        let g = g.get_or_insert_with(HashMap::new);
        if g.len() >= self.max {
            g.clear();
        }
        g.insert(key.to_string(), (Instant::now(), v));
    }

    /// Valor guardado ou calculado agora (erros não ficam guardados).
    pub fn get_or<E>(&self, key: &str, ttl: Duration, f: impl FnOnce() -> Result<V, E>) -> Result<V, E> {
        if let Some(v) = self.get(key, ttl) {
            return Ok(v);
        }
        let v = f()?;
        self.put(key, v.clone());
        Ok(v)
    }

    /// Tira as chaves que começam com `prefix` (ex.: o caminho do workspace).
    pub fn invalidate(&self, prefix: &str) {
        if let Some(m) = self.map.lock().unwrap().as_mut() {
            m.retain(|k, _| !k.starts_with(prefix));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_e_invalidacao() {
        let c: TtlCache<u32> = TtlCache::new(10);
        let mut calls = 0;
        let mut f = || -> Result<u32, ()> {
            calls += 1;
            Ok(7)
        };
        assert_eq!(c.get_or("/w/a|status", Duration::from_secs(5), &mut f), Ok(7));
        assert_eq!(c.get_or("/w/a|status", Duration::from_secs(5), &mut f), Ok(7));
        assert_eq!(calls, 1);
        assert_eq!(c.get("/w/a|status", Duration::ZERO), None, "vencido");
        c.invalidate("/w/a");
        assert_eq!(c.get("/w/a|status", Duration::from_secs(5)), None);
        assert!(c.get_or("x", Duration::from_secs(5), || Err::<u32, &str>("falhou")).is_err());
        assert_eq!(c.get("x", Duration::from_secs(5)), None, "erro não fica guardado");
    }
}
