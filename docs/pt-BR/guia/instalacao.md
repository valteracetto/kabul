[English](../../guide/installation.md) · Português

# Instalação

## macOS

**Requisitos:** macOS 14 ou mais novo (Apple Silicon ou Intel), `git`, `tmux` e o GitHub CLI (`gh`, para pull
requests e repositórios privados).

```sh
brew install git tmux gh
```

1. Baixe o `.dmg` do seu Mac (`aarch64` para Apple Silicon, `x64` para Intel) na
   [página de versões](https://github.com/valteracetto/kabul/releases) e arraste o **Kabul** para Aplicativos.
2. Instale os agentes que quiser usar. Um só já basta para começar:

   | Agente | Instalar |
   |---|---|
   | Claude Code | `npm install -g @anthropic-ai/claude-code` |
   | Codex | `npm install -g @openai/codex` |
   | Antigravity (`agy`), Gemini CLI, Qwen Code, OpenCode, Goose | instaladores próprios |

   O Kabul também instala um CLI que falte em **Configurações › Contas**.
3. Entre em cada agente em **Configurações › Contas**. O Kabul roda o login do próprio CLI num terminal e só
   mostra o link de entrada e o campo do código; ele nunca lê os seus tokens. Dá para ter várias contas por
   provedor.
4. Conecte o GitHub em **Configurações › Contas › GitHub** (`gh auth login` no navegador, com código de
   dispositivo).

Aberto pelo Dock, o Kabul lê uma vez, na abertura, o ambiente do seu shell de login (`PATH`, `LANG` e o resto),
então acha CLIs instalados por `nvm`, Homebrew ou `~/.local/bin`. Se algum ainda não aparecer, aponte o caminho
em **Configurações › Avançado**.

### Primeira abertura e atualizações

Se uma versão ainda não estiver notarizada pela Apple, o macOS bloqueia a primeira abertura. Clique com o botão
direito no Kabul em Aplicativos › **Abrir**, ou vá em Ajustes do Sistema › Privacidade e Segurança › **Abrir
Mesmo Assim**. Só precisa fazer isso uma vez.

O Kabul procura atualizações sozinho e instala versões assinadas. Escolha o canal **estável** ou **beta** nas
configurações.

### Opcionais

- **Tailscale** no computador e no celular, para o [app do celular](./nuvem-e-celular.md), outras máquinas e a
  [colaboração](./colaboracao.md).
- **`ffmpeg` e `whisper-cpp`** (`brew install ffmpeg whisper-cpp`) e um modelo do Whisper, para o
  [ditado](./ditado.md) offline.
- **Um servidor de modelos locais** (LM Studio, Ollama, llama.cpp, vLLM ou MLX), para os
  [modelos locais](./modelos-locais.md).

## Windows (beta)

Baixe o instalador `.msi` ou `.exe` na [página de versões](https://github.com/valteracetto/kabul/releases). O
suporte ao Windows está em beta: leia [Windows](./windows.md) para saber o que funciona, o que falta e o que
instalar antes (o Git for Windows é obrigatório).

## Linux

Não há pacote para Linux. O core, o servidor `kabuld` e o CLI compilam no Linux, mas o app desktop não é
testado lá.

## Compilar a partir do código

Requisitos: Rust (stable), Node.js (LTS) e, no macOS, as ferramentas de linha de comando do Xcode.

```sh
git clone https://github.com/valteracetto/kabul.git && cd kabul
cargo test
cd apps/web && npm ci && npm run build
cd ../desktop && npx tauri build
```

O app fica em `target/release/bundle/`. Para rodar o servidor do celular sozinho (numa máquina sem o app), veja
[Nuvem e celular](./nuvem-e-celular.md#servidor-sem-o-app).
