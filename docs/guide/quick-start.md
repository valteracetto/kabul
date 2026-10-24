English · [Português](../pt-BR/guia/inicio-rapido.md)

# Quick start

1. **Install Kabul** (macOS) and at least one agent CLI, for example Claude Code (`claude`) or Codex (`codex`). See [Installation](./installation.md).
2. **Add a project.** Press `⌘N` and open the project picker, then choose **Open project** (a local git folder), **Open GitHub project** (pick a repository from your account or paste a URL; Kabul clones it with the GitHub CLI credentials) or **Quick start** (a new folder with `git init`, a README and a first commit).
3. **Create a workspace.** Type what you want to work on and press `↵`. Kabul creates a git worktree on a new branch (`<your GitHub user>/<city>`), copies your `.env*` files, runs the setup script and sends your first message to the agent. `⌥↵` adds it to the backlog instead.
4. **Talk to the agent.** Pick the model with `⌘/`, attach files with `⌘U`, mention files with `@` and run commands with `/`. Approve tool calls with `↵`, always allow with `⌘↵`, deny with `⌫`.
5. **Review.** The right panel shows the changes (`⌘⌥B` toggles it). Open a file to see the diff, comment on a line and send the comments to the agent.
6. **Ship.** The git button follows the state of the branch: **Create PR** (`⌘⇧P`), **Commit and push** (`⌘⇧Y`), **Pull** (`⌘⇧L`), **Fix errors** (`⌘⇧X`), **Merge** (`⌘⇧M`) and **Archive** (`⌘⇧A`).

![Workspace with the git menu](/screens/git-menu.png)

Next: [Concepts](./concepts.md).
