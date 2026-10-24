[English](../../guide/faq.md) · Português

# Perguntas frequentes

**Onde ficam meus dados?** Em `~/Library/Application Support/kabul` (configurações, histórico das conversas, logs) e `~/kabul/workspaces` (worktrees). Nada sai da sua máquina além do que os agentes e o `gh` enviam.

**O terminal diz que a sessão terminou logo ao abrir.** Confira se o `tmux` está instalado. O Kabul usa `tmux -u`, então funciona mesmo aberto pelo Dock sem locale UTF-8.

**O agente não respondeu nada.** O chat mostra as últimas linhas que o agente escreveu no stderr, e `logs/agents.log` registra cada sessão (comando, argumentos e nomes das variáveis de ambiente, nunca os valores). **Ajuda › Diagnóstico** verifica suas ferramentas e copia um relatório sem dados pessoais.

**Posso usar os arquivos de configuração que já tenho?** Sim. O Kabul lê `.kabul/settings.toml` e também entende o formato legado comum de outras ferramentas de worktree.

**O Kabul manda algo ao GitHub sozinho?** Só quando você aperta push, merge, ready, re-rodar ou criar PR. **Configurações › Git › Simular ações do GitHub** mostra os comandos sem rodar.
