English · [Português](../pt-BR/guia/agentes.md)

# Agents and harnesses

| Harness | Command | Models | Notes |
|---|---|---|---|
| Claude Code | `claude` | `opus`, `sonnet`, `haiku` | Tool approvals come to the app (`↵`, `⌘↵`, `⌫`). Plan mode with `⇧⇥`. Output style from **Settings › Models**. |
| Codex | `codex` | Listed by your account (`model/list` of the Codex app server) | Effort levels come from the model. The chosen model is always passed explicitly. |
| Antigravity | `agy` | Listed by `agy models` | Effort is part of the model id. |
| OpenCode | `opencode` | Local and custom endpoints | Applies its own permission rules. |
| Qwen Code / Gemini CLI | `qwen` / `gemini` | Their own | Per-turn mode. |

Model lists are cached for ten minutes in memory and on disk, so the picker still works when a CLI is slow or offline.

## Local models

**Local models** (sidebar) finds LM Studio, Ollama, llama.cpp, vLLM and MLX servers, shows what fits in memory, downloads models after you confirm and lets you add custom OpenAI- or Anthropic-compatible endpoints.

## Harness registry

The registry maps a model family to the preferred harnesses (for example `qwen` → Qwen Code, then OpenCode). Edit it in **Local models › Registry**. When the preferred harness is not installed, Kabul explains which one it used instead.

## Executable paths

**Settings › Advanced** lets you point Kabul to a specific `claude`, `codex` or `opencode` binary.
