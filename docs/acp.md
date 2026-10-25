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
  A família `outros` agora cai em OpenCode e, sem ele, em Goose.

## O que o harness faz

| ACP | Kabul |
|---|---|
| `initialize` (cliente anuncia `fs.readTextFile`, `fs.writeTextFile` e `terminal`) | handshake na partida |
| `session/new` / `session/load` (com `loadSession`) | conversa nova / retomar (o histórico que o agente reproduz no `load` é ignorado: o Kabul já tem o dele) |
| `configOptions` (categoria `model`) → `session/set_config_option`; `models` → `session/set_model` | modelo escolhido no seletor |
| `modes` com `plan` → `session/set_mode` | plan mode |
| `session/prompt` (mensagens antes da sessão ficam na fila) | turno; a resposta (`stopReason`, `usage`) vira fim de turno e uso de tokens |
| `session/update` `agent_message_chunk` / `agent_thought_chunk` | texto em streaming / "Pensando" |
| `tool_call` / `tool_call_update` | cartão por `kind`: `execute` → Bash, `read` → Read, `edit` → Edit/Write (com o diff), `search` → Grep, `fetch` → WebFetch; outros com título e parâmetros. O cartão aparece quando os parâmetros chegam |
| `plan` | lista de tarefas (TodoWrite) |
| `session/request_permission` | cartão de aprovação: ↵ `allow_once`, ⌘↵ `allow_always`, ⌫ `reject_once`. "Aprovar tudo"/accept-edits responde sozinho |
| `fs/read_text_file`, `fs/write_text_file` | o Kabul lê/grava o arquivo (com `line`/`limit`) |
| `terminal/create`, `output`, `wait_for_exit`, `kill`, `release` | o Kabul roda o processo, guarda o fim da saída (`outputByteLimit`) e responde o `wait_for_exit` quando ele termina, sem travar a leitura |
| erro de autenticação | erro com a dica de fazer login |

## Por agente

| Agente | Comando | Estado | O que ganha |
|---|---|---|---|
| OpenCode | `opencode acp` | **Confirmado** (2.1.4): handshake, troca de modelo, ferramenta com permissão aprovada pelo app e fim de turno com `usage` (teste ignorado `opencode_acp_real`) | Antes era um processo por turno (`opencode run`) sem aprovações (`run` nega). Agora sessão persistente, aprovações no app e modelo local via `OPENCODE_CONFIG_CONTENT` como antes |
| Gemini CLI | `gemini --experimental-acp [-m modelo]` | A confirmar (não instalado aqui) | Antes por turno com stream-json; agora aprovações no app e sessão persistente |
| Qwen Code | `qwen --experimental-acp` (+ `--model`, endpoint em `OPENAI_*`) | A confirmar (não instalado aqui) | Antes stream-json emprestado do Claude; agora o protocolo oficial |
| Goose | `goose acp` (endpoint: `GOOSE_PROVIDER=openai`, `OPENAI_HOST`, `GOOSE_MODEL`) | A confirmar | Novo no Kabul, inclusive para modelos locais pelo registro |
| Cursor | `cursor-agent acp` | A confirmar | Novo no Kabul (modelos do Cursor; sem endpoint local) |

O modo por turno antigo do OpenCode e do Gemini CLI continua no código (`OpenCode::run_command`,
`GeminiCli::print_command`) e nos testes, caso um CLI instalado não tenha o ACP.

## Testes

- Fixture sintética de uma sessão real do OpenCode (`tests/fixtures/acp_opencode.ndjson`): handshake,
  modelo, ferramentas, permissão e fim de turno.
- `fs/*` e `terminal/*` contra o sistema de arquivos e processos de verdade (`cliente_fs_terminal_e_erros`).
- Retomar com `session/load` sem reproduzir o histórico e negar permissão (`negar_e_retomar_sem_replay`).
- OpenCode real: `KABUL_TESTE_ACP_MODELO=opencode/<modelo> cargo test -p kabul-core opencode_acp_real -- --ignored`.

## Pendências

- Listar modelos dos agentes ACP pelo `configOptions` do `session/new` (hoje o seletor só mostra os de OpenCode via registro).
- MCP por sessão (`mcpServers` no `session/new`) e `session/cancel` ao parar (hoje o processo é encerrado).
- Confirmar Gemini CLI, Qwen Code, Goose e Cursor com os CLIs instalados (flags e login).
