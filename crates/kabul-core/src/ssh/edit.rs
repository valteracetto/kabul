//! Escrita no `ssh_config`: adicionar, editar e remover um host mexendo só no bloco dele. Primeiro a
//! prévia ([`plan`]: texto antes/depois, diff e o `digest` do arquivo lido); depois [`apply`] com o
//! mesmo `digest` (se o arquivo mudou no meio, recusa). Antes de gravar: backup
//! `config.bak-kabul-<data>`, arquivo temporário com 0600 e `rename` (nunca meio escrito). Link
//! simbólico (dotfiles) é seguido: grava no arquivo de verdade e o link continua.
use super::parse::{self, BlockKind, Kind, Parsed};
use super::{run::ensure_ssh_dir, Roots};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Campos do formulário. Vazio = sem a linha.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostForm {
    pub alias: String,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub port: Option<String>,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub proxy_jump: Option<String>,
}

/// Mudança pedida. `file`/`line`/`alias` vêm da listagem (identificam o bloco).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    Add { host: HostForm },
    Update { file: String, line: usize, alias: String, host: HostForm },
    Remove { file: String, line: usize, alias: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DiffLine {
    /// ` ` contexto, `+`, `-`, `…` (trecho igual omitido).
    pub op: &'static str,
    pub text: String,
    pub old: Option<usize>,
    pub new: Option<usize>,
}

/// Prévia: nada foi gravado.
#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub file: String,
    pub file_display: String,
    pub creates: bool,
    pub before: String,
    pub after: String,
    pub diff: Vec<DiffLine>,
    /// sha256 do arquivo lido (`absent` se não existia): o `apply` confere.
    pub digest: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Applied {
    pub file: String,
    pub backup: Option<String>,
}

/// Chaves que o formulário controla, na ordem em que entram num bloco novo.
const MANAGED: &[(&str, &str)] = &[("hostname", "HostName"), ("user", "User"), ("port", "Port"), ("identityfile", "IdentityFile"), ("proxyjump", "ProxyJump")];

fn clean(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Valores que o ssh entende e que não viram outra diretiva nem outra opção.
pub fn validate(f: &HostForm) -> Result<HostForm> {
    let bad = |s: &str| s.chars().any(|c| c.is_control() || c == '"');
    let token = |what: &str, s: &str| -> Result<()> {
        if bad(s) || s.chars().any(char::is_whitespace) || s.starts_with('-') {
            bail!("{what} inválido: {s:?}");
        }
        Ok(())
    };
    let alias = f.alias.trim().to_string();
    if alias.is_empty() || alias.len() > 128 {
        bail!("alias obrigatório");
    }
    token("alias", &alias)?;
    if alias.contains(['*', '?', '!', '#', ',', '\'']) {
        bail!("alias inválido: sem curingas (* ? !), # nem vírgula");
    }
    let out = HostForm { alias, hostname: clean(&f.hostname), user: clean(&f.user), port: clean(&f.port), identity_file: clean(&f.identity_file), proxy_jump: clean(&f.proxy_jump) };
    if let Some(h) = &out.hostname {
        token("HostName", h)?;
    }
    if let Some(u) = &out.user {
        token("User", u)?;
    }
    if let Some(p) = &out.port {
        if !p.chars().all(|c| c.is_ascii_digit()) || !matches!(p.parse::<u32>(), Ok(1..=65535)) {
            bail!("porta inválida: {p}");
        }
    }
    if let Some(i) = &out.identity_file {
        if bad(i) {
            bail!("IdentityFile inválido");
        }
    }
    if let Some(j) = &out.proxy_jump {
        token("ProxyJump", j)?;
    }
    Ok(out)
}

fn value_of(f: &HostForm, key: &str) -> Option<String> {
    match key {
        "hostname" => f.hostname.clone(),
        "user" => f.user.clone(),
        "port" => f.port.clone(),
        "identityfile" => f.identity_file.clone(),
        "proxyjump" => f.proxy_jump.clone(),
        _ => None,
    }
}

fn fmt_value(v: &str) -> String {
    if v.contains([' ', '\t']) {
        format!("\"{v}\"")
    } else {
        v.to_string()
    }
}

fn digest(text: Option<&str>) -> String {
    match text {
        None => "absent".into(),
        Some(t) => Sha256::digest(t.as_bytes()).iter().map(|b| format!("{b:02x}")).collect(),
    }
}

/// Bloco `Host` que contém `alias` com o cabeçalho na linha `line` (1 = primeira).
fn find_block<'p>(p: &'p Parsed, line: usize, alias: &str) -> Result<(&'p parse::Block, Vec<String>)> {
    for b in &p.blocks {
        if b.header == Some(line.wrapping_sub(1)) {
            if let BlockKind::Host(pats) = &b.kind {
                if pats.iter().any(|x| x == alias) {
                    return Ok((b, pats.clone()));
                }
            }
        }
    }
    bail!("o bloco de {alias} mudou de lugar no arquivo: sincronize e tente de novo")
}

fn splice(text: &str, mut edits: Vec<(usize, usize, String)>) -> String {
    // Do fim para o começo: os intervalos de antes continuam válidos.
    edits.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let mut out = text.to_string();
    for (s, e, rep) in edits {
        out.replace_range(s..e, &rep);
    }
    out
}

fn header_value(p: &Parsed, b: &parse::Block) -> (usize, usize) {
    match &p.lines[b.header.unwrap()].kind {
        Kind::Directive { value, .. } => *value,
        _ => unreachable!("cabeçalho é diretiva"),
    }
}

fn block_indent(p: &Parsed, b: &parse::Block) -> String {
    p.directives(b).next().map(|i| p.text[p.lines[i].start..p.lines[i].end].chars().take_while(|c| *c == ' ' || *c == '\t').collect::<String>()).filter(|s| !s.is_empty()).unwrap_or_else(|| p.indent())
}

/// Texto novo para `op` sobre `text` (sem tocar no disco).
pub fn transform(text: &str, op: &Op, taken: &[String]) -> Result<String> {
    let p = parse::parse(text);
    let eol = p.eol;
    match op {
        Op::Add { host } => {
            let f = validate(host)?;
            if taken.contains(&f.alias) {
                bail!("já existe um host {}", f.alias);
            }
            let indent = p.indent();
            let mut block = format!("Host {}{eol}", f.alias);
            for (k, name) in MANAGED {
                if let Some(v) = value_of(&f, k) {
                    block.push_str(&format!("{indent}{name} {}{eol}", fmt_value(&v)));
                }
            }
            // Depois do último host concreto do arquivo (antes de `Host *`/`Match` que venham depois),
            // senão antes do primeiro bloco, senão no fim.
            let last_concrete = p.blocks.iter().rfind(|b| matches!(&b.kind, BlockKind::Host(pats) if pats.iter().any(|x| parse::is_concrete(x))));
            let first_block = p.blocks.iter().find(|b| b.header.is_some());
            let pos = match (last_concrete, first_block) {
                (Some(b), _) => p.lines.get(b.end).map(|l| l.start).unwrap_or(text.len()),
                (None, Some(b)) => p.lines[b.first].start,
                (None, None) => text.len(),
            };
            let before = &text[..pos];
            let mut ins = String::new();
            if !before.is_empty() && !before.ends_with('\n') {
                ins.push_str(eol);
            }
            // Última linha antes do ponto (já terminada em quebra): em branco não precisa separador.
            let prev_blank = before.strip_suffix('\n').unwrap_or(before).rsplit('\n').next().map(|l| l.trim().is_empty()).unwrap_or(true);
            if !before.is_empty() && !prev_blank {
                ins.push_str(eol);
            }
            ins.push_str(&block);
            let after = &text[pos..];
            if !after.is_empty() && !after.split('\n').next().map(|l| l.trim().is_empty()).unwrap_or(true) {
                ins.push_str(eol);
            }
            Ok(splice(text, vec![(pos, pos, ins)]))
        }
        Op::Update { line, alias, host, .. } => {
            let f = validate(host)?;
            let (b, pats) = find_block(&p, *line, alias)?;
            if f.alias != *alias && taken.contains(&f.alias) {
                bail!("já existe um host {}", f.alias);
            }
            let mut edits = vec![];
            if f.alias != *alias {
                let v = header_value(&p, b);
                let new: Vec<String> = pats.iter().map(|x| if x == alias { f.alias.clone() } else { x.clone() }).collect();
                edits.push((v.0, v.1, new.join(" ")));
            }
            let indent = block_indent(&p, b);
            let last = p.directives(b).last().unwrap_or(b.header.unwrap());
            let anchor = p.lines[last].end;
            let mut add = String::new();
            if !p.text[..anchor].ends_with('\n') {
                add.push_str(eol);
            }
            let base_len = add.len();
            for (k, name) in MANAGED {
                let want = value_of(&f, k);
                let have = p.directives(b).find(|&i| p.lines[i].key_lower().as_deref() == Some(k));
                match (have, want) {
                    (Some(i), None) => edits.push((p.lines[i].start, p.lines[i].end, String::new())),
                    (Some(i), Some(v)) => {
                        let cur = p.lines[i].args().join(" ");
                        if cur != v {
                            if let Kind::Directive { value, .. } = &p.lines[i].kind {
                                edits.push((value.0, value.1, fmt_value(&v)));
                            }
                        }
                    }
                    (None, Some(v)) => add.push_str(&format!("{indent}{name} {}{eol}", fmt_value(&v))),
                    (None, None) => {}
                }
            }
            if add.len() > base_len {
                edits.push((anchor, anchor, add));
            }
            Ok(splice(text, edits))
        }
        Op::Remove { line, alias, .. } => {
            let (b, pats) = find_block(&p, *line, alias)?;
            if pats.len() > 1 {
                let v = header_value(&p, b);
                let rest: Vec<String> = pats.iter().filter(|x| *x != alias).cloned().collect();
                return Ok(splice(text, vec![(v.0, v.1, rest.join(" "))]));
            }
            // Do comentário colado até a última diretiva, mais as linhas em branco logo depois.
            // Comentários soltos no fim do bloco (separadores de seção) ficam.
            let mut end = p.directives(b).last().unwrap_or(b.header.unwrap()) + 1;
            while end < b.end && p.lines[end].is_blank() {
                end += 1;
            }
            let s = p.lines[b.first].start;
            let e = p.lines.get(end).map(|l| l.start).unwrap_or(text.len());
            Ok(splice(text, vec![(s, e, String::new())]))
        }
    }
}

/// Diff por linha com 3 de contexto (arquivos de config são pequenos: LCS no trecho que mudou).
pub fn diff(before: &str, after: &str) -> Vec<DiffLine> {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < a.len() - pre && suf < b.len() - pre && a[a.len() - 1 - suf] == b[b.len() - 1 - suf] {
        suf += 1;
    }
    let (am, bm) = (&a[pre..a.len() - suf], &b[pre..b.len() - suf]);
    // LCS no meio.
    let (n, m) = (am.len(), bm.len());
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if am[i] == bm[j] { dp[i + 1][j + 1] + 1 } else { dp[i + 1][j].max(dp[i][j + 1]) };
        }
    }
    let mut all: Vec<(&'static str, &str, Option<usize>, Option<usize>)> = vec![];
    for (k, l) in a[..pre].iter().enumerate() {
        all.push((" ", l, Some(k + 1), Some(k + 1)));
    }
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && am[i] == bm[j] {
            all.push((" ", am[i], Some(pre + i + 1), Some(pre + j + 1)));
            i += 1;
            j += 1;
        } else if j < m && (i == n || dp[i][j + 1] >= dp[i + 1][j]) {
            all.push(("+", bm[j], None, Some(pre + j + 1)));
            j += 1;
        } else {
            all.push(("-", am[i], Some(pre + i + 1), None));
            i += 1;
        }
    }
    for k in 0..suf {
        all.push((" ", a[a.len() - suf + k], Some(a.len() - suf + k + 1), Some(b.len() - suf + k + 1)));
    }
    // Só o contexto perto das mudanças.
    let changed: Vec<usize> = all.iter().enumerate().filter(|(_, x)| x.0 != " ").map(|(k, _)| k).collect();
    let near = |k: usize| changed.iter().any(|&c| c.abs_diff(k) <= 3);
    let mut out = vec![];
    let mut skipped = false;
    for (k, (op, text, o, nw)) in all.into_iter().enumerate() {
        if op == " " && !near(k) {
            skipped = true;
            continue;
        }
        if skipped && !out.is_empty() {
            out.push(DiffLine { op: "…", text: String::new(), old: None, new: None });
        }
        skipped = false;
        out.push(DiffLine { op, text: text.to_string(), old: o, new: nw });
    }
    out
}

