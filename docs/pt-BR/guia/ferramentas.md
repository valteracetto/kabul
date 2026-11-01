[English](../../guide/tools.md) · Português

# Ferramentas

Cada IA de programação guarda as próprias extensões nas próprias pastas: skills, comandos com barra, prompts, subagentes, plugins, hooks, servidores MCP, extensões e arquivos de instruções. Depois de alguns meses fica difícil lembrar o que você tem, em qual IA, para que serve cada coisa e de onde ela veio. **Ferramentas** mostra tudo num lugar só, de todas as IAs do seu computador e de cada um dos seus repositórios.

Ferramentas é **só leitura**: nunca mexe nas pastas das suas IAs. A única coisa que grava é o estado do próprio Kabul (favoritos, notas e um cache pequeno).

## Como abrir

- Desktop: barra lateral › **Mais** (`···`) › **Ferramentas** — a linha mostra um número vermelho quando algo está quebrado. Também **⌘⇧U** e a paleta (**⌘K** › "Ferramentas", "Ferramentas: saúde", ou digite um nome: `Skill: test-driven-development`, `Comando: /commit`, `MCP: docs-search` abre o detalhe).
- Celular (iPhone e Android): **Configurações › Ferramentas**, ou o botão da caixa de ferramentas no topo da lista de workspaces. Só leitura, os mesmos dados do desktop.

## O que aparece

- **Escopo**: **Global** (instalado no seu computador, vale para todos os projetos), **Este repo** (o que as IAs enxergam no repositório do workspace aberto: o global mais o que o projeto traz) e **Todos** (o global mais todos os repositórios do Kabul).
- **Chips por IA** com contagem, filtro por tipo (skills, comandos, MCPs…) e busca (nome, descrição, categoria, IA, fonte, sua nota).
- **N pastas lidas**: cada pasta e arquivo lido, agrupado por IA, com a contagem de itens ou "não existe", a conta do Kabul a que pertence e a variável de ambiente que a moveu.
- **Catálogo**: cartões agrupados por categoria (testes, revisão, git, nuvem…), favoritos primeiro. Cada cartão tem o nome, para que serve (a primeira frase da descrição), a fonte e um selo por IA:
  - cheio = uma cópia de verdade na pasta daquela IA;
  - tracejado = um link (em geral para a pasta compartilhada `.agents` — o jeito saudável);
  - âmbar = uma cópia com conteúdo diferente das outras;
  - vermelho = um link quebrado.
- **Matriz**: itens × IAs (● cópia, ↗ link, ⚠ divergente, ✕ quebrado, ◆ gerido pela IA ou por um plugin), com "só com problema".
- **Fontes**: de onde as coisas vieram — locks do `npx skills` (global e `skills-lock.json` no projeto), marketplaces de plugins, repositórios git, ferramentas instaladas com registro próprio, pacotes npm globais, ferramentas `uv`, embutidos — com URL, versão ou commit, datas, os itens que trouxeram e a **pegada**: o que deixaram fora das pastas de extensões (pasta e programas próprios, pacote npm, hooks e servidores MCP que registraram, arquivos de configuração que alteraram).
- **Saúde**: problemas por severidade, cada um com o **por que importa** (veja abaixo).
- **Detalhe** (clique num cartão): o `SKILL.md` renderizado (ou o arquivo do comando/subagente), o cabeçalho, cada lugar onde ele está com o estado, como chamar em cada IA (`/nome` no Claude Code, `$nome` no Codex, `/prompts:nome` nos prompts do Codex, `@agent-nome` nos subagentes, automático pela descrição nas outras), tamanho em tokens, riscos, a fonte, **Mostrar na pasta** (desktop), **favorito** e **nota**.

## Quais IAs e pastas são lidas

A tabela abaixo vem direto da tabela de provedores do Kabul (`crates/kabul-core/src/tools/providers.rs`): adicionar uma IA nova é uma linha lá. Os caminhos globais usam `~` para a pasta pessoal e `$CONFIG` para `$XDG_CONFIG_HOME` (ou `~/.config`); no Windows, `$APPDATA` é `%APPDATA%`.

