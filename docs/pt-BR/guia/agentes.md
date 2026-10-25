[English](../../guide/agents.md) · Português

# Agentes e harnesses

| Harness | Comando | Modelos | Observações |
|---|---|---|---|
| Claude Code | `claude` | `opus`, `sonnet`, `haiku` | Aprovações vêm para o app (`↵`, `⌘↵`, `⌫`). Plan mode com `⇧⇥`. Estilo de saída em **Configurações › Modelos**. |
| Codex | `codex` | Os da sua conta (`model/list` do app-server do Codex) | O esforço vem do modelo. O modelo escolhido vai sempre explícito. |
| Antigravity | `agy` | Os de `agy models` | O esforço faz parte do id do modelo. Comandos e escritas que pedem permissão viram cartão de aprovação (abaixo). |
| OpenCode | `opencode` | Locais e endpoints próprios | Roda pelo ACP (`opencode acp`): as aprovações vêm para o app. |
| Qwen Code / Gemini CLI / Goose / Cursor | `qwen` / `gemini` / `goose` / `cursor-agent` | Os de cada um | Pelo ACP (Agent Client Protocol); ainda a confirmar com os CLIs instalados. |

As listas de modelos ficam em cache por dez minutos na memória e no disco, então o seletor funciona mesmo com um CLI lento ou sem rede.

## Aprovações do Antigravity

No modo sem terminal o `agy` não consegue perguntar: nega a ferramenta na hora e encerra o turno. O Kabul transforma isso no mesmo cartão de aprovação dos outros agentes, com o comando ou arquivo e a regra mínima (`command(npm audit)`, `write_file(/caminho)`):

- **Permitir uma vez** (`↵`) grava a regra no projeto do Antigravity que o Kabul usa neste workspace, pede para o agente continuar e tira a regra quando esse turno termina.
- **Sempre permitir neste workspace** (`⌘↵`) mantém a regra.
- **Negar** (`⌫`) avisa o agente para não contornar.

Cada workspace roda `agy --project kabul-<hash>`, então as regras ficam em `~/.gemini/config/projects/kabul-<hash>.json` e não mexem nas configurações globais do `agy`. Conversas criadas antes disso (fora desse projeto) não enxergam essas regras; abra uma nova. **Configurações › Modelos › Gemini: aprovar tudo automaticamente** passa `--dangerously-skip-permissions` no lugar (desligado por padrão).

## Modelos locais

**Modelos locais** (barra lateral) acha LM Studio, Ollama, llama.cpp, vLLM e MLX, mostra o que cabe na memória, baixa modelos depois de você confirmar e aceita endpoints próprios compatíveis com OpenAI ou Anthropic.

## Registro de harness

O registro liga uma família de modelos aos harnesses preferidos (por exemplo `qwen` → Qwen Code, depois OpenCode). Edite em **Modelos locais › Registro**. Se o preferido não estiver instalado, o Kabul explica qual usou.

## Executáveis

Em **Configurações › Avançado** dá para apontar um `claude`, `codex` ou `opencode` específico.
