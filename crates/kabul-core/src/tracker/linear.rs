//! Linear: estado da issue e estados do time pelo GraphQL; mudança por `issueUpdate(stateId)`.
use super::{Change, IssueLink, IssueTracker, Remote, RemoteState, StateKind, TrackerKind};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

/// Transporte do GraphQL (o real usa a chave do cofre; os testes, respostas gravadas).
pub trait Gql: Send + Sync {
    fn connected(&self) -> bool;
    fn post(&self, query: &str, vars: Value) -> Result<Value>;
}

/// api.linear.app com a chave do cofre (no cabeçalho, nunca na linha de comando).
pub struct Http;

impl Gql for Http {
    fn connected(&self) -> bool {
        crate::linear::get_key().is_some()
    }
    fn post(&self, query: &str, vars: Value) -> Result<Value> {
        crate::linear::gql(query, vars)
    }
}

const FIELDS: &str = "id identifier title url updatedAt labels { nodes { name } } state { id name type color } team { states { nodes { id name type color position } } }";

pub struct LinearTracker {
    gql: Box<dyn Gql>,
    /// Guarda os fluxos dos times por 2 min (o popover pede a prévia a cada mudança de coluna).
    cache: bool,
}

/// Fluxos dos times (a prévia do mapeamento); mudam pouco.
static WORKFLOWS: crate::cache::TtlCache<Vec<(String, Vec<RemoteState>)>> = crate::cache::TtlCache::new(4);

impl LinearTracker {
    pub fn new(gql: Box<dyn Gql>) -> Self {
        Self { gql, cache: false }
    }

    /// Com cache dos fluxos (o real).
    pub fn cached(gql: Box<dyn Gql>) -> Self {
        Self { gql, cache: true }
    }

    fn fetch_workflows(&self) -> Result<Vec<(String, Vec<RemoteState>)>> {
        let d = self.gql.post("query { teams(first: 20) { nodes { key states { nodes { id name type color position } } } } }", json!({}))?;
        Ok(d.pointer("/teams/nodes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|t| {
                let mut st: Vec<(f64, RemoteState)> = t.pointer("/states/nodes")?.as_array()?.iter().filter_map(|s| Some((s.get("position").and_then(Value::as_f64).unwrap_or(0.0), state(s)?))).collect();
                st.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                Some((t.get("key")?.as_str()?.to_string(), st.into_iter().map(|(_, s)| s).collect()))
            })
            .collect())
    }
}

fn state(v: &Value) -> Option<RemoteState> {
    Some(RemoteState { id: v.get("id")?.as_str()?.into(), name: v.get("name")?.as_str()?.into(), kind: StateKind::parse(v.get("type").and_then(Value::as_str).unwrap_or(""))?, color: v.get("color").and_then(Value::as_str).map(String::from) })
}

/// Lê o nó `issue` da resposta.
pub fn parse_remote(n: &Value) -> Option<Remote> {
    let mut states: Vec<(f64, RemoteState)> = n.pointer("/team/states/nodes").and_then(Value::as_array).into_iter().flatten().filter_map(|s| Some((s.get("position").and_then(Value::as_f64).unwrap_or(0.0), state(s)?))).collect();
    states.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    Some(Remote {
        state: state(n.get("state")?)?,
        states: states.into_iter().map(|(_, s)| s).collect(),
        updated_at: n.get("updatedAt").and_then(Value::as_str).unwrap_or("").into(),
        labels: n.pointer("/labels/nodes").and_then(Value::as_array).into_iter().flatten().filter_map(|l| l.get("name").and_then(Value::as_str).map(String::from)).collect(),
        project: None,
    })
}

/// `ENG-12` (time + número), de um identificador solto ou de uma URL `linear.app/<org>/issue/ENG-12/...`.
pub fn parse_identifier(input: &str) -> Option<String> {
    let s = input.trim();
    let cand = match s.split_once("linear.app/") {
        Some((_, rest)) => rest.split('/').skip_while(|p| *p != "issue").nth(1)?,
        None => s,
    };
    let (team, num) = cand.split_once('-')?;
    let ok = !team.is_empty() && team.len() <= 10 && team.chars().next()?.is_ascii_alphabetic() && team.chars().all(|c| c.is_ascii_alphanumeric()) && !num.is_empty() && num.len() <= 9 && num.chars().all(|c| c.is_ascii_digit());
    ok.then(|| format!("{}-{num}", team.to_ascii_uppercase()))
}

