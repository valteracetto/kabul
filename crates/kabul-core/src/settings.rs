//! Settings em camadas (da maior para a menor precedência):
//! `~/.kabul/settings.managed.toml` > `<repo>/.kabul/settings.local.toml` >
//! `<repo>/.kabul/settings.toml` (lido da branch padrão no remoto, com fallback no disco) >
//! `~/.kabul/settings.toml` > padrões. A pasta legada de `crate::compat` só é lida quando `.kabul/` não existe;
//! o JSON legado, enquanto não há `settings.toml` compartilhado. A leitura é tolerante (`crate::settings_compat`):
//! campo inválido vira aviso em `Layer::warnings` e o resto da camada vale.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RunScript {
    /// Vazio numa camada de cima = só ajusta os outros campos da ação de baixo (ex.: `hide = true` no local).
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub available_in: Option<Vec<String>>,
    /// Argumentos acrescentados ao comando (com as aspas do shell).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<RunOptions>,
    /// Esconde a ação do botão Run (no `settings.local.toml`, só nesta máquina).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hide: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RunOptions {
    /// Pasta de trabalho relativa ao workspace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

impl RunScript {
    /// Campos de `hi` sobre `lo` (mesma ação em camadas diferentes). Com comando, `hi` redefine a ação
    /// (herdando só `hide`); sem comando, só os campos que ela traz valem.
    fn merge(lo: RunScript, hi: RunScript) -> RunScript {
        if !hi.command.trim().is_empty() {
            return RunScript { hide: hi.hide.or(lo.hide), ..hi };
        }
        RunScript {
            command: lo.command,
            default: hi.default || lo.default,
            icon: hi.icon.or(lo.icon),
            available_in: hi.available_in.or(lo.available_in),
            args: if hi.args.is_empty() { lo.args } else { hi.args },
            options: hi.options.or(lo.options),
            hide: hi.hide.or(lo.hide),
        }
    }

    pub fn hidden(&self) -> bool {
        self.hide == Some(true)
    }

    /// Comando com os `args` (cada um com as aspas do shell dos scripts).
    pub fn command_line(&self) -> String {
        let sh = crate::shell::Shell::for_scripts();
        std::iter::once(self.command.clone()).chain(self.args.iter().map(|a| sh.quote(a))).collect::<Vec<_>>().join(" ")
    }

    /// Pasta onde a ação roda: `options.cwd` dentro do workspace (caminho absoluto ou com `..` é ignorado).
    pub fn cwd_in(&self, workspace: &Path) -> PathBuf {
        let rel = self.options.as_ref().and_then(|o| o.cwd.as_deref()).map(str::trim).filter(|c| !c.is_empty());
        match rel {
            Some(c) if Path::new(c).components().all(|p| matches!(p, std::path::Component::Normal(_) | std::path::Component::CurDir)) => workspace.join(c),
            _ => workspace.to_path_buf(),
        }
    }
}

/// Uma URL de preview com nome (a primeira é a padrão).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PreviewUrl {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Scripts {
    pub setup: Option<String>,
    pub archive: Option<String>,
    /// `concurrent` (padrão) ou `nonconcurrent`.
    pub run_mode: Option<String>,
    #[serde(default)]
    pub run: BTreeMap<String, RunScript>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    /// Versão do formato (ver `crate::schema`); ausente = 0. Arquivos compartilhados no repo não
    /// são regravados: a migração acontece na leitura.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    #[serde(default)]
    pub scripts: Scripts,
    /// Arquivos ignorados pelo git a copiar para o worktree novo (além de `.worktreeinclude` e `.env*`).
    #[serde(default)]
    pub file_include_globs: Vec<String>,
    /// Branch alvo dos PRs/diff (padrão: branch padrão do repo).
    pub target_branch: Option<String>,
    /// Branch de onde nascem os workspaces novos (padrão: a padrão do repo).
    #[serde(default)]
    pub base_branch: Option<String>,
    /// Remote usado para base, alvo, push e PR (padrão `origin`).
    #[serde(default)]
    pub remote: Option<String>,
    /// Sobrescrevem, neste repo, as opções do usuário.
    #[serde(default)]
    pub delete_branch_on_archive: Option<bool>,
    #[serde(default)]
    pub archive_on_merge: Option<bool>,
    /// Variáveis de ambiente do repo (scripts e agentes); a camada local sobrescreve a compartilhada.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Instruções extras por ação (Configurações › Actions).
    #[serde(default)]
    pub prompts: Prompts,
    /// URL de preview; aceita `$KABUL_PORT` e `$((KABUL_PORT+N))` (e o prefixo legado).
    #[serde(default)]
    pub preview_url: Option<String>,
    /// Domínios do projeto que o navegador do Kabul abre sem pedir aprovação (além de localhost).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub browser_hosts: Vec<String>,
    /// Várias URLs de preview com nome; sem `preview_url`, a primeira faz o papel dela.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preview_urls: Vec<PreviewUrl>,
}

