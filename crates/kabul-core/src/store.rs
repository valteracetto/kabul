//! Repos e workspaces do Kabul (JSON em disco). Workspace = git worktree + branch `<prefixo>/<cidade>`.
use crate::worktree;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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

    /// Variáveis para scripts e agentes (KABUL_* e, por compatibilidade, o prefixo legado de `crate::compat`).
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
        let legacy = crate::compat::legacy_env_prefix();
        vals.iter().flat_map(|(k, v)| [(format!("KABUL_{k}"), v.clone()), (format!("{legacy}{k}"), v.clone())]).collect()
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
    /// Versão do formato (ver `crate::schema`); ausente = 0.
    #[serde(default)]
    pub schema_version: u32,
    pub repos: Vec<Repo>,
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub comments: Vec<DiffComment>,
    #[serde(default)]
    pub sections: Vec<Section>,
}

pub const CIDADES: &[&str] = &[
    "kabul",
    "lisboa",
    "cusco",
    "quito",
    "oslo",
    "lima",
    "praga",
    "tunis",
    "sofia",
    "riga",
    "baku",
    "dakar",
    "hanoi",
    "kyoto",
    "porto",
    "recife",
    "belem",
    "natal",
    "manaus",
    "goiania",
    "cairo",
    "accra",
    "nairobi",
    "lagos",
    "tbilisi",
    "yerevan",
    "almaty",
    "tashkent",
    "samarcanda",
    "bukhara",
    "herat",
    "mascate",
    "doha",
    "amman",
    "beirute",
    "esmirna",
    "split",
    "zagreb",
    "ljubljana",
    "bratislava",
    "viena",
    "berna",
    "gante",
    "bruges",
    "leiden",
    "bergen",
    "tromso",
    "reykjavik",
    "dublin",
    "galway",
    "cork",
    "sevilha",
    "granada",
    "cadiz",
    "valparaiso",
    "salta",
    "mendoza",
    "cordoba",
    "rosario",
    "montevideu",
    "assuncao",
    "lapaz",
    "sucre",
    "bogota",
    "cartagena",
    "medellin",
    "havana",
    "oaxaca",
    "merida",
    "puebla",
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
    let o = crate::shell::command("git").arg("-C").arg(dir).args(args).output().context("falha ao executar git")?;
    if !o.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string())
}

