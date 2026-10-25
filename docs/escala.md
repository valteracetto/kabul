# Escala: muitos agentes, subagentes e workspaces

Meta do produto: 100 workspaces e 30 agentes rodando juntos, com árvores de subagentes, sem a UI perder
fluidez. Este documento descreve o contrato entre o frontend e o backend (kabuld/core) para isso, como a
UI se organiza e como medir.

## Contrato frontend ↔ backend

Tudo passa pelo transporte de sempre (comando request/response e canal de eventos). Os comandos novos
são opcionais: sem eles (ex.: o app Tauri de hoje), a UI esconde a parte que depende deles e segue
funcionando.

### Fila e limite de agentes simultâneos

`agents_status` → estado da fila:

```json
{
  "limit": 8,                 // null = sem limite
  "running": 8,
  "queued": [{ "chat_id": "c12", "position": 1, "workspace_id": "w3" }],
  "running_chats": ["c1", "c2"],   // opcional
  "suspended": ["c9"],             // opcional: encerrados por ociosidade, retomáveis
  "focus": "w3",                   // opcional: workspace com prioridade
  "idle_minutes": 30               // opcional
}
```

`agents_config { limit?, idleMinutes?, niceBackground? }` → o mesmo objeto de `agents_status` (`limit` null ou 0 = sem limite). Cada mudança também chega no canal `agents-status` (mesmo objeto), que o painel Agentes assina.

`agents_focus { workspaceId }` → o workspace em foco ganha prioridade na fila. A UI chama ao trocar de
workspace (e para de chamar se o comando não existir).

Eventos no canal `chat-event` (mesmo envelope `{ chat_id, event }`):

| evento | quando |
|---|---|
| `{ "type": "queued", "position": 2, "limit": 8 }` | `chat_send`/`chat_start` esperando vaga; reenviado quando a posição muda |
| `{ "type": "slot_acquired" }` | ganhou a vaga e começou a rodar |
| `{ "type": "suspended" }` | encerrado por ociosidade (a sessão continua retomável) |
| `{ "type": "resumed" }` | retomado |

Na UI: a conversa mostra "Aguardando vaga · 2º na fila (limite de 8 agentes ao mesmo tempo)" no lugar
da linha de trabalho; a aba e a linha do workspace na barra lateral ganham um ponto tracejado; o painel
Agentes lista a conversa em "Aguardando vaga" e mostra o limite (com campo para mudar, via `agents_config`).

### Subagentes

Qualquer `AgentEvent` pode trazer `parent_tool_use_id` (como o stream-json do Claude Code): o id do
`tool_use` Task/Agent que lançou o subagente que gerou aquele evento.

- `tool_use` com `name` Task ou Agent vira um nó (descrição, tipo, início). Sem `parent_tool_use_id`, é
  filho da conversa; com, é filho do subagente indicado (árvores de qualquer profundidade).
- `tool_result` do nó encerra o nó (concluído ou falhou); `exited` ou Parar marcam os abertos como
  interrompidos.
- `tool_use` com `parent_tool_use_id` soma nas ferramentas do nó pai; `usage` e `turn_completed` com
  `parent_tool_use_id` somam tokens e custo no nó.
- Eventos com `parent_tool_use_id` não entram no fio principal da conversa (só na árvore).

Sem `parent_tool_use_id` no backend, a árvore mostra só os Task/Agent do primeiro nível (com status e
tempo), também para conversas antigas (lidos do histórico).

### Parar em lote

`chats_interrupt { chatIds: string[] }` → `{ stopped: string[], errors: [{ chat_id, error }] }`. Sem o
comando, a UI chama `chat_interrupt` uma conversa por vez (e `chat_stop` onde não houver `chat_interrupt`, como no kabuld).

## Como a UI se organiza

- **Registro de conversas** (`apps/web/src/components/chatStore.ts`): uma inscrição só em `chat-event`
  para o app inteiro. A conversa na tela recebe os eventos em lote, um lote por frame. As demais (outra
  aba, workspace fora da tela) não desenham nada: o evento é aplicado direto no estado guardado da
  conversa e só status e contadores (trabalhando, esperando você, aguardando vaga, ferramentas, tokens,
  custo, subagentes) avisam a tela, no máximo uma vez por frame. A fila de mensagens dessas conversas
  continua andando, e o histórico continua sendo salvo.
