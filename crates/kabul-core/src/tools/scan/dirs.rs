//! Pastas de extensões em formato aberto: skills (`<nome>/SKILL.md`), comandos (`*.md`/`*.toml`),
//! subagentes, prompts e regras.
use super::{Ctx, Raw, Where};
use crate::tools::fsx;
use crate::tools::providers::What;
use crate::tools::{FindingKind, Kind, Link};
use std::path::{Path, PathBuf};

/// Arquivos que acompanham pastas de extensões e não são itens.
const NOISE: &[&str] = &[".DS_Store", "README.md", "readme.md", "LICENSE", "LICENSE.md", ".gitkeep", "Thumbs.db", "manifest.json", ".gitignore", "keep.txt"];

pub(crate) fn scan(ctx: &mut Ctx, what: What, w: &Where, dir: &Path, declared: &[PathBuf]) {
    match what {
        What::Skills | What::BuiltinSkills | What::SyncedSkills => skills(ctx, what, w, dir, declared, 0),
        What::Commands => files(ctx, Kind::Command, w, dir, dir, 0),
        What::Agents => files(ctx, Kind::Agent, w, dir, dir, 0),
        What::Prompts => files(ctx, Kind::Prompt, w, dir, dir, 0),
        What::Rules => rules(ctx, w, dir),
        What::Plugins | What::Extensions => {}
    }
}

fn skill_file(dir: &Path) -> Option<PathBuf> {
    ["SKILL.md", "skill.md", "Skill.md"].iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// Lê um SKILL.md (pelo cache) e preenche descrição, extras e peso.
pub(crate) fn fill_from_md(ctx: &mut Ctx, raw: &mut Raw, md: &Path, w: &Where) {
    let Some(f) = ctx.cache.front(md) else { return };
    for warn in &f.warnings {
        ctx.warn(FindingKind::ParseError, md, warn, w);
    }
    let get = |k: &str| f.fields.iter().find(|(x, _)| x.eq_ignore_ascii_case(k)).map(|(_, v)| v.clone()).filter(|v| !v.is_empty());
    raw.description = get("description").or_else(|| get("summary"));
    if raw.description.is_none() {
        raw.missing_description = matches!(raw.kind, Kind::Skill | Kind::Agent);
        raw.description = f.first.clone();
    }
    for (k, v) in &f.fields {
        if !k.eq_ignore_ascii_case("description") {
            raw.extras.push((k.clone(), crate::tools::redact::value(k, v).chars().take(400).collect()));
        }
    }
    if let Some(n) = get("name").filter(|n| *n != raw.name) {
        raw.extras.push(("declaredName".into(), n));
    }
    raw.weight = Some(f.size.div_ceil(4));
    raw.main_file = Some(md.to_path_buf());
}

/// `dir/<nome>/SKILL.md`. Pastas sem SKILL.md com skills dentro (pacote clonado) são lidas um nível
/// abaixo; o resto vira aviso "não reconhecido".
fn skills(ctx: &mut Ctx, what: What, w: &Where, dir: &Path, declared: &[PathBuf], depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if declared.iter().any(|d| *d == p && d != dir) {
            continue;
        }
        if name.starts_with('.') && (what != What::BuiltinSkills || !p.is_dir()) {
            continue;
        }
        let Some((link, real)) = fsx::classify(&p) else { continue };
        if !real.is_dir() && !matches!(link, Link::Broken { .. }) {
            if !NOISE.contains(&name.as_str()) {
                ctx.warn(FindingKind::Unrecognized, &p, "arquivo solto na pasta de skills", w);
            }
            continue;
        }
        let md = skill_file(&real);
        if md.is_none() && !matches!(link, Link::Broken { .. }) {
            // Sincronizadas: `<conta>/<skill>`; pacotes clonados: `<repo>/<skill>` ou `<repo>/skills/<skill>`.
            let inner = if real.join("skills").is_dir() { real.join("skills") } else { real.clone() };
            let has_nested = std::fs::read_dir(&inner).into_iter().flatten().flatten().any(|c| skill_file(&c.path()).is_some());
            if has_nested && depth < 2 {
                let mut w2 = w.clone();
                if what == What::SyncedSkills {
                    w2.managed = true;
                }
                skills(ctx, what, &w2, &inner, declared, depth + 1);
                if real.join(".git").exists() {
                    super::sources::git_source_for(ctx, &real, &inner);
                }
            } else {
                ctx.warn(FindingKind::Unrecognized, &p, "pasta sem SKILL.md", w);
            }
            continue;
        }
        let mut w2 = w.clone();
        if matches!(what, What::BuiltinSkills | What::SyncedSkills) {
            w2.managed = true;
        }
        let format = match what {
            What::BuiltinSkills => "skill-md-builtin",
            What::SyncedSkills => "skill-md-synced",
            _ => "skill-md",
        };
        let mut pl = w2.placement(ctx.roots, &p, link.clone(), format);
        let mut raw = Raw { kind: Kind::Skill, name: name.clone(), abs: p.clone(), ..Default::default() };
        if let Some(md) = md {
            fill_from_md(ctx, &mut raw, &md, w);
            if let Ok(m) = std::fs::metadata(&md) {
                pl.mtime = fsx::mtime_secs(&m);
            }
            // Link: o hash é o do destino (para comparar com cópias reais).
            pl.hash = ctx.cache.dir_hash(&real);
            if real.join("scripts").is_dir() || std::fs::read_dir(&real).into_iter().flatten().flatten().any(|f| f.path().extension().is_some_and(|x| matches!(x.to_str(), Some("sh" | "py" | "js" | "ts" | "ps1" | "rb")))) {
                raw.risks.push("scripts".into());
            }
            if real.join(".git").exists() {
                super::sources::git_source_for(ctx, &real, &real);
            }
        }
        if w.plugin.is_some() {
            raw.key = Some(format!("skill:{}:{}", w.plugin.as_deref().unwrap_or("").split('@').next().unwrap_or(""), name));
        }
        raw.placement = pl;
        ctx.push(raw);
    }
}

