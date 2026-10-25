//! `git worktree add/list/remove`.
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = crate::shell::command("git").arg("-C").arg(repo).args(args).output().context("falha ao executar git")?;
    if !out.status.success() {
        bail!("git {:?}: {}", args, String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Parse de `git worktree list --porcelain`.
pub fn parse_porcelain(out: &str) -> Vec<Worktree> {
    let mut v = vec![];
    let mut cur: Option<Worktree> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() {
                v.push(w);
            }
            cur = Some(Worktree { path: p.into(), ..Default::default() });
        } else if let Some(w) = cur.as_mut() {
            if let Some(h) = line.strip_prefix("HEAD ") {
                w.head = Some(h.into());
            } else if let Some(b) = line.strip_prefix("branch ") {
                w.branch = Some(b.trim_start_matches("refs/heads/").into());
            } else if line == "bare" {
                w.bare = true;
            } else if line == "detached" {
                w.detached = true;
            }
        }
    }
    v.extend(cur);
    v
}

pub fn list(repo: &Path) -> Result<Vec<Worktree>> {
    Ok(parse_porcelain(&git(repo, &["worktree", "list", "--porcelain"])?))
}

/// Cria worktree em `path` com branch nova `branch` a partir de `base` (ex.: `origin/main`).
pub fn add(repo: &Path, path: &Path, branch: &str, base: Option<&str>) -> Result<()> {
    anyhow::ensure!(crate::store::valid_branch(branch), "nome de branch inválido: {branch:?}");
    let p = path.to_string_lossy();
    let mut args = vec!["worktree", "add", "-b", branch, p.as_ref()];
    if let Some(b) = base {
        anyhow::ensure!(!b.starts_with('-'), "base inválida: {b:?}");
        args.push(b);
    }
    git(repo, &args).map(|_| ())
}

pub fn remove(repo: &Path, path: &Path, force: bool) -> Result<()> {
    let p = path.to_string_lossy();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(p.as_ref());
    git(repo, &args).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse() {
        let out = "worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/wt\nHEAD def\ndetached\n";
        let w = parse_porcelain(out);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].branch.as_deref(), Some("main"));
        assert!(w[1].detached);
    }

    #[test]
    fn ciclo_real() {
        let tmp = std::env::temp_dir().join(format!("kabul-wt-{}", std::process::id()));
        let repo = tmp.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let g = |a: &[&str]| assert!(crate::shell::command("git").arg("-C").arg(&repo).args(a).output().unwrap().status.success(), "{a:?}");
        g(&["init", "-q", "-b", "main"]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i"]);
        let wt = tmp.join("wt");
        add(&repo, &wt, "feat", None).unwrap();
        assert!(list(&repo).unwrap().iter().any(|w| w.branch.as_deref() == Some("feat")));
        remove(&repo, &wt, false).unwrap();
        assert_eq!(list(&repo).unwrap().len(), 1);
        std::fs::remove_dir_all(&tmp).ok();
    }
}
