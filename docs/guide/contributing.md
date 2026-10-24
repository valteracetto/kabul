English · [Português](../pt-BR/guia/contribuir.md)

# Contributing

- `crates/kabul-core`: Rust core (worktrees, git, harnesses, transcript, settings, tmux).
- `crates/kabul-cli`: `kabul` CLI and `kabul serve` (HTTP RPC used by the end-to-end tests against the real core).
- `apps/web`: React UI (also the PWA). `apps/desktop`: Tauri shell.

```sh
cargo test                         # core
cd apps/web && npm run build       # UI
cd apps/web && npm run e2e         # Playwright: mock backend and the real core through kabul serve
cd apps/web && npm run docs:shortcuts   # regenerate the shortcut tables from src/i18n/shortcuts.json
```

Rules: no personal data in commits or fixtures (use the `dev` user and `/home/dev`), new macOS-only code goes behind an adapter and is listed in `docs/windows.md`, and UI text lives in `apps/web/src/i18n`.
