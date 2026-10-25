[English](../../guide/quick-start.md) · Português

# Início rápido

Do zero a um pull request escrito por um agente, em cinco passos. Você precisa do Kabul e de pelo menos um
CLI de agente instalado e com login feito (veja [Instalação](./instalacao.md)).

## 1. Adicione um projeto

Tecle `⌘N` e abra o seletor de projeto:

- **Abrir projeto**: uma pasta local que seja um repositório git;
- **Abrir projeto do GitHub**: escolha um repositório da sua conta ou cole uma URL; o Kabul clona com o login
  do GitHub CLI;
- **Início rápido**: uma pasta nova com `git init`, um README e o primeiro commit.

Pelo terminal, adicione vários de uma vez com o CLI `kabul` (ele grava o mesmo estado do app; um app aberto
mostra os projetos novos na barra lateral em até um segundo, sem reiniciar):

```sh
kabul repo add ~/code/api ~/code/web ../site   # pula pastas que não são repositório git ou já estão no Kabul
kabul repo ls                                  # nome, branch padrão, caminho (--json para scripts)
```

Uma subpasta adiciona o repositório inteiro. `KABUL_HOME` (ou `--home`) aponta outra pasta de estado, como nos testes.

O Kabul nunca mexe no checkout principal. Cada tarefa ganha o seu próprio worktree ao lado dele.

## 2. Descreva a tarefa

Escreva no que quer trabalhar e tecle `↵`. O Kabul:

1. cria um git worktree numa branch nova (`<seu usuário do GitHub>/<cidade>`);
2. copia os seus arquivos `.env*` (e o que estiver no `.worktreeinclude`);
3. roda o script de setup do repositório, se houver;
4. manda a sua mensagem para o agente.

`⌥↵` põe a tarefa no backlog em vez de começar.

## 3. Escolha o modelo

`⌘/` abre o seletor de modelo: Claude, GPT, Gemini, Qwen e os seus modelos locais lado a lado, com nível de
esforço e conta. O Kabul roda cada modelo no harness que combina com ele (veja
[Agentes e harnesses](./agentes.md)). Dá para trocar a qualquer momento, até para outro provedor, sem perder a
conversa (veja [Trocar de modelo ou conta](./trocar.md)).

## 4. Conduza e revise

- Aprove uma ferramenta com `↵`, libere sempre com `⌘↵`, negue com `⌫`. `⇧⇥` liga e desliga o plan mode.
- Cite arquivos com `@`, rode comandos com `/`, anexe arquivos com `⌘U`, dite com `⌃⇧D`.
- O painel da direita (`⌘⌥B`) mostra as alterações. Abra um arquivo para ver o diff, comente uma linha e mande
  os comentários para o agente.
- Cada mensagem enviada grava um checkpoint; restaure pela própria mensagem ou pela aba **Checkpoints**.

## 5. Entregue

O botão de git acompanha o estado da branch: **Criar PR** (`⌘⇧P`), **Commit e push** (`⌘⇧Y`), **Pull**
(`⌘⇧L`), **Corrigir erros** (`⌘⇧X`, manda os logs dos checks que falharam para o agente), **Merge** (`⌘⇧M`) e
**Arquivar** (`⌘⇧A`).

![Workspace com o menu de git](/screens/git-menu.png)

## Depois

- Rode vários workspaces ao mesmo tempo: cada um é independente, com portas e terminal próprios.
- Pareie o celular: **Configurações › Celular e remoto** (veja [Nuvem e celular](./nuvem-e-celular.md)).
- Chame um amigo para um workspace (veja [Colaboração](./colaboracao.md)).
- Aprenda o vocabulário: [Conceitos](./conceitos.md).
