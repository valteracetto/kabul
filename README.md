English · [Português](README.pt-BR.md)

<h1 align="center">Kabul</h1>

<p align="center">
  <strong>Every coding agent at its best, side by side.</strong><br>
  Run Claude, GPT, Gemini, Qwen and local models in parallel, each in the harness made for it, each on its own git worktree.<br>
  Switch models without losing the conversation. Bring a friend into the session. Keep going from your phone.
</p>

<p align="center">
  <a href="https://github.com/valteracetto/kabul/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/valteracetto/kabul/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/valteracetto/kabul/releases"><img alt="Release" src="https://img.shields.io/github/v/release/valteracetto/kabul?include_prereleases&sort=semver"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://valteracetto.github.io/kabul/"><img alt="Docs" src="https://img.shields.io/badge/docs-English%20%C2%B7%20Portugu%C3%AAs-8A2BE2"></a>
</p>

<p align="center">
  <img src="docs/assets/hero.png" alt="Kabul: parallel workspaces, chat with approvals and the diff side by side" width="900">
</p>

## Three things Kabul does differently

### 1. The right harness for every LLM

A model is only as good as the agent loop around it. Kabul runs each model in the harness built for it:
Claude in **Claude Code**, GPT in **Codex**, Gemini in **Antigravity** or **Gemini CLI**, Qwen in **Qwen Code**,
and anything else through **OpenCode** or **Goose**, over the
[Agent Client Protocol](docs/acp.md). Local models are routed by family: a Qwen on LM Studio goes to Qwen
Code, a DeepSeek served with an Anthropic-compatible API goes to Claude Code, a gpt-oss goes to Codex. You
pick the model; Kabul picks the harness, and tells you when it had to fall back.

### 2. Switch LLM or account in the same conversation, on the same branch

Hit a rate limit, want a second opinion, or want a cheaper model for the boring part? Pick another model
in the same chat, even one from a different provider or a different account. Kabul keeps one canonical
transcript, independent of any harness, and hands off to the new agent: the latest messages and who wrote
them, the tools used, the diff of the branch and your `.context/` notes. Same worktree, same
branch, checkpoints keep going. A divider in the chat shows exactly where it happened.

<p align="center">
  <img src="docs/assets/switch-llm.png" alt="One conversation that went from Claude Code to Codex to Antigravity, with a divider at each switch and the PR checks green" width="900">
</p>

### 3. Work with a friend at the same time, and from your phone

Invite someone into a workspace as **editor** or **observer**. You both see the agent stream live, send
messages into one shared queue, approve tools (the first decision wins) and type in the same terminal, with
presence and authorship on every message. The same server puts every session of your computer on your phone:
an installable app for iOS and Android that shows what is running, what is waiting for you, the diff and
the files, and pings you when an agent needs a decision.

<p align="center">
  <img src="docs/assets/mobile.png" alt="Kabul on the phone: sessions waiting for you and an approval sheet" width="600">
</p>
<p align="center">
  <img src="docs/assets/collab.png" alt="Paired devices for two people and an editor invite with a QR code" width="440">
  <img src="docs/assets/collab-mobile.png" alt="Two people in the same chat on iPhone and Android, with presence avatars and an approval made by the other person" width="440">
</p>

## Why Kabul

Coding agents are good enough to work on several things at once. The tools around them are not: each
agent lives in its own CLI, one task per terminal, tied to the desk, and locked into one vendor's models.

Kabul is the workbench around them. Each task gets its own **workspace**: a git worktree on its own branch,
with its own ports, terminal and chats, so ten agents can work on ten things without stepping on each other.
You review the diff, leave comments for the agent, watch the checks and ship the pull request in the same
window. Models and accounts are interchangeable mid-conversation. And none of it requires you to sit in front
of the computer.

Kabul is local-first and open source. Your code stays on your machine; the agents talk to the providers you
already pay for, with the logins you already have. Kabul never reads your tokens.

<p align="center">
  <img src="docs/assets/demo.gif" alt="Create a workspace from a prompt, let Claude work, switch to Codex in the same chat, approve a command and open the PR" width="900">
</p>
<p align="center"><sub>Create a workspace → Claude works → switch to Codex in the same chat → approve → open the PR (<a href="docs/assets/demo.mp4">MP4</a>).</sub></p>

