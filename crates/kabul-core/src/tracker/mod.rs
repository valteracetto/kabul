//! Rastreadores de issue (Linear, GitHub Issues e o campo Status do GitHub Projects) atrás de uma
//! camada única, [`IssueTracker`]: o Quadro move o card e o rastreador atualiza a issue; o polling
//! lê o estado de lá para mover o card de volta.
//!
//! Para acrescentar um rastreador (Jira, GitLab...): uma variante em [`TrackerKind`], uma
//! implementação de [`IssueTracker`] (com o transporte atrás de um trait, para testar com respostas
//! gravadas) e o registro em [`Trackers::real`]. O mapeamento coluna → estado ([`crate::board`]) só
//! enxerga [`RemoteState`] com nome e [`StateKind`], então funciona igual para todos.
//!
//! Segurança: a chave do Linear vai no cabeçalho HTTP de dentro do processo; o GitHub passa pelo
//! `gh` (com a autenticação dele). Nenhum token entra em linha de comando ou log.
pub mod github;
pub mod linear;

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum TrackerKind {
    Linear,
    Github,
}

impl TrackerKind {
    pub fn label(self) -> &'static str {
        match self {
            TrackerKind::Linear => "Linear",
            TrackerKind::Github => "GitHub",
        }
    }
}

/// Tipo do estado no fluxo, no vocabulário do Linear (`state.type`). O GitHub cai em `unstarted`
/// (aberta), `completed` (fechada como concluída) e `canceled` (fechada como "not planned").
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum StateKind {
    Triage,
    Backlog,
    Unstarted,
    Started,
    Completed,
    Canceled,
}

impl StateKind {
    pub fn parse(s: &str) -> Option<StateKind> {
        Some(match s {
            "triage" => StateKind::Triage,
            "backlog" => StateKind::Backlog,
            "unstarted" => StateKind::Unstarted,
            "started" => StateKind::Started,
            "completed" => StateKind::Completed,
            "canceled" | "cancelled" => StateKind::Canceled,
            _ => return None,
        })
    }
}

/// Um estado do fluxo de lá (estado do time no Linear, aberta/fechada no GitHub, opção do campo Status
/// num projeto).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteState {
    pub id: String,
    pub name: String,
    pub kind: StateKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Item de um GitHub Project (v2) com o campo Status (single select).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProjectItem {
    pub project_id: String,
    pub project_title: String,
    pub item_id: String,
    pub field_id: String,
    /// Opção atual (nenhuma = item sem status).
    pub option: Option<RemoteState>,
    pub options: Vec<RemoteState>,
}

/// Issue vinculada a um workspace (gravada no `state.json`). `id`: UUID ou identificador no Linear
/// (`ENG-12`; a API aceita os dois), `owner/repo#12` no GitHub.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IssueLink {
    pub tracker: TrackerKind,
    pub id: String,
    /// Como aparece para o usuário: `ENG-12`, `#12`.
    pub identifier: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub url: String,
    /// Último estado visto lá (para o chip do card e para o polling saber se mudou).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<RemoteState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// O que a issue é lá agora.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Remote {
    pub state: RemoteState,
    /// Estados possíveis para esta issue (os do time no Linear; aberta/fechada no GitHub).
    pub states: Vec<RemoteState>,
    pub updated_at: String,
    #[serde(default)]
    pub labels: Vec<String>,
    /// GitHub Projects: o primeiro projeto da issue que tem o campo Status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectItem>,
}

/// O que mudar lá. Campos vazios não mexem em nada.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Change {
    pub state: Option<RemoteState>,
    #[serde(default)]
    pub add_labels: Vec<String>,
    #[serde(default)]
    pub remove_labels: Vec<String>,
    #[serde(default)]
    pub project_option: Option<RemoteState>,
}

impl Change {
    pub fn is_empty(&self) -> bool {
        self.state.is_none() && self.add_labels.is_empty() && self.remove_labels.is_empty() && self.project_option.is_none()
    }
}

pub trait IssueTracker: Send + Sync {
    fn kind(&self) -> TrackerKind;
    /// O rastreador está configurado (chave do Linear; `gh` instalado).
    fn connected(&self) -> bool;
    /// Estado atual e estados possíveis. `projects`: também o Status do projeto (só GitHub).
    fn fetch(&self, link: &IssueLink, projects: bool) -> Result<Remote>;
    /// Aplica a mudança e devolve como a issue ficou.
    fn apply(&self, link: &IssueLink, before: &Remote, change: &Change) -> Result<Remote>;
    /// Vários de uma vez (polling). Padrão: um por um; o Linear junta numa requisição.
    fn poll(&self, links: &[IssueLink], projects: bool) -> Vec<Result<Remote>> {
        links.iter().map(|l| self.fetch(l, projects)).collect()
    }
    /// Lê uma issue a partir do que o usuário colou (URL ou identificador) para vincular.
    fn lookup(&self, input: &str, default_repo: Option<&str>) -> Result<Option<IssueLink>>;
    /// Fluxos de estados para a prévia do mapeamento (times do Linear; "Issues" no GitHub).
    fn workflows(&self) -> Result<Vec<(String, Vec<RemoteState>)>>;
}

/// Os rastreadores disponíveis (reais ou de teste).
pub struct Trackers {
    pub linear: Box<dyn IssueTracker>,
    pub github: Box<dyn IssueTracker>,
}

impl Trackers {
    pub fn real() -> Self {
        Self { linear: Box::new(linear::LinearTracker::cached(Box::new(linear::Http))), github: Box::new(github::GithubTracker::new(Box::new(github::GhCli))) }
    }

    pub fn get(&self, k: TrackerKind) -> &dyn IssueTracker {
        match k {
            TrackerKind::Linear => self.linear.as_ref(),
            TrackerKind::Github => self.github.as_ref(),
        }
    }

    /// Vincula a partir de uma URL ou identificador: GitHub primeiro (URL/`#12` são inequívocos),
    /// depois o Linear.
    pub fn lookup(&self, input: &str, default_repo: Option<&str>) -> Result<Option<IssueLink>> {
        if let Some(l) = self.github.lookup(input, default_repo)? {
            return Ok(Some(l));
        }
        self.linear.lookup(input, default_repo)
    }
}

/// Texto curto e seguro para mostrar (erros de lá podem trazer HTML ou páginas inteiras).
pub fn short_err(e: &anyhow::Error) -> String {
    let s = format!("{e:#}");
    let s = s.lines().next().unwrap_or("").trim();
    if s.chars().count() > 240 {
        format!("{}…", s.chars().take(240).collect::<String>())
    } else {
        s.to_string()
    }
}