/// Arquivo alvo da mudança: o principal (adicionar) ou um dos lidos na listagem (editar/remover) —
/// nunca um caminho qualquer vindo de fora.
fn target(r: &Roots, op: &Op) -> Result<PathBuf> {
    match op {
        Op::Add { .. } => Ok(r.config.clone()),
        Op::Update { file, .. } | Op::Remove { file, .. } => {
            let ov = super::overview(r);
            ov.files.iter().find(|f| f.exists && f.path == *file).map(|f| PathBuf::from(&f.path)).with_context(|| format!("{file} não faz parte do {}", r.display(&r.config)))
        }
    }
}

/// Prévia da mudança.
pub fn plan(r: &Roots, op: &Op) -> Result<Plan> {
    let file = target(r, op)?;
    let before = super::read_text(&file)?;
    let taken: Vec<String> = super::overview(r).hosts.into_iter().map(|h| h.alias).collect();
    let text = before.clone().unwrap_or_default();
    let after = transform(&text, op, &taken)?;
    Ok(Plan { file: file.display().to_string(), file_display: r.display(&file), creates: before.is_none(), diff: diff(&text, &after), digest: digest(before.as_deref()), before: text, after })
}

/// Grava a mudança da prévia. `digest` precisa ser o da prévia (o arquivo não mudou desde então).
pub fn apply(r: &Roots, op: &Op, expected: &str) -> Result<Applied> {
    let p = plan(r, op)?;
    if p.digest != expected {
        bail!("{} mudou desde a prévia: revise de novo antes de salvar", p.file_display);
    }
    let file = PathBuf::from(&p.file);
    if p.before == p.after && !p.creates {
        return Ok(Applied { file: p.file, backup: None });
    }
    let backup = write_config(r, &file, &p.after)?;
    Ok(Applied { file: p.file, backup: backup.map(|b| b.display().to_string()) })
}

