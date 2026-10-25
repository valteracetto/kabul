# Celular e outras máquinas (kabuld)

O `kabuld` é o servidor do Kabul. Ele deixa o celular (e outras máquinas suas) ver e operar ao vivo
**todas** as sessões do computador: qualquer sessão tmux (Claude Code, Codex, Antigravity, OpenCode,
shell...) e os chats do Kabul.

- Fala o mesmo contrato do app por WebSocket: os mesmos comandos e eventos (`chat-event`, `term-output`...).
- Espelha o tmux: a lista mostra cada sessão com o agente, onde roda (Mac, nuvem do provedor ou outra
  máquina) e o status (trabalhando, esperando você, ocioso). Ao abrir uma sessão, você vê a tela e digita nela.
- Serve a PWA do celular em `/m/`.

## Ligar

- **No app desktop:** Configurações › Celular e remoto › Ligar. A escolha fica gravada e o servidor sobe
  junto com o app.
- **Sozinho**, numa máquina sem o app ou num servidor:

  ```sh
  cargo build -p kabuld --release
  (cd apps/web && npm ci && npx vite build)
  ./target/release/kabuld --web apps/web/dist --pair
  ```

  O `--pair` imprime um link de pareamento que vale 5 minutos.

## No iPhone, pelo Tailscale

1. Instale o Tailscale no Mac e no iPhone e entre com a mesma conta.
2. No Mac, ligue o kabuld e, em Configurações › Celular e remoto, clique em **Ativar HTTPS**. Isso roda
   `tailscale serve --bg --https=443 http://127.0.0.1:7777`, que fica visível só na sua tailnet. O iPhone
   exige HTTPS para instalar o app (PWA), receber notificações e usar o microfone (ditado).
   - A tailnet precisa emitir certificados: em [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns),
     ligue o **MagicDNS** e, em **HTTPS Certificates**, clique em **Enable HTTPS**. Antes de rodar o `serve`,
     o Kabul confere isso no `tailscale status` (campo `CertDomains`); se faltar, o painel mostra esses passos
     e um botão **Tentar de novo**. O Kabul nunca muda a configuração da tailnet.
   - Se o `serve` falhar, o painel mostra a saída real do comando (com prazo de 25 s: o `serve` pode ficar
     esperando uma autorização no navegador).
   - Se o `serve` já aponta para o kabuld (feito antes, à mão ou pelo Kabul), o botão só reaproveita. Se a 443
     já serve outra coisa, o Kabul avisa e não sobrescreve.
   - Ligado, o painel mostra `https://<máquina>.<tailnet>.ts.net/m/` e o QR passa a usar esse endereço.
   - O CLI é procurado no PATH, em `/usr/local/bin`, `/opt/homebrew/bin` e em
     `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (o app aberto pelo Finder não herda o PATH).
     `KABUL_BIN_TAILSCALE` força outro caminho.
3. Aponte a câmera do iPhone para o QR do painel. Ele abre `https://<seu-mac>.<tailnet>.ts.net/m/#pair=...`.
4. Digite seu nome e toque em **Parear**. O aparelho recebe uma credencial própria.
5. No Safari, toque em Compartilhar › **Adicionar à Tela de Início** e abra o Kabul por lá.
6. Em Configurações › Notificações, ligue **Avisar quando um agente esperar por mim**. Isso liga o Web Push.

Sem HTTPS, o link é `http://100.x.y.z:7777/m/`. A lista, o terminal e o chat funcionam, mas o iPhone não
deixa instalar o app, nem receber notificações, nem usar o microfone.

## O que dá para fazer no celular

A PWA segue o tema do desktop (mesmas cores e identidade escura) e se adapta à plataforma, com um código só:

- **iPhone (e outros):** visual do iOS. Pilha com título grande, ‹ redondo, listas agrupadas, folhas com
  puxador, toggles do iOS e fonte Geist.
