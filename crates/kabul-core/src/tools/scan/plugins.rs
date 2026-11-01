//! Plugins e extensões: registro de instalação do Claude Code (`installed_plugins.json` v1/v2,
//! `known_marketplaces.json`, `enabledPlugins` de usuário/projeto/local), plugins do Codex
//! (`config.toml` + cache por marketplace) e o formato aberto (`plugin.json`), além de extensões
//! `gemini-extension.json`/`qwen-extension.json`.
use super::config::{hooks_path, mcp_file, mcp_raw, read_doc};
use super::dirs;
use super::{Ctx, Raw, Where};
use crate::tools::providers::{Provider, What};
use crate::tools::{Finding, FindingKind, Footprint, Kind, Link, RepoRef, Severity, Source, SourceKind};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub(crate) fn scan(ctx: &mut Ctx, p: &Provider, w: &Where, base: &Path, dir: &Path, moved: bool) {
    match p.id {
        "claude" => claude(ctx, w, base, dir, moved),
        "codex" => codex(ctx, w, base, dir),
        _ => generic(ctx, w, dir),
    }
}

/// Manifesto do plugin (formato aberto e variantes por IA).
pub(crate) fn manifest(dir: &Path) -> Option<PathBuf> {
    [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".cursor-plugin/plugin.json", ".plugin/plugin.json", "plugin.json"].iter().map(|r| dir.join(r)).find(|p| p.is_file())
}

/// Conteúdo de um plugin instalado: skills, comandos, subagentes, hooks e MCP (todos geridos por ele).
fn contents(ctx: &mut Ctx, w: &Where, plugin_id: &str, dir: &Path, man: &Value) {
    let mut w2 = w.clone();
    w2.plugin = Some(plugin_id.to_string());
    w2.managed = true;
    let rel = |k: &str, dflt: &str| -> PathBuf { man.get(k).and_then(Value::as_str).map(|s| dir.join(s.trim_start_matches("./"))).unwrap_or_else(|| dir.join(dflt)) };
    let skills = rel("skills", "skills");
    if skills.is_dir() {
        dirs::scan(ctx, What::Skills, &w2, &skills, &[]);
    }
    let cmds = rel("commands", "commands");
    if cmds.is_dir() {
        dirs::files(ctx, Kind::Command, &w2, &cmds, &cmds, 0);
    }
    let agents = rel("agents", "agents");
    if agents.is_dir() {
        dirs::files(ctx, Kind::Agent, &w2, &agents, &agents, 0);
    }
    for h in [dir.join("hooks/hooks.json"), dir.join("hooks.json")] {
        if h.is_file() {
            hooks_path(ctx, &w2, &h);
        }
    }
    match man.get("mcpServers") {
        Some(Value::Object(m)) => {
            let mf = manifest(dir).unwrap_or(dir.to_path_buf());
            for (name, cfg) in m {
                let r = mcp_raw(ctx, &w2, &mf, name, cfg, "mcp-plugin");
                ctx.push(r);
            }
        }
        Some(Value::String(s)) => {
            let f = dir.join(s.trim_start_matches("./"));
            if f.is_file() {
                mcp_file(ctx, &w2, &f, "/mcpServers");
            }
        }
        _ => {
            let f = dir.join(".mcp.json");
            if f.is_file() {
                // `.mcp.json` de plugin: com ou sem a chave `mcpServers`.
                let doc = read_doc(ctx, &f, &w2);
                let map = doc.as_ref().and_then(|d| d.get("mcpServers").or(Some(d))).and_then(Value::as_object).cloned().unwrap_or_default();
                for (name, cfg) in map {
                    if cfg.is_object() {
                        let r = mcp_raw(ctx, &w2, &f, &name, &cfg, "mcp-plugin");
                        ctx.push(r);
                    }
                }
            }
        }
    }
}

fn read_json(p: &Path) -> Option<Value> {
    let t = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&crate::mcp::strip_jsonc(t.trim_start_matches('\u{feff}'))).ok()
}

/// `enabledPlugins` de um settings (chave → ligado).
pub(crate) fn enabled_map(p: &Path) -> BTreeMap<String, bool> {
    read_json(p).and_then(|v| v.get("enabledPlugins").cloned()).and_then(|v| v.as_object().cloned()).map(|m| m.into_iter().map(|(k, v)| (k, v.as_bool().unwrap_or(true))).collect()).unwrap_or_default()
}

