# ACP (Agent Client Protocol) no Kabul

O ACP é um protocolo aberto entre editores/clientes e agentes de código: JSON-RPC 2.0 em linhas por
stdio. O Kabul fala ACP como **cliente** num harness genérico (`crates/kabul-core/src/harness/acp.rs`)
e mapeia tudo para os mesmos eventos, cartões e aprovações dos outros agentes.

## Decisão

- **ACP para quem fala ACP.** Um harness só cobre OpenCode, Gemini CLI, Qwen Code, Goose e Cursor:
  sessão persistente, aprovações no app e cartões de ferramenta, sem um parser por CLI.
- **Nativos continuam nativos.** Claude Code (stream-json: remote-control, nuvem, teleport, plan mode,
  perguntas), Codex (app-server: `model/list`, aprovações próprias) e Antigravity/agy (stream-json com o
  fluxo de aprovação por regra de projeto) têm recursos que o ACP não expõe. Para eles não muda nada.
- **Registro por família.** Os agentes ACP são `HarnessKind` como os outros (`opencode`, `gemini`,
  `qwen`, `goose`, `cursor`) e entram no registro de harness (`config/harness-registry.json`) pelo nome.
  A família `outros` cai em OpenCode e, sem ele, em Goose.

## O que o harness faz

| ACP | Kabul |
|---|---|
| `initialize` (cliente anuncia `fs.readTextFile`, `fs.writeTextFile` e `terminal`) | handshake na partida; guarda os `authMethods` para a dica de login. Para o Gemini CLI o `fs` vai desligado (ver abaixo) |
| `session/new` / `session/load` (com `loadSession`) | conversa nova / retomar. O histórico que o agente reproduz no `load` é ignorado (o Kabul já tem o dele), inclusive o que chega **depois** da resposta: o primeiro prompt espera a saída ficar quieta (300 ms, no máximo 3 s) |
| `configOptions` (categoria `model`) → `session/set_config_option`; `models` → `session/set_model` | modelo escolhido no seletor; o nome mostrado é o legível (`qwen3-8b`, não `$runtime\|openai\|qwen3-8b(openai)`) |
| `modes` → `session/set_mode` | o modo do Kabul vira o do agente quando difere: padrão → `default`/`approve`, plan → `plan`, aceitar edições → `auto-edit`/`autoEdit`/`smart_approve`, aprovar tudo → `yolo`. Qwen Code e Goose nascem em `auto` (aprovam sozinhos), então sem isso o cartão nunca aparecia |
| `session/prompt` (mensagens antes da sessão ficam na fila) | turno; a resposta (`stopReason`, `usage`) vira fim de turno e uso de tokens. Sem `usage` na resposta, vale o `_meta.usage` do último `session/update` (Qwen Code) |
| `session/update` `agent_message_chunk` / `agent_thought_chunk` | texto em streaming / "Pensando" |
| `tool_call` / `tool_call_update` | cartão por `kind`: `execute` → Bash, `read` → Read, `edit` → Edit/Write (com o diff; `oldText` nulo ou vazio = Write), `search` → Grep, `fetch` → WebFetch. Com `kind: other` o tipo vem do nome da ferramenta (`_meta.goose.toolCall.toolName`, `_meta.toolName` ou o título "write · caminho"). O cartão aparece quando os parâmetros chegam |
| `plan` | lista de tarefas (TodoWrite) |
| `session/request_permission` | cartão de aprovação: ↵ `allow_once`, ⌘↵ `allow_always`, ⌫ `reject_once`. "Aprovar tudo"/accept-edits responde sozinho. Os parâmetros do pedido ficam na ferramenta (o Qwen Code manda o `tool_call` vazio e o comando só aqui) |
| `session/cancel` | "Parar": notificação de cancelamento e `cancelled` em todo pedido de permissão aberto, como a especificação pede. A sessão continua e aceita o próximo turno |
| `fs/read_text_file`, `fs/write_text_file` | o Kabul lê/grava o arquivo (com `line`/`limit`) |
| `terminal/create`, `output`, `wait_for_exit`, `kill`, `release` | o Kabul roda o processo, guarda o fim da saída (`outputByteLimit`) e responde o `wait_for_exit` quando ele termina, sem travar a leitura |
| erros | mensagem + `data` quando explica mais (o Goose manda "Internal error" e o motivo no `data`). Login (`-32000`, "API key", "provider"…) ganha a dica dos `authMethods` ("Log in with your Google account", "Run `goose configure`…"). Erro no `session/new` fecha o turno da mensagem que estava na fila |

