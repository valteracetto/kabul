//! Adicionar projeto pelo GitHub ("Abrir projeto do GitHub") e "Início rápido": lista os repos da
//! conta conectada (usuário e organizações), clona com progresso e cria um projeto novo do zero.
//! Os comandos `gh`/`git` recebem o ambiente do perfil de GitHub ativo (GH_CONFIG_DIR/GH_TOKEN).
use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GhRepo {
    pub name_with_owner: String,
    pub owner: String,
    pub private: bool,
    pub updated_at: String,
    pub url: String,
    pub description: Option<String>,
    pub avatar: String,
}

fn gh() -> String {
    crate::harness::which("gh").map(|p| p.display().to_string()).unwrap_or_else(|| "gh".into())
}

pub const REPO_FIELDS: &str = "nameWithOwner,isPrivate,updatedAt,url,description,owner";

pub fn parse_repo_list(json: &str) -> Vec<GhRepo> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let nwo = r.get("nameWithOwner")?.as_str()?.to_string();
            let owner = r.get("owner").and_then(|o| o.get("login")).and_then(Value::as_str).map(String::from).unwrap_or_else(|| nwo.split('/').next().unwrap_or("").to_string());
            Some(GhRepo {
                avatar: format!("https://github.com/{owner}.png?size=40"),
                owner,
                private: r.get("isPrivate").and_then(Value::as_bool).unwrap_or(false),
                updated_at: r.get("updatedAt").and_then(Value::as_str).unwrap_or("").into(),
                url: r.get("url").and_then(Value::as_str).unwrap_or("").into(),
                description: r.get("description").and_then(Value::as_str).filter(|d| !d.is_empty()).map(String::from),
                name_with_owner: nwo,
            })
        })
        .collect()
}

fn gh_out(env: &[(String, String)], args: &[&str]) -> Result<String> {
    let o = crate::shell::command(gh()).args(args).envs(env.iter().cloned()).output().context("gh não encontrado")?;
    if !o.status.success() {
        bail!("{}", friendly_error(&String::from_utf8_lossy(&o.stderr)));
    }
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

/// Repos do usuário e das organizações dele, mais recentes primeiro.
pub fn list_repos(env: &[(String, String)], limit: u32) -> Result<Vec<GhRepo>> {
    let lim = limit.to_string();
    let mut all = parse_repo_list(&gh_out(env, &["repo", "list", "--json", REPO_FIELDS, "--limit", &lim])?);
    // Organizações: se faltar o escopo read:org, segue só com os repos pessoais.
    if let Ok(orgs) = gh_out(env, &["api", "user/orgs", "-q", ".[].login"]) {
        for org in orgs.lines().map(str::trim).filter(|o| !o.is_empty()).take(20) {
            if let Ok(j) = gh_out(env, &["repo", "list", org, "--json", REPO_FIELDS, "--limit", &lim]) {
                all.extend(parse_repo_list(&j));
            }
        }
    }
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    all.dedup_by(|a, b| a.name_with_owner == b.name_with_owner);
    Ok(all)
}

/// URL de clone e nome da pasta a partir de `owner/repo`, URL https/ssh ou `github.com/owner/repo`.
pub fn normalize(input: &str) -> Result<(String, String)> {
    let t = input.trim().trim_end_matches('/');
    anyhow::ensure!(!t.is_empty(), "Informe a URL ou owner/repo");
    let url = if t.starts_with("https://") || t.starts_with("http://") || t.starts_with("git@") || t.starts_with("ssh://") || t.starts_with("file://") || t.starts_with('/') {
        t.to_string()
    } else if let Some(rest) = t.strip_prefix("github.com/") {
        format!("https://github.com/{rest}")
    } else if t.split('/').count() == 2 && t.split('/').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))) {
        format!("https://github.com/{t}")
    } else {
        bail!("Não reconheci \"{t}\". Use owner/repo ou a URL do repositório.");
    };
    let name = url.trim_end_matches(".git").rsplit(['/', ':']).next().unwrap_or("repo").to_string();
    anyhow::ensure!(!name.is_empty() && name != "." && name != "..", "nome de repositório inválido");
    Ok((url, name))
}

/// Mensagem legível para os erros mais comuns do clone.
pub fn friendly_error(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("repository not found") || s.contains("not found") && s.contains("repository") || s.contains("could not resolve to a repository") {
        "Repositório não encontrado. Confira a URL e se a conta do GitHub conectada tem acesso.".into()
    } else if s.contains("already exists and is not an empty directory") {
        "A pasta de destino já existe e não está vazia. Escolha outro local.".into()
    } else if s.contains("could not resolve host") || s.contains("unable to access") && s.contains("resolve") {
        "Sem conexão com o GitHub. Verifique a internet e tente de novo.".into()
    } else if s.contains("authentication failed") || s.contains("terminal prompts disabled") || s.contains("permission denied") {
        "O GitHub recusou o acesso. Entre com a conta certa em Configurações › Contas › GitHub.".into()
    } else if s.contains("gh auth login") || s.contains("not logged") {
        "GitHub não conectado. Entre em Configurações › Contas › GitHub.".into()
    } else {
        stderr.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("falha ao clonar").trim().to_string()
    }
}

/// Porcentagem de uma linha de progresso do git ("Receiving objects:  45% (…)").
pub fn progress_pct(line: &str) -> Option<(String, u8)> {
    let (phase, rest) = line.trim_start_matches("remote: ").split_once(':')?;
    let pct = rest.trim().split('%').next()?.trim().parse::<u8>().ok()?;
    Some((phase.trim().to_string(), pct))
}

