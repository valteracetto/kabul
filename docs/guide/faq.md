English · [Português](../pt-BR/guia/faq.md)

# FAQ

## General

**Is Kabul free?** Yes, it is open source under the MIT license. You bring your own agent subscriptions or API
keys (Claude, ChatGPT, Google, local models…). Kabul doesn't resell or proxy model access.

**Does Kabul replace the agent CLIs?** No. It drives the real CLIs (Claude Code, Codex, Antigravity, Gemini CLI,
Qwen Code, OpenCode, Goose…), so you keep their behavior, their updates and your existing logins, settings and
MCP servers.

**Which agent should I use?** The one made for your model: Kabul picks it when you choose the model. See
[Agents and harnesses](./agents.md) for what each one supports and what is still being confirmed.

**Is the interface in English?** Not yet. The app's interface is in Portuguese (Brazil) today; the English
translation is in progress. These docs use the English names of menus and buttons, and shortcuts are the same.

**Which platforms?** macOS (Apple Silicon and Intel) is the main platform. Windows is in
[beta](./windows.md). Linux is not packaged. The phone app runs on iOS and Android.

## Data and privacy

**Where is my data?** On your computer: `~/Library/Application Support/kabul` on macOS or `%APPDATA%\kabul` on
Windows (settings, chat history, usage, logs) and `~/kabul/workspaces` (worktrees).

**Does my code leave my computer?** Only what the agents send to their providers and what `gh` sends to
GitHub, exactly as if you ran those CLIs yourself. Kabul has no server of its own and no telemetry.

**Does Kabul read my tokens?** No. Sign-in runs each CLI's own login; Kabul only checks whether you are signed
in. Tokens Kabul stores itself (GitHub, Linear, device keys) go to the system keychain.

**Does Kabul send anything to GitHub by itself?** Only when you press push, merge, ready, re-run or create a PR.
**Settings › Git › Simulate GitHub actions** shows the commands without running them.

## Phone and collaboration

**Do I need Tailscale?** Only for the phone, other machines and collaboration. `kabuld` listens on localhost
and your tailnet, never on the open internet.

**Is there an app in the App Store or Google Play?** Not yet. The phone app is a PWA you install from the
browser (Add to Home Screen). Store builds are on the roadmap.

**Can a friend see my other repositories?** No. An invite is scoped to one workspace. But an editor can run
commands as your user, so only invite as editor someone you would let use your computer.

## Troubleshooting

**The terminal says the session ended right away.** On macOS, check that `tmux` is installed. Kabul runs
`tmux -u`, so it works even when the app is opened from the Dock without a UTF-8 locale.

**An agent doesn't show up or isn't found.** Kabul reads your login shell environment at startup; restart Kabul
after installing a CLI. You can also point to a specific binary in **Settings › Advanced**.

**The agent answered nothing.** The chat shows the last lines the agent printed on stderr, and `logs/agents.log`
records each session (command, arguments and environment variable names, never values). **Help › Diagnostics**
checks your tools and copies a report without personal data.

**macOS says Kabul can't be opened.** A build that is not notarized yet: right-click › **Open** once, or allow
it in System Settings › Privacy & Security.

**The phone can't install the app or get notifications.** It needs HTTPS: turn on **HTTPS** in **Settings ›
Phone and remote** and enable MagicDNS and HTTPS certificates in your tailnet.

**Can I use my existing settings files?** Yes. Kabul reads `.kabul/settings.toml` and also understands the
common layout used by other worktree tools.
