[English](../../guide/contributing.md) · Português

# Como contribuir

- `crates/kabul-core`: núcleo em Rust (worktrees, git, harnesses, transcript, configurações, tmux).
- `crates/kabul-cli`: CLI `kabul` e `kabul serve` (RPC HTTP usado pelos testes ponta a ponta contra o núcleo de verdade).
- `apps/web`: interface em React (também a PWA). `apps/desktop`: casca Tauri.

```sh
cargo test                         # núcleo
cd apps/web && npm run build       # interface
cd apps/web && npm run e2e         # Playwright: backend mock e o núcleo real pelo kabul serve
cd apps/web && npm run docs:shortcuts   # regenera as tabelas de atalhos a partir de src/i18n/shortcuts.json
```

Regras: nada de dados pessoais em commits ou fixtures (use o usuário `dev` e `/home/dev`); código novo que dependa do macOS fica atrás de um adaptador e entra em `docs/windows.md`; textos da interface ficam em `apps/web/src/i18n`.