fn str_of(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| v.get(*k)).and_then(|x| x.as_str().map(String::from).or_else(|| x.as_u64().map(|n| n.to_string())))
}

/// Uma instalação de plugin (registro v1 ou v2 normalizado).
struct Install {
    key: String,
    scope: String,
    project: Option<String>,
    path: Option<PathBuf>,
    version: Option<String>,
    commit: Option<String>,
    installed: Option<String>,
    updated: Option<String>,
}

fn installs(doc: &Value) -> (Vec<Install>, Option<u64>) {
    let ver = doc.get("version").and_then(Value::as_u64);
    let mut out = vec![];
    let to = |key: &str, e: &Value| Install {
        key: key.to_string(),
        scope: str_of(e, &["scope"]).unwrap_or_else(|| "user".into()),
        project: str_of(e, &["projectPath", "project_path", "project"]),
        path: str_of(e, &["installPath", "install_path", "path"]).map(PathBuf::from),
        version: str_of(e, &["version"]),
        commit: str_of(e, &["gitCommitSha", "commit", "sha"]),
        installed: str_of(e, &["installedAt", "installed_at"]),
        updated: str_of(e, &["lastUpdated", "updatedAt", "updated_at"]),
    };
    let plugins = doc.get("plugins").unwrap_or(doc);
    match plugins {
        Value::Object(m) => {
            for (k, v) in m {
                match v {
                    Value::Array(a) => out.extend(a.iter().map(|e| to(k, e))),
                    Value::Object(_) => out.push(to(k, v)),
                    _ => {}
                }
            }
        }
        Value::Array(a) => {
            for e in a {
                if let Some(k) = str_of(e, &["id", "key", "name"]) {
                    out.push(to(&k, e));
                }
            }
        }
        _ => {}
    }
    (out, ver)
}

fn marketplaces(ctx: &mut Ctx, w: &Where, file: &Path) {
    let Some(doc) = read_doc(ctx, file, w) else { return };
    let Some(m) = doc.as_object() else { return };
    for (name, v) in m {
        let src = v.get("source").cloned().unwrap_or(Value::Null);
        let repo = str_of(&src, &["repo"]);
        let url = str_of(&src, &["url"]).map(|u| crate::tools::redact::url(&u)).or_else(|| repo.as_ref().map(|r| format!("https://github.com/{r}")));
        let loc = str_of(v, &["installLocation", "install_location"]).map(PathBuf::from);
        let mut s = Source::new(format!("mkt:{name}"), SourceKind::Marketplace, name);
        s.repo = repo;
        s.url = url;
        s.updated_at = str_of(v, &["lastUpdated", "updatedAt"]);
        s.exists = loc.as_ref().is_none_or(|l| l.exists());
        if let Some(l) = &loc {
            s.add_footprint(Footprint { kind: "dir".into(), label: "marketplace".into(), path: Some(ctx.roots.display(l)) });
        }
        ctx.source(s);
    }
}

fn repo_for(ctx: &Ctx, project: &str) -> RepoRef {
    ctx.out.repos.iter().find(|r| super::project::same_path(&r.path, Path::new(project))).cloned().unwrap_or(RepoRef { id: String::new(), name: ctx.roots.display(Path::new(project)), path: project.into() })
}

