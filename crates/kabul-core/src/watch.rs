//! Watchers de arquivos: UM por repo (não por workspace), cobrindo a pasta onde os worktrees dele
//! nascem e o `.git` do repo (commits, refs, índice de cada worktree). Mudanças viram um aviso por
//! workspace, juntado em janelas de 250 ms, e invalidam o cache do `git status`/PR — quem consulta
//! deixa de rodar git à toa quando nada mudou.
//!
//! Portável pela crate `notify` (FSEvents no macOS, inotify no Linux, ReadDirectoryChangesW no Windows).
use crate::store::{Repo, Workspace};
use notify::{RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub type OnChange = Arc<dyn Fn(&str) + Send + Sync>;

/// Janela de juntar avisos.
pub const DEBOUNCE: Duration = Duration::from_millis(250);

/// (caminho real do worktree, id do workspace) e id → caminho como está no estado (chave do cache).
type WsList = Arc<Mutex<(Vec<(String, String)>, HashMap<String, String>)>>;

struct Entry {
    _watcher: notify::RecommendedWatcher,
    roots: Vec<PathBuf>,
    workspaces: WsList,
}

pub struct RepoWatchers {
    repos: Mutex<HashMap<String, Entry>>,
    /// workspace id → caminho, a avisar no próximo ciclo.
    pending: Arc<Mutex<HashMap<String, String>>>,
    stop: Arc<AtomicBool>,
}

/// Caminhos que mudam muito e não mexem no status do git (ignorados ou objetos internos).
fn noise(p: &Path) -> bool {
    p.components().any(|c| matches!(c.as_os_str().to_str(), Some("node_modules" | "target" | "objects" | ".next" | "dist" | ".turbo")))
}

/// Workspaces afetados por uma mudança em `p`.
fn affected(p: &Path, wss: &[(String, String)], repo_git: &Path) -> Vec<(String, String)> {
    if let Ok(rest) = p.strip_prefix(repo_git) {
        // `.git/worktrees/<nome>/...` é de um worktree; o resto (refs, HEAD da principal) vale para todos.
        let mut it = rest.components();
        if it.next().map(|c| c.as_os_str() == "worktrees").unwrap_or(false) {
            if let Some(name) = it.next() {
                return wss.iter().filter(|(path, _)| Path::new(path).file_name() == Some(name.as_os_str())).cloned().collect();
            }
        }
        return wss.to_vec();
    }
    wss.iter().filter(|(path, _)| p.starts_with(path)).max_by_key(|(path, _)| path.len()).cloned().into_iter().collect()
}

impl RepoWatchers {
    /// `on_change(workspace_id)` é chamado (fora do watcher) no máximo uma vez por janela por workspace.
    pub fn new(on_change: OnChange) -> Self {
        let pending: Arc<Mutex<HashMap<String, String>>> = Default::default();
        let stop = Arc::new(AtomicBool::new(false));
        {
            let (pending, stop) = (pending.clone(), stop.clone());
            std::thread::Builder::new()
                .name("kabul-watch".into())
                .spawn(move || {
                    while !stop.load(Ordering::Relaxed) {
                        std::thread::sleep(DEBOUNCE);
                        let batch: Vec<(String, String)> = pending.lock().unwrap().drain().collect();
                        for (id, path) in batch {
                            crate::gitops::invalidate(&path);
                            on_change(&id);
                        }
                    }
                })
                .ok();
        }
        Self { repos: Mutex::new(HashMap::new()), pending, stop }
    }

    /// Quantos watchers (repos) estão ativos.
    pub fn count(&self) -> usize {
        self.repos.lock().unwrap().len()
    }

    /// Acompanha o estado: cria/atualiza/remove watchers (um por repo com workspaces ativos).
    pub fn sync(&self, repos: &[Repo], workspaces: &[Workspace]) {
        let mut cur = self.repos.lock().unwrap();
        let mut keep = HashSet::new();
        for r in repos {
            // O sistema avisa com o caminho real (no macOS `/private/var/...` para `/var/...`).
            let real = |p: &str| std::fs::canonicalize(p).map(|c| c.display().to_string()).unwrap_or_else(|_| p.to_string());
            let mine: Vec<&Workspace> = workspaces.iter().filter(|w| w.repo_id == r.id && !w.archived && Path::new(&w.path).is_dir()).collect();
            if mine.is_empty() {
                continue;
            }
            let wss: Vec<(String, String)> = mine.iter().map(|w| (real(&w.path), w.id.clone())).collect();
            let orig: HashMap<String, String> = mine.iter().map(|w| (w.id.clone(), w.path.clone())).collect();
            let git = PathBuf::from(real(&r.path)).join(".git");
            let mut roots: Vec<PathBuf> = wss.iter().filter_map(|(p, _)| Path::new(p).parent().map(Path::to_path_buf)).collect();
            if git.is_dir() {
                roots.push(git.clone());
            }
            roots.sort();
            roots.dedup();
            // Uma raiz que contém outra já cobre a de dentro.
            let roots: Vec<PathBuf> = roots.iter().filter(|a| !roots.iter().any(|b| b != *a && a.starts_with(b))).cloned().collect();
            keep.insert(r.id.clone());
            if let Some(e) = cur.get(&r.id) {
                if e.roots == roots {
                    *e.workspaces.lock().unwrap() = (wss, orig);
                    continue;
                }
            }
            let list: WsList = Arc::new(Mutex::new((wss, orig)));
            let (l2, pending, git2) = (list.clone(), self.pending.clone(), git.clone());
            let handler = move |res: notify::Result<notify::Event>| {
                let Ok(ev) = res else { return };
                if matches!(ev.kind, notify::EventKind::Access(_)) {
                    return;
                }
                let g = l2.lock().unwrap();
                let (wss, orig) = &*g;
                let mut p = pending.lock().unwrap();
                for path in ev.paths.iter().filter(|p| !noise(p) || p.starts_with(&git2) && !p.components().any(|c| c.as_os_str() == "objects")) {
                    for (_, id) in affected(path, wss, &git2) {
                        let o = orig.get(&id).cloned().unwrap_or_default();
                        p.insert(id, o);
                    }
                }
            };
            let Ok(mut w) = notify::recommended_watcher(handler) else { continue };
            let ok = roots.iter().filter(|root| w.watch(root, RecursiveMode::Recursive).is_ok()).count();
            if ok > 0 {
                cur.insert(r.id.clone(), Entry { _watcher: w, roots, workspaces: list });
            }
        }
        cur.retain(|id, _| keep.contains(id));
    }
}

impl Drop for RepoWatchers {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quem_e_afetado() {
        let wss = vec![("/w/app/lisboa".to_string(), "w1".to_string()), ("/w/app/porto".to_string(), "w2".to_string())];
        let git = Path::new("/src/app/.git");
        assert_eq!(affected(Path::new("/w/app/lisboa/src/a.rs"), &wss, git), vec![wss[0].clone()]);
        assert_eq!(affected(Path::new("/src/app/.git/worktrees/porto/index"), &wss, git), vec![wss[1].clone()]);
        assert_eq!(affected(Path::new("/src/app/.git/refs/remotes/origin/main"), &wss, git).len(), 2);
        assert!(affected(Path::new("/w/outro/x"), &wss, git).is_empty());
        assert!(noise(Path::new("/w/app/lisboa/node_modules/x/index.js")));
        assert!(!noise(Path::new("/w/app/lisboa/src/target.rs")));
    }

    /// Um watcher para o repo inteiro; escrever num worktree avisa só aquele workspace.
    #[test]
    fn um_watcher_por_repo() {
        let base = std::env::temp_dir().join(format!("kabul-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let repo_path = base.join("repo");
        std::fs::create_dir_all(repo_path.join(".git")).unwrap();
        let mk = |n: &str| {
            let p = base.join("ws").join(n);
            std::fs::create_dir_all(&p).unwrap();
            p.canonicalize().unwrap().display().to_string()
        };
        let (a, b) = (mk("a"), mk("b"));
        let repo = Repo { id: "r".into(), name: "repo".into(), path: repo_path.canonicalize().unwrap().display().to_string(), default_branch: "main".into(), ..Default::default() };
        let ws = |id: &str, path: &str| Workspace { id: id.into(), repo_id: "r".into(), path: path.into(), ..Default::default() };
        let got: Arc<Mutex<Vec<String>>> = Default::default();
        let g2 = got.clone();
        let w = RepoWatchers::new(Arc::new(move |id: &str| g2.lock().unwrap().push(id.to_string())));
        w.sync(std::slice::from_ref(&repo), &[ws("wa", &a), ws("wb", &b)]);
        assert_eq!(w.count(), 1);
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(Path::new(&a).join("novo.txt"), "x").unwrap();
        let t = std::time::Instant::now();
        while t.elapsed() < Duration::from_secs(5) && !got.lock().unwrap().contains(&"wa".to_string()) {
            std::thread::sleep(Duration::from_millis(50));
        }
        let v = got.lock().unwrap().clone();
        assert!(v.contains(&"wa".to_string()), "{v:?}");
        assert!(!v.contains(&"wb".to_string()), "{v:?}");
        w.sync(&[], &[]);
        assert_eq!(w.count(), 0);
        drop(w);
        let _ = std::fs::remove_dir_all(&base);
    }
}
