//! Avatar do dono (organização ou usuário) no GitHub como ícone padrão do repositório.
//!
//! Baixa uma vez, guarda em `<estado>/icons/github/<host>/<dono>.img` por 7 dias e devolve como data URL
//! (o WebView tem CSP estrita: nada de imagem remota direta). Sem rede ou sem `gh`, nada trava: devolve a
//! última imagem baixada (mesmo vencida) ou nenhuma, e a interface mostra a letra colorida.
use crate::store::Repo;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Validade da imagem em cache.
pub const TTL: Duration = Duration::from_secs(7 * 86_400);
/// Depois de uma falha (offline, dono sem avatar), espera isto antes de tentar de novo.
pub const MISS_TTL: Duration = Duration::from_secs(3_600);
/// Maior imagem aceita (avatar com `s=64` tem poucos KB).
const MAX_BYTES: usize = 1 << 20;

/// Dono do repositório num servidor GitHub (github.com ou GitHub Enterprise).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GhOwner {
    pub host: String,
    pub owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoAvatar {
    pub host: String,
    pub owner: String,
    /// `data:image/...;base64,...`; `None` enquanto não houver imagem (offline, falha).
    pub data_url: Option<String>,
}

fn valid_owner(o: &str) -> bool {
    !o.is_empty() && o.len() <= 100 && !o.starts_with('.') && o.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && !h.starts_with('.') && h.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'))
}

/// O host é um GitHub? github.com (e apelidos de ssh tipo `github.com-trabalho`), `ssh.github.com`,
/// `*.ghe.com`, `github.<empresa>` ou um host em que o `gh` está logado (`extra`).
fn github_host(host: &str, extra: &[String]) -> Option<String> {
    let h = host.to_ascii_lowercase();
    if h == "github.com" || h == "ssh.github.com" || h == "www.github.com" || h.starts_with("github.com-") || h.starts_with("github.com_") {
        return Some("github.com".into());
    }
    if extra.iter().any(|e| e.eq_ignore_ascii_case(&h)) || h.ends_with(".ghe.com") || h.starts_with("github.") {
        return Some(h);
    }
    None
}

/// Dono a partir da URL do remoto: `https://[user[:token]@]host[:porta]/dono/repo(.git)`, `ssh://git@host[:porta]/dono/repo`,
/// `git://host/dono/repo` e o formato scp `git@host:dono/repo.git`. `extra`: hosts de GitHub Enterprise.
pub fn parse_owner(remote: &str, extra: &[String]) -> Option<GhOwner> {
    let u = remote.trim();
    let (authority, path) = if let Some((_, rest)) = u.split_once("://") {
        rest.split_once('/')?
    } else {
        // scp: [user@]host:caminho (sem barra antes dos dois-pontos).
        let (a, p) = u.split_once(':')?;
        if a.contains('/') {
            return None;
        }
        (a, p)
    };
    let host = authority.rsplit('@').next()?;
    let host = host.split(':').next()?;
    if !valid_host(host) {
        return None;
    }
    let host = github_host(host, extra)?;
    let owner = path.trim_start_matches('/').split('/').next()?;
    // Precisa de dono/repo, não só dono.
    path.trim_start_matches('/').split('/').nth(1).filter(|r| !r.is_empty())?;
    valid_owner(owner).then(|| GhOwner { host, owner: owner.into() })
}

/// Hosts em que o `gh` está configurado (chaves de topo do `hosts.yml`), sem subprocesso.
pub fn gh_hosts() -> Vec<String> {
    let dir = std::env::var_os("GH_CONFIG_DIR").map(PathBuf::from).or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(|x| PathBuf::from(x).join("gh"))).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/gh")));
    dir.and_then(|d| std::fs::read_to_string(d.join("hosts.yml")).ok()).map(|s| parse_hosts_yml(&s)).unwrap_or_default()
}

fn parse_hosts_yml(s: &str) -> Vec<String> {
    s.lines().filter(|l| !l.starts_with([' ', '\t', '#', '-']) && l.trim_end().ends_with(':')).map(|l| l.trim_end().trim_end_matches(':').trim_matches(['"', '\'']).to_string()).filter(|h| valid_host(h)).collect()
}

