//! Scan do disco (entradas cruas) e montagem do snapshot (itens, fontes, saúde) por escopo.
mod config;
mod dirs;
mod plugins;
mod project;
mod sources;

use super::fsx::FileCache;
use super::providers::{Provider, What, PROVIDERS};
use super::*;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Uma ocorrência de item num lugar (antes de juntar por item).
#[derive(Debug, Clone, Default)]
pub struct Raw {
    pub kind: Kind,
    pub name: String,
    /// Id do item quando não é `kind:nome` (plugins, instruções, itens de dentro de plugin).
    pub key: Option<String>,
    pub placement: Placement,
    pub description: Option<String>,
    pub extras: Vec<(String, String)>,
    pub weight: Option<u64>,
    pub risks: Vec<String>,
    /// Arquivo principal (SKILL.md, comando...), para o detalhe.
    pub main_file: Option<PathBuf>,
    /// Caminho absoluto da ocorrência (pasta ou arquivo).
    pub abs: PathBuf,
    /// Comando sem redação (hooks/MCP), só para achar a pegada; nunca sai do núcleo.
    pub cmd: Option<String>,
    pub missing_description: bool,
}

impl Raw {
    pub fn item_id(&self) -> String {
        self.key.clone().unwrap_or_else(|| format!("{}:{}", self.kind.as_str(), self.name))
    }
}

/// Resultado do scan (tudo: global, contas e todos os repositórios).
#[derive(Debug, Clone, Default)]
pub struct ScanOut {
    pub raws: Vec<Raw>,
    pub sources: BTreeMap<String, Source>,
    pub roots: Vec<RootInfo>,
    pub findings: Vec<Finding>,
    /// (repo ou "", kind, nome) → fonte (locks e registros).
    pub name_sources: HashMap<(String, Kind, String), String>,
    pub repos: Vec<RepoRef>,
    pub generated_at: u64,
    pub scan_ms: u64,
}

/// Contexto de uma passada: de onde vem (conta/projeto) e o que já foi lido.
pub(crate) struct Ctx<'a> {
    pub roots: &'a Roots,
    pub cache: &'a mut FileCache,
    pub out: ScanOut,
    visited: HashSet<(PathBuf, String)>,
}

/// Modelo do lugar: IA, conta, escopo e repositório.
#[derive(Debug, Clone, Default)]
pub(crate) struct Where {
    pub harness: String,
    pub account: Option<String>,
    pub repo: Option<RepoRef>,
    pub plugin: Option<String>,
    pub managed: bool,
}

impl Where {
    pub fn placement(&self, roots: &Roots, abs: &Path, link: Link, format: &str) -> Placement {
        Placement {
            harness: self.harness.clone(),
            account: self.account.clone(),
            scope: if self.repo.is_some() { "project".into() } else { "global".into() },
            repo_id: self.repo.as_ref().map(|r| r.id.clone()).filter(|s| !s.is_empty()),
            repo: self.repo.as_ref().map(|r| r.name.clone()),
            plugin: self.plugin.clone(),
            path: roots.display(abs),
            link,
            format: format.into(),
            canonical: self.harness == "shared" && self.plugin.is_none(),
            managed: self.managed || self.plugin.is_some(),
            ..Default::default()
        }
    }
    pub fn repo_key(&self) -> String {
        self.repo.as_ref().map(|r| r.id.clone()).unwrap_or_default()
    }
}

impl<'a> Ctx<'a> {
    fn root(&mut self, w: &Where, what: &str, path: &Path, status: &str, count: usize, env: Option<&str>) {
        self.out.roots.push(RootInfo {
            harness: w.harness.clone(),
            what: what.into(),
            path: self.roots.display(path),
            status: status.into(),
            count,
            account: w.account.clone(),
            repo: w.repo.as_ref().map(|r| r.name.clone()),
            env: env.map(String::from),
        });
    }

    /// Marca a pasta como lida (evita ler duas vezes quando duas IAs apontam para o mesmo lugar).
    fn first_visit(&mut self, p: &Path, w: &Where) -> bool {
        self.visited.insert((p.to_path_buf(), format!("{}|{}|{}", w.harness, w.account.as_deref().unwrap_or(""), w.repo_key())))
    }

