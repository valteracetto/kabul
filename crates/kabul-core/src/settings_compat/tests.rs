//! Cada forma documentada do formato legado (fixtures copiadas da documentação pública) e o caso de
//! campo inválido: só o campo fica de fora, com aviso. Nas fixtures, `LEGACY_` marca o prefixo legado das
//! variáveis (`crate::compat::legacy_env_prefix`), trocado por `fx` ao carregar.
use super::*;
use crate::settings::{self, Settings, SettingsWarning};

/// Troca o marcador `LEGACY_` pelo prefixo legado de verdade.
fn fx(text: &str) -> String {
    text.replace("LEGACY_", &crate::compat::legacy_env_prefix())
}

fn toml(text: &str) -> (Settings, Vec<SettingsWarning>) {
    let (s, w) = read(text, Format::Toml, "f.toml");
    (s.expect("a camada não pode ser descartada"), w)
}

/// `(chave, tipo do aviso)` de cada aviso, para comparar sem os detalhes.
fn keys(w: &[SettingsWarning]) -> Vec<(String, String)> {
    let mut v: Vec<_> = w.iter().map(|x| (x.key.clone(), x.kind.clone())).collect();
    v.sort();
    v
}

fn kv(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut v: Vec<_> = pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    v.sort();
    v
}

#[test]
fn exemplo_completo_da_documentacao() {
    let (s, w) = toml(&fx(include_str!("fixtures/exemplo-completo.toml")));
    assert_eq!(s.file_include_globs, vec![".env*", "config/*.local.json"]);
    assert_eq!(s.scripts.setup.as_deref(), Some("pnpm install"));
    assert_eq!(s.scripts.archive.as_deref(), Some("./script/workspace-archive.sh"));
    assert_eq!(s.scripts.run_mode.as_deref(), Some("concurrent"));
    assert_eq!(s.scripts.run["dev"].command, fx("pnpm dev --port $LEGACY_PORT"));
    assert!(s.scripts.run["dev"].default);
    assert_eq!(s.scripts.run["test"].icon.as_deref(), Some("test-tube"));
    // environment_variables (geral) + .local viram [env]; .cloud fica de fora.
    assert_eq!(s.env.get("ANTHROPIC_BASE_URL").map(String::as_str), Some("https://api.example.com"));
    assert_eq!(s.env.get("LOCAL_AGENT_MODE").map(String::as_str), Some("1"));
    assert!(!s.env.contains_key("OPENAI_BASE_URL"));
    // Os seis prompts, com os nomes legados mapeados.
    assert_eq!(s.prompts.general.as_deref(), Some("Prefer small, reviewable changes and run the narrowest relevant tests."));
    assert_eq!(s.prompts.review.as_deref(), Some("Focus on correctness, behavior changes, and missing tests."));
    assert_eq!(s.prompts.create_pr.as_deref(), Some("Write a concise PR description with test results."));
    assert_eq!(s.prompts.fix_errors.as_deref(), Some("Explain the likely cause before changing code."));
    assert_eq!(s.prompts.resolve_conflicts.as_deref(), Some("Preserve user changes unless the conflict proves they are obsolete."));
    assert_eq!(s.prompts.branch_rename.as_deref(), Some("Use a short kebab-case branch name."));
    // [git]
    assert_eq!((s.archive_on_merge, s.delete_branch_on_archive), (Some(true), Some(false)));
    assert_eq!(
        keys(&w),
        kv(&[("enterprise_data_privacy", "unsupported"), ("environment_variables.cloud", "cloud"), ("git.branch_prefix", "app_setting"), ("git.branch_prefix_type", "app_setting"), ("git.worktree_push_auto_setup_remote", "app_setting"),])
    );
    assert!(w.iter().all(|x| x.file == "f.toml"));
    assert_eq!(w.iter().find(|x| x.key == "git.branch_prefix").unwrap().detail.as_deref(), Some("git"));
}

