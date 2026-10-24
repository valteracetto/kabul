English · [Português](../pt-BR/guia/faq.md)

# FAQ

**Where is my data?** In `~/Library/Application Support/kabul` (settings, chat history, logs) and `~/kabul/workspaces` (worktrees). Nothing leaves your machine except what the agents and `gh` send.

**The terminal says the session ended right away.** Check `tmux` is installed. Kabul runs `tmux -u`, so it works even when the app is opened from the Dock without a UTF-8 locale.

**The agent answered nothing.** The chat shows the last lines the agent printed on stderr, and `logs/agents.log` records each session (command, arguments and environment variable names, never values). **Help › Diagnostics** checks your tools and copies a report without personal data.

**Can I use my existing settings files?** Yes. Kabul reads `.kabul/settings.toml` and also understands the common legacy layout used by other worktree tools.

**Does Kabul send anything to GitHub by itself?** Only when you press push, merge, ready, re-run or create a PR. **Settings › Git › Simulate GitHub actions** shows the commands without running them.
