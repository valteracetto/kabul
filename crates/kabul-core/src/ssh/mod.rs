//! Hosts SSH: lista e edita o `~/.ssh/config` do usuário (`%USERPROFILE%\.ssh\config` no Windows),
//! testa a conexão e abre `ssh <alias>` num terminal. O arquivo é do usuário: a leitura tolera tudo
//! ([`parse`]) e a escrita ([`edit`]) muda só o bloco pedido, com prévia, backup e permissão 0600.
//! Chave privada nunca é lida: só o caminho e o `.pub` ao lado ([`keys`]).
//!
//! Tudo recebe [`Roots`]: a pasta pessoal, a do `.ssh` e os binários. Os testes passam um `HOME`
//! sintético e nenhum binário, então nada toca o `~/.ssh` real nem abre conexão.
pub mod edit;
pub mod keys;
pub mod parse;
pub mod run;

use parse::{is_concrete, BlockKind, Kind, Parsed};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Onde ler e com o que rodar.
#[derive(Debug, Clone)]
pub struct Roots {
    /// Pasta pessoal (`~`), para expandir `~/` nos caminhos.
    pub home: PathBuf,
    /// `~/.ssh` (relativos do `Include` saem daqui, como no OpenSSH).
    pub ssh_dir: PathBuf,
    /// Arquivo principal (`~/.ssh/config`).
    pub config: PathBuf,
    /// `ssh` (para `-G`, teste e terminal). `None`: nada roda (testes).
    pub ssh: Option<PathBuf>,
    /// `ssh-keygen` (gerar chave).
    pub keygen: Option<PathBuf>,
    /// Passa `-F <config>` ao ssh: com raízes sintéticas o ssh não pode ler o `~/.ssh/config` real.
    pub explicit_config: bool,
}

impl Roots {
    /// O usuário de verdade. `KABUL_SSH_HOME` aponta outra pasta pessoal (E2E com o core real).
    pub fn user() -> Self {
        if let Some(h) = std::env::var_os("KABUL_SSH_HOME").filter(|h| !h.is_empty()) {
            let mut r = Self::at(Path::new(&h));
            r.ssh = find_bin("ssh");
            r.keygen = find_bin("ssh-keygen");
            return r;
        }
        let home = crate::paths::home();
        let ssh_dir = home.join(".ssh");
        Self { config: ssh_dir.join("config"), ssh_dir, home, ssh: find_bin("ssh"), keygen: find_bin("ssh-keygen"), explicit_config: false }
    }
    /// Pasta pessoal sintética, sem binários (testes). Ligue `ssh`/`keygen` à mão se precisar.
    pub fn at(home: &Path) -> Self {
        let ssh_dir = home.join(".ssh");
        Self { config: ssh_dir.join("config"), ssh_dir, home: home.to_path_buf(), ssh: None, keygen: None, explicit_config: true }
    }
    /// Caminho para mostrar: `~/...` dentro da pasta pessoal.
    pub fn display(&self, p: &Path) -> String {
        match p.strip_prefix(&self.home) {
            Ok(rest) if !self.home.as_os_str().is_empty() => {
                let s = rest.display().to_string();
                if s.is_empty() {
                    "~".into()
                } else {
                    format!("~{}{}", std::path::MAIN_SEPARATOR, s).replace('\\', "/")
                }
            }
            _ => p.display().to_string(),
        }
    }
    /// `~` e relativos (ao `~/.ssh`), como o OpenSSH faz no `Include` e no `IdentityFile`.
    pub fn resolve(&self, p: &str) -> PathBuf {
        let p = p.trim();
        if p == "~" {
            return self.home.clone();
        }
        if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
            return self.home.join(rest);
        }
        let path = PathBuf::from(p);
        if path.is_absolute() || p.starts_with('/') {
            path
        } else {
            self.ssh_dir.join(path)
        }
    }
}

/// `ssh`/`ssh-keygen` no PATH; no Windows também o OpenSSH que vem com o sistema.
fn find_bin(name: &str) -> Option<PathBuf> {
    crate::harness::which(name).or_else(|| {
        if cfg!(windows) {
            let win = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
            Some(win.join("System32").join("OpenSSH").join(format!("{name}.exe"))).filter(|p| p.is_file())
        } else {
            None
        }
    })
}

/// Arquivo lido (principal ou de `Include`).
#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub display: String,
    pub exists: bool,
    /// De onde veio: `None` no principal; senão o arquivo e a linha do `Include`.
    pub included_from: Option<String>,
    pub error: Option<String>,
}