/// URL do remoto do repo: `origin`, ou o primeiro remoto.
pub fn remote_url(repo: &Path) -> Option<String> {
    let git = |args: &[&str]| crate::shell::command("git").arg("-C").arg(repo).args(args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty());
    git(&["remote", "get-url", "origin"]).or_else(|| {
        let first = git(&["remote"])?.lines().next()?.to_string();
        git(&["remote", "get-url", &first])
    })
}

fn cache_paths(home: &Path, o: &GhOwner) -> (PathBuf, PathBuf) {
    let d = home.join("icons").join("github").join(&o.host);
    (d.join(format!("{}.img", o.owner)), d.join(format!("{}.miss", o.owner)))
}

fn age(p: &Path, now: SystemTime) -> Option<Duration> {
    let m = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(now.duration_since(m).unwrap_or_default())
}

/// Tipo da imagem pelos bytes (o GitHub serve PNG ou JPEG).
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            o.push(if i <= c.len() { T[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    o
}

fn data_url(b: &[u8]) -> Option<String> {
    sniff(b).map(|m| format!("data:{m};base64,{}", b64(b)))
}

fn read_img(p: &Path) -> Option<String> {
    std::fs::read(p).ok().and_then(|b| data_url(&b))
}

fn write_atomic(p: &Path, b: &[u8]) -> Result<()> {
    std::fs::create_dir_all(p.parent().context("caminho sem pasta")?)?;
    let tmp = p.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, b)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

/// Imagem do dono: cache válido (7 dias) → usa; senão busca com `fetch`. Falhou → a imagem vencida, se
/// houver (offline mostra a última); sem nenhuma, marca a falha por 1 h. `refresh` ignora cache e marca.
pub fn resolve(home: &Path, o: &GhOwner, refresh: bool, now: SystemTime, fetch: &dyn Fn(&GhOwner) -> Result<Vec<u8>>) -> Option<String> {
    let (img, miss) = cache_paths(home, o);
    let fresh = |p: &Path, ttl: Duration| age(p, now).is_some_and(|a| a < ttl);
    if !refresh {
        if fresh(&img, TTL) {
            if let Some(u) = read_img(&img) {
                return Some(u);
            }
        } else if fresh(&miss, MISS_TTL) {
            return read_img(&img);
        }
    }
    match fetch(o).and_then(|b| {
        anyhow::ensure!(b.len() <= MAX_BYTES, "avatar grande demais");
        let u = data_url(&b).context("o avatar não é uma imagem")?;
        Ok((b, u))
    }) {
        Ok((b, u)) => {
            let _ = write_atomic(&img, &b);
            let _ = std::fs::remove_file(&miss);
            Some(u)
        }
        Err(_) => {
            let _ = write_atomic(&miss, b"");
            read_img(&img)
        }
    }
}

/// A rede está desligada para avatares (`KABUL_GITHUB_AVATAR=off`: testes e E2E).
pub fn network_off() -> bool {
    matches!(std::env::var("KABUL_GITHUB_AVATAR").as_deref(), Ok("off" | "0" | "false"))
}

fn with_size(url: &str) -> String {
    format!("{url}{}s=64", if url.contains('?') { '&' } else { '?' })
}

fn download(url: &str, token: Option<&str>) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut req = ureq::get(url).timeout(Duration::from_secs(6)).set("User-Agent", "Kabul");
    if let Some(t) = token {
        req = req.set("Authorization", &format!("token {t}"));
    }
    let r = req.call()?;
    let mut b = Vec::new();
    r.into_reader().take(MAX_BYTES as u64 + 1).read_to_end(&mut b)?;
    Ok(b)
}

fn gh(args: &[&str]) -> Option<String> {
    let bin = crate::harness::which("gh").unwrap_or_else(|| "gh".into());
    crate::shell::command(bin).args(args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
}

/// Busca de verdade: github.com pelo `avatars.githubusercontent.com`; se falhar (ou no Enterprise),
/// `gh api users/<dono>` com o login do usuário (orgs privadas). O token do `gh` só vai ao próprio host.
pub fn fetch_real(o: &GhOwner) -> Result<Vec<u8>> {
    if network_off() {
        bail!("rede desligada para avatares");
    }
    if o.host == "github.com" {
        if let Ok(b) = download(&format!("https://avatars.githubusercontent.com/{}?s=64", o.owner), None) {
            return Ok(b);
        }
    }
    let path = format!("users/{}", o.owner);
    let mut args = vec!["api"];
    if o.host != "github.com" {
        args.extend(["--hostname", o.host.as_str()]);
    }
    args.extend([path.as_str(), "--jq", ".avatar_url"]);
    let url = gh(&args).context("gh api sem avatar")?;
    anyhow::ensure!(url.starts_with("https://"), "avatar_url inesperada");
    let same_host = url.trim_start_matches("https://").split(['/', ':']).next().is_some_and(|h| h.eq_ignore_ascii_case(&o.host));
    let token = (o.host != "github.com" && same_host).then(|| gh(&["auth", "token", "--hostname", &o.host])).flatten();
    download(&with_size(&url), token.as_deref())
}

/// Avatar do GitHub de um repo. `None`: repo só local, remoto fora do GitHub ou opção desligada no repo.
pub fn repo_avatar_with(home: &Path, repo: &Repo, remote: Option<&str>, extra_hosts: &[String], refresh: bool, fetch: &dyn Fn(&GhOwner) -> Result<Vec<u8>>) -> Option<RepoAvatar> {
    if repo.github_avatar == Some(false) {
        return None;
    }
    let o = parse_owner(remote?, extra_hosts)?;
    let data_url = resolve(home, &o, refresh, SystemTime::now(), fetch);
    Some(RepoAvatar { host: o.host, owner: o.owner, data_url })
}

/// [`repo_avatar_with`] com o remoto do disco, os hosts do `gh` e a busca de verdade.
pub fn repo_avatar(home: &Path, repo: &Repo, refresh: bool) -> Option<RepoAvatar> {
    if repo.github_avatar == Some(false) {
        return None;
    }
    let remote = remote_url(Path::new(&repo.path));
    repo_avatar_with(home, repo, remote.as_deref(), &gh_hosts(), refresh, &fetch_real)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    fn own(h: &str, o: &str) -> Option<GhOwner> {
        Some(GhOwner { host: h.into(), owner: o.into() })
    }

    #[test]
    fn dono_de_remotos_https_e_ssh() {
        let none: &[String] = &[];
        assert_eq!(parse_owner("https://github.com/valteracetto/kabul.git", none), own("github.com", "valteracetto"));
        assert_eq!(parse_owner("https://github.com/Org-X/app", none), own("github.com", "Org-X"));
        assert_eq!(parse_owner("https://user:ghp_token@github.com/org/app.git", none), own("github.com", "org"));
        assert_eq!(parse_owner("git@github.com:org/app.git", none), own("github.com", "org"));
        assert_eq!(parse_owner("ssh://git@github.com/org/app.git", none), own("github.com", "org"));
        assert_eq!(parse_owner("ssh://git@ssh.github.com:443/org/app.git", none), own("github.com", "org"));
        assert_eq!(parse_owner("git@github.com-trabalho:empresa/app.git", none), own("github.com", "empresa"), "apelido do ~/.ssh/config");
        assert_eq!(parse_owner("git://github.com/org/app", none), own("github.com", "org"));
        // GitHub Enterprise.
        assert_eq!(parse_owner("https://github.empresa.com.br/time/app.git", none), own("github.empresa.com.br", "time"));
        assert_eq!(parse_owner("git@acme.ghe.com:time/app.git", none), own("acme.ghe.com", "time"));
        assert_eq!(parse_owner("https://git.corp.local/time/app.git", none), None, "host desconhecido");
        assert_eq!(parse_owner("https://git.corp.local/time/app.git", &["git.corp.local".into()]), own("git.corp.local", "time"), "host logado no gh");
        // Não é GitHub ou não serve.
        assert_eq!(parse_owner("https://gitlab.com/org/app.git", none), None);
        assert_eq!(parse_owner("/Users/dev/repos/app", none), None);
        assert_eq!(parse_owner("https://github.com/org", none), None, "sem repo");
        assert_eq!(parse_owner("https://github.com/../x", none), None);
        assert_eq!(parse_owner("https://github.com/a%2Fb/x", none), None);
        assert_eq!(parse_owner("", none), None);
    }

    #[test]
    fn hosts_do_gh() {
        let y = "github.com:\n    git_protocol: https\n    users:\n        dev:\nghe.corp.io:\n    user: dev\n# x:\n";
        assert_eq!(parse_hosts_yml(y), vec!["github.com".to_string(), "ghe.corp.io".to_string()]);
    }

    fn tmp(n: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kabul-avatar-{n}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn cache_validade_e_falha() {
        let home = tmp("cache");
        let o = GhOwner { host: "github.com".into(), owner: "org".into() };
        let calls = Cell::new(0);
        let ok = |_: &GhOwner| -> Result<Vec<u8>> {
            calls.set(calls.get() + 1);
            Ok(PNG.to_vec())
        };
        let fail = |_: &GhOwner| -> Result<Vec<u8>> {
            calls.set(calls.get() + 1);
            bail!("offline")
        };
        let now = SystemTime::now();
        let u = resolve(&home, &o, false, now, &ok).unwrap();
        assert!(u.starts_with("data:image/png;base64,"));
        assert!(home.join("icons/github/github.com/org.img").exists());
        // Dentro dos 7 dias: não busca de novo.
        assert_eq!(resolve(&home, &o, false, now + Duration::from_secs(6 * 86_400), &ok), Some(u.clone()));
        assert_eq!(calls.get(), 1);
        // Vencido (imagem de 8 dias atrás): busca; falhou → a imagem antiga (offline mostra a última).
        let img = home.join("icons/github/github.com/org.img");
        std::fs::File::options().write(true).open(&img).unwrap().set_modified(now - Duration::from_secs(8 * 86_400)).unwrap();
        assert_eq!(resolve(&home, &o, false, now, &fail), Some(u.clone()));
        assert_eq!(calls.get(), 2);
        // A falha segura novas tentativas por 1 h; "Atualizar" ignora.
        assert_eq!(resolve(&home, &o, false, now, &ok), Some(u.clone()));
        assert_eq!(calls.get(), 2);
        assert_eq!(resolve(&home, &o, false, now + Duration::from_secs(2 * 3_600), &ok), Some(u.clone()));
        assert_eq!(calls.get(), 3, "passada 1 h, tenta de novo");
        assert_eq!(resolve(&home, &o, true, now, &ok), Some(u));
        assert_eq!(calls.get(), 4);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn sem_rede_e_sem_cache_fica_a_letra() {
        let home = tmp("offline");
        let o = GhOwner { host: "github.com".into(), owner: "org".into() };
        let calls = Cell::new(0);
        let fail = |_: &GhOwner| -> Result<Vec<u8>> {
            calls.set(calls.get() + 1);
            bail!("offline")
        };
        assert_eq!(resolve(&home, &o, false, SystemTime::now(), &fail), None);
        assert_eq!(resolve(&home, &o, false, SystemTime::now(), &fail), None);
        assert_eq!(calls.get(), 1, "não insiste offline");
        // Resposta que não é imagem (página de erro) não vira ícone.
        let html = |_: &GhOwner| -> Result<Vec<u8>> { Ok(b"<html>".to_vec()) };
        assert_eq!(resolve(&home, &o, true, SystemTime::now(), &html), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn prioridade_e_opcao_do_repo() {
        let home = tmp("prio");
        let ok = |_: &GhOwner| -> Result<Vec<u8>> { Ok(PNG.to_vec()) };
        let mut r = Repo { id: "r".into(), name: "app".into(), ..Default::default() };
        let gh = Some("git@github.com:org/app.git");
        let a = repo_avatar_with(&home, &r, gh, &[], false, &ok).unwrap();
        assert_eq!((a.owner.as_str(), a.data_url.is_some()), ("org", true));
        // Só local ou fora do GitHub: sem avatar (letra/emoji).
        assert_eq!(repo_avatar_with(&home, &r, None, &[], false, &ok), None);
        assert_eq!(repo_avatar_with(&home, &r, Some("https://gitlab.com/o/a"), &[], false, &ok), None);
        // Opção "Usar a imagem do GitHub" desligada.
        r.github_avatar = Some(false);
        assert_eq!(repo_avatar_with(&home, &r, gh, &[], false, &ok), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn tipos_de_imagem() {
        assert_eq!(sniff(PNG), Some("image/png"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(sniff(b"<svg"), None);
        assert_eq!(b64(b"Man"), "TWFu");
        assert_eq!(b64(b"Ma"), "TWE=");
        assert_eq!(with_size("https://avatars.githubusercontent.com/u/1?v=4"), "https://avatars.githubusercontent.com/u/1?v=4&s=64");
    }
}
