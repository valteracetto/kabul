English · [Português](../pt-BR/guia/agentes.md)

# Agents and harnesses

| Harness | Command | Models | Notes |
|---|---|---|---|
| Claude Code | `claude` | `opus`, `sonnet`, `haiku` | Tool approvals come to the app (`↵`, `⌘↵`, `⌫`). Plan mode with `⇧⇥`. Output style from **Settings › Models**. |
| Codex | `codex` | Listed by your account (`model/list` of the Codex app server) | Effort levels come from the model. The chosen model is always passed explicitly. |
| Antigravity | `agy` | Listed by `agy models` | Effort is part of the model id. Commands and file writes that need permission show an approval card (see below). |
| OpenCode | `opencode` | Local and custom endpoints | Runs over ACP (`opencode acp`): tool approvals come to the app. |
| Qwen Code / Gemini CLI / Goose / Cursor | `qwen` / `gemini` / `goose` / `cursor-agent` | Their own | Over ACP (Agent Client Protocol); not yet confirmed with the installed CLIs. |

Model lists are cached for ten minutes in memory and on disk, so the picker still works when a CLI is slow or offline.

## Antigravity approvals

In headless mode `agy` cannot ask for permission: it denies the tool on the spot and ends the turn. Kabul turns that into the same approval card the other agents use, showing the command or file and the minimal rule (`command(npm audit)`, `write_file(/path)`):

- **Allow once** (`↵`) writes the rule to the Antigravity project Kabul uses for this workspace, asks the agent to continue and removes the rule when that turn ends.
- **Always allow in this workspace** (`⌘↵`) keeps the rule.
- **Deny** (`⌫`) tells the agent not to work around it.

Each workspace runs `agy --project kabul-<hash>`, so the rules live in `~/.gemini/config/projects/kabul-<hash>.json` and never touch your global `agy` settings. Conversations started before this (outside that project) don't see these rules; start a new one. **Settings › Models › Gemini: approve everything automatically** passes `--dangerously-skip-permissions` instead (off by default).

## Local models

**Local models** (sidebar) finds LM Studio, Ollama, llama.cpp, vLLM and MLX servers, shows what fits in memory, downloads models after you confirm and lets you add custom OpenAI- or Anthropic-compatible endpoints.

## Harness registry

The registry maps a model family to the preferred harnesses (for example `qwen` → Qwen Code, then OpenCode). Edit it in **Local models › Registry**. When the preferred harness is not installed, Kabul explains which one it used instead.

## Executable paths

**Settings › Advanced** lets you point Kabul to a specific `claude`, `codex` or `opencode` binary.
