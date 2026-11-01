//! Ferramentas: inventário (só leitura) das extensões das IAs — skills, comandos, prompts, subagentes,
//! plugins, hooks, MCPs, extensões e instruções — de todas as IAs instaladas, com a origem de cada
//! item (lock do `npx skills`, marketplace, registro de instalação, pacote global), onde ele está
//! (cópia, link ou link quebrado) e a saúde do conjunto (duplicados, divergentes, órfãos...).
//!
//! Desenho:
//! - [`providers`] é uma tabela declarativa "onde cada IA guarda o quê" (global, projeto e a variável
//!   que move a pasta). Uma IA nova é uma linha na tabela.
//! - [`scan`] lê o disco (tolerante: formato desconhecido vira aviso, nunca erro) e produz entradas
//!   cruas; [`build`] junta por item, aplica o escopo pedido, calcula a saúde e as categorias.
//! - [`service::Service`] guarda o resultado em memória e atualiza em segundo plano.
//! - Nada aqui escreve nas pastas das IAs: a única escrita é o estado do Kabul (preferências e cache).
pub mod category;
pub mod frontmatter;
pub mod fsx;
pub mod health;
pub mod known;
pub mod prefs;
pub mod providers;
pub mod redact;
pub mod roots;
pub mod scan;
pub mod service;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub use roots::Roots;

/// Versão do formato do snapshot (o cliente avisa quando não reconhece).
pub const SCHEMA: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    #[default]
    Skill,
    Command,
    Prompt,
    Agent,
    Plugin,
    Hook,
    Mcp,
    Extension,
    Instructions,
    /// Não é extensão de IA (ex.: plugins de um editor de notas), listado para não confundir.
    Foreign,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Skill => "skill",
            Kind::Command => "command",
            Kind::Prompt => "prompt",
            Kind::Agent => "agent",
            Kind::Plugin => "plugin",
            Kind::Hook => "hook",
            Kind::Mcp => "mcp",
            Kind::Extension => "extension",
            Kind::Instructions => "instructions",
            Kind::Foreign => "foreign",
        }
    }
    /// Itens copiados entre IAs (participam de duplicado/divergente/órfão).
    pub fn portable(&self) -> bool {
        matches!(self, Kind::Skill | Kind::Command | Kind::Prompt | Kind::Agent)
    }
}

/// Como o item está naquela pasta.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Link {
    #[default]
    Real,
    Symlink {
        target: String,
    },
    Broken {
        target: String,
    },
}

/// Um lugar onde o item existe.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    /// Id da IA na tabela de provedores (`shared` = pasta canônica `.agents`).
    pub harness: String,
    /// Apelido da conta isolada do Kabul (quando veio da pasta de uma conta).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    /// `global` | `project`
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    /// Nome do repositório (ou caminho do projeto, quando não é um repo do Kabul).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    /// Id do plugin que traz o item (itens de plugin são geridos pelo plugin).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
    /// Caminho para exibir (`~` no lugar da pasta pessoal).
    pub path: String,
    pub link: Link,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Formato reconhecido (`skill-md`, `command-md`, `command-toml`, `json`, ...).
    pub format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// Pasta canônica compartilhada (`~/.agents/skills` ou `.agents/skills` do projeto).
    #[serde(default)]
    pub canonical: bool,
    /// Gerido por outra coisa (plugin, sincronização, embutido): não conta como cópia manual.
    #[serde(default)]
    pub managed: bool,
}

