//! Serviço das Ferramentas: o último scan em memória, atualização em segundo plano (TTL de 60 s,
//! watcher só nas pastas de extensões e pedido explícito) e o evento de "mudou" para a interface.
//! O app (Tauri), o kabuld e o `kabul serve` usam o mesmo serviço.
use super::fsx::FileCache;
use super::prefs::{Change, Prefs};
use super::{build, item_detail, scan_all, ItemDetail, Query, RepoRef, Roots, ScanOut, Snapshot};
use anyhow::Result;
use notify::{RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

/// Depois disso o snapshot é servido do cache e atualizado em segundo plano.
pub const TTL: Duration = Duration::from_secs(60);
/// Janela de juntar avisos do watcher.
pub const DEBOUNCE: Duration = Duration::from_secs(1);

pub type OnChange = Arc<dyn Fn() + Send + Sync>;

struct Inner {
    out: Option<Arc<ScanOut>>,
    at: Option<Instant>,
    repos: Vec<RepoRef>,
}

pub struct Service {
    roots: Roots,
    inner: Mutex<Inner>,
    cache: Mutex<FileCache>,
    scanning: AtomicBool,
    /// Mudança vista pelo watcher (atualiza depois do debounce).
    dirty_at: Mutex<Option<Instant>>,
    on_change: OnceLock<OnChange>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    me: OnceLock<Weak<Service>>,
}

impl Service {
    /// `state`: pasta de estado do Kabul (cache, preferências e contas isoladas).
    pub fn new(state: &std::path::Path) -> Arc<Self> {
        Self::with_roots(Roots::from_env(state))
    }

    pub fn with_roots(roots: Roots) -> Arc<Self> {
        let cache = FileCache::load(&roots.state.join("tools-cache.json"));
        let s = Arc::new(Self {
            roots,
            inner: Mutex::new(Inner { out: None, at: None, repos: vec![] }),
            cache: Mutex::new(cache),
            scanning: AtomicBool::new(false),
            dirty_at: Mutex::new(None),
            on_change: OnceLock::new(),
            watcher: Mutex::new(None),
            me: OnceLock::new(),
        });
        let _ = s.me.set(Arc::downgrade(&s));
        s
    }

    /// Quem avisar quando um scan em segundo plano terminar (evento `tools-changed`).
    pub fn set_on_change(&self, f: OnChange) {
        let _ = self.on_change.set(f);
    }

    pub fn roots(&self) -> &Roots {
        &self.roots
    }

    fn scan_now(&self, repos: &[RepoRef]) -> Arc<ScanOut> {
        let out = {
            let mut c = self.cache.lock().unwrap();
            let out = scan_all(&self.roots, repos, &mut c);
            c.save(&self.roots.state.join("tools-cache.json"));
            out
        };
        let out = Arc::new(out);
        let mut g = self.inner.lock().unwrap();
        g.out = Some(out.clone());
        g.at = Some(Instant::now());
        g.repos = repos.to_vec();
        drop(g);
        self.ensure_watcher(&out);
        out
    }

    /// Atualiza em segundo plano (um scan por vez) e avisa ao terminar.
    pub fn refresh_async(&self, repos: Vec<RepoRef>) {
        if self.scanning.swap(true, Ordering::SeqCst) {
            return;
        }
        let Some(me) = self.me.get().and_then(Weak::upgrade) else {
            self.scanning.store(false, Ordering::SeqCst);
            return;
        };
        let spawned = std::thread::Builder::new().name("kabul-tools-scan".into()).spawn(move || {
            me.scan_now(&repos);
            me.scanning.store(false, Ordering::SeqCst);
            if let Some(f) = me.on_change.get() {
                f();
            }
        });
        if spawned.is_err() {
            self.scanning.store(false, Ordering::SeqCst);
        }
    }

    /// Resultado cru atual (escaneia na hora quando ainda não há nenhum ou `refresh`).
    pub fn current(&self, repos: &[RepoRef], refresh: bool) -> (Arc<ScanOut>, bool) {
        let (out, at, same_repos) = {
            let g = self.inner.lock().unwrap();
            (g.out.clone(), g.at, g.repos == repos)
        };
        match out {
            Some(o) if !refresh && same_repos => {
                let dirty = self.dirty_at.lock().unwrap().is_some();
                let stale = dirty || at.is_none_or(|t| t.elapsed() > TTL);
                if stale {
                    *self.dirty_at.lock().unwrap() = None;
                    self.refresh_async(repos.to_vec());
                }
                (o, stale)
            }
            _ => (self.scan_now(repos), false),
        }
    }

    pub fn snapshot(&self, repos: &[RepoRef], q: &Query) -> Snapshot {
        let (out, stale) = self.current(repos, q.refresh);
        let mut s = build(&out, q, &Prefs::load(&self.roots.state));
        s.stale = stale;
        s
    }

    pub fn item(&self, repos: &[RepoRef], id: &str) -> Option<ItemDetail> {
        let (out, _) = self.current(repos, false);
        let snap = build(&out, &Query { scope: Some("all".into()), ..Default::default() }, &Prefs::load(&self.roots.state));
        item_detail(&out, &snap, id)
    }

    pub fn prefs_set(&self, c: &Change) -> Result<Prefs> {
        let mut p = Prefs::load(&self.roots.state);
        p.apply(c);
        p.save(&self.roots.state)?;
        Ok(p)
    }

    /// Watcher (debounce de 1 s) só nas pastas de extensões que existem — nada recursivo em `~/.claude`.
    fn ensure_watcher(&self, out: &ScanOut) {
        let mut g = self.watcher.lock().unwrap();
        if g.is_some() {
            return;
        }
        let dirs: Vec<PathBuf> =
            out.roots.iter().filter(|r| r.status == "ok" && r.repo.is_none() && matches!(r.what.as_str(), "skills" | "commands" | "agents" | "prompts" | "rules" | "extensions")).map(|r| self.roots.expand(&r.path)).filter(|p| p.is_dir()).collect();
        if dirs.is_empty() {
            return;
        }
        let weak = self.me.get().cloned().unwrap_or_default();
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                if let Some(s) = weak.upgrade() {
                    *s.dirty_at.lock().unwrap() = Some(Instant::now());
                    s.schedule();
                }
            }
        });
        let Ok(mut w) = w else { return };
        for d in dirs.iter().take(64) {
            let _ = w.watch(d, RecursiveMode::Recursive);
        }
        *g = Some(w);
    }

    /// Depois do debounce, atualiza e avisa (uma thread por rajada).
    fn schedule(&self) {
        static PENDING: AtomicBool = AtomicBool::new(false);
        if PENDING.swap(true, Ordering::SeqCst) {
            return;
        }
        let weak = self.me.get().cloned().unwrap_or_default();
        let _ = std::thread::Builder::new().name("kabul-tools-watch".into()).spawn(move || {
            std::thread::sleep(DEBOUNCE);
            PENDING.store(false, Ordering::SeqCst);
            if let Some(s) = weak.upgrade() {
                let repos = s.inner.lock().unwrap().repos.clone();
                *s.dirty_at.lock().unwrap() = None;
                s.refresh_async(repos);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::fsx::testfs::Tmp;

    #[test]
    fn quente_e_atualizacao() {
        let t = Tmp::new("svc");
        t.write("home/.agents/skills/x/SKILL.md", "---\nname: x\ndescription: Faz x\n---\n");
        let roots = Roots { state: t.path().join("state"), ..Roots::for_os("linux", &t.path().join("home")) };
        let s = Service::with_roots(roots);
        let snap = s.snapshot(&[], &Query::default());
        assert!(snap.items.iter().any(|i| i.id == "skill:x"));
        assert!(!snap.stale);
        // Quente: só memória.
        let t0 = Instant::now();
        let again = s.snapshot(&[], &Query::default());
        assert!(t0.elapsed() < Duration::from_millis(100), "quente demorou {:?}", t0.elapsed());
        assert_eq!(again.items.len(), snap.items.len());
        // Pedido explícito relê o disco.
        t.write("home/.agents/skills/y/SKILL.md", "---\nname: y\ndescription: Faz y\n---\n");
        let fresh = s.snapshot(&[], &Query { refresh: true, ..Default::default() });
        assert!(fresh.items.iter().any(|i| i.id == "skill:y"));
        // Preferências entram no snapshot.
        s.prefs_set(&Change { id: "skill:y".into(), favorite: Some(true), ..Default::default() }).unwrap();
        assert!(s.snapshot(&[], &Query::default()).items.iter().find(|i| i.id == "skill:y").unwrap().favorite);
        let d = s.item(&[], "skill:y").unwrap();
        assert!(d.body.is_some() && d.abs_path.is_some());
    }
}