- **Android:** visual Material 3.
  - Barra superior com o título à esquerda e a seta ←.
  - Barra de navegação com indicador em pílula, FAB estendido e bottom sheets do Material.
  - Switches do Material, ondulação (ripple) no toque e fonte Roboto.
  - O **voltar do sistema** (botão, gesto ou navegador) fecha a folha aberta ou volta uma tela. Cada tela e
    cada folha ocupam uma entrada do histórico.

A plataforma vem do user agent e vai para `<html data-platform="ios|android">`. O `?plat=android` força
uma delas para testar. O CSS varia por `:root[data-platform]` sobre os mesmos tokens (`--m-*`). Os
componentes variam por `PLATFORM` (`apps/web/src/mobile/ui.tsx`).

O tema segue o modo claro/escuro do sistema. Em Configurações › Tema dá para fixar Claro ou Escuro.

- **Abas:** Workspaces, Uso e Configurações. O avatar no topo da tela inicial também abre as Configurações.
- **Workspaces** (tela inicial):
  - Título grande que encolhe ao rolar. Puxe a lista para baixo para atualizar.
  - Lista agrupada por repositório. Em cada grupo vêm os workspaces e, embaixo de cada um, as sessões.
  - Cada sessão mostra o ícone do agente, o status e o selo de onde roda. Quando o agente está
    trabalhando, um anel gira em volta do ícone. Quando espera você, a linha fica destacada.
  - O filtro "Esperando você" junta o que precisa de decisão.
  - Deslize uma sessão para a esquerda para **Parar** (Ctrl-C no tmux; parar o turno no chat). Num chat,
    também aparece **Arquivar**, que encerra a conversa.
  - Deslize um workspace para **Fixar** ou **Arquivar** (ou **Restaurar**, se ele já estiver arquivado).
  - Os botões da linha do workspace abrem uma conversa nova e convidam alguém.
  - **≡ Ordenar e filtrar:**
    - Ordenar por Seções primeiro (fixados e as seções da barra lateral do desktop), Workspaces primeiro
      ou Atividade recente.
    - Filtrar por workspaces (ativos, arquivados ou todos), seção e repositório.
    - A escolha fica guardada no aparelho.
  - A pílula com o nome do computador mostra o estado da conexão.
- **+ Criar** (só o dono) abre o **Novo workspace**: escolha o repositório, escreva no que quer trabalhar,
  escolha o modelo e onde roda. O Kabul cria o worktree (`workspace_create`), abre a conversa e manda a
  primeira mensagem. Com "Nuvem · Anthropic", roda `claude --cloud` numa sessão tmux do workspace
  (`cloud_start`) e abre o terminal dela. O script de setup do repositório continua rodando pelo app desktop.
- **Selecionar modelo** (folha):
  - Mostra os favoritos e, em "Todos ›", a lista completa por provedor. Os modelos locais aparecem com o
    selo Local.
  - Embaixo vêm o esforço (trilho com os níveis que o modelo aceita), o modo rápido e a conta do provedor.
  - Dentro de uma conversa, trocar o modelo usa `chat_switch` e mantém a conversa.
- **Terminal ao vivo** (xterm.js) em qualquer sessão tmux.
  - A janela do Mac mantém o tamanho e a fonte se ajusta à tela do celular. **Ajustar** redimensiona a janela
    do tmux para o celular, e isso muda o tamanho para todos.
  - Barra de teclas no estilo do acessório do teclado: esc, ⌃C, tab, setas, ⏎, **Aprovar** e **Negar**. Os
    dois últimos mandam a tecla certa para cada agente: Enter/Esc no Claude, y/n no Codex.
- **Chat estruturado** nas sessões do Kabul, com mensagens, ferramentas, fila e ditado.
  - Quando o agente pede aprovação, uma folha sobe acima do composer com **Negar** e **Aprovar**.
  - O composer fica fixo acima do teclado e respeita as áreas seguras do iPhone.
