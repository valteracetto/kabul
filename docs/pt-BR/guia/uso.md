[English](../../guide/usage.md) · Português

# Uso, custos e limites

O Kabul acompanha quanto os agentes gastam e o quanto cada conta está perto do limite.

## De onde vêm os números

1. **Cada turno que o Kabul roda** (app desktop, servidor do celular, `kabul serve`): tokens (entrada, saída, cache lido e gravado), duração e custo quando o harness informa. O Claude Code informa o custo; Codex e Gemini não, então os turnos deles contam só tokens e o total em US$ é um mínimo. Só metadados ficam guardados (provedor, modelo, conta, workspace, sessão), nunca prompt, código ou caminhos.
2. **Os próprios agentes**: o Claude Code manda as janelas de 5 h e da semana no stream (`rate_limit_event`); o Codex manda `account/rateLimits/updated`, e o Kabul também pergunta ao app-server dele (`account/rateLimits/read`) por cada conta do Codex que você adicionou.
3. **CodexBar CLI, se instalado** ([CodexBar](https://github.com/steipete/CodexBar), MIT): `codexbar usage --format json --status` traz mais provedores, status e créditos. Dá para desligar em Configurações › Geral.

Os turnos ficam em `usage.jsonl` e os limites em `usage-limits.json`, na pasta de estado do Kabul, cada um com `schema_version`.

## A aba Uso

Barra lateral › **Uso** (também no celular, pela lista de sessões):

- gasto e tokens de hoje e do mês;
- um bloco por provedor/conta, com uma barra por janela (sessão, semana, mês) e a contagem até o reset;
- gráfico por dia (US$ ou tokens) e tabelas por modelo, conta, workspace e provedor;
- sessões com duração, turnos, tokens e custo (clique para abrir o workspace);
- **Exportar CSV** (um turno por linha; no desktop vai para Downloads).

## Alertas e troca antes do limite

Configurações › Geral: avisar numa porcentagem de qualquer janela (80% por padrão) e orçamento por dia/mês. O Kabul notifica uma vez por janela.

Quando uma janela passa do limite, a aba Uso sugere outra conta do mesmo provedor (se alguma tiver folga) ou outro provedor. **Usar** aplica nas conversas abertas daquele provedor no próximo envio, pelo mesmo caminho de [trocar de modelo ou conta](./trocar.md): mesma conversa, mesma branch, com handoff.

## Barra de menus (bandeja)

Um ícone na barra de menus do macOS (bandeja no Windows) desenha os dois limites mais apertados como barras; no macOS, a maior porcentagem aparece ao lado. O clique abre um popover com os mesmos blocos, o gasto do dia e do mês, os agentes rodando agora (clique para abrir o workspace) e ações rápidas: novo workspace, abrir o Kabul, pausar todos, uso. O botão direito abre um menu com as mesmas ações. Desliga em Configurações › Geral › Ícone na barra de menus.