    pub fn finding(&mut self, f: Finding) {
        if !self.out.findings.iter().any(|x| x.id == f.id) {
            self.out.findings.push(f);
        }
    }

    pub fn warn(&mut self, kind: FindingKind, path: &Path, detail: &str, w: &Where) {
        let mut f = Finding::new(kind, if kind == FindingKind::ParseError { Severity::Warn } else { Severity::Info }, vec![], vec![self.roots.display(path)]).arg("detail", detail.chars().take(200).collect::<String>()).arg("harness", &w.harness);
        if let Some(r) = &w.repo {
            f = f.arg("repoId", &r.id);
        }
        self.finding(f);
    }

    pub fn source(&mut self, s: Source) -> String {
        let id = s.id.clone();
        match self.out.sources.get_mut(&id) {
            Some(x) => x.merge(s),
            None => {
                self.out.sources.insert(id.clone(), s);
            }
        }
        id
    }

    pub fn push(&mut self, r: Raw) {
        self.out.raws.push(r);
    }
}

/// Roda um leitor isolado: pânico vira aviso (a tela nunca quebra por um formato inesperado).
fn guarded(ctx: &mut Ctx, name: &str, f: impl FnOnce(&mut Ctx)) {
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(ctx)));
    if r.is_err() {
        let f = Finding::new(FindingKind::ParseError, Severity::Warn, vec![], vec![]).arg("scanner", name).arg("detail", "panic");
        ctx.finding(f);
    }
}

/// Base global de uma IA (com variável de ambiente e Windows) e qual variável a moveu.
pub(crate) fn base_of(p: &Provider, roots: &Roots) -> (PathBuf, Option<&'static str>) {
    if let Some(var) = p.env {
        if let Some(d) = roots.env.get(var) {
            return (d.clone(), Some(var));
        }
    }
    let spec = if roots.os == "windows" { p.win_base.unwrap_or(p.base) } else { p.base };
    (roots.resolve(spec), None)
}

/// Caminho de um arquivo da tabela relativo à base (ou absoluto com `~/`, `$CONFIG/`...). Com a
/// base movida, `~/x` vira `<base>/x`.
pub(crate) fn rel_path(spec: &str, base: &Path, roots: &Roots, moved: bool) -> PathBuf {
    if let Some(rest) = spec.strip_prefix("~/") {
        if moved {
            return rest.split('/').fold(base.to_path_buf(), |p, s| p.join(s));
        }
        return roots.resolve(spec);
    }
    if spec.starts_with('$') {
        return roots.resolve(spec);
    }
    spec.split('/').filter(|s| !s.is_empty()).fold(base.to_path_buf(), |p, s| p.join(s))
}

/// Uma IA (numa conta ou no padrão do sistema): pastas globais, MCP, hooks e instruções.
fn scan_provider(ctx: &mut Ctx, p: &Provider, roots: &Roots, base: &Path, moved: bool, env: Option<&str>, account: Option<String>) {
    let w = Where { harness: p.id.into(), account, ..Default::default() };
    if !base.exists() {
        ctx.root(&w, "base", base, "missing", 0, env);
        return;
    }
    let declared: Vec<PathBuf> = p.global.iter().map(|(_, rel)| rel_path(rel, base, roots, moved)).collect();
    for (what, rel) in p.global {
        let dir = rel_path(rel, base, roots, moved);
        let before = ctx.out.raws.len();
        if !ctx.first_visit(&dir, &w) {
            continue;
        }
        match what {
            What::Plugins => guarded(ctx, "plugins", |c| plugins::scan(c, p, &w, base, &dir, moved)),
            What::Extensions => guarded(ctx, "extensions", |c| plugins::extensions(c, &w, &dir)),
            _ => guarded(ctx, "dirs", |c| dirs::scan(c, *what, &w, &dir, &declared)),
        }
        let status = if dir.exists() { "ok" } else { "missing" };
        let n = ctx.out.raws.len() - before;
        ctx.root(&w, what.label(), &dir, status, n, env);
    }
    for (spec, ptr) in p.mcp {
        let f = rel_path(spec, base, roots, moved);
        let before = ctx.out.raws.len();
        if f.is_file() && ctx.first_visit(&f, &w) {
            guarded(ctx, "mcp", |c| config::mcp_file(c, &w, &f, ptr));
            let n = ctx.out.raws.len() - before;
            ctx.root(&w, "mcp", &f, "ok", n, env);
        }
    }
    for spec in p.hooks {
        let f = rel_path(spec, base, roots, moved);
        if f.exists() && ctx.first_visit(&f.with_extension("hooks"), &w) {
            let before = ctx.out.raws.len();
            guarded(ctx, "hooks", |c| config::hooks_path(c, &w, &f));
            let n = ctx.out.raws.len() - before;
            if n > 0 {
                ctx.root(&w, "hooks", &f, "ok", n, env);
            }
        }
    }
    for spec in p.instr {
        let f = rel_path(spec, base, roots, moved);
        if f.is_file() {
            guarded(ctx, "instructions", |c| dirs::instructions_file(c, &w, &f, spec));
        }
    }
}

