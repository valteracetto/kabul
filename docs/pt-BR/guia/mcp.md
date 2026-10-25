[English](../../guide/mcp.md) · Português

# MCP

## Um registro para todas as IAs

Um MCP configurado em qualquer IA vale nas outras. O Kabul lê as configs nativas de cada CLI e monta um
registro único:

| CLI | De onde lê |
|---|---|
| Claude Code | `~/.claude.json` (usuário e projeto local) e `.mcp.json` do projeto |
| Codex | `config.toml` (`[mcp_servers]`) |
| OpenCode | `opencode.json` (`mcp`) |
| Gemini CLI / Qwen Code | `settings.json` (`mcpServers`) do usuário e do projeto |
| Antigravity | `~/.gemini/config/mcp_config.json` |

Ao iniciar a sessão, o Kabul passa os MCPs ligados no formato de cada CLI, só naquela sessão e sem mexer
nas configs do usuário:

| CLI | Como recebe | Desligar um MCP dele mesmo |
|---|---|---|
| Claude Code | `--mcp-config` com os de outras IAs | `--strict-mcp-config` com só os ligados |
| Codex | `-c mcp_servers.<nome>.*` | `mcp_servers.<nome>.enabled=false` |
| Gemini CLI, Qwen Code, Goose | `mcpServers` no `session/new` do ACP | Gemini `--allowed-mcp-server-names`, Qwen `--disable-mcp-server`, Goose: ainda não |
| OpenCode | `mcp` na config injetada (`OPENCODE_CONFIG_CONTENT`) | `mcp.<nome>.enabled=false` |
| Antigravity | a config de MCP dele é só global: **Exportar para o Antigravity** grava no arquivo global, com backup | ainda não |

A mesma lista vale ao trocar de LLM na conversa: cada início de sessão passa pelo mesmo caminho.

Valores de variáveis (`env`) e cabeçalhos (tokens) nunca aparecem no painel nem na linha de comando: no
Codex vão pelo ambiente do processo (`env_vars`, `env_http_headers`); no Claude, num arquivo só seu (0600).

**Remotos com login (OAuth)** ficam só no CLI de origem até você ligar "todas as IAs": o token mora no
cofre daquele CLI e outro CLI travaria abrindo um login novo (o Gemini CLI segura o início da sessão até
cada MCP conectar). Remotos com token fixo em cabeçalho e servidores locais (stdio) são compartilhados
por padrão.

## Painel da sessão

O botão de MCP no composer lista o registro inteiro:

- **Origem** ("do Claude", "do Codex"…) e **conflito** quando o mesmo nome tem configurações diferentes
  em CLIs diferentes (vale a primeira, na ordem Claude, Codex, OpenCode, Gemini CLI, Qwen Code, Antigravity).
- **Peso no contexto**: ferramentas e tokens estimados das definições (enviadas em todo turno). "Medir peso"
  abre o servidor local, pede a lista de ferramentas e guarda o resultado.
- **Ligar/desligar nesta sessão** (lembrado na aba) e **desligar no repo** (padrão do repositório), com
  efeito no próximo turno em qualquer IA.
- **Perfis**: "Todos" e "Só o essencial" (os marcados com ★ neste repositório), e a economia estimada
  ("−3,2k tokens por turno").
- **Todas as IAs**: desligado, o MCP fica só nos CLIs de origem.
- **Adicionar MCP ao projeto** grava no `.mcp.json` do projeto.

## Gemini CLI e pasta confiável

O Gemini CLI desliga todo MCP em pasta não confiável, inclusive os que chegam pelo ACP. Quando o Kabul
injeta MCPs numa sessão do Gemini CLI, ele marca a pasta como confiável só para aquela sessão
(`GEMINI_CLI_TRUST_WORKSPACE=true`, a mesma variável do `--skip-trust`), sem gravar no
`trustedFolders.json`. Isso também libera os MCPs do `.gemini/settings.json` do próprio projeto.

## O que foi confirmado

Um servidor MCP de teste (`crates/kabul-core/tests/eco-mcp.mjs`, ferramenta `eco`) configurado **só no
Claude** (`.mcp.json` do projeto) foi chamado pelo Kabul com o CLI de verdade e o LLM falso de teste:

- Gemini CLI 0.65 e Goose 1.55: pelo `mcpServers` do ACP, com cartão de aprovação no app.
- Qwen Code 0.26.1: pelo ACP; ele esconde ferramentas MCP atrás do `tool_search`/`tool_call`.
- Codex 0.164: pelo `-c mcp_servers.*`; a aprovação chega como `mcpServer/elicitation/request` e virou
  cartão no app (antes o turno ficava parado).
- OpenCode 2.1.4: **em parte**. Ignora o `mcpServers` do ACP; pela config injetada ele conecta o servidor
  ("mcp connected … tools=1" no log), mas não o põe no catálogo do "Code Mode" que o modelo vê.
- Antigravity: só exportando para a config global (não testado contra o agy de verdade para não mexer na
  config do usuário).

`KABUL_TESTE_MCP_AGENTE=<gemini|qwen|goose|codex|opencode> cargo test -p kabul-core mcp_compartilhado_real -- --ignored --nocapture`