## Features

**Parallel workspaces on git worktrees.** One task, one worktree, one branch. Ten reserved ports per
workspace (`$KABUL_PORT`…`+9`), setup/run/archive scripts from `.kabul/settings.toml`, `.env*` files copied
in, statuses (Backlog → Done), sections, pins and a board view. Archive keeps everything in a checkpoint and
removes the worktree; unarchive brings it back.

**Chat with approvals and plan mode.** Every tool call is a card: approve once (`↵`), always (`⌘↵`) or deny
(`⌫`). Plan mode in every harness: native where the CLI has it, emulated where it doesn't, and approving the
plan switches the running session without restarting it. Questions, queued messages, forks, reset, `@` files,
`/` commands, attachments and offline dictation.

**Diff, pull requests and checks.** Unified or split diff with syntax highlight and line comments you send
to the agent. A git button that follows the branch state: commit and push, create PR, pull, fix failing
checks (with their logs), resolve conflicts, merge, archive. Checks and review comments inline.

**Checkpoints.** Kabul records a checkpoint before every message you send (private git refs, never touching
your branch or `HEAD`). Restore the files to any point, or reset the chat to it.

**Terminal.** A real terminal per workspace, plus full-tab terminals that can start Claude Code, Codex,
Gemini or OpenCode for you. Sessions survive the app on macOS (tmux).

**MCP, shared and per session.** Kabul reads the MCP servers you configured in Claude Code, Codex,
OpenCode, Gemini CLI, Qwen Code and Antigravity, and offers them to every agent, in each CLI's own format,
without editing your configs. Turn servers on or off per session, see how many tokens their definitions cost
per turn, and keep secrets out of the command line.

**Linear and GitHub.** Start workspaces from Linear issues, mention issues with `@`, close them from the PR.
GitHub through the `gh` CLI: clone, multiple accounts, PRs, checks and reviews. Routines run a prompt on a
schedule or on a PR event.

**The provider's cloud.** Start a Claude Code session in Anthropic's cloud from a workspace, follow it in
Kabul and bring it back to your machine (teleport). Mirror a local session to the Claude app. Antigravity's
remote control works the same way.

**Phone: iOS and Android.** An installable app (PWA) served by your own computer over Tailscale: sessions
grouped by workspace, live terminal, structured chat with approvals, new workspaces, model picker, files
and diff with preview, the app you are building through an authenticated proxy, and push notifications when
an agent waits for you. iOS look on iPhone, Material 3 on Android, one codebase.

**Collaboration.** Invite links with roles (editor, observer) scoped to one workspace, presence, "typing…",
authorship per message, a single server-side queue and first-decision-wins approvals.

**Usage, costs and the menu bar.** Tokens and cost per workspace, session, model, account and provider;
5-hour, weekly and monthly windows with countdowns; alerts at a threshold or a daily budget, and a one-click
suggestion to switch to an account or model with room left. A menu bar (tray) icon shows the tightest limits
and the agents running now. Export to CSV.

**Local models with the best harness.** Finds LM Studio, Ollama, llama.cpp, vLLM and MLX servers, shows what
fits in memory, downloads models after you confirm and routes each family to the harness that runs it best.

**ACP.** One harness speaks the Agent Client Protocol and covers Gemini CLI, Qwen Code, OpenCode, Goose and
Cursor with the same chat, cards and approvals, without a parser per CLI. New ACP agents are a small entry, not
a new integration.

**Performance at scale.** Built for 100 workspaces and 30 agents at once: only the visible workspace is
mounted, events are batched per frame, long lists are windowed, and a concurrency limit queues agents with
the focused workspace first. Measured budgets run in CI.

**Security.** The phone server listens only on localhost and your tailnet, pairs devices with single-use QR
codes and per-device keys stored in the system keychain, scopes guests to one workspace, and serves previews
in a sandbox. Secrets never go on a command line. [Threat model](docs/security.md).

### Screenshots