fn claude(ctx: &mut Ctx, w: &Where, base: &Path, dir: &Path, moved: bool) {
    let _ = moved;
    let km = dir.join("known_marketplaces.json");
    if km.is_file() {
        marketplaces(ctx, w, &km);
    }
    let user_enabled = enabled_map(&base.join("settings.json"));
    let file = dir.join("installed_plugins.json");
    let (list, ver) = match read_doc(ctx, &file, w) {
        Some(doc) => installs(&doc),
        None => (vec![], None),
    };
    if let Some(v) = ver.filter(|v| *v > 2) {
        ctx.warn(FindingKind::Unrecognized, &file, &format!("versão {v} do registro de plugins (lido no melhor esforço)"), w);
    }
    let mut used: BTreeSet<PathBuf> = BTreeSet::new();
    for ins in &list {
        let (name, mkt) = ins.key.split_once('@').unwrap_or((&ins.key, ""));
        let mut w2 = w.clone();
        let mut enabled = user_enabled.get(&ins.key).copied();
        if ins.scope != "user" {
            if let Some(pp) = &ins.project {
                let r = repo_for(ctx, pp);
                let pe: BTreeMap<String, bool> = [".claude/settings.json", ".claude/settings.local.json"].iter().flat_map(|f| enabled_map(&Path::new(pp).join(f))).collect();
                enabled = pe.get(&ins.key).copied().or(enabled);
                w2.repo = Some(r);
            }
        }
        let path = ins.path.clone().unwrap_or_else(|| dir.join("cache").join(mkt).join(name).join(ins.version.clone().unwrap_or_default()));
        let id = format!("plugin:{}", ins.key);
        let mut raw = Raw { kind: Kind::Plugin, name: name.to_string(), key: Some(id.clone()), abs: path.clone(), ..Default::default() };
        let exists = path.is_dir();
        let mut pl = w2.placement(ctx.roots, &path, if exists { Link::Real } else { Link::Broken { target: ctx.roots.display(&path) } }, "claude-plugin");
        pl.version = ins.version.clone();
        pl.enabled = Some(enabled.unwrap_or(false));
        pl.source_id = (!mkt.is_empty()).then(|| format!("mkt:{mkt}"));
        pl.managed = false;
        raw.extras.push(("scope".into(), ins.scope.clone()));
        if let Some(c) = &ins.commit {
            raw.extras.push(("commit".into(), c.chars().take(12).collect()));
        }
        for (k, v) in [("installedAt", &ins.installed), ("updatedAt", &ins.updated)] {
            if let Some(v) = v {
                raw.extras.push((k.into(), v.clone()));
            }
        }
        if exists {
            used.insert(path.clone());
            let man_path = manifest(&path);
            let man = man_path.as_ref().and_then(|p| read_json(p)).unwrap_or(Value::Null);
            raw.description = str_of(&man, &["description"]);
            if let Some(a) = man.get("author").and_then(|a| a.get("name").or(Some(a))).and_then(Value::as_str) {
                raw.extras.push(("author".into(), a.into()));
            }
            if let Some(l) = str_of(&man, &["license"]) {
                raw.extras.push(("license".into(), l));
            }
            raw.main_file = man_path.clone().or_else(|| Some(path.join("README.md")).filter(|p| p.is_file()));
            contents(ctx, &w2, &ins.key, &path, &man);
        } else {
            let f = Finding::new(FindingKind::RegistryMissing, Severity::Warn, vec![id.clone()], vec![ctx.roots.display(&path)]).arg("reason", "installPathMissing");
            ctx.finding(f);
        }
        raw.placement = pl;
        ctx.push(raw);
    }
    stale_versions(ctx, &dir.join("cache"), &used, 2);
}

/// Versões no cache que nenhuma instalação usa (sobras de atualização).
fn stale_versions(ctx: &mut Ctx, cache: &Path, used: &BTreeSet<PathBuf>, depth: usize) {
    // cache/<marketplace>/<plugin>/<versão> (depth = 2 níveis antes da versão).
    let mut plugin_dirs = vec![cache.to_path_buf()];
    for _ in 0..depth {
        plugin_dirs = plugin_dirs.iter().flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir())).collect();
    }
    for pd in plugin_dirs {
        let versions: Vec<PathBuf> = std::fs::read_dir(&pd).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        let in_use = versions.iter().any(|v| used.contains(v));
        let stale: Vec<String> = versions.iter().filter(|v| !used.contains(*v)).map(|v| ctx.roots.display(v)).collect();
        if !stale.is_empty() && in_use {
            let plugin = pd.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let mkt = pd.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let f = Finding::new(FindingKind::StalePluginVersion, Severity::Info, vec![format!("plugin:{plugin}@{mkt}")], stale.clone()).arg("count", stale.len()).arg("plugin", &plugin);
            ctx.finding(f);
        } else if !stale.is_empty() && !in_use && !versions.is_empty() {
            let plugin = pd.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let f = Finding::new(FindingKind::StalePluginVersion, Severity::Info, vec![], stale.clone()).arg("count", stale.len()).arg("plugin", &plugin).arg("reason", "notInstalled");
            ctx.finding(f);
        }
    }
}