/// Comandos/subagentes/prompts: um arquivo por item; subpastas viram `pasta:nome`.
pub(crate) fn files(ctx: &mut Ctx, kind: Kind, w: &Where, root: &Path, dir: &Path, depth: usize) {
    if depth > 3 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let fname = e.file_name().to_string_lossy().to_string();
        if fname.starts_with('.') || NOISE.contains(&fname.as_str()) {
            continue;
        }
        let Some((link, real)) = fsx::classify(&p) else { continue };
        if real.is_dir() {
            files(ctx, kind, w, root, &p, depth + 1);
            continue;
        }
        let lower = fname.to_lowercase();
        let (stem, format) = if let Some(s) = lower.strip_suffix(".prompt.md") {
            (s.len(), "prompt-md")
        } else if let Some(s) = lower.strip_suffix(".agent.md") {
            (s.len(), "agent-md")
        } else if let Some(s) = lower.strip_suffix(".md") {
            (
                s.len(),
                if kind == Kind::Command {
                    "command-md"
                } else if kind == Kind::Agent {
                    "agent-md"
                } else {
                    "prompt-md"
                },
            )
        } else if let Some(s) = lower.strip_suffix(".mdc") {
            (s.len(), "rule-mdc")
        } else if let Some(s) = lower.strip_suffix(".toml") {
            (s.len(), "command-toml")
        } else if lower.ends_with(".yaml") || lower.ends_with(".yml") || lower.ends_with(".json") {
            // Subagentes em YAML/JSON (alguns CLIs) não são lidos ainda: aviso, não erro (dentro de
            // plugin são metadados do próprio plugin).
            if w.plugin.is_none() {
                ctx.warn(FindingKind::Unrecognized, &p, "formato não lido", w);
            }
            continue;
        } else {
            continue;
        };
        let rel_dir = p.parent().and_then(|d| d.strip_prefix(root).ok()).map(|r| r.display().to_string().replace(['\\', '/'], ":")).unwrap_or_default();
        let base = fname[..stem].to_string();
        let name = if rel_dir.is_empty() { base } else { format!("{rel_dir}:{base}") };
        let mut raw = Raw { kind, name: name.clone(), abs: p.clone(), ..Default::default() };
        let mut pl = w.placement(ctx.roots, &p, link.clone(), format);
        let broken = matches!(link, Link::Broken { .. });
        if !broken && format == "command-toml" {
            toml_command(ctx, &mut raw, &real, w);
        } else if !broken {
            fill_from_md(ctx, &mut raw, &real, w);
        }
        if let Ok(m) = std::fs::metadata(&real) {
            pl.mtime = fsx::mtime_secs(&m);
            pl.hash = ctx.cache.short_hash(&real);
        }
        if let Some(plugin) = &w.plugin {
            raw.key = Some(format!("{}:{}:{}", kind.as_str(), plugin.split('@').next().unwrap_or(""), name));
        }
        raw.placement = pl;
        ctx.push(raw);
    }
}

