English · [Português](../pt-BR/guia/ferramentas.md)

# Tools

Every AI coding tool keeps its own extensions in its own folders: skills, slash commands, prompts, subagents, plugins, hooks, MCP servers, extensions and instruction files. After a few months it's hard to remember what you have, which AI has it, what each one is for and where it came from. **Tools** shows all of it in one place, for every AI on your computer and in each of your repositories.

Tools is **read-only**: it never changes the folders of your AIs. The only thing it writes is Kabul's own state (your favorites, notes and a small cache).

## Opening it

- Desktop: sidebar › **More** (`···`) › **Tools** — the row shows a red count when something is broken. Also **⌘⇧U** and the palette (**⌘K** › "Tools", "Tools: health", or type a name: `Skill: test-driven-development`, `Command: /commit`, `MCP: docs-search` opens its details).
- Phone (iPhone and Android): **Settings › Tools**, or the toolbox button at the top of the workspace list. Read-only, same data as the desktop.

## What you see

- **Scope**: **Global** (installed on your computer, valid for every project), **This repo** (what your AIs see in the open workspace's repository: global plus what the project brings) and **All** (global plus every repository in Kabul).
- **AI chips** with counts, a kind filter (skills, commands, MCPs…) and search (name, description, category, AI, source, your note).
- **N folders read**: every folder and file that was read, grouped by AI, with the item count or "doesn't exist", the Kabul account it belongs to and the environment variable that moved it.
- **Catalog**: cards grouped by category (testing, review, git, cloud…), favorites first. Each card has the name, what it is for (the first sentence of its description), the source and one badge per AI:
  - solid = a real copy in that AI's folder;
  - dashed = a link (usually to the shared `.agents` folder — the healthy setup);
  - amber = a copy whose content differs from the others;
  - red = a broken link.
- **Matrix**: items × AIs (● copy, ↗ link, ⚠ diverging, ✕ broken, ◆ managed by the AI or a plugin), with "only with problems".
- **Sources**: where things came from — `npx skills` locks (global and `skills-lock.json` in the project), plugin marketplaces, git repositories, installed tools with their own install record, global npm packages, `uv` tools, built-ins — with URL, version or commit, dates, the items they brought and their **footprint**: what they left outside the extension folders (their own folder and programs, npm package, hooks and MCP servers they registered, settings files they changed).
- **Health**: problems by severity, each with **why it matters** (see below).
- **Details** (click a card): the rendered `SKILL.md` (or command/agent file), its header, every place it lives with its state, how to call it in each AI (`/name` in Claude Code, `$name` in Codex, `/prompts:name` for Codex prompts, `@agent-name` for subagents, automatic by description elsewhere), size in tokens, risks, the source, **Show in folder** (desktop) and your **favorite** and **note**.

## Which AIs and folders are read

The table below comes straight from Kabul's provider table (`crates/kabul-core/src/tools/providers.rs`): adding a new AI is one line there. Global paths use `~` for your home folder and `$CONFIG` for `$XDG_CONFIG_HOME` (or `~/.config`); on Windows, `$APPDATA` is `%APPDATA%`.

<!-- providers:start -->
| AI | Global folders | In the project | MCP files | Moves the folder |
|---|---|---|---|---|
| Shared (`.agents`) | `~/.agents/skills` | `.agents/skills` | — | — |
| Claude Code | `~/.claude/skills`<br>`~/.claude/skills/synced`<br>`~/.claude/commands`<br>`~/.claude/agents`<br>`~/.claude/plugins` | `.claude/skills`<br>`.claude/commands`<br>`.claude/agents` | `~/.claude.json`, `.mcp.json` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/skills`<br>`~/.codex/skills/.system`<br>`~/.codex/prompts`<br>`~/.codex/plugins` | `.codex/skills` | `config.toml`, `.codex/config.toml` | `CODEX_HOME` |
| Gemini CLI | `~/.gemini/skills`<br>`~/.gemini/commands`<br>`~/.gemini/extensions` | `.gemini/skills`<br>`.gemini/commands`<br>`.gemini/extensions` | `settings.json`, `.gemini/settings.json` | — |
| Antigravity CLI | `~/.gemini/antigravity-cli/skills`<br>`~/.gemini/antigravity-cli/builtin/skills` | — | `~/.gemini/config/mcp_config.json` | — |
| Antigravity | `~/.gemini/antigravity/skills`<br>`~/.gemini/antigravity/global_skills` | `.agent/skills`<br>`.agent/rules`<br>`.agent/workflows` | `mcp_config.json` | — |
| Qwen Code | `~/.qwen/skills`<br>`~/.qwen/commands`<br>`~/.qwen/agents`<br>`~/.qwen/extensions` | `.qwen/skills`<br>`.qwen/commands`<br>`.qwen/agents` | `settings.json`, `.qwen/settings.json` | — |
| OpenCode | `$CONFIG/opencode/skills`<br>`$CONFIG/opencode/command`<br>`$CONFIG/opencode/commands`<br>`$CONFIG/opencode/agent`<br>`$CONFIG/opencode/agents` | `.opencode/skills`<br>`.opencode/command`<br>`.opencode/commands`<br>`.opencode/agent`<br>`.opencode/agents` | `opencode.json`, `opencode.jsonc` | `OPENCODE_CONFIG_DIR` |
| Goose | `$CONFIG/goose/skills` | `.goose/skills` | `config.yaml` | Windows: `$APPDATA/Block/goose/config` |
| Cursor | `~/.cursor/skills`<br>`~/.cursor/commands`<br>`~/.cursor/agents`<br>`~/.cursor/plugins` | `.cursor/skills`<br>`.cursor/commands`<br>`.cursor/agents`<br>`.cursor/rules` | `mcp.json`, `.cursor/mcp.json` | — |
| GitHub Copilot CLI | `~/.copilot/skills`<br>`~/.copilot/agents` | `.github/skills`<br>`.github/agents`<br>`.github/prompts`<br>`.github/instructions` | `mcp-config.json` | `COPILOT_HOME` |
| VS Code (Copilot) | `$APPDATA/Code/User/prompts` | — | `mcp.json`, `.vscode/mcp.json` | — |
| Windsurf | `~/.codeium/windsurf/skills`<br>`~/.codeium/windsurf/global_workflows` | `.windsurf/skills`<br>`.windsurf/rules`<br>`.windsurf/workflows` | `mcp_config.json` | — |
| Cline | `~/.cline/skills` | `.cline/skills`<br>`.clinerules` | — | — |
| Roo Code | `~/.roo/skills`<br>`~/.roo/rules`<br>`~/.roo/commands` | `.roo/skills`<br>`.roo/rules`<br>`.roo/commands` | `.roo/mcp.json` | — |
| Kilo Code | `~/.kilocode/skills`<br>`~/.kilocode/rules`<br>`~/.kilocode/workflows` | `.kilocode/skills`<br>`.kilocode/rules`<br>`.kilocode/workflows` | `.kilocode/mcp.json` | — |
| Continue | `~/.continue/skills`<br>`~/.continue/prompts`<br>`~/.continue/rules` | `.continue/skills`<br>`.continue/prompts`<br>`.continue/rules` | — | — |
| Amp | `$CONFIG/agents/skills` | — | `$CONFIG/amp/settings.json` | — |
| Kiro | `~/.kiro/skills`<br>`~/.kiro/steering` | `.kiro/skills`<br>`.kiro/steering` | `settings/mcp.json`, `.kiro/settings/mcp.json` | — |
| Zed | — | — | `settings.json`, `.zed/settings.json` | — |
| Junie | `~/.junie/skills` | `.junie/skills` | `mcp/mcp.json` | — |
| Trae | `~/.trae/skills` | `.trae/skills`<br>`.trae/rules` | — | — |
| Augment | `~/.augment/skills`<br>`~/.augment/commands` | `.augment/skills`<br>`.augment/commands`<br>`.augment/rules` | — | — |
| Crush | `$CONFIG/crush/skills` | `.crush/skills` | `crush.json`, `.crush.json` | — |
| Factory Droid | `~/.factory/skills`<br>`~/.factory/droids`<br>`~/.factory/commands` | `.factory/skills`<br>`.factory/droids`<br>`.factory/commands` | `mcp.json` | — |
| OpenHands | `~/.openhands/skills`<br>`~/.openhands/microagents` | `.openhands/skills`<br>`.openhands/microagents` | — | — |
| Warp | `~/.warp/skills` | `.warp/skills` | — | — |
<!-- providers:end -->

Also read:

- **Isolated Kabul accounts** (several accounts per provider, Settings › Accounts): each account's folder is read with the same table and marked with the account name.
- **Plugins**: Claude Code's install record (`installed_plugins.json` v1 and v2, `known_marketplaces.json`, `enabledPlugins` of user, project and local settings), Codex plugins (`config.toml` + plugin cache) and the open `plugin.json` format. Marketplaces declared by a repository (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`) and MCP servers it publishes (`server.json`) show up as part of that project.
- **Install records** of packages and tools that write one (a list of the files they installed, with hashes): Kabul uses them for exact provenance and to tell when an installed file went missing or was edited.
- **Instructions**: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules`, `.windsurf/rules`, `.clinerules` and others in the table.
- In each repository: nested git repositories (up to 3 levels) and folders of other apps that are not AI extensions (for example an Obsidian vault), listed so they don't get confused with your tools.

Readers are tolerant: a format Kabul doesn't know (a new CLI version, a broken JSON file) becomes a note in Health and the rest of the screen keeps working.

## Health: what each finding means

| Finding | Severity | Why it matters |
|---|---|---|
| Broken link | error | The AI can't find the item: the link points to something that no longer exists. |
| Identical copies | warning | Loose copies don't update together. A link to the shared `.agents` folder keeps one version. |
| Diverging copies | warning | Each AI uses a different version of the same skill. |
| Only in the shared folder | warning | No AI links to it; only AIs that read `~/.agents` directly can see it. |
| Same name, different sources | warning | One may override the other depending on the order each AI reads its folders. |
| Placeholder value | warning | A config value is still an example (`YOUR_…_HERE`); the MCP server will fail. |
| Couldn't read / unrecognized format | warning / note | That file may be missing here and may not work in the AI. |
| Recorded at install, not on disk | warning | An install record (lock, plugin record, package record) points to something that's gone. |
| Installed twice | note | The same skill comes from a plugin and from a manual copy. |
| Old plugin versions | note | Leftovers from updates in the plugin cache. |
| Hook runs code | note | Hooks run programs on your computer at every event — check you recognize them. |
| MCP without a pinned version | note | `npx -y` / `@latest` downloads the newest version at every start. |
| No description / heavy | note | AIs pick skills by description; heavy files take a large part of the context. |
| Repository inside a repository | note | Nested repos often bring their own skills and settings. |
| Edited after install | note | An update from the source may overwrite those changes. |

## Privacy and performance

- File contents are read **only when you open an item** (up to 64 KB). The list itself uses names, descriptions and hashes.
- MCP arguments and hook commands are shown with secrets **redacted** (tokens, keys, passwords, `Bearer …`, sensitive URL parameters); environment variables show only their names. MCP and plugin configs are never shown whole.
- On the Kabul server (phone and shared links) the Tools commands are **owner-only**: guests invited to a workspace can't call them.
- Kabul keeps the last result in memory, refreshes it in the background (every minute at most, when an extension folder changes, or when you click **Refresh**) and caches per-file hashes, so opening the screen is instant even with hundreds of items.

## From the terminal

```bash
kabul tools ls            # summary: items per AI, every item with its AIs and source, findings
kabul tools ls --json     # the full snapshot (same data as the screen)
kabul tools ls --scope global
kabul tools item skill:test-driven-development   # details, with the file content
```
