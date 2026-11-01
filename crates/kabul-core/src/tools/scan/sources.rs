//! Origem dos itens: locks do `npx skills` (global v1–v3 e `skills-lock.json` do projeto),
//! registros de instalação de pacotes/ferramentas (lista de arquivos com hash), repositórios git e a
//! "pegada" das ferramentas (pasta própria, pacote npm global, ferramenta uv, hooks e MCPs ligados).
use super::{Ctx, Where};
use crate::tools::{known, Finding, FindingKind, Footprint, Kind, Severity, Source, SourceKind};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

fn s(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v.get(*k)).and_then(Value::as_str).map(String::from).filter(|x| !x.is_empty())
}

/// Versões do lock que este leitor conhece; acima disso lê no melhor esforço e avisa.
const LOCK_KNOWN: u64 = 3;

/// Lê um lock de skills e registra as fontes. `repo_key` = "" (global) ou o id do repositório.
pub(crate) fn read_lock(ctx: &mut Ctx, file: &Path, repo_key: &str, w: &Where) {
    let Some(doc) = super::config::read_doc(ctx, file, w) else { return };
    let ver = doc.get("version").and_then(Value::as_u64).unwrap_or(1);
    if ver > LOCK_KNOWN {
        ctx.warn(FindingKind::Unrecognized, file, &format!("lock versão {ver} (lido no melhor esforço)"), w);
    }
    let entries: Vec<(String, Value)> = match doc.get("skills") {
        Some(Value::Object(m)) => m.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        Some(Value::Array(a)) => a.iter().filter_map(|e| s(e, &["name", "id", "skill"]).map(|n| (n, e.clone()))).collect(),
        _ => {
            ctx.warn(FindingKind::Unrecognized, file, "lock sem a lista de skills", w);
            return;
        }
    };
    for (name, e) in entries {
        let src = s(&e, &["source", "repo", "from", "package"]).unwrap_or_else(|| "?".into());
        let stype = s(&e, &["sourceType", "type", "source_type"]).unwrap_or_else(|| if src.contains('/') && !src.contains("://") { "github".into() } else { "unknown".into() });
        let url = s(&e, &["sourceUrl", "url", "repoUrl"]);
        let (id, label) = match stype.as_str() {
            "github" | "git" | "gitlab" => (format!("gh:{}", src.to_lowercase().trim_end_matches(".git")), src.clone()),
            "local" => (format!("local:{src}"), src.clone()),
            "well-known" | "wellknown" | "url" => (format!("wk:{}", src.to_lowercase()), src.clone()),
            _ => (format!("lock:{}", src.to_lowercase()), src.clone()),
        };
        let mut so = Source::new(&id, SourceKind::SkillsLock, label);
        if matches!(stype.as_str(), "github" | "git" | "gitlab") {
            so.repo = Some(src.clone());
            so.url = Some(url.clone().map(|u| crate::tools::redact::url(&u)).unwrap_or_else(|| format!("https://github.com/{src}")));
        } else {
            so.url = url.map(|u| crate::tools::redact::url(&u));
        }
        so.installed_at = s(&e, &["installedAt", "installed_at"]);
        so.updated_at = s(&e, &["updatedAt", "updated_at"]).or(so.installed_at.clone());
        so.commit = s(&e, &["skillFolderHash", "commit", "ref"]).map(|h| h.chars().take(12).collect());
        so.add_footprint(Footprint { kind: "registry".into(), label: file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), path: Some(ctx.roots.display(file)) });
        // Datas: a primeira instalação e a última atualização entre as skills da fonte.
        if let Some(x) = ctx.out.sources.get_mut(&id) {
            if so.installed_at.is_some() && (x.installed_at.is_none() || so.installed_at < x.installed_at) {
                x.installed_at = so.installed_at.clone();
            }
            if so.updated_at > x.updated_at {
                x.updated_at = so.updated_at.clone();
            }
        }
        let sid = ctx.source(so);
        ctx.out.name_sources.insert((repo_key.to_string(), Kind::Skill, name.clone()), sid);
        // Lock aponta skill que sumiu da pasta canônica.
        let canon = file.parent().map(|d| d.join("skills").join(&name));
        let canon = if repo_key.is_empty() { canon } else { file.parent().map(|d| d.join(".agents/skills").join(&name)) };
        if let Some(c) = canon {
            let anywhere = ctx.out.raws.iter().any(|r| r.kind == Kind::Skill && r.name == name);
            if !c.exists() && !anywhere {
                let mut f = Finding::new(FindingKind::RegistryMissing, Severity::Warn, vec![format!("skill:{name}")], vec![ctx.roots.display(&c)]).arg("reason", "lockMissing").arg("source", &src);
                if !repo_key.is_empty() {
                    f = f.arg("repoId", repo_key);
                }
                ctx.finding(f);
            }
        }
    }
}

