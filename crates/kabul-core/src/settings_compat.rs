//! Leitura tolerante dos arquivos de settings e importação da configuração legada.
//!
//! Cada campo é lido sozinho: um campo com tipo errado vira um aviso ([`SettingsWarning`]) e o resto da
//! camada continua valendo. Além do formato do Kabul, aceita o dialeto da pasta legada de
//! `crate::compat` (`.<nome>/settings.toml` e o JSON legado `<nome>.json`):
//!
//! | legado | Kabul |
//! |---|---|
//! | `file_include_globs = "a\nb"` (texto, uma linha por padrão) | lista |
//! | `scripts.run = "cmd"` (ação única) | `scripts.run.dev` padrão |
//! | `scripts.run.<id>.available_in = "local"` | lista |
//! | `[environment_variables]` e `.local` (`environmentVariables` no gerenciado) | `[env]` |
//! | `[[preview_urls]]` | `preview_urls` (a primeira vira `preview_url`) |
//! | `[git] archive_on_merge`, `delete_branch_on_archive` | no topo |
//! | `prompts.code_review`, `resolve_merge_conflicts`, `rename_branch` | `review`, `resolve_conflicts`, `branch_rename` |
//! | JSON: `scripts.{setup,run,archive}`, `runScriptMode` | `scripts.*`, `scripts.run_mode` |
//!
//! O que não tem equivalente (ou mora nas Configurações do app) também vira aviso, nunca erro.
use crate::settings::{PreviewUrl, Prompts, RunOptions, RunScript, Scripts, Settings, SettingsWarning};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Toml,
    /// JSON legado (`scripts.setup/run/archive` e `runScriptMode`).
    Json,
}

/// Id da ação criada a partir de `scripts.run = "..."` (o mesmo que a migração do formato legado usa).
pub const SINGLE_RUN_ID: &str = "dev";

/// Chaves do formato legado sem equivalente no Kabul.
const UNSUPPORTED: &[&str] = &["enterprise_data_privacy", "enterpriseDataPrivacy", "spotlight_testing", "claude_provider", "codex_provider", "bedrock_region", "vertex_project_id", "ssh_key_path"];
/// Chaves que no Kabul ficam nas Configurações do app (por usuário), com a página.
const APP_LEVEL: &[(&str, &str)] = &[("claude_code_executable_path", "advanced"), ("codex_executable_path", "advanced"), ("models", "models"), ("tool_approvals_enabled", "models")];

struct Ctx<'a> {
    file: &'a str,
    warnings: Vec<SettingsWarning>,
}

impl Ctx<'_> {
    fn warn(&mut self, key: &str, kind: &str, expected: Option<&str>, found: Option<&str>, detail: Option<&str>) {
        self.warnings.push(SettingsWarning { file: self.file.to_string(), key: key.to_string(), kind: kind.into(), expected: expected.map(Into::into), found: found.map(Into::into), detail: detail.map(Into::into) });
    }
    fn wrong_type(&mut self, key: &str, expected: &str, v: &Value) {
        self.warn(key, "type", Some(expected), Some(type_name(v)), None);
    }
    fn string(&mut self, key: &str, v: Value) -> Option<String> {
        match v {
            Value::String(s) => Some(s),
            v => {
                self.wrong_type(key, "string", &v);
                None
            }
        }
    }
    fn boolean(&mut self, key: &str, v: Value) -> Option<bool> {
        match v {
            Value::Bool(b) => Some(b),
            Value::String(s) if s.trim().eq_ignore_ascii_case("true") => Some(true),
            Value::String(s) if s.trim().eq_ignore_ascii_case("false") => Some(false),
            v => {
                self.wrong_type(key, "bool", &v);
                None
            }
        }
    }
    /// Lista de textos; aceita também um texto só (uma entrada por linha, se `lines`).
    fn string_list(&mut self, key: &str, v: Value, lines: bool) -> Option<Vec<String>> {
        match v {
            Value::String(s) if lines => Some(s.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(String::from).collect()),
            Value::String(s) => Some(vec![s]),
            Value::Array(items) => Some(
                items
                    .into_iter()
                    .enumerate()
                    .filter_map(|(i, x)| match x {
                        Value::String(s) => Some(s),
                        x => {
                            self.wrong_type(&format!("{key}[{i}]"), "string", &x);
                            None
                        }
                    })
                    .collect(),
            ),
            v => {
                self.wrong_type(key, "string|list", &v);
                None
            }
        }
    }
    fn table(&mut self, key: &str, v: Value) -> Option<Map<String, Value>> {
        match v {
            Value::Object(m) => Some(m),
            v => {
                self.wrong_type(key, "table", &v);
                None
            }
        }
    }
    /// Variáveis `NOME = "valor"` (número e booleano viram texto).
    fn env(&mut self, key: &str, m: Map<String, Value>, out: &mut BTreeMap<String, String>) {
        for (k, v) in m {
            match v {
                Value::String(s) => {
                    out.insert(k, s);
                }
                Value::Number(n) => {
                    out.insert(k, n.to_string());
                }
                Value::Bool(b) => {
                    out.insert(k, b.to_string());
                }
                v => self.wrong_type(&format!("{key}.{k}"), "string", &v),
            }
        }
    }
}

fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_f64() => "float",
        Value::Number(_) => "integer",
        Value::String(_) => "string",
        Value::Array(_) => "list",
        Value::Object(_) => "table",
    }
}

/// Lê um arquivo de settings (TOML do Kabul ou do formato legado, ou o JSON legado). `None` só quando o
/// arquivo nem abre; campo inválido é ignorado sozinho, com aviso.
pub fn read(text: &str, format: Format, file: &str) -> (Option<Settings>, Vec<SettingsWarning>) {
    let mut cx = Ctx { file, warnings: vec![] };
    let doc = match format {
        Format::Toml => toml::from_str::<toml::Value>(text).map_err(|e| e.message().to_string()).and_then(|t| serde_json::to_value(t).map_err(|e| e.to_string())),
        Format::Json => serde_json::from_str::<Value>(text).map_err(|e| e.to_string()).map(legacy_json),
    };
    let mut doc = match doc {
        Ok(d @ Value::Object(_)) => d,
        Ok(d) => {
            cx.wrong_type("", "table", &d);
            return (None, cx.warnings);
        }
        Err(e) => {
            cx.warn("", "syntax", None, None, Some(e.lines().next().unwrap_or("").trim()));
            return (None, cx.warnings);
        }
    };
    if let Some(v) = doc.get("schema_version").filter(|v| !v.as_u64().is_some_and(|n| n <= u32::MAX as u64)).cloned() {
        cx.wrong_type("schema_version", "integer", &v);
        doc.as_object_mut().unwrap().remove("schema_version");
    }
    let newer = match crate::schema::migrate(&mut doc, crate::schema::REPO_SETTINGS, crate::schema::REPO_SETTINGS_MIGRATIONS) {
        Ok(crate::schema::Outcome::Newer { .. }) => true,
        Ok(_) => false,
        Err(e) => {
            cx.warn("schema_version", "value", None, None, Some(&e.to_string()));
            false
        }
    };
    let Value::Object(map) = doc else { unreachable!() };
    let s = extract(map, newer, &mut cx);
    (Some(s), cx.warnings)
}

/// JSON legado → o mesmo documento do TOML (`runScriptMode` vira `scripts.run_mode`).
fn legacy_json(doc: Value) -> Value {
    let Value::Object(mut m) = doc else { return doc };
    if let Some(mode) = m.remove("runScriptMode") {
        match m.entry("scripts").or_insert_with(|| Value::Object(Map::new())) {
            Value::Object(sc) => {
                sc.entry("run_mode").or_insert(mode);
            }
            _ => {
                m.insert("runScriptMode".into(), mode);
            }
        }
    }
    Value::Object(m)
}

