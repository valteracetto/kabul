//! Onde cada IA guarda as extensões: tabela declarativa (pasta global, pasta no projeto, variável
//! que move a pasta, arquivos de MCP, hooks e instruções). Adicionar uma IA = uma linha aqui.
//!
//! Convenções dos caminhos:
//! - `base`: raiz global da IA (`~/x`, `$CONFIG/x` = `$XDG_CONFIG_HOME`/`~/.config`, `$APPDATA/x` =
//!   `%APPDATA%` no Windows, "Application Support" no macOS e `~/.config` no Linux).
//! - `global`/`mcp`/`hooks`/`instr`: relativos à `base`; começando com `~/`, `$CONFIG/` ou
//!   `$APPDATA/` são absolutos (e, quando a base foi movida por variável ou conta isolada, `~/x`
//!   passa a ser `<base>/x` — ex.: o `.claude.json` mora dentro de `CLAUDE_CONFIG_DIR`).
//! - `project*`: relativos à raiz do repositório.
//! - MCP: `(arquivo, ponteiro JSON da tabela de servidores)`; o formato vem da extensão
//!   (`.json`, `.jsonc`, `.toml`, `.yaml`).
//!
//! Fontes: documentação de cada CLI e as tabelas públicas de agentes compatíveis com Agent Skills.

/// O que mora numa pasta.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum What {
    /// Uma pasta por skill com `SKILL.md`.
    Skills,
    /// Skills embutidas na IA (somente leitura, geridas por ela).
    BuiltinSkills,
    /// Skills sincronizadas da conta (geridas pela IA).
    SyncedSkills,
    /// `*.md` (ou `*.toml`) por comando; subpastas viram `pasta:nome`.
    Commands,
    /// `*.md` por subagente.
    Agents,
    /// `*.md` / `*.prompt.md` por prompt.
    Prompts,
    /// Regras/instruções (arquivo ou pasta de `*.md`/`*.mdc`).
    Rules,
    /// Plugins (manifesto `plugin.json`).
    Plugins,
    /// Extensões (`gemini-extension.json` / `qwen-extension.json`).
    Extensions,
}

impl What {
    pub fn label(&self) -> &'static str {
        match self {
            What::Skills | What::BuiltinSkills | What::SyncedSkills => "skills",
            What::Commands => "commands",
            What::Agents => "agents",
            What::Prompts => "prompts",
            What::Rules => "rules",
            What::Plugins => "plugins",
            What::Extensions => "extensions",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Provider {
    pub id: &'static str,
    pub label: &'static str,
    pub base: &'static str,
    /// Base no Windows, quando diferente.
    pub win_base: Option<&'static str>,
    /// Variável de ambiente que move a `base`.
    pub env: Option<&'static str>,
    pub global: &'static [(What, &'static str)],
    pub project: &'static [(What, &'static str)],
    pub mcp: &'static [(&'static str, &'static str)],
    pub project_mcp: &'static [(&'static str, &'static str)],
    /// Arquivos (ou pastas de `*.json`) com hooks.
    pub hooks: &'static [&'static str],
    pub project_hooks: &'static [&'static str],
    pub instr: &'static [&'static str],
    pub project_instr: &'static [&'static str],
    /// Provedor das contas isoladas do Kabul (`accounts.rs`).
    pub account: Option<&'static str>,
    /// A conta isolada troca o HOME inteiro (e não só a `base`).
    pub home_isolated: bool,
}

const E: Provider = Provider { id: "", label: "", base: "~", win_base: None, env: None, global: &[], project: &[], mcp: &[], project_mcp: &[], hooks: &[], project_hooks: &[], instr: &[], project_instr: &[], account: None, home_isolated: false };

use What::*;