/// Lê tudo: IAs no padrão do sistema, contas isoladas do Kabul, locks, registros, pegadas e projetos.
pub fn scan_all(roots: &Roots, repos: &[RepoRef], cache: &mut FileCache) -> ScanOut {
    let t0 = std::time::Instant::now();
    let mut ctx = Ctx { roots, cache, out: ScanOut { repos: repos.to_vec(), ..Default::default() }, visited: HashSet::new() };
    // Padrão do sistema.
    for p in PROVIDERS {
        let (base, env) = base_of(p, roots);
        scan_provider(&mut ctx, p, roots, &base, env.is_some(), env, None);
    }
    // Contas isoladas do Kabul (várias por provedor): mesma tabela com a base (ou o HOME) da conta.
    let accounts = crate::accounts::Accounts::open(&roots.state);
    for a in accounts.list.iter().filter(|a| a.dir.is_some()) {
        let dir = a.dir.clone().unwrap();
        for p in PROVIDERS.iter().filter(|p| p.account == Some(a.provider.as_str())) {
            if p.home_isolated {
                let r2 = Roots { home: dir.clone(), appdata: roots.appdata.clone().map(|_| dir.join("AppData").join("Roaming")), xdg_config: None, env: BTreeMap::new(), ..roots.clone() };
                let (base, _) = base_of(p, &r2);
                scan_provider(&mut ctx, p, &r2, &base, false, None, Some(a.nickname.clone()));
            } else {
                scan_provider(&mut ctx, p, roots, &dir, true, p.env, Some(a.nickname.clone()));
            }
        }
    }
    guarded(&mut ctx, "locks", sources::global_locks);
    for r in repos {
        let r = r.clone();
        guarded(&mut ctx, "project", |c| project::scan(c, &r));
    }
    guarded(&mut ctx, "registries", sources::registries);
    guarded(&mut ctx, "footprint", sources::footprints);
    let mut out = ctx.out;
    out.generated_at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    out.scan_ms = t0.elapsed().as_millis() as u64;
    out
}

/// Inclui a ocorrência no escopo pedido?
fn in_scope(p: &Placement, scope: &str, repo_id: Option<&str>) -> bool {
    match scope {
        "global" => p.scope == "global",
        "repo" => p.scope == "global" || (repo_id.is_some() && p.repo_id.as_deref() == repo_id),
        _ => true,
    }
}

fn invoke_for(kind: Kind, harness: &str, name: &str, plugin: Option<&str>) -> Option<Invoke> {
    let plugin_prefix = plugin.and_then(|p| p.split('@').next()).map(|p| format!("{p}:")).unwrap_or_default();
    let (how, text) = match (kind, harness) {
        (Kind::Skill, "claude") => ("slash", format!("/{plugin_prefix}{name}")),
        (Kind::Skill, "codex") => ("dollar", format!("${name}")),
        (Kind::Skill, _) => ("auto", name.to_string()),
        (Kind::Command, "codex") => ("slash", format!("/prompts:{name}")),
        (Kind::Command, _) => ("slash", format!("/{plugin_prefix}{name}")),
        (Kind::Prompt, "codex") => ("slash", format!("/prompts:{name}")),
        (Kind::Prompt, _) => ("slash", format!("/{name}")),
        (Kind::Agent, "claude") => ("mention", format!("@agent-{name}")),
        (Kind::Agent, _) => ("mention", format!("@{name}")),
        (Kind::Mcp, "claude") => ("tool", format!("mcp__{name}__*")),
        (Kind::Mcp, _) => ("tool", name.to_string()),
        _ => return None,
    };
    Some(Invoke { harness: harness.into(), how: how.into(), text })
}