fn extract(map: Map<String, Value>, newer: bool, cx: &mut Ctx) -> Settings {
    let mut s = Settings::default();
    let (mut env_kabul, mut env_shared, mut env_local) = (BTreeMap::new(), BTreeMap::new(), BTreeMap::new());
    let (mut git_archive, mut git_delete) = (None, None);
    for (k, v) in map {
        match k.as_str() {
            "$schema" => {}
            "schema_version" => s.schema_version = v.as_u64().map(|n| n as u32),
            "scripts" => {
                if let Some(m) = cx.table("scripts", v) {
                    s.scripts = scripts(m, newer, cx);
                }
            }
            "file_include_globs" => s.file_include_globs = cx.string_list(&k, v, true).unwrap_or_default(),
            "target_branch" => s.target_branch = cx.string(&k, v),
            "base_branch" => s.base_branch = cx.string(&k, v),
            "remote" => s.remote = cx.string(&k, v),
            "preview_url" => s.preview_url = cx.string(&k, v),
            "delete_branch_on_archive" => s.delete_branch_on_archive = cx.boolean(&k, v),
            "archive_on_merge" => s.archive_on_merge = cx.boolean(&k, v),
            "env" => {
                if let Some(m) = cx.table(&k, v) {
                    cx.env(&k, m, &mut env_kabul);
                }
            }
            "environment_variables" | "environmentVariables" => {
                if let Some(m) = cx.table(&k, v) {
                    for (name, val) in m {
                        let key = format!("{k}.{name}");
                        match (name.as_str(), val) {
                            ("local", Value::Object(t)) => cx.env(&key, t, &mut env_local),
                            ("cloud", Value::Object(_)) => cx.warn(&key, "cloud", None, None, None),
                            (_, val) => {
                                let mut one = Map::new();
                                one.insert(name, val);
                                cx.env(&k, one, &mut env_shared);
                            }
                        }
                    }
                }
            }
            "prompts" => {
                if let Some(m) = cx.table(&k, v) {
                    s.prompts = prompts(m, newer, cx);
                }
            }
            "preview_urls" => s.preview_urls = preview_urls(v, cx),
            "browser_hosts" => s.browser_hosts = cx.string_list(&k, v, false).unwrap_or_default(),
            "git" => {
                if let Some(m) = cx.table(&k, v) {
                    for (gk, gv) in m {
                        let key = format!("git.{gk}");
                        match gk.as_str() {
                            "archive_on_merge" => git_archive = cx.boolean(&key, gv),
                            "delete_branch_on_archive" => git_delete = cx.boolean(&key, gv),
                            "worktree_push_auto_setup_remote" | "branch_prefix_type" | "branch_prefix" => cx.warn(&key, "app_setting", None, None, Some("git")),
                            _ if !newer => cx.warn(&key, "unknown", None, None, None),
                            _ => {}
                        }
                    }
                }
            }
            k if UNSUPPORTED.contains(&k) => cx.warn(k, "unsupported", None, None, None),
            k if APP_LEVEL.iter().any(|(n, _)| *n == k) => {
                let page = APP_LEVEL.iter().find(|(n, _)| *n == k).map(|(_, p)| *p);
                cx.warn(k, "app_setting", None, None, page);
            }
            k if !newer => cx.warn(k, "unknown", None, None, None),
            _ => {}
        }
    }
    // A chave no topo vence a da tabela `[git]`; `[env]` vence `environment_variables` (e `.local` a geral).
    s.archive_on_merge = s.archive_on_merge.or(git_archive);
    s.delete_branch_on_archive = s.delete_branch_on_archive.or(git_delete);
    env_shared.extend(env_local);
    env_shared.extend(env_kabul);
    s.env = env_shared;
    if s.preview_url.is_none() {
        s.preview_url = s.preview_urls.first().map(|p| p.url.clone());
    }
    s
}

