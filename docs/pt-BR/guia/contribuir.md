[English](../../guide/contributing.md) · Português

# Como contribuir

Issues e pull requests são bem-vindos: relatos de bug com o **Ajuda › Diagnóstico** anexado, confirmação de
agentes marcados "a confirmar", testes no Windows, traduções e documentação.

## Estrutura

- `crates/kabul-core`: núcleo em Rust (worktrees, git, harnesses, transcript, configurações, backends de
  terminal, uso).
- `crates/kabuld`: o servidor do celular, de outras máquinas e da colaboração.
- `crates/kabul-cli`: CLI `kabul`, `kabul serve` (RPC HTTP usado pelos testes ponta a ponta contra o núcleo de
  verdade) e `kabul loadtest`.
- `apps/web`: interface em React (também a PWA do celular, em `src/mobile`). `apps/desktop`: casca Tauri.
- `docs`: este site (VitePress), em inglês (`docs/guide`) e português (`docs/pt-BR/guia`), mais a referência
  técnica em português na raiz de `docs/`.

## Comandos

```sh
cargo test                              # núcleo, servidor e CLI
cd apps/web && npm run build            # interface
cd apps/web && npm run e2e              # Playwright: backend mock e o núcleo real pelo kabul serve
cd apps/web && npm run perf             # orçamentos de desempenho (100 workspaces, 30 agentes)
cd apps/web && npm run docs:shortcuts   # regenera as tabelas de atalhos a partir de src/i18n/shortcuts.json
cd docs && npm ci && npm run docs:dev   # este site, recarregando ao salvar
cd docs && npm run docs:build           # gera o site (precisa passar antes do merge de mudanças nos docs)
```

## Regras

- Nada de dados pessoais em commits, fixtures ou capturas (use o usuário `dev`, `/home/dev` e domínios de
  exemplo).
- Código novo que dependa do macOS fica atrás de um adaptador e entra na [referência do Windows](../../windows.md).
- Textos da interface ficam em `apps/web/src/i18n`.
- Mudanças na documentação vão nos dois idiomas. Não prometa o que não está confirmado: marque como beta ou
  "a confirmar".

Commits (Conventional Commits), versões, changelog, CI e releases: `CONTRIBUTING.pt-BR.md` na raiz do
repositório.
