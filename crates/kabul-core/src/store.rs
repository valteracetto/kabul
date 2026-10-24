//! Repos e workspaces do Kabul (JSON em disco). Workspace = git worktree + branch `<prefixo>/<cidade>`.
use crate::worktree;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Repo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub default_branch: String,
    /// Oculto na barra lateral ("Hide repository").
    #[serde(default)]
    pub hidden: bool,
    /// Ícone escolhido (emoji); vazio = monograma.
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Workspace {
    pub id: String,
    pub repo_id: String,
    /// Nome da cidade (também nome da sessão tmux `kabul-<nome>`).
    pub name: String,
    pub branch: String,
    pub path: String,
    pub archived: bool,
    pub created_at: u64,
    /// Nome dado pelo usuário (a barra lateral mostra este, se houver).
    #[serde(default)]
    pub title: Option<String>,
    /// backlog | in-progress | in-review | done | canceled
    #[serde(default = "default_status")]
    pub status: String,
    /// initializing | setting_up | ready | setup_failed | archived
    #[serde(default = "default_state")]
    pub state: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub notes: String,
    /// Primeira de 10 portas reservadas (KABUL_PORT..+9).
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub target_branch: Option<String>,
    #[serde(default)]
    pub pr_url: Option<String>,
    /// Checkpoint gravado ao arquivar (permite desarquivar com as mudanças).
    #[serde(default)]
    pub archive_checkpoint: Option<String>,
    /// A branch foi nomeada pelo usuário (sem renomeação automática).
    #[serde(default)]
    pub user_set_branch: bool,
    #[serde(default)]
    pub files_copied: u32,
    /// Issue do Linear de onde o workspace nasceu.
    #[serde(default)]
    pub linear: Option<LinearLink>,
    /// Terminou um turno sem ser visto (negrito na barra lateral).
    #[serde(default)]
    pub unread: bool,
    /// Seção customizada da barra lateral (id de `State.sections`).
    #[serde(default)]
    pub section: Option<String>,
    /// Ordem dentro da seção Pinned (menor primeiro).
    #[serde(default)]
    pub pin_order: Option<u32>,
}

/// Seção customizada da barra lateral ("New section"): emoji + nome.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Section {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinearLink {
    pub identifier: String,
    pub title: String,
    pub url: String,
}

