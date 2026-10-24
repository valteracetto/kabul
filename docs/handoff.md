# Trocar de LLM na mesma conversa (handoff)

Um dos diferenciais do Kabul: a conversa e a branch continuam iguais quando você troca de modelo,
mesmo que o modelo novo rode em outro harness (Claude Code → OpenCode com Qwen local → Codex...).

## Transcript canônico

`crates/kabul-core/src/transcript.rs` define a conversa sem depender do harness:

- **`Transcript`**: `entries` (tudo o que aconteceu, em ordem) e `segments` (cada trecho rodado por um harness e modelo).
- **`Segment`**: harness, modelo, `agent_session` (id do agente, para `--resume`) e a primeira entrada do trecho.
- **`Entry`**: `seq`, horário, **autor**, segmento, checkpoint (antes da mensagem do usuário) e o tipo:
  - mensagem do usuário e texto do agente;
  - raciocínio;
  - chamada de ferramenta (entrada, saída, erro);
  - aprovação (decisão);
  - handoff;
  - fim de turno (tokens, custo);
  - aviso e erro.
- **`Author`**: `User { name, device }`, `Agent { harness, model }` ou `System`.

A autoria é gravada desde o começo. Na colaboração em tempo real pelo kabuld (ver [colaboracao.md](colaboracao.md)), cada pessoa conectada é um `User` com nome e `device` próprios. A fila única do servidor grava cada mensagem com o autor na ordem em que chegou ao agente.

Os eventos normalizados de qualquer harness (`harness::Event`) entram por `Transcript::apply`. O
transcript é a fonte para o histórico, o fork, o "Reset chat", a busca e o handoff.

## Fluxo da troca

1. O usuário escolhe no seletor um modelo de outro harness, na mesma aba.
2. `start_segment(harness, modelo, resumo)` fecha o trecho atual e grava um `Handoff`. A UI mostra o
   divisor "Trocou para X · harness Y".
3. O Kabul monta a primeira mensagem do agente novo com `handoff_prompt`:
   - o resumo da conversa;
   - as últimas N mensagens, com autor;
   - as ferramentas usadas;
   - o `git diff --stat` contra a base;
   - a branch;
   - os arquivos de `.context/`.

   É só texto, então funciona em qualquer harness.
4. O agente novo roda no **mesmo worktree**, e os checkpoints continuam sendo gravados antes de cada mensagem.

O resumo vem, nesta ordem:
- do `/compact` do agente anterior (quando ele tiver);
- de um turno curto pedindo um resumo antes da troca;
- se não houver nenhum dos dois, das últimas mensagens apenas.

Voltar para um modelo de um segmento anterior do mesmo harness usa `--resume` daquele segmento, mais um handoff só com o que aconteceu depois.

## Fork, reset e fila usam o mesmo transcript

- **Fork para nova aba**:
  - se for o último turno e o harness for o mesmo, usa `--resume <id> --fork-session`;
  - nos outros casos, usa `Transcript::upto(seq)` com `handoff_prompt`, que é o replay.
- **Fork para novo workspace**: worktree no commit do checkpoint daquele turno (`workspace_fork`). O transcript do Claude é copiado para o projeto novo; nos outros harnesses, entra o replay.
- **Reset chat**: corta as entradas a partir do `seq`, opcionalmente restaura o checkpoint e o próximo envio sai com replay.
- **Fila**: as mensagens enfileiradas são `UserMessage` ainda não enviadas. Editar e apagar mexem só nelas.

## Estado atual

- **Pronto (core):** tipos, `apply`, segmentos com handoff, `upto` e `handoff_prompt`, com testes.
- **Pronto (app):**
  - trocar de harness no meio da conversa mostra o divisor "Trocou para X · harness Y", e o primeiro envio leva o handoff (últimas mensagens com autor, ferramentas, arquivos alterados, `.context/`);
  - trocar de **conta** do mesmo provedor faz o mesmo ("Trocou para a conta X"), porque a config isolada não deixa usar `--resume`;
  - Fork para nova aba ou workspace e Reset chat usam `--resume --fork-session` quando dá, e replay nos outros casos.

  Tudo coberto por `e2e/p0.spec.ts` e `e2e/contas.spec.ts`.
- **Próximo:**
  - o histórico passa a ser gravado no formato do transcript canônico (hoje grava os itens da UI e o replay é montado no frontend);
  - resumo pelo `/compact` antes da troca;
  - uso e limite por conta quando o CLI informar.

## Contas (vários logins por provedor)

`crates/kabul-core/src/accounts.rs`: `AccountProfile { provedor, apelido, email, plano, dir, padrão }`. Cada perfil
tem config isolada em `<estado>/accounts/<provedor>/<id>`, e o CLI roda com a variável dele:
- **confirmadas:** `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GH_CONFIG_DIR`;
- **a confirmar:** `ANTIGRAVITY_GEMINI_DIR` (agy, achada nas strings do binário), `XDG_DATA_HOME` (OpenCode) e `HOME` (Qwen Code e Gemini CLI).

O "padrão do sistema" é a config normal do CLI. O login de cada perfil usa o mesmo fluxo de PTY,
com o ambiente do perfil.