/// Como chamar o item numa IA.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Invoke {
    pub harness: String,
    /// `slash` | `mention` | `auto` | `dollar` | `tool`
    pub how: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// `kind:nome` (plugins: `plugin:nome@marketplace`; instruções: `instructions:<lugar>:<arquivo>`).
    pub id: String,
    pub kind: Kind,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// "Para que serve": a primeira frase da descrição, sem o "Use when...".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    pub categories: Vec<String>,
    /// Resto do frontmatter/manifesto (texto curto, já sem segredos).
    pub extras: BTreeMap<String, String>,
    pub placements: Vec<Placement>,
    /// IAs onde está (sem repetição, na ordem da tabela).
    pub harnesses: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight_tokens: Option<u64>,
    pub finding_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<u64>,
    /// `runsCode` | `unpinned` | `network` | `placeholder`
    pub risks: Vec<String>,
    pub invoke: Vec<Invoke>,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Pior severidade dos achados: `ok` | `info` | `warn` | `error`.
    pub status: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    /// Lock do `npx skills` (global ou `skills-lock.json` do projeto).
    SkillsLock,
    GitRepo,
    Marketplace,
    NpmGlobal,
    /// Ferramenta com pasta própria que se instalou nas IAs (registro de instalação, hooks, MCP...).
    NativeIntegration,
    UvTool,
    Builtin,
    Synced,
    Local,
    Project,
}

/// Algo que a fonte deixou instalado fora das pastas de extensões.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Footprint {
    /// `hook` | `mcp` | `binary` | `dir` | `npm` | `uv` | `settings` | `registry`
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub kind: SourceKind,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `dono/repo` quando vem de um repositório.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub item_ids: Vec<String>,
    pub footprint: Vec<Footprint>,
    /// A origem ainda existe no disco (ex.: o marketplace clonado).
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Source {
    pub fn new(id: impl Into<String>, kind: SourceKind, label: impl Into<String>) -> Self {
        Self { id: id.into(), kind, label: label.into(), url: None, repo: None, version: None, commit: None, installed_at: None, updated_at: None, item_ids: vec![], footprint: vec![], exists: true, note: None }
    }
    pub(crate) fn add_footprint(&mut self, f: Footprint) {
        // Mesmo tipo e mesmo caminho é a mesma pegada (o rótulo pode variar entre leitores).
        let same = |x: &Footprint| x.kind == f.kind && if f.path.is_some() { x.path == f.path } else { x.label == f.label };
        if !self.footprint.iter().any(same) {
            self.footprint.push(f);
        }
    }
    /// Junta outra fonte com o mesmo id (o que já está preenchido vence).
    pub(crate) fn merge(&mut self, o: Source) {
        macro_rules! fill {
            ($($f:ident),*) => { $( if self.$f.is_none() { self.$f = o.$f; } )* };
        }
        fill!(url, repo, version, commit, installed_at, updated_at, note);
        for f in o.footprint {
            self.add_footprint(f);
        }
        self.exists |= o.exists;
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum FindingKind {
    BrokenLink,
    Drift,
    DuplicateCopy,
    Orphan,
    NameConflict,
    StalePluginVersion,
    Unrecognized,
    ParseError,
    MissingDescription,
    Heavy,
    NestedRepo,
    Placeholder,
    HookRunsCode,
    UnpinnedMcp,
    RegistryMissing,
    RegistryEdited,
    StackedInstall,
}

/// Um problema (ou aviso) encontrado. O texto é montado na interface a partir de `kind` + `args`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub severity: Severity,
    pub kind: FindingKind,
    pub item_ids: Vec<String>,
    pub paths: Vec<String>,
    pub args: BTreeMap<String, String>,
}

impl Finding {
    pub fn new(kind: FindingKind, severity: Severity, item_ids: Vec<String>, paths: Vec<String>) -> Self {
        let key = format!("{kind:?}|{}|{}", item_ids.join(","), paths.join(","));
        let id = format!("{}:{}", serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(), &crate::usage::sha256_hex(key.as_bytes())[..12]);
        Self { id, severity, kind, item_ids, paths, args: BTreeMap::new() }
    }
    pub fn arg(mut self, k: &str, v: impl ToString) -> Self {
        self.args.insert(k.into(), v.to_string());
        self
    }
}

/// Uma pasta (ou arquivo) lida, para o popover "N pastas lidas".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub harness: String,
    /// `skills` | `commands` | `agents` | `prompts` | `rules` | `plugins` | `mcp` | `hooks` | `extensions` | `lock` | `registry` | `project`
    pub what: String,
    pub path: String,
    /// `ok` | `missing` | `unreadable`
    pub status: String,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    /// Variável de ambiente que moveu esta pasta (ex.: `CLAUDE_CONFIG_DIR`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessSummary {
    pub id: String,
    pub label: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema: u32,
    pub generated_at: u64,
    pub scan_ms: u64,
    /// O resultado é do cache e uma atualização está rodando (chega `tools-changed`).
    pub stale: bool,
    /// `global` | `repo` | `all`
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_id: Option<String>,
    pub harnesses: Vec<HarnessSummary>,
    pub roots: Vec<RootInfo>,
    pub items: Vec<Item>,
    pub sources: Vec<Source>,
    pub findings: Vec<Finding>,
}

