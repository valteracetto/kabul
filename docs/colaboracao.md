# Com um amigo ao mesmo tempo (colaboração em tempo real)

Duas ou mais pessoas trabalham no mesmo workspace ao mesmo tempo. Todas veem o stream do agente, mandam
mensagens, aprovam ferramentas e usam o mesmo terminal. Quem coordena tudo é o `kabuld` da máquina onde
o workspace roda (veja [celular.md](celular.md)).

## Convidar

1. Compartilhe a máquina com a pessoa pelo Tailscale (o kabuld só é acessível pela sua tailnet).
2. Abra o convite:
   - **no desktop:** Configurações › Celular e remoto › Convidar alguém para um workspace;
   - **no celular:** botão **Convidar** no cabeçalho do grupo do workspace.
3. Escolha o papel e gere o link/QR.
   - **Editor:** vê tudo do workspace, manda mensagens, aprova, digita no terminal e abre chats.
   - **Observador:** só acompanha. Não manda mensagem, não aprova e não digita.
   - Convide como **editor** só quem você deixaria usar o seu computador: digitar no terminal e aprovar
     ferramentas do agente roda comandos com o seu usuário. O escopo do workspace limita o que a pessoa vê
     e alcança pelo Kabul, não o que um comando rodado no terminal pode fazer (ver [security.md](security.md)).
4. A pessoa abre o link, digita o nome e entra.
   - O convite vale 30 minutos e uma vez só.
   - Depois disso, o aparelho dela tem uma credencial própria, presa àquele workspace. Ela não vê os outros
     repos, as outras sessões nem a lista de aparelhos.
5. Para tirar o acesso: Aparelhos pareados › **Revogar**. A conexão dela cai na hora.

## O que cada um vê

- **Presença:**
  - os avatares de quem está no workspace, em destaque para quem está na mesma sessão;
  - "Fulano digitando…" enquanto alguém escreve no chat.
- **Autoria:** cada mensagem do chat mostra quem escreveu e de qual aparelho. A autoria vai para o transcript
  canônico (`Author::User { name, device }` em `kabul_core::transcript`) e, por isso, chega também ao
  handoff quando o modelo é trocado.
- **Terminal compartilhado:** cada sessão tmux tem um único stream, e todos veem a mesma tela. Editores digitam
  nela e a digitação aparece para todos.

## Conflitos: fila única do servidor

- **Mensagens:** com o agente ocioso, a mensagem vai direto. Com o agente trabalhando (ou esperando uma
  aprovação), ela entra numa fila **do servidor**, com o nome de quem mandou.
  - Ao fim de cada turno sai a próxima, na ordem de chegada.
  - Todos veem a mesma fila. Editores podem tirar um item.
- **Aprovações:** o pedido aparece para todos os editores e **a primeira decisão vale**. Os outros veem
  "Aprovado por Bia" (ou "Negado por..."). Uma segunda tentativa recebe "já decidido".
- **Troca de modelo ou de conta** (`chat_switch`):
  - encerra o agente atual e abre um segmento novo no transcript;
  - o próximo envio leva o handoff com as últimas mensagens e seus autores, mais o diff da branch.

## Limites atuais

- O convite exige que a pessoa esteja na sua tailnet. A Nuvem Kabul (fase posterior) vai permitir convidar
  sem Tailscale.
- Com o kabuld ligado no app, os chats abertos no desktop também aparecem no celular e para os convidados.
  - Pelo celular dá para mandar mensagem, que entra na mesma fila, e aprovar.
  - O agente segue rodando no processo do app.
  - Ainda falta a tela do desktop mostrar a mensagem que chegou do celular (com autor). Hoje ela mostra só
    a resposta do agente.
  - Chats abertos antes de ligar o kabuld não são espelhados.
- Os avatares mostram a inicial e uma cor, sem foto.
