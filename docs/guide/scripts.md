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
browser_hosts = ["staging.example.com"]   # browser: domains agents open without asking

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

## Actions: arguments, folder and hiding

```toml
[scripts.run.storybook]
command = "pnpm storybook"
args = ["--port", "6006"]        # appended to the command, quoted for the shell
options.cwd = "packages/ui"      # folder inside the workspace
available_in = "local"           # text or list

[[preview_urls]]                 # several preview URLs; the first one is the default
name = "Web"
url = "http://localhost:$KABUL_PORT"
```

In `settings.local.toml`, `hide = true` under `[scripts.run.<id>]` hides a shared action on your machine only (no
`command` needed: the other fields of the shared action are kept).

## Files to copy

New workspaces get the git-ignored files that match `.env*`, `file_include_globs` and `.worktreeinclude`, in that
order. As in `.gitignore`, the last match wins, so `!.env.production` in `file_include_globs` or `.worktreeinclude`
keeps that file out. `file_include_globs` may be a list or a text with one pattern per line.

## Settings that were not read

Each key is read on its own: a value of the wrong type (say, a number where text was expected) is ignored with a
warning, and the rest of the file still applies. **Settings › Scripts** shows a "Some settings were not read" box
with the file, the key and the reason, and **Help › Diagnostics** lists the same thing per repository. Unknown keys
are reported too.

## Legacy settings from another app

When the repository has no `.kabul/` folder, Kabul reads `settings.toml` and `settings.local.toml` from the
configuration folder of the app it replaces. While there is no shared `settings.toml` (in either folder), it also reads
that app's older JSON file, at the root or inside its folder. The format documented for that folder is understood as
is:

| There | In Kabul |
|---|---|
| `file_include_globs = ".env*\nconfig/*.local.json"` (text) | the list of patterns |
| `scripts.run = "pnpm dev"` (single action) | the `dev` action, default |
| `scripts.run.<id>` with `args`, `options.cwd`, `hide`, `available_in` | the same fields |
| `[environment_variables]` and `[environment_variables.local]` | `[env]` |
| `[[preview_urls]]` | `preview_urls` (the first one is also `preview_url`) |
| `[git] archive_on_merge`, `delete_branch_on_archive` | the same keys at the top level |
| `prompts.code_review`, `resolve_merge_conflicts`, `rename_branch` | `review`, `resolve_conflicts`, `branch_rename` |
| `runScriptMode` in the JSON file | `scripts.run_mode` |

What has no equivalent (`environment_variables.cloud`, `enterprise_data_privacy`, `spotlight_testing`, provider keys)
or lives in Kabul's own settings (`git.branch_prefix*`, executables, models) is listed in the warnings box instead of
being dropped silently. Variables are also exported with the legacy prefix, so scripts written for that app (its
`…_PORT`, `…_WORKSPACE_PATH` and so on) keep working next to `KABUL_*`.

**Import legacy settings** (in **Settings › Scripts**) converts that configuration to `.kabul/settings.toml` (and
`settings.local.toml`, if there is one). It shows the generated file first, with the keys that were not imported
listed at the top, and writes only after you confirm. It never overwrites an existing file and leaves the original
files alone; review and commit the result.
