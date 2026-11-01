//! Arquivos de configuração: servidores MCP (JSON/JSONC/TOML/YAML, por ponteiro) e hooks (formato de
//! `settings.json` com eventos → grupos → comandos, e variações com `command`/`bash` direto).
use super::{Ctx, Raw, Where};
use crate::tools::{fsx, redact, FindingKind, Kind, Link};
use serde_json::Value;
use std::path::Path;

/// Lê um arquivo de config qualquer como JSON (`.toml` e `.yaml` convertidos).
pub(crate) fn read_doc(ctx: &mut Ctx, p: &Path, w: &Where) -> Option<Value> {
    if !p.is_file() {
        return None;
    }
    let (text, cut) = fsx::read_capped(p, 8 * 1024 * 1024);
    if text.trim().is_empty() {
        // Arquivo vazio (a CLI criou e não gravou nada): sem itens, sem aviso.
        return None;
    }
    if cut {
        ctx.warn(FindingKind::Unrecognized, p, "arquivo grande demais (lido até 8 MB)", w);
    }
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let r: Result<Value, String> = if name.ends_with(".toml") {
        toml::from_str::<toml::Value>(&text).map_err(|e| e.to_string()).and_then(|t| serde_json::to_value(t).map_err(|e| e.to_string()))
    } else if name.ends_with(".yaml") || name.ends_with(".yml") {
        Ok(yaml_to_json(&text))
    } else {
        let t = crate::mcp::strip_jsonc(text.trim_start_matches('\u{feff}'));
        serde_json::from_str(&t).or_else(|_| serde_json::from_str(&strip_trailing_commas(&t))).map_err(|e| e.to_string())
    };
    match r {
        Ok(v) => Some(v),
        Err(e) => {
            ctx.warn(FindingKind::ParseError, p, &e, w);
            None
        }
    }
}

/// JSONC permissivo: vírgula antes de `}`/`]`.
fn strip_trailing_commas(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut in_str = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' && (i == 0 || chars[i - 1] != '\\') {
            in_str = !in_str;
        }
        if !in_str && c == ',' {
            let next = chars[i + 1..].iter().find(|c| !c.is_whitespace());
            if matches!(next, Some('}') | Some(']')) {
                i += 1;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// YAML simples → JSON (mapas aninhados pelo subconjunto de `frontmatter`).
fn yaml_to_json(text: &str) -> Value {
    let (fields, _) = crate::tools::frontmatter::parse_yaml(text);
    let mut root = serde_json::Map::new();
    for (k, v) in fields {
        let parts: Vec<&str> = k.split('.').collect();
        let mut cur = &mut root;
        for (i, part) in parts.iter().enumerate() {
            if i + 1 == parts.len() {
                cur.insert(part.to_string(), Value::String(v.clone()));
            } else {
                let e = cur.entry(part.to_string()).or_insert_with(|| Value::Object(Default::default()));
                if !e.is_object() {
                    *e = Value::Object(Default::default());
                }
                cur = e.as_object_mut().unwrap();
            }
        }
    }
    Value::Object(root)
}

fn strs(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(a)) => a.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect(),
        Some(Value::String(s)) => s.split(", ").map(String::from).collect(),
        _ => vec![],
    }
}

