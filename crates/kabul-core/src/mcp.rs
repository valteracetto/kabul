//! Servidores MCP configurados por harness (lidos dos arquivos do próprio CLI) e config por sessão.
use crate::harness::HarnessKind;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpEntry {
    pub name: String,
    /// user | local | project
    pub scope: String,
    /// Arquivo de onde veio.
    pub source: String,
    /// stdio | http | sse
    pub transport: String,
    /// Comando ou URL (para exibir).
    pub target: String,
    /// Configuração original (para montar `--mcp-config`).
    pub config: Value,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn entry(name: &str, cfg: &Value, scope: &str, source: &Path) -> McpEntry {
    let url = cfg.get("url").and_then(Value::as_str);
    let cmd = cfg.get("command").map(|c| match c {
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
        v => v.as_str().unwrap_or("").to_string(),
    });
    let args = cfg.get("args").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).unwrap_or_default();
    McpEntry {
        name: name.into(),
        scope: scope.into(),
        source: source.display().to_string(),
        transport: cfg.get("type").and_then(Value::as_str).map(String::from).unwrap_or_else(|| if url.is_some() { "http".into() } else { "stdio".into() }),
        target: url.map(String::from).unwrap_or_else(|| format!("{} {args}", cmd.unwrap_or_default()).trim().to_string()),
        config: cfg.clone(),
    }
}

fn from_map(v: Option<&Value>, scope: &str, source: &Path) -> Vec<McpEntry> {
    v.and_then(Value::as_object).map(|m| m.iter().map(|(k, c)| entry(k, c, scope, source)).collect()).unwrap_or_default()
}

/// Remove comentários `//` de JSONC (linhas inteiras e finais simples fora de strings comuns).
pub fn strip_jsonc(s: &str) -> String {
    s.lines().map(|l| if l.trim_start().starts_with("//") { "" } else { l }).collect::<Vec<_>>().join("\n")
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&strip_jsonc(&std::fs::read_to_string(p).ok()?)).ok()
}

/// Lista os MCPs que o harness carregaria neste workspace.
pub fn list(kind: HarnessKind, workspace: &Path, repo: &Path) -> Vec<McpEntry> {
    let h = home();
    match kind {
        HarnessKind::Claude => {
            let cj = h.join(".claude.json");
            let global = read_json(&cj).unwrap_or(Value::Null);
            let mut v = from_map(global.get("mcpServers"), "user", &cj);
            for p in [workspace, repo] {
                v.extend(from_map(global.pointer(&format!("/projects/{}/mcpServers", p.display().to_string().replace('~', "~0").replace('/', "~1"))), "local", &cj));
            }
            let pj = workspace.join(".mcp.json");
            v.extend(from_map(read_json(&pj).as_ref().and_then(|j| j.get("mcpServers")), "project", &pj));
            dedup(v)
        }
        HarnessKind::Codex => {
            let p = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| h.join(".codex")).join("config.toml");
            let t: toml::Value = std::fs::read_to_string(&p).ok().and_then(|s| toml::from_str(&s).ok()).unwrap_or(toml::Value::Table(Default::default()));
            let j = serde_json::to_value(t.get("mcp_servers").cloned().unwrap_or(toml::Value::Table(Default::default()))).unwrap_or(Value::Null);
            from_map(Some(&j), "user", &p)
        }
        HarnessKind::OpenCode => {
            let mut v = vec![];
            for p in [h.join(".config/opencode/opencode.json"), h.join(".config/opencode/opencode.jsonc"), workspace.join("opencode.json")] {
                v.extend(from_map(read_json(&p).as_ref().and_then(|j| j.get("mcp")), if p.starts_with(workspace) { "project" } else { "user" }, &p));
            }
            dedup(v)
        }
        HarnessKind::QwenCode | HarnessKind::GeminiCli => {
            let dir = if kind == HarnessKind::QwenCode { ".qwen" } else { ".gemini" };
            let mut v = vec![];
            for (p, sc) in [(h.join(dir).join("settings.json"), "user"), (workspace.join(dir).join("settings.json"), "project")] {
                v.extend(from_map(read_json(&p).as_ref().and_then(|j| j.get("mcpServers")), sc, &p));
            }
            v
        }
        HarnessKind::Antigravity => {
            let o = crate::harness::CmdSpec::new("agy", ["mcp", "list"]).command().output();
            let out = o.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
            parse_agy_list(&out)
        }
    }
}

