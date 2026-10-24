//! Histórico das sessões de chat por workspace (JSON em `<estado>/sessions/<workspace>/<sessão>.json`).
//! O conteúdo é opaco para o core (o frontend decide o formato dos itens).
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub model_key: Option<String>,
    /// Id do agente para retomar (`--resume`, `--session`).
    pub agent_session: Option<String>,
    pub updated_at: u64,
    pub items: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub model_key: Option<String>,
    pub updated_at: u64,
}

fn dir(root: &Path, ws: &str) -> PathBuf {
    root.join("sessions").join(ws.replace(['/', '.'], "_"))
}

pub fn save(root: &Path, r: &SessionRecord) -> Result<()> {
    let d = dir(root, &r.workspace_id);
    std::fs::create_dir_all(&d)?;
    std::fs::write(d.join(format!("{}.json", r.id.replace(['/', '.'], "_"))), serde_json::to_vec(r)?).context("salvando sessão")
}

pub fn load(root: &Path, ws: &str, id: &str) -> Result<SessionRecord> {
    Ok(serde_json::from_slice(&std::fs::read(dir(root, ws).join(format!("{}.json", id.replace(['/', '.'], "_"))))?)?)
}

pub fn list(root: &Path, ws: &str) -> Vec<SessionSummary> {
    let mut v: Vec<SessionSummary> = std::fs::read_dir(dir(root, ws))
        .into_iter()
        .flatten()
        .filter_map(|e| serde_json::from_slice::<SessionRecord>(&std::fs::read(e.ok()?.path()).ok()?).ok())
        .map(|r| SessionSummary { id: r.id, title: r.title, model_key: r.model_key, updated_at: r.updated_at })
        .collect();
    v.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
    v
}

pub fn delete(root: &Path, ws: &str, id: &str) -> Result<()> {
    std::fs::remove_file(dir(root, ws).join(format!("{}.json", id.replace(['/', '.'], "_")))).context("apagando sessão")
}

/// Busca texto nas sessões de todos os workspaces (para ⌘K): (workspace, sessão, título, trecho).
pub fn search(root: &Path, q: &str) -> Vec<(String, String, String, String)> {
    let q = q.to_lowercase();
    let mut out = vec![];
    for ws in std::fs::read_dir(root.join("sessions")).into_iter().flatten().flatten() {
        for f in std::fs::read_dir(ws.path()).into_iter().flatten().flatten() {
            let Some(r) = std::fs::read(f.path()).ok().and_then(|b| serde_json::from_slice::<SessionRecord>(&b).ok()) else { continue };
            let text = r.items.to_string();
            if let Some(i) = text.to_lowercase().find(&q) {
                let start = text.char_indices().map(|(i, _)| i).filter(|&j| j <= i.saturating_sub(30)).last().unwrap_or(0);
                let snippet: String = text[start..].chars().take(90).collect();
                out.push((r.workspace_id.clone(), r.id.clone(), r.title.clone(), snippet));
            }
        }
    }
    out
}

/// `/comandos`: embutidos do harness + `.claude/commands/*.md` do repo e do usuário.
pub fn slash_commands(workspace: &Path) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = [
        ("/compact", "resumir a conversa para liberar contexto"),
        ("/clear", "nova conversa (mantém o workspace)"),
        ("/review", "revisar as mudanças do workspace"),
        ("/init", "gerar CLAUDE.md/AGENTS.md do projeto"),
        ("/plan", "alternar plan mode"),
    ]
    .iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect();
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    for d in [workspace.join(".claude/commands"), home.join(".claude/commands")] {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("md") {
                let name = format!("/{}", p.file_stem().unwrap().to_string_lossy());
                let desc = std::fs::read_to_string(&p).ok().and_then(|s| s.lines().find(|l| l.starts_with("description:")).map(|l| l["description:".len()..].trim().to_string())).unwrap_or_else(|| "comando custom".into());
                if !v.iter().any(|(n, _)| *n == name) {
                    v.push((name, desc));
                }
            }
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn salva_lista_busca() {
        let root = std::env::temp_dir().join(format!("kabul-hist-{}", std::process::id()));
        let r = SessionRecord { id: "s1".into(), workspace_id: "w1".into(), title: "Chat".into(), model_key: None, agent_session: Some("abc".into()), updated_at: 5, items: serde_json::json!([{"k":"user","text":"corrigir o login"}]) };
        save(&root, &r).unwrap();
        assert_eq!(list(&root, "w1")[0].id, "s1");
        assert_eq!(load(&root, "w1", "s1").unwrap().agent_session.as_deref(), Some("abc"));
        assert_eq!(search(&root, "LOGIN").len(), 1);
        delete(&root, "w1", "s1").unwrap();
        assert!(list(&root, "w1").is_empty());
        std::fs::remove_dir_all(&root).ok();
        assert!(slash_commands(Path::new("/nao-existe")).iter().any(|(n, _)| n == "/compact"));
    }
}