/// Prompts personalizáveis por ação (vazio = o padrão do Kabul).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Prompts {
    pub general: Option<String>,
    pub review: Option<String>,
    pub create_pr: Option<String>,
    pub fix_errors: Option<String>,
    pub resolve_conflicts: Option<String>,
    pub branch_rename: Option<String>,
}

impl Prompts {
    fn merge(lo: Prompts, hi: Prompts) -> Prompts {
        Prompts {
            general: hi.general.or(lo.general),
            review: hi.review.or(lo.review),
            create_pr: hi.create_pr.or(lo.create_pr),
            fix_errors: hi.fix_errors.or(lo.fix_errors),
            resolve_conflicts: hi.resolve_conflicts.or(lo.resolve_conflicts),
            branch_rename: hi.branch_rename.or(lo.branch_rename),
        }
    }
}

/// Troca `$KABUL_PORT`, `${KABUL_PORT}` e `$((KABUL_PORT+N))` (e o prefixo legado) pela porta do workspace.
pub fn expand_port(url: &str, port: u16) -> String {
    let mut out = url.to_string();
    for var in [format!("{}PORT", crate::compat::legacy_env_prefix()), "KABUL_PORT".to_string()] {
        let var = var.as_str();
        while let Some(i) = out.find(&format!("$(({var}+")) {
            let rest = &out[i + var.len() + 4..];
            let Some(end) = rest.find("))") else { break };
            let n: u16 = rest[..end].trim().parse().unwrap_or(0);
            out = format!("{}{}{}", &out[..i], port + n, &rest[end + 2..]);
        }
        out = out.replace(&format!("${{{var}}}"), &port.to_string()).replace(&format!("${var}"), &port.to_string());
    }
    out
}

