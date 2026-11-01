//! Perfis sintéticos de usuário (árvores em pasta temporária, links criados no teste) e formatos por
//! versão. Nada aqui vem de uma máquina real: home, repositórios e pacotes são fictícios.
use super::*;
use crate::tools::fsx::testfs::Tmp;
use crate::tools::prefs::Prefs;

/// Home + estado + um repositório fictícios.
struct Env {
    t: Tmp,
}

impl Env {
    fn new(tag: &str) -> Self {
        let t = Tmp::new(tag);
        std::fs::create_dir_all(t.path().join("home")).unwrap();
        std::fs::create_dir_all(t.path().join("repo")).unwrap();
        Self { t }
    }
    fn home(&self) -> PathBuf {
        self.t.path().join("home")
    }
    fn repo_path(&self) -> PathBuf {
        self.t.path().join("repo")
    }
    fn repo(&self) -> RepoRef {
        RepoRef { id: "r1".into(), name: "acme-web".into(), path: self.repo_path() }
    }
    fn roots(&self, os: &str) -> Roots {
        Roots { state: self.t.path().join("state"), ..Roots::for_os(os, &self.home()) }
    }
    fn slash(p: &Path) -> String {
        p.display().to_string().replace('\\', "/")
    }
    /// Fixture com `{HOME}`/`{REPO}` trocados pelos caminhos sintéticos.
    fn fx(&self, text: &str) -> String {
        text.replace("{HOME}", &Self::slash(&self.home())).replace("{REPO}", &Self::slash(&self.repo_path()))
    }
    fn home_file(&self, rel: &str, text: &str) -> PathBuf {
        self.t.write(&format!("home/{rel}"), &self.fx(text))
    }
    fn repo_file(&self, rel: &str, text: &str) -> PathBuf {
        self.t.write(&format!("repo/{rel}"), &self.fx(text))
    }
    fn home_link(&self, target: &str, rel: &str) -> bool {
        self.t.link(target, &format!("home/{rel}"))
    }
    fn repo_link(&self, target: &str, rel: &str) -> bool {
        self.t.link(target, &format!("repo/{rel}"))
    }
    fn scan(&self, roots: &Roots, repos: &[RepoRef]) -> (ScanOut, Snapshot) {
        let mut cache = FileCache::default();
        let out = scan_all(roots, repos, &mut cache);
        let snap = build(&out, &Query::default(), &Prefs::default());
        (out, snap)
    }
}

fn skill_md(name: &str, desc: &str) -> String {
    format!("---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n\nCorpo da skill.\n")
}

fn item<'a>(s: &'a Snapshot, id: &str) -> &'a Item {
    s.items.iter().find(|i| i.id == id).unwrap_or_else(|| panic!("item {id} ausente; tem: {:?}", s.items.iter().map(|i| &i.id).collect::<Vec<_>>()))
}

fn has(s: &Snapshot, kind: FindingKind, id: &str) -> bool {
    s.findings.iter().any(|f| f.kind == kind && (id.is_empty() || f.item_ids.iter().any(|x| x == id)))
}

