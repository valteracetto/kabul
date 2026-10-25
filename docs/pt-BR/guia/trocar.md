[English](../../guide/switching.md) · Português

# Trocar de modelo ou de conta na mesma conversa

Escolha outro modelo na mesma conversa (`⌘/`), mesmo um que rode em outro harness: Claude Code → Codex → um
Qwen local pelo Qwen Code → de volta ao Claude. A conversa, a branch e o worktree continuam os mesmos.

Motivos comuns:

- uma conta bateu no limite de 5 horas ou da semana, e você tem outra conta ou outro provedor com folga;
- você quer uma segunda opinião sobre um plano ou uma revisão de outra família de modelos;
- a próxima parte é mecânica e um modelo mais barato ou local dá conta.

## O que acontece na troca

![Uma conversa que passou do Claude Code para o Codex e para o Antigravity, com um divisor em cada troca](../../assets/switch-llm.png)
![Seletor de modelo com Claude, GPT e Gemini na mesma conversa](../../assets/model-picker.png)

- **Mesmo harness, mesma conta:** a sessão do próprio agente é retomada (`--resume` ou equivalente). Nada se perde.
- **Outro harness:** o Kabul fecha o trecho atual do [transcript](./conceitos.md), mostra um divisor na conversa
  ("Trocou para Gemini · Antigravity") e inicia o agente novo com um **handoff**. É só texto, então funciona em
  qualquer harness:
  - as últimas mensagens, com quem escreveu cada uma (você, um convidado, qual modelo);
  - as ferramentas usadas e os arquivos alterados;
  - a branch e o `git diff --stat` contra a branch alvo;
  - os arquivos de `.context/`.
- **Outra conta do mesmo provedor** funciona igual ("Trocou para a conta X"): cada conta tem configuração
  isolada, então a nova não consegue retomar a sessão antiga e recebe o handoff.

O agente novo roda no **mesmo worktree**, e os checkpoints continuam sendo gravados antes de cada mensagem.

## Contas

Adicione quantas contas por provedor precisar em **Configurações › Contas** (por exemplo, uma assinatura do
Claude pessoal e uma do trabalho). Cada perfil roda o CLI com a sua própria pasta de configuração:

| Agente | Isolado por |
|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` |
| Codex | `CODEX_HOME` |
| Antigravity, Qwen Code, Gemini CLI, Goose | um `HOME` do perfil |
| GitHub CLI | `GH_CONFIG_DIR` |
| OpenCode | a confirmar |

A conta padrão de cada provedor é a configuração normal do CLI. O seletor de conta fica ao lado do seletor de
modelo no composer, e cada conversa mostra qual conta usa.

## Trocar antes de bater no limite

A [aba Uso](./uso.md) acompanha as janelas de cada conta. Quando uma passa do limite que você definiu, ela
sugere outra conta do mesmo provedor (se houver uma com folga) ou outro provedor; **Usar** aplica a troca às
conversas abertas daquele provedor na próxima mensagem, pelo mesmo handoff.

## Fork e reset usam o mesmo transcript

- **Fork para nova aba** (`⌘⌥↵`): uma conversa nova a partir de qualquer turno. Mesmo harness e último turno:
  o fork do próprio agente; nos outros casos, o replay do transcript até ali.
- **Fork para novo workspace:** um worktree novo no checkpoint daquele turno, com a conversa até ele.
- **Reset chat:** corta a conversa numa mensagem e, se quiser, restaura os arquivos do checkpoint gravado antes
  dela.

## Limites atuais

- O handoff leva as últimas mensagens, não o histórico inteiro. Um resumo do histórico mais antigo (pelo
  `/compact` do próprio agente) está no roadmap; até lá, guarde as decisões duradouras em `.context/` ou no
  repositório, onde todo agente lê.
- Voltar para um modelo anterior sempre passa por um handoff; retomar a sessão anterior daquele modelo está no
  roadmap.

Detalhes de engenharia: [Handoff e transcript](../../handoff.md).
