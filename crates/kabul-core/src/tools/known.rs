//! Dados genéricos usados na detecção de origem (sem nomes de produtos específicos): interpretadores,
//! segmentos de caminho que não identificam ferramenta e arquivos de registro de instalação comuns.

/// Programas que só executam outro (o "dono" do hook/MCP é o argumento seguinte).
pub const INTERPRETERS: &[&str] = &[
    "node",
    "nodejs",
    "python",
    "python3",
    "py",
    "bun",
    "bunx",
    "deno",
    "npx",
    "pnpm",
    "pnpx",
    "yarn",
    "uv",
    "uvx",
    "pipx",
    "bash",
    "sh",
    "zsh",
    "fish",
    "pwsh",
    "powershell",
    "cmd",
    "ruby",
    "perl",
    "php",
    "java",
    "dotnet",
    "go",
    "cargo",
    "env",
    "exec",
    "sudo",
];

/// Palavras que não servem para ligar duas pegadas da mesma ferramenta.
pub const GENERIC_STEMS: &[&str] = &[
    "node",
    "nodejs",
    "local",
    "share",
    "bin",
    "lib",
    "libexec",
    "usr",
    "opt",
    "homebrew",
    "npm",
    "npx",
    "cli",
    "app",
    "apps",
    "tool",
    "tools",
    "hook",
    "hooks",
    "mcp",
    "server",
    "servers",
    "agent",
    "agents",
    "plugin",
    "plugins",
    "config",
    "cache",
    "data",
    "state",
    "core",
    "common",
    "utils",
    "skills",
    "skill",
    "user",
    "users",
    "home",
    "python",
    "scripts",
    "script",
    "claude",
    "codex",
    "gemini",
    "cursor",
    "openai",
    "anthropic",
    "google",
    "github",
    "dist",
    "build",
    "main",
    "index",
    "run",
    "runner",
    "proxy",
    "engine",
    "daemon",
];

/// Pastas de primeiro nível do home que são das IAs (não são "pasta própria" de uma ferramenta).
pub const AI_HOME_DIRS: &[&str] = &[
    ".agents",
    ".claude",
    ".codex",
    ".gemini",
    ".qwen",
    ".cursor",
    ".copilot",
    ".codeium",
    ".cline",
    ".roo",
    ".kilocode",
    ".continue",
    ".kiro",
    ".junie",
    ".trae",
    ".augment",
    ".factory",
    ".openhands",
    ".warp",
    ".config",
    ".local",
    ".npm",
    ".cache",
    ".git",
    ".ssh",
    ".vscode",
    ".Trash",
    ".nvm",
    ".volta",
    ".bun",
    ".cargo",
    ".rustup",
    ".pyenv",
    ".docker",
];

/// Registros de instalação conhecidos dentro de uma pasta de ferramenta (`~/.x/<arquivo>`), além de
/// `integrations/*.json`. O formato é lido de forma genérica (lista de arquivos com hash).
pub const REGISTRY_FILES: &[&str] = &["install-state.json", "installed.json", "install-manifest.json"];

/// Registros de pacotes de extensões gravados dentro da pasta de uma IA ou do projeto.
pub const PACKAGE_REGISTRIES: &[&str] = &["ecc/install-state.json", "ecc-install-state.json", ".claude/ecc-install-state.json"];

/// Pastas de outros apps que aparecem em projetos e NÃO são extensões de IA (listadas como "outras").
pub const FOREIGN_DIRS: &[(&str, &str)] = &[(".obsidian", "Obsidian")];

/// Primeira palavra útil de um rótulo (`@acme-ai/cli` → `acme`, `acme-blocks` → `acme`).
pub fn stem(label: &str) -> Option<String> {
    label.trim_start_matches(['@', '.']).split(|c: char| !c.is_ascii_alphanumeric()).map(|w| w.to_ascii_lowercase()).find(|w| w.len() >= 4 && !GENERIC_STEMS.contains(&w.as_str()) && !w.chars().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn stems() {
        assert_eq!(super::stem("@acme-ai/cli").as_deref(), Some("acme"));
        assert_eq!(super::stem("acme-blocks").as_deref(), Some("acme"));
        assert_eq!(super::stem(".pixel-tool").as_deref(), Some("pixel"));
        assert_eq!(super::stem("bin"), None);
    }
}