/// Detalhe de um item (corpo só sob demanda, com teto).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    pub item: Item,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub frontmatter: BTreeMap<String, String>,
    /// Arquivos da pasta do item (relativos, no máximo 60).
    pub files: Vec<String>,
    pub truncated: bool,
    /// Caminho absoluto do arquivo principal (para "mostrar no Finder/Explorer" no desktop).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abs_path: Option<String>,
    pub findings: Vec<Finding>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

/// Repositório do Kabul a ler (projeto).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct RepoRef {
    pub id: String,
    pub name: String,
    pub path: std::path::PathBuf,
}

/// Pedido de snapshot.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    /// `global` | `repo` | `all` (padrão `all`).
    #[serde(default)]
    pub scope: Option<String>,
    /// Repositório do escopo `repo`.
    #[serde(default)]
    pub repo_id: Option<String>,
    #[serde(default)]
    pub refresh: bool,
}

pub use scan::{build, scan_all, Raw, ScanOut};

/// Corpo e detalhes de um item a partir do resultado do scan (lê o arquivo agora, com teto de 64 KB).
pub fn item_detail(out: &ScanOut, snap: &Snapshot, id: &str) -> Option<ItemDetail> {
    let item = snap.items.iter().find(|i| i.id == id)?.clone();
    let abs = out.raws.iter().filter(|r| r.item_id() == id).find(|r| r.main_file.as_ref().is_some_and(|p| p.is_file())).and_then(|r| r.main_file.clone()).or_else(|| out.raws.iter().find(|r| r.item_id() == id).and_then(|r| r.main_file.clone()));
    let (mut body, mut fm, mut truncated, mut files) = (None, BTreeMap::new(), false, vec![]);
    if let Some(p) = abs.as_ref().filter(|p| p.is_file()) {
        let (text, cut) = fsx::read_capped(p, 64 * 1024);
        truncated = cut;
        let parsed = frontmatter::parse(&text);
        fm = parsed.fields.into_iter().map(|(k, v)| (k.clone(), redact::value(&k, &v))).collect();
        body = Some(text[parsed.body_start.min(text.len())..].to_string());
        if item.kind == Kind::Skill {
            if let Some(dir) = p.parent() {
                files = fsx::list_files(dir, 60);
            }
        }
    }
    if matches!(item.kind, Kind::Mcp | Kind::Hook | Kind::Plugin) {
        // Configuração: nunca o arquivo inteiro (pode ter tokens); só o que o scan já redigiu.
        body = None;
    }
    let findings = snap.findings.iter().filter(|f| f.item_ids.iter().any(|x| x == id)).cloned().collect();
    let source = item.source_id.as_ref().and_then(|s| snap.sources.iter().find(|x| &x.id == s)).cloned();
    Some(ItemDetail { item, body, frontmatter: fm, files, truncated, abs_path: abs.map(|p| p.display().to_string()), findings, source })
}
