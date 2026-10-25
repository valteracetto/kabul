[English](../../guide/agents.md) · Português

# Agentes e harnesses

Um modelo rende o que o laço de agente em volta dele deixa render: como lê arquivos, roda comandos, pede
permissão, planeja e se recupera de erros. O Kabul não reimplementa esse laço. Ele conduz o CLI de verdade de
cada agente e leva tudo o que ele faz (mensagens, ferramentas, aprovações, planos, uso) para o mesmo chat, os
mesmos cartões e os mesmos atalhos.

- **Harnesses nativos** para os agentes com recursos que nenhum protocolo comum expõe: Claude Code
  (stream-json: controle remoto, nuvem, teleport, plan mode, perguntas), Codex (app-server: lista de modelos,
  aprovações próprias) e Antigravity (stream-json com regras de projeto para as aprovações).
- **ACP** ([Agent Client Protocol](../../acp.md)) para os demais: um harness só cobre Gemini CLI, Qwen Code,
  OpenCode, Goose e Cursor, com sessão persistente e aprovações no app.

Você escolhe o modelo; o Kabul escolhe o harness. Para modelos locais, quem decide é o
[registro por família](./modelos-locais.md).

| Harness | Comando | Modelos | Observações |
|---|---|---|---|
| Claude Code | `claude` | `opus`, `sonnet`, `haiku` | Aprovações vêm para o app (`↵`, `⌘↵`, `⌫`). Plan mode com `⇧⇥`. Estilo de saída em **Configurações › Modelos**. |
| Codex | `codex` | Os da sua conta (`model/list` do app-server do Codex) | O esforço vem do modelo. O modelo escolhido vai sempre explícito. |
| Antigravity | `agy` | Os de `agy models` | O esforço faz parte do id do modelo. Comandos e escritas que pedem permissão viram cartão de aprovação (abaixo). |
| OpenCode | `opencode` | Locais e endpoints próprios | Roda pelo ACP (`opencode acp`): as aprovações vêm para o app. |
| Gemini CLI | `gemini --acp` | Sua conta Google, ou um gateway compatível com o Gemini | Pelo ACP (Agent Client Protocol). |
| Qwen Code | `qwen --acp` | Endpoints compatíveis com OpenAI (inclusive modelos locais) | Pelo ACP; o harness preferido para modelos Qwen. |
| Goose | `goose acp` | O provedor configurado nele, ou um endpoint compatível com OpenAI | Pelo ACP; reserva para modelos locais quando falta o OpenCode. |
| Cursor | `cursor-agent acp` | Os do Cursor | Pelo ACP; ainda a confirmar. |

## Compatibilidade

![Painel Agentes: todas as conversas rodando, com a árvore de subagentes, tokens e custo](../../assets/agents.png)

✔ confirmado rodando o CLI instalado pelo Kabul · ◐ em parte · ? ainda a confirmar. Detalhes em [ACP](../../acp.md).