/// Host com alias concreto (`ssh <alias>` funciona).
#[derive(Debug, Clone, Serialize, Default)]
pub struct Host {
    pub alias: String,
    /// Arquivo do bloco (caminho absoluto) e para mostrar.
    pub file: String,
    pub file_display: String,
    /// Linha do `Host` (1 = primeira).
    pub line: usize,
    /// Outros padrões do mesmo `Host` (o bloco vale para todos).
    pub siblings: Vec<String>,
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<String>,
    pub identity_files: Vec<String>,
    pub proxy_jump: Option<String>,
    pub proxy_command: Option<String>,
    pub forward_agent: Option<String>,
    pub local_forwards: Vec<String>,
    pub remote_forwards: Vec<String>,
    /// Demais diretivas do bloco, na ordem.
    pub other: Vec<(String, String)>,
    /// Comentário colado acima do `Host`.
    pub comment: Option<String>,
    /// Veio de um `Include` dentro de um `Host`/`Match`: só vale quando aquele bloco casa.
    pub conditional: bool,
}

/// `Host` com curinga ou `Match`: listado como regra, sem interpretar.
#[derive(Debug, Clone, Serialize)]
pub struct Rule {
    /// `host` ou `match`.
    pub kind: &'static str,
    pub patterns: String,
    pub file: String,
    pub file_display: String,
    pub line: usize,
    pub directives: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Warning {
    pub file: String,
    pub line: Option<usize>,
    /// `include_missing`, `include_loop`, `include_depth`, `duplicate`, `read`.
    pub kind: &'static str,
    pub detail: String,
}

/// Tudo o que a tela "Hosts SSH" mostra de uma vez.
#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub config: String,
    pub config_display: String,
    pub config_exists: bool,
    pub ssh_dir_display: String,
    pub files: Vec<FileInfo>,
    pub hosts: Vec<Host>,
    pub rules: Vec<Rule>,
    pub warnings: Vec<Warning>,
    pub ssh_available: bool,
    pub keygen_available: bool,
}

/// Arquivo maior que isso não é lido (config não chega perto; evita ler algo errado por `Include`).
const MAX_FILE: u64 = 1 << 20;
/// Profundidade de `Include` do próprio OpenSSH.
const MAX_DEPTH: usize = 16;

pub(crate) fn read_text(p: &Path) -> std::io::Result<Option<String>> {
    match std::fs::metadata(p) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
        Ok(m) if m.len() > MAX_FILE => Err(std::io::Error::other("arquivo grande demais para um ssh_config")),
        Ok(_) => {
            let b = std::fs::read(p)?;
            Ok(Some(String::from_utf8_lossy(&b).into_owned()))
        }
    }
}

fn joined(args: &[String]) -> String {
    args.iter().map(|a| if a.contains([' ', '\t']) { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" ")
}

/// Expande os globs de um caminho do `Include` (componente a componente, em ordem alfabética como o
/// `glob(3)`). Só arquivos.
pub fn expand_glob(path: &Path) -> Vec<PathBuf> {
    let s = path.to_string_lossy();
    if !s.contains(['*', '?']) {
        return vec![path.to_path_buf()];
    }
    let mut acc: Vec<PathBuf> = vec![];
    let mut comps = path.components();
    let mut base = PathBuf::new();
    // Prefixo sem curinga.
    let rest: Vec<std::path::Component> = {
        let mut v = vec![];
        let mut found = false;
        for c in comps.by_ref() {
            let cs = c.as_os_str().to_string_lossy();
            if !found && !cs.contains(['*', '?']) {
                base.push(c);
            } else {
                found = true;
                v.push(c);
            }
        }
        v
    };
    acc.push(base);
    for (i, c) in rest.iter().enumerate() {
        let pat = c.as_os_str().to_string_lossy().to_string();
        let last = i + 1 == rest.len();
        let mut next = vec![];
        for dir in &acc {
            if !pat.contains(['*', '?']) {
                next.push(dir.join(&pat));
                continue;
            }
            let Ok(rd) = std::fs::read_dir(dir) else { continue };
            let mut names: Vec<String> = rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| (!n.starts_with('.') || pat.starts_with('.')) && parse::wildcard(&pat, n)).collect();
            names.sort();
            for n in names {
                let p = dir.join(&n);
                if last || p.is_dir() {
                    next.push(p);
                }
            }
        }
        acc = next;
    }
    acc.into_iter().filter(|p| p.is_file()).collect()
}