- **Só o visível fica montado**: o workspace na tela e, dentro dele, a aba ativa (e a da direita, se
  dividida). Os outros guardam o estado (abas, aba ativa, divisão, painéis, rascunho, rolagem, fila,
  modelo, plan mode) e remontam iguais. Terminais mantêm a instância do xterm viva (até 12, os mais
  antigos voltam pelo snapshot do tmux), recebendo a saída em segundo plano.
- **Listas longas**: o chat desenha as mensagens mais recentes (rolar até o topo traz mais, em blocos);
  diff, arquivo, árvore e alterações são desenhados por blocos perto da área visível; linhas da barra
  lateral, mensagens e o painel Agentes usam `content-visibility`. Linhas e mensagens são memorizadas
  (um evento só re-renderiza o que mudou) e o arranjo do chat é calculado numa passada.
- **Terminal**: escrita em lote (um `write` por frame); renderizador WebGL nas abas de terminal grande e
  em qualquer terminal com saída pesada (carregado com o app ocioso, até 4 contextos).
- **JS sob demanda**: telas fora do caminho principal (Configurações, Painel, Quadro, Rotinas, Modelos
  locais, Diagnóstico, Agentes), o celular, o xterm e o addon WebGL, Mermaid e KaTeX.
- **Painel Agentes** (barra lateral › Agentes): todas as conversas ativas de todos os workspaces, com
  filtros (status, projeto, texto), subagentes de cada uma, abrir a conversa e parar em lote.

## Medir

```sh
cd apps/web
npm run perf          # build de produção + Playwright com 100 workspaces e 30 agentes de carga
```

O cenário (transporte mock com `window.__kabulSeed`): 5 projetos, 100 workspaces, 30 conversas com 300
mensagens de histórico cada, cada uma com um agente de carga emitindo ~25 eventos/s (deltas de texto,
ferramentas e subagentes com eventos filhos), e uma conversa salva de 2.000 mensagens. Mede tempo até a
tela útil, CPU ocioso e com os agentes, fps com os agentes, troca de workspace, latência por tecla no
composer, abrir e rolar a conversa longa, heap, nós do DOM e o JS inicial. Os limites ficam em
`apps/web/perf-budgets.json`; passar de qualquer um reprova. O resultado vai para `.context/perf/`.

Medido no mesmo Mac (Chromium headless, build de produção), antes e depois deste trabalho:

| métrica | antes | depois | orçamento |
|---|---|---|---|
| tela útil (100 workspaces na barra) | 90 ms | 93 ms | 1.000 ms |
| CPU com tudo ocioso | 0% | 0% | 2% |
| CPU com 30 agentes emitindo | 100% | 8% | 30% |
| fps com 30 agentes emitindo | 9,7 | 60 | ≥ 50 |
| frames longos (> 25 ms) com os agentes | 93% | 0% | 5% |
| componentes renderizados por segundo (agentes) | 235.553 | 338 | 1.500 |
| troca de workspace (p50 / p95) | 462 / 1.098 ms | 34 / 48 ms | 100 / 150 ms |
| tecla no composer até o frame (p95 / máx.) | 178 / 280 ms | 19 / 29 ms | 33 / 50 ms |
| abrir a conversa de 2.000 mensagens | 1.530 ms | 68 ms | 250 ms |
| rolar a conversa de 2.000 mensagens | 8 fps | 60 fps | ≥ 50 |
| heap JS (depois de tudo) | 174 MB | 20 MB | 60 MB |
| nós do DOM | 209.761 | 9.305 | 15.000 |
| JS inicial (gzip) | 274 KB | 179 KB | 200 KB |

"Tecla até o frame" conta do evento até depois do frame seguinte pintado, então inclui a espera do
próprio frame (até 16,7 ms): 19 ms quer dizer ~2-3 ms de trabalho por tecla.

Variáveis: `KABUL_PERF_PORT` (ou `KABUL_E2E_PORT` + 1), `KABUL_PERF_AGENTS` (padrão 30),
`KABUL_PERF_LABEL` (nome do arquivo de resultado), `KABUL_PERF_REUSE=1` (reaproveita um preview no ar),
`KABUL_PERF_NOWEBGL=1` (terminal sem WebGL).
