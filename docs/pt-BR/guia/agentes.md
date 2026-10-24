[English](../../guide/agents.md) · Português

# Agentes e harnesses

| Harness | Comando | Modelos | Observações |
|---|---|---|---|
| Claude Code | `claude` | `opus`, `sonnet`, `haiku` | Aprovações vêm para o app (`↵`, `⌘↵`, `⌫`). Plan mode com `⇧⇥`. Estilo de saída em **Configurações › Modelos**. |
| Codex | `codex` | Os da sua conta (`model/list` do app-server do Codex) | O esforço vem do modelo. O modelo escolhido vai sempre explícito. |
| Antigravity | `agy` | Os de `agy models` | O esforço faz parte do id do modelo. |
| OpenCode | `opencode` | Locais e endpoints próprios | Aplica as regras de permissão dele. |
| Qwen Code / Gemini CLI | `qwen` / `gemini` | Os de cada um | Modo por turno. |

As listas de modelos ficam em cache por dez minutos na memória e no disco, então o seletor funciona mesmo com um CLI lento ou sem rede.

## Modelos locais

**Modelos locais** (barra lateral) acha LM Studio, Ollama, llama.cpp, vLLM e MLX, mostra o que cabe na memória, baixa modelos depois de você confirmar e aceita endpoints próprios compatíveis com OpenAI ou Anthropic.

## Registro de harness

O registro liga uma família de modelos aos harnesses preferidos (por exemplo `qwen` → Qwen Code, depois OpenCode). Edite em **Modelos locais › Registro**. Se o preferido não estiver instalado, o Kabul explica qual usou.

## Executáveis

Em **Configurações › Avançado** dá para apontar um `claude`, `codex` ou `opencode` específico.
