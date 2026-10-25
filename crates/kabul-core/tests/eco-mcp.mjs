#!/usr/bin/env node
// Servidor MCP de teste (stdio, JSON-RPC por linha) com uma ferramenta inofensiva: `eco` devolve o texto.
// Cada chamada é anotada em ECO_LOG (uma linha JSON), para o teste saber qual agente chamou.
import fs from "node:fs";
import readline from "node:readline";

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const tools = [
  {
    name: "eco",
    description: "Devolve o texto recebido (ferramenta de teste do Kabul).",
    inputSchema: { type: "object", properties: { texto: { type: "string", description: "Texto a devolver" } }, required: ["texto"] },
  },
];

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return; // notificações (initialized, cancelled)
  switch (m.method) {
    case "initialize":
      return send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "eco", version: "1.0.0" } } });
    case "tools/list":
      return send({ jsonrpc: "2.0", id: m.id, result: { tools } });
    case "tools/call": {
      const texto = String(m.params?.arguments?.texto ?? "");
      if (process.env.ECO_LOG) fs.appendFileSync(process.env.ECO_LOG, JSON.stringify({ texto }) + "\n");
      return send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `eco: ${texto}` }] } });
    }
    case "ping":
      return send({ jsonrpc: "2.0", id: m.id, result: {} });
    default:
      return send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `método não suportado: ${m.method}` } });
  }
});
