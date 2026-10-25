/* i18n-ignore-file: dados fictícios da demonstração (em inglês, como o README). */
/**
 * Celular (PWA em /m/?mock&demo): os comandos do kabuld que o mock do desktop não tem (sessões ao vivo,
 * transcrição, presença, arquivos, aparelhos), em cima dos dados de demo/scenario.ts. Tudo inventado.
 *
 * Parâmetros da URL (só para as capturas):
 * - `as=maya`: o aparelho é da Maya Chen (editora convidada no workspace do dark mode), não da Sam;
 * - `collab`: a Maya já aprovou o pedido do agente e está digitando (captura de colaboração);
 * - `quieto`: nenhuma sessão ao vivo (só os workspaces), como um computador parado;
 * - `fora`: agentes e conversas de fora do Kabul (um sem repositório, um sem id de sessão, um numa pasta sem workspace).
 *
 * Só se instala em /m/: o desktop (`/?mock&demo`) segue igual.
 */
import { mockTransport } from "../src/transport/mock";
import { HOME, ME, REPOS } from "./scenario";

type Ctx = { db: any; handlers: Record<string, (a: any) => unknown>; emit: (ch: string, p: unknown) => void };

const MACHINE = "Sam's MacBook Pro";
const TAILNET = "sams-macbook-pro.tail-acme.ts.net";
// scenario.ts importa este arquivo: o nome vem dele, mas é o mesmo (ME.name) e não pode ser lido aqui no topo.
const SAM = { id: "dev-sam-iphone", user: "Sam Rivera", device: "iPhone", role: "owner" as const, scope: { kind: "all" as const }, color: "#f59e0b" };
// A cor da Maya é a padrão do chat para autores sem cor conhecida: avatar da presença e da mensagem batem.
const MAYA = { id: "dev-maya-pixel", user: "Maya Chen", device: "Pixel 8", role: "editor" as const, scope: { kind: "workspace" as const, id: "w-dark" }, color: "#7c8cff" };

const HARNESS: Record<string, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", opencode: "OpenCode" };
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- transcrições

type Author = { kind: "user"; name: string; device: string } | { kind: "agent"; harness: string; model: string } | { kind: "system" };
interface Entry { seq: number; at: number; author: Author; segment: number; kind: { type: string; [k: string]: unknown } }
interface Chat {
  id: string; ws: string; title: string; harness: string; model: string; status: "working" | "waiting" | "idle"; detail: string | null;
  idle: number; runs_on: any; entries: Entry[]; seg: number;
}

/** Monta uma conversa: cada `agent(...)` muda quem responde (troca de modelo vira um segmento novo). */
function script(t0: number) {
  const out: Entry[] = [];
  let seq = 0, seg = 0, at = t0;
  let agent: Author = { kind: "agent", harness: "claude", model: "Opus 5.5" };
  const push = (author: Author, kind: Entry["kind"]) => (out.push({ seq: ++seq, at: (at += 20), author, segment: seg, kind }), out[out.length - 1]);
  let n = 0;
  return {
    out,
    agent: (harness: string, model: string) => void (agent = { kind: "agent", harness, model }),
    user: (who: { user: string; device: string }, text: string) => push({ kind: "user", name: who.user, device: who.device }, { type: "user_message", text }),
    say: (text: string) => push(agent, { type: "assistant_text", text }),
    tool: (name: string, input: unknown, output: string | null = "ok", is_error = false) => push(agent, { type: "tool_call", call_id: `t${++n}`, name, input, output, is_error }),
    approval: (request_id: string, tool: string, input: unknown, decision: string | null = null) => push(agent, { type: "approval", request_id, tool, input, decision }),
    handoff: (harness: string, model: string) => (seg++, (agent = { kind: "agent", harness, model }), push({ kind: "system" }, { type: "handoff", to: `${model} · ${HARNESS[harness]}` })),
  };
}

const SNAP_CMD = { command: "npx playwright test e2e/theme.spec.ts --update-snapshots", description: "Update the screenshot baselines" };
const MIGRATE_CMD = { command: "npm run db:migrate -- --name add_rate_limit_to_api_keys", description: "Run the database migration" };

