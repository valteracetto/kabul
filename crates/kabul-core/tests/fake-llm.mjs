#!/usr/bin/env node
// Servidor de LLM falso para testar os CLIs de verdade sem modelo: fala OpenAI Chat Completions
// (`/v1/chat/completions`), OpenAI Responses (`/v1/responses`), Anthropic Messages (`/v1/messages`) e
// Gemini (`/v1beta/models/<m>:generateContent|streamGenerateContent`), com e sem streaming. Responde por roteiro, lendo marcadores na última mensagem do usuário:
//
//   [KABUL-ESCREVER <caminho> <conteúdo>]  chama a ferramenta de escrever arquivo do agente
//   [KABUL-SHELL <comando>]                chama a ferramenta de shell do agente
//   [KABUL-LEMBRAR]                        responde com os arquivos escritos antes na conversa
//
// Depois de um resultado de ferramenta responde "feito". Qualquer outra coisa recebe "ok".
// As ferramentas são achadas pelo nome e pelos parâmetros do esquema que o agente manda.
// Uso: node fake-llm.mjs [porta]  (0 = qualquer livre; imprime "PORTA <n>"). Log em FAKE_LLM_LOG.
import http from "node:http";
import fs from "node:fs";

const log = (o) => process.env.FAKE_LLM_LOG && fs.appendFileSync(process.env.FAKE_LLM_LOG, JSON.stringify(o) + "\n");

const text = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? p.content ?? (typeof p === "string" ? p : "")).join("\n") : "");

/** Conversa normalizada: [{role, text, toolCalls:[{name,args}], toolResult}] */
function normalize(body, api) {
  const out = [];
  if (api === "gemini") {
    for (const c of body.contents ?? []) {
      const parts = c.parts ?? [];
      const results = parts.filter((p) => p.functionResponse);
      const calls = parts.filter((p) => p.functionCall);
      const t = parts.filter((p) => p.text).map((p) => p.text).join("\n");
      if (results.length) out.push({ role: "tool", toolResult: results.map((r) => JSON.stringify(r.functionResponse.response)).join("\n") });
      else if (calls.length) out.push({ role: "assistant", toolCalls: calls.map((x) => ({ name: x.functionCall.name, args: JSON.stringify(x.functionCall.args) })) });
      else out.push({ role: c.role === "model" ? "assistant" : "user", text: t });
    }
    return out;
  }
  if (api === "responses") {
    const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input ?? [];
    for (const m of input) {
      if (m.type === "function_call") out.push({ role: "assistant", toolCalls: [{ name: m.namespace ? `${m.namespace}__${m.name}` : m.name, args: m.arguments }] });
      else if (m.type === "function_call_output") out.push({ role: "tool", toolResult: text(m.output) });
      else if (m.role) out.push({ role: m.role, text: text(m.content) });
    }
    return out;
  }
  for (const m of body.messages ?? []) {
    if (api === "anthropic" && Array.isArray(m.content)) {
      const results = m.content.filter((p) => p.type === "tool_result");
      const uses = m.content.filter((p) => p.type === "tool_use");
      if (results.length) out.push({ role: "tool", toolResult: results.map((r) => text(r.content)).join("\n") });
      if (uses.length) out.push({ role: "assistant", toolCalls: uses.map((u) => ({ name: u.name, args: JSON.stringify(u.input) })) });
      const t = m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      if (t && !results.length) out.push({ role: m.role, text: t });
      continue;
    }
    if (m.role === "tool") out.push({ role: "tool", toolResult: text(m.content) });
    else out.push({ role: m.role, text: text(m.content), toolCalls: (m.tool_calls ?? []).map((c) => ({ name: c.function?.name, args: c.function?.arguments })) });
  }
  return out;
}

/** Ferramentas: [{name, props}] em qualquer um dos três formatos. */
function tools(body) {
  const decls = (body.tools ?? []).flatMap((t) => t.functionDeclarations ?? []);
  if (decls.length) return decls.map((f) => ({ name: f.name, props: (f.parametersJsonSchema ?? f.parameters ?? {}).properties ?? {} }));
  // Responses: `namespace` agrupa ferramentas (o Codex põe cada MCP num `mcp__<servidor>`).
  return (body.tools ?? []).flatMap((t) => {
    if (t.type === "namespace") return (t.tools ?? []).map((x) => ({ name: `${t.name}__${x.name}`, ns: t.name, sub: x.name, props: (x.parameters ?? {}).properties ?? {} }));
    const f = t.function ?? t;
    const schema = f.parameters ?? f.input_schema ?? {};
    return [{ name: f.name, props: schema.properties ?? {} }];
  });
}

// Primeiro regex que achar ganha (ex.: `write` antes de `edit` no Goose).
const pick = (ts, res, need) => res.map((re) => ts.find((t) => re.test(t.name) && need.some((k) => k in t.props))).find(Boolean);

