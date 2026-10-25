[English](../../guide/scripts.md) · Português

# Scripts e `.kabul/settings.toml`

As configurações são lidas em camadas, da maior para a menor prioridade:

1. `~/.kabul/settings.managed.toml` (gerenciada)
2. `<repo>/.kabul/settings.local.toml` (sua, fora do git)
3. `<repo>/.kabul/settings.toml` (compartilhada, lida da branch padrão no remoto)
4. `~/.kabul/settings.toml` (usuário)

```toml
target_branch = "main"
base_branch = "develop"        # workspaces novos nascem daqui
remote = "origin"
file_include_globs = ["config/*.local.json"]   # ignorados copiados para cada worktree (além de .env* e .worktreeinclude)
preview_url = "http://localhost:$KABUL_PORT"
browser_hosts = ["staging.example.com"]   # navegador: domínios abertos sem pedir aprovação

[scripts]
setup = "npm install"
archive = "docker compose down"
run_mode = "concurrent"        # ou "nonconcurrent"

[scripts.run.web]
command = "npm run dev -- --port $KABUL_PORT"
default = true

[env]
API_URL = "http://localhost:$((KABUL_PORT+1))"

[prompts]
review = "Foque em segurança."
general = "Responda em português e rode os testes antes de dizer que terminou."
```

- **Setup** roda ao criar o workspace (log em `.context/setup-logs.txt`). **Run** sobe pelo painel de baixo ou com `⌘R` no terminal. **Archive** roda antes de arquivar.
- **Prompts** acrescentam instruções às ações Revisar, Criar PR, Corrigir erros, Resolver conflitos e ao nome da branch; `general` também vai para o Claude como instrução de sistema. Edite em **Configurações › Ações**.

## Ações: argumentos, pasta e ocultar

```toml
[scripts.run.storybook]
command = "pnpm storybook"
args = ["--port", "6006"]        # acrescentados ao comando, com as aspas do shell
options.cwd = "packages/ui"      # pasta dentro do workspace
available_in = "local"           # texto ou lista

[[preview_urls]]                 # várias URLs de preview; a primeira é a padrão
name = "Web"
url = "http://localhost:$KABUL_PORT"
```

No `settings.local.toml`, `hide = true` em `[scripts.run.<id>]` esconde uma ação compartilhada só na sua máquina
(sem precisar de `command`: os outros campos da ação compartilhada continuam).

## Arquivos a copiar

O workspace novo recebe os arquivos ignorados pelo git que batem com `.env*`, `file_include_globs` e
`.worktreeinclude`, nesta ordem. Como no `.gitignore`, o último padrão vence: `!.env.production` em
`file_include_globs` ou no `.worktreeinclude` deixa esse arquivo de fora. `file_include_globs` pode ser lista ou
texto com um padrão por linha.

## Configurações que não foram lidas

Cada chave é lida sozinha: um valor de tipo errado (um número onde se esperava texto, por exemplo) é ignorado com um
aviso, e o resto do arquivo continua valendo. **Configurações › Scripts** mostra a faixa "Algumas configurações não
foram lidas" com o arquivo, a chave e o motivo, e **Ajuda › Diagnóstico** lista o mesmo por repositório. Chaves
desconhecidas também aparecem.

## Configuração legada de outro app

Quando o repositório não tem a pasta `.kabul/`, o Kabul lê `settings.toml` e `settings.local.toml` da pasta de
configuração do app que ele substitui. Enquanto não houver um `settings.toml` compartilhado (em nenhuma das duas
pastas), ele lê também o arquivo JSON antigo desse app, na raiz ou dentro da pasta dele. O formato documentado para
essa pasta é entendido como está:

| Lá | No Kabul |
|---|---|
| `file_include_globs = ".env*\nconfig/*.local.json"` (texto) | a lista de padrões |
| `scripts.run = "pnpm dev"` (ação única) | a ação `dev`, padrão |
| `scripts.run.<id>` com `args`, `options.cwd`, `hide`, `available_in` | os mesmos campos |
| `[environment_variables]` e `[environment_variables.local]` | `[env]` |
| `[[preview_urls]]` | `preview_urls` (a primeira também vira `preview_url`) |
| `[git] archive_on_merge`, `delete_branch_on_archive` | as mesmas chaves no topo |
| `prompts.code_review`, `resolve_merge_conflicts`, `rename_branch` | `review`, `resolve_conflicts`, `branch_rename` |
| `runScriptMode` no arquivo JSON | `scripts.run_mode` |

O que não tem equivalente (`environment_variables.cloud`, `enterprise_data_privacy`, `spotlight_testing`, chaves de
provedor) ou fica nas configurações do próprio Kabul (`git.branch_prefix*`, executáveis, modelos) aparece na faixa de
avisos em vez de sumir calado. As variáveis também saem com o prefixo legado: scripts escritos para esse app (o
`…_PORT`, o `…_WORKSPACE_PATH` etc. dele) seguem funcionando ao lado dos `KABUL_*`.

**Importar configuração legada** (em **Configurações › Scripts**) converte essa configuração para
`.kabul/settings.toml` (e `settings.local.toml`, se houver). Primeiro mostra o arquivo gerado, com as chaves não
importadas listadas no topo, e só grava depois da sua confirmação. Nunca sobrescreve um arquivo que já existe e não
mexe nos originais; confira e faça o commit.