- **Arquivos** do workspace (botão "Arquivos" na linha do workspace e ⧉ no topo da sessão):
  - árvore com busca; arquivos alterados ganham um ponto;
  - **Alterações** (tudo, não commitado, commits) com diff unificado numa coluna, com quebra de linha;
  - preview pelo tipo: código com realce e números de linha (em páginas de 192 KB, a próxima carrega ao chegar
    no fim), Markdown renderizado (links relativos abrem o outro arquivo), imagem e SVG com pinça (SVG num
    `<img>`, sem script), PDF no visualizador do sistema, vídeo e áudio (com `Range`; o link é renovado se
    vencer no meio), CSV em tabela, JSON em árvore, binário com tamanho e **Baixar**;
  - toque nos números de linha (um, depois outro para um intervalo) e **Perguntar no chat**: o trecho vai com
    `caminho:linhas` para uma conversa do workspace, com a sua pergunta.
- **Do chat para o arquivo:** caminhos citados pelo agente (`src/a.ts:12`, `README.md`) abrem o preview na
  linha; a faixa acima do campo de mensagem lista os arquivos alterados (toque abre o diff).
- **App** (aba do preview): as 10 portas do workspace (`$KABUL_PORT`…+9) com o que está no ar; **Abrir** mostra
  o app rodando no celular pelo proxy do kabuld. O app abre num endereço próprio (outra porta do kabuld, no IP
  da tailnet), nunca no endereço do Kabul. Observadores veem as portas, mas não abrem.
- **Plan mode:**
  - Fica no "+" do Novo workspace e no ícone ☰ do composer da conversa. O padrão vem de "Conversas novas
    em plan mode", nas Configurações › Modelos do desktop.
  - Ligado, o composer ganha borda bege e fundo listrado, e aparece o chip **Plano**.
  - **Claude e Antigravity** planejam de verdade (`--permission-mode plan`). Isso só vale ao iniciar a
    conversa.
  - **Nos outros agentes, ou ao ligar o plano no meio de uma conversa,** o chip mostra **Plano (emulado)**:
    a mensagem vai com uma instrução para só planejar e esperar aprovação.
  - Quando o agente propõe o plano (ExitPlanMode), aparecem um cartão listrado com o plano e uma folha com
    **Ajustar** e **Aprovar e executar**. Ajustar nega o plano e manda o que mudar. Aprovar tira a conversa
    do plan mode.
- **Uso:** sessões trabalhando, esperando e ociosas; sessões por agente; e tokens e custo das conversas
  do Kabul abertas neste computador, por modelo. Para o dono, **Custos e limites** (`#uso`) mostra o gasto
  do dia e do mês, os limites por provedor/conta, o gráfico de 30 dias, as sessões e exporta CSV.
- **Configurações:**
  - Controle remoto: este computador, este aparelho (com "Esquecer") e os aparelhos pareados (com Revogar).
  - Organizar workspaces manualmente: mostra alças para arrastar. A ordem fica gravada em `pin_order` no
    estado do Kabul, o mesmo campo que o desktop usa para ordenar os fixados.
  - Contas: escolhe a conta padrão de cada provedor. Para adicionar ou entrar numa conta, use o desktop.
  - Tema, Notificações e Sobre.

Ícones e telas de abertura da PWA: `node scripts/gen-pwa-icons.mjs` (em `apps/web`) gera, a partir de um SVG,
`icon-192/512.png`, `apple-touch-icon.png`, `icon-maskable-512.png` e `public/splash/*` (escuras e claras,
por tamanho de iPhone). Ele também imprime os `<link rel="apple-touch-startup-image">` do `index.html`.

## No Android

1. Instale o Tailscale no celular e entre com a mesma conta do computador.
2. No computador, ligue o HTTPS do Tailscale (Configurações › Celular e remoto › **Ligar HTTPS**).
3. Leia o QR com a câmera e pareie no Chrome.
4. Toque em **Instalar app** (ou ⋮ › Adicionar à tela inicial). O manifest traz ícone *maskable*,
   `theme-color`, `display: standalone` e cores de fundo para a tela de abertura.