/// Leitura completa: arquivo principal e `Include`s, hosts concretos e regras, na ordem do ssh.
pub fn overview(r: &Roots) -> Overview {
    let mut st = Walk { r, files: vec![], hosts: vec![], rules: vec![], warnings: vec![], seen: HashSet::new() };
    st.file(&r.config, None, false, 0);
    // Alias repetido: o ssh usa o primeiro bloco (o resto só completa o que faltar).
    let mut names = HashSet::new();
    for h in &st.hosts {
        if !names.insert(h.alias.clone()) {
            st.warnings.push(Warning { file: h.file.clone(), line: Some(h.line), kind: "duplicate", detail: h.alias.clone() });
        }
    }
    Overview {
        config: r.config.display().to_string(),
        config_display: r.display(&r.config),
        config_exists: r.config.is_file(),
        ssh_dir_display: r.display(&r.ssh_dir),
        files: st.files,
        hosts: st.hosts,
        rules: st.rules,
        warnings: st.warnings,
        ssh_available: r.ssh.is_some(),
        keygen_available: r.keygen.is_some(),
    }
}

struct Walk<'a> {
    r: &'a Roots,
    files: Vec<FileInfo>,
    hosts: Vec<Host>,
    rules: Vec<Rule>,
    warnings: Vec<Warning>,
    seen: HashSet<PathBuf>,
}

impl Walk<'_> {
    fn file(&mut self, path: &Path, from: Option<String>, conditional: bool, depth: usize) {
        let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let disp = self.r.display(path);
        if !self.seen.insert(key) {
            self.warnings.push(Warning { file: path.display().to_string(), line: None, kind: "include_loop", detail: disp });
            return;
        }
        let text = match read_text(path) {
            Ok(Some(t)) => t,
            Ok(None) => {
                self.files.push(FileInfo { path: path.display().to_string(), display: disp, exists: false, included_from: from, error: None });
                return;
            }
            Err(e) => {
                self.files.push(FileInfo { path: path.display().to_string(), display: disp.clone(), exists: true, included_from: from, error: Some(e.to_string()) });
                self.warnings.push(Warning { file: path.display().to_string(), line: None, kind: "read", detail: e.to_string() });
                return;
            }
        };
        self.files.push(FileInfo { path: path.display().to_string(), display: disp.clone(), exists: true, included_from: from, error: None });
        let p = parse::parse(&text);
        let file = path.display().to_string();
        for b in &p.blocks {
            let in_block = b.header.is_some();
            let directives: Vec<(String, String)> = p
                .directives(b)
                .filter_map(|i| match &p.lines[i].kind {
                    Kind::Directive { key, args, .. } if !key.eq_ignore_ascii_case("include") => Some((key.clone(), joined(args))),
                    _ => None,
                })
                .collect();
            // O cabeçalho vem antes dos `Include` do próprio bloco.
            if let Some(h) = b.header {
                match &b.kind {
                    BlockKind::Host(pats) => {
                        let concrete: Vec<&String> = pats.iter().filter(|x| is_concrete(x)).collect();
                        let has_negation = pats.iter().any(|x| x.starts_with('!'));
                        for alias in &concrete {
                            let mut host = host_from(&p, b, alias, &file, &disp, conditional);
                            host.siblings = pats.iter().filter(|x| x != alias).cloned().collect();
                            self.hosts.push(host);
                        }
                        if concrete.len() < pats.len() || has_negation || pats.is_empty() {
                            self.rules.push(Rule { kind: "host", patterns: joined(pats), file: file.clone(), file_display: disp.clone(), line: h + 1, directives: directives.clone() });
                        }
                    }
                    BlockKind::Match(crit) => self.rules.push(Rule { kind: "match", patterns: joined(crit), file: file.clone(), file_display: disp.clone(), line: h + 1, directives: directives.clone() }),
                    BlockKind::Global => {}
                }
            }
            // Includes do bloco, na ordem em que aparecem (o ssh lê o incluído naquele ponto).
            for i in p.directives(b) {
                let l = &p.lines[i];
                if l.key_lower().as_deref() != Some("include") {
                    continue;
                }
                for a in l.args() {
                    let target = self.r.resolve(a);
                    if depth + 1 > MAX_DEPTH {
                        self.warnings.push(Warning { file: file.clone(), line: Some(i + 1), kind: "include_depth", detail: a.clone() });
                        continue;
                    }
                    let found = expand_glob(&target);
                    if found.is_empty() || (found.len() == 1 && !found[0].exists()) {
                        // Glob sem resultado é normal (pasta vazia); caminho direto que falta vira aviso.
                        if !a.contains(['*', '?']) {
                            self.warnings.push(Warning { file: file.clone(), line: Some(i + 1), kind: "include_missing", detail: self.r.display(&target) });
                        }
                        continue;
                    }
                    for f in found {
                        self.file(&f, Some(format!("{disp}:{}", i + 1)), conditional || in_block, depth + 1);
                    }
                }
            }
        }
    }
}