| | |
|---|---|
| <img src="docs/assets/agents.png" alt="Agents panel: every running chat across workspaces, with subagent trees, tokens and cost" width="440"><br><sub>**Agents**: every chat in every workspace, with its subagents</sub> | <img src="docs/assets/usage.png" alt="Usage tab: spend today and this month, limit bars per account and a cost-per-day chart" width="440"><br><sub>**Usage**: cost per day, limits per account, a nudge before you hit one</sub> |
| <img src="docs/assets/model-picker.png" alt="Model picker with Claude, GPT and Gemini side by side in the same chat" width="440"><br><sub>**Model picker**: Claude, GPT and Gemini in the same chat</sub> | <img src="docs/assets/mcp.png" alt="Session MCP panel: servers from Claude Code and Codex, tools and tokens per turn, and the tokens saved" width="440"><br><sub>**MCP**: one registry for every AI, and the tokens you save per turn</sub> |
| <img src="docs/assets/workspaces.png" alt="Board with workspaces by status: backlog, in progress, in review, done" width="440"><br><sub>**Board**: workspaces by status</sub> | <img src="docs/assets/menubar.png" alt="Menu bar popover with spend, limits and the agents running now" width="300"><br><sub>**Menu bar**: limits and running agents at a glance</sub> |
| <img src="docs/assets/mobile-preview.png" alt="Phone: file preview with syntax highlight and the model picker" width="440"><br><sub>**Phone**: files with preview, model picker</sub> | <img src="docs/assets/mobile-android.png" alt="Android (Material 3): session list and a chat that switched models" width="440"><br><sub>**Android**: Material 3, same app</sub> |
| <img src="docs/assets/switch-llm-light.png" alt="Light theme: the same conversation across three models" width="440"><br><sub>**Light theme**</sub> | <img src="docs/assets/usage-light.png" alt="Light theme: Usage tab" width="440"><br><sub>**Light theme**: Usage</sub> |

<sub>All screenshots come from a demo environment with made-up data (`npm run demo:capture` in `apps/web`).</sub>

## Supported agents

✅ confirmed by running the installed CLI through Kabul · ◐ partial · ❔ not confirmed yet · — not available

| Agent | How Kabul talks to it | Chat & tools | Approvals | Plan mode | Stop | Resume | Several accounts | Local models | Phone |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | stream-json (native) | ✅ | ✅ | ✅ native | ✅ | ✅ | ✅ | ✅ Anthropic API | ✅ + native remote control |
| Codex | app-server (native) | ✅ | ✅ | ✅ native | ✅ | ✅ | ✅ | ✅ Responses API | ◐ |
| Antigravity (`agy`) | stream-json (native) | ✅ | ✅ project rules | ◐ restarts to exit | ◐ | ✅ | ✅ | — | ✅ + native remote control |
| Gemini CLI | ACP | ✅ | ✅ | ✅ native | ✅ | ✅ | ✅ ¹ | ◐ Gemini-API gateways | ◐ |
| Qwen Code | ACP | ✅ | ✅ | ✅ native | ✅ | ✅ | ✅ | ✅ OpenAI API | ◐ |
| OpenCode | ACP | ✅ | ✅ | ◐ emulated | ✅ | ✅ | ❔ | ✅ OpenAI / Anthropic | ◐ |
| Goose | ACP | ✅ | ✅ | ◐ emulated | ✅ | ✅ | ✅ | ✅ OpenAI API | ◐ |
| Cursor (`cursor-agent`) | ACP | ❔ | ❔ | ❔ | ❔ | ❔ | ❔ | — | ❔ |

¹ Isolated profiles work; signing in with a Google account through Kabul is not tested end to end yet.
"Phone ◐" means the phone gets the same structured chat as the desktop, but only Claude has an end-to-end
test on the phone UI. Any agent, and any shell, can also be followed and typed into from the phone through
the live terminal mirror. Full matrix and details: [Agents and harnesses](docs/guide/agents.md) and
[ACP](docs/acp.md).

## Install

### macOS

Requirements: macOS 14 or later (Apple Silicon or Intel), `git`, `tmux` and the GitHub CLI.

```sh
brew install git tmux gh
```

