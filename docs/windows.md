# Rodar no Windows: o que precisa mudar

Levantamento do que hoje depende do macOS (ou de Unix). A migração é um bloco próprio, depois da
paridade; este arquivo diz onde mexer. A regra até lá: código novo não acrescenta dependência de
macOS e, quando der, já nasce atrás de uma trait.

## Terminal e sessões (o maior bloco)

| Hoje | Onde | No Windows |
|---|---|---|
| tmux: sessões, `capture-pane`, `send-keys -H`, `tmux -C` (stream), `resize-window` | `crates/kabul-core/src/tmux.rs`; desktop: `term_*`, `script_run`, `run_in_tmux`, nuvem, espelhamento, teleport, downloads, instalação de CLIs | Trait `TerminalBackend` (abrir, escrever bytes, stream de saída, redimensionar, capturar a tela, matar, listar). Implementações: tmux (macOS/Linux) e ConPTY via `portable-pty`, com um multiplexador no kabuld que mantém as sessões vivas e guarda o scrollback para a reidratação |
| Linha de comando montada para `zsh -lc` / `zsh -c ... exec zsh -l` | `run_in_tmux` e `term_open` em `apps/desktop/src-tauri/src/main.rs` | Shell por plataforma (PowerShell ou Git Bash), com `export` trocado por `$env:` ou `set`. Montar o ambiente pela API do processo, sem concatenar strings |
| Detecção de agente por `ps -A -o pid,ppid,command` | `crates/kabul-core/src/agent.rs` | `sysinfo` (crate) para a árvore de processos |
| Captura `claude --cloud` / `--remote-control` pelo tmux | `cloud_start`, `mirror_start` | ConPTY pela mesma trait (os dois exigem TTY) |

## kabuld (celular, outras máquinas, colaboração)

O kabuld nasceu com as partes de rede, segredos e push portáteis. O que depende de Unix fica isolado:

| Hoje | Onde | No Windows |
|---|---|---|
| Espelho de sessões: `tmux list-panes`, `capture-pane`, `display-message`, `ps -A` para a árvore de processos | `crates/kabuld/src/sessions.rs` | Mesma trait `TerminalBackend` do app (ConPTY + multiplexador do kabuld). Detecção de agente com `sysinfo` |
| Terminal compartilhado (`tmux -C`, `send-keys -H`, `resize-window`) | `crates/kabuld/src/terminal.rs` | Backend ConPTY. A barra de teclas já manda bytes, não nomes do tmux |
| `term_open` cria a sessão com `sh -c ... exec $SHELL -l` | `crates/kabuld/src/hub.rs` | PowerShell ou Git Bash pelo backend |
| Permissão 0600 nos arquivos `kabuld-*.json` (`#[cfg(unix)]`) | `secrets.rs`, `push.rs` | ACL do usuário (`%APPDATA%` já é por usuário) |
| CLI do Tailscale: `which tailscale`, com fallback para o app do Mac | `crates/kabuld/src/net.rs` | `tailscale.exe` em `%ProgramFiles%\Tailscale` |
| Pasta padrão do estado (Application Support) | `Config::from_env` | Vem de `Store::default_paths` (ver "Caminhos e git") |

Já portáteis:
- segredos pela crate `keyring` (Credential Manager);
- rede pela trait `NetTransport` (Tailscale tem os mesmos comandos no Windows);
- Web Push em Rust puro (`web-push-native` + `ureq`);
- axum/tokio;
- PWA no navegador.

## Segredos

| Hoje | Onde | No Windows |
|---|---|---|
| `security add/find/delete-generic-password` (Keychain) | `crates/kabul-core/src/linear.rs`, `crates/kabul-core/src/github.rs` | Crate `keyring` (Credential Manager no Windows, Keychain no macOS, Secret Service no Linux), que o kabuld já usa (`crates/kabuld/src/secrets.rs`) |

## Integração com o sistema

