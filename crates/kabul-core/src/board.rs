//! Quadro: colunas configuráveis (globais, com repositórios que podem ter as próprias), o mapeamento
//! coluna → estado do rastreador ([`crate::tracker`]) e a sincronia nos dois sentidos.
//!
//! - O `status` do workspace é o `id` da coluna. Os ids das colunas padrão são os status de antes
//!   (`backlog`, `in-progress`, `in-review`, `done`, `canceled`), então nada muda para quem já usava.
//! - Mapeamento automático: nome igual (com sinônimos em inglês e português), depois o tipo da coluna
//!   (o ícone diz o tipo: a fazer, em andamento, em revisão, concluído, cancelado) contra o tipo do
//!   estado de lá (`state.type` no Linear; aberta/fechada no GitHub; o nome da opção no Projects).
//!   Cada coluna pode fixar o estado (ou "nenhum") por rastreador.
//! - Mover o card ([`move_card`]) atualiza a issue quando a sincronia está ligada; o resultado traz o
//!   antes (para desfazer). O polling ([`poll_once`]) traz mudanças feitas lá para o card.
//! - Eventos do Kabul ([`AutoEvent`]) movem o card só para a frente.
use crate::store::{SharedStore, State, Store, Workspace};
use crate::tracker::{short_err, Change, IssueLink, IssueTracker, Remote, RemoteState, StateKind, TrackerKind, Trackers};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Ícones (o desenho também diz o tipo da coluna para o mapeamento automático).
pub const ICONS: &[&str] = &["backlog", "todo", "progress", "review", "done", "canceled", "blocked", "star"];
/// Cores (a interface resolve cada nome para o tema claro e o escuro).
pub const COLORS: &[&str] = &["gray", "blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "brown"];
const MAX_COLUMNS: usize = 16;
const MAX_NAME: usize = 40;

/// Estado fixado à mão para uma coluna num rastreador.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", content = "value", rename_all = "snake_case")]
pub enum Override {
    /// Por nome e tipo.
    #[default]
    Auto,
    /// Nunca sincroniza esta coluna neste rastreador.
    Off,
    /// Nome do estado (Linear), `open`/`closed`/`not_planned` (GitHub) ou da opção do Status (Projects).
    State(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ColumnMap {
    #[serde(default)]
    pub linear: Override,
    #[serde(default)]
    pub github: Override,
    /// Label que a issue do GitHub ganha nesta coluna (e perde ao sair dela).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_label: Option<String>,
    #[serde(default)]
    pub project: Override,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Column {
    pub id: String,
    pub name: String,
    #[serde(default = "d_icon")]
    pub icon: String,
    #[serde(default = "d_color")]
    pub color: String,
    #[serde(default)]
    pub map: ColumnMap,
}

fn d_icon() -> String {
    "todo".into()
}
fn d_color() -> String {
    "gray".into()
}

/// Mover sozinho quando algo acontece no Kabul (só para a frente). `None` = não mover.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutoMoves {
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub agent_started: Option<String>,
    #[serde(default)]
    pub pr_opened: Option<String>,
    #[serde(default)]
    pub pr_merged: Option<String>,
}

fn yes() -> bool {
    true
}

impl Default for AutoMoves {
    /// O comportamento de antes (PR aberto → em revisão, merge → concluído) mais "agente começou".
    fn default() -> Self {
        Self { enabled: true, agent_started: Some("in-progress".into()), pr_opened: Some("in-review".into()), pr_merged: Some("done".into()) }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Board {
    /// Mover um workspace vinculado atualiza o status da issue.
    #[serde(default)]
    pub sync: bool,
    /// Mudou lá fora: o card acompanha (polling).
    #[serde(default)]
    pub reverse_sync: bool,
    /// GitHub: também o campo Status do projeto (Projects v2) da issue.
    #[serde(default)]
    pub github_projects: bool,
    #[serde(default)]
    pub auto: AutoMoves,
    #[serde(default = "default_columns")]
    pub columns: Vec<Column>,
}

impl Default for Board {
    fn default() -> Self {
        Self { sync: false, reverse_sync: false, github_projects: false, auto: AutoMoves::default(), columns: default_columns() }
    }
}

fn col(id: &str, name: &str, icon: &str, color: &str) -> Column {
    Column { id: id.into(), name: name.into(), icon: icon.into(), color: color.into(), map: ColumnMap::default() }
}

/// Todo, In progress, In review, Done (os ids são os status de antes).
pub fn default_columns() -> Vec<Column> {
    vec![col("backlog", "Todo", "todo", "gray"), col("in-progress", "In progress", "progress", "yellow"), col("in-review", "In review", "review", "green"), col("done", "Done", "done", "brown")]
}

fn canceled_column() -> Column {
    col("canceled", "Canceled", "canceled", "gray")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn clip(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(n).collect()
}

impl Board {
    /// Confere e limpa o que veio da interface: ids válidos e únicos, nomes, ícone e cor do conjunto,
    /// alvos dos eventos que existem.
    pub fn validate(mut self) -> Result<Board> {
        if self.columns.is_empty() {
            bail!("o quadro precisa de pelo menos uma coluna");
        }
        if self.columns.len() > MAX_COLUMNS {
            bail!("no máximo {MAX_COLUMNS} colunas");
        }
        let mut seen = std::collections::HashSet::new();
        for c in &mut self.columns {
            if !valid_id(&c.id) || !seen.insert(c.id.clone()) {
                bail!("id de coluna inválido ou repetido: {}", c.id);
            }
            c.name = clip(&c.name, MAX_NAME);
            if c.name.is_empty() {
                bail!("dê um nome a cada coluna");
            }
            if !ICONS.contains(&c.icon.as_str()) {
                c.icon = d_icon();
            }
            if !COLORS.contains(&c.color.as_str()) {
                c.color = d_color();
            }
            c.map.github_label = c.map.github_label.as_deref().map(|l| clip(l, 50)).filter(|l| !l.is_empty());
            for o in [&mut c.map.linear, &mut c.map.github, &mut c.map.project] {
                if let Override::State(v) = o {
                    *v = clip(v, 80);
                    if v.is_empty() {
                        *o = Override::Auto;
                    }
                }
            }
            if let Override::State(v) = &c.map.github {
                if !["open", "closed", "not_planned"].contains(&v.as_str()) {
                    bail!("estado do GitHub inválido: {v}");
                }
            }
        }
        let ids: Vec<String> = self.columns.iter().map(|c| c.id.clone()).collect();
        for t in [&mut self.auto.agent_started, &mut self.auto.pr_opened, &mut self.auto.pr_merged] {
            if t.as_ref().is_some_and(|x| !ids.contains(x)) {
                *t = None;
            }
        }
        Ok(self)
    }

    /// Posição da coluna do status: o id; senão o nome ou o tipo (cards vindos de outro quadro, como
    /// `done` num quadro com "Feito"); senão a primeira.
    pub fn index_of(&self, status: &str) -> usize {
        let by_canon = || {
            let k = canon_of_name(&status.replace(['-', '_'], " "))?;
            self.columns.iter().position(|c| column_canon(c) == Some(k))
        };
        self.columns.iter().position(|c| c.id == status).or_else(|| self.columns.iter().position(|c| norm(&c.name) == norm(status))).or_else(by_canon).unwrap_or(0)
    }

    pub fn has(&self, id: &str) -> bool {
        self.columns.iter().any(|c| c.id == id)
    }

    /// Labels do GitHub que o quadro administra (as das colunas).
    pub fn labels(&self) -> Vec<String> {
        self.columns.iter().filter_map(|c| c.map.github_label.clone()).collect()
    }
}

// ---------------- nomes, sinônimos e tipos ----------------

/// Minúsculas, sem acento, só letras e números separados por um espaço.
pub fn norm(s: &str) -> String {
    let base: String = s
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    base.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// O "tipo" de uma coluna ou estado, para casar nomes diferentes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Canon {
    Backlog,
    Todo,
    Progress,
    Review,
    Done,
    Canceled,
}

const SYNONYMS: &[(Canon, &[&str])] = &[
    (Canon::Backlog, &["backlog", "icebox", "ideias", "ideas", "someday"]),
    (Canon::Todo, &["todo", "to do", "a fazer", "por fazer", "pendente", "ready", "next", "up next", "unstarted", "planned", "planejado"]),
    (Canon::Progress, &["in progress", "progress", "doing", "em andamento", "andamento", "em progresso", "fazendo", "wip", "started", "working", "active"]),
    (Canon::Review, &["in review", "review", "code review", "em revisao", "revisao", "revisando", "reviewing", "qa", "testing", "in qa", "pr open", "ready for review"]),
    (Canon::Done, &["done", "completed", "complete", "closed", "concluido", "concluida", "feito", "finalizado", "pronto", "merged", "shipped", "released", "resolved"]),
    (Canon::Canceled, &["canceled", "cancelled", "cancelado", "cancelada", "wont do", "won t do", "wont fix", "duplicate", "duplicado", "not planned", "abandoned", "descartado"]),
];

/// Tipo pelo nome (sinônimos em inglês e português).
pub fn canon_of_name(name: &str) -> Option<Canon> {
    let n = norm(name);
    SYNONYMS.iter().find(|(_, list)| list.contains(&n.as_str())).map(|(c, _)| *c)
}

fn canon_of_icon(icon: &str) -> Option<Canon> {
    Some(match icon {
        "backlog" => Canon::Backlog,
        "todo" => Canon::Todo,
        "progress" => Canon::Progress,
        "review" => Canon::Review,
        "done" => Canon::Done,
        "canceled" => Canon::Canceled,
        _ => return None,
    })
}

fn canon_of_kind(k: StateKind) -> Option<Canon> {
    Some(match k {
        StateKind::Backlog => Canon::Backlog,
        StateKind::Unstarted => Canon::Todo,
        StateKind::Started => Canon::Progress,
        StateKind::Completed => Canon::Done,
        StateKind::Canceled => Canon::Canceled,
        StateKind::Triage => return None,
    })
}

/// Tipo de estado pelo nome (opções do Status no GitHub Projects, que não têm tipo).
pub fn kind_of_name(name: &str) -> Option<StateKind> {
    Some(match canon_of_name(name)? {
        Canon::Backlog => StateKind::Backlog,
        Canon::Todo => StateKind::Unstarted,
        Canon::Progress | Canon::Review => StateKind::Started,
        Canon::Done => StateKind::Completed,
        Canon::Canceled => StateKind::Canceled,
    })
}

pub fn column_canon(c: &Column) -> Option<Canon> {
    canon_of_name(&c.name).or_else(|| canon_of_icon(&c.icon))
}

fn state_canon(s: &RemoteState) -> Option<Canon> {
    canon_of_name(&s.name).or_else(|| canon_of_kind(s.kind))
}

/// Estado de lá para a coluna (ou nenhum = "sem correspondência").
pub fn resolve(c: &Column, states: &[RemoteState], o: &Override) -> Option<RemoteState> {
    match o {
        Override::Off => None,
        Override::State(v) => states.iter().find(|s| norm(&s.name) == norm(v) || s.id == *v).cloned(),
        Override::Auto => {
            if let Some(s) = states.iter().find(|s| norm(&s.name) == norm(&c.name)) {
                return Some(s.clone());
            }
            let chain: &[Canon] = match column_canon(c)? {
                Canon::Review => &[Canon::Review, Canon::Progress],
                Canon::Backlog => &[Canon::Backlog, Canon::Todo],
                Canon::Todo => &[Canon::Todo, Canon::Backlog],
                Canon::Progress => &[Canon::Progress],
                Canon::Done => &[Canon::Done],
                Canon::Canceled => &[Canon::Canceled],
            };
            chain.iter().find_map(|k| states.iter().find(|s| state_canon(s) == Some(*k)).cloned())
        }
    }
}

/// GitHub Issues: concluído → fechada, cancelado → "not planned", o resto → aberta.
pub fn resolve_github(c: &Column) -> Option<RemoteState> {
    let st = crate::tracker::github::states();
    let id = match &c.map.github {
        Override::Off => return None,
        Override::State(v) => v.as_str(),
        Override::Auto => match column_canon(c) {
            Some(Canon::Done) => "closed",
            Some(Canon::Canceled) => "not_planned",
            _ => "open",
        },
    };
    st.into_iter().find(|s| s.id == id)
}

/// O que mudar lá para a issue ficar na coluna `idx`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    pub change: Change,
    pub no_match: bool,
}

pub fn plan(board: &Board, idx: usize, tracker: TrackerKind, remote: &Remote) -> Plan {
    let c = &board.columns[idx];
    match tracker {
        TrackerKind::Linear => {
            let to = resolve(c, &remote.states, &c.map.linear);
            Plan { no_match: to.is_none(), change: Change { state: to, ..Default::default() } }
        }
        TrackerKind::Github => {
            let state = resolve_github(c);
            let mine = c.map.github_label.clone();
            let add: Vec<String> = mine.iter().cloned().collect();
            let remove: Vec<String> = board.labels().into_iter().filter(|l| Some(l) != mine.as_ref()).collect();
            let project_option = if board.github_projects { remote.project.as_ref().and_then(|p| resolve(c, &p.options, &c.map.project)) } else { None };
            let no_match = state.is_none() && add.is_empty() && project_option.is_none();
            Plan { no_match, change: Change { state, add_labels: add, remove_labels: remove, project_option } }
        }
    }
}

/// A mudança faz alguma diferença lá?
pub fn changes_something(remote: &Remote, ch: &Change) -> bool {
    ch.state.as_ref().is_some_and(|s| s.id != remote.state.id)
        || ch.add_labels.iter().any(|l| !remote.labels.contains(l))
        || ch.remove_labels.iter().any(|l| remote.labels.contains(l))
        || match (&remote.project, &ch.project_option) {
            (Some(p), Some(o)) => p.option.as_ref().map(|x| &x.id) != Some(&o.id),
            _ => false,
        }
}

/// Para onde o card vai quando a issue está em `remote` (`None` = fica onde está).
pub fn reverse(board: &Board, current: &str, tracker: TrackerKind, remote: &Remote) -> Option<String> {
    let cur = board.index_of(current);
    let pick = |cands: Vec<usize>| -> Option<Option<String>> {
        if cands.is_empty() {
            return None;
        }
        Some(if cands.contains(&cur) { None } else { Some(board.columns[cands[0]].id.clone()) })
    };
    let all = 0..board.columns.len();
    match tracker {
        TrackerKind::Linear => pick(all.filter(|&i| resolve(&board.columns[i], &remote.states, &board.columns[i].map.linear).is_some_and(|s| s.id == remote.state.id)).collect()).flatten(),
        TrackerKind::Github => {
            let by_state: Vec<usize> = all.clone().filter(|&i| resolve_github(&board.columns[i]).is_some_and(|s| s.id == remote.state.id)).collect();
            if board.github_projects {
                if let Some(opt) = remote.project.as_ref().and_then(|p| Some((p, p.option.as_ref()?))) {
                    let (p, o) = opt;
                    let by_project: Vec<usize> = all.clone().filter(|&i| resolve(&board.columns[i], &p.options, &board.columns[i].map.project).is_some_and(|s| s.id == o.id)).collect();
                    if let Some(r) = pick(by_project) {
                        return r;
                    }
                }
            }
            let by_label: Vec<usize> = by_state.iter().copied().filter(|&i| board.columns[i].map.github_label.as_ref().is_some_and(|l| remote.labels.contains(l))).collect();
            if let Some(r) = pick(by_label) {
                return r;
            }
            pick(by_state).flatten()
        }
    }
}

// ---------------- estado: quadro efetivo, salvar, mover ----------------

/// A issue do workspace: a vinculada, ou a do Linear de onde ele nasceu.
pub fn link_of(w: &Workspace) -> Option<IssueLink> {
    w.issue.clone().or_else(|| w.linear.as_ref().map(|l| IssueLink { tracker: TrackerKind::Linear, id: l.identifier.clone(), identifier: l.identifier.clone(), title: l.title.clone(), url: l.url.clone(), state: None, updated_at: None }))
}

pub fn global(st: &State) -> Board {
    st.board.clone().unwrap_or_default()
}

/// Quadro do repo: o próprio, se tiver; senão o global.
pub fn effective(st: &State, repo_id: &str) -> Board {
    st.repo_boards.get(repo_id).cloned().unwrap_or_else(|| global(st))
}

/// Tudo para a interface: o global, os dos repos que têm o próprio e os conjuntos de ícones e cores.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Config {
    pub global: Board,
    pub repos: BTreeMap<String, Board>,
    pub icons: Vec<String>,
    pub colors: Vec<String>,
}

pub fn config(st: &State) -> Config {
    Config { global: global(st), repos: st.repo_boards.clone(), icons: ICONS.iter().map(|s| s.to_string()).collect(), colors: COLORS.iter().map(|s| s.to_string()).collect() }
}

/// Grava o quadro global (`repo_id` vazio) ou o de um repo (`board` vazio = volta a herdar o global).
/// Cards em colunas que deixaram de existir vão para `reassign[coluna antiga]` ou para a primeira.
pub fn save(store: &mut Store, repo_id: Option<&str>, board: Option<Board>, reassign: &BTreeMap<String, String>) -> Result<Config> {
    let board = board.map(Board::validate).transpose()?;
    match (repo_id, board) {
        (None, b) => store.state.board = Some(b.unwrap_or_default()),
        (Some(r), Some(b)) => {
            store.repo(r)?;
            store.state.repo_boards.insert(r.to_string(), b);
        }
        (Some(r), None) => {
            store.state.repo_boards.remove(r);
        }
    }
    let st = &mut store.state;
    let inherits: std::collections::HashSet<String> = st.repos.iter().filter(|r| !st.repo_boards.contains_key(&r.id)).map(|r| r.id.clone()).collect();
    let boards: BTreeMap<String, Board> = st.repos.iter().map(|r| (r.id.clone(), st.repo_boards.get(&r.id).cloned().unwrap_or_else(|| st.board.clone().unwrap_or_default()))).collect();
    for w in st.workspaces.iter_mut() {
        let in_scope = match repo_id {
            Some(r) => w.repo_id == r,
            None => inherits.contains(&w.repo_id),
        };
        let Some(b) = boards.get(&w.repo_id).filter(|_| in_scope) else { continue };
        if !b.has(&w.status) {
            w.status = reassign.get(&w.status).filter(|t| b.has(t)).cloned().unwrap_or_else(|| b.columns[b.index_of(&w.status)].id.clone());
        }
    }
    store.save()?;
    Ok(config(&store.state))
}

/// Coisas do Kabul que movem o card sozinhas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoEvent {
    AgentStarted,
    PrOpened,
    PrMerged,
}

/// Coluna para onde o evento leva o card, se for para a frente.
pub fn auto_target(board: &Board, current: &str, ev: AutoEvent) -> Option<String> {
    if !board.auto.enabled {
        return None;
    }
    let t = match ev {
        AutoEvent::AgentStarted => &board.auto.agent_started,
        AutoEvent::PrOpened => &board.auto.pr_opened,
        AutoEvent::PrMerged => &board.auto.pr_merged,
    }
    .as_ref()?;
    let to = board.columns.iter().position(|c| &c.id == t)?;
    let at = board.columns.iter().position(|c| c.id == current);
    (at.is_none_or(|a| to > a)).then(|| t.clone())
}

/// Aplica o evento no estado (sem rede). `Some(coluna de antes)` se o card andou.
pub fn auto_move(store: &mut Store, ws_id: &str, ev: AutoEvent) -> Result<Option<String>> {
    let w = store.workspace(ws_id)?.clone();
    let b = effective(&store.state, &w.repo_id);
    let Some(to) = auto_target(&b, &w.status, ev) else { return Ok(None) };
    store.update_workspace(ws_id, |x| x.status = to)?;
    Ok(Some(w.status))
}

// ---------------- sincronia ----------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    /// A issue foi atualizada.
    Ok,
    /// Sincronia desligada.
    Off,
    /// Workspace sem issue vinculada.
    NoLink,
    /// A coluna não tem estado correspondente lá.
    NoMatch,
    /// Já estava no estado certo.
    Unchanged,
    /// Rastreador não conectado (sem chave do Linear, sem `gh`).
    NotConnected,
    Error,
}

/// Como a issue estava antes (para desfazer).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot {
    pub state: Option<RemoteState>,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub project_option: Option<RemoteState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncResult {
    pub status: SyncStatus,
    pub tracker: Option<TrackerKind>,
    pub issue: Option<String>,
    pub url: Option<String>,
    pub from: Option<RemoteState>,
    pub to: Option<RemoteState>,
    /// GitHub Projects: "Roadmap › Done".
    #[serde(default)]
    pub project: Option<String>,
    pub error: Option<String>,
    /// Antes da mudança (presente quando algo foi tentado lá).
    pub before: Option<Snapshot>,
}

impl SyncResult {
    fn bare(status: SyncStatus, link: Option<&IssueLink>) -> Self {
        Self { status, tracker: link.map(|l| l.tracker), issue: link.map(|l| l.identifier.clone()), url: link.map(|l| l.url.clone()).filter(|u| !u.is_empty()), from: None, to: None, project: None, error: None, before: None }
    }
}

fn snapshot(r: &Remote) -> Snapshot {
    Snapshot { state: Some(r.state.clone()), labels: r.labels.clone(), project_option: r.project.as_ref().and_then(|p| p.option.clone()) }
}

/// Mudança de volta para `snap` (só nas labels que o quadro administra).
fn restore_change(board: &Board, now: &Remote, snap: &Snapshot) -> Change {
    let managed = board.labels();
    Change {
        state: snap.state.clone(),
        add_labels: snap.labels.iter().filter(|l| managed.contains(l) && !now.labels.contains(l)).cloned().collect(),
        remove_labels: now.labels.iter().filter(|l| managed.contains(l) && !snap.labels.contains(l)).cloned().collect(),
        project_option: snap.project_option.clone(),
    }
}

/// Atualiza a issue para a coluna `idx` (ou de volta para `restore`). Devolve o resultado e como a
/// issue ficou.
pub fn sync(trackers: &Trackers, board: &Board, idx: usize, link: &IssueLink, restore: Option<&Snapshot>) -> (SyncResult, Option<Remote>) {
    let mut res = SyncResult::bare(SyncStatus::Off, Some(link));
    if !board.sync {
        return (res, None);
    }
    let t: &dyn IssueTracker = trackers.get(link.tracker);
    if !t.connected() {
        res.status = SyncStatus::NotConnected;
        return (res, None);
    }
    let projects = board.github_projects && link.tracker == TrackerKind::Github;
    let before = match t.fetch(link, projects) {
        Ok(r) => r,
        Err(e) => {
            res.status = SyncStatus::Error;
            res.error = Some(short_err(&e));
            return (res, None);
        }
    };
    res.from = Some(before.state.clone());
    let change = match restore {
        Some(s) => restore_change(board, &before, s),
        None => {
            let p = plan(board, idx, link.tracker, &before);
            if p.no_match {
                res.status = SyncStatus::NoMatch;
                return (res, Some(before));
            }
            p.change
        }
    };
    if !changes_something(&before, &change) {
        res.status = SyncStatus::Unchanged;
        res.to = Some(before.state.clone());
        return (res, Some(before));
    }
    res.before = Some(snapshot(&before));
    match t.apply(link, &before, &change) {
        Ok(after) => {
            res.status = SyncStatus::Ok;
            res.to = Some(after.state.clone());
            res.project = after.project.as_ref().and_then(|p| Some(format!("{} › {}", p.project_title, p.option.as_ref()?.name)));
            (res, Some(after))
        }
        Err(e) => {
            res.status = SyncStatus::Error;
            res.error = Some(short_err(&e));
            (res, None)
        }
    }
}

/// Grava no workspace o que se viu da issue (o chip do card e a base do polling).
fn remember(store: &SharedStore, ws_id: &str, link: &IssueLink, r: &Remote) {
    if let Ok(mut st) = store.lock() {
        let _ = st.update_workspace(ws_id, |w| {
            let mut l = link.clone();
            l.state = Some(r.state.clone());
            l.updated_at = Some(r.updated_at.clone());
            w.issue = Some(l);
        });
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MoveResult {
    pub workspace: Workspace,
    /// Coluna de onde o card saiu (o "Desfazer" volta para ela).
    pub from_column: String,
    pub sync: SyncResult,
}

/// Move o card (grava na hora) e, com a sincronia ligada, atualiza a issue sem segurar o estado
/// durante a rede. `restore`: o "Desfazer" devolve a issue exatamente como estava.
pub fn move_card(store: &SharedStore, trackers: &Trackers, ws_id: &str, column: &str, restore: Option<&Snapshot>) -> Result<MoveResult> {
    let (w, board, from) = {
        let mut st = store.lock().map_err(|_| anyhow::anyhow!("estado indisponível"))?;
        let w = st.workspace(ws_id)?.clone();
        let b = effective(&st.state, &w.repo_id);
        if !b.has(column) {
            bail!("coluna não existe neste quadro: {column}");
        }
        let w2 = st.update_workspace(ws_id, |x| x.status = column.to_string())?;
        (w2, b, w.status)
    };
    let Some(link) = link_of(&w) else {
        return Ok(MoveResult { workspace: w, from_column: from, sync: SyncResult::bare(SyncStatus::NoLink, None) });
    };
    let (res, after) = sync(trackers, &board, board.index_of(column), &link, restore);
    if let Some(r) = &after {
        remember(store, ws_id, &link, r);
    }
    let workspace = store.lock().ok().and_then(|s| s.workspace(ws_id).ok().cloned()).unwrap_or(w);
    Ok(MoveResult { workspace, from_column: from, sync: res })
}

/// "Tentar de novo": sincroniza a coluna atual.
pub fn sync_card(store: &SharedStore, trackers: &Trackers, ws_id: &str) -> Result<SyncResult> {
    let (w, board) = {
        let st = store.lock().map_err(|_| anyhow::anyhow!("estado indisponível"))?;
        let w = st.workspace(ws_id)?.clone();
        let b = effective(&st.state, &w.repo_id);
        (w, b)
    };
    let Some(link) = link_of(&w) else { return Ok(SyncResult::bare(SyncStatus::NoLink, None)) };
    let (res, after) = sync(trackers, &board, board.index_of(&w.status), &link, None);
    if let Some(r) = &after {
        remember(store, ws_id, &link, r);
    }
    Ok(res)
}

/// Evento do Kabul: move (só para a frente) e sincroniza. `None` se o card não andou.
pub fn on_event(store: &SharedStore, trackers: &Trackers, ws_id: &str, ev: AutoEvent) -> Option<MoveResult> {
    let to = {
        let st = store.lock().ok()?;
        let w = st.workspace(ws_id).ok()?;
        auto_target(&effective(&st.state, &w.repo_id), &w.status, ev)?
    };
    move_card(store, trackers, ws_id, &to, None).ok()
}

/// Vincula (ou desvincula, com `input` vazio) uma issue ao workspace.
pub fn link_issue(store: &SharedStore, trackers: &Trackers, ws_id: &str, input: &str) -> Result<Workspace> {
    let input = input.trim();
    if input.is_empty() {
        let mut st = store.lock().map_err(|_| anyhow::anyhow!("estado indisponível"))?;
        return st.update_workspace(ws_id, |w| {
            w.issue = None;
            w.linear = None;
        });
    }
    let repo_path = {
        let st = store.lock().map_err(|_| anyhow::anyhow!("estado indisponível"))?;
        let w = st.workspace(ws_id)?;
        st.repo(&w.repo_id)?.path.clone()
    };
    let slug = crate::shell::command("git").arg("-C").arg(&repo_path).args(["remote", "get-url", "origin"]).output().ok().filter(|o| o.status.success()).and_then(|o| crate::github::slug_from_remote(String::from_utf8_lossy(&o.stdout).trim()));
    let link = trackers.lookup(input, slug.as_deref())?.context("cole a URL da issue (GitHub ou Linear), owner/repo#12, #12 ou ENG-12")?;
    let mut st = store.lock().map_err(|_| anyhow::anyhow!("estado indisponível"))?;
    st.update_workspace(ws_id, |w| {
        if link.tracker == TrackerKind::Linear {
            w.linear = Some(crate::store::LinearLink { identifier: link.identifier.clone(), title: link.title.clone(), url: link.url.clone() });
        } else {
            w.linear = None;
        }
        w.issue = Some(link);
    })
}

/// Card que o polling moveu.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Moved {
    pub workspace_id: String,
    pub issue: String,
    pub tracker: TrackerKind,
    pub from: String,
    pub to: String,
    pub state: String,
}

/// Uma rodada do polling: lê as issues dos workspaces com a sincronia inversa ligada e move os cards
/// cuja issue mudou lá (pelo `updatedAt`; a primeira leitura só guarda a base). Não segura o estado
/// durante a rede.
pub fn poll_once(store: &SharedStore, trackers: &Trackers) -> Vec<Moved> {
    let todo: Vec<(Workspace, Board, IssueLink)> = {
        let Ok(st) = store.lock() else { return vec![] };
        st.state
            .workspaces
            .iter()
            .filter(|w| !w.archived)
            .filter_map(|w| {
                let b = effective(&st.state, &w.repo_id);
                (b.reverse_sync).then_some(())?;
                Some((w.clone(), b, link_of(w)?))
            })
            .collect()
    };
    let mut moved = vec![];
    for kind in [TrackerKind::Linear, TrackerKind::Github] {
        let t = trackers.get(kind);
        let group: Vec<&(Workspace, Board, IssueLink)> = todo.iter().filter(|(_, _, l)| l.tracker == kind).collect();
        if group.is_empty() || !t.connected() {
            continue;
        }
        let projects = group.iter().any(|(_, b, _)| b.github_projects);
        let links: Vec<IssueLink> = group.iter().map(|(_, _, l)| l.clone()).collect();
        for ((w, b, l), r) in group.into_iter().zip(t.poll(&links, projects)) {
            let Ok(r) = r else { continue };
            if l.updated_at.as_deref() == Some(r.updated_at.as_str()) {
                continue;
            }
            let first = l.updated_at.is_none();
            let Ok(mut st) = store.lock() else { continue };
            let Ok(cur) = st.workspace(&w.id).map(|x| x.status.clone()) else { continue };
            let to = if first { None } else { reverse(b, &cur, kind, &r) };
            let _ = st.update_workspace(&w.id, |x| {
                let mut nl = l.clone();
                nl.state = Some(r.state.clone());
                nl.updated_at = Some(r.updated_at.clone());
                x.issue = Some(nl);
                if let Some(t) = &to {
                    x.status = t.clone();
                }
            });
            if let Some(t) = to {
                moved.push(Moved { workspace_id: w.id.clone(), issue: l.identifier.clone(), tracker: kind, from: cur, to: t, state: r.state.name.clone() });
            }
        }
    }
    moved
}

/// Mapeamento de cada coluna num fluxo de lá (para o popover mostrar "→ In Progress" ou
/// "sem correspondência").
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Preview {
    pub tracker: TrackerKind,
    /// Time do Linear (`ENG`) ou "Issues".
    pub workflow: String,
    pub states: Vec<RemoteState>,
    /// Alinhado com `board.columns`.
    pub columns: Vec<Option<RemoteState>>,
}

pub fn preview(board: &Board, tracker: TrackerKind, workflow: &str, states: &[RemoteState]) -> Preview {
    let columns = board
        .columns
        .iter()
        .map(|c| match tracker {
            TrackerKind::Linear => resolve(c, states, &c.map.linear),
            TrackerKind::Github => resolve_github(c),
        })
        .collect();
    Preview { tracker, workflow: workflow.into(), states: states.to_vec(), columns }
}

/// Prévias de todos os rastreadores (o Linear só se estiver conectado; erros de lá vão juntos).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Previews {
    pub previews: Vec<Preview>,
    pub linear_connected: bool,
    pub github_connected: bool,
    pub errors: Vec<String>,
}

pub fn previews(trackers: &Trackers, board: &Board) -> Previews {
    let mut out = Previews { previews: vec![], linear_connected: trackers.linear.connected(), github_connected: trackers.github.connected(), errors: vec![] };
    for kind in [TrackerKind::Linear, TrackerKind::Github] {
        let t = trackers.get(kind);
        if !t.connected() {
            continue;
        }
        match t.workflows() {
            Ok(w) => out.previews.extend(w.iter().map(|(name, st)| preview(board, kind, name, st))),
            Err(e) => out.errors.push(format!("{}: {}", kind.label(), short_err(&e))),
        }
    }
    out
}

// ---------------- migração do state.json ----------------

/// `state.json` v1 -> v2: o quadro ganha as colunas padrão (ids = status de antes); se algum
/// workspace estava "cancelado", a coluna Canceled continua existindo.
pub fn migrate_state_v2(doc: &mut serde_json::Value) -> Result<()> {
    if doc.get("board").is_some_and(|b| b.is_object()) {
        return Ok(());
    }
    let mut b = Board::default();
    let canceled = doc.get("workspaces").and_then(|w| w.as_array()).is_some_and(|ws| ws.iter().any(|w| w.get("status").and_then(|s| s.as_str()) == Some("canceled")));
    if canceled {
        b.columns.push(canceled_column());
    }
    doc["board"] = serde_json::to_value(b)?;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use crate::tracker::github::tests::FakeGh;
    use crate::tracker::github::GithubTracker;
    use crate::tracker::linear::tests::{issue_json, Recorded};
    use crate::tracker::linear::{parse_remote, LinearTracker};
    use serde_json::json;
    use std::sync::Arc;

    fn linear_remote(state: (&str, &str, &str)) -> Remote {
        parse_remote(&issue_json(state, "t1")).unwrap()
    }

    fn names(b: &Board, states: &[RemoteState]) -> Vec<Option<String>> {
        b.columns.iter().map(|c| resolve(c, states, &c.map.linear).map(|s| s.name)).collect()
    }

    #[test]
    fn padrao_casa_com_o_fluxo_do_linear() {
        let r = linear_remote(("s-todo", "Todo", "unstarted"));
        assert_eq!(names(&Board::default(), &r.states), [Some("Todo".into()), Some("In Progress".into()), Some("In Review".into()), Some("Done".into())]);
    }

    #[test]
    fn nomes_em_portugues_e_tipos() {
        let mut b = Board::default();
        b.columns = vec![
            col("a", "A fazer", "star", "gray"),
            col("b", "Em andamento", "star", "gray"),
            col("c", "Em revisão", "star", "gray"),
            col("d", "Concluído", "star", "gray"),
            col("e", "Bloqueado", "blocked", "red"),
            col("f", "Lixo", "canceled", "gray"),
        ];
        let r = linear_remote(("s-todo", "Todo", "unstarted"));
        assert_eq!(names(&b, &r.states), [Some("Todo".into()), Some("In Progress".into()), Some("In Review".into()), Some("Done".into()), None, Some("Canceled".into())]);
    }

    #[test]
    fn revisao_sem_estado_proprio_cai_em_andamento_e_override() {
        let states: Vec<RemoteState> = linear_remote(("s-todo", "Todo", "unstarted")).states.into_iter().filter(|s| s.name != "In Review").collect();
        let mut b = Board::default();
        assert_eq!(names(&b, &states)[2].as_deref(), Some("In Progress"));
        b.columns[2].map.linear = Override::Off;
        b.columns[0].map.linear = Override::State("backlog".into());
        b.columns[3].map.linear = Override::State("Shipped".into());
        assert_eq!(names(&b, &states), [Some("Backlog".into()), Some("In Progress".into()), None, None], "fixado por nome (sem diferenciar maiúsculas); estado que não existe = sem correspondência");
    }

    #[test]
    fn github_aberta_fechada_e_labels() {
        let mut b = Board::default();
        b.columns.push(canceled_column());
        assert_eq!(b.columns.iter().map(|c| resolve_github(c).unwrap().id).collect::<Vec<_>>(), ["open", "open", "open", "closed", "not_planned"]);
        b.columns[2].map.github_label = Some("in review".into());
        b.columns[1].map.github_label = Some("wip".into());
        let (open, _, _) = crate::tracker::github::parse_view(&crate::tracker::github::tests::view_json("OPEN", None, &["wip"], "t")).unwrap();
        let p = plan(&b, 2, TrackerKind::Github, &open);
        assert_eq!((p.change.state.as_ref().unwrap().id.as_str(), p.change.add_labels.clone(), p.change.remove_labels.clone()), ("open", vec!["in review".to_string()], vec!["wip".to_string()]));
        assert!(changes_something(&open, &p.change));
        // Reverso: aberta com a label "in review" -> coluna In review; aberta sem label -> fica onde está.
        let (mut r, _, _) = crate::tracker::github::parse_view(&crate::tracker::github::tests::view_json("OPEN", None, &["in review"], "t")).unwrap();
        assert_eq!(reverse(&b, "done", TrackerKind::Github, &r).as_deref(), Some("in-review"));
        r.labels.clear();
        assert_eq!(reverse(&b, "in-progress", TrackerKind::Github, &r), None);
        assert_eq!(reverse(&b, "done", TrackerKind::Github, &r).as_deref(), Some("backlog"), "reaberta: volta para a primeira coluna aberta");
        b.columns[0].map.github = Override::Off;
        b.columns[1].map.github = Override::Off;
        b.columns[1].map.github_label = None;
        assert!(plan(&b, 1, TrackerKind::Github, &r).no_match);
    }

    #[test]
    fn github_projects_status() {
        let mut b = Board::default();
        b.github_projects = true;
        let (mut r, _, _) = crate::tracker::github::parse_view(&crate::tracker::github::tests::view_json("OPEN", None, &[], "t")).unwrap();
        r.project = crate::tracker::github::parse_project(&crate::tracker::github::tests::project_json(Some("o1")));
        let p = plan(&b, 1, TrackerKind::Github, &r);
        assert_eq!(p.change.project_option.unwrap().name, "In Progress");
        // Review sem opção própria no projeto: cai em In Progress.
        assert_eq!(plan(&b, 2, TrackerKind::Github, &r).change.project_option.unwrap().name, "In Progress");
        // Reverso pelo projeto: opção Done -> Done (mesmo aberta).
        r.project.as_mut().unwrap().option = r.project.as_ref().unwrap().options.iter().find(|o| o.name == "Done").cloned();
        assert_eq!(reverse(&b, "in-progress", TrackerKind::Github, &r).as_deref(), Some("done"));
    }

    #[test]
    fn reverso_linear() {
        let b = Board::default();
        assert_eq!(reverse(&b, "backlog", TrackerKind::Linear, &linear_remote(("s-done", "Done", "completed"))).as_deref(), Some("done"));
        assert_eq!(reverse(&b, "in-review", TrackerKind::Linear, &linear_remote(("s-rev", "In Review", "started"))), None, "já está lá");
        assert_eq!(reverse(&b, "backlog", TrackerKind::Linear, &linear_remote(("s-backlog", "Backlog", "backlog"))), None, "Backlog não tem coluna (Todo casa com Todo)");
        assert_eq!(reverse(&b, "done", TrackerKind::Linear, &linear_remote(("s-canc", "Canceled", "canceled"))), None, "sem coluna cancelada: fica");
    }

    #[test]
    fn eventos_so_andam_para_a_frente() {
        let mut b = Board::default();
        assert_eq!(auto_target(&b, "backlog", AutoEvent::AgentStarted).as_deref(), Some("in-progress"));
        assert_eq!(auto_target(&b, "in-review", AutoEvent::AgentStarted), None);
        assert_eq!(auto_target(&b, "in-progress", AutoEvent::PrOpened).as_deref(), Some("in-review"));
        assert_eq!(auto_target(&b, "in-review", AutoEvent::PrMerged).as_deref(), Some("done"));
        assert_eq!(auto_target(&b, "done", AutoEvent::PrMerged), None);
        b.columns.push(canceled_column());
        assert_eq!(auto_target(&b, "canceled", AutoEvent::PrMerged), None, "cancelado não volta para concluído");
        b.auto.enabled = false;
        assert_eq!(auto_target(&b, "backlog", AutoEvent::AgentStarted), None);
    }

    #[test]
    fn validacao() {
        let mut b = Board::default();
        b.columns[0].name = "  Fila \u{7}  ".into();
        b.columns[0].icon = "<script>".into();
        b.columns[0].color = "#fff".into();
        b.auto.pr_merged = Some("nao-existe".into());
        let v = b.clone().validate().unwrap();
        assert_eq!((v.columns[0].name.as_str(), v.columns[0].icon.as_str(), v.columns[0].color.as_str(), v.auto.pr_merged.clone()), ("Fila", "todo", "gray", None));
        let mut d = Board::default();
        d.columns[1].id = "backlog".into();
        assert!(d.validate().is_err(), "id repetido");
        let mut e = Board::default();
        e.columns.clear();
        assert!(e.validate().is_err());
        let mut f = Board::default();
        f.columns[0].name = "   ".into();
        assert!(f.validate().is_err());
        let mut g = Board::default();
        g.columns[0].map.github = Override::State("merged".into());
        assert!(g.validate().is_err());
        let mut h = Board::default();
        h.columns[0].id = "a b".into();
        assert!(h.validate().is_err());
    }

    #[test]
    fn migracao_v1_vira_colunas_padrao() {
        let mut d = json!({"schema_version": 1, "repos": [], "workspaces": [{"id": "w", "status": "in-review"}]});
        crate::schema::migrate(&mut d, crate::schema::STATE, crate::schema::STATE_MIGRATIONS).unwrap();
        assert_eq!(d["schema_version"], 2);
        let b: Board = serde_json::from_value(d["board"].clone()).unwrap();
        assert_eq!(b.columns.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["backlog", "in-progress", "in-review", "done"]);
        assert_eq!(b.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Todo", "In progress", "In review", "Done"]);
        assert!(!b.sync && b.auto.enabled);
        // Alguém cancelado: a coluna continua.
        let mut d = json!({"repos": [], "workspaces": [{"id": "w", "status": "canceled"}]});
        crate::schema::migrate(&mut d, crate::schema::STATE, crate::schema::STATE_MIGRATIONS).unwrap();
        assert_eq!(d["board"]["columns"][4]["id"], "canceled");
        // Já tinha quadro: não mexe.
        let mut d = json!({"schema_version": 1, "repos": [], "workspaces": [], "board": {"columns": [{"id": "x", "name": "X"}]}});
        crate::schema::migrate(&mut d, crate::schema::STATE, crate::schema::STATE_MIGRATIONS).unwrap();
        assert_eq!(d["board"]["columns"][0]["id"], "x");
    }

    // ---------- com Store e rastreadores de mentira ----------

    fn tmp_store(name: &str) -> (SharedStore, std::path::PathBuf) {
        let d = std::env::temp_dir().join(format!("kabul-board-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let mut s = Store::open(d.join("state.json"), d.join("ws"), "dev".into()).unwrap();
        s.state.repos.push(crate::store::Repo { id: "r1".into(), name: "web".into(), path: d.display().to_string(), default_branch: "main".into(), ..Default::default() });
        s.state.repos.push(crate::store::Repo { id: "r2".into(), name: "api".into(), path: d.display().to_string(), default_branch: "main".into(), ..Default::default() });
        for (id, repo, status) in [("w1", "r1", "backlog"), ("w2", "r1", "in-review"), ("w3", "r2", "in-review")] {
            s.state.workspaces.push(Workspace { id: id.into(), repo_id: repo.into(), name: id.into(), status: status.into(), ..Default::default() });
        }
        s.save().unwrap();
        (SharedStore::new(s), d)
    }

    fn trackers(linear: Arc<Recorded>, gh: Arc<FakeGh>) -> Trackers {
        Trackers { linear: Box::new(LinearTracker::new(Box::new(linear))), github: Box::new(GithubTracker::new(Box::new(gh))) }
    }

    #[test]
    fn salvar_apaga_coluna_e_reatribui_cards() {
        let (store, d) = tmp_store("salvar");
        let mut b = Board::default();
        b.columns.remove(2); // In review
        let mut st = store.lock().unwrap();
        let re = BTreeMap::from([("in-review".to_string(), "done".to_string())]);
        save(&mut st, None, Some(b.clone()), &re).unwrap();
        let s = |st: &Store, id: &str| st.workspace(id).unwrap().status.clone();
        assert_eq!((s(&st, "w1"), s(&st, "w2"), s(&st, "w3")), ("backlog".into(), "done".into(), "done".into()));
        // Repo com o próprio quadro: só os cards dele.
        let mut own = Board::default();
        own.columns = vec![col("fila", "Fila", "todo", "blue"), col("feito", "Feito", "done", "green")];
        save(&mut st, Some("r2"), Some(own), &BTreeMap::new()).unwrap();
        assert_eq!((s(&st, "w2"), s(&st, "w3")), ("done".into(), "feito".into()), "só o repo r2; 'done' vira 'Feito' pelo tipo");
        // Volta a herdar.
        let cfg = save(&mut st, Some("r2"), None, &BTreeMap::new()).unwrap();
        assert!(cfg.repos.is_empty());
        assert!(save(&mut st, Some("nao-existe"), Some(Board::default()), &BTreeMap::new()).is_err());
        drop(st);
        // Persistiu (relendo do disco).
        let again = Store::open(d.join("state.json"), d.join("ws"), "dev".into()).unwrap();
        assert_eq!(again.state.board.as_ref().unwrap().columns.len(), 3);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn mover_card_atualiza_o_linear_e_desfaz() {
        let (store, d) = tmp_store("mover");
        {
            let mut st = store.lock().unwrap();
            let mut b = Board::default();
            b.sync = true;
            save(&mut st, None, Some(b), &BTreeMap::new()).unwrap();
            st.update_workspace("w1", |w| w.issue = Some(crate::tracker::linear::tests::link())).unwrap();
        }
        let lin = Arc::new(Recorded::new(vec![
            ("issue(id", Ok(json!({"issue": issue_json(("s-todo", "Todo", "unstarted"), "t1")}))),
            ("issueUpdate", Ok(json!({"issueUpdate": {"success": true, "issue": issue_json(("s-prog", "In Progress", "started"), "t2")}}))),
        ]));
        let tr = trackers(lin.clone(), Arc::new(FakeGh::default()));
        let r = move_card(&store, &tr, "w1", "in-progress", None).unwrap();
        assert_eq!((r.from_column.as_str(), r.sync.status, r.sync.to.as_ref().unwrap().name.as_str()), ("backlog", SyncStatus::Ok, "In Progress"));
        assert_eq!(r.workspace.issue.as_ref().unwrap().updated_at.as_deref(), Some("t2"), "guarda a base do polling");
        let before = r.sync.before.clone().unwrap();
        assert_eq!(before.state.as_ref().unwrap().name, "Todo");
        // Desfazer: volta a coluna e o estado de antes (pelo id).
        *lin.replies.lock().unwrap() =
            vec![("issue(id", Ok(json!({"issue": issue_json(("s-prog", "In Progress", "started"), "t2")}))), ("issueUpdate", Ok(json!({"issueUpdate": {"success": true, "issue": issue_json(("s-todo", "Todo", "unstarted"), "t3")}})))];
        let u = move_card(&store, &tr, "w1", &r.from_column, Some(&before)).unwrap();
        assert_eq!((u.workspace.status.as_str(), u.sync.status, u.sync.to.unwrap().name.as_str()), ("backlog", SyncStatus::Ok, "Todo"));
        assert_eq!(lin.calls.lock().unwrap().last().unwrap().1["s"], "s-todo");
        // Coluna que não existe: erro, nada muda.
        assert!(move_card(&store, &tr, "w1", "x", None).is_err());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn sem_correspondencia_erro_desligado_e_sem_vinculo() {
        let (store, d) = tmp_store("casos");
        {
            let mut st = store.lock().unwrap();
            let mut b = Board::default();
            b.sync = true;
            b.columns[2].map.linear = Override::Off;
            save(&mut st, None, Some(b), &BTreeMap::new()).unwrap();
            st.update_workspace("w1", |w| w.issue = Some(crate::tracker::linear::tests::link())).unwrap();
        }
        let lin = Arc::new(Recorded::new(vec![
            ("issue(id", Ok(json!({"issue": issue_json(("s-todo", "Todo", "unstarted"), "t1")}))),
            ("issue(id", Ok(json!({"issue": issue_json(("s-todo", "Todo", "unstarted"), "t1")}))),
            ("issueUpdate", Err("Linear: You don't have permission".into())),
        ]));
        let tr = trackers(lin.clone(), Arc::new(FakeGh::default()));
        let r = move_card(&store, &tr, "w1", "in-review", None).unwrap();
        assert_eq!((r.workspace.status.as_str(), r.sync.status), ("in-review", SyncStatus::NoMatch), "o card anda mesmo sem correspondência");
        let r = move_card(&store, &tr, "w1", "done", None).unwrap();
        assert_eq!(r.sync.status, SyncStatus::Error);
        assert!(r.sync.error.as_deref().unwrap().contains("permission") && r.sync.before.is_some());
        assert_eq!(move_card(&store, &tr, "w2", "done", None).unwrap().sync.status, SyncStatus::NoLink);
        {
            let mut st = store.lock().unwrap();
            save(&mut st, None, Some(Board::default()), &BTreeMap::new()).unwrap();
        }
        assert_eq!(move_card(&store, &tr, "w1", "in-progress", None).unwrap().sync.status, SyncStatus::Off);
        let mut off = Recorded::new(vec![]);
        off.connected = false;
        {
            let mut st = store.lock().unwrap();
            let mut b = Board::default();
            b.sync = true;
            save(&mut st, None, Some(b), &BTreeMap::new()).unwrap();
        }
        let tr2 = trackers(Arc::new(off), Arc::new(FakeGh::default()));
        assert_eq!(move_card(&store, &tr2, "w1", "done", None).unwrap().sync.status, SyncStatus::NotConnected);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn github_issue_fecha_ao_concluir() {
        let (store, d) = tmp_store("gh");
        {
            let mut st = store.lock().unwrap();
            let mut b = Board::default();
            b.sync = true;
            save(&mut st, None, Some(b), &BTreeMap::new()).unwrap();
            st.update_workspace("w2", |w| w.issue = Some(crate::tracker::github::tests::link())).unwrap();
        }
        use crate::tracker::github::tests::view_json;
        let gh = Arc::new(FakeGh::default());
        *gh.replies.lock().unwrap() = vec![("issue view 12", Ok(view_json("OPEN", None, &[], "t1"))), ("issue close 12 -R acme/web --reason completed", Ok(String::new())), ("issue view 12", Ok(view_json("CLOSED", Some("COMPLETED"), &[], "t2")))];
        let tr = trackers(Arc::new(Recorded::new(vec![])), gh.clone());
        let r = move_card(&store, &tr, "w2", "done", None).unwrap();
        assert_eq!((r.sync.status, r.sync.to.unwrap().id.as_str(), r.sync.issue.as_deref()), (SyncStatus::Ok, "closed", Some("#12")));
        // Já fechada e o card vai para outra coluna "fechada": nada a fazer lá.
        *gh.replies.lock().unwrap() = vec![("issue view 12", Ok(view_json("CLOSED", Some("COMPLETED"), &[], "t2")))];
        assert_eq!(sync_card(&store, &tr, "w2").unwrap().status, SyncStatus::Unchanged);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn polling_move_o_card_quando_a_issue_muda_la() {
        let (store, d) = tmp_store("poll");
        {
            let mut st = store.lock().unwrap();
            let mut b = Board::default();
            b.reverse_sync = true;
            save(&mut st, None, Some(b), &BTreeMap::new()).unwrap();
            st.update_workspace("w1", |w| w.issue = Some(crate::tracker::linear::tests::link())).unwrap();
        }
        let lin = Arc::new(Recorded::new(vec![("a0: issue", Ok(json!({"a0": issue_json(("s-done", "Done", "completed"), "t1")})))]));
        let tr = trackers(lin.clone(), Arc::new(FakeGh::default()));
        // Primeira leitura: só guarda a base (não sabe se mudou).
        assert!(poll_once(&store, &tr).is_empty());
        assert_eq!(store.lock().unwrap().workspace("w1").unwrap().status, "backlog");
        // Mesmo updatedAt: nada.
        *lin.replies.lock().unwrap() = vec![("a0: issue", Ok(json!({"a0": issue_json(("s-done", "Done", "completed"), "t1")})))];
        assert!(poll_once(&store, &tr).is_empty());
        // Mudou lá: o card acompanha.
        *lin.replies.lock().unwrap() = vec![("a0: issue", Ok(json!({"a0": issue_json(("s-rev", "In Review", "started"), "t5")})))];
        let m = poll_once(&store, &tr);
        assert_eq!((m.len(), m[0].to.as_str(), m[0].state.as_str()), (1, "in-review", "In Review"));
        assert_eq!(store.lock().unwrap().workspace("w1").unwrap().status, "in-review");
        // Desligado: nem consulta.
        {
            let mut st = store.lock().unwrap();
            save(&mut st, None, Some(Board::default()), &BTreeMap::new()).unwrap();
        }
        let n = lin.calls.lock().unwrap().len();
        assert!(poll_once(&store, &tr).is_empty());
        assert_eq!(lin.calls.lock().unwrap().len(), n);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn evento_move_e_sincroniza() {
        let (store, d) = tmp_store("evento");
        let tr = trackers(Arc::new(Recorded::new(vec![])), Arc::new(FakeGh::default()));
        let m = on_event(&store, &tr, "w1", AutoEvent::AgentStarted).unwrap();
        assert_eq!((m.workspace.status.as_str(), m.sync.status), ("in-progress", SyncStatus::NoLink));
        assert!(on_event(&store, &tr, "w2", AutoEvent::AgentStarted).is_none(), "em revisão não volta");
        assert_eq!(on_event(&store, &tr, "w2", AutoEvent::PrMerged).unwrap().workspace.status, "done");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn previa_do_mapeamento() {
        let r = linear_remote(("s-todo", "Todo", "unstarted"));
        let mut b = Board::default();
        b.columns.push(col("x", "Bloqueado", "blocked", "red"));
        let p = preview(&b, TrackerKind::Linear, "ENG", &r.states);
        assert_eq!(p.columns.iter().map(|s| s.as_ref().map(|s| s.name.as_str())).collect::<Vec<_>>(), [Some("Todo"), Some("In Progress"), Some("In Review"), Some("Done"), None]);
        let g = preview(&b, TrackerKind::Github, "Issues", &crate::tracker::github::states());
        assert_eq!(g.columns[3].as_ref().unwrap().id, "closed");
    }
}
