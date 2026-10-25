//! Checkpoints em refs privadas (`refs/kabul-checkpoints/<id>`), sem mexer em HEAD nem na árvore.
//! O commit do checkpoint guarda a árvore inteira (inclui não rastreados) e tem HEAD como pai.
//! Restaurar volta HEAD + árvore (inclusive apagando arquivos criados depois). Recusa durante merge/rebase.
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;

fn git(dir: &Path, args: &[&str], env: &[(&str, &str)]) -> Result<String> {
    let o = crate::shell::command("git").arg("-C").arg(dir).args(args).envs(env.iter().copied()).output().context("git")?;
    if !o.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// `clean` ou `busy:<operação>` (merge, rebase, cherry-pick, revert).
pub fn busy(dir: &Path) -> Result<String> {
    for (marker, what) in [("MERGE_HEAD", "merge"), ("rebase-merge", "rebase"), ("rebase-apply", "rebase"), ("CHERRY_PICK_HEAD", "cherry-pick"), ("REVERT_HEAD", "revert")] {
        let p = git(dir, &["rev-parse", "--git-path", marker], &[])?;
        let p = if Path::new(&p).is_absolute() { p.into() } else { dir.join(p) };
        if p.exists() {
            return Ok(format!("busy:{what}"));
        }
    }
    Ok("clean".into())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Checkpoint {
    pub id: String,
    pub commit: String,
    pub head: String,
    pub message: String,
    pub created_at: u64,
}

const PREFIX: &str = "refs/kabul-checkpoints/";

pub fn create(dir: &Path, id: &str, message: &str) -> Result<Checkpoint> {
    if busy(dir)? != "clean" {
        bail!("git ocupado ({}); checkpoint adiado", busy(dir)?);
    }
    let head = git(dir, &["rev-parse", "HEAD"], &[])?;
    let idx = std::env::temp_dir().join(format!("kabul-idx-{}-{id}", std::process::id()));
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    git(dir, &["read-tree", "HEAD"], &env)?;
    git(dir, &["add", "-A"], &env)?;
    let tree = git(dir, &["write-tree"], &env)?;
    std::fs::remove_file(&idx).ok();
    let commit = git(dir, &["-c", "user.name=kabul", "-c", "user.email=kabul@local", "commit-tree", &tree, "-p", &head, "-m", message], &[])?;
    git(dir, &["update-ref", &format!("{PREFIX}{id}"), &commit], &[])?;
    let created_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    Ok(Checkpoint { id: id.into(), commit, head, message: message.into(), created_at })
}

pub fn list(dir: &Path) -> Result<Vec<Checkpoint>> {
    let out = git(dir, &["for-each-ref", "--sort=-creatordate", "--format=%(refname)\t%(objectname)\t%(creatordate:unix)\t%(subject)", PREFIX], &[])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.splitn(4, '\t').collect();
            let commit = f.get(1)?.to_string();
            let head = git(dir, &["rev-parse", &format!("{commit}^")], &[]).ok()?;
            Some(Checkpoint { id: f[0].trim_start_matches(PREFIX).into(), commit, head, created_at: f.get(2)?.parse().ok()?, message: f.get(3).unwrap_or(&"").to_string() })
        })
        .collect())
}

/// Volta o worktree ao checkpoint: HEAD original, árvore exata (arquivos novos depois são removidos).
pub fn restore(dir: &Path, id: &str) -> Result<()> {
    let b = busy(dir)?;
    if b != "clean" {
        bail!("restauração recusada: {b}");
    }
    let commit = git(dir, &["rev-parse", &format!("{PREFIX}{id}")], &[])?;
    let head = git(dir, &["rev-parse", &format!("{commit}^")], &[])?;
    git(dir, &["reset", "-q", "--hard", &head], &[])?;
    git(dir, &["clean", "-fdq"], &[])?;
    git(dir, &["read-tree", "-u", "--reset", &commit], &[])?;
    git(dir, &["reset", "-q", &head], &[])?;
    Ok(())
}

pub fn delete(dir: &Path, id: &str) -> Result<()> {
    git(dir, &["update-ref", "-d", &format!("{PREFIX}{id}")], &[]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cria_e_restaura() {
        let d = std::env::temp_dir().join(format!("kabul-ckpt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let g = |a: &[&str]| git(&d, a, &[]).unwrap();
        g(&["init", "-q", "-b", "main"]);
        std::fs::write(d.join("a.txt"), "1\n").unwrap();
        g(&["add", "."]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i"]);
        std::fs::write(d.join("a.txt"), "2\n").unwrap();
        std::fs::write(d.join("novo.txt"), "n\n").unwrap();
        let c = create(&d, "t1", "turno 1").unwrap();
        assert_eq!(git(&d, &["status", "--porcelain"], &[]).unwrap().lines().count(), 2, "checkpoint não mexe na árvore");
        std::fs::write(d.join("a.txt"), "3\n").unwrap();
        std::fs::remove_file(d.join("novo.txt")).unwrap();
        std::fs::write(d.join("depois.txt"), "x\n").unwrap();
        g(&["add", "."]);
        g(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "depois"]);
        restore(&d, "t1").unwrap();
        assert_eq!(std::fs::read_to_string(d.join("a.txt")).unwrap(), "2\n");
        assert!(d.join("novo.txt").exists());
        assert!(!d.join("depois.txt").exists());
        assert_eq!(git(&d, &["rev-parse", "HEAD"], &[]).unwrap(), c.head);
        assert_eq!(list(&d).unwrap()[0].message, "turno 1");
        std::fs::create_dir_all(d.join(".git/rebase-merge")).unwrap();
        assert_eq!(busy(&d).unwrap(), "busy:rebase");
        assert!(restore(&d, "t1").is_err());
        std::fs::remove_dir_all(&d).ok();
    }
}