/// Um servidor MCP: transporte, alvo (redigido), nomes das variáveis e riscos.
pub(crate) fn mcp_raw(ctx: &Ctx, w: &Where, file: &Path, name: &str, cfg: &Value, format: &str) -> Raw {
    let url = cfg.get("url").or(cfg.get("serverUrl")).or(cfg.get("httpUrl")).or(cfg.get("uri")).and_then(Value::as_str);
    let cmd = match cfg.get("command").or(cfg.get("cmd")) {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "),
        Some(v) => v.as_str().unwrap_or("").to_string(),
        None => String::new(),
    };
    let args = strs(cfg.get("args"));
    let full = format!("{cmd} {}", args.join(" ")).trim().to_string();
    let transport = cfg.get("type").or(cfg.get("transport")).and_then(Value::as_str).map(String::from).unwrap_or_else(|| if url.is_some() { "http".into() } else { "stdio".into() });
    let mut raw = Raw { kind: Kind::Mcp, name: name.to_string(), abs: file.to_path_buf(), ..Default::default() };
    raw.extras.push(("transport".into(), transport.clone()));
    raw.extras.push(("target".into(), url.map(redact::url).unwrap_or_else(|| redact::command(&full))));
    let env_obj = cfg.get("env").or(cfg.get("environment")).or(cfg.get("envs"));
    if let Some(env) = env_obj.and_then(Value::as_object) {
        raw.extras.push(("env".into(), env.keys().cloned().collect::<Vec<_>>().join(", ")));
    }
    if let Some(h) = cfg.get("headers").and_then(Value::as_object) {
        raw.extras.push(("headers".into(), h.keys().cloned().collect::<Vec<_>>().join(", ")));
    }
    if let Some(d) = cfg.get("description").and_then(Value::as_str) {
        raw.description = Some(d.chars().take(400).collect());
    }
    // Riscos: versão não fixada, placeholders esquecidos, servidor remoto.
    let runner = cmd.rsplit(['/', '\\']).next().unwrap_or("").to_lowercase();
    let pkg = args.iter().find(|a| !a.starts_with('-'));
    let unpinned = matches!(runner.as_str(), "npx" | "bunx" | "pnpx" | "uvx" | "npx.cmd") && (args.iter().any(|a| a == "-y" || a == "--yes" || a.ends_with("@latest")) || pkg.is_some_and(|p| !p.trim_start_matches('@').contains('@')));
    if unpinned || full.contains("@latest") {
        raw.risks.push("unpinned".into());
    }
    let mut values: Vec<String> = args.clone();
    for k in ["env", "environment", "headers"] {
        if let Some(o) = cfg.get(k).and_then(Value::as_object) {
            values.extend(o.values().filter_map(Value::as_str).map(String::from));
        }
    }
    if url.is_some_and(redact::placeholder) || values.iter().any(|v| redact::placeholder(v)) {
        raw.risks.push("placeholder".into());
    }
    if url.is_some() {
        raw.risks.push("network".into());
    }
    if cfg.get("disabled").and_then(Value::as_bool) == Some(true) || cfg.get("enabled").and_then(Value::as_bool) == Some(false) || cfg.get("enabled").and_then(Value::as_str) == Some("false") {
        raw.extras.push(("disabled".into(), "true".into()));
    }
    raw.cmd = Some(if full.is_empty() { url.unwrap_or("").to_string() } else { full });
    let mut pl = w.placement(ctx.roots, file, Link::Real, format);
    pl.enabled = Some(!raw.extras.iter().any(|(k, _)| k == "disabled"));
    if let Some(p) = &w.plugin {
        raw.key = Some(format!("mcp:{}:{name}", p.split('@').next().unwrap_or("")));
    }
    raw.placement = pl;
    raw
}

/// Servidores MCP de um arquivo, pelo ponteiro (`/mcpServers`, `/mcp_servers`, `/servers`...).
pub(crate) fn mcp_file(ctx: &mut Ctx, w: &Where, file: &Path, ptr: &str) {
    let Some(doc) = read_doc(ctx, file, w) else { return };
    let format = format!("mcp-{}", file.extension().and_then(|e| e.to_str()).unwrap_or("json"));
    if let Some(map) = doc.pointer(ptr).and_then(Value::as_object) {
        for (name, cfg) in map {
            if cfg.is_object() {
                let r = mcp_raw(ctx, w, file, name, cfg, &format);
                ctx.push(r);
            }
        }
    } else if doc.pointer(ptr).is_some() {
        ctx.warn(FindingKind::Unrecognized, file, &format!("{ptr} não é um mapa"), w);
    }
    // Claude: MCPs "locais" por projeto dentro do `.claude.json` (`projects.<caminho>.mcpServers`).
    if let Some(projects) = doc.get("projects").and_then(Value::as_object).filter(|_| ptr == "/mcpServers") {
        for (path, pv) in projects {
            let Some(map) = pv.get("mcpServers").and_then(Value::as_object).filter(|m| !m.is_empty()) else { continue };
            let repo = ctx.out.repos.iter().find(|r| crate::tools::scan::project::same_path(&r.path, Path::new(path))).cloned();
            let mut w2 = w.clone();
            w2.repo = Some(repo.unwrap_or(crate::tools::RepoRef { id: String::new(), name: ctx.roots.display(Path::new(path)), path: path.into() }));
            for (name, cfg) in map {
                let mut r = mcp_raw(ctx, &w2, file, name, cfg, &format);
                r.extras.push(("scope".into(), "local".into()));
                ctx.push(r);
            }
        }
    }
}

/// Hooks de um arquivo ou de uma pasta de `*.json`/`*.hook`.
pub(crate) fn hooks_path(ctx: &mut Ctx, w: &Where, p: &Path) {
    if p.is_dir() {
        for rel in fsx::list_files(p, 100) {
            if rel.ends_with(".json") || rel.ends_with(".hook") {
                hooks_file(ctx, w, &p.join(rel));
            }
        }
    } else {
        hooks_file(ctx, w, p);
    }
}

/// Palavras de shell que não são o programa do hook.
const SHELL_WORDS: &[&str] = &["if", "then", "else", "fi", "do", "done", "for", "while", "test", "[", "[[", "export", "cd", "set", "exec", "command", "true", "false", "&&", "||", ";", "|", "!", "echo", "printf", "cat", "eval", "source", "."];

