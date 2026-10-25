[English](../../guide/cloud-and-mobile.md) · Português

# Nuvem e celular

Os seus agentes não precisam de você na mesa. O Kabul oferece três jeitos de trabalhar longe dela:

- **o celular**, com todas as sessões do computador ao vivo, pelo `kabuld`, o servidor do próprio Kabul;
- **outras máquinas** suas (um desktop em casa, um servidor), operadas pelo mesmo app;
- **a nuvem do provedor**, para os agentes que têm uma.

## O app do celular (iOS e Android)

![Kabul no iPhone: sessões esperando você e a folha de aprovação](../../assets/mobile.png)
![Kabul no Android (Material 3)](../../assets/mobile-android.png)
![Celular: prévia de arquivo e seletor de modelo](../../assets/mobile-preview.png)

O app do celular é uma PWA (um app que você instala pelo navegador) servida pelo seu próprio computador. Não há
conta do Kabul nem servidor do Kabul no meio: o celular fala com o computador pela sua rede do
[Tailscale](https://tailscale.com).

### Parear o celular

1. Instale o Tailscale no computador e no celular, com a mesma conta.
2. No Kabul: **Configurações › Celular e remoto › Ligar**. Daí em diante o servidor sobe junto com o app.
3. Clique em **Ativar HTTPS**. Isso roda o `tailscale serve` só para o Kabul, visível só dentro da sua tailnet.
   O celular exige HTTPS para instalar o app, receber notificações e usar o microfone.
   - A tailnet precisa emitir certificados: no painel do Tailscale, ligue o **MagicDNS** e os
     **HTTPS Certificates**. O Kabul confere isso antes e mostra os passos se faltar; ele nunca muda as
     configurações da tailnet.
4. Leia o QR com a câmera do celular, digite o seu nome e toque em **Parear**. O celular ganha uma chave própria.
5. Instale: no iPhone, Safari › Compartilhar › **Adicionar à Tela de Início**; no Android, Chrome ›
   **Instalar app**.
6. Nas Configurações do app › Notificações, ligue **Avisar quando um agente esperar por mim**.

Sem HTTPS (`http://100.x.y.z:7777/m/`) a lista, o terminal e o chat funcionam, mas o celular não instala o app,
não recebe notificações e não deixa usar o ditado.

### O que dá para fazer no celular

- **Workspaces:** todos os workspaces agrupados por repositório, com as sessões. Cada sessão mostra o agente,
  onde roda e o status; um anel gira enquanto o agente trabalha e a linha fica destacada quando ele espera você.
  O filtro **Esperando você** junta tudo o que precisa de decisão. Deslize para parar, arquivar ou fixar.
- **Chat:** o mesmo chat estruturado do desktop, com cartões de ferramenta, fila e ditado. As aprovações sobem
  numa folha (**Negar** / **Aprovar**); o plan mode mostra o plano com **Ajustar** e **Aprovar e executar**.
- **Novo workspace:** escolha o repositório, descreva a tarefa, o modelo e onde roda.
- **Seletor de modelo:** favoritos, todos os provedores, modelos locais, esforço e conta. Trocar dentro de uma
  conversa mantém a conversa, como no desktop.
- **Terminal ao vivo** de qualquer sessão, inclusive agentes abertos fora do chat do Kabul e shells comuns, com
  uma barra de teclas (esc, ⌃C, tab, setas, **Aprovar**, **Negar**) que manda a tecla certa para cada agente.
- **Arquivos:** a árvore do workspace com busca, **Alterações** (não commitado, commits, tudo) num diff estreito
  e preview de código, Markdown, imagem, SVG, PDF, vídeo, CSV e JSON. Selecione linhas e **Perguntar no chat**.
- **Preview do app:** abra o app que o workspace está rodando (nas portas reservadas) por um proxy autenticado,
  num endereço separado do Kabul.
- **Uso:** gasto, tokens e limites por provedor e conta.
- **Configurações:** este computador, aparelhos pareados (revogue qualquer um), contas padrão, tema e
  notificações.

A interface segue a plataforma: visual de iOS no iPhone, Material 3 no Android (com o gesto de voltar do
sistema), com um código só.

::: info Ainda não está nas lojas
Hoje o app do celular é uma PWA. Versões para a App Store e o Google Play, do mesmo código e com push nativo,
estão no roadmap.
:::

### Sessões abertas fora do Kabul

O dono também vê **Fora do Kabul**: agentes rodando em outros terminais e as sessões recentes dos CLIs (Claude
Code, Codex, OpenCode, Antigravity). **Continuar** abre uma conversa no workspace da mesma pasta, retomando a
mesma sessão.

## Outras máquinas

Rode o `kabuld` em outro computador e opere pelo seu app desktop: **Configurações › Celular e remoto › Outras
máquinas**, cole o link de pareamento daquela máquina (o mesmo do QR dela) ou use **Procurar na tailnet**. A
máquina entra no seletor do topo da barra lateral (`⌃1` … `⌃9`), e o app inteiro passa a falar com ela.

![Seletor de máquina](/screens/maquinas-pop.png)

### Servidor sem o app

Numa máquina sem o app desktop (um servidor, uma VM):

```sh
cargo build -p kabuld --release
(cd apps/web && npm ci && npx vite build)
./target/release/kabuld --web apps/web/dist --pair
```

O `--pair` imprime um link de pareamento que vale 5 minutos. Variáveis como `KABULD_PORT` (padrão 7777) e
`KABULD_NO_TAILSCALE` estão na [referência técnica](../../celular.md#variaveis).

## A nuvem do provedor

| Agente | O que o Kabul faz |
|---|---|
| Claude Code | **Nuvem do provedor (Claude)**, no menu `+` das abas, inicia uma sessão na nuvem para o workspace. A aba mostra o status, abre no claude.ai e traz a sessão de volta para a sua máquina (**teleport**). **Espelhar no celular/claude.ai** (menu `···` do workspace) mantém uma sessão local rodando aqui e visível no app do Claude. |
| Antigravity | O controle remoto (`--remote-control`) funciona como o espelho do Claude. Rodar na nuvem: a confirmar. |
| Codex | Tarefas na nuvem: a confirmar. |
| Os demais | Sem nuvem do provedor, mas toda sessão fica visível e operável pelo celular pelo `kabuld`. |

O **Painel**, na barra lateral, lista todas as sessões: sessões de terminal com o agente detectado, sessões na
nuvem e importadas, com onde cada uma roda.

## Segurança em resumo

O `kabuld` só escuta no localhost e na sua tailnet, nunca em `0.0.0.0` nem na internet aberta. Os códigos de
pareamento são de uso único e vencem em 5 minutos; cada aparelho ganha uma chave própria, guardada só como hash
no cofre do sistema, e pode ser revogado na hora. Mais em [Segurança](./seguranca.md).
