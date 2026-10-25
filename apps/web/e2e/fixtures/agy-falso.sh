#!/bin/sh
# agy de mentira para o E2E com o backend real: responde `agy models` e fala o stream-json do agy
# (init, um passo de resposta e o resultado) para cada mensagem recebida no stdin.
if [ "$1" = "models" ]; then
  printf 'gemini-9-teste-low\tGemini 9 Teste (Low)\n'
  exit 0
fi
n=0
while IFS= read -r line; do
  n=$((n + 1))
  if [ $n = 1 ]; then echo '{"event":"init","conversation_id":"c-teste","init":{"model":"gemini-9-teste-low"}}'; fi
  echo "{\"event\":\"step_update\",\"step_update\":{\"conversation_id\":\"c-teste\",\"step_index\":$n,\"state\":\"DONE\",\"step_type\":\"agent_response\",\"text_delta\":\"resposta $n do gemini de teste\"}}"
  echo "{\"event\":\"result\",\"result\":{\"conversation_id\":\"c-teste\",\"status\":\"SUCCESS\",\"response\":\"resposta $n do gemini de teste\",\"num_turns\":1}}"
done