/// Nome do hook: o programa que ele roda (pula interpretadores e palavras de shell; prefere um
/// caminho), sem extensão.
pub(crate) fn program_name(cmd: &str) -> String {
    let toks = shell_tokens(cmd);
    let interp = crate::tools::known::INTERPRETERS;
    let base_of = |t: &str| -> String { t.rsplit(['/', '\\']).next().unwrap_or(t).to_lowercase().trim_end_matches(".exe").trim_end_matches(".cmd").to_string() };
    let usable = |t: &&String| -> bool {
        let b = base_of(t);
        !t.starts_with('-') && (!t.starts_with('$') || t.contains('/')) && !t.contains('=') && !interp.contains(&b.as_str()) && !SHELL_WORDS.contains(&t.as_str()) && b.chars().any(|c| c.is_alphanumeric())
    };
    let prog = toks.iter().filter(usable).find(|t| t.contains('/') || t.contains('\\')).or_else(|| toks.iter().find(usable));
    let p = prog.cloned().unwrap_or_else(|| toks.first().cloned().unwrap_or_default());
    let base = p.rsplit(['/', '\\']).next().unwrap_or(&p).to_string();
    let base = base.split('.').next().filter(|s| !s.is_empty()).unwrap_or(&base).to_string();
    // Hooks genéricos ("hook", "index") ficam com o nome da pasta de cima.
    if matches!(base.as_str(), "hook" | "index" | "main" | "run" | "claude-hook" | "hooks") {
        let parts: Vec<&str> = p.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
        if let Some(dir) = parts.iter().rev().skip(1).find(|s| !matches!(**s, "hooks" | "bin" | "dist" | "scripts" | "src" | "lib")) {
            return format!("{}/{base}", dir.trim_start_matches('.'));
        }
    }
    base
}

/// Separa uma linha de comando respeitando aspas simples e duplas.
pub(crate) fn shell_tokens(cmd: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut q: Option<char> = None;
    for c in cmd.chars() {
        match (q, c) {
            (Some(x), c) if c == x => q = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => q = Some(c),
            (None, c) if c.is_whitespace() => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            (None, c) => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn hooks_file(ctx: &mut Ctx, w: &Where, p: &Path) {
    let Some(doc) = read_doc(ctx, p, w) else { return };
    // (evento, matcher, comando)
    let mut found: Vec<(String, String, String)> = vec![];
    let cmd_of = |h: &Value| -> Option<String> { h.get("command").or(h.get("bash")).or(h.get("powershell")).or(h.get("cmd")).and_then(Value::as_str).map(String::from) };
    if let Some(hooks) = doc.get("hooks").and_then(Value::as_object) {
        for (event, groups) in hooks {
            for g in groups.as_array().into_iter().flatten() {
                let matcher = g.get("matcher").and_then(Value::as_str).unwrap_or("").to_string();
                if let Some(inner) = g.get("hooks").and_then(Value::as_array) {
                    for h in inner {
                        if let Some(c) = cmd_of(h) {
                            found.push((event.clone(), matcher.clone(), c));
                        }
                    }
                } else if let Some(c) = cmd_of(g) {
                    found.push((event.clone(), matcher.clone(), c));
                }
            }
        }
    } else if let Some(c) = doc.pointer("/then/command").and_then(Value::as_str) {
        // Hook de arquivo único (ex.: `{when: {type}, then: {type, command}}`).
        let ev = doc.pointer("/when/type").and_then(Value::as_str).unwrap_or("?").to_string();
        found.push((ev, String::new(), c.to_string()));
    }
    // Um item por programa; eventos juntados.
    let mut by: Vec<(String, Vec<String>, String)> = vec![];
    for (ev, m, c) in found {
        let name = program_name(&c);
        let label = if m.is_empty() || m == "*" { ev.clone() } else { format!("{ev}({m})") };
        match by.iter_mut().find(|(n, _, _)| *n == name) {
            Some(e) => {
                if !e.1.contains(&label) {
                    e.1.push(label);
                }
            }
            None => by.push((name, vec![label], c)),
        }
    }
    for (name, events, cmd) in by {
        let mut raw = Raw { kind: Kind::Hook, name: name.clone(), abs: p.to_path_buf(), ..Default::default() };
        if let Some(pl) = &w.plugin {
            raw.key = Some(format!("hook:{}:{name}", pl.split('@').next().unwrap_or("")));
        }
        raw.extras.push(("events".into(), events.join(", ")));
        raw.extras.push(("command".into(), redact::command(&cmd).chars().take(300).collect()));
        raw.risks.push("runsCode".into());
        raw.cmd = Some(cmd);
        raw.placement = w.placement(ctx.roots, p, Link::Real, "hooks-json");
        ctx.push(raw);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomes_de_hook() {
        assert_eq!(program_name("'/home/u/.acme/bin/acme-proxy' native-hook claude"), "acme-proxy");
        assert_eq!(program_name("node \"/home/u/.pixel/hooks/claude-hook.js\""), "pixel/claude-hook");
        assert_eq!(program_name("/usr/bin/env python3 /x/notify.py --flag"), "notify");
        assert_eq!(program_name("npx -y tool-x run"), "tool-x");
        assert_eq!(program_name("if [ -x \"$HOME/.acme/bin/hook-agent\" ]; then \"$HOME/.acme/bin/hook-agent\"; fi"), "hook-agent");
        assert_eq!(shell_tokens("a 'b c' \"d e\" f"), vec!["a", "b c", "d e", "f"]);
        assert_eq!(strip_trailing_commas("{\"a\": [1, 2,], }"), "{\"a\": [1, 2] }");
    }
}