fn host_from(p: &Parsed, b: &parse::Block, alias: &str, file: &str, disp: &str, conditional: bool) -> Host {
    let mut h = Host { alias: alias.to_string(), file: file.to_string(), file_display: disp.to_string(), line: b.header.unwrap_or(0) + 1, comment: p.attached_comment(b), conditional, ..Default::default() };
    // Primeiro valor vence (como no ssh); os que acumulam (IdentityFile, *Forward) acumulam.
    let first = |slot: &mut Option<String>, v: String| {
        if slot.is_none() {
            *slot = Some(v);
        }
    };
    for i in p.directives(b) {
        let l = &p.lines[i];
        let (Some(k), args) = (l.key_lower(), l.args()) else { continue };
        let v = joined(args);
        match k.as_str() {
            "hostname" => first(&mut h.hostname, v),
            "user" => first(&mut h.user, v),
            "port" => first(&mut h.port, v),
            "identityfile" => h.identity_files.push(v),
            "proxyjump" => first(&mut h.proxy_jump, v),
            "proxycommand" => first(&mut h.proxy_command, v),
            "forwardagent" => first(&mut h.forward_agent, v),
            "localforward" => h.local_forwards.push(v),
            "remoteforward" => h.remote_forwards.push(v),
            "include" => {}
            _ => {
                if let Kind::Directive { key, .. } = &l.kind {
                    h.other.push((key.clone(), v));
                }
            }
        }
    }
    h
}

/// Alias que pode ir para a linha de comando: existe como host concreto no config e não vira opção.
pub fn ensure_known(r: &Roots, alias: &str) -> anyhow::Result<()> {
    if alias.is_empty() || alias.starts_with('-') || alias.chars().any(|c| c.is_whitespace() || c.is_control()) {
        anyhow::bail!("alias inválido: {alias:?}");
    }
    if !overview(r).hosts.iter().any(|h| h.alias == alias) {
        anyhow::bail!("{alias} não está no {}", r.display(&r.config));
    }
    Ok(())
}

/// Comando para copiar/colar (`ssh <alias>`), com aspas quando precisa.
pub fn command_line(alias: &str) -> String {
    format!("ssh {}", crate::harness::shell_quote(alias))
}