/// Monta o snapshot do escopo pedido a partir do scan (rápido: só memória).
pub fn build(out: &ScanOut, q: &Query, prefs: &super::prefs::Prefs) -> Snapshot {
    let scope = q.scope.clone().filter(|s| matches!(s.as_str(), "global" | "repo" | "all")).unwrap_or_else(|| "all".into());
    let repo_id = q.repo_id.as_deref().filter(|_| scope == "repo");
    let mut by_id: BTreeMap<String, Item> = BTreeMap::new();
    let mut order: Vec<String> = vec![];
    for r in out.raws.iter().filter(|r| in_scope(&r.placement, &scope, repo_id)) {
        let id = r.item_id();
        let mut pl = r.placement.clone();
        if pl.source_id.is_none() {
            let rk = pl.repo_id.clone().unwrap_or_default();
            pl.source_id = out.name_sources.get(&(rk, r.kind, r.name.clone())).or_else(|| out.name_sources.get(&(String::new(), r.kind, r.name.clone()))).cloned();
        }
        let it = by_id.entry(id.clone()).or_insert_with(|| {
            order.push(id.clone());
            Item { id: id.clone(), kind: r.kind, name: r.name.clone(), status: "ok".into(), ..Default::default() }
        });
        // A descrição da cópia canônica/real vence a de links e de cópias geridas.
        let better = it.description.is_none() || (pl.canonical && r.description.is_some());
        if better && r.description.is_some() {
            it.description = r.description.clone();
        }
        for (k, v) in &r.extras {
            it.extras.entry(k.clone()).or_insert_with(|| v.clone());
        }
        it.weight_tokens = it.weight_tokens.max(r.weight);
        for x in &r.risks {
            if !it.risks.contains(x) {
                it.risks.push(x.clone());
            }
        }
        if let Some(inv) = invoke_for(r.kind, &pl.harness, &r.name, pl.plugin.as_deref()) {
            if !it.invoke.iter().any(|i| i.harness == inv.harness && i.text == inv.text) {
                it.invoke.push(inv);
            }
        }
        if r.missing_description {
            it.extras.entry("_missingDescription".into()).or_insert_with(|| "1".into());
        }
        it.placements.push(pl);
    }
    let mut items: Vec<Item> = order.into_iter().filter_map(|id| by_id.remove(&id)).collect();
    for it in items.iter_mut() {
        it.placements.sort_by(|a, b| (!a.canonical, providers::order(&a.harness), &a.account, &a.repo, &a.path).cmp(&(!b.canonical, providers::order(&b.harness), &b.account, &b.repo, &b.path)));
        let mut hs: Vec<String> = it.placements.iter().map(|p| p.harness.clone()).collect::<BTreeSet<_>>().into_iter().collect();
        hs.sort_by_key(|h| providers::order(h));
        it.harnesses = hs;
        // Fonte do item: a da cópia canônica, depois a mais comum que não seja "local".
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for p in &it.placements {
            if let Some(s) = &p.source_id {
                *counts.entry(s.clone()).or_default() += if p.canonical { 100 } else { 1 };
            }
        }
        it.source_id = counts.into_iter().max_by_key(|(_, n)| *n).map(|(s, _)| s);
        let desc = it.description.clone().unwrap_or_default();
        it.purpose = super::category::purpose(&desc);
        let triggers = it.extras.get("triggers").or(it.extras.get("trigger")).cloned().unwrap_or_default();
        it.categories = match prefs.categories.get(&it.id) {
            Some(c) => vec![c.clone()],
            None => super::category::categorize(&it.name, &desc, &triggers),
        };
        it.favorite = prefs.favorites.contains(&it.id);
        it.note = prefs.notes.get(&it.id).cloned();
    }
    // Itens sem fonte conhecida entram na fonte "local" (sem registro) ou na da IA quando embutidos.
    let mut sources: BTreeMap<String, Source> = out.sources.clone();
    for it in items.iter_mut() {
        if it.source_id.is_none() {
            let managed = it.placements.iter().all(|p| p.managed && p.plugin.is_none());
            let id = if managed {
                format!("builtin:{}", it.harnesses.first().cloned().unwrap_or_default())
            } else if it.placements.iter().all(|p| p.scope == "project") {
                "project".into()
            } else {
                "local".into()
            };
            sources.entry(id.clone()).or_insert_with(|| {
                let (kind, label) = if managed {
                    let h = it.harnesses.first().cloned().unwrap_or_default();
                    let label = providers::get(&h).map(|p| p.label).unwrap_or("?");
                    (if it.placements.iter().any(|p| p.format.contains("synced")) { SourceKind::Synced } else { SourceKind::Builtin }, label.to_string())
                } else if id == "project" {
                    (SourceKind::Project, "project".into())
                } else {
                    (SourceKind::Local, "local".into())
                };
                Source::new(&id, kind, label)
            });
            it.source_id = Some(id);
        }
    }
    let mut findings = super::health::check(&items, &sources);
    for f in &out.findings {
        let keep = match f.args.get("repoId") {
            Some(r) => scope == "all" || (scope == "repo" && Some(r.as_str()) == repo_id),
            None => true,
        };
        if keep && !findings.iter().any(|x| x.id == f.id) {
            findings.push(f.clone());
        }
    }
    findings.sort_by(|a, b| b.severity.cmp(&a.severity).then(a.kind.cmp(&b.kind)).then(a.id.cmp(&b.id)));
    let sev_rank = |s: Severity| match s {
        Severity::Info => "info",
        Severity::Warn => "warn",
        Severity::Error => "error",
    };
    let mut worst: HashMap<String, Severity> = HashMap::new();
    let mut fids: HashMap<String, Vec<String>> = HashMap::new();
    for f in &findings {
        for id in &f.item_ids {
            fids.entry(id.clone()).or_default().push(f.id.clone());
            let w = worst.entry(id.clone()).or_insert(f.severity);
            if f.severity > *w {
                *w = f.severity;
            }
        }
    }
    for it in items.iter_mut() {
        it.finding_ids = fids.remove(&it.id).unwrap_or_default();
        it.status = worst.get(&it.id).map(|s| sev_rank(*s).to_string()).unwrap_or_else(|| "ok".into());
        it.extras.remove("_missingDescription");
    }
    // Fontes: só as que têm item neste escopo ou pegada fora das pastas de extensão.
    for s in sources.values_mut() {
        s.item_ids.clear();
    }
    for it in &items {
        if let Some(s) = it.source_id.as_ref().and_then(|s| sources.get_mut(s)) {
            s.item_ids.push(it.id.clone());
        }
    }
    let sources: Vec<Source> = sources.into_values().filter(|s| !s.item_ids.is_empty() || (!s.footprint.is_empty() && scope != "repo")).collect();
    let kind_rank = |k: Kind| k as usize;
    items.sort_by(|a, b| kind_rank(a.kind).cmp(&kind_rank(b.kind)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())).then_with(|| a.id.cmp(&b.id)));
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for it in &items {
        for h in &it.harnesses {
            *counts.entry(h.clone()).or_default() += 1;
        }
    }
    let mut harnesses: Vec<HarnessSummary> = counts.into_iter().map(|(id, count)| HarnessSummary { label: providers::get(&id).map(|p| p.label.to_string()).unwrap_or_else(|| id.clone()), id, count }).collect();
    harnesses.sort_by_key(|h| providers::order(&h.id));
    let roots = out.roots.iter().filter(|r| scope == "all" || r.repo.is_none() || (scope == "repo" && out.repos.iter().any(|x| Some(x.id.as_str()) == repo_id && Some(&x.name) == r.repo.as_ref()))).cloned().collect();
    Snapshot { schema: SCHEMA, generated_at: out.generated_at, scan_ms: out.scan_ms, stale: false, scope, repo_id: repo_id.map(String::from), harnesses, roots, items, sources, findings }
}

#[cfg(test)]
mod tests;
