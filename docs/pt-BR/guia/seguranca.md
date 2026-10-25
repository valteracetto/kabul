[English](../../guide/security.md) · Português

# Segurança

O Kabul roda agentes de código **com o seu usuário**: eles leem e escrevem nos seus repositórios, rodam comandos
e usam as suas contas (GitHub, Linear, provedores de IA). Quem controla o Kabul controla o seu computador. Por
isso a pergunta central é sempre: *quem consegue mandar um comando ao Kabul?* Esta página resume as respostas.
O modelo de ameaças completo, com o teste de cada regra, está na [referência de segurança](../../security.md).

**Achou uma falha?** Reporte em particular: GitHub › Security › **Report a vulnerability** no repositório (veja o
`SECURITY.md`). Nunca numa issue pública.

## Quem pode o quê

| Quem | Confiança | Como entra |
|---|---|---|
| Você no app desktop | Total | A janela do app, que só chama os comandos do próprio app |
| Os seus aparelhos pareados | Dono | QR de uso único → uma chave por aparelho |
| Convidado **editor** | Alta, num workspace | Link de convite → chave presa àquele workspace |
| Convidado **observador** | Só leitura, num workspace | Link de convite → chave presa àquele workspace |
| Sites abertos no navegador | Nenhuma | Barrados pelas checagens de Origin, Host e CORS |
| Outros aparelhos da tailnet sem chave | Nenhuma | Só a checagem de saúde e o pareamento (que pede o token do QR) |
| A internet | Nenhuma | O `kabuld` nunca escuta fora do localhost e da sua tailnet |
| Texto de terceiros (respostas do agente, issues, PRs, repositórios) | Nenhuma | Tratado como dado: nunca vira comando, HTML ou link local |

## O servidor do celular (`kabuld`)

- Escuta só em `127.0.0.1` e nos endereços da sua tailnet, nunca em `0.0.0.0`. O HTTPS vem do `tailscale serve`
  com o certificado da tailnet; dentro da tailnet o tráfego já é cifrado.
- Os códigos de pareamento são aleatórios, de uso único e vencem em 5 minutos (convites: 30 minutos). Cada
  aparelho ganha um id e uma chave de 256 bits; só o SHA-256 da chave é guardado, no cofre do sistema, e
  comparado em tempo constante.
- 10 tentativas erradas de um endereço bloqueiam esse endereço por 10 minutos.
- Revogar um aparelho apaga o hash da chave e derruba as conexões na hora; a chave é conferida a cada comando.
- Convidados só rodam uma lista fechada de comandos, e todo alvo (workspace, conversa, terminal) precisa ser do
  workspace do convite.
- O preview de arquivos fica preso ao worktree (sem link simbólico para fora, nunca `.git/`), convidados nunca
  veem arquivos de segredo (`.env*`, `.npmrc`, chaves), e HTML ou SVG do repositório nunca roda na origem do
  Kabul.
- O preview do app rodando passa por um listener separado (outra origem), só para as portas do workspace em
  `127.0.0.1`.

## O app desktop

- Uma Content Security Policy rígida: só os scripts do próprio app, sem código inline nem `eval`, sem imagens
  remotas além dos avatares do GitHub. O Markdown dos agentes é renderizado sem HTML, então uma resposta não
  roda código nem vaza dados pela URL de uma imagem.
- Links vindos de agentes, do Linear ou de PRs só abrem `http`, `https` e `mailto`; nunca arquivos, apps ou
  outros esquemas.
- Os processos são iniciados com lista de argumentos, não com linha de shell. Nomes de branch, URLs de clone,
  remotes e caminhos do diff são validados antes.
- Os segredos (token do GitHub, chave do Linear) ficam no cofre do sistema e nunca aparecem na linha de comando.
  Os logs dos agentes registram os **nomes** das variáveis de ambiente, nunca os valores, e mascaram opções com
  cara de segredo.

## Do que o Kabul não protege

- **Outros usuários do mesmo computador.** Um processo local é tratado como o dono. Não rode o `kabuld` numa
  máquina compartilhada, ou use `KABULD_TRUST_LOCAL_BROWSER=0` para exigir pareamento até do navegador local.
- **Editor é quase dono.** Digitar no terminal e aprovar ferramentas roda comandos como você. Só convide como
  editor quem você deixaria usar o seu computador.
- **Adicionar um repositório é confiar nele.** Os scripts de setup/run/archive e o `env` do `.kabul/settings.toml`
  versionado rodam ao criar o workspace, e o agente lê as instruções do repositório (prompt injection). Revise o
  `.kabul/settings.toml` de repositórios em que você não confia antes do primeiro workspace.
- **Os agentes recebem o `GH_TOKEN`** no ambiente, porque usam o `gh`.

## Privacidade

- Sem conta do Kabul, sem servidor do Kabul, sem telemetria. Os números de uso ficam em arquivos locais e só têm
  metadados (provedor, modelo, conta, workspace), nunca prompts, código ou caminhos.
- **Ajuda › Diagnóstico** copia um relatório sem dados pessoais.
- As dependências são auditadas (`cargo audit`, `npm audit`) antes de cada versão, e o repositório passa por
  varredura de segredos.