#[test]
fn perfil_npx_skills_varios_agentes() {
    let e = Env::new("npx");
    e.home_file(".agents/skills/deploy-checklist/SKILL.md", &skill_md("deploy-checklist", "Checklist before deploying to production. Use when the user asks to deploy."));
    e.home_file(".agents/skills/review-helper/SKILL.md", &skill_md("review-helper", "Code review helper"));
    e.home_file(".agents/skills/lonely/SKILL.md", &skill_md("lonely", "Only in the shared folder"));
    e.home_file(".agents/.skill-lock.json", include_str!("../fixtures/skill-lock-v3.json"));
    let links = e.home_link("../../.agents/skills/deploy-checklist", ".claude/skills/deploy-checklist")
        && e.home_link("../../.agents/skills/deploy-checklist", ".codex/skills/deploy-checklist")
        && e.home_link("../../.agents/skills/deploy-checklist", ".gemini/skills/deploy-checklist")
        && e.home_link("../../.agents/skills/old", ".qwen/skills/old");
    // Cópia idêntica no Cursor e cópia diferente no OpenCode.
    e.home_file(".cursor/skills/deploy-checklist/SKILL.md", &skill_md("deploy-checklist", "Checklist before deploying to production. Use when the user asks to deploy."));
    e.home_file(".config/opencode/skills/review-helper/SKILL.md", &skill_md("review-helper", "Code review helper (edited)"));
    let (_, s) = e.scan(&e.roots("macos"), &[]);
    let d = item(&s, "skill:deploy-checklist");
    assert_eq!(d.purpose.as_deref(), Some("Checklist before deploying to production"));
    assert_eq!(d.source_id.as_deref(), Some("gh:acme/skills"));
    assert!(d.harnesses.contains(&"shared".to_string()) && d.harnesses.contains(&"cursor".to_string()));
    assert!(d.invoke.iter().any(|i| i.harness == "cursor"));
    assert!(has(&s, FindingKind::DuplicateCopy, "skill:deploy-checklist"), "canônico + cópia idêntica");
    assert!(has(&s, FindingKind::Drift, "skill:review-helper"));
    assert!(has(&s, FindingKind::Orphan, "skill:lonely"));
    assert!(has(&s, FindingKind::RegistryMissing, "skill:gone-skill"), "lock aponta skill que sumiu");
    let src = s.sources.iter().find(|x| x.id == "gh:acme/skills").unwrap();
    assert_eq!(src.url.as_deref(), Some("https://github.com/acme/skills.git"));
    assert!(s.sources.iter().any(|x| x.id == "wk:docs.example.com" && x.kind == SourceKind::SkillsLock));
    if links {
        let kinds: Vec<_> = d.placements.iter().map(|p| (p.harness.as_str(), matches!(p.link, Link::Symlink { .. }))).collect();
        assert!(kinds.contains(&("claude", true)) && kinds.contains(&("codex", true)) && kinds.contains(&("gemini", true)));
        assert!(d.invoke.iter().any(|i| i.text == "/deploy-checklist") && d.invoke.iter().any(|i| i.text == "$deploy-checklist"));
        assert!(has(&s, FindingKind::BrokenLink, "skill:old"));
        assert_eq!(s.findings.iter().find(|f| f.kind == FindingKind::BrokenLink).unwrap().severity, Severity::Error);
        // Link para o canônico não é duplicado: só a cópia do Cursor conta (2 cópias reais).
        let dup = s.findings.iter().find(|f| f.kind == FindingKind::DuplicateCopy && f.item_ids[0] == "skill:deploy-checklist").unwrap();
        assert_eq!(dup.args["copies"], "2");
    }
    assert!(s.roots.iter().any(|r| r.harness == "shared" && r.what == "lock"));
    assert!(s.roots.iter().any(|r| r.harness == "roo" && r.status == "missing"), "IA não instalada aparece como ausente");
}

