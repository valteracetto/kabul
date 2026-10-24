English · [Português](../pt-BR/guia/instalacao.md)

# Installation

## macOS

Requirements: macOS 14 or later, `git`, `tmux` (`brew install tmux`) and the GitHub CLI (`brew install gh`) for pull requests and cloning private repositories.

1. Download `Kabul.app` and move it to `/Applications`.
2. Install the agents you want to use:
   - Claude Code: `npm install -g @anthropic-ai/claude-code`
   - Codex: `npm install -g @openai/codex`
   - OpenCode, Qwen Code, Gemini CLI and Antigravity (`agy`) from their own installers.
   Kabul can also install a missing CLI from **Settings › Accounts**.
3. Sign in to each agent from **Settings › Accounts** (Kabul runs the CLI's own login and only shows the URL and the code field; it never reads your tokens).
4. Connect GitHub in **Settings › Accounts › GitHub** (`gh auth login` in the browser, with a device code).

Kabul opened from the Dock reads your login shell environment once at startup (`PATH`, `LANG` and the rest), so CLIs installed through `nvm`, Homebrew or `~/.local/bin` are found.

### Building from source

```sh
cd apps/web && npm install && npm run build
cd ../desktop && npx tauri build
```

## Windows

Coming soon. The core already keeps macOS-only parts behind small adapters; see `docs/windows.md` for the plan.
