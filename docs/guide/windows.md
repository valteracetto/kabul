English · [Português](../pt-BR/guia/windows.md)

# Windows (beta)

Kabul builds and runs on Windows: the core, the `kabuld` server, the CLI and the desktop app. Everything that
used to depend on macOS is behind a small adapter with a Windows implementation. It is a **beta**: the main
flows work, but expect rough edges and read the list of known gaps below.

## Requirements

- Windows 11, or Windows 10 version 1809 or later (ConPTY is required).
- [Git for Windows](https://gitforwindows.org) (includes Git Bash, which runs the repository scripts).
- The GitHub CLI (`winget install GitHub.cli`) and Node.js for the npm-based agents.
- WebView2 (already part of Windows 11).

```powershell
winget install Git.Git GitHub.cli OpenJS.NodeJS.LTS
```

Install the `.msi` or the `.exe` from the [releases page](https://github.com/valteracetto/kabul/releases).

## What is different from macOS

| | macOS | Windows |
|---|---|---|
| Terminals and sessions | tmux; sessions survive the app | Kabul's own multiplexer over ConPTY, with 10,000 lines of scrollback |
| Interactive terminal | your login `$SHELL` | `pwsh`, then Windows PowerShell, then `cmd` |
| setup / run / archive scripts | your shell | Git Bash (repository scripts are usually `sh`), then PowerShell |
| Secrets (GitHub, Linear, devices) | Keychain | Credential Manager |
| App state | `~/Library/Application Support/kabul` | `%APPDATA%\kabul` |
| Keep the computer awake during a turn | `caffeinate` | `SetThreadExecutionState` |
| Open in… | Finder, VS Code, Cursor, Zed, Terminal, iTerm, Warp, Ghostty… | Explorer, VS Code, Cursor, Windsurf, Zed, Sublime, Windows Terminal, PowerShell, Git Bash |
| Menu bar icon | menu bar, with the percentage next to it | system tray, percentage in the tooltip |

Change the shell with `KABUL_SHELL` (`pwsh`, `powershell`, `cmd`, `git-bash` or a path) and the script
shell with `KABUL_SCRIPT_SHELL`. `KABUL_TERMINAL=tmux|pty` forces a terminal backend.

Background processes (git, gh, agents) start without a console window.

## Known gaps

- **Terminal sessions don't survive closing the app** yet. On macOS they live in tmux; on Windows they live in
  the app (or in a standalone `kabuld`).
- **Stopping Antigravity** mid-turn falls back to ending the process. Claude Code, Codex and the ACP agents
  stop through their own protocol and are not affected.
- **Interface:** the title bar and some shortcuts still follow macOS (`⌘` should be `Ctrl`), a few texts say
  "Mac", and the terminal backend and shell can only be changed through variables or `app-settings.json`.
- **Installing CLIs from Settings:** the installers that use `curl … | bash` (Antigravity, OpenCode, Goose,
  Cursor) need Git Bash; PowerShell / winget equivalents are missing.
- **Dictation** needs `ffmpeg` and `whisper-cli.exe` installed by hand.
- **Icons** in "Open in" are not shown (the menu uses initials).
- The optional **CodexBar** usage source only exists on macOS; limits still come from the agents themselves.
- **Kabul's browser** finds Chrome or Edge in `Program Files` / `%LOCALAPPDATA%`, keeps its profile in
  `%APPDATA%\kabul\browser\<workspace>\profile` and runs detached without a console window, but it has
  not been tried on a real Windows machine yet. Corporate policies that disable remote debugging block it;
  use the downloaded browser (Settings › Browser) or point to another executable.
- Not yet checked on real hardware: long paths and CRLF in worktrees, and some CLI folders.

## Reporting problems

**Help › Diagnostics** shows the terminal backend and the shells in use and copies a report without personal
data. Attach it to an issue.

Engineering details (in Portuguese): [Windows port](../windows.md).
