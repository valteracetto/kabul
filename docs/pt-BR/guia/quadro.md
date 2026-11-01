[English](../../guide/board.md) · Português

# Quadro

O **Quadro** (barra lateral › Visão geral › Quadro) mostra os workspaces como cards em colunas. Arraste um card para outra coluna para mudar o status. As colunas são suas para editar, e um workspace vinculado a uma issue do Linear ou do GitHub pode manter o status da issue junto com o do card.

## Configurações

A engrenagem no topo do Quadro abre as configurações. O seletor ao lado dela escolhe o escopo:

- **Todos os repositórios**: o quadro global, usado por todo repositório que não tem o próprio.
- **Um repositório**: ligue **Colunas próprias** para ele ter um quadro separado. Desligado, o repositório herda o quadro global.

Depois:

- **Sincronizar quadro e status da issue** (desligada por padrão): mover um workspace vinculado atualiza a issue quando a coluna tem um estado de workflow correspondente.
- **Trazer mudanças de lá**: quando a issue muda fora do Kabul, o card acompanha. O Kabul confere a cada 90 segundos e só age quando o `updatedAt` da issue mudou (o Linear responde todas as issues numa requisição só). A primeira leitura de uma issue só guarda onde ela está, então ligar a opção nunca embaralha os cards. Webhooks podem substituir o polling no futuro.
- **GitHub Projects**: também atualiza o campo **Status** do projeto da issue (Projects v2, via `gh api graphql`). Precisa do escopo `project`: `gh auth refresh -s project`.

## Colunas

Cada coluna tem ícone e cor (de um conjunto fixo que funciona no tema claro e no escuro) e um nome editável. Reordene pelos botões de subir e descer ou arrastando; **+ Adicionar status** cria uma nova. Apagar uma coluna que ainda tem cards pergunta antes para onde eles vão.

As colunas padrão são **Todo**, **In progress**, **In review** e **Done**. Quadros de versões anteriores são migrados (`state.json` v1 → v2, com backup em `state.json.v1.bak`): os status antigos viram essas colunas e, se algum workspace estava *cancelado*, entra também a coluna **Canceled**, para nada se perder.

## Mapeamento das colunas

Cada coluna corresponde a um estado em cada rastreador:

1. Primeiro **o mesmo nome**, com sinônimos em inglês e português (`Todo` = `To do` = `A fazer`, `In review` = `Em revisão`, `Done` = `Concluído`…).
2. Senão, **o tipo da coluna**, que o ícone diz: a fazer, em andamento, em revisão, concluído, cancelado.
   - **Linear**: casa com o `state.type` do time (`backlog`, `unstarted`, `started`, `completed`, `canceled`). Coluna de revisão num time sem estado de revisão cai em *In Progress*.
   - **GitHub Issues**: concluído → fechada, cancelado → fechada como *not planned*, o resto → aberta. A coluna também pode ter uma **label** opcional: a issue ganha a label ao entrar na coluna e perde ao sair.
   - **GitHub Projects**: a opção do campo **Status** com o mesmo nome ou tipo.

Cada coluna pode fixar o resultado por rastreador: **Automático**, **Nunca sincronizar** ou um estado escolhido (em **Correspondência**, embaixo do nome da coluna). O popover mostra para onde cada coluna vai e **sem correspondência** quando não há o que atualizar; o card anda do mesmo jeito, só a issue fica como está.

## Mover um card

Com a sincronia ligada, soltar um card vinculado mostra o resultado, por exemplo "ENG-12 → In Progress no Linear", com **Desfazer**: o card volta e a issue volta exatamente ao estado, às labels e ao status do projeto de antes. Se o rastreador recusar (sem permissão, erro de rede), o erro fica visível com **Tentar de novo** e **Desfazer**.

### Vincular uma issue

Workspaces criados a partir de uma issue do Linear (paleta ⌘K › "Novo workspace a partir de issue do Linear") já vêm vinculados. Para os outros, use o botão de vincular no card e cole:

- a URL de uma issue do GitHub ou `owner/repo#12`;
- `#12` (issue no repositório do workspace);
- a URL ou o identificador de uma issue do Linear, como `ENG-12`.

Deixe vazio para desvincular.

## Mover sozinho

O Quadro pode mover os cards quando algo acontece no Kabul. O padrão:

| Evento | Coluna |
| --- | --- |
| Um agente começa a trabalhar | In progress |
| Um pull request é aberto | In review |
| O pull request recebe merge | Done |

Escolha outra coluna ou **Não mover** para cada evento, ou desligue todos. Os movimentos automáticos só andam para a frente: um card em revisão não volta para *In progress* quando você manda outra mensagem ao agente. Com a sincronia ligada, a issue acompanha esses movimentos também.

## Segurança e permissões

- A chave do Linear fica no cofre do sistema (Keychain / Credential Manager / Secret Service) e só viaja no cabeçalho HTTPS. O GitHub passa pelo login do `gh`. Nenhum token vai para linha de comando ou log.
- Só o dono altera o quadro, move cards ou vincula issues. Convidados conectados pelo kabuld só leem as colunas.
- No celular, o status dos workspaces mostra os nomes das colunas do quadro.

## Para desenvolvedores

Os rastreadores ficam atrás da camada `IssueTracker` em `crates/kabul-core/src/tracker` (hoje Linear e GitHub). Para acrescentar Jira ou GitLab: uma variante em `TrackerKind`, uma implementação do trait (com o transporte atrás de um trait, para os testes usarem respostas gravadas) e o registro em `Trackers::real`. O mapeamento das colunas (`crates/kabul-core/src/board.rs`) só enxerga nome e tipo dos estados, então funciona igual para qualquer rastreador.
