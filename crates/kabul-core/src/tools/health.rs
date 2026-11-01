//! Saúde do conjunto, por item: links quebrados, cópias idênticas (duplicadas) ou diferentes
//! (divergentes), item só na pasta canônica (órfão), mesmo nome de fontes diferentes, instalações
//! empilhadas (plugin + cópia), placeholders e riscos. Link para o canônico é o estado saudável.
use super::{Finding, FindingKind, Item, Kind, Link, Severity, Source};
use std::collections::{BTreeMap, BTreeSet};

/// Acima disso (tokens do arquivo principal) o item é "pesado" para o contexto.
pub const HEAVY_TOKENS: u64 = 8_000;

pub fn check(items: &[Item], sources: &BTreeMap<String, Source>) -> Vec<Finding> {
    let mut out = vec![];
    for it in items {
        let id = vec![it.id.clone()];
        for p in &it.placements {
            if let Link::Broken { target } = &p.link {
                out.push(Finding::new(FindingKind::BrokenLink, Severity::Error, id.clone(), vec![p.path.clone()]).arg("target", target).arg("harness", &p.harness));
            }
        }
        if it.kind.portable() {
            // Cópias reais (não geridas), por escopo: global e cada repositório separado.
            let mut groups: BTreeMap<String, Vec<&super::Placement>> = BTreeMap::new();
            for p in it.placements.iter().filter(|p| p.link == Link::Real && !p.managed && p.hash.is_some()) {
                groups.entry(p.repo_id.clone().or(p.repo.clone()).unwrap_or_default()).or_default().push(p);
            }
            for (scope, ps) in groups {
                if ps.len() < 2 {
                    continue;
                }
                let hashes: BTreeSet<&str> = ps.iter().filter_map(|p| p.hash.as_deref()).collect();
                let paths: Vec<String> = ps.iter().map(|p| p.path.clone()).collect();
                let harnesses: BTreeSet<&str> = ps.iter().map(|p| p.harness.as_str()).collect();
                let kind = if hashes.len() == 1 { FindingKind::DuplicateCopy } else { FindingKind::Drift };
                let mut f = Finding::new(kind, Severity::Warn, id.clone(), paths).arg("copies", ps.len()).arg("harnesses", harnesses.len()).arg("versions", hashes.len());
                if !scope.is_empty() {
                    f = f.arg("repoId", &scope);
                }
                out.push(f);
            }
            // Órfão: só na pasta canônica global, sem link/cópia em nenhuma IA.
            let global: Vec<_> = it.placements.iter().filter(|p| p.scope == "global").collect();
            if !global.is_empty() && global.iter().all(|p| p.harness == "shared") {
                out.push(Finding::new(FindingKind::Orphan, Severity::Warn, id.clone(), global.iter().map(|p| p.path.clone()).collect()));
            }
            // Mesmo nome, fontes diferentes (fora "local").
            let srcs: BTreeSet<&str> = it.placements.iter().filter_map(|p| p.source_id.as_deref()).filter(|s| !s.starts_with("local")).collect();
            if srcs.len() > 1 {
                let labels: Vec<String> = srcs.iter().map(|s| sources.get(*s).map(|x| x.label.clone()).unwrap_or_else(|| s.to_string())).collect();
                out.push(Finding::new(FindingKind::NameConflict, Severity::Warn, id.clone(), vec![]).arg("sources", labels.join(", ")));
            }
            if it.kind == Kind::Skill && it.description.is_none() && it.placements.iter().any(|p| !matches!(p.link, Link::Broken { .. })) {
                out.push(Finding::new(FindingKind::MissingDescription, Severity::Info, id.clone(), vec![]));
            }
        }
        if it.weight_tokens.unwrap_or(0) > HEAVY_TOKENS && it.kind != Kind::Instructions {
            out.push(Finding::new(FindingKind::Heavy, Severity::Info, id.clone(), vec![]).arg("tokens", it.weight_tokens.unwrap_or(0)));
        }
        if it.risks.iter().any(|r| r == "placeholder") {
            out.push(Finding::new(FindingKind::Placeholder, Severity::Warn, id.clone(), it.placements.iter().map(|p| p.path.clone()).collect()));
        }
        if it.kind == Kind::Mcp && it.risks.iter().any(|r| r == "unpinned") {
            out.push(Finding::new(FindingKind::UnpinnedMcp, Severity::Info, id.clone(), vec![]).arg("target", it.extras.get("target").cloned().unwrap_or_default()));
        }
        if it.kind == Kind::Hook {
            out.push(Finding::new(FindingKind::HookRunsCode, Severity::Info, id.clone(), it.placements.iter().map(|p| p.path.clone()).collect()).arg("events", it.extras.get("events").cloned().unwrap_or_default()));
        }
    }
    // Instalação empilhada: a mesma skill/comando vem de um plugin e também de uma cópia manual.
    let mut by_name: BTreeMap<(Kind, &str), Vec<&Item>> = BTreeMap::new();
    for it in items.iter().filter(|i| i.kind.portable()) {
        by_name.entry((it.kind, it.name.as_str())).or_default().push(it);
    }
    for ((_, name), group) in by_name {
        let from_plugin = group.iter().any(|i| i.placements.iter().any(|p| p.plugin.is_some()));
        let manual = group.iter().any(|i| i.placements.iter().any(|p| p.plugin.is_none() && !p.managed));
        if from_plugin && manual {
            out.push(Finding::new(FindingKind::StackedInstall, Severity::Info, group.iter().map(|i| i.id.clone()).collect(), vec![]).arg("name", name));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::Placement;

    fn pl(h: &str, link: Link, hash: &str) -> Placement {
        Placement { harness: h.into(), scope: "global".into(), path: format!("~/.{h}/skills/x"), link, hash: Some(hash.into()), format: "skill-md".into(), canonical: h == "shared", ..Default::default() }
    }
    fn item(ps: Vec<Placement>) -> Item {
        Item { id: "skill:x".into(), kind: Kind::Skill, name: "x".into(), description: Some("d".into()), placements: ps, ..Default::default() }
    }
    fn kinds(f: &[Finding]) -> Vec<FindingKind> {
        f.iter().map(|f| f.kind).collect()
    }

    #[test]
    fn saude() {
        let none = BTreeMap::new();
        let link = Link::Symlink { target: "../../.agents/skills/x".into() };
        // Canônico + links: saudável.
        assert!(check(&[item(vec![pl("shared", Link::Real, "a"), pl("claude", link.clone(), "a")])], &none).is_empty());
        // Cópias iguais: duplicadas; diferentes: divergentes.
        assert_eq!(kinds(&check(&[item(vec![pl("claude", Link::Real, "a"), pl("codex", Link::Real, "a")])], &none)), vec![FindingKind::DuplicateCopy]);
        assert_eq!(kinds(&check(&[item(vec![pl("claude", Link::Real, "a"), pl("codex", Link::Real, "b")])], &none)), vec![FindingKind::Drift]);
        // Só no canônico: órfão. Link quebrado: erro.
        assert_eq!(kinds(&check(&[item(vec![pl("shared", Link::Real, "a")])], &none)), vec![FindingKind::Orphan]);
        let f = check(&[item(vec![pl("shared", Link::Real, "a"), pl("qwen", Link::Broken { target: "x".into() }, "a")])], &none);
        assert_eq!(f[0].kind, FindingKind::BrokenLink);
        assert_eq!(f[0].severity, Severity::Error);
        // Fontes diferentes.
        let mut a = pl("claude", Link::Real, "a");
        a.source_id = Some("gh:a/x".into());
        let mut b = pl("shared", Link::Real, "a");
        b.source_id = Some("gh:b/x".into());
        let mut bl = pl("codex", link, "a");
        bl.source_id = Some("gh:b/x".into());
        assert!(kinds(&check(&[item(vec![a, b, bl])], &none)).contains(&FindingKind::NameConflict));
        // Plugin + cópia manual: empilhada.
        let mut p1 = pl("claude", Link::Real, "a");
        p1.plugin = Some("pk@m".into());
        p1.managed = true;
        let it1 = Item { id: "skill:pk:x".into(), ..item(vec![p1]) };
        let it2 = item(vec![pl("shared", Link::Real, "a"), pl("claude", Link::Symlink { target: "t".into() }, "a")]);
        assert!(kinds(&check(&[it1, it2], &none)).contains(&FindingKind::StackedInstall));
    }
}
