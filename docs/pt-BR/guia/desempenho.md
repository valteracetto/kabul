[English](../../guide/performance.md) · Português

# Desempenho e escala

O Kabul é feito para muitos agentes ao mesmo tempo: a meta é **100 workspaces e 30 agentes rodando juntos**, com
árvores de subagentes, sem a interface perder fluidez nem o computador engasgar. Essas metas são medidas, e os
orçamentos rodam no CI: uma regressão reprova o build.

## O que você ganha

- **Só o que está na tela fica montado.** O workspace visível e a aba ativa dele são desenhados; os outros
  guardam o estado (abas, rascunho, rolagem, fila, modelo, plan mode) e voltam exatamente como estavam. As
  conversas em segundo plano continuam rodando e as filas continuam andando; só atualizam status e contadores.
- **Eventos em lote.** A saída dos agentes é aplicada uma vez por quadro, não uma vez por evento. Listas longas
  (chat, diff, árvore de arquivos, alterações, barra lateral) são desenhadas por blocos perto da área visível.
- **Terminal rápido.** A saída é escrita uma vez por quadro, com o renderizador WebGL quando ela é pesada.
- **Limite de agentes simultâneos.** Defina quantos agentes podem rodar ao mesmo tempo; os demais esperam numa
  **fila** ("Aguardando vaga · 2º na fila") e o workspace em foco passa na frente. Agentes fora de foco rodam com
  prioridade baixa, e os ociosos podem ser encerrados depois de um tempo e retomados depois.
- **Painel Agentes.** Barra lateral › **Agentes**: todas as conversas ativas de todos os workspaces, com filtros,
  árvore de subagentes (status, tempo, tokens e custo de cada um), abrir e **parar em lote**.
- **Eventos no lugar de polling.** Um watcher de arquivos por repositório, uma listagem das sessões de terminal
  para todas, cache para listas de modelos, PRs e checks.

## Medido

Interface, build de produção no Chromium headless num Mac, com 100 workspaces e 30 agentes sintéticos emitindo
uns 25 eventos por segundo cada, mais uma conversa salva de 2.000 mensagens:

| Métrica | Antes | Agora | Orçamento |
|---|---|---|---|
| Tempo até a tela útil | 90 ms | 93 ms | 1.000 ms |
| CPU com tudo ocioso | 0% | 0% | 2% |
| CPU com 30 agentes emitindo | 100% | 8% | 30% |
| Quadros por segundo com 30 agentes | 9,7 | 60 | ≥ 50 |
| Trocar de workspace (p50 / p95) | 462 / 1.098 ms | 34 / 48 ms | 100 / 150 ms |
| Tecla no composer até o quadro (p95) | 178 ms | 19 ms | 33 ms |
| Abrir a conversa de 2.000 mensagens | 1.530 ms | 68 ms | 250 ms |
| Rolar essa conversa | 8 fps | 60 fps | ≥ 50 |
| Heap JS | 174 MB | 20 MB | 60 MB |
| JS inicial (gzip) | 274 KB | 179 KB | 200 KB |

Servidor (`kabuld`), teste de carga com 100 workspaces, 30 agentes falsos a 20 eventos por segundo, 30 sessões
de terminal e 3 clientes conectados por 20 s no macOS:

| Métrica | Resultado |
|---|---|
| CPU do servidor (média) | 6,5% (era 17,2% antes da otimização da varredura das sessões) |
| Memória do servidor | uns 24 MB |
| Latência do evento ao cliente (p95) | 0,17 ms |
| Eventos entregues | 99,98% |

São cargas sintéticas numa máquina só. Agentes de verdade passam a maior parte do tempo esperando o modelo e
emitem bem menos eventos que isso, então o teste de carga é um caso pesado de propósito.

## Meça você mesmo

```sh
cd apps/web && npm run perf                    # interface: build de produção + Playwright com 100 workspaces e 30 agentes
cargo run --release -p kabul-cli -- loadtest   # servidor: kabuld de verdade, workspaces sintéticos, agentes falsos, clientes WebSocket
```

Os orçamentos da interface ficam em `apps/web/perf-budgets.json`; o teste de carga do servidor tem os dele, e os
dois rodam no CI. Os relatórios completos (JSON) estão em
[`docs/perf/`](https://github.com/valteracetto/kabul/tree/main/docs/perf), e o contrato entre frontend e backend
para fila, subagentes e parar em lote está na [referência de escala](../../escala.md).
