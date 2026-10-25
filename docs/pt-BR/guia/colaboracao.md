[English](../../guide/collaboration.md) · Português

# Colaboração: com um amigo, ao mesmo tempo

Duas ou mais pessoas trabalham no mesmo workspace ao mesmo tempo. Todas veem o agente ao vivo, mandam mensagens,
aprovam ferramentas e usam o mesmo terminal. Quem coordena tudo é o `kabuld` da máquina onde o workspace roda
(veja [Nuvem e celular](./nuvem-e-celular.md)).

## Convidar alguém

![Aparelhos pareados de duas pessoas e um convite de editor com QR](../../assets/collab.png)

1. Compartilhe a máquina com a pessoa pelo Tailscale: o `kabuld` só é acessível dentro da sua tailnet.
2. Abra o convite:
   - **no desktop:** Configurações › Celular e remoto › **Convidar alguém para um workspace**;
   - **no celular:** o botão **Convidar** na linha do workspace.
3. Escolha o papel e gere o link ou o QR:
   - **Editor:** vê o workspace inteiro, manda mensagens, aprova, digita no terminal e abre conversas.
   - **Observador:** só acompanha. Não manda mensagem, não aprova e não digita.
4. A pessoa abre o link, digita o nome e entra. O convite vale uma vez e vence em 30 minutos; depois disso o
   aparelho dela tem uma chave própria, presa àquele workspace.
5. Para tirar o acesso: Aparelhos pareados › **Revogar**. A conexão dela cai na hora.

::: warning Um editor roda comandos como você
Digitar no terminal e aprovar ferramentas do agente roda comandos com o seu usuário, no seu computador. O convite
limita o que a pessoa vê e alcança pelo Kabul, não o que um comando pode fazer. Só convide como **editor** quem
você deixaria usar o seu computador; para os demais, **observador**.
:::

## O que cada um vê

![Duas pessoas na mesma conversa no iPhone e no Android, com avatares de presença](../../assets/collab-mobile.png)

- **Presença:** os avatares de quem está no workspace (em destaque para quem está na mesma conversa) e
  "Fulano digitando…" enquanto alguém escreve.
- **Autoria:** cada mensagem mostra quem escreveu e de qual aparelho. A autoria faz parte do
  [transcript](./conceitos.md), então chega também ao próximo agente quando alguém [troca o modelo](./trocar.md).
- **Terminal compartilhado:** cada sessão de terminal tem um único stream e todos veem a mesma tela. Editores
  digitam nela, e a digitação aparece para todos.

Um convidado só vê aquele workspace: não vê os seus outros repositórios, as outras sessões nem a sua lista de
aparelhos.

## Quem vai primeiro: uma fila só, no servidor

- **Mensagens:** com o agente ocioso, a mensagem vai direto. Com o agente trabalhando (ou esperando uma
  aprovação), ela entra numa **fila do servidor**, com o nome de quem mandou. Ao fim de cada turno sai a próxima,
  na ordem de chegada. Todos veem a mesma fila; editores podem tirar itens.
- **Aprovações:** o pedido aparece para todos os editores e **vale a primeira decisão**. Os outros veem
  "Aprovado por Bia" (ou "Negado por…"); uma segunda tentativa recebe "já decidido".
- **Troca de modelo ou de conta:** encerra o agente atual e abre um trecho novo; a próxima mensagem leva o
  handoff com as últimas mensagens e seus autores, mais o diff da branch.

## Limites atuais

- Convidados precisam estar na sua tailnet. A Nuvem Kabul (no roadmap) vai permitir convidar sem Tailscale.
- Com o `kabuld` ligado, as conversas abertas no desktop também aparecem no celular e para os convidados, e as
  mensagens mandadas de lá entram na mesma fila. A conversa no desktop ainda não mostra as mensagens que chegaram
  de outros aparelhos (com o autor); mostra a resposta do agente. Conversas abertas antes de ligar o `kabuld` não
  são espelhadas.
- Os avatares mostram a inicial e uma cor, sem foto.

Detalhes de engenharia: [Colaboração](../../colaboracao.md).