/// Lock global do `npx skills` (e locais alternativos de versões novas).
pub(crate) fn global_locks(ctx: &mut Ctx) {
    let w = Where { harness: "shared".into(), ..Default::default() };
    let roots = ctx.roots.clone();
    for f in [roots.resolve("~/.agents/.skill-lock.json"), roots.resolve("~/.local/state/skills/.skill-lock.json"), roots.resolve("$CONFIG/skills/.skill-lock.json")] {
        if f.is_file() {
            let n = ctx.out.sources.len();
            read_lock(ctx, &f, "", &w);
            let count = ctx.out.name_sources.keys().filter(|(r, _, _)| r.is_empty()).count();
            let _ = n;
            ctx.root(&w, "lock", &f, "ok", count, None);
        }
    }
}

/// Repositório git dentro das pastas de extensões (pacote clonado): fonte com a URL do `origin`.
pub(crate) fn git_source_for(ctx: &mut Ctx, repo: &Path, skills_dir: &Path) {
    let cfg = std::fs::read_to_string(repo.join(".git/config")).unwrap_or_default();
    let mut url = None;
    let mut in_origin = false;
    for l in cfg.lines() {
        let t = l.trim();
        if t.starts_with('[') {
            in_origin = t == "[remote \"origin\"]";
        } else if in_origin {
            if let Some(u) = t.strip_prefix("url").map(|r| r.trim_start_matches([' ', '=']).trim()) {
                url = Some(u.to_string());
            }
        }
    }
    let label = url
        .as_deref()
        .map(|u| u.trim_end_matches(".git").rsplit([':', '/']).take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/"))
        .unwrap_or_else(|| repo.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
    let id = format!("gh:{}", label.to_lowercase());
    let mut so = Source::new(&id, SourceKind::GitRepo, &label);
    so.url = url.map(|u| crate::tools::redact::url(&u));
    so.repo = Some(label.clone());
    so.add_footprint(Footprint { kind: "dir".into(), label: "git".into(), path: Some(ctx.roots.display(repo)) });
    let sid = ctx.source(so);
    // Itens já lidos dentro desse repo apontam para ele.
    for r in ctx.out.raws.iter_mut().filter(|r| r.abs.starts_with(skills_dir) || r.abs.starts_with(repo)) {
        if r.placement.source_id.is_none() {
            r.placement.source_id = Some(sid.clone());
        }
    }
}

/// Registro genérico de instalação: arquivos (com hash opcional) e metadados do pacote.
struct Record {
    path: PathBuf,
    sha: Option<String>,
}

fn collect_records(v: &Value, out: &mut Vec<Record>, depth: usize) {
    if depth > 6 || out.len() > 2000 {
        return;
    }
    match v {
        Value::Object(m) => {
            let path = ["path", "file", "target", "dest", "destination", "targetPath", "installedPath"].iter().find_map(|k| m.get(*k)).and_then(Value::as_str).filter(|p| p.contains('/') || p.contains('\\'));
            if let Some(p) = path {
                let sha = ["sha256", "hash", "sha", "checksum"].iter().find_map(|k| m.get(*k)).and_then(Value::as_str).map(|h| h.trim_start_matches("sha256:").to_lowercase());
                out.push(Record { path: PathBuf::from(p), sha });
            }
            for x in m.values() {
                collect_records(x, out, depth + 1);
            }
        }
        Value::Array(a) => {
            for x in a {
                collect_records(x, out, depth + 1);
            }
        }
        _ => {}
    }
}

/// Lê um registro de instalação e liga os itens a ele (quebrado = destino sumiu; editado = hash mudou).
fn registry_file(ctx: &mut Ctx, file: &Path, tool_dir: Option<&Path>, base: &Path) {
    let w = Where { harness: "shared".into(), ..Default::default() };
    let Some(doc) = super::config::read_doc(ctx, file, &w) else { return };
    let mut recs = vec![];
    collect_records(&doc, &mut recs, 0);
    if recs.is_empty() {
        return;
    }
    let label = s(&doc, &["name", "package", "pack", "product", "tool"]).or_else(|| tool_dir.and_then(|d| d.file_name()).map(|n| n.to_string_lossy().trim_start_matches('.').to_string())).unwrap_or_else(|| "?".into());
    let stem = known::stem(&label).unwrap_or_else(|| label.to_lowercase());
    let id = format!("tool:{stem}");
    let mut so = Source::new(&id, SourceKind::NativeIntegration, &label);
    so.version = s(&doc, &["version", "pack_version", "packVersion"]);
    so.installed_at = s(&doc, &["installed_at", "installedAt", "updatedAt"]);
    so.repo = s(&doc, &["repo", "repository", "source"]).filter(|r| r.contains('/'));
    so.add_footprint(Footprint { kind: "registry".into(), label: file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), path: Some(ctx.roots.display(file)) });
    if let Some(d) = tool_dir {
        so.add_footprint(Footprint { kind: "dir".into(), label: d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), path: Some(ctx.roots.display(d)) });
    }
    let mut missing = vec![];
    let mut edited = vec![];
    for r in &recs {
        let p = if r.path.is_absolute() { r.path.clone() } else { base.join(&r.path) };
        let in_ext = ctx.out.raws.iter().any(|x| x.kind.portable() && (p.starts_with(&x.abs) || x.abs.starts_with(&p)));
        let kind = if in_ext { "file" } else { "settings" };
        if so.footprint.len() < 40 {
            so.add_footprint(Footprint { kind: kind.into(), label: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), path: Some(ctx.roots.display(&p)) });
        }
        if !p.exists() {
            missing.push(ctx.roots.display(&p));
        } else if let (Some(sha), true) = (&r.sha, p.is_file()) {
            if sha.len() >= 32 && std::fs::metadata(&p).map(|m| m.len() <= crate::tools::fsx::FILE_CAP).unwrap_or(false) {
                let cur = crate::usage::sha256_hex(&std::fs::read(&p).unwrap_or_default());
                if !cur.starts_with(sha.as_str()) && !sha.starts_with(&cur[..sha.len().min(64)]) {
                    edited.push(ctx.roots.display(&p));
                }
            }
        }
    }
    let sid = ctx.source(so);
    // Itens cujos arquivos estão no registro passam a ter esta fonte.
    let paths: Vec<PathBuf> = recs.iter().map(|r| if r.path.is_absolute() { r.path.clone() } else { base.join(&r.path) }).collect();
    let mut owned = vec![];
    for raw in ctx.out.raws.iter_mut() {
        if paths.iter().any(|p| p.starts_with(&raw.abs) || *p == raw.abs) && raw.kind.portable() {
            raw.placement.source_id.get_or_insert(sid.clone());
            owned.push(raw.item_id());
        }
    }
    if !missing.is_empty() {
        let f = Finding::new(FindingKind::RegistryMissing, Severity::Warn, owned.clone(), missing.clone()).arg("count", missing.len()).arg("source", &label);
        ctx.finding(f);
    }
    if !edited.is_empty() {
        let f = Finding::new(FindingKind::RegistryEdited, Severity::Info, owned, edited.clone()).arg("count", edited.len()).arg("source", &label);
        ctx.finding(f);
    }
}

