[English](README.md) · Português

# Kabul

Agentes de código em paralelo, cada um no seu git worktree. Rode Claude Code, Codex, Gemini (Antigravity), OpenCode, Qwen Code e modelos locais lado a lado; troque de modelo ou de conta no meio da conversa; revise o diff, comente para o agente e entregue o pull request; acompanhe cada sessão pelo celular.

- **Workspaces**: um git worktree e uma branch por tarefa, com portas reservadas, scripts de setup/run/archive, terminal e quantas conversas quiser.
- **Qualquer agente**: aprovações de ferramentas, plan mode, perguntas, fila de mensagens, forks e resets; as listas de modelos vêm das suas contas.
- **Revisar e entregar**: diff lado a lado com comentários por linha, checks com logs, commit e push, pull, merge, pronto para revisão e arquivar.
- **Tudo à mão**: paleta de comandos (`⌘K`), abrir arquivo (`⌘P`), buscar nos arquivos (`⌘⇧F`), seções, status e workspaces fixados.

Documentação: [docs/pt-BR/](docs/pt-BR/index.md) ([guia](docs/pt-BR/guia/inicio-rapido.md)). macOS hoje; Windows em breve.

```sh
cargo test
cd apps/web && npm install && npm run build && npm run e2e
cd apps/desktop && npx tauri build
```

Veja [Como contribuir](docs/pt-BR/guia/contribuir.md).
