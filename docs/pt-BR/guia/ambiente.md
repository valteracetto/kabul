[English](../../guide/environment.md) · Português

# Variáveis `KABUL_*`

Scripts, terminais e agentes recebem:

| Variável | Valor |
|---|---|
| `KABUL_WORKSPACE_NAME` | Nome do workspace (a cidade) |
| `KABUL_WORKSPACE_ID` | Id do workspace |
| `KABUL_WORKSPACE_PATH` | Pasta do worktree |
| `KABUL_ROOT_PATH` | Pasta principal do repositório |
| `KABUL_DEFAULT_BRANCH` | Branch padrão |
| `KABUL_TARGET_BRANCH` | Branch alvo do workspace |
| `KABUL_PORT` | Primeira de dez portas reservadas (`KABUL_PORT` … `KABUL_PORT+9`) |
| `KABUL_IS_LOCAL` | `1` quando roda nesta máquina |

## Suas variáveis

**Configurações › Ambiente** tem dois escopos:

- **Usuário**: variáveis para todas as conversas, ou só para um agente (`claude`, `codex`, `opencode`…). Cole linhas `KEY=VALUE` em bloco ou aponte um arquivo `.env`.
- **Repositório**: as compartilhadas de `.kabul/settings.toml` aparecem como herdadas; as suas vão para `settings.local.toml` e sobrescrevem.