function writeCall(ts, path, content) {
  const t = pick(ts, [/^write$|write_file|create_file/i, /write/i, /text_editor|create/i, /edit/i], ["content", "file_text", "file_path", "path", "filePath"]);
  if (!t) return null;
  const a = {};
  const pathKey = ["file_path", "absolute_path", "path", "filePath"].find((k) => k in t.props) ?? "path";
  a[pathKey] = path;
  a[["content", "file_text", "text"].find((k) => k in t.props) ?? "content"] = content;
  // Goose/Claude text_editor: { command: "write"|"create", path, file_text }
  const cmd = t.props.command;
  if (cmd?.enum) a.command = cmd.enum.find((v) => /write|create/.test(v)) ?? cmd.enum[0];
  return { name: t.name, args: a };
}

function shellCall(ts, command) {
  const t = pick(ts, [/^shell$|^bash$|run_shell_command/i, /shell|bash|exec|terminal|command/i], ["command", "cmd"]);
  if (!t) return null;
  return { name: t.name, args: { [("command" in t.props) ? "command" : "cmd"]: command } };
}

/** Decide a resposta: {text} ou {call:{name,args}}. */
function decide(conv, ts) {
  const last = conv[conv.length - 1];
  if (!last) return { text: "ok" };
  // Ferramentas adiadas (Qwen Code): depois do `tool_search`, chama pelo `tool_call` com o nome achado.
  const pendingMcp = [...conv].reverse().find((m) => m.role === "user" && /\[KABUL-MCP /.test(m.text ?? ""))?.text.match(/\[KABUL-MCP (\S+) ([^\]]+)\]/);
  const lastTool = [...conv].reverse().find((m) => m.role === "tool");
  if (lastTool && pendingMcp && !conv.some((m) => (m.toolCalls ?? []).some((c) => c.name === "tool_call" || c.name.includes(pendingMcp[1])))) {
    const direct = ts.find((t) => t.name.includes(pendingMcp[1]));
    if (direct) return { call: { name: direct.name, args: { texto: pendingMcp[2] } } };
    const found = (lastTool.toolResult ?? "").match(new RegExp(`"name"\\s*:\\s*"([^"]*${pendingMcp[1]}[^"]*)"`)) ?? (lastTool.toolResult ?? "").match(new RegExp(`\\b(mcp__[\\w-]*${pendingMcp[1]}[\\w-]*)`));
    if (found) return { call: { name: "tool_call", args: { name: found[1], arguments: { texto: pendingMcp[2] } } } };
  }
  if (last.role === "tool") return { text: "feito" };
  // Pedido = última mensagem do usuário com marcador; se a ferramenta já respondeu depois dele, acabou
  // (o Claude Code manda lembretes como mensagens de usuário depois do resultado da ferramenta).
  // Só a última mensagem do usuário conta (senão um turno sem marcador repetiria o pedido anterior).
  // (lembretes `<system-reminder>` sozinhos não contam como mensagem.)
  const own = (t) => (t ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  const mi = conv.findLastIndex((m) => m.role === "user" && own(m.text));
  if (mi < 0 || !/\[KABUL-/.test(conv[mi].text)) return { text: conv.slice(Math.max(mi, 0)).some((m) => m.role === "tool") ? "feito" : "ok" };
  if (conv.slice(mi + 1).some((m) => m.role === "tool")) return { text: "feito" };
  const lastUser = conv[mi].text;
  let m;
  if ((m = lastUser.match(/\[KABUL-ESCREVER (\S+) ([^\]]+)\]/))) {
    // Sem ferramenta de escrita em JSON (Codex usa apply_patch livre): escreve pelo shell.
    const call = writeCall(ts, m[1], m[2]) ?? shellCall(ts, `printf '%s' '${m[2]}' > '${m[1]}'`);
    return call ? { call } : { text: "sem ferramenta de escrita: " + ts.map((t) => t.name).join(",") };
  }
  if ((m = lastUser.match(/\[KABUL-SHELL ([^\]]+)\]/))) {
    const call = shellCall(ts, m[1]);
    return call ? { call } : { text: "sem ferramenta de shell: " + ts.map((t) => t.name).join(",") };
  }
  // [KABUL-MCP <trecho do nome> <texto>]: chama a ferramenta MCP cujo nome contém o trecho.
  if ((m = lastUser.match(/\[KABUL-MCP (\S+) ([^\]]+)\]/))) {
    const t = ts.find((x) => x.name.includes(m[1]));
    if (!t && ts.some((x) => x.name === "tool_search")) return { call: { name: "tool_search", args: { query: m[1] } } };
    if (!t) return { text: "sem ferramenta MCP " + m[1] + ": " + ts.map((x) => x.name).join(",") };
    const key = Object.keys(t.props).find((k) => t.props[k]?.type === "string") ?? "texto";
    return { call: { name: t.name, ns: t.ns, sub: t.sub, args: { [key]: m[2] } } };
  }
  if (/\[KABUL-LEMBRAR\]/.test(lastUser)) {
    const files = conv.flatMap((x) => x.toolCalls ?? []).map((c) => String(c.args ?? "").match(/[\w.-]+\.txt/)?.[0]).filter(Boolean);
    return { text: files.length ? "arquivos: " + [...new Set(files)].join(", ") : "nenhum arquivo" };
  }
  return { text: "ok" };
}