## Navegador do Kabul (`kabul-browser`)

O MCP do navegador ([guia](pt-BR/guia/navegador.md)) chega aos agentes ACP como qualquer MCP do registro:
uma entrada stdio no `mcpServers` do `session/new` e do `session/load`, com `command` = o executável do
Kabul que iniciou a sessão (app desktop, `kabuld` ou `kabul`; `KABUL_MCP_BIN` troca) e
`args` = `["mcp", "browser", "--workspace", <id>, "--home", <estado>]`, mais `--plan-flag <arquivo>` (só leitura enquanto a conversa estiver em plan mode) e
`--allow-host <domínio>` para cada `browser_hosts` do repo. Exemplo do que vai no `session/new`:

```json
{ "name": "kabul-browser", "command": "<executável do Kabul>",
  "args": ["mcp", "browser", "--workspace", "w1", "--home", "/Users/eu/Library/Application Support/kabul"], "env": [] }
```

Nos outros harnesses é o mesmo servidor: Claude por `--mcp-config` (com
`--allowedTools=mcp__kabul-browser`, porque a aprovação é a do Kabul), Codex por
`-c mcp_servers.kabul-browser.command=…`/`.args=[…]`, Antigravity só exportando para a config global (com
`--workspace auto`, o workspace sai da pasta atual). Cada processo de agente conecta no mesmo Chromium do
workspace (descoberto pelo `DevToolsActivePort` do perfil), então todos e o humano veem a mesma aba. O nome
mostrado em "está controlando" é o `clientInfo.name` do `initialize` quando não vem `--agent`.

## Por agente

Tudo abaixo foi rodado nesta máquina com o CLI instalado, pelo harness do Kabul (`harness::spawn`, o
mesmo caminho do app), no teste ignorado `acp_real`. Sem conta e sem modelo local, o modelo é o LLM
falso de `crates/kabul-core/tests/fake-llm.mjs`: um servidor que fala OpenAI Chat Completions, OpenAI
Responses, Anthropic Messages e Gemini e responde por roteiro (marcadores `[KABUL-ESCREVER …]`,
`[KABUL-SHELL …]`, `[KABUL-LEMBRAR]`), achando as ferramentas pelo esquema que o próprio agente manda.
O CLI, o protocolo, as ferramentas, os pedidos de permissão e o disco são os de verdade.

| Agente | Comando | Estado | Como o modelo chega |
|---|---|---|---|
| OpenCode 2.1.4 | `opencode acp` | **Confirmado**: aprovar, negar, cancelar com a ferramenta rodando ("Tool execution interrupted"), novo turno, `session/load` | provider `kabul` openai-compatible em `OPENCODE_CONFIG_CONTENT`. O Kabul agora injeta `permission` (`ask` no modo padrão): o padrão do OpenCode aprova edição e shell sozinho |
| Gemini CLI 0.65 | `gemini --acp [-m modelo]` (`--experimental-acp` está depreciado) | **Confirmado** com gateway Gemini de teste: aprovar, negar, cancelar com o cartão aberto, `session/load`. Conta Google: confirmado até o login (sem conta: `-32000 Gemini API key is missing or not configured.`) | conta do CLI, ou endpoint que fale a API do Gemini: `GOOGLE_GEMINI_BASE_URL` + `GEMINI_API_KEY` (http só em localhost). LM Studio e Ollama não falam essa API |
| Qwen Code 0.26.1 | `qwen --acp --approval-mode <modo>` | **Confirmado** com o servidor de teste (aprovar, negar, cancelar com o cartão aberto: "cancelled before execution", `session/load`) e com qwen3-8b de verdade no LM Studio (turno com escrita de arquivo aprovada pelo app) | `--auth-type openai` + `OPENAI_BASE_URL`/`OPENAI_API_KEY`/`OPENAI_MODEL`. Sem `--auth-type` o `session/new` pede login. `QWEN_CODE_API_TIMEOUT_MS=900000` para endpoint local: o prompt do Qwen Code tem ~20 mil tokens e o padrão de 120 s cortava o turno ("Connection error") |
| Goose 1.55 | `goose acp` | **Confirmado**: aprovar, negar, cancelar, `session/load`; escreve pelo `fs/write_text_file` do Kabul | `GOOSE_PROVIDER=openai`, `OPENAI_HOST` (sem `/v1`), `OPENAI_API_KEY`, `GOOSE_MODEL`. Sem provedor: "Failed to resolve provider: … GOOSE_PROVIDER" com a dica de `goose configure` |
| Cursor | `cursor-agent acp` | A confirmar (não instalado) | modelos do Cursor; sem endpoint local |