function darkMode(t0: number, files: Record<string, string>, collab: boolean) {
  const s = script(t0 - 40 * 60);
  s.user(SAM, "Add a dark mode to the dashboard. Use our design tokens, follow the system setting by default and add a toggle in the header.");
  s.tool("Read", { file_path: "src/theme/tokens.ts" }, files["src/theme/tokens.ts"]);
  s.tool("Grep", { pattern: "var\\(--", path: "src" }, "src/styles/global.css\nsrc/components/Card.css\nsrc/components/Chart.css");
  s.tool("Edit", { file_path: "src/theme/tokens.ts" });
  s.tool("Write", { file_path: "src/theme/useColorScheme.ts" });
  s.tool("Edit", { file_path: "src/components/Header.tsx" });
  s.tool("Bash", { command: "npm test -- --run theme", description: "Run the theme tests" }, " ✓ src/theme/useColorScheme.test.ts (4 tests) 38ms\n ✓ src/components/Header.test.tsx (3 tests) 61ms\n\n Test Files  2 passed (2)\n      Tests  7 passed (7)");
  s.say("Dark mode is in:\n\n- `src/theme/tokens.ts`: `light` and `dark` palettes from the same tokens\n- `src/theme/useColorScheme.ts`: follows the **system** setting and remembers the choice\n- `src/components/Header.tsx`: theme toggle next to the user menu\n\nAll **7 tests** pass. Body text contrast is 13.4:1 in dark mode.");
  s.user(MAYA, "Looks great! Can the charts follow the theme too? I also see a white flash on first load.");
  s.tool("Read", { file_path: "src/components/Chart.tsx" }, "export function Chart({ data }: Props) { … }");
  s.tool("Edit", { file_path: "src/components/Chart.tsx" });
  s.tool("Edit", { file_path: "index.html" });
  s.say("Charts now use the dark palette, and an inline script in `index.html` sets the theme before the first paint, so the white flash is gone.\n\nThe screenshot tests only have light baselines, so I'd like to update them.");
  if (!collab) {
    s.tool("Bash", SNAP_CMD, null);
    s.approval("req-dark", "Bash", SNAP_CMD);
  } else {
    s.tool("Bash", SNAP_CMD, "  12 passed (9.8s)\n  6 snapshots updated");
    s.approval("req-dark", "Bash", SNAP_CMD, "aprovado por Maya Chen");
    s.say("Updated **6 baselines** for the dark theme and all 12 screenshot tests pass. Ready for a PR.");
  }
  return s.out;
}

function flaky(t0: number) {
  const s = script(t0 - 3 * 3600);
  s.agent("antigravity", "Gemini 4 Argon");
  s.user(SAM, "The cart totals e2e test fails about 1 in 10 runs on CI. Find the root cause.");
  s.tool("Bash", { command: "npx playwright test e2e/cart.spec.ts --repeat-each 20", description: "Reproduce the flake" }, "  18 passed\n  2 failed\n    e2e/cart.spec.ts:12 › cart totals — Expected \"$42.00\", received \"$38.00\"");
  s.tool("Read", { file_path: "src/cart/useTotals.ts" });
  s.say("Reproduced: **2 of 20** runs fail. The total is read before the shipping estimate resolves, so the test sees the subtotal. The race is in `useTotals`, which renders a total while `shipping` is still `undefined`.");
  s.handoff("codex", "GPT-6-Luna");
  s.user(SAM, "Codex, write the fix and keep the change small.");
  s.tool("Edit", { file_path: "src/cart/useTotals.ts" });
  s.tool("Bash", { command: "npx playwright test e2e/cart.spec.ts --repeat-each 50", description: "Run the test 50 times" }, "  50 passed (41.8s)");
  s.say("Fixed in `useTotals`: no total until shipping is known, and the cart shows a skeleton meanwhile. **50/50** runs pass.");
  s.handoff("antigravity", "Gemini 4 Argon");
  s.user(SAM, "Gemini, review the diff before I open the PR.");
  s.tool("Bash", { command: "git diff main --stat", description: "Summarize the branch" }, " src/cart/useTotals.ts  | 6 ++++--\n src/cart/CartTotal.tsx | 4 +++-\n e2e/cart.spec.ts       | 2 +-\n 3 files changed, 8 insertions(+), 4 deletions(-)");
  s.say("Looks good. One suggestion: `CartTotal` should keep the old total visible while reloading to avoid layout shift. Otherwise ready for review. ✅");
  return s.out;
}

