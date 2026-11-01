//! GitHub Issues pelo `gh` (aberta/fechada, motivo e labels) e o campo Status do GitHub Projects (v2)
//! por `gh api graphql`. A autenticação é a do `gh` (perfil ativo): nenhum token passa por aqui.
use super::{Change, IssueLink, IssueTracker, ProjectItem, Remote, RemoteState, StateKind, TrackerKind};
use anyhow::{bail, Context, Result};
use serde_json::Value;

/// Quem roda o `gh` (o real; nos testes, respostas gravadas).
pub trait GhRunner: Send + Sync {
    fn available(&self) -> bool;
    fn run(&self, args: &[String]) -> Result<String>;
}

pub struct GhCli;

impl GhRunner for GhCli {
    fn available(&self) -> bool {
        crate::harness::which("gh").is_some()
    }
    fn run(&self, args: &[String]) -> Result<String> {
        let gh = crate::harness::which("gh").context("GitHub CLI (gh) não encontrado")?;
        let o = crate::shell::command(gh).args(args).output().context("falha ao executar gh")?;
        if !o.status.success() {
            // Só o subcomando na mensagem (a consulta GraphQL e os valores ficam de fora).
            bail!("gh {}: {}", args.iter().take(2).cloned().collect::<Vec<_>>().join(" "), String::from_utf8_lossy(&o.stderr).trim());
        }
        Ok(String::from_utf8_lossy(&o.stdout).into_owned())
    }
}

pub struct GithubTracker {
    gh: Box<dyn GhRunner>,
}

impl GithubTracker {
    pub fn new(gh: Box<dyn GhRunner>) -> Self {
        Self { gh }
    }
}

/// Os três "estados" de uma issue do GitHub.
pub fn states() -> Vec<RemoteState> {
    vec![
        RemoteState { id: "open".into(), name: "Open".into(), kind: StateKind::Unstarted, color: Some("#1a7f37".into()) },
        RemoteState { id: "closed".into(), name: "Closed".into(), kind: StateKind::Completed, color: Some("#8250df".into()) },
        RemoteState { id: "not_planned".into(), name: "Closed as not planned".into(), kind: StateKind::Canceled, color: Some("#6e7781".into()) },
    ]
}

fn state_of(id: &str) -> RemoteState {
    states().into_iter().find(|s| s.id == id).unwrap_or_else(|| states().remove(0))
}

/// `owner/repo#12` -> (`owner/repo`, 12).
pub fn split_id(id: &str) -> Option<(String, u64)> {
    let (repo, n) = id.split_once('#')?;
    let (o, r) = repo.split_once('/')?;
    let ok = |s: &str| !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) && !s.starts_with(['-', '.']);
    (ok(o) && ok(r)).then_some(())?;
    Some((repo.to_string(), n.parse().ok().filter(|n| *n > 0)?))
}

/// `https://github.com/o/r/issues/12`, `o/r#12` ou `#12` (no repo do workspace) -> `o/r#12`.
pub fn parse_input(input: &str, default_repo: Option<&str>) -> Option<String> {
    let s = input.trim();
    let id = if let Some((_, rest)) = s.split_once("github.com/") {
        let p: Vec<&str> = rest.split(['/', '?', '#']).collect();
        (p.len() >= 4 && p[2] == "issues").then(|| format!("{}/{}#{}", p[0], p[1], p[3]))?
    } else if let Some(n) = s.strip_prefix('#') {
        format!("{}#{n}", default_repo?)
    } else if s.contains('#') && s.contains('/') {
        s.to_string()
    } else {
        return None;
    };
    split_id(&id).map(|(r, n)| format!("{r}#{n}"))
}

/// Resposta do `gh issue view --json ...`.
pub fn parse_view(json: &str) -> Option<(Remote, String, String)> {
    let v: Value = serde_json::from_str(json).ok()?;
    let closed = v.get("state")?.as_str()? == "CLOSED";
    let id = if !closed {
        "open"
    } else if v.get("stateReason").and_then(Value::as_str) == Some("NOT_PLANNED") {
        "not_planned"
    } else {
        "closed"
    };
    let remote = Remote {
        state: state_of(id),
        states: states(),
        updated_at: v.get("updatedAt").and_then(Value::as_str).unwrap_or("").into(),
        labels: v.get("labels").and_then(Value::as_array).into_iter().flatten().filter_map(|l| l.get("name").and_then(Value::as_str).map(String::from)).collect(),
        project: None,
    };
    Some((remote, v.get("title").and_then(Value::as_str).unwrap_or("").into(), v.get("url").and_then(Value::as_str).unwrap_or("").into()))
}