5. As notificações funcionam no próprio Chrome do Android (Web Push), mesmo sem instalar. Só precisam de
   HTTPS.

As áreas seguras e a navegação por gestos vêm de `env(safe-area-inset-*)` com `viewport-fit=cover` (pelas
variáveis `--m-sat`/`--m-sab`). A barra de status da PWA no iPhone é opaca (`black`; `default` no tema claro):
com `black-translucent`, o iOS 26 deixa a web view 62 pt curta (faixa do sistema embaixo, que o web não pinta)
e desfoca o topo da página. Mudar esse meta só vale depois de remover e adicionar de novo à Tela de Início.

## Caminho para as lojas (futuro)

Hoje o celular usa uma PWA servida pelo kabuld, sem loja. Para publicar na App Store e no Google Play, o plano
é empacotar **a mesma PWA**, sem reescrever a interface:

- **Tauri 2 mobile** (preferido, porque o desktop já é Tauri):
  - `tauri android init` / `tauri ios init` sobre o mesmo `apps/web`.
  - A tela inicial pede o endereço do kabuld (ou o QR) e passa a falar com ele pelo mesmo WebSocket.
  - Push nativo via plugin de notificações: FCM no Android e APNs no iOS, com o kabuld mandando por esses
    serviços em vez do Web Push.
- **Capacitor** (alternativa):
  - Empacota o `dist/` num WebView nativo.
  - `@capacitor/push-notifications` cobre FCM e APNs.
  - Plugins prontos para haptics de verdade (Taptic Engine), câmera (QR) e teclado.

Nos dois casos, `data-platform` já separa o visual iOS do Material e o histórico já cobre o voltar do Android.
Faltam os ícones e as telas de abertura nos formatos de cada loja (os do `scripts/gen-pwa-icons.mjs` servem
de base), o login sem tailnet (túnel público do kabuld, ver `NetTransport`) e a revisão das regras de cada
loja para apps de acesso remoto.

## Outras máquinas no app desktop

Em Configurações › Celular e remoto › Outras máquinas:

1. Cole o link de pareamento da outra máquina (o mesmo link do QR dela).
2. A máquina passa a aparecer no seletor do topo da barra lateral (⌃1…⌃9).
3. Ao escolher a máquina, o app inteiro passa a falar com o kabuld dela pelo mesmo transporte WebSocket.

**Procurar na tailnet** lista os pares do Tailscale que respondem como kabuld. Eles também aparecem no seletor
com "parear".

Do app desktop, prefira o endereço `https://` (wss): o WebView pode bloquear `ws://` para outro host.

## Segurança

- O kabuld escuta só em `127.0.0.1` e nos IPs da tailnet (100.64.0.0/10 e fd7a:115c:a1e0::/48). Não escuta
  em `0.0.0.0` e recusa conexões de fora dessas faixas. Nada fica aberto na internet.
- **Pareamento:**
  - O QR carrega um ingresso aleatório, de uso único, válido por 5 minutos. Gerar outro invalida o anterior.
  - O resgate (`POST /api/pair`) cria uma credencial por aparelho: `id` + chave de 256 bits.
  - O kabuld guarda só o SHA-256 da chave, no cofre do sistema (crate `keyring`: Keychain no macOS,
    Credential Manager no Windows, Secret Service no Linux).
  - Revogar apaga o hash e derruba as conexões abertas daquele aparelho na hora.
- **Navegador do próprio computador:** é tratado como dono sem parear só quando a conexão vem do loopback,
  com origem local (`localhost`, `127.0.0.1` ou o WebView do app) e sem proxy no caminho.
  - Páginas de outros sites abertas no Mac **não** ganham acesso.
  - O `tailscale serve` chega pelo loopback, mas com origem `https://...ts.net`, por isso exige credencial.
  - `KABULD_TRUST_LOCAL_BROWSER=0` exige pareamento de qualquer página web.