Detalhes que só apareceram rodando de verdade:

- **Gemini CLI e o `fs` do cliente.** Antes de escrever, o Gemini CLI lê o arquivo pelo
  `fs/read_text_file`. O SDK ACP dele rejeita o erro do cliente como objeto simples e o
  `normalizeFileSystemError` só reconhece "arquivo não existe" num `Error`; o resultado é que ele não
  cria arquivo novo ("Error checking existing file"). Como o `fs/*` do Kabul só lê e grava o disco, para o
  Gemini o Kabul não anuncia `fs` e ele usa o próprio sistema de arquivos (`AcpOptions::no_client_fs`).
- **Replay depois do `load`.** O Gemini CLI começa a reproduzir o histórico antes da resposta do
  `session/load` e continua depois dela (`user_message_chunk` e o texto antigo do agente).
- **Qwen Code bloqueia `sleep`** antes de pedir permissão ("Run blocking commands in the background"):
  o teste de cancelar usa `ping -c 20`.
- **Pedidos próprios.** O Qwen Code pede `craft/drainMidTurnQueue` ao cliente; o Kabul responde
  "método não suportado" e o turno segue.

Os modos por turno antigos do OpenCode e do Gemini CLI continuam no código (`OpenCode::run_command`,
`GeminiCli::print_command`) e nos testes, caso um CLI instalado não tenha o ACP.

## Plan mode em todos os harnesses

O Kabul começa a sessão em plan pelo mecanismo de cada CLI e, ao aprovar o plano, troca o modo da sessão
que está rodando (`Running::set_mode`), sem perder a conversa. Confirmado no teste ignorado `plan_real`
(CLI de verdade + LLM falso: em plan a escrita não acontece mesmo aprovando o cartão; depois de sair, a
mesma sessão escreve):

| Agente | Entrar em plan | Sair ao vivo | Observação |
|---|---|---|---|
| Claude Code | `--permission-mode plan` | `control_request` `set_permission_mode` | Com `--permission-prompt-tool` o Claude pergunta ao app até em plan, e aprovar escrevia: o Kabul nega Write/Edit/MultiEdit/NotebookEdit sozinho enquanto estiver em plan (Bash continua no cartão) |
| Codex | `collaborationMode` `plan` no `turn/start` (`collaborationMode/list`: plan, default) | o próximo turno manda `default` | Precisa de `capabilities.experimentalApi` no `initialize`: sem ela o app-server descarta o turno em silêncio. O plan do Codex não impede o comando se o app aprovar: o Kabul recusa as aprovações em plan |
| Gemini CLI, Qwen Code | `session/set_mode` `plan` | `session/set_mode` `default` | Nativo: o Gemini só escreve na pasta de planos; o Qwen bloqueia ferramentas que mudam algo |
| OpenCode, Goose | emulado | desliga o emulado e volta ao `default`/`approve` | O `opencode acp` 2.1.4 não anuncia modos; o Goose não tem modo de planejamento. O Kabul põe a instrução no primeiro prompt, nega Edit/Write/Bash sem cartão e mostra "Plan mode (emulado)" |
| Antigravity | `--mode plan` | reinicia com `--conversation` e o modo novo | Sem troca ao vivo no stream-json (não retestado nesta rodada) |
| Cursor | emulado (a confirmar) | — | Não instalado |

## Modelos locais e o registro por família

