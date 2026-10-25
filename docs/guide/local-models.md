English · [Português](../pt-BR/guia/modelos-locais.md)

# Local models

Run open models on your own hardware with the same chat, approvals, plan mode, checkpoints and diff as the
cloud models, and in the harness that gets the most out of each family.

## Finding servers and models

**Local models** (sidebar) finds the servers running on this computer and lists their models:

| Server | APIs it exposes |
|---|---|
| LM Studio | OpenAI (`/v1/chat/completions`, `/v1/responses`) and Anthropic (`/v1/messages`) |
| Ollama | OpenAI-compatible |
| llama.cpp (`llama-server`) | OpenAI-compatible |
| vLLM | OpenAI-compatible |
| MLX (`mlx_lm.server`, Apple Silicon only) | OpenAI-compatible |

It shows which models fit in memory, downloads a model after you confirm, and lets you add **custom endpoints**
that speak the OpenAI or Anthropic API (a server on another machine, a gateway). Local models show up in the
model picker (`⌘/`) with a **Local** badge, next to the cloud ones.

## The family registry

Each model family is routed to the first installed harness that both suits it and speaks an API the server
offers:

| Family | Preferred harness | Fallback |
|---|---|---|
| Qwen (`qwen3-8b`, `qwen3-coder-30b-a3b-instruct`…) | Qwen Code, pointed at the endpoint | OpenCode (Kabul offers to install Qwen Code) |
| DeepSeek, Kimi, GLM, MiniMax | Claude Code, when the server speaks the Anthropic API | OpenCode |
| gpt-oss | Codex, with a `kabul` provider (Responses API) | OpenCode |
| Gemma | Gemini CLI, only through a gateway that speaks the Gemini API | OpenCode (LM Studio and Ollama don't speak the Gemini API) |
| Everything else (Llama, Mistral…) | OpenCode | Goose |

Edit it in **Local models › Registry**. When the preferred harness is not installed, the chat explains which
one it used instead.

Kabul passes the endpoint to each harness in its own way and only for that session: Qwen Code gets
`OPENAI_BASE_URL`/`OPENAI_MODEL`, OpenCode an injected provider config, Goose `GOOSE_PROVIDER`/`OPENAI_HOST`,
Codex a `-c` provider, Claude Code the endpoint in its session settings (so an `ANTHROPIC_BASE_URL` in your
own `~/.claude/settings.json` doesn't send the local model elsewhere). Your global configs are not edited.

## Tips

- Agent system prompts are large (Qwen Code's is around 20k tokens). Give the server a context window that
  fits it, and expect the first turn to be slower on modest hardware. Kabul raises Qwen Code's request
  timeout for local endpoints so long prompts aren't cut.
- Local models are confirmed end to end with `qwen3-8b` on LM Studio (a turn with a file write approved in
  the app). The other routes are confirmed with the real CLIs against a test server that speaks the same APIs.
- From the command line: `kabul chat "<prompt>" --local <model> [--agente <harness>]` runs one turn through
  the registry.

## Switching between local and cloud

A local model is just another model in the picker: you can start with a cloud model, hand the boring part to a
local one and come back, in the same conversation and branch. See [Switching model or account](./switching.md).