/// `<prefixo>/<nome>`; prefixo vazio ("None") vira só o nome.
pub fn prefixed(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
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
    /// Estado em Application Support (macOS), `%APPDATA%\kabul` (Windows) ou `~/.local/share/kabul`;
    /// worktrees em `~/kabul/workspaces`.
    pub fn default_paths() -> (PathBuf, PathBuf) {
        let home = crate::paths::home();
        (crate::paths::state_dir().join("state.json"), home.join("kabul").join("workspaces"))
    }

    pub fn open(file: PathBuf, root: PathBuf, branch_prefix: String) -> Result<Self> {
        let mut state: State = match std::fs::read_to_string(&file) {
            Ok(s) => {
                let mut doc: serde_json::Value = serde_json::from_str(&s).with_context(|| format!("lendo {}", file.display()))?;
                match crate::schema::migrate(&mut doc, crate::schema::STATE, crate::schema::STATE_MIGRATIONS)? {
                    crate::schema::Outcome::Current => {}
                    crate::schema::Outcome::Migrated { from } => crate::schema::backup(&file, from),
                    crate::schema::Outcome::Newer { found } => {
                        crate::schema::backup(&file, found);
                        eprintln!("kabul: {} é de um Kabul mais novo (formato v{found}); backup em .v{found}.bak", file.display());
                    }
                }
                serde_json::from_value(doc).with_context(|| format!("lendo {}", file.display()))?
            }
            Err(_) => State::default(),
        };
        state.schema_version = crate::schema::STATE;
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

    /// Ref base para worktree e diff: `<remote>/<base>` se existir, senão `<base>`. Base e remote vêm
    /// de Configurações › Git do repo (padrões: a branch padrão e `origin`).
    pub fn base_ref(repo: &Repo) -> String {
        let (s, _) = crate::settings::load(Path::new(&repo.path), &repo.default_branch);
        let base = s.base_branch.filter(|b| !b.trim().is_empty()).unwrap_or_else(|| repo.default_branch.clone());
        let remote = format!("{}/{base}", s.remote.as_deref().filter(|r| !r.trim().is_empty()).unwrap_or("origin"));
        if git(Path::new(&repo.path), &["rev-parse", "--verify", "-q", &remote]).is_ok() {
            remote
        } else {
            base
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
        let used = |c: &str| self.state.workspaces.iter().any(|w| w.repo_id == repo.id && w.name == c) || dir.join(c).exists() || git(rp, &["rev-parse", "--verify", "-q", &format!("refs/heads/{}", prefixed(&self.branch_prefix, c))]).is_ok();
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
        anyhow::ensure!(valid_branch(&local), "nome de branch inválido: {local:?}");
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
        let w = Workspace {
            id: id(),
            repo_id: repo.id,
            name: city,
            branch: local,
            path: p,
            archived: false,
            created_at: now(),
            title: None,
            status: default_status(),
            state: "ready".into(),
            pinned: false,
            notes: String::new(),
            port: self.free_port(),
            target_branch: settings.target_branch,
            pr_url: None,
            archive_checkpoint: None,
            user_set_branch: true,
            files_copied,
            linear: None,
            ..Default::default()
        };
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
    /// Primeira mensagem: renomeia a branch `<prefixo>/<cidade>` para um slug da mensagem (se o usuário
    /// não fixou o nome). Com `rename_ws`, o título do workspace acompanha a branch.
    pub fn auto_branch(&mut self, id: &str, text: &str, rename_ws: bool) -> Result<Option<Workspace>> {
        let w = self.workspace(id)?.clone();
        if w.user_set_branch || !(w.branch == w.name || w.branch.ends_with(&format!("/{}", w.name))) {
            return Ok(None);
        }
        let s = slug(text);
        if s.len() < 3 {
            return Ok(None);
        }
        let prefix = w.branch.rsplit_once('/').map(|(p, _)| p.to_string()).unwrap_or_default();
        let mut out = self.rename_branch(id, &prefixed(&prefix, &s), false)?;
        if rename_ws && out.title.is_none() {
            let t = s.replace('-', " ");
            let t = t[..1].to_uppercase() + &t[1..];
            out = self.update_workspace(id, |x| x.title = Some(t))?;
        }
        Ok(Some(out))
    }

    /// Depois do merge: status "done" e, com `archive`, arquiva (apagando a branch se pedido).
    pub fn after_merge(&mut self, id: &str, archive: bool, delete_branch: bool) -> Result<Workspace> {
        let w = self.update_workspace(id, |x| x.status = "done".into())?;
        if archive && !w.archived {
            return self.archive_workspace_opts(id, delete_branch);
        }
        Ok(w)
    }

    pub fn rename_branch(&mut self, id: &str, new: &str, by_user: bool) -> Result<Workspace> {
        let w = self.workspace(id)?.clone();
        let new = new.trim();
        anyhow::ensure!(valid_branch(new), "nome de branch inválido: {new:?}");
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
        // `--upload-pack=...` ou `-c ...` no lugar da URL viraria opção do git (execução de comando).
        anyhow::ensure!(!url.is_empty() && !url.starts_with('-') && !url.chars().any(char::is_control), "URL de repositório inválida");
        let name = url.trim_end_matches('/').trim_end_matches(".git").rsplit(['/', ':']).next().unwrap_or("repo").to_string();
        let dest = self.root.parent().unwrap_or(&self.root).join("repos").join(&name);
        anyhow::ensure!(!dest.exists(), "{} já existe", dest.display());
        std::fs::create_dir_all(dest.parent().unwrap())?;
        let o = crate::shell::command("git").args(["clone", "--", url]).arg(&dest).output().context("git clone")?;
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
    // O nome da branch vem do autor do PR (pode ser de um fork): inválido ou já existente aqui (ex.:
    // `main`) vira `pr-N`, para o fetch nunca mexer numa branch local que não é do PR.
    let taken = |b: &str| git(repo, &["rev-parse", "--verify", "-q", &format!("refs/heads/{b}")]).is_ok();
    let local = if head.is_empty() || !valid_branch(head) || taken(head) { format!("pr-{number}") } else { head.to_string() };
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
    // Nome único por chamada (duas cópias no mesmo segundo não podem dividir o arquivo de padrões).
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pf = std::env::temp_dir().join(format!("kabul-include-{}-{}-{n}", std::process::id(), now_nanos()));
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
    let tmp = std::env::temp_dir().join(format!("kabul-att-{}", now())).join(crate::paths::safe_file_name(name));
    std::fs::create_dir_all(tmp.parent().unwrap())?;
    std::fs::write(&tmp, data)?;
    attach(ws, &tmp)
}

/// Nome de branch aceitável (regras do `git check-ref-format --branch`, sem chamar o git). Recusa
/// também nome começando com `-`, que viraria opção nos comandos do git e do gh.
pub fn valid_branch(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && !name.starts_with(['-', '/', '.'])
        && !name.ends_with(['/', '.'])
        && !name.ends_with(".lock")
        && name != "@"
        && !name.contains("..")
        && !name.contains("//")
        && !name.contains("@{")
        && !name.contains("/.")
        && !name.chars().any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
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
    let o = crate::shell::command("git").arg("-C").arg(p).args(["diff", "--no-color", "--no-index", "--", "/dev/null", file]).output()?;
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
    /// Liga o auto-merge logo depois de criar (Configurações › Git › Automerge).
    #[serde(default)]
    pub automerge: bool,
    /// Método do auto-merge: squash (padrão), merge ou rebase.
    #[serde(default)]
    pub merge_method: Option<String>,
    /// Acrescenta à descrição o link do workspace no Kabul.
    #[serde(default)]
    pub workspace_link: bool,
    /// `git push -u` (padrão) ou sem gravar o upstream.
    #[serde(default)]
    pub no_upstream: bool,
}

/// Rodapé da descrição do PR com o link do workspace (`kabul://workspace?id=…`).
pub fn pr_body(body: &str, ws: &Workspace) -> String {
    let link = format!("Criado no Kabul: [workspace {}](kabul://workspace?id={})", ws.title.as_deref().unwrap_or(&ws.name), ws.id);
    if body.trim().is_empty() {
        link
    } else {
        format!("{}\n\n---\n{link}", body.trim_end())
    }
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
    let r = create_pr_inner(repo, ws, o);
    crate::gitops::invalidate(&ws.path);
    r
}

fn create_pr_inner(repo: &Repo, ws: &Workspace, o: &PrOptions) -> Result<PrResult> {
    let p = Path::new(&ws.path);
    let mut base = ws.target_branch.clone().unwrap_or_else(|| repo.default_branch.clone());
    if let Some(n) = o.stack_on {
        let out = crate::shell::command("gh").args(["pr", "view", &n.to_string(), "--json", "headRefName", "-q", ".headRefName"]).current_dir(p).output().context("gh pr view")?;
        anyhow::ensure!(out.status.success(), "PR #{n} não encontrado: {}", String::from_utf8_lossy(&out.stderr).trim());
        base = String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    let mut o = o.clone();
    if o.workspace_link {
        o.body = pr_body(&o.body, ws);
    }
    let args = pr_args(&base, &o);
    let remote = crate::gitops::remote(repo);
    let push: Vec<&str> = if o.no_upstream { vec!["push", &remote, "HEAD"] } else { vec!["push", "-u", &remote, "HEAD"] };
    let method = crate::gitops::merge_flag(o.merge_method.as_deref().unwrap_or("squash"));
    let mut commands = vec![format!("git {}", push.join(" ")), format!("gh {}", args.iter().map(|a| crate::harness::shell_quote(a)).collect::<Vec<_>>().join(" "))];
    if o.automerge {
        commands.push(format!("gh pr merge --auto {method}"));
    }
    if o.dry_run {
        return Ok(PrResult { url: None, commands, dry_run: true });
    }
    git(p, &push)?;
    let out = crate::shell::command("gh").args(&args).current_dir(p).output().context("falha ao executar gh")?;
    if !out.status.success() {
        bail!("gh pr create: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    if o.automerge {
        let am = crate::shell::command("gh").args(["pr", "merge", "--auto", method]).current_dir(p).output().context("gh pr merge --auto")?;
        if !am.status.success() {
            bail!("PR criado, mas o auto-merge falhou: {}", String::from_utf8_lossy(&am.stderr).trim());
        }
    }
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
    fn state_sem_versao_migra_com_backup() {
        let tmp = std::env::temp_dir().join(format!("kabul-state-mig-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let f = tmp.join("state.json");
        let v0 = r#"{"repos":[{"id":"r1","name":"app","path":"/x/app","default_branch":"main"}],"workspaces":[]}"#;
        std::fs::write(&f, v0).unwrap();
        let s = Store::open(f.clone(), tmp.join("ws"), "val".into()).unwrap();
        assert_eq!((s.state.schema_version, s.state.repos[0].name.as_str()), (crate::schema::STATE, "app"));
        assert_eq!(std::fs::read_to_string(tmp.join("state.json.v0.bak")).unwrap(), v0);
        s.save().unwrap();
        let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(saved["schema_version"], crate::schema::STATE);
        // De um Kabul mais novo: abre no melhor esforço, com backup do original.
        std::fs::write(&f, r#"{"schema_version":99,"repos":[],"workspaces":[],"coisa_nova":true}"#).unwrap();
        assert!(Store::open(f.clone(), tmp.join("ws"), "val".into()).is_ok());
        assert!(tmp.join("state.json.v99.bak").is_file());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn ciclo_repo_workspace_diff() {
        let tmp = std::env::temp_dir().join(format!("kabul-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let repo = tmp.join("meu-repo");
        std::fs::create_dir_all(&repo).unwrap();
        let g = |d: &Path, a: &[&str]| assert!(crate::shell::command("git").arg("-C").arg(d).args(a).output().unwrap().status.success(), "{a:?}");
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
        assert!(w.env(&r).contains(&("KABUL_PORT".into(), w.port.to_string())));
        assert!(w.env(&r).contains(&(format!("{}PORT", crate::compat::legacy_env_prefix()), w.port.to_string())));
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
    fn primeira_mensagem_merge_e_pr() {
        let tmp = std::env::temp_dir().join(format!("kabul-store2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let repo = tmp.join("r");
        std::fs::create_dir_all(&repo).unwrap();
        let g = |a: &[&str]| assert!(crate::shell::command("git").arg("-C").arg(&repo).args(["-c", "user.name=dev", "-c", "user.email=dev@example.com"]).args(a).output().unwrap().status.success());
        g(&["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("a"), "a").unwrap();
        g(&["add", "."]);
        g(&["commit", "-qm", "i"]);
        let mut s = Store::open(tmp.join("s.json"), tmp.join("ws"), "dev".into()).unwrap();
        let r = s.add_repo(&repo).unwrap();
        // Renomear branch e workspace pela primeira mensagem.
        let w = s.create_workspace(&r.id).unwrap();
        let w = s.auto_branch(&w.id, "Corrigir o login no Safari", true).unwrap().unwrap();
        assert_eq!((w.branch.as_str(), w.title.as_deref()), ("dev/corrigir-o-login-no-safari", Some("Corrigir o login no safari")));
        assert!(s.auto_branch(&w.id, "outra coisa", true).unwrap().is_none(), "só na primeira");
        let w2 = s.create_workspace(&r.id).unwrap();
        let w2 = s.auto_branch(&w2.id, "Exportar PDF", false).unwrap().unwrap();
        assert_eq!((w2.branch.as_str(), w2.title.as_deref()), ("dev/exportar-pdf", None));
        // PR em simulação: link do workspace, sem -u, remote e auto-merge.
        let o = PrOptions { title: "T".into(), body: "corpo".into(), dry_run: true, automerge: true, merge_method: Some("rebase".into()), workspace_link: true, no_upstream: true, ..Default::default() };
        let res = create_pr(&r, &w, &o).unwrap();
        assert_eq!(res.commands[0], "git push origin HEAD");
        assert!(res.commands[1].contains("kabul://workspace?id="), "{}", res.commands[1]);
        assert_eq!(res.commands[2], "gh pr merge --auto --rebase");
        assert!(pr_body("", &w).starts_with("Criado no Kabul"));
        // Depois do merge: concluído; com arquivar, arquiva e apaga a branch.
        assert_eq!(s.after_merge(&w2.id, false, false).unwrap().status, "done");
        let a = s.after_merge(&w.id, true, true).unwrap();
        assert!(a.archived && a.status == "done");
        assert!(git(&repo, &["rev-parse", "--verify", "-q", "refs/heads/dev/corrigir-o-login-no-safari"]).is_err());
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn args_pr() {
        let o = PrOptions { title: "t".into(), body: "b".into(), draft: true, labels: vec!["x".into()], ..Default::default() };
        assert_eq!(pr_args("main", &o), vec!["pr", "create", "--base", "main", "--title", "t", "--body", "b", "--draft", "--label", "x"]);
        assert_eq!(slug("Corrigir o botão de Login!!"), "corrigir-o-botao-de-login");
    }

    /// Segurança: nome de branch vindo do usuário, do Linear ou de um PR de fork não vira opção do git.
    #[test]
    fn nomes_de_branch() {
        for ok in ["main", "dev/eng-12-login", "val/lisboa", "feature/x_y.z", "pr-7"] {
            assert!(valid_branch(ok), "{ok}");
        }
        for bad in ["", "-D", "--upload-pack=x", "a b", "a..b", "a/", "/a", ".a", "a.lock", "a@{1}", "@", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "a\nb", "x/.y"] {
            assert!(!valid_branch(bad), "{bad:?}");
        }
    }

    /// Segurança: a URL do clone não pode virar opção do git (`--upload-pack` roda comando).
    #[test]
    fn clone_recusa_opcao_no_lugar_da_url() {
        let tmp = std::env::temp_dir().join(format!("kabul-clone-inj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let marker = tmp.join("pwned");
        let mut s = Store::open(tmp.join("state.json"), tmp.join("ws"), "val".into()).unwrap();
        let evil = format!("--upload-pack=touch {}", marker.display());
        assert!(s.clone_repo(&evil).is_err());
        assert!(!marker.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Branch de PR com o nome de uma branch local (ex.: `main`) não é atualizada pelo fetch.
    #[test]
    fn fetch_pr_nao_sobrescreve_branch_local() {
        let tmp = std::env::temp_dir().join(format!("kabul-fetchpr-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let (origin, clone) = (tmp.join("origin"), tmp.join("clone"));
        std::fs::create_dir_all(&origin).unwrap();
        let g = |d: &Path, a: &[&str]| assert!(std::process::Command::new("git").arg("-C").arg(d).args(["-c", "user.name=t", "-c", "user.email=t@t"]).args(a).output().unwrap().status.success(), "{a:?}");
        g(&origin, &["init", "-q", "-b", "main"]);
        g(&origin, &["commit", "-q", "--allow-empty", "-m", "i"]);
        g(&tmp, &["clone", "-q", origin.to_str().unwrap(), clone.to_str().unwrap()]);
        g(&origin, &["checkout", "-q", "-b", "fork"]);
        g(&origin, &["commit", "-q", "--allow-empty", "-m", "do pr"]);
        g(&origin, &["update-ref", "refs/pull/7/head", "HEAD"]);
        g(&origin, &["update-ref", "refs/pull/8/head", "HEAD"]);
        let head = |r: &str| String::from_utf8_lossy(&std::process::Command::new("git").arg("-C").arg(&clone).args(["rev-parse", r]).output().unwrap().stdout).trim().to_string();
        let before = head("refs/heads/main");
        let b = fetch_pr(&clone, 7, "main").unwrap();
        assert_eq!(b, "pr-7");
        assert_eq!(head("refs/heads/main"), before, "main local intacta");
        assert_eq!(fetch_pr(&clone, 8, "-x").unwrap(), "pr-8");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
