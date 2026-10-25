[English](../../guide/concepts.md) · Português

# Conceitos

![Quadro com os workspaces por status](../../assets/workspaces.png)

**Projeto (repositório).** Um repositório git que você adicionou. O Kabul nunca mexe no checkout principal; ele
cria worktrees ao lado.

**Workspace.** Uma tarefa. Um git worktree em `~/kabul/workspaces/<projeto>/<cidade>` na sua própria branch, com
dez portas reservadas (`KABUL_PORT` … `KABUL_PORT+9`), terminal, scripts de setup/run e quantas conversas quiser.
Tem status (Backlog, Em andamento, Em revisão, Concluído, Cancelado), pode ser fixado, agrupado em seções,
marcado como não lido e arquivado. Arquivar guarda todas as mudanças num checkpoint e remove o worktree;
desarquivar traz de volta. O **Quadro** mostra os workspaces por status.

**Branch e branch alvo.** Workspaces novos saem da branch base (a branch padrão, ou a definida em
**Configurações › Git**). A branch alvo (aparece como `→ main` ao lado da branch) é contra quem o diff e o pull
request comparam.

**Conversa (sessão).** Uma conversa com um agente dentro de um workspace. Um workspace pode ter várias, em abas
(lado a lado com `⌘D`). Cada conversa tem modelo, conta, modo (padrão, plano, aceitar edições, aprovar tudo) e
uma fila para as mensagens mandadas enquanto o agente trabalha.

**Harness.** O agente de linha de comando que roda um modelo: Claude Code, Codex, Antigravity, Gemini CLI, Qwen
Code, OpenCode, Goose ou outro agente [ACP](../../acp.md). O Kabul conduz o CLI de verdade, então você mantém o
comportamento, as atualizações e as configurações dele. Modelos locais vão para o harness escolhido pelo
[registro por família](./modelos-locais.md#o-registro-por-familia).

**Transcript.** O registro do Kabul de cada conversa, que não depende de harness: cada mensagem com o autor
(você, um convidado, um agente com o modelo), ferramentas, aprovações, trocas de modelo e uso por turno. É ele
que permite [trocar de modelo ou conta](./trocar.md) no meio da conversa, fazer fork e reset.

**Checkpoint.** Uma foto do worktree tirada antes de cada mensagem enviada, guardada em refs privadas do git
(`refs/kabul-checkpoints/…`) sem mexer na sua branch nem no `HEAD`. Restaure pela mensagem ou pela aba
**Checkpoints** do painel da direita; as mudanças posteriores são descartadas.

**Onde roda.** Cada conversa mostra onde roda: neste computador, na nuvem do provedor (sessões na nuvem do
Claude Code) ou em outra máquina com o `kabuld`.

**Contas.** Dá para ter vários logins por provedor (por exemplo, uma conta do Claude pessoal e uma do trabalho).
Cada perfil tem uma pasta de configuração isolada, e cada conversa mostra qual conta usa.

**Máquinas e `kabuld`.** O `kabuld` é o servidor do Kabul. Ligado, ele espelha todas as sessões do computador
para o celular, para outras máquinas e para convidados. O seletor de máquina no topo da barra lateral troca o
app inteiro para outra máquina (`⌃1` … `⌃9`).

**Papéis.** Você é o **dono** da sua máquina. Os seus aparelhos pareados também são donos. Convidados entram num
workspace como **editor** (manda mensagens, aprova e digita) ou **observador** (só acompanha). Veja
[Colaboração](./colaboracao.md).

![Barra lateral com seções, workspaces fixados e status](/screens/barra-lateral.png)