function rate(t0: number) {
  const s = script(t0 - 25 * 60);
  s.agent("codex", "GPT-6-Luna");
  s.user(SAM, "Add per-key rate limiting to the /v2 endpoints: 120 requests per minute, backed by Redis, with the standard RateLimit headers.");
  s.tool("Read", { file_path: "src/server.ts" });
  s.tool("Write", { file_path: "src/middleware/rateLimit.ts" });
  s.say("The middleware is ready. Before wiring it in I need to run the migration that adds `api_keys.rate_limit`.");
  s.tool("Bash", MIGRATE_CMD, null);
  s.approval("req-rate", "Bash", MIGRATE_CMD);
  return s.out;
}

function short(t0: number, harness: string, model: string, prompt: string, reply: string, tools: [string, unknown, string | null][]) {
  const s = script(t0);
  s.agent(harness, model);
  s.user(SAM, prompt);
  s.say(reply);
  for (const [n, i, o] of tools) s.tool(n, i, o);
  return s.out;
}

// ---------------------------------------------------------------- arquivos do preview

const EXTRA_FILES = ["src/components/ThemeToggle.tsx", "src/components/UserMenu.tsx", "src/components/Logo.tsx", "src/components/Card.css", "src/components/Chart.css", "src/pages/Dashboard.tsx", "src/pages/Reports.tsx", "src/main.tsx", "e2e/theme.spec.ts", ".gitignore", "tsconfig.json", "vite.config.ts"];
const MIME: Record<string, string> = { md: "text/markdown; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8" };

// ---------------------------------------------------------------- instalação