#[cfg(unix)]
fn private(p: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600)).with_context(|| format!("chmod 600 {}", p.display()))
}
// Windows: o arquivo herda a ACL do perfil do usuário (é o que o OpenSSH do Windows exige).
#[cfg(not(unix))]
fn private(_p: &Path) -> Result<()> {
    Ok(())
}

/// Backup + gravação atômica com 0600. Devolve o caminho do backup (se havia arquivo).
pub fn write_config(r: &Roots, path: &Path, content: &str) -> Result<Option<PathBuf>> {
    // Link simbólico (dotfiles): grava no destino, o link fica.
    let real = if path.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) { std::fs::canonicalize(path).with_context(|| format!("link {} quebrado", path.display()))? } else { path.to_path_buf() };
    let dir = real.parent().context("caminho sem pasta")?.to_path_buf();
    if dir == r.ssh_dir {
        ensure_ssh_dir(&dir)?;
    } else {
        std::fs::create_dir_all(&dir)?;
    }
    let name = real.file_name().context("caminho sem nome")?.to_string_lossy().to_string();
    let mut backup = None;
    if real.exists() {
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
        let mut b = dir.join(format!("{name}.bak-kabul-{ts}"));
        let mut n = 2;
        while b.exists() {
            b = dir.join(format!("{name}.bak-kabul-{ts}-{n}"));
            n += 1;
        }
        std::fs::copy(&real, &b).with_context(|| format!("backup em {}", b.display()))?;
        private(&b)?;
        backup = Some(b);
    }
    let tmp = dir.join(format!(".{name}.kabul-tmp-{}", std::process::id()));
    {
        use std::io::Write;
        let mut o = std::fs::OpenOptions::new();
        o.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
        let mut f = o.open(&tmp).with_context(|| format!("gravar {}", tmp.display()))?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    private(&tmp)?;
    if let Err(e) = std::fs::rename(&tmp, &real) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e).with_context(|| format!("substituir {}", real.display()));
    }
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CFG: &str = "# Meu config\nInclude ~/.orbstack/ssh/config\n\n# produção\nHost web web-alt\n    HostName web.example.com\n    User dev   # comentário no fim\n    Port 2222\n    IdentityFile \"~/.ssh/minha chave\"\n    ServerAliveInterval 30\n\n# ---- trabalho ----\n\nHost banco\n\tHostName=198.51.100.7\n\tUser postgres\n\nHost *\n    AddKeysToAgent yes\n";

    fn form(alias: &str) -> HostForm {
        HostForm { alias: alias.into(), ..Default::default() }
    }

    /// O que sobra fora do intervalo mexido é idêntico, byte a byte.
    fn same_outside(before: &str, after: &str, from_line: usize, to_line: usize) {
        let b: Vec<&str> = before.split_inclusive('\n').collect();
        let a: Vec<&str> = after.split_inclusive('\n').collect();
        assert_eq!(b[..from_line].concat(), a[..from_line].concat(), "antes do bloco");
        let tail = b.len() - to_line;
        assert_eq!(b[to_line..].concat(), a[a.len() - tail..].concat(), "depois do bloco");
    }

    #[test]
    fn editar_troca_so_o_valor() {
        let op = Op::Update {
            file: String::new(),
            line: 5,
            alias: "web".into(),
            host: HostForm { alias: "web".into(), hostname: Some("web2.example.com".into()), user: Some("dev".into()), port: None, identity_file: Some("~/.ssh/minha chave".into()), proxy_jump: Some("bastion".into()) },
        };
        let out = transform(CFG, &op, &[]).unwrap();
        assert!(out.contains("    HostName web2.example.com\n"));
        assert!(out.contains("    User dev   # comentário no fim\n"), "valor igual: linha intacta");
        assert!(!out.contains("Port 2222"), "porta vazia remove a linha");
        assert!(out.contains("    IdentityFile \"~/.ssh/minha chave\"\n"));
        assert!(out.contains("    ServerAliveInterval 30\n    ProxyJump bastion\n"), "linha nova no fim do bloco, com o recuo dele");
        // Fora do bloco do web (linhas 0..4 e da 11 em diante), tudo igual.
        same_outside(CFG, &out, 4, 10);
    }

    #[test]
    fn mesmos_valores_mesmo_arquivo() {
        // Salvar sem mudar nada devolve o arquivo idêntico (aspas, `=`, tab, comentário no fim, CRLF).
        let op = Op::Update {
            file: String::new(),
            line: 5,
            alias: "web".into(),
            host: HostForm { alias: "web".into(), hostname: Some("web.example.com".into()), user: Some("dev".into()), port: Some("2222".into()), identity_file: Some("~/.ssh/minha chave".into()), proxy_jump: None },
        };
        assert_eq!(transform(CFG, &op, &[]).unwrap(), CFG);
        let crlf = CFG.replace('\n', "\r\n");
        assert_eq!(transform(&crlf, &op, &[]).unwrap(), crlf);
        let op = Op::Update { file: String::new(), line: 14, alias: "banco".into(), host: HostForm { alias: "banco".into(), hostname: Some("198.51.100.7".into()), user: Some("postgres".into()), ..Default::default() } };
        assert_eq!(transform(CFG, &op, &[]).unwrap(), CFG);
    }

    #[test]
    fn renomear_e_recuo_com_tab() {
        let op = Op::Update { file: String::new(), line: 14, alias: "banco".into(), host: HostForm { alias: "db".into(), hostname: Some("198.51.100.7".into()), user: Some("postgres".into()), port: Some("5432".into()), ..Default::default() } };
        let out = transform(CFG, &op, &["web".into()]).unwrap();
        assert!(out.contains("Host db\n\tHostName=198.51.100.7\n\tUser postgres\n\tPort 5432\n\nHost *"), "{out}");
        same_outside(CFG, &out, 13, 16);
        let dup = Op::Update { file: String::new(), line: 14, alias: "banco".into(), host: form("web") };
        assert!(transform(CFG, &dup, &["web".into(), "banco".into()]).is_err());
    }

    #[test]
    fn adicionar_antes_do_host_coringa() {
        let op = Op::Add { host: HostForm { alias: "novo".into(), hostname: Some("192.0.2.20".into()), user: Some("ubuntu".into()), port: Some("22".into()), identity_file: Some("~/.ssh/id_ed25519".into()), proxy_jump: None } };
        let out = transform(CFG, &op, &[]).unwrap();
        assert!(out.contains("\tUser postgres\n\nHost novo\n    HostName 192.0.2.20\n    User ubuntu\n    Port 22\n    IdentityFile ~/.ssh/id_ed25519\n\nHost *\n"), "{out}");
        assert!(out.starts_with(&CFG[..CFG.find("Host *").unwrap()]), "tudo antes igual");
        assert!(out.ends_with("Host *\n    AddKeysToAgent yes\n"));
        assert!(transform(CFG, &Op::Add { host: form("web") }, &["web".into()]).is_err(), "alias repetido");
    }

    #[test]
    fn adicionar_em_arquivo_vazio_sem_quebra_e_crlf() {
        let out = transform("", &Op::Add { host: HostForm { alias: "a".into(), hostname: Some("192.0.2.1".into()), ..Default::default() } }, &[]).unwrap();
        assert_eq!(out, "Host a\n    HostName 192.0.2.1\n");
        let out = transform("Host x\n  User y", &Op::Add { host: form("b") }, &[]).unwrap();
        assert_eq!(out, "Host x\n  User y\n\nHost b\n");
        let out = transform("Host x\r\n  User y\r\n", &Op::Add { host: HostForm { alias: "b".into(), port: Some("2200".into()), ..Default::default() } }, &[]).unwrap();
        assert_eq!(out, "Host x\r\n  User y\r\n\r\nHost b\r\n  Port 2200\r\n");
        // Só global e `Host *`: entra antes do primeiro bloco.
        let out = transform("Include a\n\nHost *\n  User z\n", &Op::Add { host: form("c") }, &[]).unwrap();
        assert_eq!(out, "Include a\n\nHost c\n\nHost *\n  User z\n");
    }

    #[test]
    fn remover_bloco_e_alias_de_bloco_compartilhado() {
        let out = transform(CFG, &Op::Remove { file: String::new(), line: 5, alias: "web-alt".into() }, &[]).unwrap();
        assert_eq!(out, CFG.replace("Host web web-alt\n", "Host web\n"));
        let out = transform(CFG, &Op::Remove { file: String::new(), line: 14, alias: "banco".into() }, &[]).unwrap();
        assert_eq!(out, CFG.replace("Host banco\n\tHostName=198.51.100.7\n\tUser postgres\n\n", ""));
        let out = transform(CFG, &Op::Remove { file: String::new(), line: 5, alias: "web".into() }, &[]).unwrap();
        assert_eq!(out, CFG.replace("Host web web-alt\n", "Host web-alt\n"));
        // Bloco só com "web": comentário colado sai junto; o separador de seção fica.
        let solo = CFG.replace("Host web web-alt", "Host web");
        let out = transform(&solo, &Op::Remove { file: String::new(), line: 5, alias: "web".into() }, &[]).unwrap();
        assert_eq!(out, "# Meu config\nInclude ~/.orbstack/ssh/config\n\n# ---- trabalho ----\n\nHost banco\n\tHostName=198.51.100.7\n\tUser postgres\n\nHost *\n    AddKeysToAgent yes\n");
        assert!(transform(CFG, &Op::Remove { file: String::new(), line: 6, alias: "web".into() }, &[]).is_err(), "linha errada");
    }

    #[test]
    fn validacao() {
        assert!(validate(&HostForm { alias: "a b".into(), ..Default::default() }).is_err());
        assert!(validate(&HostForm { alias: "-oProxyCommand=x".into(), ..Default::default() }).is_err());
        assert!(validate(&HostForm { alias: "*.x".into(), ..Default::default() }).is_err());
        assert!(validate(&HostForm { alias: "ok".into(), hostname: Some("a\nProxyCommand x".into()), ..Default::default() }).is_err());
        assert!(validate(&HostForm { alias: "ok".into(), port: Some("70000".into()), ..Default::default() }).is_err());
        assert!(validate(&HostForm { alias: "ok".into(), identity_file: Some("~/a\"b".into()), ..Default::default() }).is_err());
        let v = validate(&HostForm { alias: " Acme/Prod ".into(), user: Some("".into()), port: Some("22".into()), ..Default::default() }).unwrap();
        assert_eq!((v.alias.as_str(), v.user, v.port.as_deref()), ("Acme/Prod", None, Some("22")));
    }

    #[test]
    fn diff_com_contexto() {
        let a = (1..=20).map(|i| format!("l{i}\n")).collect::<String>();
        let b = a.replace("l10\n", "l10b\n").replace("l2\n", "");
        let d = diff(&a, &b);
        assert!(d.iter().any(|x| x.op == "-" && x.text == "l2"));
        assert!(d.iter().any(|x| x.op == "+" && x.text == "l10b" && x.new == Some(9)));
        assert!(d.iter().any(|x| x.op == "…"));
        assert!(!d.iter().any(|x| x.text == "l20"), "longe da mudança fica de fora");
    }

    #[test]
    fn gravar_com_backup_0600_e_digest() {
        let home = super::super::tests::tmp_home("write");
        let r = Roots::at(&home);
        std::fs::write(&r.config, CFG).unwrap();
        let op = Op::Add { host: HostForm { alias: "novo".into(), hostname: Some("192.0.2.30".into()), ..Default::default() } };
        let p = plan(&r, &op).unwrap();
        assert!(!p.creates && p.diff.iter().any(|d| d.op == "+" && d.text == "Host novo"));
        assert!(apply(&r, &op, "outro").is_err(), "digest diferente");
        let done = apply(&r, &op, &p.digest).unwrap();
        let backup = PathBuf::from(done.backup.unwrap());
        assert!(backup.file_name().unwrap().to_string_lossy().starts_with("config.bak-kabul-"));
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), CFG);
        assert_eq!(std::fs::read_to_string(&r.config).unwrap(), p.after);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&r.config).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(std::fs::metadata(&backup).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // Editar um host de arquivo incluído grava nele; caminho de fora da listagem é recusado.
        std::fs::create_dir_all(r.ssh_dir.join("conf.d")).unwrap();
        std::fs::write(&r.config, "Include conf.d/*\n").unwrap();
        std::fs::write(r.ssh_dir.join("conf.d/x"), "Host x\n  User a\n").unwrap();
        let inc = r.ssh_dir.join("conf.d/x").display().to_string();
        let op = Op::Update { file: inc.clone(), line: 1, alias: "x".into(), host: HostForm { alias: "x".into(), user: Some("b".into()), ..Default::default() } };
        let p = plan(&r, &op).unwrap();
        apply(&r, &op, &p.digest).unwrap();
        assert_eq!(std::fs::read_to_string(&inc).unwrap(), "Host x\n  User b\n");
        let fora = Op::Remove { file: home.join("outro").display().to_string(), line: 1, alias: "x".into() };
        assert!(plan(&r, &fora).is_err());
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn sem_config_cria_pasta_e_arquivo() {
        let home = super::super::tests::tmp_home("novo");
        std::fs::remove_dir_all(home.join(".ssh")).unwrap();
        let r = Roots::at(&home);
        let op = Op::Add { host: HostForm { alias: "a".into(), hostname: Some("192.0.2.1".into()), ..Default::default() } };
        let p = plan(&r, &op).unwrap();
        assert!(p.creates && p.digest == "absent");
        let done = apply(&r, &op, "absent").unwrap();
        assert!(done.backup.is_none());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&r.ssh_dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn link_simbolico_continua_link() {
        let home = super::super::tests::tmp_home("link");
        let r = Roots::at(&home);
        let real = home.join("dotfiles-ssh-config");
        std::fs::write(&real, "Host a\n").unwrap();
        std::os::unix::fs::symlink(&real, &r.config).unwrap();
        let op = Op::Add { host: form("b") };
        let p = plan(&r, &op).unwrap();
        apply(&r, &op, &p.digest).unwrap();
        assert!(std::fs::symlink_metadata(&r.config).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "Host a\n\nHost b\n");
        let _ = std::fs::remove_dir_all(home);
    }
}