/// Id aceito no GraphQL: UUID ou `ENG-12`. Recusa qualquer outra coisa (vai como variável, mas o
/// alias do polling também usa o índice, nunca o valor).
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

impl IssueTracker for LinearTracker {
    fn kind(&self) -> TrackerKind {
        TrackerKind::Linear
    }

    fn connected(&self) -> bool {
        self.gql.connected()
    }

    fn fetch(&self, link: &IssueLink, _projects: bool) -> Result<Remote> {
        if !valid_id(&link.id) {
            bail!("issue do Linear inválida: {}", link.identifier);
        }
        let d = self.gql.post(&format!("query($id: String!) {{ issue(id: $id) {{ {FIELDS} }} }}"), json!({ "id": link.id }))?;
        parse_remote(&d["issue"]).with_context(|| format!("{} não encontrada no Linear", link.identifier))
    }

    fn apply(&self, link: &IssueLink, before: &Remote, change: &Change) -> Result<Remote> {
        let Some(s) = &change.state else { return Ok(before.clone()) };
        if s.id == before.state.id {
            return Ok(before.clone());
        }
        let d = self.gql.post(&format!("mutation($id: String!, $s: String!) {{ issueUpdate(id: $id, input: {{ stateId: $s }}) {{ success issue {{ {FIELDS} }} }} }}"), json!({ "id": link.id, "s": s.id }))?;
        if d.pointer("/issueUpdate/success").and_then(Value::as_bool) != Some(true) {
            bail!("o Linear recusou a mudança de estado de {}", link.identifier);
        }
        parse_remote(&d["issueUpdate"]["issue"]).context("resposta inválida do Linear")
    }

    /// Uma requisição para todas (aliases `a0`, `a1`...); se ela falhar (uma issue apagada derruba a
    /// resposta inteira), cai para uma por uma.
    fn poll(&self, links: &[IssueLink], projects: bool) -> Vec<Result<Remote>> {
        let mut out = Vec::with_capacity(links.len());
        for chunk in links.chunks(40) {
            if chunk.iter().any(|l| !valid_id(&l.id)) {
                out.extend(chunk.iter().map(|l| self.fetch(l, projects)));
                continue;
            }
            let decl: Vec<String> = (0..chunk.len()).map(|i| format!("$i{i}: String!")).collect();
            let body: Vec<String> = (0..chunk.len()).map(|i| format!("a{i}: issue(id: $i{i}) {{ {FIELDS} }}")).collect();
            let vars: serde_json::Map<String, Value> = chunk.iter().enumerate().map(|(i, l)| (format!("i{i}"), json!(l.id))).collect();
            match self.gql.post(&format!("query({}) {{ {} }}", decl.join(", "), body.join(" ")), Value::Object(vars)) {
                Ok(d) => out.extend((0..chunk.len()).map(|i| parse_remote(&d[format!("a{i}")]).context("issue não encontrada no Linear"))),
                Err(_) => out.extend(chunk.iter().map(|l| self.fetch(l, projects))),
            }
        }
        out
    }

    fn lookup(&self, input: &str, _default_repo: Option<&str>) -> Result<Option<IssueLink>> {
        let Some(ident) = parse_identifier(input) else { return Ok(None) };
        if !self.connected() {
            bail!("conecte o Linear em Configurações › Integrações para vincular {ident}");
        }
        let d = self.gql.post(&format!("query($id: String!) {{ issue(id: $id) {{ {FIELDS} }} }}"), json!({ "id": ident }))?;
        let n = &d["issue"];
        let r = parse_remote(n).with_context(|| format!("{ident} não encontrada no Linear"))?;
        Ok(Some(IssueLink {
            tracker: TrackerKind::Linear,
            id: n.get("id").and_then(Value::as_str).unwrap_or(&ident).into(),
            identifier: n.get("identifier").and_then(Value::as_str).unwrap_or(&ident).into(),
            title: n.get("title").and_then(Value::as_str).unwrap_or("").into(),
            url: n.get("url").and_then(Value::as_str).unwrap_or("").into(),
            state: Some(r.state),
            updated_at: Some(r.updated_at),
        }))
    }

