//! Um repositório do Kabul: pastas de extensões de cada IA no projeto, MCP e hooks do projeto,
//! instruções, lock do `npx skills`, plugins declarados, marketplace/servidor MCP publicados pelo
//! repo, pastas de outros apps e sub-repositórios.
use super::{dirs, plugins, Ctx, Where};
use crate::tools::providers::{What, PROVIDERS};
use crate::tools::{fsx, known, Finding, FindingKind, Kind, Link, RepoRef, Severity};
use std::path::Path;

/// Mesmo caminho (ignorando `/` final e, no macOS/Windows, maiúsculas).
pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    let n = |p: &Path| {
        let s = p.display().to_string().replace('\\', "/").trim_end_matches('/').to_string();
        if cfg!(any(target_os = "macos", windows)) {
            s.to_lowercase()
        } else {
            s
        }
    };
    n(a) == n(b)
}

pub(crate) fn scan(ctx: &mut Ctx, r: &RepoRef) {
    let root = r.path.clone();
    if !root.is_dir() {
        return;
    }
    for p in PROVIDERS {
        let w = Where { harness: p.id.into(), repo: Some(r.clone()), ..Default::default() };
        let declared: Vec<_> = p.project.iter().map(|(_, rel)| root.join(rel)).collect();
        for (what, rel) in p.project {
            let dir = root.join(rel);
            if !dir.exists() || !ctx.first_visit(&dir, &w) {
                continue;
            }
            let before = ctx.out.raws.len();
            match what {
                What::Extensions => plugins::extensions(ctx, &w, &dir),
                _ => dirs::scan(ctx, *what, &w, &dir, &declared),
            }
            let n = ctx.out.raws.len() - before;
            ctx.root(&w, what.label(), &dir, "ok", n, None);
        }
        for (rel, ptr) in p.project_mcp {
            let f = root.join(rel);
            if f.is_file() && ctx.first_visit(&f, &w) {
                let before = ctx.out.raws.len();
                super::config::mcp_file(ctx, &w, &f, ptr);
                let n = ctx.out.raws.len() - before;
                ctx.root(&w, "mcp", &f, "ok", n, None);
            }
        }
        for rel in p.project_hooks {
            let f = root.join(rel);
            if f.exists() && ctx.first_visit(&f.with_extension("hooks"), &w) {
                super::config::hooks_path(ctx, &w, &f);
            }
        }
        for rel in p.project_instr {
            let f = root.join(rel);
            if f.is_file() && ctx.first_visit(&f, &Where { harness: "instr".into(), repo: Some(r.clone()), ..Default::default() }) {
                dirs::instructions_file(ctx, &w, &f, rel);
            }
        }
    }
    let w = Where { harness: "claude".into(), repo: Some(r.clone()), ..Default::default() };
    plugins::project_enabled(ctx, &w, &root);
    let shared = Where { harness: "shared".into(), repo: Some(r.clone()), ..Default::default() };
    let lock = root.join("skills-lock.json");
    if lock.is_file() {
        super::sources::read_lock(ctx, &lock, &r.id, &shared);
        ctx.root(&shared, "lock", &lock, "ok", 0, None);
    }
    for rel in [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"] {
        let f = root.join(rel);
        if f.is_file() {
            plugins::declared_marketplace(ctx, &shared, &f);
        }
    }
    server_json(ctx, &shared, &root.join("server.json"));
    for (dir, label) in known::FOREIGN_DIRS {
        let d = root.join(dir);
        if d.is_dir() {
            let plugins: Vec<String> = std::fs::read_dir(d.join("plugins")).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
            let mut raw = super::Raw { kind: Kind::Foreign, name: label.to_string(), key: Some(format!("foreign:{}", label.to_lowercase())), abs: d.clone(), ..Default::default() };
            if !plugins.is_empty() {
                raw.extras.push(("plugins".into(), plugins.join(", ")));
            }
            raw.placement = shared.placement(ctx.roots, &d, Link::Real, "foreign");
            raw.placement.harness = "other".into();
            ctx.push(raw);
        }
    }
    nested_repos(ctx, r);
}

/// `server.json` do registro oficial de MCP (o repo publica um servidor).
fn server_json(ctx: &mut Ctx, w: &Where, f: &Path) {
    if !f.is_file() {
        return;
    }
    let Some(doc) = super::config::read_doc(ctx, f, w) else { return };
    let is_server = doc.get("$schema").and_then(|s| s.as_str()).is_some_and(|s| s.contains("server")) || (doc.get("name").is_some() && (doc.get("packages").is_some() || doc.get("remotes").is_some()));
    if !is_server {
        return;
    }
    let name = doc.get("name").and_then(|s| s.as_str()).unwrap_or("server").to_string();
    let mut raw = super::Raw {
        kind: Kind::Mcp,
        name: name.clone(),
        key: Some(format!("mcp:published:{name}")),
        abs: f.to_path_buf(),
        description: doc.get("description").and_then(|s| s.as_str()).map(String::from),
        main_file: Some(f.to_path_buf()),
        ..Default::default()
    };
    raw.extras.push(("published".into(), "true".into()));
    if let Some(pk) = doc.pointer("/packages/0/identifier").and_then(|s| s.as_str()) {
        raw.extras.push(("package".into(), pk.into()));
    }
    let mut pl = w.placement(ctx.roots, f, Link::Real, "mcp-server-json");
    pl.version = doc.get("version").and_then(|s| s.as_str()).map(String::from);
    raw.placement = pl;
    ctx.push(raw);
}

/// Sub-repositórios (`.git` dentro do repo, até 3 níveis): "repos dentro de repos".
fn nested_repos(ctx: &mut Ctx, r: &RepoRef) {
    let mut found = vec![];
    let mut budget = 4000usize;
    let mut stack = vec![(r.path.clone(), 0usize)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            if budget == 0 {
                break;
            }
            budget -= 1;
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || fsx::SKIP_DIRS.contains(&name.as_str()) || matches!(name.as_str(), "vendor" | "tmp" | "log" | "storage" | "build" | "coverage") {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if !ft.is_dir() {
                continue;
            }
            let p = e.path();
            if p.join(".git").exists() {
                found.push(ctx.roots.display(&p));
                continue;
            }
            if depth + 1 < 3 {
                stack.push((p, depth + 1));
            }
        }
    }
    if !found.is_empty() {
        found.sort();
        found.truncate(20);
        let f = Finding::new(FindingKind::NestedRepo, Severity::Info, vec![], found.clone()).arg("count", found.len()).arg("repo", &r.name).arg("repoId", &r.id);
        ctx.finding(f);
    }
}