#[test]
fn exemplo_local_da_documentacao() {
    let (s, w) = toml(&fx(include_str!("fixtures/exemplo-local.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(s.scripts.run["dev"].command, fx("pnpm dev --host 127.0.0.1 --port $LEGACY_PORT"));
    assert_eq!(s.env["ANTHROPIC_BASE_URL"], "http://127.0.0.1:4000");
    // Sobre o compartilhado: a ação `dev` local vence, o resto continua.
    let shared = toml(&fx(include_str!("fixtures/exemplo-completo.toml"))).0;
    let m = settings::merge(shared, s);
    assert_eq!(m.scripts.run["dev"].command, fx("pnpm dev --host 127.0.0.1 --port $LEGACY_PORT"));
    assert_eq!(m.env["ANTHROPIC_BASE_URL"], "http://127.0.0.1:4000");
    assert_eq!(m.scripts.setup.as_deref(), Some("pnpm install"));
    assert_eq!(m.scripts.run.len(), 2);
}

#[test]
fn scripts_run_como_texto_vira_uma_acao() {
    let (s, w) = toml(&fx(include_str!("fixtures/scripts-acao-unica.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!((s.scripts.setup.as_deref(), s.scripts.archive.as_deref(), s.scripts.run_mode.as_deref()), (Some("pnpm install"), Some("./script/workspace-archive.sh"), Some("concurrent")));
    assert_eq!(s.scripts.run.len(), 1);
    let r = &s.scripts.run[SINGLE_RUN_ID];
    assert_eq!((r.command.as_str(), r.default, r.icon.as_deref()), (fx("pnpm dev --port $LEGACY_PORT").as_str(), true, Some("play")));
}

#[test]
fn varias_acoes_e_available_in() {
    let (s, w) = toml(&fx(include_str!("fixtures/scripts-varias-acoes.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(s.scripts.run.keys().collect::<Vec<_>>(), vec!["api", "test", "web", "worker"]);
    assert_eq!(s.scripts.run["web"].available_in, Some(vec!["local".to_string(), "cloud".to_string()]));
    assert_eq!(s.scripts.run["api"].available_in, Some(vec!["local".to_string()]));
    assert_eq!(s.scripts.run["api"].command, fx("pnpm api --port $((LEGACY_PORT + 1))"));
    assert!(s.scripts.run["web"].default && !s.scripts.run["worker"].default);
}

#[test]
fn campos_da_acao_args_cwd_hide() {
    let (s, w) = toml(&fx(include_str!("fixtures/scripts-campos-da-acao.toml")));
    assert!(w.is_empty(), "{w:?}");
    let sb = &s.scripts.run["storybook"];
    assert_eq!(sb.args, vec!["--port", "6006", "--no open"]);
    assert_eq!(sb.options.as_ref().and_then(|o| o.cwd.as_deref()), Some("packages/ui"));
    assert_eq!(sb.available_in, Some(vec!["local".to_string()]));
    assert!(!sb.hidden() && s.scripts.run["legacy"].hidden());
    if !cfg!(windows) {
        assert_eq!(sb.command_line(), "pnpm storybook --port 6006 '--no open'");
    }
    let ws = Path::new("/tmp/ws");
    assert_eq!(sb.cwd_in(ws), ws.join("packages/ui"));
    // Fora do workspace não vale: roda na raiz dele.
    for bad in ["../fora", "/etc"] {
        let r = RunScript { options: Some(RunOptions { cwd: Some(bad.into()) }), ..Default::default() };
        assert_eq!(r.cwd_in(ws), ws);
    }
    // `hide` no local esconde a ação compartilhada sem apagar o comando dela.
    let local = toml("[scripts.run.storybook]\nhide = true\n").0;
    let m = settings::merge(s.clone(), local);
    assert_eq!((m.scripts.run["storybook"].command.as_str(), m.scripts.run["storybook"].hidden()), ("pnpm storybook", true));
    assert_eq!(m.scripts.run["storybook"].args.len(), 3);
}

#[test]
fn setup_em_varias_linhas() {
    let (s, w) = toml(&fx(include_str!("fixtures/setup-multilinha.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(s.scripts.setup.as_deref(), Some(fx("pnpm install\ncp \"$LEGACY_ROOT_PATH/.env\" .env\npnpm run build\n").as_str()));
}

#[test]
fn arquivos_a_copiar_em_texto() {
    let (s, w) = toml(&fx(include_str!("fixtures/arquivos-a-copiar.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(s.file_include_globs, vec![".env.local", "config/local.json", "certs/local/**"]);
    // A lista do Kabul continua aceita.
    assert_eq!(toml("file_include_globs = [\"a\", \"b\"]\n").0.file_include_globs, vec!["a", "b"]);
}

#[test]
fn variaveis_de_ambiente() {
    let (s, w) = toml(&fx(include_str!("fixtures/variaveis.toml")));
    assert_eq!(s.env.len(), 2);
    assert_eq!(s.env["API_BASE_URL"], "http://localhost:3000");
    assert_eq!(s.env[&fx("LEGACY_TARGET")], "local");
    assert_eq!(keys(&w), kv(&[("environment_variables.cloud", "cloud")]));
    // `[env]` do Kabul vence a geral; a chave do gerenciado (camelCase) também é lida.
    let (s, w) = toml("[env]\nA = \"kabul\"\n[environment_variables]\nA = \"legado\"\nB = \"b\"\n[environmentVariables.local]\nC = \"c\"\n");
    assert!(w.is_empty(), "{w:?}");
    assert_eq!((s.env["A"].as_str(), s.env["B"].as_str(), s.env["C"].as_str()), ("kabul", "b", "c"));
}

#[test]
fn urls_de_preview() {
    let (s, w) = toml(&fx(include_str!("fixtures/preview-urls.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(s.preview_urls.len(), 2);
    assert_eq!((s.preview_urls[1].name.as_deref(), s.preview_urls[1].url.as_str()), (Some("API"), fx("http://localhost:$((LEGACY_PORT + 1))").as_str()));
    assert_eq!(s.preview_url.as_deref(), Some(fx("http://localhost:$LEGACY_PORT").as_str()));
    assert_eq!(settings::expand_port(s.preview_url.as_deref().unwrap(), 41000), "http://localhost:41000");
    // `preview_url` explícito vence a primeira da lista.
    let (s, _) = toml("preview_url = \"http://x\"\n[[preview_urls]]\nurl = \"http://y\"\n");
    assert_eq!(s.preview_url.as_deref(), Some("http://x"));
}

#[test]
fn migrado_e_json_legado() {
    let (s, w) = toml(&fx(include_str!("fixtures/migrado.toml")));
    assert_eq!(keys(&w), kv(&[("enterprise_data_privacy", "unsupported")]));
    assert_eq!(s.scripts.run["dev"].command, fx("pnpm dev --port $LEGACY_PORT"));
    for (text, setup, run) in [(fx(include_str!("fixtures/legado-simples.json")), "npm install", "npm run dev".to_string()), (fx(include_str!("fixtures/legado-completo.json")), "pnpm install", fx("pnpm dev --port $LEGACY_PORT"))] {
        let (s, w) = read(&text, Format::Json, "x.json");
        let s = s.unwrap();
        assert_eq!(s.scripts.setup.as_deref(), Some(setup));
        assert_eq!(s.scripts.run[SINGLE_RUN_ID].command, run);
        assert_eq!(s.scripts.run_mode.as_deref(), Some("concurrent"));
        assert!(w.iter().all(|x| x.key == "enterpriseDataPrivacy" && x.kind == "unsupported"), "{w:?}");
    }
    // O JSON legado e o TOML migrado dão as mesmas settings (fora a versão).
    let (j, _) = read(&fx(include_str!("fixtures/legado-completo.json")), Format::Json, "x.json");
    assert_eq!(j.unwrap().scripts, toml(&fx(include_str!("fixtures/migrado.toml"))).0.scripts);
}

#[test]
fn campo_invalido_nao_descarta_a_camada() {
    let (s, w) = toml(&fx(include_str!("fixtures/campo-invalido.toml")));
    // O que estava certo continua valendo.
    assert_eq!(s.target_branch.as_deref(), Some("develop"));
    assert_eq!(s.scripts.archive.as_deref(), Some("./sair.sh"));
    assert_eq!(s.scripts.run["web"].command, "pnpm dev");
    assert_eq!(s.env["A"], "1");
    assert_eq!(s.env["PORTA"], "3000");
    assert_eq!(s.prompts.general.as_deref(), Some("seja breve"));
    // E só o inválido ficou de fora.
    assert!(s.file_include_globs.is_empty() && s.archive_on_merge.is_none() && s.scripts.setup.is_none() && s.scripts.run_mode.is_none() && s.prompts.review.is_none());
    assert!(!s.scripts.run["web"].default);
    assert!(!s.scripts.run.contains_key("quebrada"));
    assert_eq!(
        keys(&w),
        kv(&[
            ("archive_on_merge", "type"),
            ("env.B", "type"),
            ("file_include_globs", "type"),
            ("prompts.review", "type"),
            ("scripts.run.quebrada.command", "type"),
            ("scripts.run.web.default", "type"),
            ("scripts.run_mode", "value"),
            ("scripts.setup", "type"),
        ])
    );
    let g = w.iter().find(|x| x.key == "file_include_globs").unwrap();
    assert_eq!((g.expected.as_deref(), g.found.as_deref()), (Some("string|list"), Some("integer")));
    assert_eq!(g.reason(), "tipo errado (esperado string ou list, encontrado integer)");
    // Chave desconhecida também avisa (e não derruba nada).
    let (s, w) = toml("coisa = 1\n[scripts]\nsetup = \"x\"\nauto_run_after_setup = true\n");
    assert_eq!(s.scripts.setup.as_deref(), Some("x"));
    assert_eq!(keys(&w), kv(&[("coisa", "unknown"), ("scripts.auto_run_after_setup", "unsupported")]));
}

#[test]
fn browser_hosts_do_navegador_sem_aviso() {
    // Domínios do projeto do navegador do Kabul: se virassem "unknown", a política os ignoraria.
    let (s, w) = toml("browser_hosts = [\"staging.exemplo.com\", \"*.exemplo.dev\"]\n");
    assert!(w.is_empty(), "{w:?}");
    assert_eq!(s.browser_hosts, vec!["staging.exemplo.com", "*.exemplo.dev"]);
}

#[test]
fn toml_quebrado_e_formato_do_kabul() {
    let (s, w) = read("[scripts\nsetup = 1", Format::Toml, "f.toml");
    assert!(s.is_none());
    assert_eq!((w.len(), w[0].kind.as_str(), w[0].key.as_str()), (1, "syntax", ""));
    let (s, w) = toml(&fx(include_str!("fixtures/kabul.toml")));
    assert!(w.is_empty(), "{w:?}");
    assert_eq!((s.remote.as_deref(), s.base_branch.as_deref(), s.prompts.review.as_deref()), (Some("origin"), Some("develop"), Some("Focus on security.")));
    // Versão futura: chave nova não vira aviso.
    let (_, w) = toml("schema_version = 42\ncoisa_nova = 1\n");
    assert!(w.is_empty(), "{w:?}");
}

/// Repo git de mentira (sem remoto: a camada compartilhada vem do disco).
fn repo(nome: &str) -> PathBuf {
    let tmp = std::env::temp_dir().join(format!("kabul-compat-{nome}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    crate::shell::command("git").arg("-C").arg(&tmp).args(["init", "-q"]).status().unwrap();
    tmp
}
use std::path::PathBuf;

#[test]
fn load_le_a_pasta_legada_com_avisos() {
    let tmp = repo("load");
    let d = tmp.join(crate::compat::legacy_dir());
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("settings.toml"), fx(include_str!("fixtures/exemplo-completo.toml"))).unwrap();
    std::fs::write(d.join("settings.local.toml"), "[scripts]\nsetup = 3\n[environment_variables]\nX = \"local\"\n").unwrap();
    let (s, layers) = settings::load(&tmp, "main");
    assert_eq!(s.scripts.setup.as_deref(), Some("pnpm install"), "setup inválido no local não apaga o do compartilhado");
    assert_eq!(s.env["X"], "local");
    assert_eq!(s.file_include_globs, vec![".env*", "config/*.local.json"]);
    assert!(layers[1].path.ends_with("settings.toml") && layers[1].found);
    assert_eq!(layers[1].warnings.len(), 5);
    assert_eq!(keys(&layers[2].warnings), kv(&[("scripts.setup", "type")]));
    assert!(layers[2].warnings[0].file.ends_with("settings.local.toml"));
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn json_legado_na_raiz_e_na_pasta() {
    let tmp = repo("json");
    let json = crate::compat::legacy_json();
    std::fs::write(tmp.join(&json), fx(include_str!("fixtures/legado-simples.json"))).unwrap();
    let (s, layers) = settings::load(&tmp, "main");
    assert_eq!(s.scripts.run[SINGLE_RUN_ID].command, "npm run dev");
    assert!(layers[1].path.ends_with(&json));
    // Salvar o local cria `.kabul/settings.local.toml` (a pasta do outro app fica intocada) e o JSON continua valendo.
    assert!(settings::save_local(&tmp, &Settings::default()).unwrap().starts_with(tmp.join(".kabul")));
    assert!(!tmp.join(crate::compat::legacy_dir()).exists());
    assert_eq!(settings::load(&tmp, "main").0.scripts.setup.as_deref(), Some("npm install"));
    // Um settings.toml compartilhado marca o repo como migrado: o JSON deixa de ser lido.
    std::fs::write(tmp.join(".kabul/settings.toml"), "[scripts]\nsetup = \"kabul\"\n").unwrap();
    assert_eq!(settings::load(&tmp, "main").0.scripts.setup.as_deref(), Some("kabul"));
    std::fs::remove_dir_all(tmp.join(".kabul")).unwrap();
    // O mesmo com settings.toml na pasta legada.
    let d = tmp.join(crate::compat::legacy_dir());
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("settings.toml"), "[scripts]\nsetup = \"novo\"\n").unwrap();
    assert_eq!(settings::load(&tmp, "main").0.scripts.setup.as_deref(), Some("novo"));
    // JSON dentro da pasta legada.
    std::fs::remove_file(d.join("settings.toml")).unwrap();
    std::fs::rename(tmp.join(&json), d.join(&json)).unwrap();
    assert_eq!(settings::load(&tmp, "main").0.scripts.setup.as_deref(), Some("npm install"));
    // `.kabul/` existe: o settings.toml da pasta legada não é lido.
    std::fs::rename(d.join(&json), tmp.join("x.json")).unwrap();
    std::fs::write(d.join("settings.toml"), "[scripts]\nsetup = \"legado\"\n").unwrap();
    assert_eq!(settings::load(&tmp, "main").0.scripts.setup.as_deref(), Some("legado"));
    std::fs::create_dir_all(tmp.join(".kabul")).unwrap();
    assert_eq!(settings::load(&tmp, "main").0.scripts.setup, None);
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn importar_mostra_previa_e_so_grava_com_confirmacao() {
    let tmp = repo("import");
    assert!(!import_preview(&tmp, false).available);
    let d = tmp.join(crate::compat::legacy_dir());
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("settings.toml"), fx(include_str!("fixtures/exemplo-completo.toml"))).unwrap();
    std::fs::write(d.join("settings.local.toml"), fx(include_str!("fixtures/exemplo-local.toml"))).unwrap();
    let before = settings::load(&tmp, "main").0;
    let p = import_preview(&tmp, false);
    assert!(p.available);
    assert_eq!(p.source, format!("{}/", crate::compat::legacy_dir()));
    assert_eq!(p.files.iter().map(|f| f.target.as_str()).collect::<Vec<_>>(), vec![".kabul/settings.toml", ".kabul/settings.local.toml"]);
    let shared = &p.files[0].content;
    assert!(shared.contains("# Não importado: enterprise_data_privacy (sem equivalente no Kabul)"), "{shared}");
    assert!(shared.contains("[scripts.run.dev]") && shared.contains("review = ") && shared.contains("[env]"), "{shared}");
    assert!(!shared.contains("code_review") && !shared.contains("[environment_variables"), "{shared}");
    // A prévia não grava nada.
    assert!(!tmp.join(".kabul").exists());
    // Digest diferente (a configuração mudou ou a prévia é outra): recusa.
    assert!(import_apply(&tmp, false, "outro").is_err());
    assert!(!tmp.join(".kabul").exists());
    let written = import_apply(&tmp, false, &p.digest).unwrap();
    assert_eq!(written.len(), 2);
    // O Kabul passa a ler o arquivo novo, sem avisos de tipo, com o mesmo resultado.
    let (after, layers) = settings::load(&tmp, "main");
    assert!(layers[1].warnings.is_empty() && layers[2].warnings.is_empty(), "{:?}", layers);
    assert_eq!(after.scripts, before.scripts);
    assert_eq!(after.env, before.env);
    assert_eq!(after.prompts, before.prompts);
    assert_eq!(after.file_include_globs, before.file_include_globs);
    // Os originais ficam onde estavam e nada é sobrescrito.
    assert!(d.join("settings.toml").is_file());
    assert!(!import_preview(&tmp, false).available);
    assert!(import_apply(&tmp, false, &p.digest).is_err());
    // Em inglês, os comentários do arquivo gerado também.
    let tmp2 = repo("import-en");
    std::fs::write(tmp2.join(crate::compat::legacy_json()), fx(include_str!("fixtures/legado-completo.json"))).unwrap();
    let p = import_preview(&tmp2, true);
    assert_eq!(p.source, crate::compat::legacy_json());
    assert!(p.files[0].content.starts_with("# Imported from "), "{}", p.files[0].content);
    assert!(p.files[0].content.contains("# Not imported: enterpriseDataPrivacy (no equivalent in Kabul)"));
    std::fs::remove_dir_all(&tmp).ok();
    std::fs::remove_dir_all(&tmp2).ok();
}

#[test]
fn variaveis_legadas_continuam_exportadas() {
    let tmp = repo("env");
    let d = tmp.join(crate::compat::legacy_dir());
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("settings.toml"), fx(include_str!("fixtures/variaveis.toml"))).unwrap();
    let r = crate::store::Repo { id: "r".into(), name: "r".into(), path: tmp.display().to_string(), default_branch: "main".into(), ..Default::default() };
    let w = crate::store::Workspace { id: "w".into(), name: "lisboa".into(), path: tmp.display().to_string(), port: 41000, ..Default::default() };
    let env = w.full_env(&r);
    let legacy = crate::compat::legacy_env_prefix();
    for k in ["WORKSPACE_NAME", "WORKSPACE_PATH", "ROOT_PATH", "DEFAULT_BRANCH", "PORT", "IS_LOCAL"] {
        let kabul = env.iter().find(|(n, _)| *n == format!("KABUL_{k}")).map(|(_, v)| v);
        let old = env.iter().find(|(n, _)| *n == format!("{legacy}{k}")).map(|(_, v)| v);
        assert!(kabul.is_some() && kabul == old, "{k}");
    }
    assert!(env.contains(&("API_BASE_URL".into(), "http://localhost:3000".into())));
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn negacao_nos_arquivos_a_copiar() {
    let tmp = repo("copia");
    let dest = repo("copia-destino");
    for f in [".env.local", ".env.production", "config.local.json"] {
        std::fs::write(tmp.join(f), "x").unwrap();
    }
    std::fs::write(tmp.join(".worktreeinclude"), "config.local.json\n").unwrap();
    let n = crate::store::copy_ignored(&tmp, &dest, &["!.env.production".into()]).unwrap();
    assert_eq!(n, 2);
    assert!(dest.join(".env.local").is_file() && dest.join("config.local.json").is_file() && !dest.join(".env.production").exists());
    std::fs::remove_dir_all(&tmp).ok();
    std::fs::remove_dir_all(&dest).ok();
}
