English · [Português](README.pt-BR.md)

# Kabul

Parallel coding agents, each in its own git worktree. Run Claude Code, Codex, Gemini (Antigravity), OpenCode, Qwen Code and local models side by side; switch model or account in the middle of a conversation; review the diff, comment for the agent and ship the pull request; follow every session from your phone.

- **Workspaces**: one git worktree and branch per task, with reserved ports, setup/run/archive scripts, a terminal and any number of chats.
- **Any agent**: tool approvals, plan mode, questions, queued messages, forks and resets; model lists come from your accounts.
- **Review and ship**: split diff with line comments, checks with logs, commit and push, pull, merge, ready for review and archive.
- **Everything at hand**: command palette (`⌘K`), quick open (`⌘P`), search in files (`⌘⇧F`), sections, statuses and pinned workspaces.

Documentation: [docs/](docs/index.md) ([guide](docs/guide/quick-start.md)). macOS today; Windows coming soon.

```sh
cargo test
cd apps/web && npm install && npm run build && npm run e2e
cd apps/desktop && npx tauri build
```

See [Contributing](docs/guide/contributing.md).
