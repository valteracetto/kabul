[English](../../guide/installation.md) · Português

# Instalação

## macOS

Requisitos: macOS 14 ou mais novo, `git`, `tmux` (`brew install tmux`) e o GitHub CLI (`brew install gh`) para pull requests e para clonar repositórios privados.

1. Baixe o `Kabul.app` e mova para `/Applications`.
2. Instale os agentes que quiser usar:
   - Claude Code: `npm install -g @anthropic-ai/claude-code`
   - Codex: `npm install -g @openai/codex`
   - OpenCode, Qwen Code, Gemini CLI e Antigravity (`agy`) pelos instaladores de cada um.
   O Kabul também instala um CLI que falte, em **Configurações › Contas**.
3. Entre em cada agente em **Configurações › Contas** (o Kabul roda o login do próprio CLI e só mostra a URL e o campo do código; nunca lê seus tokens).
4. Conecte o GitHub em **Configurações › Contas › GitHub** (`gh auth login` no navegador, com código).

Aberto pelo Dock, o Kabul lê uma vez o ambiente do seu shell de login (`PATH`, `LANG` e o resto), então acha CLIs instalados por `nvm`, Homebrew ou `~/.local/bin`.

### Compilar a partir do código

```sh
cd apps/web && npm install && npm run build
cd ../desktop && npx tauri build
```

## Windows

Em breve. O núcleo já isola o que é só do macOS em adaptadores pequenos; o plano está em `docs/windows.md`.
