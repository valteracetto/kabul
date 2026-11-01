[English](../../guide/ssh.md) · Português

# Hosts SSH

**Configurações › Mais › Hosts SSH** lista os hosts do seu config do SSH, testa a conexão, abre `ssh <alias>`
numa aba de terminal do Kabul e edita o arquivo com prévia. Usa o cliente OpenSSH que já vem no macOS, no
Linux e no Windows 10/11.

| Sistema | Config lido | Cliente |
|---|---|---|
| macOS, Linux | `~/.ssh/config` | `ssh` e `ssh-keygen` do `PATH` |
| Windows | `%USERPROFILE%\.ssh\config` | o OpenSSH do sistema (`C:\Windows\System32\OpenSSH`, recurso opcional "Cliente OpenSSH") ou um no `PATH` |

Sem o cliente, a lista aparece igual; o teste, o terminal e a geração de chave explicam o que instalar.

## A lista

- Um grupo por arquivo: **De ~/.ssh/config** primeiro, depois cada arquivo trazido por `Include` (globs e
  caminhos relativos, na mesma ordem em que o `ssh` lê). A caixa no cabeçalho do grupo seleciona todos.
- Cada linha: o alias, `usuário@hostname:porta` e a chave (`IdentityFile`) pelo nome. O que o bloco não define
  (porta 22, usuário) vem do `ssh -G <alias>`, o valor que o `ssh` vai usar de fato depois de `Host *`, `Match`
  e `Include`.
- Linha `Host` com vários nomes lista cada nome concreto. Padrões com `*` ou `?`, negações (`!host`) e blocos
  `Match` são **regras**: **… › Mostrar regras** lista como estão. O Kabul não edita regras nem tenta avaliar
  `Match`.
- Host que vem de um `Include` dentro de um bloco `Host`/`Match` aparece como **condicional**: só vale quando
  aquele bloco casa.
- Clique numa linha para ver o detalhe: arquivo e linha, todas as diretivas do bloco (encaminhamentos,
  `ForwardAgent`, `ProxyCommand`, o resto), tipo e impressão digital da chave e o valor efetivo quando difere.
- A busca filtra por alias, endereço, usuário, chave, `ProxyJump` e comentário.

## Ações

Em cada linha (**…**) e no detalhe:

| Ação | O que acontece |
|---|---|
| **Testar conexão** | Roda `ssh -o BatchMode=yes -o ConnectTimeout=5 <alias> true`. Nunca pede senha nem aceita host key nova; quando falha, mostra o erro real do `ssh` e uma dica: host key desconhecida, host key mudou, permissão negada, tempo esgotado, endereço não encontrado, conexão recusada, sem rota, chave com senha |
| **Abrir terminal** | Aba de terminal do Kabul com `ssh <alias>` no último workspace aberto (a sessão é `kabul-ssh-<alias>`; quando a conexão cai, ela fica num shell para você ler o erro) |
| **Copiar comando** | `ssh <alias>`, com aspas quando precisa |
| **Abrir em** | Terminal, iTerm, Warp, Ghostty, Windows Terminal, PowerShell, Git Bash, ou VS Code / Cursor / Windsurf com Remote-SSH (`--remote ssh-remote+<alias>`), o que estiver instalado. Warp, Ghostty, Cursor, Windsurf e os apps do Windows ainda estão a confirmar |
| **Editar** / **Remover** | Veja abaixo |

Com vários hosts selecionados: **Testar conexão** em todos e **Copiar comandos** (um por linha).

No celular (Ajustes › Hosts SSH, só o dono) a mesma lista aparece só para leitura, com o teste de conexão: o
teste roda no computador.

## Adicionar, editar e remover

**Adicionar host** pede alias, endereço (`HostName`), usuário, porta, chave e `ProxyJump`. A chave vem da lista
de chaves do `~/.ssh` (tipo e impressão digital), de **Escolher arquivo…** ou digitada; só o caminho vai para o
config. **Revisar mudanças** mostra o diff antes de gravar qualquer coisa:

- só o bloco mexido muda; comentários, linhas em branco, recuo, `Chave=valor`, aspas, fim de linha (CRLF no
  Windows) e todos os outros blocos ficam iguais, byte a byte;
- editar troca só o valor das linhas que mudaram; campo vazio remove a linha; campo novo entra no fim do bloco,
  com o recuo do próprio bloco;
- host novo entra logo depois do último host concreto do arquivo (antes dos blocos `Host *` e `Match` do fim),
  para os valores digitados valerem sobre as regras genéricas;
- remover um nome de uma linha `Host a b` mantém o bloco para o outro nome; remover o bloco inteiro leva junto
  os comentários colados nele e mantém os separadores de seção;
- host de arquivo incluído é editado naquele arquivo.

**Salvar** primeiro copia o arquivo para `config.bak-kabul-<data>-<hora>` ao lado dele, grava num arquivo
temporário com permissão 0600 e troca de uma vez (`~/.ssh` é criada com 0700 se faltar). Config que é link
simbólico (dotfiles) é gravado através do link. Se o arquivo mudou depois da prévia, a gravação é recusada e
você revisa de novo.

## Chaves

O Kabul nunca abre chave privada. Ele lista os `~/.ssh/*.pub` (tipo, bits, impressão digital, iguais ao
`ssh-keygen -lf`) e os arquivos `id_*` sem `.pub`, só pelo nome.

**… › Gerar chave ed25519…** roda `ssh-keygen -t ed25519` em `~/.ssh/<nome>` depois da confirmação, sem senha e
nunca por cima de um arquivo existente. Para chave com senha, rode o `ssh-keygen` num terminal: a senha não
passa pelo Kabul.

## Segurança

- Os comandos só aceitam aliases que existem como host concreto no seu config; nada que comece com `-` chega à
  linha de comando do `ssh`.
- O teste e o `ssh -G` têm prazo e nunca perguntam nada. O `ssh -G` pode rodar um `Match exec` do seu próprio
  config, como o `ssh` rodaria.
- `ForwardAgent yes` mostra um aviso no detalhe: quem for root naquele servidor pode usar o seu agente enquanto
  você estiver conectado.
- Pelo kabuld (outra máquina ou o celular), listar e testar são só do dono; convidados não veem.

Usar um host SSH como máquina do Kabul (arquivos, terminais, git, worktrees e agentes rodando lá) é uma etapa à
parte, ainda não disponível.
