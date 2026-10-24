English · [Português](../pt-BR/guia/trocar.md)

# Switching model or account in the same conversation

Pick another model in the same chat (`⌘/`), even one that runs on a different harness (Claude Code → Codex → a local Qwen through OpenCode). The branch and the worktree stay the same.

- Same harness: the session resumes (`--resume`).
- Different harness: Kabul shows a divider ("Switched to X · harness Y") and sends the new agent a handoff with the summary, the last messages and who wrote them, the tools used, the changed files and the `.context/` folder.
- Another account of the same provider works the same way ("Switched to account X"), because each account has an isolated configuration.

The same transcript powers **Fork to new tab** (`⌘⌥↵`), **Fork to new workspace** and **Reset chat** (optionally restoring the files from the checkpoint taken before that message).
