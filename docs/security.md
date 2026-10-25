# Segurança

Como o Kabul se protege, o que ele **não** tenta proteger e por quê. Para reportar uma falha, veja o
`SECURITY.md` na raiz do repositório (GitHub › Security › Report a vulnerability; nunca issue pública).

## O que está em jogo

O Kabul roda agentes de código com o **seu usuário** do sistema: eles leem e escrevem nos seus repositórios,
rodam comandos e usam as suas contas (GitHub, Linear, provedores de IA). Quem controla o Kabul controla o
seu computador. Por isso a pergunta central é sempre: *quem consegue mandar um comando ao Kabul?*

Ativos, do mais ao menos sensível:

- execução de comandos no computador (terminal, scripts, agentes, aprovações de ferramentas);
- tokens e chaves (GitHub, Linear, contas dos agentes, credenciais dos aparelhos, chave VAPID);
- código e arquivos dos repositórios (inclusive `.env*` copiados para o worktree);
- metadados (nomes de máquina, aparelhos, sessões).

## Fronteiras de confiança

| Quem | Confiança | Como entra |
|---|---|---|
| Você no app desktop | Total | WebView do Tauri com IPC só para os comandos do app |
| Processos do seu usuário no computador | Total | Loopback (`127.0.0.1`) sem credencial |
| Seus aparelhos pareados | Dono | QR de uso único → credencial por aparelho |
| Convidado **editor** | Alta, num workspace | Convite → credencial presa ao workspace |
| Convidado **observador** | Leitura, num workspace | Convite → credencial presa ao workspace |
| Sites abertos no navegador | Nenhuma | Bloqueados por Origin, Host e CORS |
| Outros aparelhos da tailnet sem credencial | Nenhuma | Só `/api/health` e `/api/pair` (que pede o token do QR) |
| Internet | Nenhuma | O kabuld não escuta fora do loopback e da tailnet |
| Texto de terceiros (resposta do agente, issue, PR, repositório) | Nenhuma | É dado, nunca vira comando, HTML ou link local |

## Decisões

### kabuld (celular, outras máquinas, colaboração)

- **Onde escuta:** só `127.0.0.1` e os IPs da tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48). Conexão de outra
  faixa recebe 403. Nunca `0.0.0.0`. TLS fica com o `tailscale serve` (HTTPS com certificado da tailnet);
  dentro da tailnet o tráfego já é cifrado pelo WireGuard.
- **Pareamento:** ingresso aleatório de 144 bits, uso único, 5 minutos (convite: 30 minutos); gerar outro QR
  invalida o anterior. O resgate cria `id` + chave de 256 bits; o kabuld guarda só o SHA-256 da chave, no
  cofre do sistema, e compara em tempo constante.
- **Tentativas:** 10 falhas de credencial ou ingresso por IP bloqueiam o IP por 10 minutos.
- **Revogação:** apaga o hash, derruba as conexões e os links de arquivo do aparelho. A credencial é
  conferida **a cada comando** (e quando a conexão perde eventos), então a revogação não depende de um
  evento chegar.
- **Origin e DNS rebinding:** o navegador do próprio computador só vira dono com origem local
  (`localhost`, `127.0.0.1`, `[::1]`, WebView do Tauri), pelo loopback e sem proxy. Qualquer `Host` que não
  seja `localhost`, IP, nome curto, `*.ts.net` ou um host configurado (`KABULD_ALLOWED_HOSTS`,
  `KABULD_PUBLIC_URL`) recebe 421: um site que aponta o próprio domínio para 127.0.0.1 não fala com o kabuld.
- **Papéis:** a política (`crates/kabuld/src/policy.rs`) libera ao convidado só uma lista fechada de
  comandos. Observador lê; editor também manda mensagem, aprova, para e digita. **Todos** os alvos de um
  comando (`workspaceId`, `chatId`, `session`) precisam estar no workspace do convite; chat ou sessão sem
  workspace é negado. Para digitar, o `pane` tem de ser `%N` e pertencer à sessão conferida.
- **Terminal:** a entrada vai como bytes em hexadecimal (`send-keys -H`). No modo de controle do tmux a linha
  é um comando, por isso o pane é validado (um `;` ou quebra de linha injetaria `run-shell`).
- **Limites:** mensagem de até 16 MB, 16 comandos simultâneos por conexão, colagem no terminal de até 1 MB.
- **PWA:** CSP (`script-src 'self'`, sem inline/eval), `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: no-referrer`. A chave do aparelho fica no `localStorage` da origem do kabuld.
- **Push:** inscrições só para os serviços dos navegadores (Google, Mozilla, Apple, Microsoft;
  `KABULD_PUSH_HOSTS` para outros), no máximo 5 por aparelho: o kabuld não vira ferramenta para chamar
  endereços internos (SSRF).