fn default_status() -> String {
    "in-progress".into()
}
fn default_state() -> String {
    "ready".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DiffComment {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    pub line: u32,
    #[serde(default)]
    pub end_line: Option<u32>,
    pub body: String,
    #[serde(default)]
    pub resolved: bool,
    pub created_at: u64,
}

impl Workspace {
    pub fn tmux_session(&self) -> String {
        format!("kabul-{}", self.name)
    }

    /// Variáveis para scripts e agentes (KABUL_* e, por compatibilidade, CONDUCTOR_*).
    pub fn env(&self, repo: &Repo) -> Vec<(String, String)> {
        let vals = [
            ("WORKSPACE_NAME", self.name.clone()),
            ("WORKSPACE_ID", self.id.clone()),
            ("WORKSPACE_PATH", self.path.clone()),
            ("ROOT_PATH", repo.path.clone()),
            ("DEFAULT_BRANCH", repo.default_branch.clone()),
            ("TARGET_BRANCH", self.target_branch.clone().unwrap_or_else(|| repo.default_branch.clone())),
            ("PORT", self.port.to_string()),
            ("IS_LOCAL", "1".into()),
        ];
        vals.iter().flat_map(|(k, v)| [(format!("KABUL_{k}"), v.clone()), (format!("CONDUCTOR_{k}"), v.clone())]).collect()
    }

    /// `env()` mais as variáveis do repo (Configurações › Environment, camadas compartilhada e local).
    pub fn full_env(&self, repo: &Repo) -> Vec<(String, String)> {
        let (set, _) = crate::settings::load(Path::new(&repo.path), &repo.default_branch);
        let mut v = self.env(repo);
        v.extend(set.env);
        v
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct State {
    pub repos: Vec<Repo>,
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub comments: Vec<DiffComment>,
    #[serde(default)]
    pub sections: Vec<Section>,
}

pub const CIDADES: &[&str] = &[
    "kabul", "lisboa", "cusco", "quito", "oslo", "lima", "praga", "tunis", "sofia", "riga", "baku", "dakar", "hanoi", "kyoto", "porto", "recife", "belem", "natal", "manaus", "goiania",
    "cairo", "accra", "nairobi", "lagos", "tbilisi", "yerevan", "almaty", "tashkent", "samarcanda", "bukhara", "herat", "mascate", "doha", "amman", "beirute", "esmirna", "split", "zagreb",
    "ljubljana", "bratislava", "viena", "berna", "gante", "bruges", "leiden", "bergen", "tromso", "reykjavik", "dublin", "galway", "cork", "sevilha", "granada", "cadiz", "valparaiso",
    "salta", "mendoza", "cordoba", "rosario", "montevideu", "assuncao", "lapaz", "sucre", "bogota", "cartagena", "medellin", "havana", "oaxaca", "merida", "puebla",
];

/// Primeira cidade livre (nem workspace existente nem branch/pasta já usada).
pub fn pick_city(used: &dyn Fn(&str) -> bool) -> String {
    for c in CIDADES {
        if !used(c) {
            return (*c).into();
        }
    }
    (2..).flat_map(|n| CIDADES.iter().map(move |c| format!("{c}-{n}"))).find(|c| !used(c)).unwrap()
}

fn git(dir: &Path, args: &[&str]) -> Result<String> {
    let o = Command::new("git").arg("-C").arg(dir).args(args).output().context("falha ao executar git")?;
    if !o.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string())
}

/// `<prefixo>/<nome>`; prefixo vazio ("None") vira só o nome.
pub fn prefixed(prefix: &str, name: &str) -> String {
    if prefix.is_empty() { name.to_string() } else { format!("{prefix}/{name}") }
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn now_nanos() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

pub fn id() -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}", n ^ ((std::process::id() as u128) << 64))
}

pub struct Store {
    pub file: PathBuf,
    /// Onde os worktrees nascem: `<root>/<repo>/<cidade>`.
    pub root: PathBuf,
    pub branch_prefix: String,
    pub state: State,
}

impl Store {
    pub fn default_paths() -> (PathBuf, PathBuf) {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        (home.join("Library/Application Support/kabul/state.json"), home.join("kabul/workspaces"))
    }

    pub fn open(file: PathBuf, root: PathBuf, branch_prefix: String) -> Result<Self> {
        let state = match std::fs::read_to_string(&file) {
            Ok(s) => serde_json::from_str(&s).with_context(|| format!("lendo {}", file.display()))?,
            Err(_) => State::default(),
        };
        Ok(Self { file, root, branch_prefix, state })
    }

    pub fn save(&self) -> Result<()> {
        if let Some(d) = self.file.parent() {
            std::fs::create_dir_all(d)?;
        }
        let tmp = self.file.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.state)?)?;
        std::fs::rename(tmp, &self.file)?;
        Ok(())
    }

    pub fn repo(&self, id: &str) -> Result<&Repo> {
        self.state.repos.iter().find(|r| r.id == id).context("repo não encontrado")
    }

    pub fn workspace(&self, id: &str) -> Result<&Workspace> {
        self.state.workspaces.iter().find(|w| w.id == id).context("workspace não encontrado")
    }

    pub fn add_repo(&mut self, path: &Path) -> Result<Repo> {
        let top = PathBuf::from(git(path, &["rev-parse", "--show-toplevel"]).context("a pasta não é um repositório git")?);
        let top_s = top.display().to_string();
        exclude_context(&top);
        if let Some(r) = self.state.repos.iter().find(|r| r.path == top_s) {
            return Ok(r.clone());
        }
        let default_branch = git(&top, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
            .ok()
            .map(|s| s.trim_start_matches("origin/").to_string())
            .or_else(|| ["main", "master"].iter().find(|b| git(&top, &["rev-parse", "--verify", "-q", b]).is_ok()).map(|b| b.to_string()))
            .unwrap_or_else(|| git(&top, &["branch", "--show-current"]).unwrap_or_else(|_| "main".into()));
        exclude_context(&top);
        let r = Repo { id: id(), name: top.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| top_s.clone()), path: top_s, default_branch, ..Default::default() };
        self.state.repos.push(r.clone());
        self.save()?;
        Ok(r)
    }

    pub fn remove_repo(&mut self, id: &str) -> Result<()> {
        if self.state.workspaces.iter().any(|w| w.repo_id == id && !w.archived) {
            bail!("arquive os workspaces do repo antes de removê-lo");
        }
        self.state.repos.retain(|r| r.id != id);
        self.save()
    }

    /// Ref base para worktree e diff: `origin/<padrão>` se existir, senão `<padrão>`.
    pub fn base_ref(repo: &Repo) -> String {
        let remote = format!("origin/{}", repo.default_branch);
        if git(Path::new(&repo.path), &["rev-parse", "--verify", "-q", &remote]).is_ok() {
            remote
        } else {
            repo.default_branch.clone()
        }
    }

    fn free_port(&self) -> u16 {
        (0..500u16).map(|i| 41000 + i * 10).find(|p| !self.state.workspaces.iter().any(|w| !w.archived && w.port == *p)).unwrap_or(41000)
    }

    pub fn create_workspace(&mut self, repo_id: &str) -> Result<Workspace> {
        self.create_workspace_from(repo_id, None)
    }

    /// Workspace novo a partir de `base` (commit/ref); padrão: `origin/<branch padrão>`.
    pub fn create_workspace_from(&mut self, repo_id: &str, base: Option<&str>) -> Result<Workspace> {
        let repo = self.repo(repo_id)?.clone();
        let rp = Path::new(&repo.path);
        let dir = self.root.join(&repo.name);
        let used = |c: &str| {
            self.state.workspaces.iter().any(|w| w.repo_id == repo.id && w.name == c)
                || dir.join(c).exists()
                || git(rp, &["rev-parse", "--verify", "-q", &format!("refs/heads/{}", prefixed(&self.branch_prefix, c))]).is_ok()
        };
        let city = pick_city(&used);
        let branch = prefixed(&self.branch_prefix, &city);
        let path = dir.join(&city);
        std::fs::create_dir_all(&dir)?;
        let (settings, _) = crate::settings::load(rp, &repo.default_branch);
        worktree::add(rp, &path, &branch, Some(base.unwrap_or(&Self::base_ref(&repo))))?;
        let files_copied = copy_ignored(rp, &path, &settings.file_include_globs).unwrap_or(0);
        exclude_context(rp);
        std::fs::create_dir_all(path.join(".context")).ok();
        let w = Workspace {
            id: id(),
            repo_id: repo.id,
            name: city,
            branch,
            path: path.display().to_string(),
            archived: false,
            created_at: now(),
            title: None,
            status: default_status(),
            state: if settings.scripts.setup.is_some() { "setting_up".into() } else { "ready".into() },
            pinned: false,
            notes: String::new(),
            port: self.free_port(),
            target_branch: settings.target_branch,
            pr_url: None,
            archive_checkpoint: None,
            user_set_branch: false,
            files_copied,
            linear: None,
            ..Default::default()
        };
        self.state.workspaces.push(w.clone());
        self.save()?;
        Ok(w)
    }

    /// Workspace numa branch que já existe (local ou `origin/<branch>`), sem criar branch nova.
    pub fn create_workspace_on_branch(&mut self, repo_id: &str, branch: &str) -> Result<Workspace> {
        let repo = self.repo(repo_id)?.clone();
        let rp = Path::new(&repo.path);
        let local = branch.trim_start_matches("origin/").to_string();
        let dir = self.root.join(&repo.name);
        let used = |c: &str| self.state.workspaces.iter().any(|w| w.repo_id == repo.id && w.name == c) || dir.join(c).exists();
        let city = pick_city(&used);
        let path = dir.join(&city);
        std::fs::create_dir_all(&dir)?;
        let exists_local = git(rp, &["rev-parse", "--verify", "-q", &format!("refs/heads/{local}")]).is_ok();
        let p = path.display().to_string();
        if exists_local {
            git(rp, &["worktree", "add", &p, &local])?;
        } else {
            git(rp, &["worktree", "add", "-b", &local, &p, &format!("origin/{local}")])?;
        }
        let (settings, _) = crate::settings::load(rp, &repo.default_branch);
        let files_copied = copy_ignored(rp, &path, &settings.file_include_globs).unwrap_or(0);
        exclude_context(rp);
        std::fs::create_dir_all(path.join(".context")).ok();
        let w = Workspace { id: id(), repo_id: repo.id, name: city, branch: local, path: p, archived: false, created_at: now(), title: None, status: default_status(), state: "ready".into(), pinned: false, notes: String::new(), port: self.free_port(), target_branch: settings.target_branch, pr_url: None, archive_checkpoint: None, user_set_branch: true, files_copied, linear: None, ..Default::default() };
        self.state.workspaces.push(w.clone());
        self.save()?;
        Ok(w)
    }

    pub fn update_workspace(&mut self, id: &str, f: impl FnOnce(&mut Workspace)) -> Result<Workspace> {
        let w = self.state.workspaces.iter_mut().find(|w| w.id == id).context("workspace não encontrado")?;
        f(w);
        let w = w.clone();
        self.save()?;
        Ok(w)
    }

    /// Renomeia a branch do workspace (`git branch -m`).
    pub fn rename_branch(&mut self, id: &str, new: &str, by_user: bool) -> Result<Workspace> {
        let w = self.workspace(id)?.clone();
        let new = new.trim();
        anyhow::ensure!(!new.is_empty() && !new.contains(' '), "nome de branch inválido");
        git(Path::new(&w.path), &["branch", "-m", &w.branch, new])?;
        self.update_workspace(id, |x| {
            x.branch = new.into();
            x.user_set_branch |= by_user;
        })
    }

    /// Arquiva: checkpoint das mudanças, copia `.context/` para `archived-contexts`, remove o worktree.
    /// A branch e o checkpoint ficam (permite desarquivar).
    pub fn archive_workspace(&mut self, id: &str) -> Result<Workspace> {
        self.archive_workspace_opts(id, false)
    }

    /// Arquiva; com `delete_branch`, apaga a branch local (o checkpoint guarda o HEAD e o desarquivar a recria).
    pub fn archive_workspace_opts(&mut self, id: &str, delete_branch: bool) -> Result<Workspace> {
        let w = self.workspace(id)?.clone();
        let repo = self.repo(&w.repo_id)?.clone();
        let wp = Path::new(&w.path);
        let mut ckpt = None;
        if wp.exists() {
            let b = crate::checkpoint::busy(wp)?;
            anyhow::ensure!(b == "clean", "git ocupado ({b}); termine a operação antes de arquivar");
            ckpt = Some(crate::checkpoint::create(wp, &format!("archive-{}", w.id), "arquivamento")?.id);
            let ctx = wp.join(".context");
            if ctx.is_dir() {
                let dest = self.archived_contexts().join(&repo.name).join(&w.name);
                std::fs::create_dir_all(&dest)?;
                copy_dir(&ctx, &dest)?;
            }
            worktree::remove(Path::new(&repo.path), wp, true)?;
            if delete_branch && ckpt.is_some() {
                git(Path::new(&repo.path), &["branch", "-D", &w.branch])?;
            }
        }
        self.update_workspace(id, |x| {
            x.archived = true;
            x.state = "archived".into();
            if ckpt.is_some() {
                x.archive_checkpoint = ckpt;
            }
        })
    }

    pub fn archived_contexts(&self) -> PathBuf {
        self.root.parent().unwrap_or(&self.root).join("archived-contexts")
    }

    /// Recria o worktree na mesma branch, aplica o checkpoint do arquivamento e devolve `.context/`.
    pub fn unarchive_workspace(&mut self, id: &str) -> Result<Workspace> {
        let w = self.workspace(id)?.clone();
        anyhow::ensure!(w.archived, "workspace não está arquivado");
        let repo = self.repo(&w.repo_id)?.clone();
        let wp = PathBuf::from(&w.path);
        std::fs::create_dir_all(wp.parent().unwrap())?;
        let rp = Path::new(&repo.path);
        if git(rp, &["rev-parse", "--verify", "-q", &format!("refs/heads/{}", w.branch)]).is_ok() {
            git(rp, &["worktree", "add", &w.path, &w.branch])?;
        } else {
            // A branch foi apagada ao arquivar: recria no HEAD guardado pelo checkpoint.
            let c = w.archive_checkpoint.as_deref().context("branch apagada e sem checkpoint para recriar")?;
            let head = git(rp, &["rev-parse", &format!("refs/kabul-checkpoints/{c}^")])?;
            git(rp, &["worktree", "add", "-b", &w.branch, &w.path, &head])?;
        }
        if let Some(c) = &w.archive_checkpoint {
            // O ref vive no repositório comum, visível pelo worktree novo.
            crate::checkpoint::restore(&wp, c)?;
        }
        let ctx = self.archived_contexts().join(&repo.name).join(&w.name);
        if ctx.is_dir() {
            copy_dir(&ctx, &wp.join(".context"))?;
        }
        let port = self.free_port();
        self.update_workspace(id, |x| {
            x.archived = false;
            x.state = "ready".into();
            x.port = port;
        })
    }

    pub fn add_comment(&mut self, c: DiffComment) -> Result<DiffComment> {
        self.state.comments.push(c.clone());
        self.save()?;
        Ok(c)
    }

    pub fn set_comment(&mut self, id: &str, resolved: Option<bool>, delete: bool) -> Result<()> {
        if delete {
            self.state.comments.retain(|c| c.id != id);
        } else if let Some(c) = self.state.comments.iter_mut().find(|c| c.id == id) {
            if let Some(r) = resolved {
                c.resolved = r;
            }
        }
        self.save()
    }

    /// `git clone <url>` em `<root>/../repos/<nome>` e cadastra.
    /// Cria ou atualiza uma seção.
    pub fn save_section(&mut self, mut sec: Section) -> Result<Section> {
        if sec.id.is_empty() {
            sec.id = id();
            sec.order = self.state.sections.iter().map(|s| s.order + 1).max().unwrap_or(0);
        }
        match self.state.sections.iter_mut().find(|s| s.id == sec.id) {
            Some(s) => *s = sec.clone(),
            None => self.state.sections.push(sec.clone()),
        }
        self.save()?;
        Ok(sec)
    }

    /// Apaga a seção; os workspaces dela voltam para o grupo normal.
    pub fn delete_section(&mut self, sid: &str) -> Result<()> {
        self.state.sections.retain(|s| s.id != sid);
        for w in self.state.workspaces.iter_mut().filter(|w| w.section.as_deref() == Some(sid)) {
            w.section = None;
        }
        self.save()
    }

    pub fn update_repo(&mut self, rid: &str, f: impl FnOnce(&mut Repo)) -> Result<Repo> {
        let r = self.state.repos.iter_mut().find(|r| r.id == rid).context("repo não encontrado")?;
        f(r);
        let r = r.clone();
        self.save()?;
        Ok(r)
    }

    pub fn clone_repo(&mut self, url: &str) -> Result<Repo> {
        let name = url.trim_end_matches('/').trim_end_matches(".git").rsplit(['/', ':']).next().unwrap_or("repo").to_string();
        let dest = self.root.parent().unwrap_or(&self.root).join("repos").join(&name);
        anyhow::ensure!(!dest.exists(), "{} já existe", dest.display());
        std::fs::create_dir_all(dest.parent().unwrap())?;
        let o = Command::new("git").args(["clone", url]).arg(&dest).output().context("git clone")?;
        anyhow::ensure!(o.status.success(), "git clone: {}", String::from_utf8_lossy(&o.stderr).trim());
        self.add_repo(&dest)
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let t = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &t)?;
        } else {
            std::fs::copy(e.path(), t)?;
        }
    }
    Ok(())
}