fn codex(ctx: &mut Ctx, w: &Where, base: &Path, dir: &Path) {
    let cfg = base.join("config.toml");
    let doc = if cfg.is_file() { read_doc(ctx, &cfg, w) } else { None };
    let plugins = doc.as_ref().and_then(|d| d.get("plugins")).and_then(Value::as_object).cloned().unwrap_or_default();
    let mut used = BTreeSet::new();
    for (key, v) in &plugins {
        let (name, mkt) = key.split_once('@').unwrap_or((key, ""));
        let enabled = v.get("enabled").and_then(Value::as_bool).unwrap_or(true);
        let pdir = dir.join("cache").join(mkt).join(name);
        // A versão em uso: a pasta mais recente.
        let mut versions: Vec<(std::time::SystemTime, PathBuf)> =
            std::fs::read_dir(&pdir).into_iter().flatten().flatten().filter(|e| e.path().is_dir()).map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), e.path())).collect();
        versions.sort();
        let cur = versions.last().map(|(_, p)| p.clone());
        let id = format!("plugin:{key}");
        let path = cur.clone().unwrap_or(pdir.clone());
        let mut raw = Raw { kind: Kind::Plugin, name: name.to_string(), key: Some(id.clone()), abs: path.clone(), ..Default::default() };
        let mut pl = w.placement(ctx.roots, &path, if cur.is_some() { Link::Real } else { Link::Broken { target: ctx.roots.display(&pdir) } }, "codex-plugin");
        pl.enabled = Some(enabled);
        pl.version = cur.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string());
        if !mkt.is_empty() {
            let mut s = Source::new(format!("mkt:{mkt}"), SourceKind::Marketplace, mkt);
            s.exists = dir.join("cache").join(mkt).is_dir();
            pl.source_id = Some(ctx.source(s));
        }
        if let Some(c) = &cur {
            used.insert(c.clone());
            let mp = manifest(c);
            let man = mp.as_ref().and_then(|p| read_json(p)).unwrap_or(Value::Null);
            raw.description = str_of(&man, &["description"]).or_else(|| man.pointer("/interface/shortDescription").and_then(Value::as_str).map(String::from));
            raw.main_file = mp;
            contents(ctx, w, key, c, &man);
        }
        raw.placement = pl;
        ctx.push(raw);
    }
    if !plugins.is_empty() {
        stale_versions(ctx, &dir.join("cache"), &used, 2);
    }
}

/// Formato aberto: qualquer pasta (até 3 níveis) com `plugin.json` na raiz ou em `.<x>-plugin/`.
fn generic(ctx: &mut Ctx, w: &Where, dir: &Path) {
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    while let Some((d, depth)) = stack.pop() {
        if let Some(mp) = manifest(&d).filter(|_| d != dir) {
            let man = read_json(&mp).unwrap_or(Value::Null);
            let name = str_of(&man, &["name"]).unwrap_or_else(|| d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
            let id = format!("plugin:{name}@{}", w.harness);
            let mut raw = Raw { kind: Kind::Plugin, name: name.clone(), key: Some(id), abs: d.clone(), description: str_of(&man, &["description"]), main_file: Some(mp.clone()), ..Default::default() };
            let mut pl = w.placement(ctx.roots, &d, Link::Real, "plugin-json");
            pl.version = str_of(&man, &["version"]);
            raw.placement = pl;
            contents(ctx, w, &format!("{name}@{}", w.harness), &d, &man);
            ctx.push(raw);
            continue;
        }
        if depth < 3 {
            for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
                if e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.') {
                    stack.push((e.path(), depth + 1));
                }
            }
        }
    }
}

/// Extensões (`<pasta>/<nome>/gemini-extension.json` ou `qwen-extension.json`).
pub(crate) fn extensions(ctx: &mut Ctx, w: &Where, dir: &Path) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let d = e.path();
        let Some(mf) = ["gemini-extension.json", "qwen-extension.json", "extension.json"].iter().map(|f| d.join(f)).find(|p| p.is_file()) else { continue };
        let Some(man) = read_doc(ctx, &mf, w) else { continue };
        let name = str_of(&man, &["name"]).unwrap_or_else(|| e.file_name().to_string_lossy().to_string());
        let id = format!("extension:{name}");
        let mut raw = Raw { kind: Kind::Extension, name: name.clone(), key: Some(id), abs: d.clone(), description: str_of(&man, &["description"]), main_file: Some(mf.clone()), ..Default::default() };
        if let Some(c) = str_of(&man, &["contextFileName"]) {
            raw.extras.push(("contextFile".into(), c));
        }
        let mut pl = w.placement(ctx.roots, &d, Link::Real, "extension-json");
        pl.version = str_of(&man, &["version"]);
        // Origem gravada pela própria CLI ao instalar (`.gemini-extension-install.json`).
        for meta in [".gemini-extension-install.json", ".qwen-extension-install.json"] {
            if let Some(src) = read_json(&d.join(meta)).and_then(|m| str_of(&m, &["source"])) {
                let repo = src.trim_start_matches("https://github.com/").trim_end_matches(".git").to_string();
                let mut s = Source::new(format!("gh:{}", repo.to_lowercase()), SourceKind::GitRepo, &repo);
                s.url = Some(crate::tools::redact::url(&src));
                s.repo = Some(repo);
                pl.source_id = Some(ctx.source(s));
            }
        }
        raw.placement = pl;
        let mut w2 = w.clone();
        w2.plugin = Some(format!("{name}@ext"));
        if let Some(m) = man.get("mcpServers").and_then(Value::as_object) {
            for (n, cfg) in m {
                let r = mcp_raw(ctx, &w2, &mf, n, cfg, "mcp-extension");
                ctx.push(r);
            }
        }
        if d.join("commands").is_dir() {
            dirs::files(ctx, Kind::Command, &w2, &d.join("commands"), &d.join("commands"), 0);
        }
        if d.join("skills").is_dir() {
            dirs::scan(ctx, What::Skills, &w2, &d.join("skills"), &[]);
        }
        ctx.push(raw);
    }
}