fn scripts(m: Map<String, Value>, newer: bool, cx: &mut Ctx) -> Scripts {
    let mut sc = Scripts::default();
    for (k, v) in m {
        let key = format!("scripts.{k}");
        match k.as_str() {
            "setup" => sc.setup = cx.string(&key, v),
            "archive" => sc.archive = cx.string(&key, v),
            "run_mode" => match cx.string(&key, v) {
                Some(m) if m == "concurrent" || m == "nonconcurrent" => sc.run_mode = Some(m),
                Some(m) => cx.warn(&key, "value", Some("concurrent|nonconcurrent"), Some(&m), None),
                None => {}
            },
            "run" => match v {
                Value::String(cmd) => {
                    sc.run.insert(SINGLE_RUN_ID.into(), RunScript { command: cmd, default: true, icon: Some("play".into()), ..Default::default() });
                }
                Value::Object(actions) => {
                    for (id, a) in actions {
                        let akey = format!("scripts.run.{id}");
                        match a {
                            Value::String(cmd) => {
                                sc.run.insert(id, RunScript { command: cmd, ..Default::default() });
                            }
                            Value::Object(f) => {
                                if let Some(r) = action(&akey, f, newer, cx) {
                                    sc.run.insert(id, r);
                                }
                            }
                            a => cx.wrong_type(&akey, "table", &a),
                        }
                    }
                }
                v => cx.wrong_type(&key, "string|table", &v),
            },
            "auto_run_after_setup" => cx.warn(&key, "unsupported", None, None, None),
            _ if !newer => cx.warn(&key, "unknown", None, None, None),
            _ => {}
        }
    }
    sc
}

fn action(key: &str, f: Map<String, Value>, newer: bool, cx: &mut Ctx) -> Option<RunScript> {
    let mut r = RunScript::default();
    let mut command_ok = true;
    for (k, v) in f {
        let fk = format!("{key}.{k}");
        match k.as_str() {
            "command" => match cx.string(&fk, v) {
                Some(c) => r.command = c,
                None => command_ok = false,
            },
            "default" => r.default = cx.boolean(&fk, v).unwrap_or(false),
            "icon" => r.icon = cx.string(&fk, v),
            "hide" => r.hide = cx.boolean(&fk, v),
            "available_in" => r.available_in = cx.string_list(&fk, v, false),
            "args" => r.args = cx.string_list(&fk, v, false).unwrap_or_default(),
            "options" => {
                if let Some(o) = cx.table(&fk, v) {
                    let mut opts = RunOptions::default();
                    for (ok, ov) in o {
                        match ok.as_str() {
                            "cwd" => opts.cwd = cx.string(&format!("{fk}.cwd"), ov),
                            _ if !newer => cx.warn(&format!("{fk}.{ok}"), "unknown", None, None, None),
                            _ => {}
                        }
                    }
                    r.options = Some(opts);
                }
            }
            _ if !newer => cx.warn(&fk, "unknown", None, None, None),
            _ => {}
        }
    }
    // Sem o comando (tipo errado), a ação não roda: fica de fora em vez de virar um ajuste vazio.
    command_ok.then_some(r)
}

fn prompts(mut m: Map<String, Value>, newer: bool, cx: &mut Ctx) -> Prompts {
    let mut p = Prompts::default();
    // (nome no Kabul, nome no formato legado): o do Kabul vence quando os dois existem.
    let fields: [(&str, Option<&str>, &mut Option<String>); 6] = [
        ("general", None, &mut p.general),
        ("review", Some("code_review"), &mut p.review),
        ("create_pr", None, &mut p.create_pr),
        ("fix_errors", None, &mut p.fix_errors),
        ("resolve_conflicts", Some("resolve_merge_conflicts"), &mut p.resolve_conflicts),
        ("branch_rename", Some("rename_branch"), &mut p.branch_rename),
    ];
    for (name, alias, slot) in fields {
        let alias_v = alias.and_then(|a| m.remove(a).map(|v| (a, v)));
        let own = m.remove(name).and_then(|v| cx.string(&format!("prompts.{name}"), v));
        let other = alias_v.and_then(|(a, v)| cx.string(&format!("prompts.{a}"), v));
        *slot = own.or(other);
    }
    if !newer {
        for k in m.keys() {
            cx.warn(&format!("prompts.{k}"), "unknown", None, None, None);
        }
    }
    p
}