| Hoje | Onde | No Windows |
|---|---|---|
| `osascript` para escolher pasta/arquivo | `pick_folder`, `pick_file` | `tauri-plugin-dialog` |
| `osascript display notification` | `notify` | `tauri-plugin-notification` (também resolve o clique que abre o chat certo) |
| `open` / `open -a <App>` | `open_in`, `open_external` | `tauri-plugin-opener` / `ShellExecuteW`; "Abrir em" com Explorer, VS Code, Cursor, Windows Terminal, PowerShell e JetBrains, a partir do registro e de `%LOCALAPPDATA%` |
| Lista de apps em `/Applications` e `/System/...`; ícones via JXA (`NSWorkspace`) | `OPEN_APPS`, `ensure_icons` | Lista própria por SO; ícone via `SHGetFileInfo` / `ExtractIconEx` |
| Nome do computador por `scutil --get ComputerName` (seletor de máquina) | `crates/kabul-core/src/machine.rs` | Já cai para `COMPUTERNAME` (Windows) e `hostname` |
| Som de conclusão com `afplay /System/Library/Sounds/<nome>.aiff` ("Test") | `sound_play` | Sons próprios empacotados e `PlaySound`/`rodio`; a lista de nomes muda por SO |
| Ambiente do shell de login (`$SHELL -l -i -c 'env -0'`) para o app aberto pelo Dock | `crates/kabul-core/src/shell_env.rs` (`#[cfg(unix)]`) | No Windows o processo já herda o PATH do usuário; `read_login_env` devolve `None` e só o LANG/PATH extra são aplicados |
| Menu do app com Serviços/Ocultar/Mostrar todos | `apps/desktop/src-tauri/src/menu.rs` (`#[cfg(target_os = "macos")]`) | O resto do menu é do Tauri e funciona no Windows (barra de menu na janela) |
| `tmux -u` para forçar UTF-8 | `crates/kabul-core/src/tmux.rs` | Some com o backend ConPTY (trait `TerminalBackend`) |
| `caffeinate -i -w <pid>` | `chat_start` | `SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)` enquanto houver agente rodando |
| `sysctl -n hw.memsize` (cabe na memória?) | `crates/kabul-core/src/local.rs` | `sysinfo` (RAM, e VRAM separada quando houver GPU dedicada) |
| `fix_path` com `/opt/homebrew/bin` etc. e `which()` com pastas do macOS | `main.rs`, `harness::which` | `which` (crate) e pastas por SO (`%APPDATA%\npm`, `%LOCALAPPDATA%\Programs`, `.exe`/`.cmd`) |
| Barra de título `Overlay` com área para os semáforos | `tauri.conf.json`, CSS `.lights` / `.side-top` | No Windows a moldura é outra: botões à direita e padding condicional por plataforma |
| Atalhos com ⌘ | frontend | ⌘ vira Ctrl no Windows; o registro de atalhos precisa de uma tecla "Mod" |

## Caminhos e git

| Hoje | Onde | No Windows |
|---|---|---|
| `HOME` para estado e caches | `Store::default_paths`, `settings`, `auth`, `mcp`, `speech` | `dirs` (crate): `%APPDATA%\kabul`, `%LOCALAPPDATA%` |
| Pasta de projeto do Claude derivada trocando `/` e `.` por `-` | `harness::claude::project_dir_name` | Conferir a regra do Claude no Windows (`C:\` → `C--`) |
| `git -C`, `git worktree` | `store.rs`, `worktree.rs`, `checkpoint.rs` | Funciona; atenção a CRLF e a caminhos longos (`core.longpaths`) |
| `.context/` em `info/exclude` | `store::exclude_context` | Funciona |

## Ditado

| Hoje | Onde | No Windows |
|---|---|---|
| `ffmpeg` + `whisper-cli` instalados pelo Homebrew; modelo achado em `~/.cache/*/whisper` | `crates/kabul-core/src/speech.rs` | Empacotar `whisper.cpp` como sidecar do Tauri (ou crate `whisper-rs`) e decodificar o áudio sem ffmpeg (o `MediaRecorder` do WebView2 grava webm/opus) |
| Teste ponta a ponta com `say` | `speech::tests` | Pula fora do macOS; no Windows, gerar o áudio com SAPI |

## Runtimes locais

`lms`, `ollama`, `llama-server`, `vllm` e `mlx_lm.server` existem no Windows, exceto o MLX (só Apple
Silicon). A detecção por HTTP já é portátil. Trocar `curl` por `ureq`/`reqwest` em `local.rs` e
`linear.rs`.

## CI

GitHub Actions com matriz `macos-latest` + `windows-latest`: `cargo test`, `npm run build`,
`npx playwright test` (o roteiro com mock e o backend real via `kabul serve`) e `tauri build`. No
Windows, os testes que dependem de tmux só rodam quando o backend ConPTY existir; até lá, ficam
marcados como `#[cfg(unix)]`.
