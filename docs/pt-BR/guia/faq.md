[English](../../guide/faq.md) · Português

# Perguntas frequentes

## Geral

**O Kabul é gratuito?** Sim, é código aberto sob a licença MIT. Você usa as suas assinaturas ou chaves de API dos
agentes (Claude, ChatGPT, Google, modelos locais…). O Kabul não revende nem intermedeia acesso a modelos.

**O Kabul substitui os CLIs dos agentes?** Não. Ele conduz os CLIs de verdade (Claude Code, Codex, Antigravity,
Gemini CLI, Qwen Code, OpenCode, Goose…), então você mantém o comportamento, as atualizações, os logins, as
configurações e os servidores MCP de cada um.

**Qual agente devo usar?** O feito para o seu modelo: o Kabul escolhe quando você escolhe o modelo. Veja em
[Agentes e harnesses](./agentes.md) o que cada um suporta e o que ainda está sendo confirmado.

**Quais plataformas?** O macOS (Apple Silicon e Intel) é a plataforma principal. O Windows está em
[beta](./windows.md). Linux não tem pacote. O app do celular roda no iOS e no Android.

## Dados e privacidade

**Onde ficam os meus dados?** No seu computador: `~/Library/Application Support/kabul` no macOS ou
`%APPDATA%\kabul` no Windows (configurações, histórico das conversas, uso, logs) e `~/kabul/workspaces`
(worktrees).

**O meu código sai do computador?** Só o que os agentes mandam para os provedores deles e o que o `gh` manda para
o GitHub, exatamente como se você rodasse esses CLIs. O Kabul não tem servidor próprio nem telemetria.

**O Kabul lê os meus tokens?** Não. O login roda o login do próprio CLI; o Kabul só confere se você está
conectado. Os tokens que o próprio Kabul guarda (GitHub, Linear, chaves dos aparelhos) vão para o cofre do
sistema.

**O Kabul manda algo para o GitHub sozinho?** Só quando você aperta push, merge, pronto para revisão, rodar de
novo ou criar PR. **Configurações › Git › Simular ações do GitHub** mostra os comandos sem rodar.

## Celular e colaboração

**Preciso do Tailscale?** Só para o celular, outras máquinas e colaboração. O `kabuld` escuta no localhost e na
sua tailnet, nunca na internet aberta.

**Tem app na App Store ou no Google Play?** Ainda não. O app do celular é uma PWA que você instala pelo navegador
(Adicionar à Tela de Início). As versões para as lojas estão no roadmap.

**Um amigo convidado vê os meus outros repositórios?** Não. O convite fica preso a um workspace. Mas um editor
roda comandos com o seu usuário, então só convide como editor quem você deixaria usar o seu computador.

## Problemas comuns

**O terminal diz que a sessão terminou na hora.** No macOS, confira se o `tmux` está instalado. O Kabul roda
`tmux -u`, então funciona mesmo aberto pelo Dock sem locale UTF-8.

**Um agente não aparece ou não é encontrado.** O Kabul lê o ambiente do shell de login na abertura; reabra o Kabul
depois de instalar um CLI. Também dá para apontar um executável em **Configurações › Avançado**.

**O agente não respondeu nada.** O chat mostra as últimas linhas que o agente imprimiu no stderr, e o
`logs/agents.log` registra cada sessão (comando, argumentos e nomes das variáveis de ambiente, nunca os
valores). **Ajuda › Diagnóstico** confere as ferramentas e copia um relatório sem dados pessoais.

**O macOS diz que o Kabul não pode ser aberto.** É uma versão ainda não notarizada: clique com o botão direito ›
**Abrir** uma vez, ou libere em Ajustes do Sistema › Privacidade e Segurança.

**O celular não instala o app nem recebe notificações.** Ele precisa de HTTPS: ative o **HTTPS** em
**Configurações › Celular e remoto** e ligue o MagicDNS e os certificados HTTPS na sua tailnet.

**Dá para usar meus arquivos de configuração existentes?** Sim. O Kabul lê `.kabul/settings.toml` e também
entende o formato comum usado por outras ferramentas de worktree.
