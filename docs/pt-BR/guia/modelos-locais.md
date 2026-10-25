[English](../../guide/local-models.md) · Português

# Modelos locais

Rode modelos abertos no seu próprio hardware com o mesmo chat, aprovações, plan mode, checkpoints e diff dos
modelos de nuvem, e no harness que extrai o melhor de cada família.

## Achar servidores e modelos

**Modelos locais** (barra lateral) acha os servidores rodando neste computador e lista os modelos deles:

| Servidor | APIs que expõe |
|---|---|
| LM Studio | OpenAI (`/v1/chat/completions`, `/v1/responses`) e Anthropic (`/v1/messages`) |
| Ollama | compatível com OpenAI |
| llama.cpp (`llama-server`) | compatível com OpenAI |
| vLLM | compatível com OpenAI |
| MLX (`mlx_lm.server`, só Apple Silicon) | compatível com OpenAI |

Mostra quais modelos cabem na memória, baixa um modelo depois da sua confirmação e aceita **endpoints próprios**
que falem a API da OpenAI ou da Anthropic (um servidor em outra máquina, um gateway). Os modelos locais aparecem
no seletor (`⌘/`) com o selo **Local**, ao lado dos de nuvem.

## O registro por família

Cada família de modelo vai para o primeiro harness instalado que combine com ela e fale uma API que o servidor
oferece:

| Família | Harness preferido | Alternativa |
|---|---|---|
| Qwen (`qwen3-8b`, `qwen3-coder-30b-a3b-instruct`…) | Qwen Code, apontado para o endpoint | OpenCode (o Kabul oferece instalar o Qwen Code) |
| DeepSeek, Kimi, GLM, MiniMax | Claude Code, quando o servidor fala a API da Anthropic | OpenCode |
| gpt-oss | Codex, com um provider `kabul` (API Responses) | OpenCode |
| Gemma | Gemini CLI, só por um gateway que fale a API do Gemini | OpenCode (LM Studio e Ollama não falam a API do Gemini) |
| O resto (Llama, Mistral…) | OpenCode | Goose |

Edite em **Modelos locais › Registro**. Quando o harness preferido não está instalado, o chat explica qual foi
usado no lugar.

O Kabul passa o endpoint para cada harness do jeito dele e só naquela sessão: o Qwen Code recebe
`OPENAI_BASE_URL`/`OPENAI_MODEL`, o OpenCode uma config de provider injetada, o Goose
`GOOSE_PROVIDER`/`OPENAI_HOST`, o Codex um provider por `-c`, o Claude Code o endpoint nas configurações da
sessão (assim um `ANTHROPIC_BASE_URL` no seu `~/.claude/settings.json` não manda o modelo local para outro
lugar). As suas configs globais não são editadas.

## Dicas

- Os prompts de sistema dos agentes são grandes (o do Qwen Code tem uns 20 mil tokens). Dê ao servidor uma
  janela de contexto que caiba isso e espere o primeiro turno mais lento em hardware modesto. O Kabul aumenta o
  prazo das requisições do Qwen Code para endpoints locais, para prompts longos não serem cortados.
- Modelos locais estão confirmados de ponta a ponta com o `qwen3-8b` no LM Studio (um turno com escrita de
  arquivo aprovada no app). As outras rotas estão confirmadas com os CLIs de verdade contra um servidor de teste
  que fala as mesmas APIs.
- Pela linha de comando: `kabul chat "<prompt>" --local <modelo> [--agente <harness>]` roda um turno pelo
  registro.

## Alternar entre local e nuvem

Um modelo local é só mais um modelo no seletor: dá para começar com um modelo de nuvem, passar a parte chata
para um local e voltar, na mesma conversa e na mesma branch. Veja [Trocar de modelo ou conta](./trocar.md).