const PROJECT_QUERY: &str = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { projectItems(first: 10) { nodes { id project { id title field(name: \"Status\") { ... on ProjectV2SingleSelectField { id options { id name color } } } } fieldValueByName(name: \"Status\") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } } } } } } }";
const PROJECT_MUTATION: &str = "mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } } }";

fn option(o: &Value) -> Option<RemoteState> {
    let name = o.get("name")?.as_str()?.to_string();
    Some(RemoteState { id: o.get("id")?.as_str()?.into(), kind: crate::board::kind_of_name(&name).unwrap_or(StateKind::Started), name, color: o.get("color").and_then(Value::as_str).map(String::from) })
}

/// Primeiro projeto da issue que tem o campo Status (single select).
pub fn parse_project(json: &str) -> Option<ProjectItem> {
    let v: Value = serde_json::from_str(json).ok()?;
    let nodes = v.pointer("/data/repository/issue/projectItems/nodes")?.as_array()?;
    nodes.iter().find_map(|n| {
        let field = n.pointer("/project/field")?;
        let options: Vec<RemoteState> = field.get("options")?.as_array()?.iter().filter_map(option).collect();
        let current = n.pointer("/fieldValueByName/optionId").and_then(Value::as_str);
        Some(ProjectItem {
            project_id: n.pointer("/project/id")?.as_str()?.into(),
            project_title: n.pointer("/project/title").and_then(Value::as_str).unwrap_or("").into(),
            item_id: n.get("id")?.as_str()?.into(),
            field_id: field.get("id")?.as_str()?.into(),
            option: current.and_then(|c| options.iter().find(|o| o.id == c).cloned()),
            options,
        })
    })
}

fn a(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

impl GithubTracker {
    fn view(&self, repo: &str, n: u64) -> Result<(Remote, String, String)> {
        let out = self.gh.run(&a(&["issue", "view", &n.to_string(), "-R", repo, "--json", "number,title,url,state,stateReason,labels,updatedAt"]))?;
        parse_view(&out).context("resposta inválida do gh issue view")
    }

    fn project(&self, repo: &str, n: u64) -> Option<ProjectItem> {
        let (owner, name) = repo.split_once('/')?;
        let out = self.gh.run(&a(&["api", "graphql", "-f", &format!("query={PROJECT_QUERY}"), "-f", &format!("owner={owner}"), "-f", &format!("name={name}"), "-F", &format!("number={n}")])).ok()?;
        parse_project(&out)
    }
}

impl IssueTracker for GithubTracker {
    fn kind(&self) -> TrackerKind {
        TrackerKind::Github
    }

    fn connected(&self) -> bool {
        self.gh.available()
    }

    fn fetch(&self, link: &IssueLink, projects: bool) -> Result<Remote> {
        let (repo, n) = split_id(&link.id).with_context(|| format!("issue do GitHub inválida: {}", link.id))?;
        let (mut r, _, _) = self.view(&repo, n)?;
        if projects {
            r.project = self.project(&repo, n);
        }
        Ok(r)
    }

    fn apply(&self, link: &IssueLink, before: &Remote, change: &Change) -> Result<Remote> {
        let (repo, n) = split_id(&link.id).with_context(|| format!("issue do GitHub inválida: {}", link.id))?;
        let num = n.to_string();
        if let Some(to) = change.state.as_ref().filter(|s| s.id != before.state.id) {
            if before.state.id != "open" {
                self.gh.run(&a(&["issue", "reopen", &num, "-R", &repo]))?;
            }
            if to.id != "open" {
                let reason = if to.id == "not_planned" { "not planned" } else { "completed" };
                self.gh.run(&a(&["issue", "close", &num, "-R", &repo, "--reason", reason]))?;
            }
        }
        // `--add-label=x` (com `=`): um nome que comece com "-" não vira opção.
        let add: Vec<String> = change.add_labels.iter().filter(|l| !before.labels.contains(l)).map(|l| format!("--add-label={l}")).collect();
        let remove: Vec<String> = change.remove_labels.iter().filter(|l| before.labels.contains(l)).map(|l| format!("--remove-label={l}")).collect();
        if !add.is_empty() || !remove.is_empty() {
            let mut args = a(&["issue", "edit", &num, "-R", &repo]);
            args.extend(add);
            args.extend(remove);
            self.gh.run(&args)?;
        }
        if let (Some(p), Some(o)) = (&before.project, &change.project_option) {
            if p.option.as_ref().map(|x| &x.id) != Some(&o.id) {
                self.gh.run(&a(&["api", "graphql", "-f", &format!("query={PROJECT_MUTATION}"), "-f", &format!("p={}", p.project_id), "-f", &format!("i={}", p.item_id), "-f", &format!("f={}", p.field_id), "-f", &format!("o={}", o.id)]))?;
            }
        }
        self.fetch(link, before.project.is_some())
    }

    fn lookup(&self, input: &str, default_repo: Option<&str>) -> Result<Option<IssueLink>> {
        let Some(id) = parse_input(input, default_repo) else { return Ok(None) };
        let (repo, n) = split_id(&id).context("issue do GitHub inválida")?;
        let (r, title, url) = self.view(&repo, n)?;
        Ok(Some(IssueLink { tracker: TrackerKind::Github, id, identifier: format!("#{n}"), title, url, state: Some(r.state), updated_at: Some(r.updated_at) }))
    }

    fn workflows(&self) -> Result<Vec<(String, Vec<RemoteState>)>> {
        Ok(vec![("Issues".into(), states())])
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// `gh` de mentira: responde pelo começo dos argumentos e grava as chamadas.
    #[derive(Default)]
    pub struct FakeGh {
        pub replies: Mutex<Vec<(&'static str, Result<String, String>)>>,
        pub calls: Mutex<Vec<Vec<String>>>,
    }

    impl GhRunner for Arc<FakeGh> {
        fn available(&self) -> bool {
            true
        }
        fn run(&self, args: &[String]) -> Result<String> {
            self.calls.lock().unwrap().push(args.to_vec());
            let line = args.join(" ");
            let mut r = self.replies.lock().unwrap();
            let i = r.iter().position(|(k, _)| line.starts_with(k)).unwrap_or_else(|| panic!("gh sem resposta gravada: {line}"));
            match r.remove(i).1 {
                Ok(v) => Ok(v),
                Err(e) => bail!("{e}"),
            }
        }
    }

    pub fn view_json(state: &str, reason: Option<&str>, labels: &[&str], updated: &str) -> String {
        serde_json::json!({"number": 12, "title": "Botão quebrado", "url": "https://github.com/acme/web/issues/12", "state": state, "stateReason": reason, "labels": labels.iter().map(|l| serde_json::json!({"name": l})).collect::<Vec<_>>(), "updatedAt": updated}).to_string()
    }

    pub fn project_json(current: Option<&str>) -> String {
        serde_json::json!({"data": {"repository": {"issue": {"projectItems": {"nodes": [
            {"id": "PVTI_sem_status", "project": {"id": "PVT_x", "title": "Outro", "field": {}}, "fieldValueByName": null},
            {"id": "PVTI_1", "project": {"id": "PVT_1", "title": "Roadmap", "field": {"id": "PVTSSF_1", "options": [{"id": "o1", "name": "Todo", "color": "GRAY"}, {"id": "o2", "name": "In Progress", "color": "YELLOW"}, {"id": "o3", "name": "Done", "color": "GREEN"}]}},
             "fieldValueByName": current.map(|c| serde_json::json!({"optionId": c, "name": "x"}))}
        ]}}}}}).to_string()
    }

    pub fn link() -> IssueLink {
        IssueLink { tracker: TrackerKind::Github, id: "acme/web#12".into(), identifier: "#12".into(), title: String::new(), url: String::new(), state: None, updated_at: None }
    }

    #[test]
    fn entrada_vira_owner_repo_numero() {
        assert_eq!(parse_input("https://github.com/acme/web/issues/12", None).as_deref(), Some("acme/web#12"));
        assert_eq!(parse_input("https://github.com/acme/web/issues/12#issuecomment-1", None).as_deref(), Some("acme/web#12"));
        assert_eq!(parse_input("acme/web#7", None).as_deref(), Some("acme/web#7"));
        assert_eq!(parse_input("#7", Some("acme/web")).as_deref(), Some("acme/web#7"));
        for bad in ["#7", "https://github.com/acme/web/pull/3", "ENG-12", "acme/web#0", "-x/web#1", "acme/w b#1", "acme/web#1;rm"] {
            assert_eq!(parse_input(bad, None), None, "{bad}");
        }
    }

    #[test]
    fn le_estado_motivo_e_labels() {
        let (r, title, _) = parse_view(&view_json("CLOSED", Some("NOT_PLANNED"), &["bug"], "t1")).unwrap();
        assert_eq!((r.state.id.as_str(), r.state.kind, title.as_str()), ("not_planned", StateKind::Canceled, "Botão quebrado"));
        assert_eq!(parse_view(&view_json("CLOSED", Some("COMPLETED"), &[], "t")).unwrap().0.state.id, "closed");
        assert_eq!(parse_view(&view_json("OPEN", Some("REOPENED"), &[], "t")).unwrap().0.state.id, "open");
        assert_eq!(r.labels, ["bug"]);
    }

    #[test]
    fn projeto_com_campo_status() {
        let p = parse_project(&project_json(Some("o2"))).unwrap();
        assert_eq!((p.project_title.as_str(), p.item_id.as_str(), p.option.unwrap().name.as_str()), ("Roadmap", "PVTI_1", "In Progress"));
        assert_eq!(p.options.iter().map(|o| o.kind).collect::<Vec<_>>(), [StateKind::Unstarted, StateKind::Started, StateKind::Completed]);
        assert!(parse_project(r#"{"data":{"repository":{"issue":{"projectItems":{"nodes":[]}}}}}"#).is_none());
    }

    #[test]
    fn fechar_rotular_e_mover_no_projeto() {
        let gh = Arc::new(FakeGh::default());
        *gh.replies.lock().unwrap() = vec![
            ("issue close 12 -R acme/web --reason completed", Ok(String::new())),
            ("issue edit 12 -R acme/web", Ok(String::new())),
            ("api graphql -f query=mutation", Ok("{}".into())),
            ("issue view 12", Ok(view_json("CLOSED", Some("COMPLETED"), &["done"], "t2"))),
            ("api graphql -f query=query", Ok(project_json(Some("o3")))),
        ];
        let t = GithubTracker::new(Box::new(gh.clone()));
        let (mut before, _, _) = parse_view(&view_json("OPEN", None, &["in-review", "bug"], "t1")).unwrap();
        before.project = parse_project(&project_json(Some("o2")));
        let done = before.project.as_ref().unwrap().options[2].clone();
        let ch = Change { state: Some(state_of("closed")), add_labels: vec!["done".into()], remove_labels: vec!["in-review".into(), "todo".into()], project_option: Some(done) };
        let after = t.apply(&link(), &before, &ch).unwrap();
        assert_eq!((after.state.id.as_str(), after.project.unwrap().option.unwrap().name.as_str()), ("closed", "Done"));
        let calls = gh.calls.lock().unwrap();
        assert_eq!(calls[1], a(&["issue", "edit", "12", "-R", "acme/web", "--add-label=done", "--remove-label=in-review"]), "só remove o que a issue tem");
        assert!(calls[2].contains(&"o=o3".to_string()) && calls[2].contains(&"i=PVTI_1".to_string()));
    }

    #[test]
    fn reabrir_e_trocar_motivo() {
        let gh = Arc::new(FakeGh::default());
        *gh.replies.lock().unwrap() = vec![("issue reopen 12", Ok(String::new())), ("issue view 12", Ok(view_json("OPEN", Some("REOPENED"), &[], "t2")))];
        let t = GithubTracker::new(Box::new(gh.clone()));
        let (before, _, _) = parse_view(&view_json("CLOSED", Some("COMPLETED"), &[], "t1")).unwrap();
        assert_eq!(t.apply(&link(), &before, &Change { state: Some(state_of("open")), ..Default::default() }).unwrap().state.id, "open");
        // Fechada como concluída -> "not planned": reabre e fecha com o outro motivo.
        *gh.replies.lock().unwrap() = vec![("issue reopen 12", Ok(String::new())), ("issue close 12 -R acme/web --reason not planned", Ok(String::new())), ("issue view 12", Ok(view_json("CLOSED", Some("NOT_PLANNED"), &[], "t3")))];
        assert_eq!(t.apply(&link(), &before, &Change { state: Some(state_of("not_planned")), ..Default::default() }).unwrap().state.id, "not_planned");
    }

    #[test]
    fn erro_do_gh_aparece() {
        let gh = Arc::new(FakeGh::default());
        *gh.replies.lock().unwrap() = vec![("issue close", Err("gh issue: HTTP 403: Resource not accessible by integration".into()))];
        let t = GithubTracker::new(Box::new(gh));
        let (before, _, _) = parse_view(&view_json("OPEN", None, &[], "t1")).unwrap();
        let e = t.apply(&link(), &before, &Change { state: Some(state_of("closed")), ..Default::default() }).unwrap_err();
        assert!(e.to_string().contains("403"));
    }
}
