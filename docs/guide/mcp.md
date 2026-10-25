English · [Português](../pt-BR/guia/mcp.md)

# MCP

## One registry for every AI

An MCP server configured in any AI works in the others. Kabul reads each CLI's native config and builds
a single registry:

| CLI | Read from |
|---|---|
| Claude Code | `~/.claude.json` (user and local project) and the project's `.mcp.json` |
| Codex | `config.toml` (`[mcp_servers]`) |
| OpenCode | `opencode.json` (`mcp`) |
| Gemini CLI / Qwen Code | user and project `settings.json` (`mcpServers`) |
| Antigravity | `~/.gemini/config/mcp_config.json` |

When a session starts, Kabul passes the enabled servers in each CLI's own format, for that session only,
without touching the user's config:

| CLI | How it receives them | Turning off one of its own |
|---|---|---|
| Claude Code | `--mcp-config` with the servers from other AIs | `--strict-mcp-config` with only the enabled ones |
| Codex | `-c mcp_servers.<name>.*` | `mcp_servers.<name>.enabled=false` |
| Gemini CLI, Qwen Code, Goose | ACP `mcpServers` in `session/new` | Gemini `--allowed-mcp-server-names`, Qwen `--disable-mcp-server`, Goose: not yet |
| OpenCode | `mcp` in the injected config (`OPENCODE_CONFIG_CONTENT`) | `mcp.<name>.enabled=false` |
| Antigravity | its MCP config is global only: **Export to Antigravity** writes the global file, with a backup | not yet |

The same list applies when you switch LLMs in a conversation: every session start goes through the same path.

Environment values and headers (tokens) never show in the panel or on the command line: Codex gets them
through the process environment (`env_vars`, `env_http_headers`); Claude, through a file only you can read (0600).

**Remote servers with sign-in (OAuth)** stay in their source CLI until you turn on "all AIs": the token
lives in that CLI's store and another CLI would hang opening a new sign-in (Gemini CLI holds the session
start until every MCP server connects). Remote servers with a fixed header token and local (stdio) servers
are shared by default.

## Kabul's built-in browser

The registry also has one server that comes with Kabul itself: **`kabul-browser`**, the shared
[browser](./browser.md) of the workspace. It is listed with the source **Kabul**, is native to no CLI and
therefore goes to every harness in its own format:

| CLI | What it gets |
|---|---|
| Claude Code | an entry in `--mcp-config`, plus `--allowedTools=mcp__kabul-browser` (Kabul's browser policy does the approving) |
| Codex | `-c mcp_servers.kabul-browser.command=…` and `.args=[…]` |
| ACP agents (Gemini CLI, Qwen Code, Goose, OpenCode, Cursor) | a stdio entry in `mcpServers` of `session/new` / `session/load` |
| Antigravity | no per-session injection; **Export to Antigravity** writes the entry to the global file |

The command is Kabul's own executable (the desktop app, `kabuld` or `kabul`, whichever starts the session)
with `mcp browser --workspace <id> --home <state>`, plus `--plan-flag <file>` (read-only while the file exists, that is, while the conversation is in plan mode) and `--allow-host` for each
project domain. Turn it off for one session like any other server, or for every AI in **Settings ›
Browser**. Its weight is known without starting it (the tool definitions are compiled into Kabul), so the
panel shows it right away.

For **Antigravity**, the exported entry carries the id of the workspace you exported from. Since the global
file applies to every folder, change the argument to `--workspace auto`: the server then finds the workspace
from the folder the agent runs in.

## Session panel

![Session MCP panel with tools and tokens per server and the tokens saved per turn](../assets/mcp.png)

The MCP button in the composer lists the whole registry:

- **Source** ("from Claude", "from Codex"…) and **conflict** when the same name has different settings in
  different CLIs (the first wins, in the order Claude, Codex, OpenCode, Gemini CLI, Qwen Code, Antigravity).
- **Context weight**: tools and estimated tokens of their definitions (sent every turn). "Measure" starts
  the local server, asks for its tool list and caches the result.
- **On/off for this session** (remembered per tab) and **off in this repo** (repository default), effective
  on the next turn in any AI.
- **Profiles**: "All" and "Essentials only" (the ones starred in this repository), with the estimated
  savings ("−3.2k tokens per turn").
- **All AIs**: when off, the server stays in its source CLIs only.
- **Add MCP to the project** writes the project's `.mcp.json`.

## Gemini CLI and trusted folders

Gemini CLI turns every MCP server off in untrusted folders, including the ones sent over ACP. When Kabul
injects servers into a Gemini CLI session it trusts the folder for that session only
(`GEMINI_CLI_TRUST_WORKSPACE=true`, the variable behind `--skip-trust`) without writing
`trustedFolders.json`. This also enables the project's own `.gemini/settings.json` servers.

## Confirmed

A test MCP server (`crates/kabul-core/tests/eco-mcp.mjs`, tool `eco`) configured **only in Claude** (project
`.mcp.json`) was called through Kabul by the real CLIs, with the test LLM: Gemini CLI 0.65 and Goose 1.55
(ACP `mcpServers`), Qwen Code 0.26.1 (behind its `tool_search`/`tool_call`), Codex 0.164 (`-c mcp_servers.*`;
its approval arrives as `mcpServer/elicitation/request` and is now an approval card). OpenCode 2.1.4 connects
the server from the injected config but does not list it in the "Code Mode" catalog the model sees (partial).
Antigravity: export only.