- **Tentativas:** 10 falhas de credencial ou de ingresso num IP bloqueiam esse IP por 10 minutos.
- **Host:** pedido com `Host` de outro domínio é recusado (DNS rebinding). Valem `localhost`, IPs, nomes
  curtos e `*.ts.net`; outro nome (túnel próprio) entra por `KABULD_PUBLIC_URL` ou `KABULD_ALLOWED_HOSTS`.
- **PWA:** servida com CSP (só scripts do próprio kabuld) e `X-Frame-Options: DENY`.
- **Push:** só para os serviços de push dos navegadores (Google, Mozilla, Apple, Microsoft).
- **Arquivos:** as inscrições de push ficam em `kabuld-push.json` e os metadados dos aparelhos em
  `kabuld-devices.json`, os dois com permissão 0600. Nenhum dos dois guarda chave.
- Modelo de ameaças e decisões: [security.md](security.md).

## Variáveis

| Variável | Efeito |
|---|---|
| `KABULD_PORT` | Porta (padrão 7777) |
| `KABUL_HOME` | Pasta de estado (a mesma do app) |
| `KABULD_WEB` | Build da PWA |
| `KABULD_NO_TAILSCALE` | Só localhost |
| `KABULD_SECRETS` | `keyring` (padrão), `file` ou `memory` |
| `KABULD_TRUST_LOCAL_BROWSER` | `0`: até o navegador local precisa parear |
| `KABULD_PUBLIC_URL` | URL base usada no QR (ex.: um túnel próprio); o host dela também é aceito |
| `KABULD_ALLOWED_HOSTS` | Outros nomes aceitos no `Host`, separados por vírgula |
| `KABULD_PUSH_HOSTS` | Outros serviços de Web Push aceitos (`.dominio` vale para subdomínios) |
| `KABULD_VAPID_SUBJECT` | Contato VAPID do Web Push (`mailto:` ou `https:`) |

## Protocolo

O WebSocket fica em `/ws`.

1. **Hello.** O cliente manda `{hello: {device?, key?, client: {version, protocol, min_protocol}}}` e recebe `{hello: {ok, principal, machine, server: {version, protocol, min_protocol}}}`. É o handshake de versão (`kabul_core::schema::PROTOCOL`): cliente antigo demais recebe `{ok: false, incompatible: true, error}` com o aviso para atualizar; kabuld antigo demais vira um aviso no topo do app. Sem `client`, vale o protocolo 1.
2. **Chamadas.** `{id, command, args}` → `{id, ok, value | error}`.
3. **Eventos.** O cliente assina com `{sub: "<canal>"}` e recebe `{channel, payload}`. Cada conexão recebe só
   os canais que assinou, só o que o papel dela permite ver, e `term-output` só das sessões que abriu.

Comandos próprios do kabuld:

| Grupo | Comandos |
|---|---|
| Sessões | `live_sessions` |
| Terminal | `term_attach`, `term_keys` |
| Chat | `chat_list`, `chat_transcript`, `chat_switch`, `chat_queue_remove` |
| Presença | `presence_set`, `presence_list` |
| Pareamento e aparelhos | `pair_create`, `invite_create`, `devices_list`, `device_revoke` |
| Servidor e rede | `remote_status`, `remote_https`, `machines_discover` |
| Arquivos | `file_list`, `file_url` (link `/api/file` de 5 min) |
| App rodando | `proxy_ports`, `proxy_open` (link de entrada de 2 min, uso único) |
| Push | `push_key`, `push_subscribe`, `push_test` |
| Workspaces e contas (só o dono) | `workspace_create`, `workspace_archive`, `workspace_unarchive`, `workspace_update`, `accounts_list`, `account_update`, `cloud_start` |