/// `KEY=VALUE` por linha (aceita `export`, aspas e comentários), como num .env.
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('#') {
                return None;
            }
            let (k, v) = l.trim_start_matches("export ").split_once('=')?;
            let k = k.trim();
            let ok = !k.is_empty() && !k.starts_with(|c: char| c.is_ascii_digit()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            let v = v.trim();
            let v = v.strip_prefix('"').and_then(|x| x.strip_suffix('"')).or_else(|| v.strip_prefix('\'').and_then(|x| x.strip_suffix('\''))).unwrap_or(v);
            ok.then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

/// Lê um `settings.toml` aplicando as migrações do formato (ver `crate::schema`). Campo inválido é
/// ignorado sozinho (os avisos saem em `settings_compat::read`); `None` só quando o TOML nem abre.
pub fn parse_toml(text: &str) -> Option<Settings> {
    crate::settings_compat::read(text, crate::settings_compat::Format::Toml, "settings.toml").0
}

/// Uma configuração que não foi lida: arquivo, chave (com pontos) e o motivo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SettingsWarning {
    pub file: String,
    /// Caminho da chave (`scripts.run.web.command`); vazio quando o arquivo inteiro não abriu.
    pub key: String,
    /// `syntax` (o arquivo não abre), `type` (tipo errado), `value` (valor fora dos aceitos), `unknown`
    /// (chave desconhecida), `unsupported` (sem equivalente no Kabul), `app_setting` (no Kabul fica nas
    /// Configurações do app; `detail` diz a página) ou `cloud` (só vale em execução na nuvem).
    pub kind: String,
    /// Tipos ou valores aceitos, separados por `|` (`string|list`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub found: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl SettingsWarning {
    /// Motivo em texto (relatório do diagnóstico).
    pub fn reason(&self) -> String {
        let ty = |t: &Option<String>| t.as_deref().unwrap_or("?").replace('|', " ou ");
        match self.kind.as_str() {
            "syntax" => format!("o arquivo não pôde ser lido: {}", self.detail.as_deref().unwrap_or("")),
            "type" => format!("tipo errado (esperado {}, encontrado {})", ty(&self.expected), ty(&self.found)),
            "value" => format!("valor não aceito (aceitos: {})", ty(&self.expected)),
            "unsupported" => "sem equivalente no Kabul".into(),
            "app_setting" => format!("no Kabul fica em Configurações › {}", crate::settings_compat::page_name(self.detail.as_deref(), false)),
            "cloud" => "só vale para execução na nuvem".into(),
            _ => "chave desconhecida".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Layer {
    pub name: String,
    pub path: String,
    pub found: bool,
    /// O que não foi lido deste arquivo (o resto da camada vale).
    pub warnings: Vec<SettingsWarning>,
}

/// Junta `hi` sobre `lo` (campos de `hi` vencem; scripts run por id).
pub fn merge(lo: Settings, hi: Settings) -> Settings {
    let mut run = lo.scripts.run;
    for (id, h) in hi.scripts.run {
        let m = match run.remove(&id) {
            Some(l) => RunScript::merge(l, h),
            None => h,
        };
        run.insert(id, m);
    }
    Settings {
        schema_version: hi.schema_version.max(lo.schema_version),
        scripts: Scripts { setup: hi.scripts.setup.or(lo.scripts.setup), archive: hi.scripts.archive.or(lo.scripts.archive), run_mode: hi.scripts.run_mode.or(lo.scripts.run_mode), run },
        file_include_globs: if hi.file_include_globs.is_empty() { lo.file_include_globs } else { hi.file_include_globs },
        target_branch: hi.target_branch.or(lo.target_branch),
        base_branch: hi.base_branch.or(lo.base_branch),
        remote: hi.remote.or(lo.remote),
        delete_branch_on_archive: hi.delete_branch_on_archive.or(lo.delete_branch_on_archive),
        archive_on_merge: hi.archive_on_merge.or(lo.archive_on_merge),
        env: {
            let mut e = lo.env;
            e.extend(hi.env);
            e
        },
        prompts: Prompts::merge(lo.prompts, hi.prompts),
        preview_url: hi.preview_url.or(lo.preview_url),
        browser_hosts: {
            let mut h = lo.browser_hosts;
            h.extend(hi.browser_hosts.into_iter().filter(|x| !h.contains(x)).collect::<Vec<_>>());
            h
        },
        preview_urls: if hi.preview_urls.is_empty() { lo.preview_urls } else { hi.preview_urls },
    }
}

/// Cada camada lida (nome, settings) — para mostrar herança no ambiente por escopo.
pub fn load_layers(repo: &Path, default_branch: &str) -> Vec<(String, Settings)> {
    let [shared, local] = repo_sources(repo, default_branch);
    [("repo", shared), ("repo local", local)].into_iter().map(|(n, src)| (n.to_string(), src.read().0.unwrap_or_default())).collect()
}

fn home() -> PathBuf {
    crate::paths::home()
}

/// Pasta das settings do repo: `.kabul/` se existir; senão a legada, se existir.
pub(crate) fn dir_for(repo: &Path) -> String {
    let legacy = crate::compat::legacy_dir();
    if repo.join(".kabul").is_dir() || !repo.join(&legacy).is_dir() {
        ".kabul".into()
    } else {
        legacy
    }
}

/// Um arquivo de settings: onde fica, o texto (se existe) e o formato.
pub(crate) struct Source {
    pub path: PathBuf,
    pub text: Option<String>,
    pub format: crate::settings_compat::Format,
    /// Lido de `origin/<padrão>` (não do disco).
    pub remote: bool,
}

impl Source {
    pub fn file(path: PathBuf) -> Source {
        let text = std::fs::read_to_string(&path).ok();
        let format = if path.extension().is_some_and(|e| e == "json") { crate::settings_compat::Format::Json } else { crate::settings_compat::Format::Toml };
        Source { path, text, format, remote: false }
    }
    pub fn read(&self) -> (Option<Settings>, Vec<SettingsWarning>) {
        match &self.text {
            Some(t) => crate::settings_compat::read(t, self.format, &self.path.display().to_string()),
            None => (None, vec![]),
        }
    }
}

fn git_show(repo: &Path, spec: &str) -> Option<String> {
    crate::shell::command("git").arg("-C").arg(repo).args(["show", spec]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// Caminhos (relativos ao repo) do JSON legado, na ordem em que são procurados.
pub(crate) fn legacy_json_paths() -> [String; 2] {
    let json = crate::compat::legacy_json();
    [json.clone(), format!("{}/{json}", crate::compat::legacy_dir())]
}

/// Camadas compartilhada e local do repo. A compartilhada vem de `origin/<padrão>` (com fallback no
/// disco); sem `settings.toml` compartilhado, vale o JSON legado (na raiz ou dentro da pasta legada). Como
/// no app de origem, um `settings.toml` compartilhado marca o repo como migrado e o JSON deixa de ser lido.
pub(crate) fn repo_sources(repo: &Path, default_branch: &str) -> [Source; 2] {
    let d = dir_for(repo);
    let shared_rel = format!("{d}/settings.toml");
    let local = Source::file(repo.join(format!("{d}/settings.local.toml")));
    let mut shared = Source::file(repo.join(&shared_rel));
    if let Some(t) = git_show(repo, &format!("origin/{default_branch}:{shared_rel}")) {
        shared.text = Some(t);
        shared.remote = true;
    }
    if shared.text.is_none() {
        for rel in legacy_json_paths() {
            let remote = git_show(repo, &format!("origin/{default_branch}:{rel}"));
            let mut src = Source::file(repo.join(&rel));
            if let Some(t) = remote {
                src.text = Some(t);
                src.remote = true;
            }
            if src.text.is_some() {
                shared = src;
                break;
            }
        }
    }
    [shared, local]
}

/// Lê as camadas e devolve settings efetivos + quais arquivos foram encontrados (com os avisos de cada um).
pub fn load(repo: &Path, default_branch: &str) -> (Settings, Vec<Layer>) {
    let [shared, local] = repo_sources(repo, default_branch);
    let shared_name = if shared.remote { format!("repo (origin/{default_branch})") } else { "repo".into() };
    let layers: Vec<(String, Source)> =
        vec![("usuário".into(), Source::file(home().join(".kabul/settings.toml"))), (shared_name, shared), ("repo local".into(), local), ("gerenciado".into(), Source::file(home().join(".kabul/settings.managed.toml")))];
    let mut s = Settings::default();
    let mut info = vec![];
    for (name, src) in layers {
        let (layer, warnings) = src.read();
        info.push(Layer { name, path: src.path.display().to_string(), found: src.text.is_some(), warnings });
        if let Some(layer) = layer {
            s = merge(s, layer);
        }
    }
    (s, info)
}

/// Grava `settings.local.toml` (não versionado) do repo.
pub fn save_local(repo: &Path, s: &Settings) -> anyhow::Result<PathBuf> {
    let p = repo.join(format!("{}/settings.local.toml", dir_for(repo)));
    std::fs::create_dir_all(p.parent().unwrap())?;
    let s = Settings { schema_version: Some(crate::schema::REPO_SETTINGS), ..s.clone() };
    std::fs::write(&p, toml::to_string_pretty(&s)?)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camadas() {
        let lo: Settings = toml::from_str("[scripts]\nsetup = \"npm i\"\n[scripts.run.web]\ncommand = \"npm run dev\"\ndefault = true\nicon = \"globe\"\n").unwrap();
        let hi: Settings = toml::from_str("[scripts]\nrun_mode = \"nonconcurrent\"\n[scripts.run.api]\ncommand = \"cargo run\"\n").unwrap();
        let m = merge(lo, hi);
        assert_eq!(m.scripts.setup.as_deref(), Some("npm i"));
        assert_eq!(m.scripts.run_mode.as_deref(), Some("nonconcurrent"));
        assert_eq!(m.scripts.run.len(), 2);
        assert!(m.scripts.run["web"].default);
        let tmp = std::env::temp_dir().join(format!("kabul-set-{}", std::process::id()));
        std::fs::create_dir_all(tmp.join(".kabul")).unwrap();
        std::fs::write(tmp.join(".kabul/settings.toml"), "[scripts]\nsetup = \"a\"\n").unwrap();
        std::fs::write(tmp.join(".kabul/settings.local.toml"), "[scripts]\nsetup = \"b\"\n").unwrap();
        let (s, l) = load(&tmp, "main");
        assert_eq!(s.scripts.setup.as_deref(), Some("b"));
        assert!(l[1].found && l[2].found);
        std::fs::write(tmp.join(".kabul/settings.toml"), "[env]\nA = \"1\"\nB = \"2\"\n[prompts]\nreview = \"foco em segurança\"\n").unwrap();
        std::fs::write(tmp.join(".kabul/settings.local.toml"), "[env]\nB = \"local\"\n").unwrap();
        let (s, _) = load(&tmp, "main");
        assert_eq!((s.env["A"].as_str(), s.env["B"].as_str(), s.prompts.review.as_deref()), ("1", "local", Some("foco em segurança")));
        let ls = load_layers(&tmp, "main");
        assert_eq!((ls[0].1.env["B"].as_str(), ls[1].1.env["B"].as_str()), ("2", "local"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn porta_e_env() {
        assert_eq!(expand_port("http://localhost:$KABUL_PORT/x", 41000), "http://localhost:41000/x");
        assert_eq!(expand_port("http://localhost:$((KABUL_PORT+2))", 41000), "http://localhost:41002");
        let legacy = format!("http://localhost:${}PORT", crate::compat::legacy_env_prefix());
        assert_eq!(expand_port(&legacy, 41000), "http://localhost:41000");
        assert_eq!(expand_port("http://127.0.0.1:${KABUL_PORT}", 41010), "http://127.0.0.1:41010");
        assert_eq!(parse_env("# x\nexport A=1\nB=\"dois\"\n1X=ruim\nC D=ruim\nE='tres'"), vec![("A".into(), "1".into()), ("B".into(), "dois".into()), ("E".into(), "tres".into())]);
        let s = AppSettings::default();
        assert_eq!((s.completion_sound.as_str(), s.merge_method.as_str(), s.scrollback_mb, s.rename_ws_on_branch), ("Glass", "squash", 10, true));
        assert_eq!((s.auto_update, s.update_channel.as_str()), (true, "stable"));
    }

    #[test]
    fn versao_dos_formatos() {
        let tmp = std::env::temp_dir().join(format!("kabul-set-mig-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        // app-settings.json de antes do versionamento: mantém as escolhas, ganha a versão e backup.
        let f = tmp.join("app-settings.json");
        std::fs::write(&f, r#"{"merge_method":"rebase","sound":false}"#).unwrap();
        let s = AppSettings::load(&f);
        assert_eq!((s.schema_version, s.merge_method.as_str(), s.sound, s.auto_update), (crate::schema::APP_SETTINGS, "rebase", false, true));
        assert!(tmp.join("app-settings.json.v0.bak").is_file());
        AppSettings { schema_version: 0, ..s }.save(&f).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        assert_eq!(saved["schema_version"], crate::schema::APP_SETTINGS);
        // settings.toml sem versão e de versão futura (campo desconhecido é ignorado).
        let s = parse_toml("[scripts]\nsetup = \"npm i\"\n").unwrap();
        assert_eq!((s.schema_version, s.scripts.setup.as_deref()), (Some(crate::schema::REPO_SETTINGS), Some("npm i")));
        let s = parse_toml("schema_version = 42\ncoisa_nova = 1\n[scripts]\nsetup = \"x\"\n").unwrap();
        assert_eq!((s.schema_version, s.scripts.setup.as_deref()), (Some(42), Some("x")));
        let p = save_local(&tmp, &Settings::default()).unwrap();
        assert!(std::fs::read_to_string(p).unwrap().contains(&format!("schema_version = {}", crate::schema::REPO_SETTINGS)));
        std::fs::remove_dir_all(&tmp).ok();
    }
}

/// Configurações do app (não do repo): JSON em `<estado>/app-settings.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    /// Versão do formato (ver `crate::schema`); ausente = 0. `save` grava sempre a atual.
    #[serde(default)]
    pub schema_version: u32,
    /// `github` (usuário do `gh`), `user` ($USER) ou `custom`.
    #[serde(default = "d_prefix_type")]
    pub branch_prefix_type: String,
    #[serde(default)]
    pub branch_prefix_custom: String,
    #[serde(default = "d_true")]
    pub notifications: bool,
    #[serde(default = "d_true")]
    pub sound: bool,
    /// Chip de uso de recursos (memória do Kabul e filhos) no topo da barra lateral.
    #[serde(default = "d_true")]
    pub show_resources: bool,
    /// Mantém o Mac acordado (`caffeinate`) enquanto há agente rodando.
    #[serde(default = "d_true")]
    pub caffeinate: bool,
    /// Renomeia a branch a partir da primeira mensagem.
    #[serde(default = "d_true")]
    pub auto_rename_branch: bool,
    /// Variáveis de ambiente: escopo `all` ou id do harness (`claude`, `codex`, `opencode`...).
    #[serde(default)]
    pub env: Vec<EnvVar>,
    /// Arquivo .env do usuário carregado antes das variáveis acima (opcional).
    #[serde(default)]
    pub env_file: Option<String>,

    /// Pasta onde "Abrir projeto do GitHub" e "Início rápido" criam os projetos (lembra a última usada).
    #[serde(default = "d_clone_dir")]
    pub clone_dir: String,

    // ---- General ----
    /// Som de conclusão: `none` ou o nome de um som do sistema (padrão `Glass`).
    #[serde(default = "d_sound")]
    pub completion_sound: String,
    /// Mostra o anel de contexto sempre (sem isso, só acima de 70%).
    #[serde(default)]
    pub always_show_context: bool,
    /// Texto colado acima de 5000 caracteres vira anexo.
    #[serde(default = "d_true")]
    pub auto_convert_long_text: bool,
    /// Filtra "You're absolutely right!" das respostas.
    #[serde(default)]
    pub not_absolutely_right: bool,

    // ---- Git ----
    /// Onde abrir PRs: `github` (padrão), `linear` ou `graphite`.
    #[serde(default = "d_github")]
    pub open_prs_in: String,
    #[serde(default)]
    pub delete_branch_on_archive: bool,
    #[serde(default)]
    pub archive_on_merge: bool,
    #[serde(default = "d_true")]
    pub rename_ws_on_branch: bool,
    /// `squash` (padrão), `merge` ou `rebase`.
    #[serde(default = "d_squash")]
    pub merge_method: String,
    /// Acrescenta à descrição do PR o link do workspace no Kabul.
    #[serde(default = "d_true")]
    pub pr_include_workspace_link: bool,
    /// Liga o auto-merge (`gh pr merge --auto`) ao criar o PR.
    #[serde(default)]
    pub automerge: bool,
    /// Checks opcionais que falham também bloqueiam o merge (sem isso, só os obrigatórios).
    #[serde(default)]
    pub optional_checks_blocking: bool,
    /// `git push -u` (grava o upstream) nos pushes do Kabul.
    #[serde(default = "d_true")]
    pub push_set_upstream: bool,
    /// PRs empilhados: o PR novo pode ter como base a branch de outro PR.
    #[serde(default = "d_true")]
    pub stacked_prs: bool,
    /// Simula as ações do GitHub (push, merge, ready, re-run): mostra os comandos sem executar.
    #[serde(default)]
    pub github_dry_run: bool,

    // ---- Models ----
    /// Estilo de saída do Claude Code: default, Proactive, Concise, Explanatory, Learning.
    #[serde(default = "d_default")]
    pub claude_output_style: String,
    /// Personalidade do Codex: pragmatic (padrão), friendly, none.
    #[serde(default = "d_pragmatic")]
    pub codex_personality: String,
    /// Modelo usado pelo botão Revisar (chave do seletor); vazio = o da conversa.
    #[serde(default)]
    pub review_model: Option<String>,
    /// Conversas novas começam em plan mode.
    #[serde(default)]
    pub default_plan: bool,
    /// Gemini (agy): aprova tudo sozinho (`--dangerously-skip-permissions`) em vez do cartão de aprovação.
    #[serde(default)]
    pub agy_skip_permissions: bool,

    // ---- Advanced ----
    /// Executáveis dos agentes (vazio = o do PATH).
    #[serde(default)]
    pub claude_path: Option<String>,
    #[serde(default)]
    pub codex_path: Option<String>,
    #[serde(default)]
    pub opencode_path: Option<String>,
    /// Limite do scrollback do terminal, em MB (padrão 10).
    #[serde(default = "d_scrollback")]
    pub scrollback_mb: u32,
    /// Backend dos terminais: `tmux`, `pty` ou vazio (automático: PTY no Windows, tmux onde houver).
    /// Vale ao reabrir o app (vira `KABUL_TERMINAL`).
    #[serde(default)]
    pub terminal_backend: Option<String>,
    /// Shell do terminal (vazio = padrão do sistema; no Windows `pwsh`, `powershell`, `cmd` ou `git-bash`).
    /// Vira `KABUL_SHELL`.
    #[serde(default)]
    pub shell: Option<String>,

    // ---- Uso e limites ----
    /// Ícone do Kabul na barra de menus (macOS) / bandeja (Windows).
    #[serde(default = "d_true")]
    pub tray: bool,
    /// O que o ícone mostra (aba Uso e Configurações › Geral › Ícone na barra de menus).
    #[serde(default)]
    pub tray_icon: TrayIconPrefs,
    /// Avisa quando uma janela de limite passar disto (%).
    #[serde(default = "d_alert_pct")]
    pub usage_alert_pct: u32,
    /// Orçamento diário/mensal em US$ (vazio = sem alerta).
    #[serde(default)]
    pub usage_daily_budget: Option<f64>,
    #[serde(default)]
    pub usage_monthly_budget: Option<f64>,
    /// Lê o CodexBar CLI quando instalado (limites de mais provedores, status e créditos).
    #[serde(default = "d_true")]
    pub usage_codexbar: bool,

    // ---- Atualização ----
    /// Procura e baixa atualizações do Kabul sozinho (Configurações › Avançado).
    #[serde(default = "d_true")]
    pub auto_update: bool,
    /// Canal de atualização: `stable` (padrão) ou `beta`.
    #[serde(default = "d_stable")]
    pub update_channel: String,

    // ---- Navegador ----
    /// MCP `kabul-browser` embutido em todas as conversas (o liga/desliga por sessão continua valendo).
    #[serde(default = "d_true")]
    pub browser_mcp: bool,
    /// O que os agentes podem fazer sem perguntar: `ask`, `localhost` (padrão) ou `all`.
    #[serde(default = "d_localhost")]
    pub browser_policy: String,
    /// Executável do navegador (vazio = o Chrome/Edge/Chromium instalado ou o baixado pelo Kabul).
    #[serde(default)]
    pub browser_path: Option<String>,
    /// Claude Code com o Chrome do próprio usuário (`--chrome`, extensão Claude in Chrome). Alternativa
    /// opcional; o padrão para todas as IAs é o navegador do Kabul.
    #[serde(default)]
    pub claude_chrome: bool,
}

fn d_localhost() -> String {
    "localhost".into()
}

fn d_alert_pct() -> u32 {
    80
}

/// Um limite escolhido para o ícone: provedor, conta (perfil do Kabul ou o rótulo da fonte) e janela.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PinnedLimit {
    pub provider: String,
    pub account: String,
    pub window: String,
}

/// Até quantos limites cabem no ícone.
pub const TRAY_MAX_PINNED: usize = 3;

/// O que o ícone da barra de menus / bandeja mostra.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrayIconPrefs {
    /// `auto` (os dois limites mais apertados) ou `manual` (os de `pinned`, até 3).
    #[serde(default = "d_auto")]
    pub mode: String,
    #[serde(default)]
    pub pinned: Vec<PinnedLimit>,
    /// `bars`, `percent`, `bars_percent` ou `icon` (só o ícone).
    #[serde(default = "d_bars_percent")]
    pub style: String,
    /// Mostra o gasto de hoje ao lado (macOS) / na dica (Windows).
    #[serde(default)]
    pub show_spend: bool,
}

impl Default for TrayIconPrefs {
    fn default() -> Self {
        Self { mode: d_auto(), pinned: vec![], style: d_bars_percent(), show_spend: false }
    }
}

fn d_auto() -> String {
    "auto".into()
}
fn d_bars_percent() -> String {
    "bars_percent".into()
}

fn d_stable() -> String {
    "stable".into()
}

fn d_clone_dir() -> String {
    "~/Developer".into()
}
fn d_sound() -> String {
    "Glass".into()
}
fn d_github() -> String {
    "github".into()
}
fn d_squash() -> String {
    "squash".into()
}
fn d_default() -> String {
    "default".into()
}
fn d_pragmatic() -> String {
    "pragmatic".into()
}
fn d_scrollback() -> u32 {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    #[serde(default = "d_all")]
    pub scope: String,
}

/// Prefixo padrão = usuário do GitHub (cai para $USER sem `gh`).
fn d_prefix_type() -> String {
    "github".into()
}
fn d_true() -> bool {
    true
}
fn d_all() -> String {
    "all".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        serde_json::from_str("{}").unwrap()
    }
}

impl AppSettings {
    pub fn load(file: &Path) -> Self {
        let mut s: Self = crate::schema::load_json(file, crate::schema::APP_SETTINGS, crate::schema::APP_SETTINGS_MIGRATIONS).and_then(|(doc, _)| serde_json::from_value(doc).ok()).unwrap_or_default();
        s.schema_version = crate::schema::APP_SETTINGS;
        s
    }
    pub fn save(&self, file: &Path) -> anyhow::Result<()> {
        if let Some(d) = file.parent() {
            std::fs::create_dir_all(d)?;
        }
        let s = Self { schema_version: crate::schema::APP_SETTINGS, ..self.clone() };
        std::fs::write(file, serde_json::to_vec_pretty(&s)?)?;
        Ok(())
    }
    pub fn env_for(&self, harness: &str) -> Vec<(String, String)> {
        let file = self.env_file.as_deref().filter(|f| !f.trim().is_empty()).and_then(|f| std::fs::read_to_string(f).ok()).map(|t| parse_env(&t)).unwrap_or_default();
        file.into_iter().chain(self.env.iter().filter(|e| e.scope == "all" || e.scope == harness).map(|e| (e.key.clone(), e.value.clone()))).collect()
    }
    /// Executáveis escolhidos em Configurações › Avançado viram `KABUL_BIN_*` (lidos por `harness::which`).
    pub fn apply_bin_overrides(&self) {
        for (bin, p) in [("claude", &self.claude_path), ("codex", &self.codex_path), ("opencode", &self.opencode_path)] {
            let var = crate::harness::bin_override_var(bin);
            match p.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
                Some(p) => std::env::set_var(var, p),
                None => std::env::remove_var(var),
            }
        }
        // Só define: sem valor, vale o que veio do ambiente (testes, linha de comando).
        for (var, v) in [("KABUL_TERMINAL", &self.terminal_backend), ("KABUL_SHELL", &self.shell)] {
            if let Some(v) = v.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                std::env::set_var(var, v);
            }
        }
    }

    /// Prefixo efetivo da branch.
    pub fn branch_prefix(&self) -> String {
        match self.branch_prefix_type.as_str() {
            "custom" if !self.branch_prefix_custom.trim().is_empty() => self.branch_prefix_custom.trim().trim_end_matches('/').to_string(),
            "none" => String::new(),
            "github" => crate::shell::command("gh").args(["api", "user", "-q", ".login"]).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(user),
            _ => user(),
        }
    }
}

fn user() -> String {
    std::env::var("KABUL_BRANCH_PREFIX").or_else(|_| std::env::var("USER")).or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "kabul".into())
}
