# Kabul no Windows

O Kabul compila para `x86_64-pc-windows-msvc` (core, kabuld, CLI e app) e o que dependia do macOS foi
para trás de uma trait ou de uma função por plataforma. No macOS o comportamento é o mesmo de antes
(tmux, osascript, `security`, `caffeinate`). Este arquivo diz o que foi feito, o que falta e como
testar numa máquina Windows.

A regra continua: código novo não acrescenta dependência de macOS e, quando der, já nasce atrás de
uma trait (`term::TerminalBackend`) ou de um módulo por plataforma (`apps/desktop/src-tauri/src/os.rs`,
`kabul_core::{shell, paths, secrets, power, job}`).

## Terminal e sessões

`kabul_core::term` tem a trait `TerminalBackend` (listar, abrir, matar, capturar com scrollback, tela
para o xterm.js, mandar bytes, redimensionar, tamanho/atividade e stream com vários espectadores) e
duas implementações:

| Backend | Onde | Como |
|---|---|---|
| `tmux` | macOS/Linux com tmux | `term/tmux_backend.rs` sobre `tmux.rs`. Mesmas linhas de antes (zsh de login, `export` do ambiente, `[kabul] saiu com N`); as sessões sobrevivem ao app |
| `pty` | Windows (ConPTY), ou Unix sem tmux | `term/pty.rs`: multiplexador próprio sobre `portable-pty`. Sessões nomeadas, um pane `%N` por sessão (o frontend não muda), emulador `vt100` com 10 000 linhas de scrollback para captura e snapshot, vários `attach` recebendo a mesma saída, resize, kill do grupo de processos (Job Object). A sessão termina quando o comando sai, como no tmux |

Escolha: `KABUL_TERMINAL=tmux|pty`; em `app-settings.json`, `"terminal_backend": "pty"` vira essa
variável na abertura do app (vale ao reabrir). Sem nada: PTY no Windows, tmux onde existir, PTY no
resto. `kabul_core::term::backend()` é o único ponto de entrada: o app (`term_*`, `script_run`, nuvem,
espelhamento, teleport, download de modelos, instalação de CLIs, arquivar), o kabuld (espelho das
sessões, terminal compartilhado, `term_open`) e a CLI (`kabul ls`, `kabul run`) passam por ele.

O que o comando roda vem de `term::Launch` (`Shell`, `Run { cmd, log }` com código de saída e shell
depois, `Exec`), com o ambiente do workspace passado pela API do processo no PTY. Linhas de shell
(`Cmd::Line`) são sh; comandos (`Cmd::Spec`, ex.: `claude --cloud`, `--teleport`, `--remote-control`)
ganham as aspas do shell que vai rodá-los.

Shells (`kabul_core::shell`):

| | Terminal interativo | Scripts do `settings.toml` (setup/run/archive), instalação de CLIs |
|---|---|---|
| macOS/Linux | `$SHELL -l` | idem (`$SHELL -lc`) |
| Windows | `pwsh`, senão Windows PowerShell, senão `cmd` | Git Bash (os scripts dos repositórios são sh), senão PowerShell |
| Trocar | `KABUL_SHELL` (`pwsh`, `powershell`, `cmd`, `git-bash` ou caminho) ou `"shell"` em `app-settings.json` | `KABUL_SCRIPT_SHELL` |

No Windows os processos de fundo (git, gh, agentes) são criados com `CREATE_NO_WINDOW`
(`kabul_core::shell::command`), senão cada um piscaria uma janela de console; CLIs `.cmd` do npm vão
pelo `cmd /C` (o `CreateProcess` não roda `.cmd` direto) e o `which` tenta as extensões do `PATHEXT`
(`.exe` primeiro).

As sessões do PTY vivem no processo que as criou (o app com o kabuld embutido, ou o `kabuld`
avulso). Por isso `kabul run` sem tmux roda o agente no próprio terminal em vez de criar uma sessão
destacada.

## Integração com o sistema

