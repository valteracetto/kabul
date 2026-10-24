# Kabul

> Em desenvolvimento. README completo em breve.

Orquestrador de agentes de código para desktop (macOS, Windows em seguida):

- **O harness certo para cada LLM** — Claude Code, Codex, Gemini (Antigravity), OpenCode, Qwen Code e modelos locais (Ollama, LM Studio, llama.cpp, MLX, vLLM), cada um no harness que tira o melhor dele.
- **Troque de LLM na mesma conversa e branch** — o contexto passa para o próximo agente.
- **Trabalhe com um amigo ao mesmo tempo** — e acompanhe tudo pelo celular.

## Rodando do código

```bash
cargo test
cd apps/web && npm install && npm run e2e
cd ../desktop && npm install && npx tauri dev
```

Licença MIT.