    fn workflows(&self) -> Result<Vec<(String, Vec<RemoteState>)>> {
        if !self.cache {
            return self.fetch_workflows();
        }
        WORKFLOWS.get_or("linear", std::time::Duration::from_secs(120), || self.fetch_workflows())
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Linear de mentira: responde pelo trecho da consulta e grava as chamadas (sem rede).
    pub struct Recorded {
        pub replies: Mutex<Vec<(&'static str, Result<Value, String>)>>,
        pub calls: Mutex<Vec<(String, Value)>>,
        pub connected: bool,
    }

    impl Recorded {
        pub fn new(replies: Vec<(&'static str, Result<Value, String>)>) -> Self {
            Self { replies: Mutex::new(replies), calls: Mutex::new(vec![]), connected: true }
        }
    }

    impl Gql for std::sync::Arc<Recorded> {
        fn connected(&self) -> bool {
            self.as_ref().connected()
        }
        fn post(&self, query: &str, vars: Value) -> Result<Value> {
            self.as_ref().post(query, vars)
        }
    }

    impl Gql for Recorded {
        fn connected(&self) -> bool {
            self.connected
        }
        fn post(&self, query: &str, vars: Value) -> Result<Value> {
            self.calls.lock().unwrap().push((query.to_string(), vars));
            let mut r = self.replies.lock().unwrap();
            let i = r.iter().position(|(k, _)| query.contains(k)).unwrap_or_else(|| panic!("consulta sem resposta gravada: {query}"));
            match r.remove(i).1 {
                Ok(v) => Ok(v),
                Err(e) => bail!("{e}"),
            }
        }
    }

    /// Resposta gravada do `issue` (formato da API, encurtado).
    pub fn issue_json(state: (&str, &str, &str), updated: &str) -> Value {
        json!({
            "id": "uuid-12", "identifier": "ENG-12", "title": "Corrigir login", "url": "https://linear.app/acme/issue/ENG-12/corrigir-login",
            "updatedAt": updated, "labels": {"nodes": [{"name": "bug"}]},
            "state": {"id": state.0, "name": state.1, "type": state.2, "color": "#f2c94c"},
            "team": {"states": {"nodes": [
                {"id": "s-done", "name": "Done", "type": "completed", "color": "#5e6ad2", "position": 4},
                {"id": "s-backlog", "name": "Backlog", "type": "backlog", "color": "#bec2c8", "position": 0},
                {"id": "s-todo", "name": "Todo", "type": "unstarted", "color": "#e2e2e2", "position": 1},
                {"id": "s-prog", "name": "In Progress", "type": "started", "color": "#f2c94c", "position": 2},
                {"id": "s-rev", "name": "In Review", "type": "started", "color": "#0f783c", "position": 3},
                {"id": "s-canc", "name": "Canceled", "type": "canceled", "color": "#95a2b3", "position": 5}
            ]}}
        })
    }

    pub fn link() -> IssueLink {
        IssueLink { tracker: TrackerKind::Linear, id: "uuid-12".into(), identifier: "ENG-12".into(), title: "Corrigir login".into(), url: String::new(), state: None, updated_at: None }
    }

    #[test]
    fn le_estado_e_estados_do_time_em_ordem() {
        let r = parse_remote(&issue_json(("s-todo", "Todo", "unstarted"), "2026-10-25T10:00:00Z")).unwrap();
        assert_eq!(r.state.name, "Todo");
        assert_eq!(r.states.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"]);
        assert_eq!(r.labels, ["bug"]);
    }

    #[test]
    fn muda_o_estado_com_issue_update() {
        let t = LinearTracker::new(Box::new(Recorded::new(vec![
            ("issue(id", Ok(json!({"issue": issue_json(("s-todo", "Todo", "unstarted"), "t1")}))),
            ("issueUpdate", Ok(json!({"issueUpdate": {"success": true, "issue": issue_json(("s-prog", "In Progress", "started"), "t2")}}))),
        ])));
        let before = t.fetch(&link(), false).unwrap();
        let to = before.states.iter().find(|s| s.name == "In Progress").unwrap().clone();
        let after = t.apply(&link(), &before, &Change { state: Some(to), ..Default::default() }).unwrap();
        assert_eq!((after.state.id.as_str(), after.updated_at.as_str()), ("s-prog", "t2"));
        // Mesmo estado: nenhuma chamada.
        assert_eq!(t.apply(&link(), &after, &Change { state: Some(after.state.clone()), ..Default::default() }).unwrap(), after);
    }

    #[test]
    fn mutacao_manda_ids_como_variaveis() {
        let g = std::sync::Arc::new(Recorded::new(vec![("issueUpdate", Ok(json!({"issueUpdate": {"success": true, "issue": issue_json(("s-done", "Done", "completed"), "t3")}})))]));
        let t = LinearTracker::new(Box::new(g.clone()));
        let before = parse_remote(&issue_json(("s-todo", "Todo", "unstarted"), "t1")).unwrap();
        let done = before.states.iter().find(|s| s.id == "s-done").cloned();
        t.apply(&link(), &before, &Change { state: done, ..Default::default() }).unwrap();
        let calls = g.calls.lock().unwrap();
        assert_eq!(calls[0].1, json!({"id": "uuid-12", "s": "s-done"}));
        assert!(!calls[0].0.contains("uuid-12") && !calls[0].0.contains("s-done"), "valores só nas variáveis");
    }

    #[test]
    fn erro_e_recusa_viram_erro() {
        let t = LinearTracker::new(Box::new(Recorded::new(vec![("issueUpdate", Ok(json!({"issueUpdate": {"success": false, "issue": null}}))), ("issueUpdate", Err("Linear: Entity not found".into()))])));
        let before = parse_remote(&issue_json(("s-todo", "Todo", "unstarted"), "t1")).unwrap();
        let ch = Change { state: before.states.iter().find(|s| s.id == "s-done").cloned(), ..Default::default() };
        assert!(t.apply(&link(), &before, &ch).unwrap_err().to_string().contains("recusou"));
        assert!(t.apply(&link(), &before, &ch).unwrap_err().to_string().contains("Entity not found"));
    }

    #[test]
    fn polling_junta_numa_requisicao_e_cai_para_uma_por_uma() {
        let g = Recorded::new(vec![("a1: issue", Ok(json!({"a0": issue_json(("s-todo", "Todo", "unstarted"), "t1"), "a1": issue_json(("s-done", "Done", "completed"), "t9")})))]);
        let t = LinearTracker::new(Box::new(g));
        let mut l2 = link();
        l2.id = "ENG-13".into();
        let r = t.poll(&[link(), l2.clone()], false);
        assert_eq!(r.iter().map(|x| x.as_ref().unwrap().state.name.clone()).collect::<Vec<_>>(), ["Todo", "Done"]);
        // Falhou junto: uma por uma.
        let g = Recorded::new(vec![("a1: issue", Err("Linear: Entity not found".into())), ("issue(id", Ok(json!({"issue": issue_json(("s-todo", "Todo", "unstarted"), "t1")}))), ("issue(id", Err("Linear: Entity not found".into()))]);
        let r = LinearTracker::new(Box::new(g)).poll(&[link(), l2], false);
        assert!(r[0].is_ok() && r[1].is_err());
    }

    #[test]
    fn fluxos_dos_times() {
        let t = LinearTracker::new(Box::new(Recorded::new(vec![(
            "teams",
            Ok(json!({"teams": {"nodes": [{"key": "ENG", "states": {"nodes": [{"id": "b", "name": "Done", "type": "completed", "position": 2}, {"id": "a", "name": "Todo", "type": "unstarted", "position": 1}]}}]}})),
        )])));
        let w = t.workflows().unwrap();
        assert_eq!((w[0].0.as_str(), w[0].1.iter().map(|s| s.name.as_str()).collect::<Vec<_>>()), ("ENG", vec!["Todo", "Done"]));
    }

    #[test]
    fn identificador_de_url_ou_texto() {
        assert_eq!(parse_identifier("https://linear.app/acme/issue/ENG-12/corrigir-login").as_deref(), Some("ENG-12"));
        assert_eq!(parse_identifier(" eng-7 ").as_deref(), Some("ENG-7"));
        for bad in ["#12", "acme/web#3", "ENG-", "-12", "ENG-1a", "https://github.com/a/b/issues/1", "a b-1"] {
            assert_eq!(parse_identifier(bad), None, "{bad}");
        }
        assert!(!valid_id("ENG-1\"){ x }") && valid_id("ENG-1") && valid_id("1f0c2e3a-aaaa-bbbb-cccc-0123456789ab"));
    }

    #[test]
    fn vincular_le_a_issue() {
        let t = LinearTracker::new(Box::new(Recorded::new(vec![("issue(id", Ok(json!({"issue": issue_json(("s-todo", "Todo", "unstarted"), "t1")})))])));
        let l = t.lookup("https://linear.app/acme/issue/ENG-12/x", None).unwrap().unwrap();
        assert_eq!((l.id.as_str(), l.identifier.as_str(), l.state.unwrap().name.as_str()), ("uuid-12", "ENG-12", "Todo"));
        assert!(t.lookup("#12", None).unwrap().is_none());
        let mut g = Recorded::new(vec![]);
        g.connected = false;
        assert!(LinearTracker::new(Box::new(g)).lookup("ENG-1", None).unwrap_err().to_string().contains("conecte o Linear"));
    }
}