export function installMobile(ctx: Ctx) {
  if (typeof location === "undefined") return;
  // Fora do PWA (desktop): só os comandos do controle remoto (Configurações › Celular: aparelhos e convites).
  const pwa = location.pathname.startsWith("/m");
  const { db, emit } = ctx;
  const extra: Record<string, (a: any) => unknown> = {};
  const handlers = pwa ? ctx.handlers : extra;
  const q = new URLSearchParams(location.search);
  const collab = q.has("collab");
  SAM.user = ME.name;
  const me = q.get("as") === "maya" ? MAYA : SAM;
  const t0 = now();

  // O PWA pergunta ao transporte quem é o aparelho (no kabuld de verdade vem do `hello` do WebSocket).
  if (pwa) Object.assign(mockTransport as any, { principal: () => me, machine: () => MACHINE, state: () => "open", lastError: () => null, onState: () => () => {} });

  // Mudanças da conversa do dark mode que a lista de alterações e os chips mostram.
  if (pwa) db.files["src/components/Chart.tsx"] = "import { PALETTE } from \"../theme/palette\";\n\nexport function Chart({ data }: Props) {\n  const colors = PALETTE;\n  return <LineChart data={data} colors={colors} />;\n}\n";
  if (pwa) db.files["index.html"] = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <title>Acme</title>\n  </head>\n</html>\n";
  if (pwa) Object.assign((db.changed["w-dark"] ??= {}), {
    "src/components/Chart.tsx": "import { PALETTE, PALETTE_DARK } from \"../theme/palette\";\nimport { useColorScheme } from \"../theme/useColorScheme\";\n\nexport function Chart({ data }: Props) {\n  const [scheme] = useColorScheme();\n  const colors = scheme === \"dark\" ? PALETTE_DARK : PALETTE;\n  return <LineChart data={data} colors={colors} />;\n}\n",
    "index.html": "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <script>\n      const s = localStorage.getItem(\"acme.color-scheme\");\n      const dark = s === \"dark\" || (s !== \"light\" && matchMedia(\"(prefers-color-scheme: dark)\").matches);\n      document.documentElement.dataset.theme = dark ? \"dark\" : \"light\";\n    </script>\n    <title>Acme</title>\n  </head>\n</html>\n",
  });

  // ---------------------------------------------------------------- conversas ao vivo
  const chats = new Map<string, Chat>();
  const add = (c: Omit<Chat, "seg" | "runs_on"> & { runs_on?: any }) => chats.set(c.id, { runs_on: { kind: "local", mirrored: false }, seg: 0, ...c });
  add({ id: "c-dark", ws: "w-dark", title: "Add a dark mode to the dashboard", harness: "claude", model: "Opus 5.5", status: collab ? "idle" : "waiting", detail: collab ? null : "Approve: npx playwright test --update-snapshots", idle: 40, entries: darkMode(t0, db.files, collab) });
  add({ id: "c-rate", ws: "w-rate", title: "Rate limiting for /v2", harness: "codex", model: "GPT-6-Luna", status: "waiting", detail: "Approve: npm run db:migrate", idle: 260, entries: rate(t0) });
  add({ id: "c-router", ws: "w-router", title: "Migrate to React Router 7", harness: "codex", model: "GPT-6-Luna", status: "working", detail: null, idle: 3, entries: short(t0 - 3600, "codex", "GPT-6-Luna", "Migrate the app from React Router 6 to 7 with data loaders. Keep the URLs exactly the same.", "23 files use the old API. I'll move the route table to `createBrowserRouter` first, then convert pages to loaders one by one.", [["Edit", { file_path: "src/pages/Dashboard.tsx" }, "ok"], ["Bash", { command: "npm run typecheck", description: "Typecheck" }, "Found 0 errors."], ["Read", { file_path: "src/pages/Reports.tsx" }, null]]) });
  add({ id: "c-otel", ws: "w-otel", title: "OpenTelemetry tracing", harness: "antigravity", model: "Gemini 4 Argon", status: "working", detail: null, idle: 8, entries: short(t0 - 5400, "antigravity", "Gemini 4 Argon", "Instrument the API with OpenTelemetry: HTTP, Postgres and Redis spans, exported over OTLP.", "Starting with the SDK bootstrap in `src/telemetry.ts`.", [["Read", { file_path: "src/db/pool.ts" }, "export const pool = new Pool(config);"], ["Edit", { file_path: "src/telemetry.ts" }, null]]) });
  add({ id: "c-sync", ws: "w-sync", title: "Offline sync queue", harness: "claude", model: "Opus 5.5", status: "working", detail: null, idle: 1, entries: short(t0 - 1800, "claude", "Opus 5.5", "Build an offline queue for writes: persist to SQLite, replay in order when back online, and resolve conflicts last-write-wins.", "I'll split this into storage, replay and conflict handling, and run them as parallel subagents.", [["Read", { file_path: "src/sync/queue.ts" }, "export class SyncQueue { … }"], ["Bash", { command: "npm test -- sync", description: "Run the sync tests" }, "✓ 12 passed"], ["Edit", { file_path: "src/sync/replay.ts" }, null]]) });
  add({ id: "c-push", ws: "w-push", title: "Push notification settings", harness: "claude", model: "Sonnet 5", status: "working", detail: null, idle: 12, runs_on: { kind: "provider_cloud", provider: "claude" }, entries: short(t0 - 900, "claude", "Sonnet 5", "Draft the push notification settings screen: per-channel toggles and quiet hours.", "Sketching the settings screen against the existing `Settings` stack.", [["Read", { file_path: "src/screens/Settings.tsx" }, null]]) });
  add({ id: "c-flaky", ws: "w-flaky", title: "Flaky cart totals test", harness: "antigravity", model: "Gemini 4 Argon", status: "idle", detail: null, idle: 47 * 60, entries: flaky(t0) });
  add({ id: "c-safari", ws: "w-safari", title: "Fix checkout on Safari 18", harness: "claude", model: "Opus 5.5", status: "idle", detail: null, idle: 20 * 3600, entries: short(t0 - 86400, "claude", "Opus 5.5", "Checkout's Pay button does nothing on Safari 18. Find out why and fix it.", "Safari 18 throws when `requestSubmit` gets a button outside the form. I moved the Pay button inside the `<form>` and added a regression test.", []) });

  const wsOf = (id: string) => db.workspaces.find((w: any) => w.id === id);
  const repoOf = (wsId: string) => REPOS.find((r) => r.id === wsOf(wsId)?.repo_id)?.name ?? "";
  const pendingOf = (c: Chat) => c.entries.filter((e) => e.kind.type === "approval" && !e.kind.decision).map((e) => ({ request_id: e.kind.request_id, tool: e.kind.tool, input: e.kind.input }));
  const view = (c: Chat) => ({ id: c.id, workspace_id: c.ws, branch: wsOf(c.ws)?.branch ?? "", title: c.title, harness: c.harness, model: c.model, approvals: true, account: null, status: c.status, detail: c.detail, queue: [], pending: pendingOf(c) });
  const live = (c: Chat) => {
    const w = wsOf(c.ws);
    return { id: `chat:${c.id}`, kind: "chat", name: c.title, agent: c.harness, status: c.status, detail: c.detail, runs_on: c.runs_on, group: { key: c.ws, repo: repoOf(c.ws), workspace: w?.title ?? w?.name ?? null, workspace_id: c.ws }, path: w?.path ?? "", pane: null, cols: 0, rows: 0, idle_secs: c.idle, preview: `${c.model} · ${HARNESS[c.harness] ?? c.harness}` };
  };
  const darkWs = wsOf("w-dark");
  const TERM = { id: "tmux:lisbon-dev", kind: "tmux", name: "lisbon-dev", agent: "shell", status: "idle", detail: null, runs_on: { kind: "local", mirrored: false }, group: { key: "w-dark", repo: repoOf("w-dark"), workspace: darkWs?.title ?? null, workspace_id: "w-dark" }, path: darkWs?.path ?? `${HOME}/code/acme-web`, pane: "%1", cols: 100, rows: 30, idle_secs: 9 * 60, preview: "VITE v7.2.1  ready in 412 ms  ➜  Local: http://localhost:4110/" };
  const SNAPSHOT = "\x1b[1;32m  VITE v7.2.1\x1b[0m  ready in \x1b[1m412\x1b[0m ms\r\n\r\n  \x1b[32m➜\x1b[0m  \x1b[1mLocal\x1b[0m:   \x1b[36mhttp://localhost:4110/\x1b[0m\r\n  \x1b[32m➜\x1b[0m  \x1b[1mNetwork\x1b[0m: use \x1b[1m--host\x1b[0m to expose\r\n\r\n\x1b[2m10:41:07 AM\x1b[0m \x1b[36m[vite]\x1b[0m hmr update /src/components/Chart.tsx\r\n";

  const state = (c: Chat) => (emit("chat-state", view(c)), emit("session-status", { id: `chat:${c.id}`, title: c.title, status: c.status, detail: c.detail, workspace_id: c.ws }));
  const ev = (c: Chat, event: unknown, ms = 0) => setTimeout(() => emit("chat-event", { chat_id: c.id, event }), ms);
  const get = (id: string) => {
    const c = chats.get(id);
    if (!c) throw new Error("chat not found");
    return c;
  };
  const author = { id: me.id, name: me.user, device: me.device, color: me.color };

  // ---------------------------------------------------------------- presença
  const present = new Map<string, { workspace: string | null; target: string | null; typing: boolean }>();
  present.set(MAYA.id, { workspace: "w-dark", target: "chat:c-dark", typing: collab });
  present.set(SAM.id, { workspace: "w-dark", target: "chat:c-dark", typing: false });
  const who = [SAM, MAYA];
  const presence = (wsId: string) =>
    who.flatMap((p, i) => {
      const st = present.get(p.id);
      return st && st.workspace === wsId ? [{ conn: i + 1, id: p.id, name: p.user, device: p.device, color: p.color, role: p.role, workspace: st.workspace, target: st.target, typing: st.typing }] : [];
    });

  Object.assign(handlers, {
    whoami: () => ({ principal: me, machine: MACHINE }),
    live_sessions: () => ({ machine: MACHINE, os: "macos", sessions: [...[...chats.values()].filter((c) => me.scope.kind === "all" || c.ws === (me.scope as any).id).map(live), ...(me.scope.kind === "all" ? [TERM] : [])] }),
    chat_list: ({ workspaceId }: any = {}) => [...chats.values()].filter((c) => !workspaceId || c.ws === workspaceId).map(view),
    chat_transcript: ({ chatId }: any) => {
      const c = get(chatId);
      return { chat: view(c), transcript: { entries: c.entries } };
    },
    chat_start: ({ workspaceId, model }: any) => {
      const id = `c-new-${chats.size}`;
      const w = wsOf(workspaceId);
      add({ id, ws: workspaceId, title: w?.title ?? "New chat", harness: model.harness, model: model.label, status: "idle", detail: null, idle: 0, entries: [] });
      emit("sessions-changed", null);
      return view(chats.get(id)!);
    },
    chat_switch: ({ chatId, model }: any) => {
      const c = get(chatId);
      Object.assign(c, { harness: model.harness, model: model.label, seg: c.seg + 1 });
      const to = `${model.label} · ${HARNESS[model.harness] ?? model.harness}`;
      c.entries.push({ seq: c.entries.length + 1, at: now(), author: { kind: "system" }, segment: c.seg, kind: { type: "handoff", to } });
      ev(c, { type: "handoff", to });
      state(c);
      return view(c);
    },
    chat_close: ({ chatId }: any) => void (chats.delete(chatId), emit("sessions-changed", null)),
    chat_send: ({ chatId, text }: any) => {
      const c = get(chatId);
      const agent: Author = { kind: "agent", harness: c.harness, model: c.model };
      c.entries.push({ seq: c.entries.length + 1, at: now(), author: { kind: "user", name: me.user, device: me.device }, segment: c.seg, kind: { type: "user_message", text } });
      ev(c, { type: "user_message", text, author });
      Object.assign(c, { status: "working", detail: null, idle: 0 });
      state(c);
      setTimeout(() => {
        const reply = "On it. I'll keep the change small and run the tests before I report back.";
        c.entries.push({ seq: c.entries.length + 1, at: now(), author: agent, segment: c.seg, kind: { type: "assistant_text", text: reply } });
        ev(c, { type: "text", text: reply });
        c.status = "idle";
        state(c);
      }, 1400);
      return { queued: false, id: `q${c.entries.length}` };
    },
    chat_approve: ({ chatId, requestId, allow }: any) => {
      const c = get(chatId);
      const ap = c.entries.find((e) => e.kind.type === "approval" && e.kind.request_id === requestId);
      if (!ap) return;
      ap.kind.decision = `${allow ? "aprovado" : "negado"} por ${me.user}`;
      ev(c, { type: "approval_decided", request_id: requestId, allow, by: { name: me.user } });
      const call = [...c.entries].reverse().find((e) => e.kind.type === "tool_call" && e.kind.output == null);
      const out = requestId === "req-rate" ? "Applied 1 migration: 20261025_add_rate_limit_to_api_keys" : "  12 passed (9.8s)\n  6 snapshots updated";
      if (call) (Object.assign(call.kind, { output: allow ? out : "Denied by the user", is_error: !allow }), ev(c, { type: "tool_result", id: call.kind.call_id, output: call.kind.output, is_error: !allow }, 60));
      Object.assign(c, { status: "working", detail: null, idle: 0 });
      state(c);
      setTimeout(() => {
        const text = !allow ? "OK, I won't run it." : requestId === "req-rate" ? "Migration applied. Wiring the limiter into `/v2` and adding the `RateLimit-*` headers next." : "Updated **6 baselines** for the dark theme and all 12 screenshot tests pass. Ready for a PR.";
        c.entries.push({ seq: c.entries.length + 1, at: now(), author: { kind: "agent", harness: c.harness, model: c.model }, segment: c.seg, kind: { type: "assistant_text", text } });
        ev(c, { type: "text", text });
        c.status = "idle";
        state(c);
      }, 900);
    },
    chat_stop: ({ chatId }: any) => {
      const c = get(chatId);
      Object.assign(c, { status: "idle", detail: null });
      state(c);
    },
    chat_queue_remove: () => undefined,
    presence_list: ({ workspaceId }: any) => presence(workspaceId),
    presence_set: ({ workspaceId, target, typing }: any) => {
      const prev = present.get(me.id)?.workspace ?? null;
      if (workspaceId) present.set(me.id, { workspace: workspaceId, target: target ?? null, typing: !!typing });
      else present.delete(me.id);
      for (const w of new Set([prev, workspaceId].filter(Boolean))) emit("presence", { workspace_id: w, users: presence(w as string) });
    },

    // Terminal (a sessão do servidor de desenvolvimento do workspace do dark mode).
    term_attach: ({ session }: any) => ({ session, pane: "%1", snapshot: SNAPSHOT, cols: 100, rows: 30 }),
    term_input: () => undefined,
    term_keys: () => undefined,
    term_resize: () => undefined,

    // Arquivos do workspace (preview) e o app rodando.
    file_list: ({ workspaceId }: any) => [...new Set([...Object.keys(db.files).filter((p) => db.files[p]), ...Object.keys(db.changed[workspaceId] ?? {}), ...EXTRA_FILES])].sort(),
    file_url: ({ workspaceId, path }: any) => {
      const body: string = db.changed[workspaceId]?.[path] ?? db.files[path] ?? "";
      const ext = path.split(".").pop() ?? "";
      const mime = MIME[ext] ?? "text/plain; charset=utf-8";
      const blob = new Blob([body], { type: mime });
      return { url: URL.createObjectURL(blob), size: blob.size, mime, expires_at: now() + 300, max_chunk: 16 << 20 };
    },
    proxy_ports: ({ workspaceId }: any) => {
      const base = wsOf(workspaceId)?.port ?? 4100;
      return { base, ports: [{ port: base, listening: true }, { port: base + 1, listening: false }] };
    },
    proxy_open: ({ workspaceId, port }: any) => ({ url: `https://${TAILNET}/p/${workspaceId}/${port}/`, path: "/", port, upstream: port, expires_at: now() + 3600 }),

    // Controle remoto: Tailscale, aparelhos pareados e convites.
    remote_status: () => ({ running: true, port: 7777, net: { kind: "tailscale", up: true, ips: ["100.84.12.7"], dns_name: TAILNET, https_url: `https://${TAILNET}`, message: null }, base_url: `https://${TAILNET}`, machine: MACHINE, devices: 3, secrets: "keychain", push: 2, https: true }),
    devices_list: () => [
      { id: SAM.id, user: SAM.user, name: "iPhone", role: "owner", scope: { kind: "all" }, color: SAM.color, created_at: t0 - 40 * 86400, last_seen: t0 },
      { id: "dev-sam-ipad", user: SAM.user, name: "iPad", role: "owner", scope: { kind: "all" }, color: SAM.color, created_at: t0 - 12 * 86400, last_seen: t0 - 2 * 86400 },
      { id: MAYA.id, user: MAYA.user, name: MAYA.device, role: "editor", scope: { kind: "workspace", id: "w-dark" }, color: MAYA.color, created_at: t0 - 2 * 86400, last_seen: t0 - 60 },
    ],
    device_revoke: () => undefined,
    pair_create: () => ticket(`https://${TAILNET}/m/#pair=demo-pair-token`),
    invite_create: ({ workspaceId, role }: any) => ({ ...ticket(`https://${TAILNET}/m/#pair=demo-invite-token&w=${workspaceId}`), role }),
    machines_discover: () => [],
    push_key: () => "BDemoOnlyPublicKeyNotARealVapidKey0000000000000000000000000000000000000000000000000000",
    push_subscribe: () => undefined,
    push_test: () => 2,
  });
  if (pwa && q.has("quieto")) handlers.live_sessions = () => ({ machine: MACHINE, os: "macos", sessions: [] });
  if (pwa && q.has("fora")) {
    const rate = wsOf("w-rate");
    handlers.external_sessions = () => ({
      running: [
        { agent: "claude", pid: 5102, cwd: darkWs?.path ?? null, repo: "acme-web", branch: darkWs?.branch ?? "main", running_secs: 2 * 3600, terminal: null, session_id: "5102-claude-sess" },
        { agent: "gemini", pid: 5101, cwd: `${HOME}/Downloads/notes`, repo: null, branch: null, running_secs: 9 * 3600, terminal: null, session_id: null },
      ],
      recent: [
        { agent: "claude", id: "7001-claude-hist", title: "Tidy up the release notes", cwd: darkWs?.path ?? null, repo: "acme-web", branch: "main", updated: t0 - 38 },
        { agent: "agy", id: "7002-agy-hist", title: "Audit the API error codes", cwd: rate?.path ?? null, repo: "acme-api", branch: rate?.branch ?? null, updated: t0 - 31 * 60 },
        { agent: "opencode", id: "7003-opencode-hist", title: "Benchmark the feed renderer", cwd: `${HOME}/scratch/bench`, repo: null, branch: null, updated: t0 - 19 * 3600 },
      ],
      cloud_note: "",
    });
  }
  if (!pwa) for (const k of ["remote_status", "devices_list", "device_revoke", "pair_create", "invite_create", "machines_discover", "presence_list"]) if (extra[k]) ctx.handlers[k] = extra[k];
}

/** QR de mentira (desenho fixo): o convite da demo não abre nada. */
function ticket(url: string) {
  const cells: string[] = [];
  let r = 11;
  for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) {
    const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17);
    r = (r * 16807) % 2147483647;
    const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x % 18 > 1 && x % 18 < 5 && y % 18 > 1 && y % 18 < 5)) && !(x === 6 && y > 17) : r % 3 === 0;
    if (on) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  }
  const qr_svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 29 29"><rect x="-2" y="-2" width="29" height="29" fill="#fff"/><g fill="#000">${cells.join("")}</g></svg>`;
  return { token: "demo", url, qr_svg, expires_at: now() + 600, ttl: 600 };
}
