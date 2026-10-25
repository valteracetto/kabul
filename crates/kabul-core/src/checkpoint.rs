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

/// Pastas pesadas que nunca entram num checkpoint quando aparecem como não rastreadas (projeto que
/// esqueceu de ignorá-las): sem isso, um `node_modules/` fora do `.gitignore` viraria GBs de objetos.
const HEAVY: &[&str] = &["node_modules", "target", ".next", ".nuxt", ".turbo", ".venv", "venv", "__pycache__", ".gradle", ".cache", ".parcel-cache", "Pods", "DerivedData"];

/// Pastas pesadas não rastreadas e não ignoradas (relativas a `dir`).
fn heavy_untracked(dir: &Path) -> Vec<String> {
    let Ok(out) = git(dir, &["ls-files", "-z", "--others", "--exclude-standard", "--directory", "--no-empty-directory"], &[]) else { return vec![] };
    out.split('\0').filter_map(|l| l.strip_suffix('/')).filter(|d| HEAVY.contains(&d.rsplit('/').next().unwrap_or(d))).map(String::from).collect()
}

/// Checkpoint com a mesma árvore, o mesmo HEAD e a mesma mensagem (nada mudou desde ele): reaproveitado.
fn same_as_existing(dir: &Path, tree: &str, head: &str, message: &str) -> Option<String> {
    let out = git(dir, &["for-each-ref", "--format=%(objectname) %(tree) %(parent) %(subject)", PREFIX], &[]).ok()?;
    out.lines().find_map(|l| {
        let mut it = l.splitn(4, ' ');
        let (c, t, p, m) = (it.next()?, it.next()?, it.next()?, it.next().unwrap_or(""));
        (t == tree && p == head && m == message.lines().next().unwrap_or("")).then(|| c.to_string())
    })
}

/// Grava o checkpoint. Rápido mesmo em árvore grande: o índice temporário parte de uma cópia do índice
/// real (o cache de stat evita reler arquivos que não mudaram), respeita o `.gitignore` e deixa de fora
/// pastas pesadas não rastreadas; se nada mudou desde um checkpoint existente, reaproveita o commit.
pub fn create(dir: &Path, id: &str, message: &str) -> Result<Checkpoint> {
    let b = busy(dir)?;
    if b != "clean" {
        bail!("git ocupado ({b}); checkpoint adiado");
    }
    let head = git(dir, &["rev-parse", "HEAD"], &[])?;
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let idx = std::env::temp_dir().join(format!("kabul-idx-{}-{n}-{}", std::process::id(), crate::paths::safe_file_name(id)));
    let idx_s = idx.to_string_lossy().to_string();
    let env = [("GIT_INDEX_FILE", idx_s.as_str())];
    let real = git(dir, &["rev-parse", "--git-path", "index"], &[]).map(|p| if Path::new(&p).is_absolute() { std::path::PathBuf::from(p) } else { dir.join(p) });
    let mut add: Vec<String> = ["add", "-A", "--", "."].iter().map(|s| s.to_string()).collect();
    add.extend(heavy_untracked(dir).into_iter().map(|d| format!(":(exclude,literal){d}")));
    let add: Vec<&str> = add.iter().map(String::as_str).collect();
    let stage = |seed: bool| -> Result<String> {
        std::fs::remove_file(&idx).ok();
        if !(seed && real.as_ref().is_ok_and(|r| std::fs::copy(r, &idx).is_ok())) {
            git(dir, &["read-tree", "HEAD"], &env)?;
        }
        git(dir, &add, &env)?;
        git(dir, &["write-tree"], &env)
    };
    // Índice copiado no meio de uma escrita (ou corrompido): refaz a partir do HEAD.
    let tree = stage(true).or_else(|_| stage(false));
    std::fs::remove_file(&idx).ok();
    let tree = tree?;
    let commit = match same_as_existing(dir, &tree, &head, message) {
        Some(c) => c,
        None => git(dir, &["-c", "user.name=kabul", "-c", "user.email=kabul@local", "commit-tree", &tree, "-p", &head, "-m", message], &[])?,
    };
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
        // O Git for Windows vem com `core.autocrlf=true` no config do sistema: o checkout devolveria
        // `2\r\n`. O teste confere o conteúdo exato, então fixa o LF.
        g(&["config", "core.autocrlf", "false"]);
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
        // Pasta pesada não ignorada fica fora; sem mudança desde o último, o commit é reaproveitado.
        std::fs::create_dir_all(d.join("node_modules/pkg")).unwrap();
        std::fs::write(d.join("node_modules/pkg/i.js"), "x").unwrap();
        std::fs::write(d.join("solto.txt"), "s\n").unwrap();
        let a = create(&d, "t2", "turno 2").unwrap();
        let files = git(&d, &["ls-tree", "-r", "--name-only", &a.commit], &[]).unwrap();
        assert!(files.contains("solto.txt") && !files.contains("node_modules"), "{files}");
        let b = create(&d, "t3", "turno 2").unwrap();
        assert_eq!(a.commit, b.commit, "nada mudou: reaproveita");
        assert_ne!(create(&d, "t4", "outro").unwrap().commit, a.commit, "mensagem diferente: commit novo");
        std::fs::write(d.join("solto.txt"), "mudou\n").unwrap();
        assert_ne!(create(&d, "t5", "turno 2").unwrap().commit, a.commit);
        std::fs::create_dir_all(d.join(".git/rebase-merge")).unwrap();
        assert_eq!(busy(&d).unwrap(), "busy:rebase");
        assert!(restore(&d, "t1").is_err());
        std::fs::remove_dir_all(&d).ok();
    }
}
