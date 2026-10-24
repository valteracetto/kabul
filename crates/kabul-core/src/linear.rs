//! Linear: chave de API no Keychain do macOS e GraphQL (api.linear.app/graphql) via curl.
//! O contexto da issue vai para `.context/[LINEAR]-<ID>.md` no workspace.
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::process::Command;

const SERVICE: &str = "kabul-linear";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Issue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default, rename = "branchName")]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub team: Option<String>,
}

pub fn get_key() -> Option<String> {
    let o = Command::new("security").args(["find-generic-password", "-s", SERVICE, "-w"]).output().ok()?;
    let k = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (o.status.success() && !k.is_empty()).then_some(k)
}

pub fn set_key(key: &str) -> Result<()> {
    let o = Command::new("security").args(["add-generic-password", "-U", "-s", SERVICE, "-a", "kabul", "-w", key.trim()]).output()?;
    if !o.status.success() {
        bail!("Keychain: {}", String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(())
}

pub fn clear_key() {
    let _ = Command::new("security").args(["delete-generic-password", "-s", SERVICE]).output();
}

fn gql(query: &str, vars: Value) -> Result<Value> {
    let key = get_key().context("Linear não conectado")?;
    let body = json!({ "query": query, "variables": vars }).to_string();
    let o = Command::new("curl").args(["-sS", "-m", "15", "https://api.linear.app/graphql", "-H", "content-type: application/json", "-H", &format!("authorization: {key}"), "--data-binary", "@-"]).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().and_then(|mut c| {
        use std::io::Write;
        c.stdin.take().unwrap().write_all(body.as_bytes())?;
        c.wait_with_output()
    })?;
    let v: Value = serde_json::from_slice(&o.stdout).with_context(|| format!("resposta inválida do Linear: {}", String::from_utf8_lossy(&o.stderr)))?;
    if let Some(e) = v.get("errors").and_then(|e| e.get(0)) {
        bail!("Linear: {}", e.get("message").and_then(Value::as_str).unwrap_or("erro"));
    }
    Ok(v["data"].clone())
}

const FIELDS: &str = "id identifier title url description branchName priorityLabel state { name } assignee { name } team { key }";

pub fn parse_issue(n: &Value) -> Option<Issue> {
    Some(Issue {
        id: n.get("id")?.as_str()?.into(),
        identifier: n.get("identifier")?.as_str()?.into(),
        title: n.get("title")?.as_str()?.into(),
        url: n.get("url")?.as_str()?.into(),
        description: n.get("description").and_then(Value::as_str).map(String::from),
        state: n.pointer("/state/name").and_then(Value::as_str).map(String::from),
        branch_name: n.get("branchName").and_then(Value::as_str).map(String::from),
        priority: n.get("priorityLabel").and_then(Value::as_str).map(String::from),
        assignee: n.pointer("/assignee/name").and_then(Value::as_str).map(String::from),
        team: n.pointer("/team/key").and_then(Value::as_str).map(String::from),
    })
}

/// Quem está conectado (para a tela de Integrações).
pub fn viewer() -> Result<String> {
    let d = gql("query { viewer { name email } organization { name } }", json!({}))?;
    Ok(format!("{} · {}", d.pointer("/viewer/name").and_then(Value::as_str).unwrap_or("?"), d.pointer("/organization/name").and_then(Value::as_str).unwrap_or("?")))
}

/// Sem busca: issues abertas atribuídas a mim. Com busca: `searchIssues`.
pub fn issues(search: Option<&str>) -> Result<Vec<Issue>> {
    let d = match search.filter(|s| !s.trim().is_empty()) {
        Some(q) => gql(&format!("query($q: String!) {{ searchIssues(term: $q, first: 25) {{ nodes {{ {FIELDS} }} }} }}"), json!({ "q": q }))?["searchIssues"]["nodes"].clone(),
        None => gql(&format!("query {{ viewer {{ assignedIssues(first: 40, filter: {{ state: {{ type: {{ nin: [\"completed\", \"canceled\"] }} }} }}, orderBy: updatedAt) {{ nodes {{ {FIELDS} }} }} }} }}"), json!({}))?["viewer"]["assignedIssues"]["nodes"].clone(),
    };
    Ok(d.as_array().into_iter().flatten().filter_map(parse_issue).collect())
}

/// Markdown do contexto da issue para `.context/[LINEAR]-<ID>.md`.
pub fn context_markdown(i: &Issue) -> String {
    format!(
        "# {} {}\n\n- URL: {}\n- Estado: {}\n- Prioridade: {}\n- Responsável: {}\n\n## Descrição\n\n{}\n",
        i.identifier,
        i.title,
        i.url,
        i.state.as_deref().unwrap_or("—"),
        i.priority.as_deref().unwrap_or("—"),
        i.assignee.as_deref().unwrap_or("—"),
        i.description.as_deref().unwrap_or("(sem descrição)")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_e_markdown() {
        let n = json!({"id":"u1","identifier":"ENG-12","title":"Corrigir login","url":"https://linear.app/x/issue/ENG-12","description":"Detalhes","branchName":"val/eng-12-corrigir-login","priorityLabel":"High","state":{"name":"Todo"},"assignee":{"name":"Val"},"team":{"key":"ENG"}});
        let i = parse_issue(&n).unwrap();
        assert_eq!(i.branch_name.as_deref(), Some("val/eng-12-corrigir-login"));
        let md = context_markdown(&i);
        assert!(md.starts_with("# ENG-12 Corrigir login") && md.contains("Detalhes") && md.contains("Todo"));
    }
}