<!-- providers:start -->
| IA | Pastas globais | No projeto | Arquivos de MCP | Move a pasta |
|---|---|---|---|---|
| Compartilhada (`.agents`) | `~/.agents/skills` | `.agents/skills` | — | — |
| Claude Code | `~/.claude/skills`<br>`~/.claude/skills/synced`<br>`~/.claude/commands`<br>`~/.claude/agents`<br>`~/.claude/plugins` | `.claude/skills`<br>`.claude/commands`<br>`.claude/agents` | `~/.claude.json`, `.mcp.json` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/skills`<br>`~/.codex/skills/.system`<br>`~/.codex/prompts`<br>`~/.codex/plugins` | `.codex/skills` | `config.toml`, `.codex/config.toml` | `CODEX_HOME` |
| Gemini CLI | `~/.gemini/skills`<br>`~/.gemini/commands`<br>`~/.gemini/extensions` | `.gemini/skills`<br>`.gemini/commands`<br>`.gemini/extensions` | `settings.json`, `.gemini/settings.json` | — |
| Antigravity CLI | `~/.gemini/antigravity-cli/skills`<br>`~/.gemini/antigravity-cli/builtin/skills` | — | `~/.gemini/config/mcp_config.json` | — |
| Antigravity | `~/.gemini/antigravity/skills`<br>`~/.gemini/antigravity/global_skills` | `.agent/skills`<br>`.agent/rules`<br>`.agent/workflows` | `mcp_config.json` | — |
| Qwen Code | `~/.qwen/skills`<br>`~/.qwen/commands`<br>`~/.qwen/agents`<br>`~/.qwen/extensions` | `.qwen/skills`<br>`.qwen/commands`<br>`.qwen/agents` | `settings.json`, `.qwen/settings.json` | — |
| OpenCode | `$CONFIG/opencode/skills`<br>`$CONFIG/opencode/command`<br>`$CONFIG/opencode/commands`<br>`$CONFIG/opencode/agent`<br>`$CONFIG/opencode/agents` | `.opencode/skills`<br>`.opencode/command`<br>`.opencode/commands`<br>`.opencode/agent`<br>`.opencode/agents` | `opencode.json`, `opencode.jsonc` | `OPENCODE_CONFIG_DIR` |
| Goose | `$CONFIG/goose/skills` | `.goose/skills` | `config.yaml` | Windows: `$APPDATA/Block/goose/config` |
| Cursor | `~/.cursor/skills`<br>`~/.cursor/commands`<br>`~/.cursor/agents`<br>`~/.cursor/plugins` | `.cursor/skills`<br>`.cursor/commands`<br>`.cursor/agents`<br>`.cursor/rules` | `mcp.json`, `.cursor/mcp.json` | — |
| GitHub Copilot CLI | `~/.copilot/skills`<br>`~/.copilot/agents` | `.github/skills`<br>`.github/agents`<br>`.github/prompts`<br>`.github/instructions` | `mcp-config.json` | `COPILOT_HOME` |
| VS Code (Copilot) | `$APPDATA/Code/User/prompts` | — | `mcp.json`, `.vscode/mcp.json` | — |
| Windsurf | `~/.codeium/windsurf/skills`<br>`~/.codeium/windsurf/global_workflows` | `.windsurf/skills`<br>`.windsurf/rules`<br>`.windsurf/workflows` | `mcp_config.json` | — |
| Cline | `~/.cline/skills` | `.cline/skills`<br>`.clinerules` | — | — |
| Roo Code | `~/.roo/skills`<br>`~/.roo/rules`<br>`~/.roo/commands` | `.roo/skills`<br>`.roo/rules`<br>`.roo/commands` | `.roo/mcp.json` | — |
| Kilo Code | `~/.kilocode/skills`<br>`~/.kilocode/rules`<br>`~/.kilocode/workflows` | `.kilocode/skills`<br>`.kilocode/rules`<br>`.kilocode/workflows` | `.kilocode/mcp.json` | — |
| Continue | `~/.continue/skills`<br>`~/.continue/prompts`<br>`~/.continue/rules` | `.continue/skills`<br>`.continue/prompts`<br>`.continue/rules` | — | — |
| Amp | `$CONFIG/agents/skills` | — | `$CONFIG/amp/settings.json` | — |
| Kiro | `~/.kiro/skills`<br>`~/.kiro/steering` | `.kiro/skills`<br>`.kiro/steering` | `settings/mcp.json`, `.kiro/settings/mcp.json` | — |
| Zed | — | — | `settings.json`, `.zed/settings.json` | — |
| Junie | `~/.junie/skills` | `.junie/skills` | `mcp/mcp.json` | — |
| Trae | `~/.trae/skills` | `.trae/skills`<br>`.trae/rules` | — | — |
| Augment | `~/.augment/skills`<br>`~/.augment/commands` | `.augment/skills`<br>`.augment/commands`<br>`.augment/rules` | — | — |
| Crush | `$CONFIG/crush/skills` | `.crush/skills` | `crush.json`, `.crush.json` | — |
| Factory Droid | `~/.factory/skills`<br>`~/.factory/droids`<br>`~/.factory/commands` | `.factory/skills`<br>`.factory/droids`<br>`.factory/commands` | `mcp.json` | — |
| OpenHands | `~/.openhands/skills`<br>`~/.openhands/microagents` | `.openhands/skills`<br>`.openhands/microagents` | — | — |
| Warp | `~/.warp/skills` | `.warp/skills` | — | — |
<!-- providers:end -->

Também são lidos:

- **Contas isoladas do Kabul** (várias contas por provedor, Configurações › Contas): a pasta de cada conta é lida com a mesma tabela e marcada com o nome da conta.
- **Plugins**: o registro de instalação do Claude Code (`installed_plugins.json` v1 e v2, `known_marketplaces.json`, `enabledPlugins` das configurações de usuário, projeto e local), os plugins do Codex (`config.toml` + cache) e o formato aberto `plugin.json`. Marketplaces declarados por um repositório (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`) e servidores MCP que ele publica (`server.json`) aparecem como parte do projeto.
- **Registros de instalação** de pacotes e ferramentas que gravam um (a lista dos arquivos que instalaram, com hash): o Kabul usa para a origem exata e para avisar quando um arquivo instalado sumiu ou foi editado.
- **Instruções**: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules`, `.windsurf/rules`, `.clinerules` e os outros da tabela.
- Em cada repositório: repositórios git aninhados (até 3 níveis) e pastas de outros apps que não são extensões de IA (por exemplo um cofre do Obsidian), listadas para não se confundirem com as suas ferramentas.

Os leitores são tolerantes: um formato que o Kabul não conhece (versão nova de uma CLI, um JSON quebrado) vira um aviso na Saúde e o resto da tela continua funcionando.

## Saúde: o que cada achado significa

| Achado | Severidade | Por que importa |
|---|---|---|
| Link quebrado | erro | A IA não encontra o item: o link aponta para algo que não existe mais. |
| Cópias idênticas | aviso | Cópias soltas não se atualizam juntas. Um link para a pasta compartilhada `.agents` mantém uma versão só. |
| Cópias divergentes | aviso | Cada IA usa uma versão diferente da mesma skill. |
| Só na pasta compartilhada | aviso | Nenhuma IA tem link para ela; só as IAs que leem `~/.agents` diretamente a enxergam. |
| Mesmo nome, fontes diferentes | aviso | Uma pode sobrescrever a outra conforme a ordem em que cada IA lê as pastas. |
| Texto de exemplo | aviso | Um valor da configuração ainda é de exemplo (`YOUR_…_HERE`); o servidor MCP vai falhar. |
| Não deu para ler / formato não reconhecido | aviso / informação | O que está no arquivo pode não aparecer aqui nem funcionar na IA. |
| Registrado na instalação, mas não está no disco | aviso | Um registro (lock, registro de plugins, registro do pacote) aponta para algo que sumiu. |
| Instalado duas vezes | informação | A mesma skill vem de um plugin e de uma cópia manual. |
| Versões antigas de plugin | informação | Sobras de atualizações no cache de plugins. |
| Hook roda código | informação | Hooks rodam programas no seu computador a cada evento — confira se você os reconhece. |
| MCP sem versão fixa | informação | `npx -y` / `@latest` baixa a versão mais nova a cada início. |
| Sem descrição / pesado | informação | As IAs escolhem skills pela descrição; arquivos pesados ocupam boa parte do contexto. |
| Repositório dentro de repositório | informação | Repositórios aninhados costumam trazer skills e configurações próprias. |
| Editado depois da instalação | informação | Uma atualização da fonte pode sobrescrever essas mudanças. |

## Privacidade e desempenho

- O conteúdo dos arquivos só é lido **quando você abre um item** (até 64 KB). A lista usa nomes, descrições e hashes.
- Argumentos de MCP e comandos de hooks aparecem com os segredos **redigidos** (tokens, chaves, senhas, `Bearer …`, parâmetros sensíveis de URL); variáveis de ambiente mostram só o nome. Configurações de MCP e de plugins nunca aparecem inteiras.
- No servidor do Kabul (celular e links compartilhados) os comandos das Ferramentas são **só do dono**: convidados de um workspace não acessam.
- O Kabul guarda o último resultado em memória, atualiza em segundo plano (no máximo a cada minuto, quando uma pasta de extensões muda ou quando você clica em **Atualizar**) e guarda o hash de cada arquivo em cache, então a tela abre na hora mesmo com centenas de itens.

## Pelo terminal

```bash
kabul tools ls            # resumo: itens por IA, cada item com as IAs e a fonte, achados
kabul tools ls --json     # o snapshot completo (os mesmos dados da tela)
kabul tools ls --scope global
kabul tools item skill:test-driven-development   # detalhe, com o conteúdo do arquivo
```