/// A ordem é a de exibição (chips por IA). `shared` é a pasta canônica aberta (`.agents`).
#[rustfmt::skip]
pub const PROVIDERS: &[Provider] = &[
    Provider { id: "shared", label: ".agents", base: "~/.agents", global: &[(Skills, "skills")], project: &[(Skills, ".agents/skills")], project_instr: &["AGENTS.md"], ..E },
    Provider { id: "claude", label: "Claude Code", base: "~/.claude", env: Some("CLAUDE_CONFIG_DIR"), global: &[(Skills, "skills"), (SyncedSkills, "skills/synced"), (Commands, "commands"), (Agents, "agents"), (Plugins, "plugins")], project: &[(Skills, ".claude/skills"), (Commands, ".claude/commands"), (Agents, ".claude/agents")], mcp: &[("~/.claude.json", "/mcpServers")], project_mcp: &[(".mcp.json", "/mcpServers")], hooks: &["settings.json"], project_hooks: &[".claude/settings.json", ".claude/settings.local.json"], instr: &["CLAUDE.md"], project_instr: &["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"], account: Some("claude"), ..E },
    Provider { id: "codex", label: "Codex", base: "~/.codex", env: Some("CODEX_HOME"), global: &[(Skills, "skills"), (BuiltinSkills, "skills/.system"), (Prompts, "prompts"), (Plugins, "plugins")], project: &[(Skills, ".codex/skills")], mcp: &[("config.toml", "/mcp_servers")], project_mcp: &[(".codex/config.toml", "/mcp_servers")], hooks: &["hooks.json"], instr: &["AGENTS.md"], project_instr: &["AGENTS.override.md"], account: Some("codex"), ..E },
    Provider { id: "gemini", label: "Gemini CLI", base: "~/.gemini", global: &[(Skills, "skills"), (Commands, "commands"), (Extensions, "extensions")], project: &[(Skills, ".gemini/skills"), (Commands, ".gemini/commands"), (Extensions, ".gemini/extensions")], mcp: &[("settings.json", "/mcpServers")], project_mcp: &[(".gemini/settings.json", "/mcpServers")], hooks: &["settings.json"], project_hooks: &[".gemini/settings.json"], instr: &["GEMINI.md"], project_instr: &["GEMINI.md"], account: Some("gemini"), home_isolated: true, ..E },
    Provider { id: "agy", label: "Antigravity CLI", base: "~/.gemini/antigravity-cli", global: &[(Skills, "skills"), (BuiltinSkills, "builtin/skills")], mcp: &[("~/.gemini/config/mcp_config.json", "/mcpServers")], account: Some("agy"), home_isolated: true, ..E },
    Provider { id: "antigravity", label: "Antigravity", base: "~/.gemini/antigravity", global: &[(Skills, "skills"), (Skills, "global_skills")], project: &[(Skills, ".agent/skills"), (Rules, ".agent/rules"), (Commands, ".agent/workflows")], mcp: &[("mcp_config.json", "/mcpServers")], ..E },
    Provider { id: "qwen", label: "Qwen Code", base: "~/.qwen", global: &[(Skills, "skills"), (Commands, "commands"), (Agents, "agents"), (Extensions, "extensions")], project: &[(Skills, ".qwen/skills"), (Commands, ".qwen/commands"), (Agents, ".qwen/agents")], mcp: &[("settings.json", "/mcpServers")], project_mcp: &[(".qwen/settings.json", "/mcpServers")], hooks: &["settings.json"], project_hooks: &[".qwen/settings.json"], instr: &["QWEN.md"], project_instr: &["QWEN.md"], account: Some("qwen"), home_isolated: true, ..E },
    Provider { id: "opencode", label: "OpenCode", base: "$CONFIG/opencode", env: Some("OPENCODE_CONFIG_DIR"), global: &[(Skills, "skills"), (Commands, "command"), (Commands, "commands"), (Agents, "agent"), (Agents, "agents")], project: &[(Skills, ".opencode/skills"), (Commands, ".opencode/command"), (Commands, ".opencode/commands"), (Agents, ".opencode/agent"), (Agents, ".opencode/agents")], mcp: &[("opencode.json", "/mcp"), ("opencode.jsonc", "/mcp")], project_mcp: &[("opencode.json", "/mcp"), ("opencode.jsonc", "/mcp")], instr: &["AGENTS.md"], ..E },
    Provider { id: "goose", label: "Goose", base: "$CONFIG/goose", win_base: Some("$APPDATA/Block/goose/config"), global: &[(Skills, "skills")], project: &[(Skills, ".goose/skills")], mcp: &[("config.yaml", "/extensions")], instr: &[".goosehints"], project_instr: &[".goosehints"], account: Some("goose"), home_isolated: true, ..E },
    Provider { id: "cursor", label: "Cursor", base: "~/.cursor", global: &[(Skills, "skills"), (Commands, "commands"), (Agents, "agents"), (Plugins, "plugins")], project: &[(Skills, ".cursor/skills"), (Commands, ".cursor/commands"), (Agents, ".cursor/agents"), (Rules, ".cursor/rules")], mcp: &[("mcp.json", "/mcpServers")], project_mcp: &[(".cursor/mcp.json", "/mcpServers")], hooks: &["hooks.json"], project_hooks: &[".cursor/hooks.json"], project_instr: &[".cursorrules"], ..E },
    Provider { id: "copilot", label: "GitHub Copilot CLI", base: "~/.copilot", env: Some("COPILOT_HOME"), global: &[(Skills, "skills"), (Agents, "agents")], project: &[(Skills, ".github/skills"), (Agents, ".github/agents"), (Prompts, ".github/prompts"), (Rules, ".github/instructions")], mcp: &[("mcp-config.json", "/mcpServers")], project_hooks: &[".github/hooks"], project_instr: &[".github/copilot-instructions.md"], ..E },
    Provider { id: "vscode", label: "VS Code (Copilot)", base: "$APPDATA/Code/User", global: &[(Prompts, "prompts")], mcp: &[("mcp.json", "/servers")], project_mcp: &[(".vscode/mcp.json", "/servers")], ..E },
    Provider { id: "windsurf", label: "Windsurf", base: "~/.codeium/windsurf", global: &[(Skills, "skills"), (Commands, "global_workflows")], project: &[(Skills, ".windsurf/skills"), (Rules, ".windsurf/rules"), (Commands, ".windsurf/workflows")], mcp: &[("mcp_config.json", "/mcpServers")], hooks: &["hooks.json"], project_hooks: &[".windsurf/hooks.json"], instr: &["memories/global_rules.md"], project_instr: &[".windsurfrules"], ..E },
    Provider { id: "cline", label: "Cline", base: "~/.cline", global: &[(Skills, "skills")], project: &[(Skills, ".cline/skills"), (Rules, ".clinerules")], ..E },
    Provider { id: "roo", label: "Roo Code", base: "~/.roo", global: &[(Skills, "skills"), (Rules, "rules"), (Commands, "commands")], project: &[(Skills, ".roo/skills"), (Rules, ".roo/rules"), (Commands, ".roo/commands")], project_mcp: &[(".roo/mcp.json", "/mcpServers")], project_instr: &[".roorules"], ..E },
    Provider { id: "kilo", label: "Kilo Code", base: "~/.kilocode", global: &[(Skills, "skills"), (Rules, "rules"), (Commands, "workflows")], project: &[(Skills, ".kilocode/skills"), (Rules, ".kilocode/rules"), (Commands, ".kilocode/workflows")], project_mcp: &[(".kilocode/mcp.json", "/mcpServers")], ..E },
    Provider { id: "continue", label: "Continue", base: "~/.continue", global: &[(Skills, "skills"), (Prompts, "prompts"), (Rules, "rules")], project: &[(Skills, ".continue/skills"), (Prompts, ".continue/prompts"), (Rules, ".continue/rules")], ..E },
    Provider { id: "amp", label: "Amp", base: "$CONFIG/agents", global: &[(Skills, "skills")], mcp: &[("$CONFIG/amp/settings.json", "/amp.mcpServers")], ..E },
    Provider { id: "kiro", label: "Kiro", base: "~/.kiro", global: &[(Skills, "skills"), (Rules, "steering")], project: &[(Skills, ".kiro/skills"), (Rules, ".kiro/steering")], mcp: &[("settings/mcp.json", "/mcpServers")], project_mcp: &[(".kiro/settings/mcp.json", "/mcpServers")], project_hooks: &[".kiro/hooks"], ..E },
    Provider { id: "zed", label: "Zed", base: "$CONFIG/zed", mcp: &[("settings.json", "/context_servers")], project_mcp: &[(".zed/settings.json", "/context_servers")], project_instr: &[".rules"], ..E },
    Provider { id: "junie", label: "Junie", base: "~/.junie", global: &[(Skills, "skills")], project: &[(Skills, ".junie/skills")], mcp: &[("mcp/mcp.json", "/mcpServers")], project_instr: &[".junie/guidelines.md"], ..E },
    Provider { id: "trae", label: "Trae", base: "~/.trae", global: &[(Skills, "skills")], project: &[(Skills, ".trae/skills"), (Rules, ".trae/rules")], ..E },
    Provider { id: "augment", label: "Augment", base: "~/.augment", global: &[(Skills, "skills"), (Commands, "commands")], project: &[(Skills, ".augment/skills"), (Commands, ".augment/commands"), (Rules, ".augment/rules")], ..E },
    Provider { id: "crush", label: "Crush", base: "$CONFIG/crush", global: &[(Skills, "skills")], project: &[(Skills, ".crush/skills")], mcp: &[("crush.json", "/mcp")], project_mcp: &[("crush.json", "/mcp"), (".crush.json", "/mcp")], project_instr: &["CRUSH.md"], ..E },
    Provider { id: "factory", label: "Factory Droid", base: "~/.factory", global: &[(Skills, "skills"), (Agents, "droids"), (Commands, "commands")], project: &[(Skills, ".factory/skills"), (Agents, ".factory/droids"), (Commands, ".factory/commands")], mcp: &[("mcp.json", "/mcpServers")], hooks: &["settings.json"], ..E },
    Provider { id: "openhands", label: "OpenHands", base: "~/.openhands", global: &[(Skills, "skills"), (Rules, "microagents")], project: &[(Skills, ".openhands/skills"), (Rules, ".openhands/microagents")], ..E },
    Provider { id: "warp", label: "Warp", base: "~/.warp", global: &[(Skills, "skills")], project: &[(Skills, ".warp/skills")], project_instr: &["WARP.md"], ..E },
    // Aider não tem pasta de extensões; as convenções vêm do `.aider.conf.yml` (arquivo lido pelo usuário).
];

pub fn get(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

/// Ordem de exibição de uma IA (desconhecida vai para o fim).
pub fn order(id: &str) -> usize {
    PROVIDERS.iter().position(|p| p.id == id).unwrap_or(usize::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tabela_consistente() {
        let mut ids = std::collections::HashSet::new();
        for p in PROVIDERS {
            assert!(ids.insert(p.id), "id repetido: {}", p.id);
            assert!(!p.label.is_empty());
            assert!(p.base.starts_with('~') || p.base.starts_with('$'), "{}", p.id);
            for (_, rel) in p.project {
                assert!(!rel.starts_with('/') && !rel.starts_with('~'), "{}: {rel}", p.id);
            }
            if let Some(a) = p.account {
                assert!(crate::accounts::isolation(a).is_some(), "{}: conta sem isolamento", p.id);
            }
        }
        assert!(PROVIDERS.len() >= 25, "cobertura ampla");
    }
}