1. Download the `.dmg` for your Mac from [Releases](https://github.com/valteracetto/kabul/releases) and drag
   **Kabul** to Applications.
2. Install at least one agent, for example `npm install -g @anthropic-ai/claude-code` or
   `npm install -g @openai/codex`. Kabul can also install a missing CLI from **Settings › Accounts**.
3. Open Kabul and sign in to your agents and GitHub in **Settings › Accounts**. Kabul runs each CLI's own
   login; it never sees your password or reads your tokens.

If a build is not notarized yet, macOS blocks the first launch: try to open Kabul once, then go to
System Settings › Privacy & Security and click **Open Anyway** (needed only once). The app updates itself (stable and beta channels).

### Windows (beta)

Kabul builds and runs on Windows 10 1809+ and 11 (`.msi` or `.exe` installer in
[Releases](https://github.com/valteracetto/kabul/releases)). Terminals use ConPTY instead of tmux, secrets
go to the Credential Manager and scripts run in Git Bash. It is a **beta**: terminal sessions don't survive
closing the app yet, the title bar and some shortcuts still look like macOS, and a few CLI installers need
Git Bash. See [Windows](docs/guide/windows.md) for what works and what is missing.

Linux is not packaged. The core and the server build there, but the desktop app is not tested on Linux.

### From source

```sh
cargo test
cd apps/web && npm ci && npm run build
cd ../desktop && npx tauri build
```

## Quick start

1. **Add a project.** `⌘N` › open a local git folder, pick a GitHub repository (cloned with your `gh`
   login), or start an empty one.
2. **Describe the task.** Type what you want and press `↵`. Kabul creates the worktree and branch, copies
   your `.env*` files, runs the setup script and sends the message to the agent.
3. **Pick the model.** `⌘/` opens the picker: Claude, GPT, Gemini, Qwen and your local models side by side.
   Switch any time; the conversation stays.
4. **Steer and review.** Approve or deny tool calls, read the diff in the right panel, comment on a line
   and send the comments back to the agent.
5. **Ship.** **Create PR** (`⌘⇧P`), watch the checks, let the agent fix failures, merge and archive.

Then turn on **Settings › Phone & remote** to pair your phone with a QR code. Full walkthrough in the
[quick start](docs/guide/quick-start.md).

## FAQ

**Is Kabul free?** Yes, MIT licensed. You bring your own agent subscriptions or API keys (Claude, ChatGPT,
Google, local models…). Kabul doesn't resell or proxy model access.

**Does my code leave my computer?** Only what the agents send to their providers and what `gh` sends to
GitHub, exactly as if you ran those CLIs yourself. Kabul has no server of its own and no telemetry.

**Do I need Tailscale?** Only for the phone, other machines and collaboration. The phone server listens on
localhost and your tailnet, never on the open internet.

**Does Kabul replace the agent CLIs?** No. It drives the real CLIs (Claude Code, Codex, Antigravity…), so
you keep their behavior, their updates and your existing logins, settings and MCP servers.

**Can a friend see my other repositories?** No. An invite is scoped to one workspace. But an editor can run
commands as your user (terminal and approvals), so only invite as editor someone you would let use your
computer.

**Is the interface in English?** Yes. The desktop app, the phone app, the menus and the notifications are in
English and Portuguese (Brazil). Kabul follows the system language; to pick one, go to Settings › General ›
Language (System, English or Português).

**Is there a phone app in the stores?** Not yet. The phone app is a PWA you install from the browser; store
builds are on the roadmap.

More in the [FAQ](docs/guide/faq.md).

## Roadmap

- **Kabul Cloud:** invite people and reach your sessions without Tailscale; run the Kabul server on a VM so
  any agent can work away from your computer.
- **Phone apps in the App Store and Google Play,** from the same code, with native push.
- **Windows out of beta:** terminal sessions that survive the app, Ctrl shortcuts and title bar, PowerShell
  installers for every CLI, a Windows E2E run in CI.
- **Handoff:** store history in the canonical transcript and use the agent's own `/compact` summary when
  switching models.
- **More agents:** list ACP models from the agent itself, confirm Cursor, real sign-in status for Gemini CLI,
  Qwen Code and Goose.
- **Opt-in observability:** OpenTelemetry traces and metrics (metadata only, off by default) to your own
  collector.
- **1.0** when feature parity, Windows and the phone are stable.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) (commits, versions,
CI and releases) and the [contributing guide](docs/guide/contributing.md) (layout, commands and rules).
Security issues: please report privately, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