/// Branches locais e remotas (sem HEAD), mais recentes primeiro.
pub fn branches(repo: &Path) -> Result<Vec<String>> {
    let _ = git(repo, &["fetch", "--quiet", "--prune", "origin"]);
    let out = git(repo, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"])?;
    let mut v: Vec<String> = vec![];
    for b in out.lines().filter(|b| !b.ends_with("/HEAD") && *b != "origin") {
        let short = b.trim_start_matches("origin/").to_string();
        if !v.contains(&short) {
            v.push(short);
        }
    }
    Ok(v)
}

/// Busca a branch de um PR (`pull/N/head`) para uma branch local `pr-N` e devolve o nome.
pub fn fetch_pr(repo: &Path, number: u32, head: &str) -> Result<String> {
    let local = if head.is_empty() { format!("pr-{number}") } else { head.to_string() };
    git(repo, &["fetch", "origin", &format!("pull/{number}/head:{local}")]).or_else(|_| git(repo, &["fetch", "origin", &format!("{local}:{local}")]))?;
    Ok(local)
}

/// `.context/` fica fora do git em todos os worktrees (via `info/exclude` do repositório comum).
pub fn exclude_context(repo: &Path) {
    let Ok(p) = git(repo, &["rev-parse", "--git-common-dir"]) else { return };
    let p = Path::new(p.trim());
    let file = if p.is_absolute() { p.join("info/exclude") } else { repo.join(p).join("info/exclude") };
    let cur = std::fs::read_to_string(&file).unwrap_or_default();
    if !cur.lines().any(|l| l.trim() == ".context/") {
        let _ = std::fs::create_dir_all(file.parent().unwrap());
        let _ = std::fs::write(&file, format!("{cur}{}.context/\n", if cur.is_empty() || cur.ends_with('\n') { "" } else { "\n" }));
    }
}

/// Copia arquivos ignorados pelo git: padrões de `.worktreeinclude`, `globs` e `.env*`.
pub fn copy_ignored(repo: &Path, dest: &Path, globs: &[String]) -> Result<u32> {
    let mut patterns: Vec<String> = std::fs::read_to_string(repo.join(".worktreeinclude")).map(|s| s.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).map(String::from).collect()).unwrap_or_default();
    patterns.extend(globs.iter().cloned());
    patterns.push(".env*".into());
    let pf = std::env::temp_dir().join(format!("kabul-include-{}-{}", std::process::id(), now()));
    std::fs::write(&pf, patterns.join("\n"))?;
    let out = git(repo, &["ls-files", "--others", "--ignored", "--exclude-from", &pf.to_string_lossy()]);
    std::fs::remove_file(&pf).ok();
    let mut n = 0;
    for f in out?.lines().filter(|l| !l.is_empty()) {
        let (src, dst) = (repo.join(f), dest.join(f));
        if src.is_file() && !dst.exists() {
            std::fs::create_dir_all(dst.parent().unwrap())?;
            std::fs::copy(&src, &dst)?;
            n += 1;
        }
    }
    Ok(n)
}

