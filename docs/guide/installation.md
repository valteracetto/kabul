English · [Português](../pt-BR/guia/instalacao.md)

# Installation

## macOS

**Requirements:** macOS 14 or later (Apple Silicon or Intel), `git`, `tmux` and the GitHub CLI (`gh`, for
pull requests and private repositories).

```sh
brew install git tmux gh
```

1. Download the `.dmg` for your Mac (`aarch64` for Apple Silicon, `x64` for Intel) from the
   [releases page](https://github.com/valteracetto/kabul/releases) and drag **Kabul** to Applications.
2. Install the agents you want to use. Any one is enough to start:

   | Agent | Install |
   |---|---|
   | Claude Code | `npm install -g @anthropic-ai/claude-code` |
   | Codex | `npm install -g @openai/codex` |
   | Antigravity (`agy`), Gemini CLI, Qwen Code, OpenCode, Goose | their own installers |

   Kabul can also install a missing CLI from **Settings › Accounts**.
3. Sign in to each agent from **Settings › Accounts**. Kabul runs the CLI's own login inside a terminal and
   only shows you the sign-in link and the code field; it never reads your tokens. You can add several
   accounts per provider.
4. Connect GitHub in **Settings › Accounts › GitHub** (`gh auth login` in the browser, with a device code).

Kabul opened from the Dock reads your login shell environment once at startup (`PATH`, `LANG` and the rest),
so CLIs installed through `nvm`, Homebrew or `~/.local/bin` are found. If one still isn't, point Kabul to it
in **Settings › Advanced**.

### First launch and updates

If a build is not notarized by Apple yet, macOS blocks the first launch. Right-click Kabul in Applications ›
**Open**, or go to System Settings › Privacy & Security › **Open Anyway**. You only need to do this once.

Kabul checks for updates by itself and installs signed updates. Pick the **stable** or **beta** channel in
the settings.

### Optional

- **Tailscale** on the computer and on your phone, for the [phone app](./cloud-and-mobile.md), other
  machines and [collaboration](./collaboration.md).
- **`ffmpeg` and `whisper-cpp`** (`brew install ffmpeg whisper-cpp`) plus a Whisper model, for offline
  [dictation](./dictation.md).
- **A local model server** (LM Studio, Ollama, llama.cpp, vLLM or MLX), for [local models](./local-models.md).

## Windows (beta)

Download the `.msi` or `.exe` installer from the
[releases page](https://github.com/valteracetto/kabul/releases). Windows support is in beta: read
[Windows](./windows.md) for what works, what is missing and what to install first (Git for Windows is
required).

## Linux

There is no Linux package. The core, the `kabuld` server and the CLI build on Linux, but the desktop app is
not tested there.

## Building from source

Requirements: Rust (stable), Node.js (LTS), and on macOS the Xcode command line tools.

```sh
git clone https://github.com/valteracetto/kabul.git && cd kabul
cargo test
cd apps/web && npm ci && npm run build
cd ../desktop && npx tauri build
```

The app bundle ends up in `target/release/bundle/`. To run the phone server on its own (on a machine without
the app), see [Cloud and mobile](./cloud-and-mobile.md#a-server-without-the-app).
