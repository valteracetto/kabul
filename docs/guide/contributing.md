English · [Português](../pt-BR/guia/contribuir.md)

# Contributing

Issues and pull requests are welcome: bug reports with **Help › Diagnostics** attached, confirmations of agents
marked "to be confirmed", Windows testing, translations and documentation.

## Layout

- `crates/kabul-core`: Rust core (worktrees, git, harnesses, transcript, settings, terminal backends, usage).
- `crates/kabuld`: the server for the phone, other machines and collaboration.
- `crates/kabul-cli`: `kabul` CLI, `kabul serve` (HTTP RPC used by the end-to-end tests against the real core)
  and `kabul loadtest`.
- `apps/web`: React UI (also the phone PWA in `src/mobile`). `apps/desktop`: Tauri shell.
- `docs`: this site (VitePress), in English (`docs/guide`) and Portuguese (`docs/pt-BR/guia`), plus the
  technical reference in Portuguese at the root of `docs/`.

## Commands

```sh
cargo test                              # core, server and CLI
cd apps/web && npm run build            # UI
cd apps/web && npm run e2e              # Playwright: mock backend and the real core through kabul serve
cd apps/web && npm run perf             # performance budgets (100 workspaces, 30 agents)
cd apps/web && npm run docs:shortcuts   # regenerate the shortcut tables from src/i18n/shortcuts.json
cd apps/web && npm run i18n:check       # UI text: no hard-coded strings, no key missing in a language
cd docs && npm ci && npm run docs:dev   # this site, with hot reload
cd docs && npm run docs:build           # build the site (must pass before merging docs changes)
```

## Rules

- No personal data in commits, fixtures or screenshots (use the `dev` user, `/home/dev` and example domains).
- New macOS-only code goes behind an adapter and is listed in the [Windows reference](../windows.md).
- UI text lives in `apps/web/src/i18n/locales/{en,pt-BR}/*.json` and is read with `t("area.key")`; every key
  exists in both languages, plurals use `{ "one", "other" }` with `count`, and dates, numbers, money and
  durations go through `src/i18n/format.ts`. `npm run i18n:check` fails on hard-coded text in JSX or a key
  missing in a language. Details in the [i18n reference](../i18n.md) (in Portuguese).
- Documentation changes go in both languages. Don't promise what isn't confirmed: mark it as beta or "to be
  confirmed".

Commits (Conventional Commits), versions, changelog, CI and releases: `CONTRIBUTING.md` at the root of the
repository.