| | macOS | Windows | Onde |
|---|---|---|---|
| Notificação | `tauri-plugin-notification` em nome do app (o clique traz o Kabul e o frontend abre a conversa que avisou), com o som na própria notificação | o mesmo plugin (toast) + som por `PlaySoundW`; conferir se o clique no toast ativa a janela | `os::notify` |
| Contador no ícone | `set_badge_count` (número no Dock) | o Tauri não mostra número: usar `set_overlay_icon` com um ícone de contador | `badge_set` |
| Links `kabul://` | `tauri-plugin-deep-link` (esquema no `tauri.conf.json`; só no app empacotado) | o plugin registra o esquema no registro na instalação; com várias instâncias, `tauri-plugin-single-instance` para repassar o link à janela aberta | `setup` em `main.rs` |
| Som de conclusão | `afplay /System/Library/Sounds/<nome>.aiff` | `PlaySoundW` com o som do sistema equivalente (`SystemNotification`, `SystemAsterisk`...) | `os::play_sound` |
| Escolher pasta/arquivo | `osascript choose folder/file` | `tauri-plugin-dialog` | `os::pick` |
| Abrir link | `open`, só `http`/`https`/`mailto` (`kabul_core::open::external_url_ok`) | `explorer.exe <url>` com a mesma regra (Linux: `xdg-open`) | `open_external`, `os::open_external` |
| "Abrir em" | Finder, VS Code, Cursor, Zed, Windsurf, Sublime, Xcode, Terminal, iTerm, Warp, Ghostty (com ícone) | Explorador de Arquivos, VS Code, Cursor, Windsurf, Zed, Sublime, Windows Terminal (`wt -d`), PowerShell (console novo na pasta), Git Bash (`--cd=`), em `%LOCALAPPDATA%\Programs` e `%ProgramFiles%`; sem ícone (a UI mostra a inicial). Nos dois: só caminho absoluto real e terminal só recebe pasta (`kabul_core::open::open_in_path`) | `os::open_apps`, `os::open_in` |
| Manter acordado | `caffeinate -i -w <pid>` | `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` na thread que acompanha o agente (Linux: `systemd-inhibit`) | `kabul_core::power::KeepAwake` |
| Segredos (Linear, GitHub) | Keychain pelo `security` (o mesmo item de antes; não pede senha a cada build) | crate `keyring` (Credential Manager); Linux: Secret Service | `kabul_core::secrets` |
| Ambiente do app | shell de login (`$SHELL -l -i -c 'env -0'`) | PATH do sistema e do usuário lidos do registro (`HKLM\...\Session Manager\Environment`, `HKCU\Environment`), juntado com `;`, sem repetir (sem diferenciar maiúsculas) | `shell_env` |
| Pastas extras de CLIs | `/opt/homebrew/bin`, `~/.local/bin`... | `%APPDATA%\npm`, `%LOCALAPPDATA%\Microsoft\WindowsApps`, `~\.cargo\bin`, `~\scoop\shims`, `%ProgramFiles%\{nodejs, Git\cmd, GitHub CLI, Tailscale}` | `harness::extra_bin_dirs` |
| Estado do app | `~/Library/Application Support/kabul` | `%APPDATA%\kabul` (Linux: `$XDG_DATA_HOME/kabul`) | `paths::state_dir`, `Store::default_paths` |
| Pasta pessoal | `HOME` | `HOME`, senão `USERPROFILE` | `paths::home` |
| Nomes de arquivo | — | anexos sem `<>:"/\|?*`, sem ponto/espaço no fim, sem `CON`/`NUL`/`COM1`... | `paths::safe_file_name` |
| Detecção de agente | `ps -A -o pid,ppid,command` | `sysinfo` (nome do executável + argumentos; `\` e `.exe`/`.cmd` tratados) | `agent::process_table` |
| Encerrar grupo | subárvore por ppid (`sysinfo`) | Job Object (`TerminateJobObject`) + subárvore | `kabul_core::job` |
| Memória (cabe o modelo?) | `sysctl hw.memsize` | `sysinfo` | `local::total_memory` |
| Perfis isolados por HOME (agy, Qwen, Gemini) | `HOME=<perfil>`, links para `.gitconfig`, `.ssh`, `.config/gh` | também `USERPROFILE=<perfil>` (o Node e o git leem esse); pastas por junção (`mklink /J`), arquivos copiados | `accounts::{env_for, link_home_basics}` |
| Pasta do projeto do Claude | `/a/b.c` → `-a-b-c` | `C:\a b` → `C--a-b` (regra do Claude: tudo fora de `[A-Za-z0-9]` vira `-`) | `harness::claude::project_dir_name` |
| Tailscale | PATH ou `/Applications/Tailscale.app` | PATH ou `%ProgramFiles%\Tailscale\tailscale.exe` | `kabuld::net` |
| Ditado | `ffmpeg` + `whisper-cli` | os mesmos, opcionais: sem eles o erro diz o que instalar (`winget install Gyan.FFmpeg`, `whisper-cli.exe` no PATH ou em `KABUL_BIN_WHISPER_CLI`); modelo também em `%LOCALAPPDATA%\kabul\whisper` | `speech` |
| Ícone do executável | `icon.icns` | `icons/icon.ico` (exigido pelo `tauri-build`) | `tauri.conf.json` |
| Barra do Kabul | ícone "template" na barra de menus (o macOS pinta claro/escuro) e texto ao lado (`set_title`): porcentagens dos limites escolhidos e o gasto do dia, conforme o estilo | tray do Tauri na bandeja: ícone em cinza claro (`usage::icon::render_for` com cor); a bandeja não tem texto ao lado, então "porcentagem", "barras + %" e "mostrar o gasto de hoje" vão só na dica (tooltip, uma linha por limite escolhido + o gasto), cortada em 127 caracteres pelo Windows; no estilo "porcentagem" o ícone vira o símbolo (sem barras) e os números ficam na dica. O popover abre acima do ícone quando a bandeja está embaixo. A testar: cor do ícone no tema claro da barra de tarefas | `tray.rs`, `usage/icon.rs` |
| Alertas de uso | notificação pelo plugin | o mesmo plugin | `send_notification` (usado por `notify` e pelo laço de `tray.rs`) |
| CSV de uso | salvo em `$HOME/Downloads` | `%USERPROFILE%\Downloads`; o ideal é o diálogo de salvar (`tauri-plugin-dialog`) | `usage_csv_save` |
| CodexBar CLI (fonte opcional de limites) | lido quando instalado (PATH, `/Applications` ou `~/Applications`); link quebrado do Homebrew aparece em "Fontes" | só existe no macOS: a fonte não aparece (limites vêm do stream dos agentes, do app-server do Codex e da assinatura do Claude) | `usage/limits.rs` |
| Limites da assinatura do Claude | credencial do Claude Code no Keychain (`Claude Code-credentials`, com sufixo do sha256 da pasta em contas com `CLAUDE_CONFIG_DIR`) via `/usr/bin/security` | arquivo `.credentials.json` da pasta de config (`%USERPROFILE%\.claude` ou o `CLAUDE_CONFIG_DIR` da conta). A testar no Windows real: se o Claude Code ainda grava o arquivo ali | `usage/claude_oauth.rs` |

## Navegador do Kabul

O navegador por workspace (`kabul_core::browser`, ver [guia](pt-BR/guia/navegador.md)) foi escrito para os
dois sistemas, mas **só foi rodado no macOS**:

| | macOS | Windows | Onde |
|---|---|---|---|
| Achar o navegador | Chrome, Chromium, Edge, Brave, Chrome for Testing em `/Applications` e `~/Applications` | `Google\Chrome\Application\chrome.exe`, depois `Microsoft\Edge\Application\msedge.exe`, depois Chromium e Brave, em `%ProgramFiles%`, `%ProgramFiles(x86)%` e `%LOCALAPPDATA%` | `browser::candidates` (testado com caminhos falsos dos dois sistemas) |
| Perfil isolado | `~/Library/Application Support/kabul/browser/<ws>/profile` | `%APPDATA%\kabul\browser\<ws>\profile` | `browser::Dirs` |
| Processo do Chromium | grupo próprio (`process_group(0)`): sobrevive ao agente que o abriu | `CREATE_NO_WINDOW \| CREATE_NEW_PROCESS_GROUP \| DETACHED_PROCESS` | `browser::launch` |
| Descoberta entre processos | `DevToolsActivePort` no perfil + `launch.lock` | o mesmo | `browser::{running, ensure}` |
| Gravação dos arquivos de estado | arquivo temporário + `rename` | se o `rename` falhar (destino aberto), apaga e tenta de novo | `browser::write_atomic` |
| Baixar o navegador | `unzip` do sistema, tira a quarentena (`xattr`) | `tar -xf` do sistema (bsdtar, Windows 10 1803+), pacote `win64`/`win32` | `browser::install` |
| Extensão Claude in Chrome | `NativeMessagingHosts/com.anthropic.claude_code_browser_extension.json` do Chrome/Edge | `reg query HKCU\Software\{Google\Chrome,Microsoft\Edge}\NativeMessagingHosts\com.anthropic.claude_code_browser_extension` | `browser::claude_chrome_available` |
| Servidor MCP | o executável do app/kabuld/CLI com `mcp browser …` | o mesmo (`.exe`); caminho com espaços vai como um item de `args`/`command`, sem shell | `mcp_share::builtin` |

A conferir numa máquina Windows de verdade:

- abrir o Chrome/Edge headless com `--user-data-dir` em `%APPDATA%` (caminho com espaço no nome do usuário) e
  ler o `DevToolsActivePort`;
- Edge ou Chrome com políticas corporativas (`RemoteDebuggingAllowed=false`) bloqueiam a porta do DevTools: o
  erro "o navegador não abriu o DevTools em 20 s" deveria apontar isso, e a saída é o `chrome-headless-shell`
  baixado ou um caminho em Configurações › Navegador;
- antivírus segurando o executável baixado em `%APPDATA%\kabul\browser\bin` (primeira execução lenta ou
  bloqueada);
- o processo destacado continuar vivo depois que o agente (Codex, Gemini CLI…) que o abriu sai, e o
  `Browser.close` do "Fechar navegador" encerrar a árvore inteira;
- a consulta ao registro (`reg.exe`) para a extensão do Claude;
- o screencast e a entrada de teclado com layout ABNT2 (teclas mortas e `AltGr` chegam como `text`?).

## O que falta

- **Sessões do PTY sobrevivendo ao app.** Hoje morrem com o processo. Falta um servidor de sessões
  fora do app (o `kabuld` como serviço, com named pipe) para o app reconectar depois de reabrir.
- **Interromper agente sem protocolo (agy) no Windows.** `procs::interrupt` devolve `false` (não há
  SIGINT para outro processo); exige spawn com `CREATE_NEW_PROCESS_GROUP` e `GenerateConsoleCtrlEvent`
  num console compartilhado. Claude, Codex e ACP interrompem pelo protocolo e não dependem disso.
- **Job Object nos agentes do chat.** Só as sessões do PTY entram num job; os agentes do chat
  continuam encerrados pela subárvore do `sysinfo` (netos órfãos podem escapar).
- **Ícones do "Abrir em"** (`SHGetFileInfo`/`ExtractIconEx`) e JetBrains pelo registro.
- **Frontend:** barra de título (`Overlay` e o espaço dos semáforos são do macOS), atalhos com ⌘ que
  devem virar Ctrl, textos "Trazer para o Mac", lista de sons com nomes do macOS e campos de
  `terminal_backend`/`shell` em Configurações (hoje só no `app-settings.json`/variáveis).
- **Ditado sem ffmpeg** (decodificar o webm/opus do WebView2 em Rust) e whisper.cpp empacotado como
  sidecar.
- **Instalação de CLIs:** os comandos `curl … | bash` (agy, OpenCode, Goose, Cursor) só rodam no Git
  Bash; faltam os equivalentes em PowerShell/winget.
- **Permissão dos arquivos `kabuld-*.json`:** no Windows ficam com a ACL padrão de `%APPDATA%`
  (por usuário); sem o equivalente explícito do 0600.
- **Conferir no Windows real:** `cwd` de processos de outros apps (painel de recursos/sessões de fora),
  pastas dos CLIs (`~/.codex`, `%LOCALAPPDATA%\opencode`?), a regra da pasta de projeto do Claude com
  caminhos longos, CRLF e `core.longpaths` nos worktrees, `BROWSER=true` no login dos CLIs.
- **Atalhos com Ctrl no frontend:** o gravador de atalhos (`components/keymap.ts`) já lê "⌘" como Ctrl
  fora do macOS, mas os handlers do app ouvem só o `metaKey`. Até a troca, o `e2e/atalhos.spec.ts`
  fixa `navigator.platform` do macOS (no runner Linux o Meta+B chegava ao gravador sem modificador).
- **CI:** falta o `tauri build` (.msi) no Windows. O bundle hoje só gera `.app` (`"targets": ["app"]`).

## CI no Windows

O `.github/workflows/ci.yml` roda `cargo clippy` e `cargo test --workspace` também no
`windows-latest`, mas com `continue-on-error`: o job reporta e não bloqueia o merge enquanto os itens
de "O que falta" estiverem abertos. Ao fechar o porte, tire a linha do workflow e esta nota.

Cuidados que os testes já seguem (e os novos devem seguir):

- **Fim de linha.** O Git for Windows liga `core.autocrlf=true` no config do sistema. O
  `.gitattributes` fixa LF no checkout (as fixtures de terminal em `tests/fixtures` ficam com os bytes
  exatos), e os repositórios criados pelos testes rodam `git config core.autocrlf false` quando
  comparam conteúdo depois de checkout/restauração.
- **Caminho dentro de JSON.** `C:\Users\...` tem barras invertidas: monte o JSON com
  `serde_json::to_string`, nunca com `format!("\"{}\"", path.display())`.
- **URL `file://`.** No Windows é `file:///C:/...` (barras normais e uma barra a mais).
- **Binários do sistema.** Nada de `/bin/sh` ou `echo` como executável: use `std::env::current_exe()`
  quando só precisa de um arquivo que existe, e `cmd /C echo` no Windows.
- **Ambiente da máquina.** Teste não depende de CLI instalada (`models::catalog()` consulta `codex` e
  `agy`); use as listas fixas (`claude_models()`, `parse_agy_models`).
- **Tempo.** Sem `sleep` no produtor para provar janela: só pisos garantidos pelo relógio monotônico
  (a espera mínima) e tetos folgados.

Nenhum teste foi escondido do Windows com `#[ignore]`. Os trechos `#[cfg(unix)]` dentro dos testes
conferem o que só existe no Unix (modo 0600, link simbólico, sinais); os `#[ignore]` são os testes com
agente ou conta de verdade, que rodam à mão em qualquer sistema.

## Verificar sem Windows (no Mac)

O `cargo check --target x86_64-pc-windows-msvc` puro falha nos crates com C (`ring`, sqlite) por
falta dos cabeçalhos do MSVC. Com o `cargo-xwin` (baixa o CRT e o SDK do Windows) e o LLVM:

```sh
brew install llvm lld
cargo install cargo-xwin --locked
rustup target add x86_64-pc-windows-msvc
export PATH="$(brew --prefix llvm)/bin:$(brew --prefix lld)/bin:$PATH" XWIN_ACCEPT_LICENSE=1
cargo xwin check --workspace --tests --target x86_64-pc-windows-msvc
```

No Mac, o backend PTY também roda (openpty): `KABUL_TERMINAL=pty cargo test -p kabuld` exercita o
terminal compartilhado e o espelho de sessões pelo multiplexador próprio, como no Windows.

## Escala e desempenho

| Hoje | Onde | No Windows |
|---|---|---|
| Prioridade baixa para agentes fora de foco: `setpriority(PRIO_DARWIN_PROCESS, PRIO_DARWIN_BG)` no macOS, `nice 10` no Linux | `kabul-core::governor::set_background` | `SetPriorityClass` com `BELOW_NORMAL_PRIORITY_CLASS` (ou `PROCESS_MODE_BACKGROUND_BEGIN`/`END`, que também baixa E/S) via `windows-sys`; hoje devolve 0 (nada muda) |
| Varredura das sessões: uma `list-panes` com atividade/tamanho e uma captura em lote (`capture-pane ; display-message ; ...` num só processo do tmux) | `TerminalBackend::{list_ext, capture_many}` (tmux: `tmux::list_panes_ext`, `tmux::capture_many`), `kabuld::sessions::Scanner` | O backend PTY usa o padrão da trait: `list` + `info` e a tela de cada pane, tudo em memória no multiplexador (sem processo nenhum) |
| Tabela de processos da varredura (`ProcIndex`) | `agent::ProcIndex::current` (via `agent::process_table`) | `sysinfo` em vez do `ps`, uma leitura por varredura |
| `kabul loadtest --tmux N` cria sessões `kabul-test-perf-*` | `crates/kabul-cli/src/loadtest.rs` | Pula sem tmux; o resto do teste de carga (kabuld, agentes falsos, WebSocket, `sysinfo`) é portátil |

Já portáteis: watchers de arquivos (`notify`: ReadDirectoryChangesW), caches com TTL, fila e limite
de agentes (`governor`), coalescência por quadro (`batch`) e a fila limitada por cliente no kabuld.


## Testar numa VM Windows

1. Windows 11 (ou 10 1809+, por causa do ConPTY), com:
   `winget install Git.Git Rustlang.Rustup Microsoft.VisualStudio.2022.BuildTools OpenJS.NodeJS.LTS GitHub.cli`
   (nas Build Tools, a carga "Desenvolvimento para desktop com C++"). O WebView2 já vem no Windows 11.
2. `rustup default stable-msvc`, clonar o repositório e, na raiz:
   `cargo test --workspace` — roda os testes do backend PTY com `cmd`/PowerShell (`term::pty::tests`),
   do Job Object, do PATH do registro (`shell_env::tests::path_do_windows`), do kabuld com o terminal
   compartilhado e o teste de ponta a ponta do servidor. Os testes do tmux pulam sozinhos.
   Para testar o cofre: `set KABUL_TEST_COFRE=1` e `cargo test -p kabul-core secrets`.
3. Frontend: `cd apps/web && npm ci && npm run build && npx playwright install chromium && npm run e2e`.
4. App: `cd apps/desktop/src-tauri && cargo tauri dev` (ou `npm --prefix ../../web run dev` + `cargo run`).
   Roteiro manual:
   - abrir um repositório pelo seletor de pasta; criar workspace; o setup roda no Git Bash e grava
     `.context/setup-logs.txt`;
   - aba Terminal: abre no PowerShell na pasta do workspace, com `KABUL_*` no ambiente
     (`$env:KABUL_PORT`); digitar, redimensionar, fechar e reabrir a aba (snapshot volta com a tela);
   - "Abrir em": Explorador, VS Code, Windows Terminal, PowerShell;
   - conversa com o Claude (`npm i -g @anthropic-ai/claude-code`): nenhuma janela de console pisca,
     o PC não dorme durante o turno (`powercfg /requests` mostra o Kabul), notificação e som no fim;
   - Configurações › Contas: conectar Linear/GitHub e conferir o item em "Gerenciador de Credenciais";
   - Ajuda › Diagnóstico: mostra "terminal: pty" e os shells escolhidos;
   - celular: `kabuld` pareado, sessões do PTY aparecem no espelho e o terminal compartilhado
     recebe a saída nos dois lados.
