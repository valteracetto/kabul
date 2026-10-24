English · [Português](../pt-BR/guia/scripts.md)

# Scripts and `.kabul/settings.toml`

Settings are read in layers, highest priority first:

1. `~/.kabul/settings.managed.toml` (managed)
2. `<repo>/.kabul/settings.local.toml` (yours, not versioned)
3. `<repo>/.kabul/settings.toml` (shared, read from the default branch on the remote)
4. `~/.kabul/settings.toml` (user)

```toml
target_branch = "main"
base_branch = "develop"        # new workspaces branch from here
remote = "origin"
file_include_globs = ["config/*.local.json"]   # ignored files copied to each worktree (plus .env* and .worktreeinclude)
preview_url = "http://localhost:$KABUL_PORT"

[scripts]
setup = "npm install"
archive = "docker compose down"
run_mode = "concurrent"        # or "nonconcurrent"

[scripts.run.web]
command = "npm run dev -- --port $KABUL_PORT"
default = true

[env]
API_URL = "http://localhost:$((KABUL_PORT+1))"

[prompts]
review = "Focus on security."
general = "Answer in English and run the tests before saying you are done."
```

- **Setup** runs when a workspace is created (log in `.context/setup-logs.txt`). **Run** starts from the bottom panel or with `⌘R` in the terminal. **Archive** runs before archiving.
- **Prompts** add instructions to the Review, Create PR, Fix errors, Resolve conflicts and branch-name actions; `general` is also sent to Claude as a system prompt. Edit them in **Settings › Actions**.
