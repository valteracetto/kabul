# Relatório E2E de UI/UX — 24/10/2026

O teste foi feito de três formas:

1. **Playwright (automático)** contra o frontend com transporte mock (`?mock`):
   `cd apps/web && npm run e2e`. São 18 passos, todos passando. As capturas ficam em `.context/e2e/NN-*.png`.
2. **App Tauri real** em `KABUL_HOME=/tmp/kabul-dev/home`, com cliques e teclas de verdade (CGEvent).
   As capturas ficam em `.context/e2e/tauri/`. Parei esse roteiro no meio porque o usuário começou a usar o app e o Mac (veja Incidentes).
3. **Backend real pela CLI** (`kabul chat`), que segue o mesmo caminho do app: descoberta de modelos locais,
   registro de harness, `prepare` e `harness::spawn`. Usei para o modelo local e para as aprovações do Claude.

## Passos

| # | Passo | Esperado | Obtido | Resultado |
|---|---|---|---|---|
| 1 | Abrir o app | estado vazio com o caminho para começar | real + e2e: "Adicione um repositório git em Criar" | ok |
| 2 | Adicionar repo | repo na barra lateral | real: `/tmp/kabul-dev/repos/demo` adicionado | ok |
| 3 | Criar workspace | worktree, branch `<usuário>/<cidade>`, `.env*` copiado, setup rodando | real: `<usuário>/kabul`, porta 41000, `.env.local` copiado, setup `ready` com log | ok (depois de 2 correções) |
| 4 | Trocar modelo (Claude, Gemini, local) e esforço | popover, busca, selo Local, submenu de esforço | real: busca "qwen" mostra os 3 modelos do LM Studio com o selo; e2e: Gemini 4 Argon → Opus → High | ok (depois de 2 correções) |
| 5 | Prompt curto, resposta e cards | card de ferramenta, texto e rodapé do turno | real: o usuário conversou com Sonnet; CLI: qwen3-8b via OpenCode usou `glob` e respondeu; e2e ok | ok (depois de 2 correções) |
| 6 | Aprovar uma ferramenta | cartão Aprovar/Negar; a decisão volta ao agente | CLI real (Claude Haiku, `--permission-mode default`): Write aprovado criou o arquivo e Write negado não criou; e2e: botão Aprovar | ok |
| 7 | Anexar, @mencionar, /comando | `@.context/attachments/...`, autocomplete de arquivo e de comando | e2e | ok |
| 8 | Plan mode, ditado, anel de contexto | ⇧⇥ alterna o chip; o anel mostra o uso | e2e; o ditado foi verificado só no backend (`say` → whisper) | ok / ditado no app não verificado |
| 9 | Terminal | digitar e ver a saída em stream | real: `echo ola-$KABUL_PORT` → `ola-41000` | ok (depois de 1 correção) |
| 10 | Setup/Run | log do setup; Run sobe o servidor na porta do workspace | real: `Serving HTTP on :: port 41000`, `curl` → 200 | ok |
| 11 | Diff e comentário de linha | comentário na linha; "Enviar ao agente" preenche o composer | e2e | ok (depois de 2 correções) |
| 12 | Checkpoint e restaurar | checkpoint por turno; restaurar volta os arquivos | real: refs `refs/kabul-checkpoints/*` gravadas a cada envio; restaurar coberto pelo teste do core e pelo e2e | ok |
| 13 | ⌘K e atalhos | busca workspaces e conversas; ⌘/ mostra os atalhos; ⌘1 troca | e2e | ok |
| 14 | PR em simulação, sem push | comandos com `--draft`, sem executar | e2e | ok |
| 15 | Arquivar e desarquivar | some da lista; "Arquivados"; volta com as mudanças | e2e; o teste do core usou git real | ok |
| 16 | Configurações e Contas | geral, 6 contas, camadas do repo | real (Contas) + e2e | ok |
| 17 | Modelos locais | runtimes, modelos, baixar com confirmação, registro | real (descoberta) + e2e | ok |
| 18 | Painel de sessões | tmux com agente + Conductor | real + e2e | ok |

## Falhas encontradas e corrigidas (rodei de novo até passar)

