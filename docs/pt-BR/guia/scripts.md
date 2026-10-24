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
