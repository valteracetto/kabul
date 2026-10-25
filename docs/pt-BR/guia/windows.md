[English](../../guide/windows.md) · Português

# Windows (beta)

O Kabul compila e roda no Windows: o core, o servidor `kabuld`, o CLI e o app desktop. Tudo o que dependia do
macOS foi para trás de um adaptador com implementação para Windows. É **beta**: os fluxos principais
funcionam, mas espere arestas e leia a lista do que ainda falta.

## Requisitos

- Windows 11, ou Windows 10 versão 1809 ou mais nova (precisa do ConPTY).
- [Git for Windows](https://gitforwindows.org) (traz o Git Bash, que roda os scripts dos repositórios).
- O GitHub CLI (`winget install GitHub.cli`) e o Node.js para os agentes instalados pelo npm.
- WebView2 (já vem no Windows 11).

```powershell
winget install Git.Git GitHub.cli OpenJS.NodeJS.LTS
```

Instale o `.msi` ou o `.exe` da [página de versões](https://github.com/valteracetto/kabul/releases).

## O que muda em relação ao macOS

| | macOS | Windows |
|---|---|---|
| Terminais e sessões | tmux; as sessões sobrevivem ao app | multiplexador próprio do Kabul sobre o ConPTY, com 10.000 linhas de histórico |
| Terminal interativo | o seu `$SHELL` de login | `pwsh`, senão Windows PowerShell, senão `cmd` |
| Scripts de setup / run / archive | o seu shell | Git Bash (os scripts dos repositórios costumam ser `sh`), senão PowerShell |
| Segredos (GitHub, Linear, aparelhos) | Keychain | Gerenciador de Credenciais |
| Estado do app | `~/Library/Application Support/kabul` | `%APPDATA%\kabul` |
| Manter o computador acordado durante o turno | `caffeinate` | `SetThreadExecutionState` |
| Abrir em… | Finder, VS Code, Cursor, Zed, Terminal, iTerm, Warp, Ghostty… | Explorador, VS Code, Cursor, Windsurf, Zed, Sublime, Windows Terminal, PowerShell, Git Bash |
| Ícone de uso | barra de menus, com a porcentagem ao lado | bandeja do sistema, porcentagem na dica |

Troque o shell com `KABUL_SHELL` (`pwsh`, `powershell`, `cmd`, `git-bash` ou um caminho) e o shell dos scripts
com `KABUL_SCRIPT_SHELL`. `KABUL_TERMINAL=tmux|pty` força um backend de terminal.

Os processos de fundo (git, gh, agentes) abrem sem janela de console.

## O que ainda falta

- **As sessões de terminal não sobrevivem ao fechar o app.** No macOS elas vivem no tmux; no Windows, no app
  (ou num `kabuld` avulso).
- **Parar o Antigravity** no meio do turno cai no encerramento do processo. Claude Code, Codex e os agentes ACP
  param pelo próprio protocolo e não são afetados.
- **Interface:** a barra de título e alguns atalhos ainda seguem o macOS (`⌘` deveria virar `Ctrl`), alguns
  textos dizem "Mac", e o backend de terminal e o shell só mudam por variável ou no `app-settings.json`.
- **Instalar CLIs pelas Configurações:** os instaladores com `curl … | bash` (Antigravity, OpenCode, Goose,
  Cursor) precisam do Git Bash; faltam os equivalentes em PowerShell / winget.
- **Ditado** precisa do `ffmpeg` e do `whisper-cli.exe` instalados à mão.
- **Ícones** do "Abrir em" não aparecem (o menu mostra as iniciais).
- **Navegador do Kabul:** acha o Chrome ou o Edge em `Program Files` / `%LOCALAPPDATA%`, guarda o perfil em
  `%APPDATA%\kabul\browser\<workspace>\profile` e roda destacado, sem janela de console, mas ainda não foi
  testado numa máquina Windows de verdade. Políticas corporativas que desligam a depuração remota bloqueiam
  o navegador; use o navegador baixado (Configurações › Navegador) ou aponte outro executável.
- A fonte opcional de uso **CodexBar** só existe no macOS; os limites continuam vindo dos próprios agentes.
- Ainda não conferido em máquina real: caminhos longos e CRLF nos worktrees, e algumas pastas dos CLIs.

## Reportar problemas

**Ajuda › Diagnóstico** mostra o backend de terminal e os shells em uso e copia um relatório sem dados pessoais.
Anexe numa issue.

Detalhes de engenharia: [porte para o Windows](../../windows.md).
