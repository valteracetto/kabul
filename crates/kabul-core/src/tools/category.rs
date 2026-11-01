//! Categorias e "para que serve", determinísticos (sem IA): palavras-chave em inglês e português
//! sobre nome, descrição e gatilhos. A interface traduz os ids (`tools:cat.<id>`).

/// (id, palavras-chave). A ordem desempata: a primeira categoria com mais acertos vence.
#[rustfmt::skip]
pub const CATEGORIES: &[(&str, &[&str])] = &[
    ("testing", &["test", "tdd", "e2e", "playwright", "jest", "vitest", "pytest", "teste", "qa ", "coverage", "cobertura"]),
    ("review", &["review", "revis", "audit", "lint", "code quality", "pull request", "refactor", "simplif"]),
    ("git", &["git ", "git,", "branch", "commit", "worktree", "merge", "rebase", "github", "pr "]),
    ("debugging", &["debug", "bug", "trace", "profil", "crash", "erro", "troubleshoot", "diagnos"]),
    ("planning", &["plan", "brainstorm", "spec", "prd", "roadmap", "requirement", "requisito", "task", "tarefa", "project management", "backlog", "issue", "linear", "jira"]),
    ("design", &["design", "figma", "ui ", "ux", "frontend", "css", "tailwind", "layout", "component", "interface", "visual"]),
    ("media", &["video", "vídeo", "audio", "áudio", "image", "imagem", "animation", "animação", "render", "music", "podcast", "motion"]),
    ("docs", &["doc", "readme", "write", "writing", "escrever", "markdown", "pdf", "docx", "pptx", "xlsx", "spreadsheet", "planilha", "slide", "report", "relatório"]),
    ("marketing", &["marketing", "seo", "ads", "campaign", "campanha", "copy", "landing", "social", "email marketing", "growth", "conversion", "anúncio"]),
    ("cloud", &["deploy", "cloud", "aws", "gcp", "azure", "vercel", "cloudflare", "worker", "kubernetes", "docker", "terraform", "infra", "serverless", "hosting"]),
    ("data", &["data", "dados", "sql", "database", "banco de dados", "analytics", "etl", "pipeline", "warehouse", "csv", "query", "graph"]),
    ("security", &["security", "segurança", "secret", "vulnerab", "auth", "permission", "permiss", "owasp", "pentest", "compliance"]),
    ("agents", &["agent", "agente", "subagent", "mcp", "llm", "prompt", "skill", "claude", "codex", "gemini", "orchestr", "parallel"]),
    ("productivity", &["workflow", "automation", "automação", "notes", "notas", "memory", "memória", "calendar", "agenda", "email", "obsidian", "notion", "slack", "browser", "navegador"]),
    ("dev", &["code", "código", "api", "sdk", "build", "cli", "framework", "typescript", "python", "rust", "react", "node", "backend", "library", "biblioteca"]),
];

/// Até duas categorias (ids). Sem acerto: `other`.
pub fn categorize(name: &str, description: &str, extra: &str) -> Vec<String> {
    let hay = format!(" {} {} {} ", name.replace(['-', '_'], " "), description, extra).to_lowercase();
    let mut scored: Vec<(usize, usize, &str)> = CATEGORIES
        .iter()
        .enumerate()
        .map(|(i, (id, kws))| {
            // O nome pesa o dobro da descrição.
            let n: usize = kws.iter().map(|k| hay.matches(k).count().min(3) + usize::from(name.to_lowercase().contains(k.trim())) * 2).sum();
            (n, i, *id)
        })
        .filter(|(n, _, _)| *n > 0)
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut out: Vec<String> = scored.iter().take(2).filter(|(n, _, _)| *n >= scored[0].0.div_ceil(2)).map(|(_, _, id)| id.to_string()).collect();
    if out.is_empty() {
        out.push("other".into());
    }
    out
}

/// "Para que serve": a primeira frase da descrição, sem o "Use when..." / "Use this skill...".
pub fn purpose(description: &str) -> Option<String> {
    let d = description.trim();
    if d.is_empty() {
        return None;
    }
    let lower = d.to_lowercase();
    // Corta antes do gatilho ("Use when", "Use this", "Trigger", "Usar quando").
    let cut = ["use when", "use this", "use it when", "trigger", "triggers on", "usar quando", "use quando", "use sempre"].iter().filter_map(|m| lower.find(m)).filter(|&i| i > 0).min().unwrap_or(d.len());
    let head = d[..cut].trim().trim_end_matches(['.', ',', ';', '-', '—']).trim();
    let base = if head.is_empty() { d } else { head };
    // Primeira frase.
    let end = base.char_indices().find(|(i, c)| matches!(c, '.' | '!' | '?') && base[i + c.len_utf8()..].starts_with(' ')).map(|(i, _)| i).unwrap_or(base.len());
    let s: String = base[..end].trim().chars().take(160).collect();
    (!s.is_empty()).then_some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categorias_e_proposito() {
        assert_eq!(categorize("test-driven-development", "Use when implementing any feature, write the test first", "")[0], "testing");
        assert_eq!(categorize("wrangler", "Run Wrangler CLI commands for Cloudflare Workers deployment", "")[0], "cloud");
        assert!(categorize("ads-meta", "Meta Ads campaign audit", "").contains(&"marketing".to_string()));
        assert_eq!(categorize("zzz", "", ""), vec!["other"]);
        assert_eq!(purpose("Audit paid ads across platforms. Use when the user says audit.").as_deref(), Some("Audit paid ads across platforms"));
        assert_eq!(purpose("Use when starting any conversation - establishes how to find skills").as_deref(), Some("Use when starting any conversation - establishes how to find skills"));
        assert_eq!(purpose("Gera vídeos. Usar quando pedirem um vídeo").as_deref(), Some("Gera vídeos"));
        assert_eq!(purpose("  "), None);
    }
}
