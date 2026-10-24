English · [Português](../pt-BR/guia/ambiente.md)

# `KABUL_*` variables

Scripts, terminals and agents get:

| Variable | Value |
|---|---|
| `KABUL_WORKSPACE_NAME` | Workspace name (the city) |
| `KABUL_WORKSPACE_ID` | Workspace id |
| `KABUL_WORKSPACE_PATH` | Worktree path |
| `KABUL_ROOT_PATH` | Main checkout of the repository |
| `KABUL_DEFAULT_BRANCH` | Default branch |
| `KABUL_TARGET_BRANCH` | Target branch of the workspace |
| `KABUL_PORT` | First of ten reserved ports (`KABUL_PORT` … `KABUL_PORT+9`) |
| `KABUL_IS_LOCAL` | `1` when running on this machine |

## Your own variables

**Settings › Environment** has two scopes:

- **User**: variables for every chat, optionally only for one agent (`claude`, `codex`, `opencode`…). Paste `KEY=VALUE` lines in bulk or point to a `.env` file.
- **Repository**: shared variables from `.kabul/settings.toml` appear as inherited; yours go to `settings.local.toml` and override them.