fn preview_urls(v: Value, cx: &mut Ctx) -> Vec<PreviewUrl> {
    let items = match v {
        Value::Array(a) => a,
        v @ (Value::String(_) | Value::Object(_)) => vec![v],
        v => {
            cx.wrong_type("preview_urls", "list", &v);
            return vec![];
        }
    };
    let mut out = vec![];
    for (i, it) in items.into_iter().enumerate() {
        let key = format!("preview_urls[{i}]");
        match it {
            Value::String(url) => out.push(PreviewUrl { name: None, url }),
            Value::Object(mut o) => {
                let name = o.remove("name").and_then(|n| cx.string(&format!("{key}.name"), n));
                match o.remove("url") {
                    Some(u) => {
                        if let Some(url) = cx.string(&format!("{key}.url"), u) {
                            out.push(PreviewUrl { name, url });
                        }
                    }
                    None => cx.warn(&format!("{key}.url"), "type", Some("string"), Some("null"), None),
                }
                for k in o.keys() {
                    cx.warn(&format!("{key}.{k}"), "unknown", None, None, None);
                }
            }
            it => cx.wrong_type(&key, "table", &it),
        }
    }
    out
}

// ---------------------------------------------------------------- importação

/// Um arquivo que a importação vai criar.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImportFile {
    /// De onde veio (relativo ao repo).
    pub source: String,
    /// Onde será gravado (relativo ao repo).
    pub target: String,
    pub content: String,
}

/// Prévia da importação: nada é gravado até `import_apply` receber o mesmo `digest`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImportPreview {
    /// Há configuração legada e `.kabul/settings.toml` ainda não existe.
    pub available: bool,
    /// Origem para o botão (`.<nome>/` ou `<nome>.json`).
    pub source: String,
    pub files: Vec<ImportFile>,
    pub warnings: Vec<SettingsWarning>,
    /// Identifica o conteúdo mostrado (a gravação recusa se ele mudou).
    pub digest: String,
}

/// O que importar: (origem relativa, formato, destino relativo). Lê só do disco (a cópia de trabalho).
fn import_sources(repo: &Path) -> Vec<(String, Format, String)> {
    let d = crate::compat::legacy_dir();
    let mut v = vec![];
    if repo.join(".kabul/settings.toml").exists() {
        return v;
    }
    let shared = std::iter::once(format!("{d}/settings.toml")).chain(crate::settings::legacy_json_paths()).find(|rel| repo.join(rel).is_file());
    if let Some(rel) = shared {
        let f = if rel.ends_with(".json") { Format::Json } else { Format::Toml };
        v.push((rel, f, ".kabul/settings.toml".into()));
    }
    let local = format!("{d}/settings.local.toml");
    if repo.join(&local).is_file() && !repo.join(".kabul/settings.local.toml").exists() {
        v.push((local, Format::Toml, ".kabul/settings.local.toml".into()));
    }
    v
}

/// Tira o que está vazio (listas, tabelas, nulos, `default = false`) para o TOML gerado ficar limpo.
fn prune(v: &mut Value) -> bool {
    match v {
        Value::Null => false,
        Value::Array(a) => !a.is_empty(),
        Value::Object(m) => {
            m.retain(|k, x| prune(x) && !(k == "default" && *x == Value::Bool(false)));
            !m.is_empty()
        }
        _ => true,
    }
}

/// Settings → TOML do Kabul (só o que está preenchido, versão do formato no topo).
pub fn to_kabul_toml(s: &Settings) -> anyhow::Result<String> {
    let mut v = serde_json::to_value(Settings { schema_version: Some(crate::schema::REPO_SETTINGS), ..s.clone() })?;
    prune(&mut v);
    Ok(toml::to_string_pretty(&v)?)
}

fn digest(files: &[ImportFile]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    files.hash(&mut h);
    format!("{:016x}", h.finish())
}

