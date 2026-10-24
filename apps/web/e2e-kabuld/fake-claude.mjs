#!/usr/bin/env node
// Agente falso para o E2E: fala o protocolo stream-json do Claude Code (stdin/stdout NDJSON).
// - "eco: <texto>" para qualquer mensagem;
// - texto com "devagar": demora 1,5 s antes de responder (para testar a fila);
// - texto com "aprovar": pede aprovação de Bash e espera o control_response.
import { createInterface } from "node:readline";

const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const session = "00000000-0000-4000-8000-00000000e2e0";
let started = false;
let req = 0;
const waiting = new Map();
const inbox = [];
let busy = false;

async function turn(text) {
  if (!started) {
    started = true;
    out({ type: "system", subtype: "init", session_id: session, model: "claude-falso", tools: ["Bash"], mcp_servers: [] });
  }
  if (text.includes("devagar")) await sleep(1500);
  let reply = `eco: ${text}`;
  if (text.includes("aprovar")) {
    const id = `req-${++req}`;
    out({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `tool-${req}`, name: "Bash", input: { command: "npm test" } }] }, session_id: session });
    out({ type: "control_request", request_id: id, request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm test" } } });
    const allowed = await new Promise((r) => waiting.set(id, r));
    out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool-${req}`, content: allowed ? "12 testes passaram" : "negado", is_error: !allowed }] }, session_id: session });
    reply = allowed ? "Rodei os testes: 12 passaram." : "Não rodei os testes.";
  }
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] }, session_id: session });
  out({ type: "result", subtype: "success", is_error: false, duration_ms: 10, result: reply, session_id: session, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
}

async function pump() {
  if (busy) return;
  busy = true;
  while (inbox.length) await turn(inbox.shift());
  busy = false;
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.type === "control_response") {
    const r = m.response ?? {};
    waiting.get(r.request_id)?.(r.response?.behavior === "allow");
    waiting.delete(r.request_id);
    return;
  }
  if (m.type === "user") {
    const text = (m.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    inbox.push(text);
    void pump();
  }
});
