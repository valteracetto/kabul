[English](../../guide/quick-start.md) · Português

# Início rápido

1. **Instale o Kabul** (macOS) e pelo menos um CLI de agente, por exemplo o Claude Code (`claude`) ou o Codex (`codex`). Veja [Instalação](./instalacao.md).
2. **Adicione um projeto.** Aperte `⌘N`, abra o seletor de projeto e escolha **Abrir projeto** (uma pasta git local), **Abrir projeto do GitHub** (um repositório da sua conta ou uma URL; o Kabul clona com a credencial do GitHub CLI) ou **Início rápido** (pasta nova com `git init`, README e o primeiro commit).
3. **Crie um workspace.** Escreva no que quer trabalhar e aperte `↵`. O Kabul cria um git worktree numa branch nova (`<seu usuário do GitHub>/<cidade>`), copia os arquivos `.env*`, roda o script de setup e manda a primeira mensagem ao agente. `⌥↵` põe no backlog.
4. **Converse com o agente.** Escolha o modelo com `⌘/`, anexe arquivos com `⌘U`, mencione arquivos com `@` e rode comandos com `/`. Aprove ferramentas com `↵`, sempre permita com `⌘↵`, negue com `⌫`.
5. **Revise.** O painel direito mostra as alterações (`⌘⌥B` mostra/oculta). Abra um arquivo para ver o diff, comente numa linha e mande os comentários ao agente.
6. **Entregue.** O botão do git acompanha o estado da branch: **Criar PR** (`⌘⇧P`), **Commit e push** (`⌘⇧Y`), **Pull** (`⌘⇧L`), **Corrigir erros** (`⌘⇧X`), **Merge** (`⌘⇧M`) e **Arquivar** (`⌘⇧A`).

![Workspace com o menu do git](/screens/git-menu.png)

Próximo: [Conceitos](./conceitos.md).