/// Todos os arquivos do workspace (rastreados + novos não ignorados).
pub fn files(ws: &Workspace) -> Result<Vec<String>> {
    let mut v: Vec<String> = git(Path::new(&ws.path), &["ls-files", "--cached", "--others", "--exclude-standard"])?.lines().map(String::from).collect();
    v.sort();
    v.dedup();
    Ok(v)
}

/// Lê um arquivo do workspace (protegido contra sair da pasta). Até 1 MB.
pub fn read_file(ws: &Workspace, rel: &str) -> Result<String> {
    let base = std::fs::canonicalize(&ws.path)?;
    let p = std::fs::canonicalize(base.join(rel))?;
    anyhow::ensure!(p.starts_with(&base), "caminho fora do workspace");
    let b = std::fs::read(&p)?;
    anyhow::ensure!(b.len() <= 1 << 20, "arquivo grande demais para exibir");
    Ok(String::from_utf8_lossy(&b).into_owned())
}

/// Copia um anexo para `.context/attachments/` e devolve o caminho relativo (para @mencionar).
pub fn attach(ws: &Workspace, src: &Path) -> Result<String> {
    let dir = Path::new(&ws.path).join(".context/attachments");
    std::fs::create_dir_all(&dir)?;
    let name = src.file_name().context("arquivo sem nome")?.to_string_lossy().to_string();
    let mut dest = dir.join(&name);
    let mut i = 1;
    while dest.exists() {
        dest = dir.join(format!("{i}-{name}"));
        i += 1;
    }
    std::fs::copy(src, &dest)?;
    Ok(dest.strip_prefix(&ws.path).unwrap_or(&dest).display().to_string())
}