| Agente | Chat | Ferramentas | Aprovações | Plan mode | Parar | Retomar | Contas | Celular | Modelo local |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | ✔ | ✔ | ✔ aprovar, negar | ✔ nativo, sai ao vivo | ✔ interrupt | ✔ `--resume` | ✔ `CLAUDE_CONFIG_DIR` | ✔ chat do Kabul + remote control nativo | ✔ API Anthropic |
| Codex | ✔ | ✔ | ✔ aprovar, negar | ✔ nativo (`collaborationMode`), sai ao vivo | ✔ `turn/interrupt` | ✔ `thread/resume` | ✔ `CODEX_HOME` | ◐ chat do Kabul | ✔ API Responses |
| Antigravity | ✔ | ✔ | ✔ regra do projeto | ◐ nativo `--mode plan`, sair reinicia | ◐ SIGINT | ✔ `--conversation` | ✔ `HOME` | ✔ chat do Kabul + remote control nativo | — |
| OpenCode | ✔ | ✔ | ✔ aprovar, negar | ◐ emulado, sai ao vivo | ✔ `session/cancel` | ✔ `session/load` | ? `XDG_DATA_HOME` | ◐ chat do Kabul | ✔ OpenAI/Anthropic |
| Gemini CLI | ✔ | ✔ | ✔ aprovar, negar | ✔ nativo, sai ao vivo | ✔ `session/cancel` | ✔ `session/load` | ✔ `HOME` (login Google não testado) | ◐ chat do Kabul | ◐ só gateways com a API do Gemini |
| Qwen Code | ✔ | ✔ | ✔ aprovar, negar | ✔ nativo, sai ao vivo | ✔ `session/cancel` | ✔ `session/load` | ✔ `HOME` | ◐ chat do Kabul | ✔ API OpenAI |
| Goose | ✔ | ✔ | ✔ aprovar, negar | ◐ emulado, sai ao vivo | ✔ `session/cancel` | ✔ `session/load` | ✔ `HOME` | ◐ chat do Kabul | ✔ API OpenAI |
| Cursor | ? | ? | ? | ? (emulado) | ? | ? | ? | ? | — |

"Plan mode emulado": o CLI não tem modo de planejamento; o Kabul pede para só ler e planejar, nega edições e comandos sozinho e mostra "Plan mode (emulado)". "Sai ao vivo": aprovar o plano troca o modo da sessão que está rodando, sem reiniciar a conversa.

"Celular ◐": o celular recebe o mesmo chat estruturado (mensagens, ferramentas, aprovações) do desktop, mas só o caminho do Claude tem teste de ponta a ponta na tela do celular.

As listas de modelos ficam em cache por dez minutos na memória e no disco, então o seletor funciona mesmo com um CLI lento ou sem rede.

## Aprovações do Antigravity

No modo sem terminal o `agy` não consegue perguntar: nega a ferramenta na hora e encerra o turno. O Kabul transforma isso no mesmo cartão de aprovação dos outros agentes, com o comando ou arquivo e a regra mínima (`command(npm audit)`, `write_file(/caminho)`):

- **Permitir uma vez** (`↵`) grava a regra no projeto do Antigravity que o Kabul usa neste workspace, pede para o agente continuar e tira a regra quando esse turno termina.
- **Sempre permitir neste workspace** (`⌘↵`) mantém a regra.
- **Negar** (`⌫`) avisa o agente para não contornar.

Cada workspace roda `agy --project kabul-<hash>`, então as regras ficam em `~/.gemini/config/projects/kabul-<hash>.json` e não mexem nas configurações globais do `agy`. Conversas criadas antes disso (fora desse projeto) não enxergam essas regras; abra uma nova. **Configurações › Modelos › Gemini: aprovar tudo automaticamente** passa `--dangerously-skip-permissions` no lugar (desligado por padrão).

## Nuvem e controle remoto por agente

| Agente | Nuvem do provedor | Controle remoto nativo | Celular pelo Kabul |
|---|---|---|---|
| Claude Code | ✔ `--cloud`, com teleport de volta | ✔ `--remote-control` (app do Claude, claude.ai) | ✔ |
| Antigravity | ? a confirmar | ✔ `--remote-control` | ✔ |
| Codex | ? a confirmar (`codex cloud`) | — | ✔ |
| Outros | — | — | ✔ |

Todo agente roda numa sessão gerenciada pelo Kabul, então qualquer um (e um shell comum) pode ser acompanhado e
operado pelo celular, tenha o CLI um recurso remoto próprio ou não. Veja [Nuvem e celular](./nuvem-e-celular.md).

## Modelos locais e o registro de harness

Servidores locais (LM Studio, Ollama, llama.cpp, vLLM, MLX), endpoints próprios e como cada família de modelo
vai para um harness: [Modelos locais](./modelos-locais.md).

## Executáveis

Em **Configurações › Avançado** dá para apontar um `claude`, `codex` ou `opencode` específico.