- **Preview de arquivos** (`crates/kabuld/src/files.rs`): link por arquivo de 5 minutos emitido pelo
  WebSocket, preso à pessoa, ao workspace e ao caminho; leitura só dentro do worktree (`canonicalize`
  barra link simbólico para fora), nunca `.git/`, e convidado sem `.env*`, `.npmrc` e chaves. HTML e texto
  saem como `text/plain`; SVG, imagens e vídeo com `Content-Security-Policy: sandbox`; tipo desconhecido como
  download. `Range` para vídeo, até 16 MB por resposta. Convidado também não vê arquivo de segredo em
  "Alterações" nem pede o diff dele.
- **Proxy do Run** (`crates/kabuld/src/proxy.rs`): só as 10 portas do workspace (nunca a do próprio kabuld),
  sempre em `127.0.0.1`. O app abre num listener próprio (outra porta, no loopback e no IP da tailnet), ou seja,
  em outro origin: o código do app não lê a credencial do aparelho nem fala com o `/ws`. Entrada por link de
  uso único e 2 minutos, emitido pelo WebSocket a dono ou editor (observador não abre); o resgate vira um
  cookie `HttpOnly`, `SameSite=Lax`, só daquele listener. Cada conexão nova confere cookie, credencial e
  `Host`; conexões abertas caem em até 5 s quando a pessoa é revogada.
- **HTTPS** (`net.rs`): o kabuld lê o `tailscale status` antes de rodar o `serve` e nunca muda a tailnet
  (MagicDNS e certificados são ligados pela pessoa no painel). Não sobrescreve um `serve` que já usa a 443
  para outro destino. Comandos do Tailscale com prazo (8 s; o `serve`, 25 s).
- **Arquivos de estado:** `kabuld-devices.json` e `kabuld-push.json` com permissão 0600, sem chaves.

### App desktop (Tauri)

- **CSP** (`apps/desktop/src-tauri/tauri.conf.json`): só scripts do app, sem inline nem `eval`, imagens
  locais e avatares do GitHub, nada em iframe. Um XSS no WebView seria execução de código (o frontend chama
  comandos que rodam processos), então a CSP é a segunda barreira depois do Markdown sem HTML. Ela também
  impede que uma imagem na resposta do agente (`![](https://…?dados)`) vaze dados pela URL. O E2E
  `apps/web/e2e/csp.spec.ts` roda o build sob esta mesma CSP.
- **Capacidades:** a janela só ouve eventos e arrasta/maximiza pela barra (nada de `core:default`).
- **Links:** `open_external` só abre `http`, `https` e `mailto`. Link vindo de agente, Linear ou PR não abre
  `file://`, `.app`, `.command` nem esquema de outro app. "Abrir em" recebe só caminho absoluto real, e os
  terminais só pastas (um `.command` aberto no Terminal roda).
- **Processos:** tudo é chamado com lista de argumentos (sem shell) e o que vem de fora é validado antes:
  - nomes de branch (usuário, Linear, PR de fork) seguem as regras do `git check-ref-format` e não começam
    com `-`; branch de PR com o nome de uma branch local (ex.: `main`) vai para `pr-N`;
  - a URL do clone não pode virar opção (`--upload-pack`) e vai depois de `--`;
  - o remote do `settings.toml` do repo é só um nome;
  - o diff só aceita caminho relativo dentro do workspace.
  - Os comandos que montam linha de shell (sessões tmux) usam `shell_quote` em cada valor.
- **Segredos:** token do GitHub e chave do Linear no Keychain do macOS, gravados pelo `security -i` com o
  segredo na entrada padrão (nunca no `argv`, que qualquer usuário vê no `ps`). O Linear é chamado por HTTPS
  dentro do processo (antes, `curl` com o cabeçalho no `argv`). `logs/agents.log` (0600) registra as
  **chaves** do ambiente, nunca os valores, e mascara opções com cara de segredo (`--api-key`, `token=`).
  O relatório de diagnóstico tem versão sem dados pessoais (`redact`).
- **Deep links:** `kabul://workspace?id=…` hoje só é copiado (rodapé do PR, "Copiar link"); o app não
  registra o esquema. Quando registrar: só navegação (abrir workspace/sessão), nunca ação, e o `id` validado.

### `kabul serve` (CLI)

RPC HTTP sem senha usado pelo E2E. Só atende o próprio computador: `Host` local, `Origin` local ou ausente
e POST só com `application/json` (o navegador não manda isso entre origens sem preflight). CORS ecoa só a
origem local. Corpo até 32 MB.

## O que fica de fora (riscos aceitos)

- **Outros usuários do mesmo computador.** Um processo no loopback sem `Origin` é tratado como o dono.
  Num Mac de uma pessoa só isso é o próprio usuário; numa máquina compartilhada, outro usuário local poderia
  falar com o kabuld e com o `kabul serve`. Não rode o kabuld em máquina compartilhada (ou exija
  pareamento também no navegador local com `KABULD_TRUST_LOCAL_BROWSER=0`).