Os demais comandos têm os mesmos nomes do app: `chat_start`, `chat_send`, `chat_approve`, `term_input`,
`repos_list`, `workspaces_list`, `git_status`...

## Código

| Onde | O quê |
|---|---|
| `crates/kabuld/src/server.rs` | HTTP/WebSocket |
| `crates/kabuld/src/hub.rs` | Despacho dos comandos |
| `crates/kabuld/src/policy.rs` | Papéis |
| `crates/kabuld/src/net.rs` | Transporte de rede (trait `NetTransport`: localhost e Tailscale hoje, túnel público depois) |
| `crates/kabuld/src/auth.rs` | Pareamento e credenciais |
| `crates/kabuld/src/sessions.rs` | Espelho do tmux e detecção de status |
| `crates/kabuld/src/terminal.rs` | Terminal compartilhado |
| `crates/kabuld/src/chat.rs` | Chat, fila e aprovações |
| `crates/kabuld/src/push.rs` | Web Push |
| `crates/kabuld/src/files.rs` | Preview de arquivos (`/api/file`) |
| `crates/kabuld/src/proxy.rs` | Proxy da porta do Run |
| `apps/desktop/src-tauri/src/remote.rs` | kabuld embutido no app |
| `apps/web/src/mobile/` | PWA |
| `apps/web/src/mobile/preview/` | Arquivos, diff, preview, app rodando, "perguntar no chat" |
| `apps/web/src/components/RemotePanel.tsx` | Painel do desktop |

## Testes

```sh
cargo test -p kabuld                                   # unidade + servidor real (tmux kabul-test-*)
cd apps/web && npx playwright test -c playwright.kabuld.config.ts
```

`CAPTURA=depois npx playwright test -c playwright.kabuld.config.ts --project=capturas` grava capturas de
cada tela, no escuro e no claro, em `.context/comparar/mobile/<CAPTURA>/iphone/`. Com
`--project=capturas-android`, grava em `.../android/`.

Testes nunca usam o servidor tmux padrão: o E2E sobe o kabuld real com estado sintético num servidor tmux só
dele (`tmux -L kabul-test-kd-<execução>`, passado por `KABUL_TMUX_SOCKET`), encerrado no fim; `cargo test`, o
loadtest e o `kabul serve` dos E2E fazem o mesmo (`kabul_core::tmux::use_test_server`, configs do Playwright).
No servidor padrão, o kabuld esconde sessões `kabul-test-*` (vazaram para o celular antes desse isolamento).
O Claude é trocado por um agente falso que fala o mesmo stream-json (`e2e-kabuld/fake-claude.mjs`). Ele cobre:

- iPhone: arquivos (árvore, busca, cada tipo de preview, pinça, páginas), do chat para o arquivo, perguntar no
  chat, alterações e o app pelo proxy (`preview.spec.ts`);
- desktop: "Ativar HTTPS" com um Tailscale de mentira (`painel-https.spec.ts`): tailnet sem certificado, erro
  real do `serve`, URL https e QR novo;
- iPhone (WebKit) e Android (Pixel 8, Chromium):
  - pareamento, lista, terminal e barra de teclas;
  - criar workspace, ordenar e filtrar, organizar manualmente, tema e uso;
  - plan mode, nativo e emulado, com o cartão do plano;
- Android: plataforma Material, voltar do sistema (folha e tela) e ondulação;
- colaboração com três aparelhos;
- desktop (Chromium): o painel e operar outra máquina.

## Sessões de fora do Kabul

Para o dono, a lista também mostra **Fora do Kabul**: agentes rodando em outros terminais (Terminal,
iTerm2, VS Code…) e as sessões recentes dos CLIs (Claude Code, Codex, OpenCode, Antigravity), só com
título, pasta e data. **Continuar** abre uma conversa no workspace da mesma pasta retomando a mesma
sessão (`--resume`, `codex resume`, `--session`, `--conversation`). Convidados não veem essa lista.
