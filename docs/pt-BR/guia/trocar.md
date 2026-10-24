[English](../../guide/switching.md) · Português

# Trocar de modelo ou conta na mesma conversa

Escolha outro modelo na mesma conversa (`⌘/`), mesmo que rode em outro harness (Claude Code → Codex → um Qwen local pelo OpenCode). A branch e o worktree continuam os mesmos.

- Mesmo harness: a sessão é retomada (`--resume`).
- Outro harness: o Kabul mostra um divisor ("Trocou para X · harness Y") e manda ao agente novo um handoff com o resumo, as últimas mensagens e quem escreveu, as ferramentas usadas, os arquivos alterados e a pasta `.context/`.
- Outra conta do mesmo provedor funciona igual ("Trocou para a conta X"), porque cada conta tem a configuração isolada.

O mesmo transcript faz o **Fork para nova aba** (`⌘⌥↵`), o **Fork para novo workspace** e o **Reset chat** (que pode restaurar os arquivos do checkpoint gravado antes daquela mensagem).