/// Marketplace declarado num repositório (`.claude-plugin/marketplace.json`,
/// `.agents/plugins/marketplace.json`): o repo publica plugins.
pub(crate) fn declared_marketplace(ctx: &mut Ctx, w: &Where, file: &Path) {
    let Some(doc) = read_doc(ctx, file, w) else { return };
    let name = str_of(&doc, &["name"]).unwrap_or_else(|| "marketplace".into());
    let mut s = Source::new(format!("mkt:{name}"), SourceKind::Marketplace, &name);
    s.note = Some("declared".into());
    s.add_footprint(Footprint { kind: "registry".into(), label: "marketplace.json".into(), path: Some(ctx.roots.display(file)) });
    let sid = ctx.source(s);
    for p in doc.get("plugins").and_then(Value::as_array).into_iter().flatten() {
        let Some(pn) = str_of(p, &["name"]) else { continue };
        let mut raw = Raw { kind: Kind::Plugin, name: pn.clone(), key: Some(format!("plugin:{pn}@{name}")), abs: file.to_path_buf(), description: str_of(p, &["description"]), ..Default::default() };
        let mut pl = w.placement(ctx.roots, file, Link::Real, "marketplace-entry");
        pl.version = str_of(p, &["version"]);
        pl.source_id = Some(sid.clone());
        raw.placement = pl;
        ctx.push(raw);
    }
}

/// Plugins ligados no `.claude/settings*.json` do projeto (o time declara; pode não estar instalado).
pub(crate) fn project_enabled(ctx: &mut Ctx, w: &Where, repo: &Path) {
    for f in [".claude/settings.json", ".claude/settings.local.json"] {
        let p = repo.join(f);
        if !p.is_file() {
            continue;
        }
        let doc = read_json(&p).unwrap_or(Value::Null);
        if let Some(m) = doc.get("extraKnownMarketplaces").and_then(Value::as_object) {
            for (name, v) in m {
                let src = v.get("source").cloned().unwrap_or(Value::Null);
                let mut s = Source::new(format!("mkt:{name}"), SourceKind::Marketplace, name);
                s.repo = str_of(&src, &["repo"]);
                s.url = str_of(&src, &["url"]).map(|u| crate::tools::redact::url(&u)).or_else(|| s.repo.as_ref().map(|r| format!("https://github.com/{r}")));
                ctx.source(s);
            }
        }
        for (key, on) in enabled_map(&p) {
            let installed = ctx.out.raws.iter().any(|r| r.kind == Kind::Plugin && r.key.as_deref() == Some(&format!("plugin:{key}")));
            let (name, mkt) = key.split_once('@').unwrap_or((&key, ""));
            let mut raw = Raw { kind: Kind::Plugin, name: name.to_string(), key: Some(format!("plugin:{key}")), abs: p.clone(), ..Default::default() };
            let mut pl = w.placement(ctx.roots, &p, Link::Real, "enabled-plugins");
            pl.enabled = Some(on);
            pl.source_id = (!mkt.is_empty()).then(|| format!("mkt:{mkt}"));
            raw.placement = pl;
            if !installed && on {
                let mut f = Finding::new(FindingKind::RegistryMissing, Severity::Info, vec![format!("plugin:{key}")], vec![ctx.roots.display(&p)]).arg("reason", "notInstalled");
                if let Some(r) = &w.repo {
                    f = f.arg("repoId", &r.id);
                }
                ctx.finding(f);
            }
            ctx.push(raw);
        }
    }
}
