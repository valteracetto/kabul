[English](../../guide/usage.md) · Português

# Uso, custos e limites

O Kabul acompanha quanto os agentes gastam e o quanto cada conta está perto do limite.

## De onde vêm os números

1. **Cada turno que o Kabul roda** (app desktop, servidor do celular, `kabul serve`): tokens (entrada, saída, cache lido e gravado), duração e custo quando o harness informa. O Claude Code informa o custo; Codex e Gemini não, então os turnos deles contam só tokens e o total em US$ é um mínimo. Só metadados ficam guardados (provedor, modelo, conta, workspace, sessão), nunca prompt, código ou caminhos.
2. **Os próprios agentes**: o Claude Code manda as janelas de 5 h e da semana no stream (`rate_limit_event`, a cada turno); o Codex manda `account/rateLimits/updated`, e o Kabul também pergunta ao app-server dele (`account/rateLimits/read`) por cada conta do Codex que você adicionou.
3. **A assinatura do Claude, direto da Anthropic**: para cada conta do Claude cadastrada no Kabul, o Kabul usa o login que o próprio Claude Code já guarda (no macOS, o item `Claude Code-credentials` do Keychain; numa conta isolada, o item da pasta `CLAUDE_CONFIG_DIR` dela; no Linux/Windows, o arquivo `.credentials.json`) e consulta o uso da assinatura: sessão de 5 h, semana, semana por modelo (Opus, Sonnet…) e uso extra quando ligado. O token é lido na hora de cada consulta e nunca é gravado nem aparece em log. Se o login venceu ou foi recusado, o bloco diz "entre de novo no Claude Code": o Kabul não renova o login sozinho (quem renova é o Claude Code quando roda).
4. **CodexBar CLI, se instalado** ([CodexBar](https://github.com/steipete/CodexBar), MIT): `codexbar usage --format json --status` traz mais provedores, status e créditos. O Kabul procura `codexbar` no PATH e o CLI dentro do app em `/Applications` e `~/Applications`; se sobrou só o link do Homebrew para um app que foi removido, "Fontes" mostra "CodexBar não encontrado (o link aponta para um app removido)". Dá para desligar em Configurações › Geral.

Os turnos ficam em `usage.jsonl` e os limites em `usage-limits.json`, na pasta de estado do Kabul, cada um com `schema_version`.

## A aba Uso

![Aba Uso: gasto, barras de limite por conta e custo por dia](../../assets/usage.png)

Barra lateral › **Uso** (também no celular, pela lista de sessões):

- gasto e tokens de hoje e do mês;
- um bloco por provedor/conta, com uma barra por janela (sessão, semana, mês) e a contagem até o reset. Provedor/conta em uso sem nenhum limite conhecido ainda aparece mesmo assim, com "Sem dados de limite ainda" e como conectar (por exemplo, "entre no Claude Code com esta conta");
- **Fontes**: como foi cada leitura (assinatura do Claude por conta, app-server do Codex, CodexBar, stream dos agentes);
- gráfico por dia (US$ ou tokens) e tabelas por modelo, conta, workspace e provedor;
- sessões com duração, turnos, tokens e custo (clique para abrir o workspace);
- **Exportar CSV** (um turno por linha; no desktop vai para Downloads).

## Alertas e troca antes do limite

Configurações › Geral: avisar numa porcentagem de qualquer janela (80% por padrão) e orçamento por dia/mês. O Kabul notifica uma vez por janela.

Quando uma janela passa do limite, a aba Uso sugere outra conta do mesmo provedor (se alguma tiver folga) ou outro provedor. **Usar** aplica nas conversas abertas daquele provedor no próximo envio, pelo mesmo caminho de [trocar de modelo ou conta](./trocar.md): mesma conversa, mesma branch, com handoff.

## Barra de menus (bandeja)

![Popover da barra de menus com gasto, limites e agentes rodando](../../assets/menubar.png)

Um ícone na barra de menus do macOS (bandeja no Windows) mostra os limites de IA. O clique abre um popover com os mesmos blocos, o gasto do dia e do mês, os agentes rodando agora (clique para abrir o workspace) e ações rápidas: novo workspace, abrir o Kabul, pausar todos, uso. O botão direito abre um menu com as mesmas ações. Desliga em Configurações › Geral › Ícone na barra de menus.

### O que fica no ícone

Na aba Uso, seção **Na barra de menus** (a mesma escolha aparece em Configurações › Geral, logo abaixo de "Ícone na barra de menus"):

- **Automático (os mais apertados)**: os dois limites com maior uso, de qualquer provedor/conta (o padrão);
- **Escolher (até 3)**: marque até 3 limites (provedor, conta e janela) na lista, ou clique no alfinete **Mostrar no ícone** em qualquer janela de um bloco da aba Uso. Fixar pelo alfinete passa para o modo manual; tirar o último volta ao automático. Um limite escolhido que está sem leitura agora aparece como trilho vazio;
- **Estilo**: barras, porcentagem, barras + % (o padrão) ou só o ícone;
- **Mostrar o gasto de hoje**: o gasto do dia ao lado do ícone.

A mudança vale na hora. No macOS as porcentagens e o gasto aparecem como texto ao lado do ícone; no Windows a bandeja não tem texto ao lado, então tudo vai na dica (passe o mouse sobre o ícone). A escolha fica em `app-settings.json` (`tray_icon`, a partir do `schema_version` 2).
