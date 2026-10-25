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
2. No Mac, ligue o kabuld e, em Configurações › Celular e remoto, clique em **Ligar HTTPS**. Isso roda
   `tailscale serve --bg --https=443 http://127.0.0.1:7777`, que fica visível só na sua tailnet. O iPhone
   exige HTTPS para notificações, ditado e "Adicionar à Tela de Início".
3. Aponte a câmera do iPhone para o QR do painel. Ele abre `https://<seu-mac>.<tailnet>.ts.net/m/#pair=...`.
4. Digite seu nome e toque em **Parear**. O aparelho recebe uma credencial própria.
5. No Safari, toque em Compartilhar › **Adicionar à Tela de Início** e abra o Kabul por lá.
6. No menu (•••), toque em **Avisar quando um agente esperar por mim**. Isso liga o Web Push.

Sem HTTPS, o link é `http://100.x.y.z:7777/m/`. A lista, o terminal e o chat funcionam, mas o iPhone não
deixa instalar o app, nem receber notificações, nem usar o microfone.

## O que dá para fazer no celular

- **Lista de sessões**, agrupada por repo/workspace. Cada uma mostra o ícone do agente, o selo de onde roda e
  o status. O filtro "Esperando você" junta o que precisa de decisão.
- **Terminal ao vivo** (xterm.js) em qualquer sessão tmux.
  - A janela do Mac mantém o tamanho e a fonte se ajusta à tela do celular. **Ajustar** redimensiona a janela
    do tmux para o celular, e isso muda o tamanho para todos.
  - Barra de teclas: Esc, ⌃C, Tab, setas, ⏎, **Aprovar** e **Negar**. Os dois últimos mandam a tecla certa
    para cada agente: Enter/Esc no Claude, y/n no Codex.
- **Chat estruturado** nas sessões do Kabul, com mensagens, ferramentas, aprovações, fila e ditado.
- **Novo chat** num workspace. Por enquanto, só modelos de nuvem; modelos locais continuam no app desktop.

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
- **Arquivos:** as inscrições de push ficam em `kabuld-push.json` e os metadados dos aparelhos em
  `kabuld-devices.json`, os dois com permissão 0600. Nenhum dos dois guarda chave.

## Variáveis

| Variável | Efeito |
|---|---|
| `KABULD_PORT` | Porta (padrão 7777) |
| `KABUL_HOME` | Pasta de estado (a mesma do app) |
| `KABULD_WEB` | Build da PWA |
| `KABULD_NO_TAILSCALE` | Só localhost |
| `KABULD_SECRETS` | `keyring` (padrão), `file` ou `memory` |
| `KABULD_TRUST_LOCAL_BROWSER` | `0`: até o navegador local precisa parear |
| `KABULD_PUBLIC_URL` | URL base usada no QR (ex.: um túnel próprio) |
| `KABULD_VAPID_SUBJECT` | Contato VAPID do Web Push (`mailto:` ou `https:`) |

## Protocolo

O WebSocket fica em `/ws`.

1. **Hello.** O cliente manda `{hello: {device?, key?}}` e recebe `{hello: {ok, principal, machine}}`.
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
| Push | `push_key`, `push_subscribe`, `push_test` |

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
| `apps/desktop/src-tauri/src/remote.rs` | kabuld embutido no app |
| `apps/web/src/mobile/` | PWA |
| `apps/web/src/components/RemotePanel.tsx` | Painel do desktop |

## Testes

```sh
cargo test -p kabuld                                   # unidade + servidor real (tmux kabul-test-*)
cd apps/web && npx playwright test -c playwright.kabuld.config.ts
```

O E2E sobe o kabuld real com estado sintético e sessões tmux `kabul-test-kd-*`, que são apagadas ao final.
O Claude é trocado por um agente falso que fala o mesmo stream-json (`e2e-kabuld/fake-claude.mjs`). Ele cobre:

- iPhone (WebKit): pareamento, lista, terminal e barra de teclas;
- colaboração com três aparelhos;
- desktop (Chromium): o painel e operar outra máquina.

## Sessões de fora do Kabul

Para o dono, a lista também mostra **Fora do Kabul**: agentes rodando em outros terminais (Terminal,
iTerm2, VS Code…) e as sessões recentes dos CLIs (Claude Code, Codex, OpenCode, Antigravity), só com
título, pasta e data. **Continuar** abre uma conversa no workspace da mesma pasta retomando a mesma
sessão (`--resume`, `codex resume`, `--session`, `--conversation`). Convidados não veem essa lista.