/// Sessão de terminal do Kabul com `ssh <alias>` (fica num shell quando a conexão cai, para ler o erro).
pub fn terminal_launch(r: &Roots, alias: &str) -> anyhow::Result<crate::term::Launch> {
    ensure_known(r, alias)?;
    let ssh = r.ssh.clone().ok_or_else(|| anyhow::anyhow!("ssh não encontrado (instale o OpenSSH)"))?;
    let mut args = vec![];
    if r.explicit_config {
        args.push("-F".to_string());
        args.push(r.config.display().to_string());
    }
    args.push("--".into());
    args.push(alias.to_string());
    let spec = crate::harness::CmdSpec::new(&ssh.display().to_string(), args);
    let name = format!("kabul-ssh-{}", crate::store::slug(alias));
    Ok(crate::term::Launch::new(&name, Some(&r.home.display().to_string()), crate::term::What::Run { cmd: crate::term::Cmd::Spec(spec), log: None }))
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn tmp_home(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kabul-ssh-{tag}-{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".ssh")).unwrap();
        d
    }

    #[test]
    fn lista_hosts_regras_e_includes() {
        let home = tmp_home("ov");
        let ssh = home.join(".ssh");
        std::fs::create_dir_all(ssh.join("config.d")).unwrap();
        std::fs::write(
            ssh.join("config"),
            "# global\nInclude config.d/*.conf\nInclude ~/.ssh/nao-existe\n\n# servidor\nHost web web-alt\n  HostName web.example.com\n  User dev\n  Port 2222\n  IdentityFile ~/.ssh/id_web\n  IdentityFile ~/.ssh/id_extra\n  ForwardAgent yes\n  LocalForward 8080 localhost:80\n  ServerAliveInterval 30\n\nHost *.internal !bastion.internal\n  ProxyJump bastion\n\nMatch host *.corp exec \"true\"\n  User corp\n\nHost banco\n  Include extra/banco-*.conf\n\nHost *\n  AddKeysToAgent yes\n",
        )
        .unwrap();
        std::fs::write(ssh.join("config.d/b.conf"), "Host bastion\n  HostName 192.0.2.10\n  User ops\n").unwrap();
        std::fs::write(ssh.join("config.d/a.conf"), "Host alfa\n  HostName alfa.example.org\n").unwrap();
        std::fs::create_dir_all(ssh.join("extra")).unwrap();
        std::fs::write(ssh.join("extra/banco-1.conf"), "Host banco-replica\n  HostName 198.51.100.7\n").unwrap();
        let ov = overview(&Roots::at(&home));
        let names: Vec<&str> = ov.hosts.iter().map(|h| h.alias.as_str()).collect();
        // Ordem do ssh: includes no ponto em que aparecem, glob em ordem alfabética.
        assert_eq!(names, ["alfa", "bastion", "web", "web-alt", "banco", "banco-replica"]);
        let web = &ov.hosts[2];
        assert_eq!(web.hostname.as_deref(), Some("web.example.com"));
        assert_eq!(web.port.as_deref(), Some("2222"));
        assert_eq!(web.identity_files, ["~/.ssh/id_web", "~/.ssh/id_extra"]);
        assert_eq!(web.forward_agent.as_deref(), Some("yes"));
        assert_eq!(web.local_forwards, ["8080 localhost:80"]);
        assert_eq!(web.other, [("ServerAliveInterval".to_string(), "30".to_string())]);
        assert_eq!(web.comment.as_deref(), Some("servidor"));
        assert_eq!(web.siblings, ["web-alt"]);
        assert_eq!(web.line, 6);
        assert!(ov.hosts[5].conditional, "include dentro de Host só vale quando ele casa");
        assert!(!ov.hosts[0].conditional);
        assert_eq!(ov.hosts[0].file_display, "~/.ssh/config.d/a.conf");
        let rules: Vec<(&str, &str)> = ov.rules.iter().map(|r| (r.kind, r.patterns.as_str())).collect();
        assert_eq!(rules, [("host", "*.internal !bastion.internal"), ("match", "host *.corp exec true"), ("host", "*")]);
        assert!(ov.warnings.iter().any(|w| w.kind == "include_missing" && w.detail.contains("nao-existe")));
        assert_eq!(ov.config_display, "~/.ssh/config");
        assert!(!ov.ssh_available, "raízes sintéticas não rodam ssh");
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn include_em_loop_e_sem_arquivo() {
        let home = tmp_home("loop");
        let r = Roots::at(&home);
        let ov = overview(&r);
        assert!(!ov.config_exists);
        assert!(ov.hosts.is_empty());
        std::fs::write(&r.config, "Include config\nHost a\n").unwrap();
        let ov = overview(&r);
        assert!(ov.warnings.iter().any(|w| w.kind == "include_loop"));
        assert_eq!(ov.hosts.len(), 1);
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn windows_crlf_e_caminhos() {
        let home = tmp_home("win");
        let r = Roots::at(&home);
        std::fs::write(&r.config, "Host caixa\r\n    HostName 203.0.113.5\r\n    User Administrator\r\n    IdentityFile C:\\Users\\dev\\.ssh\\id_ed25519\r\n").unwrap();
        let ov = overview(&r);
        assert_eq!(ov.hosts[0].hostname.as_deref(), Some("203.0.113.5"));
        assert_eq!(ov.hosts[0].identity_files, ["C:\\Users\\dev\\.ssh\\id_ed25519"]);
        assert_eq!(r.resolve("~/.ssh/x"), home.join(".ssh/x"));
        assert_eq!(r.resolve("conf.d/y"), home.join(".ssh/conf.d/y"));
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn alias_conhecido_e_seguro() {
        let home = tmp_home("known");
        let r = Roots::at(&home);
        std::fs::write(&r.config, "Host ok\n  HostName 192.0.2.1\nHost *\n").unwrap();
        assert!(ensure_known(&r, "ok").is_ok());
        assert!(ensure_known(&r, "-oProxyCommand=x").is_err());
        assert!(ensure_known(&r, "nao-tem").is_err());
        assert!(ensure_known(&r, "*").is_err());
        assert_eq!(command_line("Acme/Prod"), "ssh Acme/Prod");
        assert_eq!(command_line("a b"), "ssh 'a b'");
        assert!(terminal_launch(&r, "ok").is_err(), "sem binário do ssh");
        let _ = std::fs::remove_dir_all(home);
    }
}