O LM Studio expõe as APIs OpenAI (`/v1/chat/completions`, `/v1/responses`) e Anthropic
(`/v1/messages`; conferido com qwen3-8b). O registro escolhe o primeiro harness instalado que fale uma
API do servidor:

- **Qwen** (`qwen3-8b`, `qwen3-coder-30b-a3b-instruct`…) → Qwen Code apontado para o endpoint; sem ele,
  OpenCode (oferecendo instalar o Qwen Code).
- **Outros** (Llama, Mistral…) → OpenCode; sem ele, Goose.
- **DeepSeek, Kimi, GLM, MiniMax** → Claude Code quando o servidor fala Anthropic. O Kabul passa o
  endpoint também no `env` de `--settings`: um `ANTHROPIC_BASE_URL` no `~/.claude/settings.json` do
  usuário ganhava da variável do processo e o modelo local ia para outro servidor. Confirmado com o
  servidor de teste (aprovar, negar, cancelar, retomar).
- **gpt-oss** → Codex com provider `kabul` por `-c`. O Codex 0.164 não aceita mais `wire_api = "chat"`
  (erro ao carregar a config); agora é `responses`. Confirmado com o servidor de teste (aprovar, negar,
  `turn/interrupt`, `thread/resume`).
- **Gemma** → Gemini CLI só com gateway que fale a API do Gemini; com LM Studio/Ollama, OpenCode.

`kabul chat "<prompt>" --local <modelo> [--agente <x>]` roda um turno pelo registro, ou com o harness
de `--agente` se ele falar uma API do servidor.

## Testes

- Fixtures de saídas reais, sem IDs nem caminhos pessoais: `acp_qwen.ndjson` (permissão com o
  `tool_call` vazio, negar, `_meta.usage`, `craft/*`), `acp_goose.ndjson` (`auto` → `approve`,
  `kind: other`, `fs/write_text_file`), `acp_gemini.ndjson` (sem `fs`, `allow_always`, `usage`) e
  `acp_gemini_load.ndjson` (replay depois do `load`). A do OpenCode (`acp_opencode.ndjson`) continua
  sintética a partir de uma sessão real.
- `fs/*` e `terminal/*` contra o sistema de arquivos e processos de verdade (`cliente_fs_terminal_e_erros`);
  retomar sem replay e negar (`negar_e_retomar_sem_replay`, `replay_depois_do_load`); erros de login
  reais (`erros_de_login_reais`).
- De ponta a ponta com o CLI instalado e o LLM falso (não precisa de conta nem de modelo):
  `KABUL_TESTE_ACP_AGENTE=<opencode|gemini|qwen|goose|claude|codex> KABUL_TESTE_ACP_FALSO=1 cargo test -p kabul-core acp_real -- --ignored --nocapture`.
- Plan mode: `KABUL_TESTE_PLAN_AGENTE=<claude|codex|gemini|qwen|opencode|goose> cargo test -p kabul-core plan_real -- --ignored --nocapture`.
- Navegador do Kabul (navigate → snapshot → click numa página local servida pelo teste, MCP embutido servido pelo
  binário `kabul`): `KABUL_TESTE_BROWSER_AGENTE=<claude|codex|gemini|qwen|opencode|goose> cargo test -p kabul-cli --test navegador agente_real -- --ignored --nocapture`
  (`KABUL_BROWSER_BIN` escolhe o Chromium; sem ele, o Chrome/Edge instalado).
  Com modelo local: `KABUL_TESTE_ACP_LOCAL=<id>`; com a conta do agente: `KABUL_TESTE_ACP_MODELO=<modelo>`.

## Pendências

- Listar modelos dos agentes ACP pelo `configOptions`/`models` do `session/new` (hoje o seletor só mostra
  os de OpenCode via registro).
- MCP: o Kabul já manda os MCPs das outras IAs no `mcpServers` do `session/new`/`session/load` (http/sse
  só se o agente anunciar em `mcpCapabilities`); ver [MCP](pt-BR/guia/mcp.md). Falta desligar MCP nativo do Goose.
- Status de login real de Gemini CLI, Qwen Code e Goose em Configurações › Contas (hoje "instalado" conta
  como conectado).
- Cursor (`cursor-agent acp`): instalar e confirmar.