/// Grava bytes (ex.: imagem colada) como anexo.
pub fn attach_bytes(ws: &Workspace, name: &str, data: &[u8]) -> Result<String> {
    let tmp = std::env::temp_dir().join(format!("kabul-att-{}", now())).join(name.replace('/', "_"));
    std::fs::create_dir_all(tmp.parent().unwrap())?;
    std::fs::write(&tmp, data)?;
    attach(ws, &tmp)
}

/// Slug de branch a partir da primeira mensagem (renomeação automática).
pub fn slug(text: &str) -> String {
    let base: String = text
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' => 'a',
            'é' | 'ê' => 'e',
            'í' => 'i',
            'ó' | 'ô' | 'õ' => 'o',
            'ú' => 'u',
            'ç' => 'c',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    base.split('-').filter(|p| !p.is_empty()).take(5).collect::<Vec<_>>().join("-").chars().take(40).collect::<String>().trim_end_matches('-').to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct Diff {
    pub base: String,
    pub base_ref: String,
    pub stat: String,
    pub patch: String,
}

/// Diff do worktree (inclui mudanças não commitadas) contra o merge-base com a branch padrão.
pub fn diff(repo: &Repo, ws: &Workspace) -> Result<Diff> {
    let base_ref = Store::base_ref(repo);
    let p = Path::new(&ws.path);
    let base = git(p, &["merge-base", "HEAD", &base_ref])?;
    Ok(Diff { stat: git(p, &["diff", "--stat", &base])?, patch: git(p, &["diff", "--no-color", &base])?, base, base_ref })
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FileChange {
    pub path: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
    pub untracked: bool,
}

/// Parse de `git diff --numstat` (binários vêm como `-`).
pub fn parse_numstat(out: &str) -> Vec<FileChange> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, '\t');
            let (a, r, p) = (it.next()?, it.next()?, it.next()?);
            Some(FileChange { path: p.into(), added: a.parse().ok(), removed: r.parse().ok(), untracked: false })
        })
        .collect()
}