/// Registros conhecidos: `~/.<ferramenta>/{install-state,...}.json`, `~/.<ferramenta>/integrations/*.json`
/// e registros de pacotes dentro das pastas das IAs.
pub(crate) fn registries(ctx: &mut Ctx) {
    let home = ctx.roots.home.clone();
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&home).into_iter().flatten().flatten().filter(|e| e.file_name().to_string_lossy().starts_with('.') && e.path().is_dir()).map(|e| e.path()).collect();
    dirs.sort();
    for d in dirs {
        let name = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if known::AI_HOME_DIRS.contains(&name.as_str()) {
            continue;
        }
        for f in known::REGISTRY_FILES {
            let p = d.join(f);
            if p.is_file() {
                registry_file(ctx, &p, Some(&d), &home);
            }
        }
        for e in std::fs::read_dir(d.join("integrations")).into_iter().flatten().flatten() {
            if e.path().extension().is_some_and(|x| x == "json") {
                registry_file(ctx, &e.path(), Some(&d), &home);
            }
        }
    }
    let roots = ctx.roots.clone();
    for p in crate::tools::providers::PROVIDERS {
        let (base, _) = super::base_of(p, &roots);
        for rel in known::PACKAGE_REGISTRIES {
            let f = base.join(rel);
            if f.is_file() {
                registry_file(ctx, &f, None, &base);
            }
        }
    }
    for r in ctx.out.repos.clone() {
        for rel in known::PACKAGE_REGISTRIES {
            let f = r.path.join(rel);
            if f.is_file() {
                registry_file(ctx, &f, None, &r.path);
            }
        }
    }
}