/// Clona em `dir/<nome>` com `git clone --progress`, usando o `gh` como credencial do github.com.
pub fn clone(input: &str, dir: &Path, env: &[(String, String)], mut on_progress: impl FnMut(&str, u8)) -> Result<PathBuf> {
    let (url, name) = normalize(input)?;
    let dest = dir.join(&name);
    if dest.exists() && std::fs::read_dir(&dest).map(|mut d| d.next().is_some()).unwrap_or(true) {
        bail!("{} já existe. Escolha outro local.", dest.display());
    }
    std::fs::create_dir_all(dir).with_context(|| format!("criando {}", dir.display()))?;
    let helper = format!("credential.https://github.com.helper=!{} auth git-credential", gh());
    let mut child = crate::shell::command("git")
        .args(["-c", "credential.helper=", "-c", &helper, "clone", "--progress", "--", &url])
        .arg(&dest)
        .envs(env.iter().cloned())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("git não encontrado")?;
    let mut err = child.stderr.take().unwrap();
    let mut buf = [0u8; 4096];
    let mut all = String::new();
    let mut line = String::new();
    loop {
        let n = err.read(&mut buf).unwrap_or(0);
        if n == 0 {
            break;
        }
        for ch in String::from_utf8_lossy(&buf[..n]).chars() {
            if ch == '\r' || ch == '\n' {
                if let Some((phase, pct)) = progress_pct(&line) {
                    on_progress(&phase, pct);
                }
                all.push_str(&line);
                all.push('\n');
                line.clear();
            } else {
                line.push(ch);
            }
        }
    }
    all.push_str(&line);
    if !child.wait()?.success() {
        let _ = std::fs::remove_dir_all(&dest);
        bail!("{}", friendly_error(&all));
    }
    Ok(dest)
}

/// "Início rápido": pasta nova com `git init`, README e o primeiro commit.
pub fn quick_start(dir: &Path, name: &str) -> Result<PathBuf> {
    let name = name.trim();
    anyhow::ensure!(!name.is_empty() && !name.contains('/') && name != "." && name != "..", "nome de projeto inválido");
    let dest = dir.join(name);
    anyhow::ensure!(!dest.exists(), "{} já existe", dest.display());
    std::fs::create_dir_all(&dest)?;
    std::fs::write(dest.join("README.md"), format!("# {name}\n"))?;
    std::fs::write(dest.join(".gitignore"), ".env*\n.DS_Store\nnode_modules/\ntarget/\n")?;
    for args in [vec!["init", "-q", "-b", "main"], vec!["add", "."], vec!["-c", "user.name=Kabul", "-c", "user.email=kabul@localhost", "commit", "-qm", "Início"]] {
        let o = crate::shell::command("git").arg("-C").arg(&dest).args(&args).output()?;
        if !o.status.success() {
            bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
        }
    }
    Ok(dest)
}

/// `~` no começo vira a pasta do usuário.
pub fn expand_home(p: &str) -> PathBuf {
    match p.strip_prefix('~') {
        Some(rest) if !crate::paths::home().as_os_str().is_empty() => crate::paths::home().join(rest.trim_start_matches(['/', '\\'])),
        _ => PathBuf::from(p),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_lista_e_erros() {
        assert_eq!(normalize("dev/demo").unwrap(), ("https://github.com/dev/demo".into(), "demo".into()));
        assert_eq!(normalize("https://github.com/dev/demo.git").unwrap().1, "demo");
        assert_eq!(normalize("git@github.com:dev/demo.git").unwrap().1, "demo");
        assert_eq!(normalize("github.com/dev/demo").unwrap().0, "https://github.com/dev/demo");
        assert!(normalize("isso não é repo").is_err());
        let l = parse_repo_list(r#"[{"nameWithOwner":"dev/app","isPrivate":true,"updatedAt":"2026-10-01T00:00:00Z","url":"https://github.com/dev/app","description":"","owner":{"login":"dev"}}]"#);
        assert_eq!((l[0].owner.as_str(), l[0].private, l[0].description.clone(), l[0].avatar.as_str()), ("dev", true, None, "https://github.com/dev.png?size=40"));
        assert!(friendly_error("remote: Repository not found.\nfatal: repository 'x' not found").starts_with("Repositório não encontrado"));
        assert_eq!(progress_pct("Receiving objects:  45% (9/20)"), Some(("Receiving objects".into(), 45)));
        assert_eq!(progress_pct("remote: Counting objects: 100% (3/3), done."), Some(("Counting objects".into(), 100)));
    }

    #[test]
    fn clona_local_com_progresso_e_inicio_rapido() {
        let tmp = std::env::temp_dir().join(format!("kabul-clone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let src = quick_start(&tmp, "origem").unwrap();
        assert!(src.join(".git").exists() && src.join("README.md").exists());
        assert!(quick_start(&tmp, "origem").is_err());
        let mut phases = 0;
        let dest = clone(&format!("file://{}", src.display()), &tmp.join("clones"), &[], |_, _| phases += 1).unwrap();
        assert_eq!(dest, tmp.join("clones/origem"));
        assert!(dest.join("README.md").exists());
        let e = clone(&format!("file://{}", src.display()), &tmp.join("clones"), &[], |_, _| {}).unwrap_err();
        assert!(e.to_string().contains("já existe"), "{e}");
        assert!(clone(&format!("file://{}/nada", tmp.display()), &tmp.join("c2"), &[], |_, _| {}).is_err());
        std::fs::remove_dir_all(&tmp).ok();
    }
}
