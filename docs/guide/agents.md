English · [Português](../pt-BR/guia/agentes.md)

# Agents and harnesses

A model is only as good as the agent loop around it: how it reads files, runs commands, asks for permission,
plans and recovers from errors. Kabul doesn't reimplement that loop. It drives the real CLI of each agent and
maps everything it does (messages, tool calls, approvals, plans, usage) to the same chat, cards and shortcuts.

- **Native harnesses** for the agents with features no common protocol exposes: Claude Code (stream-json:
  remote control, cloud, teleport, plan mode, questions), Codex (app server: model list, its own approvals)
  and Antigravity (stream-json with project rules for approvals).
- **ACP** ([Agent Client Protocol](../acp.md)) for everyone else: one harness covers Gemini CLI, Qwen Code,
  OpenCode, Goose and Cursor, with a persistent session and approvals in the app.

You pick the model; Kabul picks the harness. For local models, the [family registry](./local-models.md) decides.

| Harness | Command | Models | Notes |
|---|---|---|---|
| Claude Code | `claude` | `opus`, `sonnet`, `haiku` | Tool approvals come to the app (`↵`, `⌘↵`, `⌫`). Plan mode with `⇧⇥`. Output style from **Settings › Models**. |
| Codex | `codex` | Listed by your account (`model/list` of the Codex app server) | Effort levels come from the model. The chosen model is always passed explicitly. |
| Antigravity | `agy` | Listed by `agy models` | Effort is part of the model id. Commands and file writes that need permission show an approval card (see below). |
| OpenCode | `opencode` | Local and custom endpoints | Runs over ACP (`opencode acp`): tool approvals come to the app. |
| Gemini CLI | `gemini --acp` | Your Google account, or a Gemini-compatible gateway | Over ACP (Agent Client Protocol). |
| Qwen Code | `qwen --acp` | OpenAI-compatible endpoints (local models included) | Over ACP; the preferred harness for Qwen models. |
| Goose | `goose acp` | Its configured provider, or an OpenAI-compatible endpoint | Over ACP; fallback for local models when OpenCode is missing. |
| Cursor | `cursor-agent acp` | Cursor's | Over ACP; not yet confirmed. |

## Compatibility

✔ confirmed by running the installed CLI through Kabul · ◐ partly · ? not confirmed yet. Details in [ACP](../acp.md).

| Agent | Chat | Tools | Approvals | Plan mode | Stop | Resume | Accounts | Phone | Local model |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | ✔ | ✔ | ✔ allow, deny | ✔ native, live exit | ✔ interrupt | ✔ `--resume` | ✔ `CLAUDE_CONFIG_DIR` | ✔ Kabul chat + native remote control | ✔ Anthropic API |
| Codex | ✔ | ✔ | ✔ allow, deny | ✔ native (`collaborationMode`), live exit | ✔ `turn/interrupt` | ✔ `thread/resume` | ✔ `CODEX_HOME` | ◐ Kabul chat | ✔ Responses API |
| Antigravity | ✔ | ✔ | ✔ project rule | ◐ native `--mode plan`, exit restarts | ◐ SIGINT | ✔ `--conversation` | ✔ `HOME` | ✔ Kabul chat + native remote control | — |
| OpenCode | ✔ | ✔ | ✔ allow, deny | ◐ emulated, live exit | ✔ `session/cancel` | ✔ `session/load` | ? `XDG_DATA_HOME` | ◐ Kabul chat | ✔ OpenAI/Anthropic |
| Gemini CLI | ✔ | ✔ | ✔ allow, deny | ✔ native, live exit | ✔ `session/cancel` | ✔ `session/load` | ✔ `HOME` (Google sign-in not tested) | ◐ Kabul chat | ◐ Gemini-API gateways only |
| Qwen Code | ✔ | ✔ | ✔ allow, deny | ✔ native, live exit | ✔ `session/cancel` | ✔ `session/load` | ✔ `HOME` | ◐ Kabul chat | ✔ OpenAI API |
| Goose | ✔ | ✔ | ✔ allow, deny | ◐ emulated, live exit | ✔ `session/cancel` | ✔ `session/load` | ✔ `HOME` | ◐ Kabul chat | ✔ OpenAI API |
| Cursor | ? | ? | ? | ? (emulated) | ? | ? | ? | ? | — |

"Plan mode emulated" means the CLI has no planning mode: Kabul asks it to only read and plan, denies edits and commands on its own and shows "Plan mode (emulated)". "Live exit" means approving the plan switches the running session's mode without restarting the conversation.

"Phone ◐" means the phone gets the same structured chat (messages, tools, approvals) as the desktop, but only the Claude path has an end-to-end test on the phone UI.

Model lists are cached for ten minutes in memory and on disk, so the picker still works when a CLI is slow or offline.

## Antigravity approvals

In headless mode `agy` cannot ask for permission: it denies the tool on the spot and ends the turn. Kabul turns that into the same approval card the other agents use, showing the command or file and the minimal rule (`command(npm audit)`, `write_file(/path)`):

- **Allow once** (`↵`) writes the rule to the Antigravity project Kabul uses for this workspace, asks the agent to continue and removes the rule when that turn ends.
- **Always allow in this workspace** (`⌘↵`) keeps the rule.
- **Deny** (`⌫`) tells the agent not to work around it.

Each workspace runs `agy --project kabul-<hash>`, so the rules live in `~/.gemini/config/projects/kabul-<hash>.json` and never touch your global `agy` settings. Conversations started before this (outside that project) don't see these rules; start a new one. **Settings › Models › Gemini: approve everything automatically** passes `--dangerously-skip-permissions` instead (off by default).

## Cloud and remote control per agent

| Agent | Provider cloud | Native remote control | Phone through Kabul |
|---|---|---|---|
| Claude Code | ✔ `--cloud`, teleport back | ✔ `--remote-control` (Claude app, claude.ai) | ✔ |
| Antigravity | ? to be confirmed | ✔ `--remote-control` | ✔ |
| Codex | ? to be confirmed (`codex cloud`) | — | ✔ |
| Others | — | — | ✔ |

Every agent runs inside a session Kabul manages, so any of them (and a plain shell) can be watched and typed
into from the phone, whether or not the CLI has its own remote feature. See [Cloud and mobile](./cloud-and-mobile.md).

## Local models and the harness registry

Local servers (LM Studio, Ollama, llama.cpp, vLLM, MLX) and custom endpoints, and how each model family is
routed to a harness: [Local models](./local-models.md).

## Executable paths

**Settings › Advanced** lets you point Kabul to a specific `claude`, `codex` or `opencode` binary.