1. **`.context/` aparecia em Alterações.** Agora fica em `info/exclude` do repositório (como no Conductor).
2. **O terminal abria vazio.** `tmux has-session -t kabul-kabul` casava por prefixo com `kabul-kabul-setup`, então o terminal principal nunca era criado. Todos os alvos agora usam o nome exato (`=nome`).
3. **O app quebrava no Chromium novo.** `scrollTo` devolve uma Promise e o React tratava isso como retorno de limpeza do efeito.
4. **Clique na linha errada do diff.** O diff mostrava uma linha "1" falsa antes de carregar; o conteúdo pulava e o clique ia para outra linha. Agora mostra "Carregando o diff…".
5. **"Enviar comentários ao agente" não chegava** quando a aba ativa era o diff. Agora volta para a última conversa e preenche o composer.
6. **O seletor não fechava** ao escolher um modelo da lista "Adicionar".
7. **O WebKit mostrava sugestões de texto** ("Qwen ×") nos campos. Desligadas (`writingsuggestions=false`, sem autocorreção).
8. **Nomes de modelo quebravam em duas linhas** e os ícones encolhiam no seletor.
9. **OpenCode ignorava o modelo local** ("Model unavailable"). O `opencode run` usa um serviço de fundo que já estava com outra config. Agora usa `--standalone` quando há config injetada.
10. **O turno com erro deixava o chat preso em "trabalhando".** Todo turno agora termina com `TurnCompleted`.
11. **As aprovações não apareciam**, porque o Claude da máquina de teste usa `defaultMode: auto`. A sessão agora sobe em `--permission-mode default`, como no Conductor.
12. **O anel de contexto ficava quase vazio com o Claude.** Agora soma também os tokens de cache.

## Problemas de UX que ficaram

- **Spinner do agente na barra lateral:** só aparece na aba da conversa; a barra lateral mostra apenas o spinner do setup.
- **"Rápido" no seletor:** não muda nada no agente, porque nenhum CLI tem a opção confirmada.
- **Aprovações no OpenCode:** não passam pelo app. Um aviso no composer explica isso.
- **Esforço no seletor com modelo sem esforço** (locais via OpenCode): a linha fica cinza com "—". Funciona, mas a linha poderia sumir.
- **Ícone de apps:** é informativo; não lista os servidores MCP do agente.
- **Ditado no app:** não testei com microfone real, para não disparar o pedido de permissão do macOS.

## Incidentes

- No roteiro real, uma digitação simulada foi feita com o Kabul fora de foco. O texto ("Liste os arquivos…" + Enter) acabou salvo no histórico do próprio Kabul, mas pode ter ido para outro app. O script agora só digita se o `kabul-desktop` estiver em primeiro plano.
- Depois disso o usuário passou a usar o app (workspace Lisboa, conversa com Sonnet). Parei o roteiro na UI real, e por isso os passos 7 a 18 no app real ficaram só no Playwright e no backend.
- Mudanças em Rust fazem o `tauri dev` reiniciar o app. Uma correção feita durante esse uso (anel de contexto) pode ter reiniciado a sessão do Val.
- Mais cedo rodei `pkill -f vite`, que encerra **qualquer** servidor Vite da máquina, inclusive de outros projetos.

## Rodada 3 (feedback de uso)

Suíte atual: `npm run e2e` → **9 testes passando**:
- roteiro (mock);
- arquivar/desarquivar **contra o backend real** (`kabul serve`);
- painéis redimensionáveis;
- MCP, contexto e minimapa;
- Linear;
- tema, repos recolhíveis, Abrir em, árvore, Checks e semáforos;
- varredura de sobreposição em 5 larguras × 2 temas;
- auditoria de controles.

Bugs achados e corrigidos nesta rodada:
1. **Arquivar não fazia nada no app real.** O wry (WKWebView) não implementa `runJavaScriptConfirmPanel`, então `window.confirm` devolvia `false` sem mostrar nada. Agora há um diálogo próprio. O mock também desliga o `confirm` nativo, para reproduzir o comportamento do Tauri.
2. **Breadcrumb por baixo dos semáforos** com a barra lateral oculta.
3. **"Abrir em" grudado no breadcrumb**: o `flex: none` anulava o espaçador.
4. **Abas do painel direito vazando** em todas as larguras: "Todos os arquivos" virou "Arquivos" e o texto do Revisar some em painel estreito.
5. **Toggle do MCP esmagado** por baixo do botão "repo".
6. **Minimapa cobrindo a bolha da mensagem** em 900 px.
7. **Popovers** (status, "···", turno, MCP, contexto) **não fechavam** com Esc nem clique fora e bloqueavam outros botões. A auditoria de controles achou isso.
8. **Ícone de engrenagem parecia um sol.**