/// Pacote npm de um caminho `.../node_modules/<pkg>/...`.
fn npm_pkg(p: &str) -> Option<(String, PathBuf)> {
    let norm = p.replace('\\', "/");
    let i = norm.rfind("/node_modules/")?;
    let rest = &norm[i + "/node_modules/".len()..];
    let mut parts = rest.split('/');
    let first = parts.next()?;
    let name = if first.starts_with('@') { format!("{first}/{}", parts.next()?) } else { first.to_string() };
    Some((name.clone(), PathBuf::from(format!("{}/node_modules/{name}", &norm[..i]))))
}

/// Pegadas: cada comando de hook/MCP liga as ferramentas que ele cita (pasta própria no home, pacote
/// npm global, ferramenta uv). Ferramentas com o mesmo radical viram uma fonte só (e se juntam à
/// fonte do lock/registro de mesmo radical).
pub(crate) fn footprints(ctx: &mut Ctx) {
    let roots = ctx.roots.clone();
    let home = roots.home.clone();
    let uv_dir = roots.env.get("UV_TOOL_DIR").cloned().unwrap_or_else(|| if roots.os == "windows" { roots.appdata().join("uv").join("tools") } else { home.join(".local/share/uv/tools") });
    // tool key → (rótulo, pegadas)
    let mut tools: BTreeMap<String, (String, Vec<Footprint>)> = BTreeMap::new();
    let mut raw_tools: Vec<(usize, Vec<String>)> = vec![];
    for (i, r) in ctx.out.raws.iter().enumerate() {
        let Some(cmd) = &r.cmd else { continue };
        let mut keys = vec![];
        for tok in super::config::shell_tokens(cmd) {
            let tok = tok.replace("${HOME}", &home.display().to_string()).replace("$HOME", &home.display().to_string());
            let mut p = roots.expand(&tok);
            if !p.is_absolute() {
                continue;
            }
            // Binário em `bin/` que é link para um pacote npm.
            if let Ok(real) = std::fs::canonicalize(&p) {
                if real.to_string_lossy().contains("node_modules") {
                    p = real;
                }
            }
            let ps = p.display().to_string();
            if let Some((pkg, dir)) = npm_pkg(&ps) {
                let ver = std::fs::read(dir.join("package.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| s(&v, &["version"]));
                let key = format!("npm:{pkg}");
                let e = tools.entry(key.clone()).or_insert_with(|| (pkg.clone(), vec![]));
                let label = match &ver {
                    Some(v) => format!("{pkg}@{v}"),
                    None => pkg.clone(),
                };
                if !e.1.iter().any(|f| f.kind == "npm") {
                    e.1.push(Footprint { kind: "npm".into(), label, path: Some(roots.display(&dir)) });
                }
                keys.push(key);
                continue;
            }
            if let Ok(rest) = p.strip_prefix(&uv_dir) {
                if let Some(t) = rest.components().next() {
                    let name = t.as_os_str().to_string_lossy().to_string();
                    let key = format!("uv:{name}");
                    tools.entry(key.clone()).or_insert_with(|| (name.clone(), vec![Footprint { kind: "uv".into(), label: name.clone(), path: Some(roots.display(&uv_dir.join(&name))) }]));
                    keys.push(key);
                }
                continue;
            }
            // Pasta própria: `~/.<x>/...` ou `~/.local/share/<x>/...`.
            if let Ok(rest) = p.strip_prefix(&home) {
                let comps: Vec<String> = rest.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
                let dir = if comps.len() >= 4 && comps[0] == ".local" && comps[1] == "share" {
                    Some(home.join(".local").join("share").join(&comps[2]))
                } else if comps.len() >= 2 && comps[0].starts_with('.') && !known::AI_HOME_DIRS.contains(&comps[0].as_str()) {
                    Some(home.join(&comps[0]))
                } else {
                    None
                };
                if let Some(d) = dir {
                    let label = d.file_name().map(|n| n.to_string_lossy().trim_start_matches('.').to_string()).unwrap_or_default();
                    let key = format!("dir:{}", roots.display(&d));
                    let e = tools.entry(key.clone()).or_insert_with(|| (label.clone(), vec![Footprint { kind: "dir".into(), label: label.clone(), path: Some(roots.display(&d)) }]));
                    if p.parent().is_some_and(|pp| pp.file_name().is_some_and(|n| n == "bin")) && !e.1.iter().any(|f| f.path.as_deref() == Some(&roots.display(&p))) {
                        e.1.push(Footprint { kind: "binary".into(), label: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), path: Some(roots.display(&p)) });
                    }
                    keys.push(key);
                }
            }
        }
        keys.dedup();
        if !keys.is_empty() {
            raw_tools.push((i, keys));
        }
    }
    if tools.is_empty() {
        merge_tool_sources(ctx);
        return;
    }
    // União: chaves no mesmo comando ou com o mesmo radical.
    let keys: Vec<String> = tools.keys().cloned().collect();
    let idx: HashMap<String, usize> = keys.iter().enumerate().map(|(i, k)| (k.clone(), i)).collect();
    let mut parent: Vec<usize> = (0..keys.len()).collect();
    fn find(p: &mut [usize], x: usize) -> usize {
        let mut r = x;
        while p[r] != r {
            r = p[r];
        }
        let mut c = x;
        while p[c] != r {
            let n = p[c];
            p[c] = r;
            c = n;
        }
        r
    }
    let union = |p: &mut Vec<usize>, a: usize, b: usize| {
        let (ra, rb) = (find(p, a), find(p, b));
        if ra != rb {
            p[ra] = rb;
        }
    };
    for (_, ks) in &raw_tools {
        for w in ks.windows(2) {
            union(&mut parent, idx[&w[0]], idx[&w[1]]);
        }
    }
    let mut by_stem: HashMap<String, usize> = HashMap::new();
    for (i, k) in keys.iter().enumerate() {
        if let Some(st) = known::stem(&tools[k].0) {
            match by_stem.get(&st) {
                Some(&j) => union(&mut parent, i, j),
                None => {
                    by_stem.insert(st, i);
                }
            }
        }
    }
    // Uma fonte por grupo, com o id da fonte de mesmo radical que já exista (lock/registro).
    let mut group_src: HashMap<usize, String> = HashMap::new();
    for (i, k) in keys.iter().enumerate() {
        let g = find(&mut parent, i);
        let label = tools[k].0.clone();
        let st = known::stem(&label).unwrap_or_else(|| label.to_lowercase());
        let sid = group_src.entry(g).or_insert_with(|| {
            ctx.out
                .sources
                .values()
                .find(|s| s.repo.as_deref().and_then(|r| r.rsplit('/').next()).and_then(known::stem).as_deref() == Some(st.as_str()) || (s.kind == SourceKind::NativeIntegration && s.id == format!("tool:{st}")))
                .map(|s| s.id.clone())
                .unwrap_or_else(|| format!("tool:{st}"))
        });
        let sid = sid.clone();
        let mut so = Source::new(&sid, SourceKind::NativeIntegration, &st);
        for f in tools[k].1.clone() {
            so.add_footprint(f);
        }
        ctx.source(so);
    }
    // Hooks e MCPs da ferramenta entram na pegada e passam a ter a fonte.
    for (i, ks) in raw_tools {
        let g = find(&mut parent, idx[&ks[0]]);
        let sid = group_src[&g].clone();
        let (kind, name, harness) = {
            let r = &mut ctx.out.raws[i];
            r.placement.source_id.get_or_insert(sid.clone());
            (r.kind, r.name.clone(), r.placement.harness.clone())
        };
        let label = crate::tools::providers::get(&harness).map(|p| p.label).unwrap_or(&harness).to_string();
        if let Some(so) = ctx.out.sources.get_mut(&sid) {
            so.add_footprint(Footprint { kind: kind.as_str().into(), label: format!("{name} · {label}"), path: None });
        }
    }
    merge_tool_sources(ctx);
    // Ferramentas uv que instalam uma skill com quase o mesmo nome (`foo` ← `fooo`/`foo-cli`).
    for e in std::fs::read_dir(&uv_dir).into_iter().flatten().flatten() {
        let tool = e.file_name().to_string_lossy().to_string();
        let skill = ctx.out.raws.iter().find(|r| r.kind == Kind::Skill && r.placement.source_id.is_none() && r.name.len() >= 5 && tool.starts_with(&r.name) && tool.len() - r.name.len() <= 4).map(|r| r.name.clone());
        if let Some(sk) = skill {
            let mut so = Source::new(format!("uv:{tool}"), SourceKind::UvTool, &tool);
            so.add_footprint(Footprint { kind: "uv".into(), label: tool.clone(), path: Some(roots.display(&e.path())) });
            let sid = ctx.source(so);
            for r in ctx.out.raws.iter_mut().filter(|r| r.kind == Kind::Skill && r.name == sk && r.placement.source_id.is_none()) {
                r.placement.source_id = Some(sid.clone());
            }
        }
    }
}

/// Fonte de ferramenta (`tool:<radical>`, de registro ou pegada) com o mesmo radical do repositório de
/// uma fonte de lock/git vira uma só (a do repositório), com a pegada junto.
fn merge_tool_sources(ctx: &mut Ctx) {
    let tool_ids: Vec<String> = ctx.out.sources.keys().filter(|k| k.starts_with("tool:")).cloned().collect();
    for tid in tool_ids {
        let st = tid.trim_start_matches("tool:").to_string();
        let target = ctx.out.sources.values().find(|s| !s.id.starts_with("tool:") && s.repo.as_deref().and_then(|r| r.rsplit('/').next()).and_then(known::stem).as_deref() == Some(st.as_str())).map(|s| s.id.clone());
        let Some(target) = target else { continue };
        let Some(t) = ctx.out.sources.remove(&tid) else { continue };
        if let Some(x) = ctx.out.sources.get_mut(&target) {
            if x.version.is_none() {
                x.version = t.version.clone();
            }
            for f in t.footprint {
                x.add_footprint(f);
            }
        }
        for r in ctx.out.raws.iter_mut().filter(|r| r.placement.source_id.as_deref() == Some(tid.as_str())) {
            r.placement.source_id = Some(target.clone());
        }
        for v in ctx.out.name_sources.values_mut().filter(|v| **v == tid) {
            *v = target.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn pacote_npm() {
        assert_eq!(super::npm_pkg("/opt/homebrew/lib/node_modules/@acme-ai/cli/dist/x.js").unwrap().0, "@acme-ai/cli");
        assert_eq!(super::npm_pkg("C:\\Users\\d\\AppData\\Roaming\\npm\\node_modules\\tool\\bin\\t.js").unwrap().0, "tool");
        assert!(super::npm_pkg("/usr/bin/x").is_none());
    }
}