/// Comando em TOML (`description` + `prompt`).
fn toml_command(ctx: &mut Ctx, raw: &mut Raw, p: &Path, w: &Where) {
    let (text, _) = fsx::read_capped(p, 64 * 1024);
    match toml::from_str::<toml::Value>(&text) {
        Ok(v) => {
            raw.description = v.get("description").and_then(|d| d.as_str()).map(String::from);
            if let Some(pr) = v.get("prompt").and_then(|d| d.as_str()) {
                raw.weight = Some((pr.len() as u64).div_ceil(4));
                if raw.description.is_none() {
                    raw.description = crate::tools::frontmatter::first_paragraph(pr);
                }
            }
            raw.main_file = Some(p.to_path_buf());
        }
        Err(e) => ctx.warn(FindingKind::ParseError, p, &e.to_string(), w),
    }
}

/// Regras: arquivo único ou pasta de `*.md`/`*.mdc`/`*.txt` (cada arquivo é um item de instruções).
fn rules(ctx: &mut Ctx, w: &Where, path: &Path) {
    if path.is_file() {
        instructions_file(ctx, w, path, &path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        return;
    }
    for rel in fsx::list_files(path, 200) {
        let lower = rel.to_lowercase();
        if lower.ends_with(".md") || lower.ends_with(".mdc") || lower.ends_with(".txt") {
            let shown = format!("{}/{rel}", path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
            instructions_file(ctx, w, &path.join(&rel), &shown);
        }
    }
}

/// Instruções (`AGENTS.md`, `CLAUDE.md`, regras...): um item por arquivo e lugar.
pub(crate) fn instructions_file(ctx: &mut Ctx, w: &Where, p: &Path, shown: &str) {
    let Some((link, real)) = fsx::classify(p) else { return };
    let place = match (&w.repo, &w.account) {
        (Some(r), _) => r.name.clone(),
        (None, Some(a)) => format!("{}@{a}", w.harness),
        (None, None) => w.harness.clone(),
    };
    let mut raw = Raw { kind: Kind::Instructions, name: shown.to_string(), key: Some(format!("instructions:{place}:{shown}")), abs: p.to_path_buf(), ..Default::default() };
    let mut pl = w.placement(ctx.roots, p, link, if shown.ends_with(".mdc") { "rule-mdc" } else { "instructions-md" });
    if real.is_file() {
        fill_from_md(ctx, &mut raw, &real, w);
        raw.missing_description = false;
        if let Ok(m) = std::fs::metadata(&real) {
            pl.mtime = fsx::mtime_secs(&m);
            pl.hash = ctx.cache.short_hash(&real);
        }
    }
    raw.extras.retain(|(k, _)| k != "declaredName");
    raw.placement = pl;
    ctx.push(raw);
}
