English · [Português](../pt-BR/guia/conceitos.md)

# Concepts

**Project (repository).** A git repository you added. Kabul never changes the main checkout; it creates worktrees next to it.

**Workspace.** One task. A git worktree in `~/kabul/workspaces/<project>/<city>` on its own branch, with ten reserved ports (`KABUL_PORT` … `KABUL_PORT+9`), a terminal, setup/run scripts and any number of chats. Workspaces have a status (Backlog, In progress, In review, Done, Canceled), can be pinned, grouped in sections, marked unread and archived. Archiving saves every change in a checkpoint and removes the worktree; unarchiving brings it back.

**Branch and target branch.** New workspaces branch from the base branch (default branch, or the one set in **Settings › Git**). The target branch (shown as `→ main` next to the branch) is what the diff and the pull request compare against.

**Harness.** The command-line agent that runs a model: Claude Code, Codex, Antigravity, OpenCode, Qwen Code or Gemini CLI. Local models run through the harness chosen by the [harness registry](./agents.md#harness-registry).

**Where it runs.** Each chat shows where it runs: on this Mac, in the provider's cloud (`claude --cloud`) or, soon, on another machine through Tailscale.

**Accounts.** You can keep several logins per provider (for example a personal and a work Claude account). Each profile has an isolated configuration folder and every chat shows which account it uses.

**Machines.** The machine picker at the top of the sidebar switches between this Mac and other machines running `kabuld` (`⌃1` … `⌃9`).

![Sidebar with sections, pinned workspaces and statuses](/screens/barra-lateral.png)
