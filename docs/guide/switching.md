English · [Português](../pt-BR/guia/trocar.md)

# Switching model or account in the same conversation

Pick another model in the same chat (`⌘/`), even one that runs on a different harness: Claude Code → Codex →
a local Qwen through Qwen Code → back to Claude. The conversation, the branch and the worktree stay the same.

Typical reasons:

- an account hit its 5-hour or weekly limit, and you have another account or provider with room;
- you want a second opinion on a plan or a review from a different model family;
- the next part is mechanical and a cheaper or local model is good enough.

## What happens when you switch

- **Same harness, same account:** the agent's own session resumes (`--resume` or equivalent). Nothing is lost.
- **Different harness:** Kabul closes the current segment of the [transcript](./concepts.md), shows a divider
  in the chat ("Switched to Gemini · Antigravity") and starts the new agent with a **handoff**. It is plain
  text, so it works with any harness:
  - the latest messages, with who wrote each one (you, a guest, which model);
  - the tools used and the files changed;
  - the branch and `git diff --stat` against the target;
  - the files in `.context/`.
- **Another account of the same provider** works the same way ("Switched to account X"): each account has an
  isolated configuration, so the new one can't resume the old session and gets a handoff instead.

The new agent runs in the **same worktree**, and checkpoints keep being recorded before every message.

## Accounts

Add as many accounts per provider as you need in **Settings › Accounts** (for example a personal and a work
Claude subscription). Each profile runs the CLI with its own configuration folder:

| Agent | Isolated by |
|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` |
| Codex | `CODEX_HOME` |
| Antigravity, Qwen Code, Gemini CLI, Goose | a profile `HOME` |
| GitHub CLI | `GH_CONFIG_DIR` |
| OpenCode | to be confirmed |

The default account of each provider is the CLI's normal configuration. The account picker sits next to the
model picker in the composer, and every chat shows which account it uses.

## Switching before you hit a limit

The [Usage tab](./usage.md) watches each account's windows. When one passes your threshold it suggests another
account of the same provider (if one has room) or another provider; **Use** applies the switch to the open
conversations of that provider on their next message, through the same handoff.

## Fork and reset use the same transcript

- **Fork to new tab** (`⌘⌥↵`): a new chat from any turn. Same harness and last turn: the agent's own fork;
  otherwise a replay of the transcript up to that point.
- **Fork to new workspace:** a new worktree at that turn's checkpoint, with the conversation up to it.
- **Reset chat:** cut the conversation at a message and, optionally, restore the files from the checkpoint
  taken before it.

## Current limits

- The handoff carries the latest messages, not the whole history. A summary of older history (from the
  agent's own `/compact`) is on the roadmap; until then, keep long-lived decisions in `.context/` or in the
  repository, where every agent reads them.
- Returning to an earlier model always goes through a handoff; resuming that model's own earlier session is on
  the roadmap.

Engineering details (in Portuguese): [Handoff and transcript](../handoff.md).