/// Arquivos mudados contra o merge-base (inclui não rastreados).
pub fn changes(repo: &Repo, ws: &Workspace) -> Result<Vec<FileChange>> {
    let p = Path::new(&ws.path);
    let base = git(p, &["merge-base", "HEAD", &Store::base_ref(repo)])?;
    let mut v = parse_numstat(&git(p, &["diff", "--numstat", &base])?);
    for f in git(p, &["ls-files", "--others", "--exclude-standard"])?.lines().filter(|l| !l.is_empty()) {
        let n = std::fs::read_to_string(p.join(f)).map(|s| s.lines().count() as u32).ok();
        v.push(FileChange { path: f.into(), added: n, removed: Some(0), untracked: true });
    }
    Ok(v)
}

/// Diff de um arquivo contra o merge-base (arquivo novo vira diff contra /dev/null).
pub fn file_diff(repo: &Repo, ws: &Workspace, file: &str) -> Result<String> {
    let p = Path::new(&ws.path);
    let base = git(p, &["merge-base", "HEAD", &Store::base_ref(repo)])?;
    let d = git(p, &["diff", "--no-color", &base, "--", file])?;
    if !d.is_empty() {
        return Ok(d);
    }
    let o = Command::new("git").arg("-C").arg(p).args(["diff", "--no-color", "--no-index", "--", "/dev/null", file]).output()?;
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PrOptions {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub labels: Vec<String>,
    /// Empilhar sobre outro PR (a base vira a branch desse PR).
    #[serde(default)]
    pub stack_on: Option<u32>,
    /// Só monta os comandos, sem push nem gh.
    #[serde(default)]
    pub dry_run: bool,
}

pub fn pr_args(base: &str, o: &PrOptions) -> Vec<String> {
    let mut a: Vec<String> = ["pr", "create", "--base", base, "--title", &o.title, "--body", &o.body].iter().map(|s| s.to_string()).collect();
    if o.draft {
        a.push("--draft".into());
    }
    for l in &o.labels {
        a.extend(["--label".into(), l.clone()]);
    }
    a
}

#[derive(Debug, Clone, Serialize)]
pub struct PrResult {
    pub url: Option<String>,
    pub commands: Vec<String>,
    pub dry_run: bool,
}

pub fn create_pr(repo: &Repo, ws: &Workspace, o: &PrOptions) -> Result<PrResult> {
    let p = Path::new(&ws.path);
    let mut base = ws.target_branch.clone().unwrap_or_else(|| repo.default_branch.clone());
    if let Some(n) = o.stack_on {
        let out = Command::new("gh").args(["pr", "view", &n.to_string(), "--json", "headRefName", "-q", ".headRefName"]).current_dir(p).output().context("gh pr view")?;
        anyhow::ensure!(out.status.success(), "PR #{n} não encontrado: {}", String::from_utf8_lossy(&out.stderr).trim());
        base = String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    let args = pr_args(&base, o);
    let commands = vec!["git push -u origin HEAD".to_string(), format!("gh {}", args.iter().map(|a| crate::harness::shell_quote(a)).collect::<Vec<_>>().join(" "))];
    if o.dry_run {
        return Ok(PrResult { url: None, commands, dry_run: true });
    }
    git(p, &["push", "-u", "origin", "HEAD"])?;
    let out = Command::new("gh").args(&args).current_dir(p).output().context("falha ao executar gh")?;
    if !out.status.success() {
        bail!("gh pr create: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(PrResult { url: Some(crate::harness::find_urls(&text).into_iter().next().unwrap_or_else(|| text.trim().to_string())), commands, dry_run: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cidades() {
        assert_eq!(pick_city(&|_| false), "kabul");
        assert_eq!(pick_city(&|c| c == "kabul"), "lisboa");
        assert_eq!(pick_city(&|c| CIDADES.contains(&c)), "kabul-2");
    }

    #[test]
    fn ciclo_repo_workspace_diff() {
        let tmp = std::env::temp_dir().join(format!("kabul-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let repo = tmp.join("meu-repo");
        std::fs::create_dir_all(&repo).unwrap();
        let g = |d: &Path, a: &[&str]| assert!(Command::new("git").arg("-C").arg(d).args(a).output().unwrap().status.success(), "{a:?}");
        g(&repo, &["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("a.txt"), "um\n").unwrap();
        g(&repo, &["add", "."]);
        std::fs::write(repo.join(".gitignore"), ".env*\n").unwrap();
        g(&repo, &["add", "."]);
        g(&repo, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "ignore"]);
        std::fs::write(repo.join(".env.local"), "SEGREDO=1\n").unwrap();

        let mut s = Store::open(tmp.join("state.json"), tmp.join("ws"), "val".into()).unwrap();
        let r = s.add_repo(&repo).unwrap();
        assert_eq!(r.name, "meu-repo");
        assert_eq!(r.default_branch, "main");
        let w = s.create_workspace(&r.id).unwrap();
        assert_eq!((w.name.as_str(), w.branch.as_str()), ("kabul", "val/kabul"));
        assert_eq!(w.files_copied, 1);
        assert!(Path::new(&w.path).join(".env.local").exists());
        let w2 = s.create_workspace(&r.id).unwrap();
        assert_eq!(w2.name, "lisboa");

        std::fs::write(Path::new(&w.path).join("a.txt"), "dois\n").unwrap();
        let d = diff(&r, &w).unwrap();
        assert_eq!(d.base_ref, "main");
        assert!(d.patch.contains("+dois"), "{}", d.patch);
        std::fs::write(Path::new(&w.path).join(".context/log.txt"), "fora do git").unwrap();
        std::fs::write(Path::new(&w.path).join("novo.txt"), "x\ny\n").unwrap();
        let ch = changes(&r, &w).unwrap();
        assert_eq!(ch[0], FileChange { path: "a.txt".into(), added: Some(1), removed: Some(1), untracked: false });
        assert_eq!((ch[1].path.as_str(), ch[1].added, ch[1].untracked), ("novo.txt", Some(2), true));
        assert!(file_diff(&r, &w, "novo.txt").unwrap().contains("+y"));
        std::fs::remove_file(Path::new(&w.path).join("novo.txt")).unwrap();

        // Recarrega do disco.
        let s2 = Store::open(tmp.join("state.json"), tmp.join("ws"), "val".into()).unwrap();
        assert_eq!(s2.state.workspaces.len(), 2);

        // Arquivar guarda as mudanças num checkpoint; desarquivar devolve.
        std::fs::write(Path::new(&w.path).join(".context/nota.md"), "x").unwrap();
        s.archive_workspace(&w.id).unwrap();
        assert!(!Path::new(&w.path).exists());
        let back = s.unarchive_workspace(&w.id).unwrap();
        assert!(!back.archived);
        assert_eq!(std::fs::read_to_string(Path::new(&w.path).join("a.txt")).unwrap(), "dois\n");
        assert!(Path::new(&w.path).join(".context/nota.md").exists());
        assert!(w.env(&r).contains(&("CONDUCTOR_PORT".into(), w.port.to_string())));
        assert_ne!(w.port, w2.port);
        // Arquivar apagando a branch: desarquivar recria a branch no HEAD do checkpoint.
        let head2 = git(Path::new(&w2.path), &["rev-parse", "HEAD"]).unwrap();
        s.archive_workspace_opts(&w2.id, true).unwrap();
        assert!(git(&repo, &["rev-parse", "--verify", "-q", "refs/heads/val/lisboa"]).is_err());
        s.unarchive_workspace(&w2.id).unwrap();
        assert_eq!(git(Path::new(&w2.path), &["rev-parse", "HEAD"]).unwrap(), head2);
        assert_eq!(prefixed("", "oslo"), "oslo");
        s.archive_workspace(&w2.id).unwrap();
        assert!(!Path::new(&w2.path).exists());
        assert!(s.workspace(&w2.id).unwrap().archived);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn args_pr() {
        let o = PrOptions { title: "t".into(), body: "b".into(), draft: true, labels: vec!["x".into()], ..Default::default() };
        assert_eq!(pr_args("main", &o), vec!["pr", "create", "--base", "main", "--title", "t", "--body", "b", "--draft", "--label", "x"]);
        assert_eq!(slug("Corrigir o botão de Login!!"), "corrigir-o-botao-de-login");
    }
}