impl std::hash::Hash for ImportFile {
    fn hash<H: std::hash::Hasher>(&self, h: &mut H) {
        (&self.source, &self.target, &self.content).hash(h);
    }
}

/// Monta a prévia (`en`: comentários do arquivo gerado em inglês).
pub fn import_preview(repo: &Path, en: bool) -> ImportPreview {
    let sources = import_sources(repo);
    let mut files = vec![];
    let mut warnings = vec![];
    for (rel, format, target) in &sources {
        let Ok(text) = std::fs::read_to_string(repo.join(rel)) else { continue };
        let (s, w) = read(&text, *format, rel);
        let Some(s) = s else {
            warnings.extend(w);
            continue;
        };
        let mut head = vec![if en { format!("# Imported from {rel}. The original file was not changed.") } else { format!("# Importado de {rel}. O arquivo de origem não foi alterado.") }];
        if target.ends_with(".local.toml") {
            head.push(if en { "# Personal overrides: keep this file out of git.".into() } else { "# Ajustes pessoais: não versione este arquivo.".into() });
        }
        for x in &w {
            let key = match (x.key.is_empty(), en) {
                (false, _) => x.key.as_str(),
                (true, true) => "(file)",
                (true, false) => "(arquivo)",
            };
            head.push(if en { format!("# Not imported: {key} ({})", reason_en(x)) } else { format!("# Não importado: {key} ({})", x.reason()) });
        }
        warnings.extend(w);
        let Ok(body) = to_kabul_toml(&s) else { continue };
        files.push(ImportFile { source: rel.clone(), target: target.clone(), content: format!("{}\n\n{body}", head.join("\n")) });
    }
    let source = match sources.first() {
        Some((rel, Format::Json, _)) => rel.clone(),
        Some(_) => format!("{}/", crate::compat::legacy_dir()),
        None => String::new(),
    };
    ImportPreview { available: !files.is_empty(), source, digest: digest(&files), files, warnings }
}

fn reason_en(w: &SettingsWarning) -> String {
    let ty = |t: &Option<String>| t.as_deref().unwrap_or("?").replace('|', " or ");
    match w.kind.as_str() {
        "syntax" => format!("file could not be read: {}", w.detail.as_deref().unwrap_or("")),
        "type" => format!("wrong type: expected {}, found {}", ty(&w.expected), ty(&w.found)),
        "value" => format!("value not accepted; accepted: {}", ty(&w.expected)),
        "unsupported" => "no equivalent in Kabul".into(),
        "app_setting" => format!("in Kabul this lives in Settings › {}", page_name(w.detail.as_deref(), true)),
        "cloud" => "only applies to cloud execution".into(),
        _ => "unknown key".into(),
    }
}

/// Nome da página das Configurações do app para o código usado em `detail` de `app_setting`.
pub fn page_name(code: Option<&str>, en: bool) -> &'static str {
    match (code.unwrap_or(""), en) {
        ("git", _) => "Git",
        ("advanced", true) => "Advanced",
        ("advanced", false) => "Avançado",
        ("models", true) => "Models",
        ("models", false) => "Modelos",
        (_, true) => "General",
        (_, false) => "Geral",
    }
}

/// Grava os arquivos da prévia, se ela ainda é a mesma (`digest`). Nunca sobrescreve um arquivo existente.
pub fn import_apply(repo: &Path, en: bool, expected_digest: &str) -> anyhow::Result<Vec<String>> {
    let p = import_preview(repo, en);
    anyhow::ensure!(p.available, "nada para importar");
    anyhow::ensure!(p.digest == expected_digest, "a configuração mudou desde a prévia; abra a prévia de novo");
    let mut written = vec![];
    for f in &p.files {
        let dest = repo.join(&f.target);
        std::fs::create_dir_all(dest.parent().unwrap())?;
        use std::io::Write;
        let mut out = std::fs::OpenOptions::new().write(true).create_new(true).open(&dest)?;
        out.write_all(f.content.as_bytes())?;
        written.push(f.target.clone());
    }
    Ok(written)
}

#[cfg(test)]
mod tests;
