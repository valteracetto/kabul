[English](../../guide/git.md) · Português

# Git e pull requests

O botão do git no painel direito muda com o estado da branch: **Criar PR**, **Commit e push**, **Pull**, **Push**, **Corrigir erros**, **Pronto para revisão**, **Merge**, **Resolver conflitos** ou **Arquivar**. O menu dele lista todas as ações; as indisponíveis dizem por quê.

- **Commit e push**, **Criar PR pelo agente**, **Corrigir erros** e **Resolver conflitos** são prompts enviados ao agente (com os logs dos checks que falharam ou os arquivos em conflito). Pull, push, merge e ready rodam direto.
- **Checks** mostra o status do git, o pull request (título e descrição editáveis, estado de merge e de revisão), cada check com o log embutido, **Re-rodar falhas** e os comentários da revisão com **Adicionar ao chat**.
- **Diff**: unificado ou lado a lado, ocultar espaços, quebrar linhas, realce de sintaxe, **Visto** (`⌃V`), `↑`/`↓` entre arquivos, `⌘⌥J`/`⌘⌥K` entre comentários, escopo (todas as mudanças, commits da branch, não commitadas) e branch alvo.

![Checks com logs e comentários](/screens/checks.png)
![Diff lado a lado](/screens/diff-split.png)

## Configurações › Git

Prefixo da branch (usuário do GitHub, personalizado ou nenhum), renomear branches novas pela primeira mensagem, renomear o workspace com a branch, apagar a branch ao arquivar, arquivar ao fazer merge, método de merge, automerge, checks opcionais como bloqueantes, upstream no push, PRs empilhados, abrir PRs no GitHub, Linear ou Graphite, link do workspace na descrição do PR e um modo de simulação para as ações do GitHub. Por repositório: branch base, remote, branch alvo e identidade do git.
