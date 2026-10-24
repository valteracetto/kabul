[English](../../guide/concepts.md) · Português

# Conceitos

**Projeto (repositório).** Um repositório git que você adicionou. O Kabul nunca mexe na pasta principal; cria worktrees ao lado.

**Workspace.** Uma tarefa. Um git worktree em `~/kabul/workspaces/<projeto>/<cidade>` na sua própria branch, com dez portas reservadas (`KABUL_PORT` … `KABUL_PORT+9`), terminal, scripts de setup/run e quantas conversas quiser. Tem status (Backlog, Em andamento, Em revisão, Concluído, Cancelado), pode ser fixado, agrupado em seções, marcado como não lido e arquivado. Arquivar guarda todas as mudanças num checkpoint e remove o worktree; desarquivar traz de volta.

**Branch e branch alvo.** Workspaces novos nascem da branch base (a padrão, ou a definida em **Configurações › Git**). A branch alvo (aparece como `→ main` ao lado da branch) é contra o que o diff e o pull request comparam.

**Harness.** O agente de linha de comando que roda um modelo: Claude Code, Codex, Antigravity, OpenCode, Qwen Code ou Gemini CLI. Modelos locais rodam pelo harness escolhido no [registro de harness](./agentes.md#registro-de-harness).

**Onde roda.** Cada conversa mostra onde roda: neste Mac, na nuvem do provedor (`claude --cloud`) ou, em breve, em outra máquina pelo Tailscale.

**Contas.** Dá para ter vários logins por provedor (por exemplo, uma conta pessoal e uma do trabalho no Claude). Cada perfil tem a configuração isolada, e cada conversa mostra qual conta usa.

**Máquinas.** O seletor de máquina no topo da barra lateral troca entre este Mac e outras máquinas com o `kabuld` (`⌃1` … `⌃9`).

![Barra lateral com seções, fixados e status](/screens/barra-lateral.png)