/// `agy mcp list`: "No MCP servers configured." ou linhas `nome: comando` / `nome (estado)`.
pub fn parse_agy_list(out: &str) -> Vec<McpEntry> {
    out.lines()
        .filter(|l| !l.trim().is_empty() && !l.to_lowercase().contains("no mcp servers"))
        .filter_map(|l| {
            let l = l.trim().trim_start_matches(['-', '*', '•']).trim();
            let (name, rest) = l.split_once([':', ' ']).unwrap_or((l, ""));
            (!name.is_empty()).then(|| McpEntry { name: name.into(), scope: "user".into(), source: "agy mcp list".into(), transport: "stdio".into(), target: rest.trim().into(), config: Value::Null })
        })
        .collect()
}

fn dedup(mut v: Vec<McpEntry>) -> Vec<McpEntry> {
    // Escopos mais específicos vencem (project > local > user).
    let rank = |s: &str| match s { "project" => 0, "local" => 1, _ => 2 };
    v.sort_by_key(|e| rank(&e.scope));
    let mut seen = std::collections::HashSet::new();
    v.retain(|e| seen.insert(e.name.clone()));
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

/// Grava um `--mcp-config` só com os servidores habilitados (usado com `--strict-mcp-config`).
pub fn claude_config_file(entries: &[McpEntry], disabled: &[String], dir: &Path) -> Result<PathBuf> {
    let servers: serde_json::Map<String, Value> = entries.iter().filter(|e| !disabled.contains(&e.name)).map(|e| (e.name.clone(), e.config.clone())).collect();
    std::fs::create_dir_all(dir)?;
    let p = dir.join(format!("mcp-{}.json", crate::store::now_nanos()));
    std::fs::write(&p, serde_json::to_vec_pretty(&json!({ "mcpServers": servers }))?)?;
    Ok(p)
}

/// Adiciona um MCP ao `.mcp.json` do projeto (escopo do repo, versionável).
pub fn add_project(workspace: &Path, name: &str, command: &str, args: &[String], env: &[(String, String)]) -> Result<()> {
    let p = workspace.join(".mcp.json");
    let mut j = read_json(&p).unwrap_or_else(|| json!({ "mcpServers": {} }));
    let cfg = if command.starts_with("http://") || command.starts_with("https://") {
        json!({ "type": "http", "url": command })
    } else {
        json!({ "command": command, "args": args, "env": env.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect::<serde_json::Map<String, Value>>() })
    };
    j["mcpServers"].as_object_mut().context(".mcp.json inválido")?.insert(name.into(), cfg);
    std::fs::write(&p, serde_json::to_vec_pretty(&j)?).context("gravando .mcp.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projeto_e_config() {
        let d = std::env::temp_dir().join(format!("kabul-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        add_project(&d, "docs", "npx", &["-y".into(), "docs-mcp".into()], &[]).unwrap();
        add_project(&d, "remoto", "https://mcp.exemplo.com/mcp", &[], &[]).unwrap();
        let v = list(HarnessKind::Claude, &d, &d);
        let docs = v.iter().find(|e| e.name == "docs").unwrap();
        assert_eq!((docs.scope.as_str(), docs.transport.as_str(), docs.target.as_str()), ("project", "stdio", "npx -y docs-mcp"));
        assert_eq!(v.iter().find(|e| e.name == "remoto").unwrap().transport, "http");
        let f = claude_config_file(&v.iter().filter(|e| e.scope == "project").cloned().collect::<Vec<_>>(), &["remoto".into()], &d).unwrap();
        let j: Value = serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap();
        assert!(j["mcpServers"].get("docs").is_some() && j["mcpServers"].get("remoto").is_none());
        assert!(parse_agy_list("No MCP servers configured.\n").is_empty());
        assert_eq!(parse_agy_list("- linear: npx linear-mcp\n")[0].name, "linear");
        std::fs::remove_dir_all(&d).ok();
    }
}