- **Editor é quase dono.** Digitar no terminal e aprovar ferramentas roda comandos com o seu usuário. O
  escopo do convite limita o que a pessoa alcança pelo Kabul, não o que um comando faz. Convide como editor
  só quem você deixaria usar o seu computador.
- **Adicionar um repositório é confiar nele.** Os scripts de setup/run/archive e o `env` do
  `.kabul/settings.toml` versionado rodam ao criar o workspace (como `npm install`), e o próprio agente lê
  instruções do repositório (prompt injection). Use repositórios em que você confia, ou revise o
  `settings.toml` antes de criar o primeiro workspace.
- **`GH_TOKEN` no ambiente.** O token do GitHub vai para o ambiente dos agentes e scripts (eles usam o `gh`).
- **Rate limit compartilhado.** Pelo `tailscale serve` todos chegam do 127.0.0.1: 10 falhas de alguém da
  tailnet bloqueiam o pareamento HTTPS por 10 minutos (negação de serviço, não acesso).
- **PDF no preview** sai sem `sandbox` (o visualizador do navegador não abre em origem opaca).
- **Proxy do Run em HTTP.** O app é servido em `http://<IP da tailnet>:<porta>`: o tráfego vai cifrado pelo
  WireGuard da tailnet, mas o navegador não o trata como contexto seguro. Depois da primeira checagem a
  conexão é repassada byte a byte (WebSocket/HMR funcionam), então o servidor do app recebe o cookie do
  proxy; ele é código seu rodando com o seu usuário.

## Dependências

- `npm audit` (apps/web, apps/desktop): sem achados. KaTeX foi para 0.18.11 (GHSA-238p-pmpm-9mq7), com
  `overrides` para a cópia do Mermaid.
- `cargo audit`: dois avisos aceitos em `.cargo/audit.toml`, ambos pelo `web-push-native` (última versão):
  `rsa` (RUSTSEC-2023-0071, código RSA nunca chamado; só ES256) e `crypto-bigint` 0.5 (RUSTSEC-2026-0387,
  só assina o JWT VAPID). Três avisos de "sem manutenção/unsound" em dependências transitivas do
  `portable-pty` e do GTK (Linux), sem uso no caminho do Kabul no macOS.
- Rode `cargo audit` e `npm audit` antes de cada release.

## Repositório

- `gitleaks` no histórico da branch e na árvore: sem segredos.
- Testes e exemplos usam nomes e domínios genéricos (`example`, `tailnet-exemplo.ts.net`).

## Testes de segurança

| Regra | Teste |
|---|---|
| Pane do tmux -C não injeta comando | `kabul-core` `tmux::stream::tests::pane_nao_injeta_comandos_no_modo_de_controle` |
| Branch, clone, PR de fork | `store::tests::{nomes_de_branch, clone_recusa_opcao_no_lugar_da_url, fetch_pr_nao_sobrescreve_branch_local}` |
| Diff e remote | `gitops::tests::caminhos_e_remotes_seguros` |
| Segredo fora do argv | `keychain::tests::segredo_fora_da_linha_de_comando` (`KABUL_TEST_KEYCHAIN=1` grava de verdade) |
| Log sem segredo | `chat::tests::log_sem_segredos_nos_argumentos` |
| Links e "Abrir em" | `open::tests::{so_links_da_web, abrir_em_so_pasta_real}` |
| Escopo do convidado | `kabuld` `hub::tests::convidado_nao_mistura_alvos`, `policy::tests::papeis` |
| Pane de outra sessão | `terminal::tests::pane_de_outra_sessao_recusado` |
| Host / DNS rebinding | `net::tests::host_contra_dns_rebinding`, `tests/servidor.rs::host_e_cabecalhos_de_seguranca` |
| Push (SSRF) | `push::tests::chave_persistente_e_requisicao_cifrada` |
| Preview de arquivos | `files::tests::*`, `tests/servidor.rs::preview_de_arquivos_seguro` |
| Proxy do Run | `proxy::tests::*`, `policy::tests::papeis`, `tests/servidor.rs::proxy_do_run` |
| HTTPS sem mexer na tailnet | `net::tests::{https_da_tailnet, comando_com_prazo_e_erro_real, ips_e_serve}`, `apps/web/e2e-kabuld/painel-https.spec.ts` |
| Revogação | `auth::tests::expira_e_revoga`, `tests/servidor.rs::pareamento_papeis_e_revogacao` |
| `kabul serve` | `kabul-cli` `serve::tests::{so_o_proprio_computador, recusa_origem_de_fora_no_servidor}` |
| CSP do desktop | `apps/web/e2e/csp.spec.ts` |