let seq = 0;
const id = (p) => `${p}_${++seq}`;
const usage = { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 };

function sse(res, events, named) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const e of events) res.write((named ? `event: ${e.type}\n` : "") + `data: ${JSON.stringify(e)}\n\n`);
  if (!named) res.write("data: [DONE]\n\n");
  res.end();
}

function chat(body, d, res) {
  const model = body.model ?? "fake";
  const cid = id("chatcmpl");
  const msg = d.call ? { role: "assistant", content: null, tool_calls: [{ id: id("call"), type: "function", function: { name: d.call.name, arguments: JSON.stringify(d.call.args) } }] } : { role: "assistant", content: d.text };
  const finish = d.call ? "tool_calls" : "stop";
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ id: cid, object: "chat.completion", created: 0, model, choices: [{ index: 0, message: msg, finish_reason: finish }], usage }));
  }
  const chunk = (delta, finish_reason = null) => ({ id: cid, object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta, finish_reason }] });
  const ev = [chunk({ role: "assistant", content: "" })];
  if (d.call) ev.push(chunk({ tool_calls: [{ index: 0, ...msg.tool_calls[0] }] }));
  else ev.push(chunk({ content: d.text }));
  ev.push(chunk({}, finish));
  ev.push({ id: cid, object: "chat.completion.chunk", created: 0, model, choices: [], usage });
  sse(res, ev, false);
}

function anthropic(body, d, res) {
  const mid = id("msg");
  const block = d.call ? { type: "tool_use", id: id("toolu"), name: d.call.name, input: d.call.args } : { type: "text", text: d.text };
  const stop = d.call ? "tool_use" : "end_turn";
  const u = { input_tokens: 42, output_tokens: 7 };
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ id: mid, type: "message", role: "assistant", model: body.model, content: [block], stop_reason: stop, stop_sequence: null, usage: u }));
  }
  const ev = [{ type: "message_start", message: { id: mid, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 42, output_tokens: 0 } } }];
  if (d.call) {
    ev.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
    ev.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
  } else {
    ev.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    ev.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d.text } });
  }
  ev.push({ type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 7 } }, { type: "message_stop" });
  sse(res, ev, true);
}

function responses(body, d, res) {
  const rid = id("resp");
  const item = d.call ? { type: "function_call", id: id("fc"), call_id: id("call"), name: d.call.sub ?? d.call.name, ...(d.call.ns ? { namespace: d.call.ns } : {}), arguments: JSON.stringify(d.call.args), status: "completed" } : { type: "message", id: id("msg"), role: "assistant", status: "completed", content: [{ type: "output_text", text: d.text, annotations: [] }] };
  const u = { input_tokens: 42, output_tokens: 7, total_tokens: 49, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
  const done = { id: rid, object: "response", created_at: 0, model: body.model, status: "completed", output: [item], usage: u };
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(done));
  }
  const ev = [{ type: "response.created", response: { ...done, status: "in_progress", output: [] } }, { type: "response.output_item.added", output_index: 0, item: { ...item, ...(d.call ? { arguments: "" } : { content: [] }) } }];
  if (!d.call) ev.push({ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: item.id, delta: d.text });
  ev.push({ type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response: done });
  sse(res, ev, true);
}

function gemini(body, d, res, stream) {
  const part = d.call ? { functionCall: { name: d.call.name, args: d.call.args } } : { text: d.text };
  const out = { candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7, totalTokenCount: 49 }, modelVersion: "fake-model" };
  if (!stream) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(out));
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify(out)}\r\n\r\n`);
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && /\/models$/.test(url)) {
      if (url.startsWith("/v1beta")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ models: [{ name: "models/fake-model", displayName: "fake-model", supportedGenerationMethods: ["generateContent"] }] }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "fake-model", object: "model", owned_by: "kabul" }] }));
    }
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {}
    if (/:countTokens$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ totalTokens: 42 }));
    }
    if (/:(stream)?[gG]enerateContent$/.test(url)) {
      const conv = normalize(body, "gemini");
      const ts = tools(body);
      const d = decide(conv, ts);
      log({ api: "gemini", url, tools: ts.map((t) => t.name), last: conv[conv.length - 1]?.role, decision: d });
      return gemini(body, d, res, /stream/.test(url));
    }
    const api = /\/messages$/.test(url) ? "anthropic" : /\/responses$/.test(url) ? "responses" : /\/chat\/completions$/.test(url) ? "chat" : null;
    if (!api || req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "not found" } }));
    }
    const ts = tools(body);
    if (process.env.FAKE_LLM_TOOLS) fs.appendFileSync(process.env.FAKE_LLM_TOOLS, JSON.stringify(body) + "\n");
    const conv = normalize(body, api);
    const d = decide(conv, ts);
    log({ api, url, tools: ts.map((t) => t.name), conv: conv.map((m) => m.role + ':' + (m.text ?? m.toolResult ?? '').slice(0, 60)), decision: d });
    ({ chat, anthropic, responses })[api](body, d, res);
  });
});

server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => console.log(`PORTA ${server.address().port}`));