#[test]
fn perfil_so_claude_com_plugins() {
    let e = Env::new("claude");
    let c = ".claude/plugins";
    e.home_file(&format!("{c}/installed_plugins.json"), include_str!("../fixtures/installed_plugins_v2.json"));
    e.home_file(&format!("{c}/known_marketplaces.json"), include_str!("../fixtures/known_marketplaces.json"));
    let v2 = format!("{c}/cache/acme-market/acme-tools/2.0.0");
    e.home_file(&format!("{v2}/.claude-plugin/plugin.json"), r#"{"name":"acme-tools","description":"Acme toolkit","version":"2.0.0","author":{"name":"Acme"},"license":"MIT"}"#);
    e.home_file(&format!("{v2}/skills/plan-it/SKILL.md"), &skill_md("plan-it", "Plan a feature step by step"));
    e.home_file(&format!("{v2}/commands/ship.md"), "---\ndescription: Ship it\n---\nShip.");
    e.home_file(&format!("{v2}/agents/reviewer.md"), "---\nname: reviewer\ndescription: Reviews diffs\n---\n");
    e.home_file(&format!("{v2}/hooks/hooks.json"), r#"{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/scripts/start.sh"}]}]}}"#);
    e.home_file(&format!("{v2}/.mcp.json"), r#"{"mcpServers":{"acme-api":{"command":"npx","args":["-y","acme-api-mcp"]}}}"#);
    e.home_file(&format!("{c}/cache/acme-market/acme-tools/1.0.0/.claude-plugin/plugin.json"), r#"{"name":"acme-tools"}"#);
    e.home_file(&format!("{c}/cache/acme-market/notes/0.1.0/.claude-plugin/plugin.json"), r#"{"name":"notes","description":"Notes"}"#);
    e.home_file(".claude/settings.json", include_str!("../fixtures/claude_settings.json"));
    e.home_file(".claude.json", include_str!("../fixtures/dot_claude.json"));
    e.home_file(".claude/commands/git/commit.md", "---\ndescription: Write a commit message\n---\n");
    e.home_file(".claude/agents/helper.md", "---\nname: helper\ndescription: Helps\n---\n");
    e.home_file(".acmetool/bin/acmetool-guard", "#!/bin/sh\n");
    e.home_file(".acmetool/bin/acmetool-mcp", "#!/bin/sh\n");
    e.home_file(".acmetool/hooks/claude-hook.js", "");
    let (out, s) = e.scan(&e.roots("linux"), &[e.repo()]);
    let p = item(&s, "plugin:acme-tools@acme-market");
    assert_eq!(p.description.as_deref(), Some("Acme toolkit"));
    assert_eq!(p.placements[0].enabled, Some(true));
    assert_eq!(p.placements[0].version.as_deref(), Some("2.0.0"));
    assert_eq!(p.source_id.as_deref(), Some("mkt:acme-market"));
    assert_eq!(s.sources.iter().find(|x| x.id == "mkt:acme-market").unwrap().repo.as_deref(), Some("acme/plugins"));
    let sk = item(&s, "skill:acme-tools:plan-it");
    assert!(sk.placements[0].managed && sk.placements[0].plugin.as_deref() == Some("acme-tools@acme-market"));
    assert!(sk.invoke.iter().any(|i| i.text == "/acme-tools:plan-it"));
    item(&s, "command:acme-tools:ship");
    item(&s, "agent:acme-tools:reviewer");
    item(&s, "mcp:acme-tools:acme-api");
    item(&s, "command:git:commit");
    item(&s, "agent:helper");
    // Plugin de projeto ligado ao repositório do Kabul.
    let notes = item(&s, "plugin:notes@acme-market");
    assert_eq!(notes.placements[0].repo_id.as_deref(), Some("r1"));
    assert!(has(&s, FindingKind::StalePluginVersion, "plugin:acme-tools@acme-market"));
    assert!(has(&s, FindingKind::RegistryMissing, "plugin:ghost@acme-market"));
    // MCP: usuário, local por projeto e risco de rede.
    let web = item(&s, "mcp:web");
    assert!(web.risks.contains(&"network".to_string()));
    assert_eq!(web.extras.get("headers").map(String::as_str), Some("Authorization"));
    assert_eq!(item(&s, "mcp:acmetool").extras.get("env").map(String::as_str), Some("ACME_API_KEY"));
    assert_eq!(item(&s, "mcp:team-db").placements[0].repo_id.as_deref(), Some("r1"));
    assert!(has(&s, FindingKind::UnpinnedMcp, "mcp:acme-tools:acme-api"));
    // Hooks: o programa vira o nome; segredos redigidos; pegada da ferramenta.
    let guard = item(&s, "hook:acmetool-guard");
    assert!(guard.risks.contains(&"runsCode".to_string()));
    assert!(guard.extras["command"].contains(crate::tools::redact::MASK));
    item(&s, "hook:acmetool/claude-hook");
    let tool = s.sources.iter().find(|x| x.id == "tool:acmetool").expect("pegada da ferramenta");
    let fk: BTreeSet<&str> = tool.footprint.iter().map(|f| f.kind.as_str()).collect();
    assert!(fk.contains("dir") && fk.contains("binary") && fk.contains("hook") && fk.contains("mcp"), "{fk:?}");
    // Nada de segredo no que vai para a interface.
    let json = serde_json::to_string(&s).unwrap();
    for secret in ["abcdef1234567890abcdef1234567890", "sk-live-", "Bearer abc"] {
        assert!(!json.contains(secret), "vazou {secret}");
    }
    // Detalhe: corpo da skill; MCP sem corpo.
    let d = crate::tools::item_detail(&out, &s, "skill:acme-tools:plan-it").unwrap();
    assert!(d.body.unwrap().contains("Corpo da skill"));
    assert!(crate::tools::item_detail(&out, &s, "mcp:acmetool").unwrap().body.is_none());
}

#[test]
fn perfil_cursor_e_copilot_com_regras() {
    let e = Env::new("cursor");
    e.repo_file(".cursor/rules/style.mdc", "---\ndescription: House style\nglobs: \"**/*.ts\"\nalwaysApply: false\n---\nUse tabs.");
    e.repo_file(".cursor/rules/api/errors.mdc", "---\ndescription: API errors\n---\n");
    e.repo_file(".cursor/mcp.json", r#"{"mcpServers":{"lint":{"command":"node","args":["lint.js"]}}}"#);
    e.repo_file(".github/copilot-instructions.md", "Always write tests.");
    e.repo_file(".github/prompts/release.prompt.md", "---\ndescription: Draft release notes\n---\n");
    e.repo_file(".github/instructions/ts.instructions.md", "---\napplyTo: \"**/*.ts\"\n---\nStrict TS.");
    e.repo_file(".vscode/mcp.json", r#"{"servers":{"browser":{"type":"stdio","command":"npx","args":["browser-mcp@1.2.0"]}}}"#);
    e.repo_file("AGENTS.md", "# Agents\n\nRun npm test before commit.");
    e.home_file("Library/Application Support/Code/User/prompts/explain.prompt.md", "---\ndescription: Explain code\n---\n");
    e.home_file(".cursor/commands/fix.md", "Fix the bug.");
    let (out, s) = e.scan(&e.roots("macos"), &[e.repo()]);
    let rules: Vec<_> = s.items.iter().filter(|i| i.kind == Kind::Instructions).map(|i| i.name.as_str()).collect();
    for r in ["rules/style.mdc", "rules/api/errors.mdc", ".github/copilot-instructions.md", "instructions/ts.instructions.md", "AGENTS.md"] {
        assert!(rules.contains(&r), "{r} em {rules:?}");
    }
    assert_eq!(item(&s, "prompt:release").harnesses, vec!["copilot".to_string()]);
    assert_eq!(item(&s, "prompt:explain").harnesses, vec!["vscode".to_string()]);
    assert!(item(&s, "mcp:browser").risks.is_empty(), "versão fixada não é risco");
    item(&s, "mcp:lint");
    item(&s, "command:fix");
    // Escopos: global não traz o projeto; "Este repo" traz os dois.
    let g = build(&out, &Query { scope: Some("global".into()), ..Default::default() }, &Prefs::default());
    assert!(g.items.iter().all(|i| i.placements.iter().all(|p| p.scope == "global")));
    assert!(g.items.iter().any(|i| i.id == "prompt:explain") && !g.items.iter().any(|i| i.id == "prompt:release"));
    let r = build(&out, &Query { scope: Some("repo".into()), repo_id: Some("r1".into()), ..Default::default() }, &Prefs::default());
    assert!(r.items.iter().any(|i| i.id == "prompt:release") && r.items.iter().any(|i| i.id == "prompt:explain"));
    assert_eq!(r.repo_id.as_deref(), Some("r1"));
}

#[test]
fn perfil_windows_com_links() {
    let e = Env::new("win");
    let roots = e.roots("windows");
    e.home_file("AppData/Roaming/Block/goose/config/skills/g1/SKILL.md", &skill_md("g1", "Goose skill on Windows"));
    e.home_file("AppData/Roaming/Code/User/prompts/w.prompt.md", "---\ndescription: Windows prompt\n---\n");
    e.home_file(".agents/skills/shared-win/SKILL.md", &skill_md("shared-win", "Shared on Windows"));
    // No Windows o `npx skills` cria junção; aqui um link de pasta faz o papel dela.
    let linked = e.home_link("../../.agents/skills/shared-win", ".claude/skills/shared-win");
    let pkg = "AppData/Roaming/npm/node_modules/@acme/hooks";
    e.home_file(&format!("{pkg}/package.json"), r#"{"name":"@acme/hooks","version":"1.2.3"}"#);
    e.home_file(&format!("{pkg}/dist/hook.js"), "");
    let hook_cmd = format!("node \"{}\"", Env::slash(&e.home().join(pkg).join("dist").join("hook.js")));
    e.home_file(".claude/settings.json", &format!(r#"{{"hooks":{{"Stop":[{{"hooks":[{{"type":"command","command":{}}}]}}]}}}}"#, serde_json::to_string(&hook_cmd).unwrap()));
    let (_, s) = e.scan(&roots, &[]);
    let g = item(&s, "skill:g1");
    assert_eq!(g.placements[0].path, "~/AppData/Roaming/Block/goose/config/skills/g1");
    item(&s, "prompt:w");
    if linked {
        assert!(matches!(item(&s, "skill:shared-win").placements.iter().find(|p| p.harness == "claude").unwrap().link, Link::Symlink { .. }));
        assert!(!has(&s, FindingKind::DuplicateCopy, "skill:shared-win"));
    }
    let src = s.sources.iter().find(|x| x.footprint.iter().any(|f| f.kind == "npm")).expect("pacote npm global do hook");
    assert!(src.footprint.iter().any(|f| f.label == "@acme/hooks@1.2.3"));
}

#[test]
fn perfil_time_com_lock_e_plugins_declarados() {
    let e = Env::new("team");
    e.repo_file("skills-lock.json", include_str!("../fixtures/skills-lock-project.json"));
    e.repo_file(".agents/skills/team-style/SKILL.md", &skill_md("team-style", "Team coding style"));
    let linked = e.repo_link("../../.agents/skills/team-style", ".claude/skills/team-style");
    e.repo_file(".claude/settings.json", r#"{"enabledPlugins":{"team-kit@team-market":true},"extraKnownMarketplaces":{"team-market":{"source":{"source":"github","repo":"acme/team-market"}}}}"#);
    e.repo_file(".mcp.json", r#"{"mcpServers":{"team-api":{"command":"npx","args":["-y","team-api-mcp"],"env":{"TEAM_TOKEN":"<your-token>"}}}}"#);
    e.repo_file("CLAUDE.md", "# Team rules");
    e.repo_file(".claude/commands/ops/deploy.md", "---\ndescription: Deploy\n---\n");
    e.repo_file("libs/sub/.git/HEAD", "ref: refs/heads/main\n");
    e.repo_file(".obsidian/plugins/calendar/manifest.json", "{}");
    e.repo_file(".claude-plugin/marketplace.json", r#"{"name":"acme-web-market","plugins":[{"name":"web-kit","description":"Kit","version":"0.1.0","source":"./plugins/web-kit"}]}"#);
    e.repo_file(
        "server.json",
        r#"{"$schema":"https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json","name":"io.example/acme","description":"Acme MCP","version":"1.0.0","packages":[{"registryType":"npm","identifier":"@acme/mcp"}]}"#,
    );
    let (out, s) = e.scan(&e.roots("linux"), &[e.repo()]);
    let ts = item(&s, "skill:team-style");
    assert_eq!(ts.source_id.as_deref(), Some("gh:acme/team-skills"));
    if linked {
        assert!(!has(&s, FindingKind::DuplicateCopy, "skill:team-style"));
    }
    let kit = item(&s, "plugin:team-kit@team-market");
    assert_eq!(kit.placements[0].enabled, Some(true));
    assert!(has(&s, FindingKind::RegistryMissing, "plugin:team-kit@team-market"), "declarado e não instalado");
    assert_eq!(s.sources.iter().find(|x| x.id == "mkt:team-market").unwrap().repo.as_deref(), Some("acme/team-market"));
    assert!(has(&s, FindingKind::Placeholder, "mcp:team-api"));
    assert!(has(&s, FindingKind::NestedRepo, ""));
    assert!(s.items.iter().any(|i| i.kind == Kind::Foreign && i.extras.get("plugins").map(String::as_str) == Some("calendar")));
    item(&s, "plugin:web-kit@acme-web-market");
    assert!(item(&s, "mcp:published:io.example/acme").extras.contains_key("published"));
    item(&s, "command:ops:deploy");
    item(&s, "instructions:acme-web:CLAUDE.md");
    // Escopo global não mostra nada do projeto, nem achados dele.
    let g = build(&out, &Query { scope: Some("global".into()), ..Default::default() }, &Prefs::default());
    assert!(!g.items.iter().any(|i| i.id == "skill:team-style"));
    assert!(!g.findings.iter().any(|f| f.kind == FindingKind::NestedRepo));
}

#[test]
fn perfil_pacote_com_registro_proprio() {
    let e = Env::new("pkg");
    let plan = skill_md("bigpack-plan", "Plan with bigpack");
    e.home_file(".claude/skills/bigpack-plan/SKILL.md", &plan);
    e.home_file(".claude/skills/bigpack-review/SKILL.md", &skill_md("bigpack-review", "Review with bigpack (edited locally)"));
    let sha = crate::usage::sha256_hex(plan.as_bytes());
    e.home_file(".claude/ecc/install-state.json", &include_str!("../fixtures/install_state_pkg.json").replace("{SHA_OK}", &sha));
    // Ferramenta com pasta própria que registra o que mexeu nas IAs.
    e.home_file(".acmetool/integrations/claude.json", include_str!("../fixtures/integration_claude.json"));
    e.home_file(".acmetool/bin/acmetool-mcp", "");
    e.home_file(".claude.json", include_str!("../fixtures/dot_claude.json"));
    e.home_file(".claude/settings.json", include_str!("../fixtures/claude_settings.json"));
    let (_, s) = e.scan(&e.roots("linux"), &[]);
    let src = s.sources.iter().find(|x| x.id == "tool:bigpack").expect("fonte do pacote");
    assert_eq!(src.version.as_deref(), Some("1.4.0"));
    assert_eq!(item(&s, "skill:bigpack-plan").source_id.as_deref(), Some("tool:bigpack"));
    assert!(has(&s, FindingKind::RegistryEdited, "skill:bigpack-review"));
    let missing = s.findings.iter().find(|f| f.kind == FindingKind::RegistryMissing && f.args.get("source").map(String::as_str) == Some("bigpack")).unwrap();
    assert!(missing.paths[0].ends_with("bigpack-gone.md"));
    let tool = s.sources.iter().find(|x| x.id == "tool:acmetool").unwrap();
    assert!(tool.footprint.iter().any(|f| f.kind == "registry"));
    assert!(tool.footprint.iter().any(|f| f.kind == "settings" && f.label == "settings.json"));
    assert_eq!(tool.version.as_deref(), Some("2.0.0"));
}

#[test]
fn contas_isoladas_e_variaveis() {
    let e = Env::new("acct");
    let mut roots = e.roots("linux");
    let alt = e.t.path().join("alt-claude");
    roots.env.insert("CLAUDE_CONFIG_DIR".into(), alt.clone());
    e.t.write("alt-claude/skills/moved/SKILL.md", &skill_md("moved", "In CLAUDE_CONFIG_DIR"));
    e.t.write("alt-claude/.claude.json", r#"{"mcpServers":{"alt-mcp":{"command":"alt"}}}"#);
    e.home_file(".claude/skills/ignored/SKILL.md", &skill_md("ignored", "Default dir is not read when moved"));
    let codex = e.t.path().join("codex-home");
    roots.env.insert("CODEX_HOME".into(), codex.clone());
    e.t.write("codex-home/prompts/p1.md", "---\ndescription: P1\n---\n");
    // Contas do Kabul: uma do Claude (pasta de config) e uma do Gemini (HOME isolado).
    let st = roots.state.clone();
    let (ca, ga) = (st.join("accounts/claude/a1"), st.join("accounts/gemini/g1"));
    e.t.write("state/accounts/claude/a1/skills/work-skill/SKILL.md", &skill_md("work-skill", "Work account skill"));
    e.t.write("state/accounts/claude/a1/.claude.json", r#"{"mcpServers":{"work-mcp":{"command":"w"}}}"#);
    e.t.write("state/accounts/gemini/g1/.gemini/skills/gem-skill/SKILL.md", &skill_md("gem-skill", "Personal gemini skill"));
    let doc = serde_json::json!({"schema_version": crate::schema::ACCOUNTS, "accounts": [
        {"id": "claude:a1", "provider": "claude", "nickname": "Trabalho", "dir": ca, "default": false},
        {"id": "gemini:g1", "provider": "gemini", "nickname": "Pessoal", "dir": ga, "default": false}
    ]});
    e.t.write("state/accounts.json", &doc.to_string());
    let (_, s) = e.scan(&roots, &[]);
    let m = item(&s, "skill:moved");
    assert!(m.placements[0].account.is_none());
    assert!(!s.items.iter().any(|i| i.id == "skill:ignored"), "base movida pela variável");
    assert!(s.roots.iter().any(|r| r.env.as_deref() == Some("CLAUDE_CONFIG_DIR")));
    item(&s, "mcp:alt-mcp");
    item(&s, "prompt:p1");
    assert_eq!(item(&s, "skill:work-skill").placements[0].account.as_deref(), Some("Trabalho"));
    assert_eq!(item(&s, "mcp:work-mcp").placements[0].account.as_deref(), Some("Trabalho"));
    let gem = item(&s, "skill:gem-skill");
    assert_eq!((gem.placements[0].account.as_deref(), gem.harnesses[0].as_str()), (Some("Pessoal"), "gemini"));
}

#[test]
fn formatos_por_versao() {
    // Locks do `npx skills`: v1, v2, v3 e uma versão futura (lida no melhor esforço, com aviso).
    for (fx, warn) in [(include_str!("../fixtures/skill-lock-v1.json"), false), (include_str!("../fixtures/skill-lock-v2.json"), false), (include_str!("../fixtures/skill-lock-v3.json"), false), (include_str!("../fixtures/skill-lock-v9.json"), true)]
    {
        let e = Env::new("lock");
        e.home_file(".agents/skills/deploy-checklist/SKILL.md", &skill_md("deploy-checklist", "x"));
        e.home_file(".agents/.skill-lock.json", fx);
        let (_, s) = e.scan(&e.roots("linux"), &[]);
        assert_eq!(item(&s, "skill:deploy-checklist").source_id.as_deref(), Some("gh:acme/skills"), "{fx}");
        assert_eq!(has(&s, FindingKind::Unrecognized, ""), warn, "{fx}");
    }
    // Registro de plugins v1.
    let e = Env::new("plugins-v1");
    e.home_file(".claude/plugins/installed_plugins.json", include_str!("../fixtures/installed_plugins_v1.json"));
    e.home_file(".claude/plugins/cache/acme-market/acme-tools/1.0.0/.claude-plugin/plugin.json", r#"{"name":"acme-tools","description":"v1"}"#);
    let (_, s) = e.scan(&e.roots("linux"), &[]);
    assert_eq!(item(&s, "plugin:acme-tools@acme-market").placements[0].version.as_deref(), Some("1.0.0"));
    // Codex (config.toml), extensão do Gemini e OpenCode (JSONC com vírgula sobrando).
    let e = Env::new("cfgs");
    e.home_file(".codex/config.toml", include_str!("../fixtures/codex_config.toml"));
    e.home_file(".codex/plugins/cache/acme-curated/acme-tools/abc123/.codex-plugin/plugin.json", r#"{"name":"acme-tools","description":"Codex plugin"}"#);
    e.home_file(".codex/plugins/cache/acme-curated/acme-tools/abc123/skills/cx/SKILL.md", &skill_md("cx", "Codex plugin skill"));
    e.home_file(".gemini/extensions/acme-ext/gemini-extension.json", include_str!("../fixtures/gemini-extension.json"));
    e.home_file(".gemini/extensions/acme-ext/commands/hello.toml", "description = \"Say hello\"\nprompt = \"\"\"Hello!\"\"\"\n");
    e.home_file(".gemini/commands/review.toml", "description = \"Review\"\nprompt = \"Review {{args}}\"\n");
    e.home_file(".config/opencode/opencode.jsonc", include_str!("../fixtures/opencode.jsonc"));
    let (_, s) = e.scan(&e.roots("linux"), &[]);
    let docs = item(&s, "mcp:docs-search");
    assert!(docs.risks.contains(&"unpinned".to_string()) && docs.risks.contains(&"placeholder".to_string()));
    assert!(has(&s, FindingKind::Placeholder, "mcp:docs-search"));
    let remote = item(&s, "mcp:remote");
    assert!(!remote.extras["target"].contains("s3cr3t"), "{}", remote.extras["target"]);
    let cp = item(&s, "plugin:acme-tools@acme-curated");
    assert_eq!((cp.placements[0].enabled, cp.placements[0].version.as_deref()), (Some(true), Some("abc123")));
    item(&s, "skill:acme-tools:cx");
    let ext = item(&s, "extension:acme-ext");
    assert_eq!(ext.placements[0].version.as_deref(), Some("0.3.0"));
    assert_eq!(ext.extras.get("contextFile").map(String::as_str), Some("ACME.md"));
    item(&s, "mcp:acme-ext:acme-ext-mcp");
    item(&s, "command:acme-ext:hello");
    assert_eq!(item(&s, "command:review").description.as_deref(), Some("Review"));
    assert!(item(&s, "mcp:notes").risks.contains(&"unpinned".to_string()), "@latest");
}

#[test]
fn skill_md_variantes() {
    let e = Env::new("md");
    let sk = ".agents/skills";
    e.home_file(&format!("{sk}/minimal/SKILL.md"), "---\nname: minimal\ndescription: Minimal\n---\n");
    e.home_file(&format!("{sk}/no-front/SKILL.md"), "# No front\n\nDoes things without frontmatter.\n");
    e.home_file(&format!("{sk}/crlf/SKILL.md"), "\u{feff}---\r\nname: crlf\r\ndescription: >\r\n  Folded\r\n  text\r\n---\r\nBody");
    e.home_file(&format!("{sk}/colon/SKILL.md"), "---\nname: colon\ndescription: Use when: the user says x: y\n---\n");
    e.home_file(&format!("{sk}/broken-front/SKILL.md"), "---\nname: broken\ndescription: never closed\n");
    e.home_file(&format!("{sk}/huge/SKILL.md"), &format!("---\nname: huge\ndescription: Huge\n---\n{}", "palavra ".repeat(12_000)));
    e.t.write(&format!("home/{sk}/binary/SKILL.md"), "\u{0}\u{1}\u{2}");
    e.home_file(&format!("{sk}/no-skill-md/README.md"), "not a skill");
    e.home_file(&format!("{sk}/stray.txt"), "?");
    let (_, s) = e.scan(&e.roots("linux"), &[]);
    assert_eq!(item(&s, "skill:minimal").description.as_deref(), Some("Minimal"));
    let nf = item(&s, "skill:no-front");
    assert_eq!(nf.description.as_deref(), Some("Does things without frontmatter."));
    assert_eq!(item(&s, "skill:crlf").description.as_deref(), Some("Folded text"));
    assert_eq!(item(&s, "skill:colon").description.as_deref(), Some("Use when: the user says x: y"));
    assert!(has(&s, FindingKind::ParseError, ""), "frontmatter sem fechamento vira aviso");
    item(&s, "skill:broken-front");
    assert!(has(&s, FindingKind::Heavy, "skill:huge"));
    item(&s, "skill:binary");
    assert!(has(&s, FindingKind::Unrecognized, ""), "pasta sem SKILL.md e arquivo solto");
}

#[test]
fn lixo_e_loops_nao_quebram() {
    let e = Env::new("lixo");
    e.home_file(".claude/plugins/installed_plugins.json", "{ isto não é json");
    e.home_file(".claude/settings.json", "\u{0}\u{0}");
    e.home_file(".claude.json", "[1, 2");
    e.home_file(".agents/.skill-lock.json", r#"{"version":3,"skills":"nope"}"#);
    e.home_file(".codex/config.toml", "[[[ inválido");
    e.home_file(".gemini/settings.json", "");
    e.home_file(".gemini/commands/bad.toml", "description = ");
    e.home_file(".cursor/mcp.json", r#"{"mcpServers": 5}"#);
    e.home_file(".claude/skills/ok/SKILL.md", &skill_md("ok", "Still works"));
    let loops = e.home_link("loop-b", ".claude/skills/loop-a") && e.home_link("loop-a", ".claude/skills/loop-b");
    let (_, s) = e.scan(&e.roots("linux"), &[]);
    item(&s, "skill:ok");
    assert!(s.findings.iter().filter(|f| f.kind == FindingKind::ParseError).count() >= 4);
    if loops {
        assert!(has(&s, FindingKind::BrokenLink, "skill:loop-a"), "loop de links vira link quebrado");
    }
}

#[test]
fn favoritos_e_categoria_manual() {
    let e = Env::new("prefs");
    e.home_file(".agents/skills/tdd/SKILL.md", &skill_md("tdd", "Write the failing test first"));
    let mut cache = FileCache::default();
    let out = scan_all(&e.roots("linux"), &[], &mut cache);
    let mut p = Prefs::default();
    p.apply(&crate::tools::prefs::Change { id: "skill:tdd".into(), favorite: Some(true), note: Some("uso sempre".into()), category: Some("planning".into()) });
    let s = build(&out, &Query::default(), &p);
    let t = item(&s, "skill:tdd");
    assert!(t.favorite && t.note.as_deref() == Some("uso sempre") && t.categories == vec!["planning".to_string()]);
    assert_eq!(build(&out, &Query::default(), &Prefs::default()).items[0].categories[0], "testing");
}

/// Windows de verdade: junção (`mklink /J`, sem privilégio) no lugar do link simbólico.
#[cfg(windows)]
#[test]
fn juncao_no_windows() {
    let e = Env::new("junction");
    e.home_file(".agents/skills/j/SKILL.md", &skill_md("j", "Junction"));
    std::fs::create_dir_all(e.home().join(".claude/skills")).unwrap();
    let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(e.home().join(".claude/skills/j")).arg(e.home().join(".agents/skills/j")).output().map(|o| o.status.success()).unwrap_or(false);
    let (_, s) = e.scan(&e.roots("windows"), &[]);
    if ok {
        let j = item(&s, "skill:j");
        assert!(j.placements.iter().any(|p| p.harness == "claude" && !matches!(p.link, Link::Broken { .. })));
        assert!(!has(&s, FindingKind::DuplicateCopy, "skill:j"), "junção não é cópia");
    }
}
