/* i18n-ignore-file: backend de mentira; os textos imitam dados e erros do backend (pt-BR). */
import type { Transport } from "./types";

/**
 * Backend falso em memória para testes E2E (Playwright) e para ver a UI no navegador sem o app.
 * Simula repos, worktrees, agente (com pedido de aprovação), terminal e git.
 */
type H = (p: any) => void;
// Como no WKWebView do Tauri: window.confirm não existe de verdade (devolve false). Pega regressões.
if (typeof window !== "undefined") window.confirm = () => false;
if (typeof window !== "undefined") window.prompt = () => null;
if (typeof window !== "undefined") (window as any).__calls = [];
const subs = new Map<string, Set<H>>();
const emit = (ch: string, p: unknown) => setTimeout(() => (subs.get(ch)?.forEach((h) => h(p)), recordUsage(ch, p)), 0);
let seq = 0;
const id = () => `m${++seq}`;
const now = () => Math.floor(Date.now() / 1000);

const db = {
  mcp: null as any[] | null,
  repos: [] as any[],
  workspaces: [] as any[],
  comments: [] as any[],
  checkpoints: {} as Record<string, any[]>,
  files: { "README.md": "# demo\n", "main.rs": 'fn main() {\n    println!("oi");\n}\n' } as Record<string, string>,
  changed: {} as Record<string, Record<string, string>>,
  history: {} as Record<string, any>,
  endpoints: [] as any[],
  registry: "",
  settings: { branch_prefix_type: "github", branch_prefix_custom: "", notifications: true, sound: true, caffeinate: true, show_resources: true, auto_rename_branch: true, env: [], env_file: null, completion_sound: "Glass", always_show_context: false, auto_convert_long_text: true, not_absolutely_right: false, open_prs_in: "github", delete_branch_on_archive: false, archive_on_merge: false, rename_ws_on_branch: true, merge_method: "squash", github_dry_run: false, pr_include_workspace_link: true, automerge: false, optional_checks_blocking: false, push_set_upstream: true, stacked_prs: true, clone_dir: "~/Developer", claude_output_style: "default", codex_personality: "pragmatic", review_model: null, default_plan: false, claude_path: null, codex_path: null, opencode_path: null, scrollback_mb: 10, tray: true, tray_icon: { mode: "auto", pinned: [], style: "bars_percent", show_spend: false }, usage_alert_pct: 80, usage_daily_budget: null, usage_monthly_budget: null, usage_codexbar: true, auto_update: true, update_channel: "stable" } as any,
  repoSettings: { scripts: { setup: "echo instalando", archive: null, run_mode: "concurrent", run: { web: { command: "npm run dev", default: true, icon: "globe", available_in: null } } }, file_include_globs: [], target_branch: null, env: { API_URL: "http://localhost:$KABUL_PORT" }, prompts: { general: null, review: null, create_pr: null, fix_errors: null, resolve_conflicts: null, branch_rename: null }, preview_url: "http://localhost:$KABUL_PORT" } as any,
  chats: {} as Record<string, { pending: string | null; turn: number; last?: string; ws?: string; model?: string; provider?: string; since?: number; working?: boolean }>,
  kept: [] as any[],
  linear: false,
  accounts: [] as any[],
  agyLogins: {} as Record<string, number>,
  mirror: false,
  ghToken: false,
  sections: [] as any[],
  pr: {} as Record<string, any>,
  git: {} as Record<string, any>,
  ghAccounts: [{ host: "github.com", login: "dev", active: true, scopes: ["gist", "read:org", "repo", "workflow"], source: "keyring", ok: true }] as any[],
};
const CITIES = ["kabul", "lisboa", "cusco", "quito"];
const models = [
  { key: "claude:opus", harness: "claude", id: "opus", label: "Opus 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "xhigh", "max"], effort_in_id: false, local: null, context: 200000 },
  { key: "codex:gpt-6-luna", harness: "codex", id: "gpt-6-luna", label: "GPT-6-Luna", provider: "openai", efforts: ["low", "medium", "high"], effort_in_id: false, local: null, context: 272000 },
  { key: "agy:gemini-4-argon", harness: "antigravity", id: "gemini-4-argon", label: "Gemini 4 Argon", provider: "google", efforts: ["low", "medium", "high"], effort_in_id: true, local: null, context: 1000000 },
  { key: "local:lmstudio:qwen3-8b", harness: "opencode", id: "qwen3-8b", label: "Qwen3 8B", provider: "local", efforts: [], effort_in_id: false, context: 40960, local: { source: "lmstudio", source_name: "LM Studio", model: "qwen3-8b", family: "Qwen", note: "qwen → OpenCode (Qwen Code preferido, não instalado)", missing: ["qwen"], size_bytes: 4623782544, quant: "4bit", fits: true } },
];
const ws = (wid: string) => db.workspaces.find((w) => w.id === wid);
const changes = (wid: string) => Object.entries(db.changed[wid] ?? {}).map(([path, body]) => ({ path, added: body.split("\n").length - 1, removed: db.files[path] ? 1 : 0, untracked: !db.files[path] }));

// ---------- escala: limite de agentes simultâneos (fila "aguardando vaga") e agentes de carga ----------
// Contrato em docs/escala.md. `__mock.agentLimit` liga o limite; `carga` faz o agente emitir sem parar.
const running = new Set<string>();
const waitingSlot: { chatId: string; go: () => void }[] = [];
const loads = new Map<string, ReturnType<typeof setInterval>[]>();
const agentLimit = (): number | null => (window as any).__mock?.agentLimit ?? null;
function releaseSlot(chatId: string) {
  for (const t of loads.get(chatId) ?? []) clearInterval(t), clearTimeout(t);
  loads.delete(chatId);
  const qi = waitingSlot.findIndex((w) => w.chatId === chatId);
  if (qi >= 0) waitingSlot.splice(qi, 1);
  if (!running.delete(chatId)) return;
  const lim = agentLimit();
  while (waitingSlot.length && (lim == null || running.size < lim)) {
    const next = waitingSlot.shift()!;
    running.add(next.chatId);
    emit("chat-event", { chat_id: next.chatId, event: { type: "slot_acquired" } });
    next.go();
  }
  waitingSlot.forEach((w, i) => emit("chat-event", { chat_id: w.chatId, event: { type: "queued", position: i + 1, limit: lim } }));
}
/** Passa pelo limite: roda já ou entra na fila e avisa a posição. */
function withSlot(chatId: string, go: () => void) {
  const lim = agentLimit();
  if (running.has(chatId) || lim == null || running.size < lim) return running.add(chatId), go();
  waitingSlot.push({ chatId, go });
  emit("chat-event", { chat_id: chatId, event: { type: "queued", position: waitingSlot.length, limit: lim } });
}
/** Agente de carga: deltas de texto, ferramentas e subagentes (Task) com eventos filhos, até ser parado. */
function loadAgent(chatId: string) {
  const ev = (e: unknown) => emit("chat-event", { chat_id: chatId, event: e });
  let n = 0;
  const words = "Analisando o módulo de autenticação e as rotas que dependem dele antes de editar".split(" ");
  const timers: ReturnType<typeof setInterval>[] = [];
  ev({ type: "session_started", session_id: "sess-" + chatId, model: "mock" });
  timers.push(setInterval(() => ev({ type: "text_delta", text: words[n++ % words.length] + " " }), 50));
  timers.push(setInterval(() => {
    const id = `ld-${chatId}-${n}`;
    ev({ type: "tool_use", id, name: "Bash", input: { command: `rg -n auth src/${n % 7}`, description: "Procura" } });
    setTimeout(() => ev({ type: "tool_result", id, output: `src/${n % 7}/auth.ts:12: export function auth()`, is_error: false }), 300);
  }, 1000));
  timers.push(setInterval(() => {
    const task = `task-${chatId}-${n}`;
    ev({ type: "tool_use", id: task, name: "Task", input: { description: `Revisar parte ${n % 5}`, prompt: "revise", subagent_type: "general-purpose" } });
    setTimeout(() => ev({ type: "tool_use", id: task + "-r", name: "Read", input: { file_path: "src/app.tsx" }, parent_tool_use_id: task }), 300);
    setTimeout(() => ev({ type: "tool_result", id: task + "-r", output: "ok", is_error: false, parent_tool_use_id: task }), 600);
    setTimeout(() => ev({ type: "usage", input: 3000, output: 200, cache_read: 0, cache_write: 0, duration_ms: 900, parent_tool_use_id: task }), 900);
    setTimeout(() => ev({ type: "tool_result", id: task, output: "Revisado.", is_error: false }), 2000);
  }, 3000));
  loads.set(chatId, timers);
}

function agentTurn(chatId: string, text: string, wid: string) {
  const ch = db.chats[chatId];
  ch.turn++;
  ch.last = text;
  if (/\bcarga\b/.test(text)) return withSlot(chatId, () => loadAgent(chatId));
  const ev = (e: unknown, t: number) => setTimeout(() => emit("chat-event", { chat_id: chatId, event: e }), t);
  // Com limite ligado, o turno espera vaga; o fim do turno devolve a vaga.
  if (agentLimit() != null && !running.has(chatId)) return (ch.turn--, withSlot(chatId, () => agentTurn(chatId, text, wid)));
  if (agentLimit() != null) setTimeout(() => releaseSlot(chatId), 400);
  // Comando longo: o resultado e o fim do turno só chegam depois de 3 s (se o usuário parar antes, chegam atrasados).
  if (/sleep 30/.test(text)) {
    ev({ type: "tool_use", id: "sl-" + ch.turn, name: "Bash", input: { command: "sleep 30", description: "Espera 30 s" } }, 50);
    ev({ type: "tool_result", id: "sl-" + ch.turn, output: "saída atrasada", is_error: false }, 3000);
    ev({ type: "text", text: "Texto atrasado." }, 3050);
    ev({ type: "turn_completed", result: null }, 3100);
    return;
  }
  if (/\bfalhe\b/.test(text)) {
    ev({ type: "error", message: "Limite de uso atingido. Tente de novo mais tarde." }, 40);
    ev({ type: "turn_completed", result: null }, 60);
    return;
  }
  if (/servidor/.test(text)) {
    ev({ type: "tool_use", id: "sv1-" + ch.turn, name: "Bash", input: { command: "npm run dev", description: "Sobe o servidor", run_in_background: true } }, 40);
    ev({ type: "tool_result", id: "sv1-" + ch.turn, output: "started", is_error: false }, 60);
    ev({ type: "tool_use", id: "sv2-" + ch.turn, name: "Bash", input: { command: "docker run -d --name kabul_db postgres:16 && npm test -- --watch", description: "Testes em modo watch" } }, 80);
    return;
  }
  if (ch.turn === 1) {
    ev({ type: "session_started", session_id: "sess-mock", model: "mock" }, 30);
    ev({ type: "session_info", tools: ["Bash", "Read", "Write", "mcp__linear__list_issues", "mcp__linear__get_issue"], mcp_servers: [{ name: "linear", status: "connected" }, { name: "docs", status: "failed" }] }, 40);
  }
  const done = (msg: string, t: number) => {
    ev({ type: "text", text: msg }, t);
    ev({ type: "usage", input: 1200, output: 40, cache_read: 9000, cache_write: 1800, duration_ms: 900 }, t + 20);
    ev({ type: "turn_completed", result: null, input_tokens: 12000, output_tokens: 40, cost_usd: 0.01 }, t + 40);
  };
  if (/\b(crie|escreva)\b/i.test(text)) {
    ch.pending = "Write";
    ev({ type: "tool_use", id: "t1-" + ch.turn, name: "Write", input: { file_path: "ok.txt", content: "ok" } }, 120);
    ev({ type: "approval_request", request_id: "req-" + ch.turn, tool: "Write", input: { file_path: "ok.txt" } }, 200);
    return;
  }
  // agy: comando negado no modo headless vira pedido com a regra do projeto do workspace.
  if (/\bagy-negado\b/i.test(text)) {
    ch.pending = "agy";
    ev({ type: "tool_use", id: "c:2-" + ch.turn, name: "Bash", input: { CommandLine: "npm audit", command: "npm audit" } }, 60);
    ev({ type: "tool_result", id: "c:2-" + ch.turn, output: "Bloqueado pelo agy: precisa de permissão (aprove no cartão abaixo).", is_error: true }, 90);
    ev({ type: "approval_request", request_id: "agy-perm-c:2-" + ch.turn, tool: "Bash", input: { command: "npm audit", rule: "command(npm audit)", scope: "workspace" } }, 120);
    return;
  }
  // Turno lento: comando rodando (linha de status com cronômetro), subagente e texto no fim.
  if (/\bdevagar\b/i.test(text)) {
    ev({ type: "reasoning", text: "Vou auditar as dependências." }, 40);
    ev({ type: "tool_use", id: "dv1-" + ch.turn, name: "Bash", input: { command: "npm audit", description: "Audita" } }, 80);
    ev({ type: "tool_result", id: "dv1-" + ch.turn, output: "found 0 vulnerabilities", is_error: false }, 1500);
    ev({ type: "tool_use", id: "dv2-" + ch.turn, name: "Task", input: { description: "Revisar o lockfile", prompt: "revise" } }, 1550);
    ev({ type: "tool_result", id: "dv2-" + ch.turn, output: "ok", is_error: false }, 2600);
    done("Sem vulnerabilidades.", 2700);
    return;
  }
  if (/\bplano\b/i.test(text) && !/segundo plano/i.test(text)) {
    ch.pending = "ExitPlanMode";
    ev({ type: "approval_request", request_id: "plan-" + ch.turn, tool: "ExitPlanMode", input: { plan: "## Plano\n\n1. Ler `src/app.tsx`\n2. Corrigir o login\n3. Rodar os testes" } }, 120);
    return;
  }
  if (/\bpergunte\b/i.test(text)) {
    ch.pending = "AskUserQuestion";
    ev({ type: "approval_request", request_id: "q-" + ch.turn, tool: "AskUserQuestion", input: { questions: [{ header: "Banco", question: "Qual banco usar?", options: [{ label: "Postgres", description: "relacional" }, { label: "SQLite", description: "arquivo" }] }, { header: "Testes", question: "Escrever testes?", options: [{ label: "Sim" }, { label: "Não" }] }] } }, 120);
    return;
  }
  if (/diagrama/i.test(text)) {
    done("Fluxo:\n\n```mermaid\ngraph TD\n  A[Mensagem] --> B[Agente]\n  B --> C[Resposta]\n```\n\nE a fórmula:\n\n$$\nE = mc^2\n$$\n\n```mermaid\nisso não é mermaid válido ->>\n```", 80);
    return;
  }
  if (/\bcerto\b/i.test(text)) {
    done("You're absolutely right! Corrigi o teste.", 80);
    return;
  }
  if (/demorad/i.test(text)) {
    done("Terminei a tarefa demorada.", 1500);
    return;
  }
  if (/segundo plano/i.test(text)) {
    ev({ type: "tool_use", id: "bg1-" + ch.turn, name: "Bash", input: { command: "npm run dev", run_in_background: true, description: "Sobe o servidor" } }, 80);
    ev({ type: "tool_result", id: "bg1-" + ch.turn, output: "Command running in background with ID: 1", is_error: false }, 100);
    done("Servidor rodando em segundo plano.", 140);
    return;
  }
  ev({ type: "tool_use", id: "t0-" + ch.turn, name: "Bash", input: { command: "ls", description: "Lista os arquivos" } }, 60);
  ev({ type: "tool_result", id: "t0-" + ch.turn, output: Object.keys(db.files).join("\n"), is_error: false }, 80);
  ev({ type: "tool_use", id: "td-" + ch.turn, name: "TodoWrite", input: { todos: [{ content: "Listar arquivos", status: "completed" }, { content: "Responder", status: "in_progress" }] } }, 100);
  ev({ type: "tool_result", id: "td-" + ch.turn, output: "ok", is_error: false }, 110);
  ev({ type: "tool_use", id: "ed-" + ch.turn, name: "Edit", input: { file_path: "/mock/ws/kabul/main.rs", old_string: 'println!("oi");', new_string: 'println!("olá");' } }, 120);
  ev({ type: "tool_result", id: "ed-" + ch.turn, output: "ok", is_error: false }, 130);
  done(`Recebi: **${text.slice(0, 60)}**. Há ${Object.keys(db.files).length} arquivos.\n\n| arquivo | linhas |\n|---|---|\n| main.rs | 3 |\n\nVeja \`src/app.tsx\` e [a doc](https://example.com/doc).`, 160);
  void wid;
}

// ---------------- uso, custos e limites (espelha o core `usage`) ----------------
type UTurn = { at: number; provider: string; harness: string; model: string; account: string | null; workspace_id: string; session: string; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number | null; duration_ms: number };
const usage = {
  turns: [] as UTurn[],
  seeded: false,
  limits: null as any[] | null,
};
function seedUsage() {
  if (usage.seeded) return;
  usage.seeded = true;
  const t = now();
  const mk = (daysAgo: number, model: string, provider: string, cost: number | null, tokens: number, ws = "m-demo", session = "s-" + model + daysAgo): UTurn => ({ at: t - daysAgo * 86400 - 600, provider, harness: provider === "agy" ? "antigravity" : provider, model, account: `${provider}:sistema`, workspace_id: ws, session, input: tokens, output: Math.round(tokens / 20), cache_read: tokens * 3, cache_write: 0, cost_usd: cost, duration_ms: 45_000 });
  usage.turns.push(mk(9, "Opus 5.5", "claude", 1.2, 40_000), mk(5, "Opus 5.5", "claude", 0.8, 30_000), mk(3, "GPT-6-Luna", "codex", null, 50_000), mk(1, "Opus 5.5", "claude", 2.4, 90_000), mk(0, "Opus 5.5", "claude", 0.6, 12_000, "m-demo", "s-hoje"), mk(0, "Gemini 4 Argon", "agy", null, 8_000, "m-demo", "s-gem"));
}
function mockLimits(): any[] {
  const t = now();
  return usage.limits ?? (window as any).__mock?.usageLimits ?? [
    { provider: "claude", account: "claude:sistema", account_label: "dev@example.com", plan: "max", window: "5h", title: "Sessão (5 h)", used_pct: 86, window_mins: 300, resets_at: t + 2 * 3600 + 600, source: "claude-stream", updated_at: t },
    { provider: "claude", account: "claude:sistema", account_label: "dev@example.com", plan: "max", window: "semana", title: "Semana", used_pct: 41, window_mins: 10080, resets_at: t + 3 * 86400, source: "codexbar", updated_at: t },
    { provider: "codex", account: "codex:sistema", account_label: "dev@example.com", plan: "plus", window: "5h", title: "Sessão (5 h)", used_pct: 22, window_mins: 300, resets_at: t + 4 * 3600, source: "codex-app-server", updated_at: t },
  ];
}
function recordUsage(ch: string, p: any) {
  if (ch !== "chat-event" || p?.event?.type !== "turn_completed") return;
  const c = db.chats[p.chat_id];
  if (!c) return;
  c.working = false;
  usage.turns.push({ at: now(), provider: c.provider ?? "claude", harness: c.provider ?? "claude", model: c.model ?? "mock", account: `${c.provider ?? "claude"}:sistema`, workspace_id: c.ws ?? "", session: p.chat_id, input: p.event.input_tokens ?? 0, output: p.event.output_tokens ?? 0, cache_read: 0, cache_write: 0, cost_usd: p.event.cost_usd ?? null, duration_ms: 900 });
  emit("usage-changed", null);
}
const dayKey = (at: number) => { const d = new Date(at * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const tokensOf = (t: UTurn) => t.input + t.output + t.cache_read + t.cache_write;
function usageGroup(turns: UTurn[], key: (t: UTurn) => string, label: (k: string) => string) {
  const m = new Map<string, any>();
  for (const t of turns) {
    const k = key(t);
    const r = m.get(k) ?? { key: k, label: label(k), turns: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, tokens: 0, cost_usd: 0, unpriced: 0, duration_ms: 0 };
    Object.assign(r, { turns: r.turns + 1, input: r.input + t.input, output: r.output + t.output, cache_read: r.cache_read + t.cache_read, tokens: r.tokens + tokensOf(t), cost_usd: r.cost_usd + (t.cost_usd ?? 0), unpriced: r.unpriced + (t.cost_usd == null ? 1 : 0), duration_ms: r.duration_ms + t.duration_ms });
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.cost_usd - a.cost_usd || b.tokens - a.tokens);
}
const PL: Record<string, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity", local: "Local" };
/** Um bloco por provedor/conta em uso, com ou sem limite (espelha o core `expected_blocks`). `__mock.usageCodes`
 *  simula a última leitura que falhou por conta (`{ "claude:sistema": "expired" }`). */
function mockExpected(lims: any[], turns: UTurn[], sources: any[]) {
  const t = now();
  const live = lims.filter((l) => !l.resets_at || l.resets_at > t);
  const codes: Record<string, string> = { ...Object.fromEntries(sources.filter((x) => !x.ok && x.account && x.code).map((x) => [x.account, x.code])), ...((window as any).__mock?.usageCodes ?? {}) };
  const out: any[] = [];
  for (const p of ["claude", "codex", "agy"]) {
    const profiles = [{ id: `${p}:sistema`, nickname: "Padrão do sistema" }, ...db.accounts.filter((a: any) => a.provider === p)];
    const used = new Set<string>([...turns.filter((x) => x.provider === p).map((x) => x.account ?? ""), ...live.filter((l) => l.provider === p).map((l) => l.account ?? ""), ...Object.keys(codes).filter((k) => k.startsWith(p + ":"))]);
    if (!used.size && profiles.length < 2) continue;
    for (const a of profiles) {
      const sistema = a.id.endsWith(":sistema");
      if (sistema && profiles.length > 1 && !used.has(a.id) && !used.has("")) continue;
      out.push({ provider: p, account: a.id, label: a.nickname, has_data: live.some((l) => l.provider === p && (l.account === a.id || (sistema && !l.account))), code: codes[a.id] ?? null });
    }
  }
  return out;
}
function usageOverview(days: number) {
  seedUsage();
  const t = now();
  const lims = mockLimits();
  const turns = usage.turns.filter((x) => x.at >= t - days * 86400);
  const today = dayKey(t), month = today.slice(0, 7);
  const sum = (f: (x: UTurn) => boolean, v: (x: UTurn) => number) => usage.turns.filter(f).reduce((a, x) => a + v(x), 0);
  const byDay = new Map(usageGroup(turns, (x) => dayKey(x.at), (k) => k).map((r) => [r.key, r]));
  const by_day = Array.from({ length: days }, (_, i) => dayKey(t - (days - 1 - i) * 86400)).map((k) => byDay.get(k) ?? { key: k, label: k, turns: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, tokens: 0, cost_usd: 0, unpriced: 0, duration_ms: 0 });
  const today_usd = sum((x) => dayKey(x.at) === today, (x) => x.cost_usd ?? 0), month_usd = sum((x) => dayKey(x.at).startsWith(month), (x) => x.cost_usd ?? 0);
  const alertPct = db.settings.usage_alert_pct ?? 80;
  const hot = lims.filter((l) => l.used_pct >= alertPct && (!l.resets_at || l.resets_at > t));
  const alerts = hot.map((l) => ({ key: `limit:${l.provider}:${l.window}`, kind: "limit", level: l.used_pct >= 100 ? "crit" : "warn", text: `${PL[l.provider] ?? l.provider} (${l.account_label}): ${l.title} em ${l.used_pct}%`, provider: l.provider, account: l.account }));
  const budget = db.settings.usage_daily_budget;
  if (budget && today_usd >= budget * 0.8) alerts.push({ key: "daily", kind: "daily_budget", level: today_usd >= budget ? "crit" : "warn", text: `Gasto de hoje: US$ ${today_usd.toFixed(2)} de US$ ${budget.toFixed(2)}`, provider: null, account: null });
  const others = (p: string) => db.accounts.filter((a: any) => a.provider === p);
  const suggestions = hot.map((l) => {
    const o = others(l.provider)[0];
    return o ? { provider: l.provider, account: l.account, to_account: { id: o.id, nickname: o.nickname }, to_provider: null, text: `${PL[l.provider]} perto do limite (${l.title}: ${l.used_pct}%). Usar a conta ${o.nickname} nas conversas.` }
      : { provider: l.provider, account: l.account, to_account: null, to_provider: l.provider === "codex" ? "claude" : "codex", text: `${PL[l.provider]} perto do limite (${l.title}: ${l.used_pct}%). Trocar para um modelo do ${l.provider === "codex" ? "Claude" : "Codex"} na mesma conversa.` };
  });
  const sessions = usageGroup(turns, (x) => x.session, (k) => k).map((r) => {
    const ts = turns.filter((x) => x.session === r.key);
    return { session: r.key, workspace_id: ts[0].workspace_id, provider: ts[0].provider, model: ts[ts.length - 1].model, account: ts[0].account, started: Math.min(...ts.map((x) => x.at)) - 45, ended: Math.max(...ts.map((x) => x.at)), turns: r.turns, tokens: r.tokens, cost_usd: r.cost_usd, unpriced: r.unpriced, duration_ms: r.duration_ms };
  }).sort((a, b) => b.ended - a.ended);
  const wsLabel = (k: string) => ws(k)?.title ?? ws(k)?.name ?? k;
  // `__mock.usageSources` troca as fontes (ex.: Claude sem login, CodexBar com link quebrado).
  const sources: any[] = (window as any).__mock?.usageSources ?? [{ name: "Claude (assinatura) · Padrão do sistema", ok: true, detail: "2 janela(s)", provider: "claude", account: "claude:sistema" }, { name: "Codex app-server · Padrão do sistema", ok: true, detail: "1 janela(s)", provider: "codex", account: "codex:sistema" }, { name: "CodexBar", ok: true, detail: "2 janela(s)" }];
  return {
    schema_version: 1, days, today_usd, month_usd, today_tokens: sum((x) => dayKey(x.at) === today, tokensOf), month_tokens: sum((x) => dayKey(x.at).startsWith(month), tokensOf), unpriced_turns: turns.filter((x) => x.cost_usd == null).length,
    by_day, by_model: usageGroup(turns, (x) => x.model, (k) => k), by_account: usageGroup(turns, (x) => x.account ?? x.provider, (k) => `${PL[k.split(":")[0]] ?? k} · Padrão do sistema`), by_workspace: usageGroup(turns, (x) => x.workspace_id, wsLabel), by_provider: usageGroup(turns, (x) => x.provider, (k) => PL[k] ?? k),
    sessions, limits: { schema_version: 1, limits: lims, status: [{ provider: "codex", indicator: "minor", description: "Lentidão parcial", url: "https://status.example" }], credits: [], sources, updated_at: t },
    tightest: [...lims].sort((a, b) => b.used_pct - a.used_pct)[0] ?? null, alerts, suggestions, expected: mockExpected(lims, usage.turns, sources),
  };
}
function usageCsv(days: number) {
  seedUsage();
  const t = now();
  const rows = usage.turns.filter((x) => x.at >= t - days * 86400).map((x) => [dayKey(x.at), x.provider, x.harness, x.model, x.account ?? "", x.workspace_id, x.session, x.input, x.output, x.cache_read, x.cache_write, x.cost_usd ?? "", x.duration_ms].join(","));
  return ["data,provedor,harness,modelo,conta,workspace,sessao,entrada,saida,cache_lido,cache_gravado,custo_usd,duracao_ms", ...rows].join("\n") + "\n";
}

const handlers: Record<string, (a: any) => unknown> = {
  usage_overview: ({ days }) => usageOverview(days ?? 30),
  usage_refresh: () => ((window as any).__usageRefreshed = ((window as any).__usageRefreshed ?? 0) + 1, emit("usage-changed", null), usageOverview(30).limits),
  usage_csv: ({ days }) => usageCsv(days ?? 30),
  usage_csv_save: () => "/mock/Downloads/kabul-uso.csv",
  agents_running: () => Object.entries(db.chats).filter(([, c]) => c.ws).map(([cid, c]) => ({ chat_id: cid, workspace_id: c.ws, workspace: ws(c.ws!)?.title ?? ws(c.ws!)?.name ?? c.ws, model: c.model, harness: c.provider === "agy" ? "antigravity" : c.provider, since: c.since, working: !!c.working })),
  tray_action: ({ action, workspaceId }) => ((window as any).__trayActions ??= []).push(action) && emit("tray-action", { action, workspace_id: workspaceId ?? null }),
  tray_hide: () => void ((window as any).__trayHidden = true),
  repos_list: () => db.repos.map((r) => ({ ...r })),
  repo_add: ({ path }) => {
    const r = { id: id(), name: path.split("/").filter(Boolean).pop(), path, default_branch: "main" };
    db.repos.push(r);
    return r;
  },
  repo_clone: ({ url }) => handlers.repo_add({ path: "/mock/repos/" + url.split("/").pop().replace(".git", "") }),
  repo_remove: ({ id: rid }) => void (db.repos = db.repos.filter((r) => r.id !== rid)),
  repo_settings: () => ({ settings: db.repoSettings, layers: [{ name: "usuário", path: "~/.kabul/settings.toml", found: false }, { name: "repo", path: ".kabul/settings.toml", found: true }, { name: "repo local", path: ".kabul/settings.local.toml", found: false }, { name: "gerenciado", path: "~/.kabul/settings.managed.toml", found: false }] }),
  repo_settings_save: ({ settings }) => ((db.repoSettings = settings), ".kabul/settings.local.toml"),
  // Cópias, como num transporte de verdade (o React precisa ver objetos novos).
  workspaces_list: () => db.workspaces.map((w) => ({ ...w })),
  workspace_create: ({ repoId }) => {
    const used = db.workspaces.map((w) => w.name);
    const name = CITIES.find((c) => !used.includes(c)) ?? `ws${seq}`;
    const w = { id: id(), repo_id: repoId, name, branch: `dev/${name}`, path: `/mock/ws/${name}`, archived: false, created_at: now(), title: null, status: "in-progress", state: "setting_up", pinned: false, notes: "", port: 41000 + db.workspaces.length * 10, target_branch: null, pr_url: null, archive_checkpoint: null, user_set_branch: false, files_copied: 1 };
    db.workspaces.push(w);
    db.changed[w.id] = {};
    setTimeout(() => ((w.state = "ready"), emit("workspace-state", { id: w.id, state: "ready" })), 400);
    return w;
  },
  workspace_update: ({ id: wid, patch }) => Object.assign(ws(wid), Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, k === "section" && v === "" ? null : v]))),
  workspace_rename_branch: ({ id: wid, name }) => Object.assign(ws(wid), { branch: name, user_set_branch: true }),
  workspace_auto_branch: ({ workspaceId, text }) => {
    const w = ws(workspaceId);
    if (w.user_set_branch || !w.branch.endsWith("/" + w.name)) return null;
    w.branch = "dev/" + text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean).slice(0, 5).join("-");
    return w;
  },
  workspace_archive: ({ id: wid, closePr }) => { if (closePr && db.pr[wid]) db.pr[wid].state = "CLOSED"; Object.assign(ws(wid), { archived: true, state: "archived", archive_checkpoint: "archive-" + wid }); },
  workspace_unarchive: ({ id: wid }) => Object.assign(ws(wid), { archived: false, state: "ready" }),
  workspace_changes: ({ workspaceId, scope }) => (scope === "branch" ? changes(workspaceId).filter((c) => !c.untracked) : changes(workspaceId)),
  workspace_file_diff: ({ workspaceId, path, ignoreWs }) => {
    const body = (db.changed[workspaceId]?.[path] ?? "").replace(/\n$/, "");
    const old = (db.files[path] ?? "").replace(/\n$/, "").split("\n");
    const neu = body.split("\n");
    const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${old.length} +1,${neu.length} @@`];
    // Diff simples linha a linha (o suficiente para o mock): iguais viram contexto.
    const n = Math.max(old.length, neu.length);
    for (let i = 0; i < n; i++) {
      const a = old[i], b = neu[i];
      if (a === b || (ignoreWs && a !== undefined && b !== undefined && a.replace(/\s+/g, "") === b.replace(/\s+/g, ""))) out.push(" " + (b ?? a));
      else { if (a !== undefined && db.files[path] !== undefined) out.push("-" + a); if (b !== undefined) out.push("+" + b); }
    }
    return out.join("\n");
  },
  git_status: ({ workspaceId }) => ({ branch: ws(workspaceId).branch, target: ws(workspaceId).target_branch ?? "main", upstream: db.git[workspaceId]?.upstream ?? null, dirty: changes(workspaceId).length, ahead: db.git[workspaceId]?.ahead ?? 0, behind: db.git[workspaceId]?.behind ?? 0, behind_target: db.git[workspaceId]?.behind_target ?? 0, conflicts: db.git[workspaceId]?.conflicts ?? [] }),
  git_pull: ({ workspaceId }) => ((db.git[workspaceId] = { ...(db.git[workspaceId] ?? {}), behind: 0 }), { ok: true, dry_run: false, commands: [`git pull --no-rebase --no-edit origin ${ws(workspaceId).branch}`], output: "Already up to date." }),
  git_push: ({ workspaceId }) => ((db.git[workspaceId] = { ...(db.git[workspaceId] ?? {}), ahead: 0, upstream: "origin/" + ws(workspaceId).branch }), { ok: true, dry_run: false, commands: ["git push -u origin HEAD"], output: "" }),
  workspace_discard: ({ workspaceId, path }) => void delete db.changed[workspaceId]?.[path],
  workspace_grep: ({ query }) => Object.entries(db.files).flatMap(([p, body]) => body.split("\n").map((t, i) => ({ path: p, line: i + 1, text: t })).filter((h) => query && h.text.toLowerCase().includes(String(query).toLowerCase()))),
  pr_view: ({ workspaceId }) => db.pr[workspaceId] ?? null,
  pr_merge: ({ workspaceId }) => { const p = db.pr[workspaceId]; if (p) p.state = "MERGED"; ws(workspaceId).status = "done"; const rs = db.repoSettings as any; if (rs.archive_on_merge ?? db.settings.archive_on_merge) handlers.workspace_archive({ id: workspaceId }); return { ok: true, dry_run: false, commands: [`gh pr merge --${db.settings.merge_method}`], output: "" }; },
  pr_ready: ({ workspaceId }) => { const p = db.pr[workspaceId]; if (p) (p.is_draft = false, p.merge_state = "CLEAN"); return { ok: true, dry_run: false, commands: ["gh pr ready"], output: "" }; },
  pr_edit: ({ workspaceId, title, body }) => { Object.assign(db.pr[workspaceId] ?? {}, { title, body }); return { ok: true, dry_run: false, commands: ["gh pr edit --title …"], output: "" }; },
  checks_rerun: ({ links }) => ({ ok: true, dry_run: true, commands: [...new Set((links as string[]).map((l) => /runs\/(\d+)/.exec(l)?.[1]).filter(Boolean))].map((r) => `gh run rerun ${r} --failed`), output: "" }),
  check_log: ({ link }) => `Run npm run lint\nsrc/app.tsx:12:3  error  'x' is assigned a value but never used  no-unused-vars\n✖ 1 problem (1 error, 0 warnings)\nProcess completed with exit code 1. (${link})`,
  sections_list: () => db.sections,
  section_save: ({ section }) => { const s = { ...section, id: section.id || id(), order: section.id ? section.order : db.sections.length }; db.sections = [...db.sections.filter((x: any) => x.id !== s.id), s].sort((a: any, b: any) => a.order - b.order); return s; },
  section_delete: ({ id: sid }) => { db.sections = db.sections.filter((x: any) => x.id !== sid); db.workspaces.forEach((w) => w.section === sid && (w.section = null)); },
  repo_update: ({ id: rid, hidden, icon }) => Object.assign(db.repos.find((r) => r.id === rid), hidden === undefined ? {} : { hidden }, icon === undefined ? {} : { icon: icon || null }),
  repo_env_layers: () => [["repo", { API_URL: "http://localhost:$KABUL_PORT", LOG: "info" }], ["repo local", { LOG: "debug" }]],
  gh_repos: () => [
    { name_with_owner: "dev/demo-app", owner: "dev", private: true, updated_at: "2026-10-20T10:00:00Z", url: "https://github.com/dev/demo-app", description: "App de demonstração", avatar: "" },
    { name_with_owner: "acme/site", owner: "acme", private: false, updated_at: "2026-10-18T10:00:00Z", url: "https://github.com/acme/site", description: null, avatar: "" },
    { name_with_owner: "dev/dotfiles", owner: "dev", private: false, updated_at: "2026-09-01T10:00:00Z", url: "https://github.com/dev/dotfiles", description: "configs", avatar: "" },
  ],
  repo_clone_to: async ({ input, dir }) => {
    const name = String(input).replace(/\.git$/, "").split(/[/:]/).pop();
    if (name === "nao-existe") throw new Error("Repositório não encontrado. Confira a URL e se a conta do GitHub conectada tem acesso.");
    for (const [phase, pct] of [["Receiving objects", 40], ["Receiving objects", 100], ["Resolving deltas", 100]] as const) {
      emit("clone-progress", { phase, pct });
      await new Promise((r) => setTimeout(r, 60));
    }
    db.settings.clone_dir = dir;
    return handlers.repo_add({ path: `${String(dir).replace(/\/$/, "")}/${name}` });
  },
  repo_quick_start: ({ name, dir }) => ((db.settings.clone_dir = dir), handlers.repo_add({ path: `${String(dir).replace(/\/$/, "")}/${name}` })),
  git_identity: () => ({ ...{ name: "Dev", email: "dev@example.com", scope: "global", global_name: "Dev", global_email: "dev@example.com" }, ...(db as any).identity }),
  git_identity_set: ({ name, email }) => ((db as any).identity = name || email ? { name, email, scope: "repo" } : {}, handlers.git_identity({})),
  repo_remotes: () => ["origin", "upstream"],
  pr_open_url: ({ workspaceId, prUrl }) => { const t = db.settings.open_prs_in; const w = ws(workspaceId); if (t === "linear" && w.linear) return w.linear.url; if (t === "graphite") { const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl); if (m) return `https://app.graphite.dev/github/pr/${m[1]}/${m[2]}/${m[3]}`; } return prUrl; },
  diagnostics: () => ({ checks: [{ group: "Essenciais", name: "git", ok: true, detail: "git version 2.50 (/usr/bin/git)" }, { group: "Essenciais", name: "tmux", ok: true, detail: "tmux 3.5" }, { group: "Agentes", name: "Qwen Code", ok: false, detail: "não encontrado no PATH" }, { group: "Ambiente", name: "HOME", ok: true, detail: "/home/dev" }], report: "Kabul — diagnóstico\n✓ git\nHOME /home/dev", redacted: "Kabul — diagnóstico\n✓ git\nHOME ~" }),
  app_quit: () => void ((window as any).__quit = true),
  open_devtools: () => void ((window as any).__devtools = true),
  machine_info: () => ({ name: "Mac de Dev", user: { login: "dev", email: "dev@example.com", avatar: null } }),
  sound_play: ({ name }) => void ((window as any).__sound = name),
  workspace_files: () => [...Object.keys(db.files), ".gitignore", "Cargo.toml", "src/app.tsx", "src/styles.css", "docs/guia.md", ".context/notes.md"],
  workspace_read_file: ({ path }) => db.files[path] ?? "",
  workspace_busy: () => "clean",
  workspaces_stats: () => Object.fromEntries(db.workspaces.map((w) => [w.id, [changes(w.id).reduce((a, c) => a + c.added, 0), 0]])),
  workspace_diff: () => ({ base: "abc123", base_ref: "main", stat: "", patch: "" }),
  workspace_pr: ({ options }) => ({ url: options.dry_run ? null : "https://github.com/x/y/pull/1", dry_run: options.dry_run, commands: ["git push -u origin HEAD", `gh pr create --base main --title '${options.title}'${options.draft ? " --draft" : ""}`] }),
  comments_list: ({ workspaceId }) => db.comments.filter((c) => c.workspace_id === workspaceId),
  comment_add: ({ workspaceId, path, line, endLine, body }) => {
    const c = { id: id(), workspace_id: workspaceId, path, line, end_line: endLine, body, resolved: false, created_at: now() };
    db.comments.push(c);
    return c;
  },
  comment_update: ({ id: cid, resolved, delete: del }) => {
    if (del) db.comments = db.comments.filter((c) => c.id !== cid);
    else Object.assign(db.comments.find((c) => c.id === cid) ?? {}, { resolved });
  },
  checkpoints_list: ({ workspaceId }) => db.checkpoints[workspaceId] ?? [],
  checkpoint_create: ({ workspaceId, message }) => {
    const c = { id: id(), commit: "c" + seq, head: "h", message, created_at: now(), snapshot: { ...(db.changed[workspaceId] ?? {}) } };
    (db.checkpoints[workspaceId] ??= []).unshift(c);
    return c;
  },
  checkpoint_restore: ({ workspaceId, id: cid }) => void (db.changed[workspaceId] = { ...(db.checkpoints[workspaceId].find((c) => c.id === cid)?.snapshot ?? {}) }),
  attach_file: ({ path }) => ".context/attachments/" + path.split("/").pop(),
  attach_bytes: ({ name }) => ".context/attachments/" + name,
  pick_file: () => "/mock/Downloads/especificacao.pdf",
  pick_folder: () => (window as any).__mock?.pickFolder ?? "/mock/repos/demo",
  script_run: ({ workspaceId, which, runId }) => {
    const s = `kabul-${ws(workspaceId).name}-${which}${runId ? "-" + runId : ""}`;
    setTimeout(() => emit("term-output", { session: s, pane: "%9", data: [...new TextEncoder().encode(`$ ${which === "setup" ? "echo instalando" : "npm run dev"}\r\n[kabul] saiu com 0\r\n`)] }), 100);
    return s;
  },
  script_stop: () => undefined,
  term_open: ({ workspaceId, name }) => ({ session: name ?? `kabul-${ws(workspaceId).name}`, pane: "%1", snapshot: "dev@mac " + ws(workspaceId).name + " % " }),
  term_input: ({ session, pane, data }) => {
    ((window as any).__termInput ??= []).push([session, data]);
    const out = data === "\r" ? "\r\nmock: comando executado\r\nval@mac % " : data;
    emit("term-output", { session, pane, data: [...new TextEncoder().encode(out)] });
  },
  term_resize: () => undefined,
  term_close: () => undefined,
  // `__mock.holdModels`: a lista de modelos só chega quando o primeiro envio pede o checkpoint (corrida do envio).
  // Com `"manual"`, só chega quando o teste chamar `__mock.releaseModels()` (ex.: depois da mensagem já estar na tela).
  models_list: () => {
    const m = (window as any).__mock;
    if (!m?.holdModels) return models;
    // Todos os pedidos pendentes são liberados juntos (mais de uma aba pode pedir a lista).
    return new Promise((r) => {
      const prev = m.releaseModels;
      m.releaseModels = () => (prev?.(), r(models), (m.releaseModels = null));
    });
  },
  local_overview: () => ({ memory: 34359738368, harnesses: [["claude", true, ""], ["codex", true, ""], ["antigravity", true, ""], ["opencode", true, ""], ["qwen", false, "npm install -g @qwen-code/qwen-code"], ["gemini", false, "npm install -g @google/gemini-cli"]], sources: [
    { id: "ollama", name: "Ollama", kind: "runtime", base_url: "http://127.0.0.1:11434", installed: false, running: false, apis: ["openai"], models: [], can_start: false, can_pull: true, pull_hint: "ex.: qwen3-coder:30b", custom: false },
    { id: "lmstudio", name: "LM Studio", kind: "runtime", base_url: "http://127.0.0.1:1234", installed: true, running: true, apis: ["openai", "anthropic"], models: [{ id: "qwen3-8b", name: "Qwen3 8B", source: "lmstudio", size_bytes: 4623782544, quant: "4bit", params: "8B", context: 40960, loaded: true }], can_start: true, can_pull: true, pull_hint: "ex.: qwen/qwen3-coder-30b", custom: false },
    ...db.endpoints.map((e) => ({ ...e, kind: "endpoint", installed: true, running: false, models: [], can_start: false, can_pull: false, pull_hint: "", custom: true })),
  ] }),
  local_endpoint_save: ({ endpoint }) => void db.endpoints.push(endpoint),
  local_endpoint_remove: ({ id: eid }) => void (db.endpoints = db.endpoints.filter((e) => e.id !== eid)),
  local_pull: ({ model }) => "kabul-pull-" + model,
  local_start: () => undefined,
  harness_install: ({ kind }) => "kabul-install-" + kind,
  registry_get: () => db.registry || '{\n  "version": 1,\n  "families": [\n    { "family": "qwen", "match": ["qwen"], "harnesses": ["qwen", "opencode"] },\n    { "family": "outros", "match": [], "harnesses": ["opencode"] }\n  ]\n}',
  registry_save: ({ text }) => {
    JSON.parse(text);
    db.registry = text;
  },
  registry_reset: () => void (db.registry = ""),
  chat_start: ({ model, resume, workspaceId }) => {
    (window as any).__kabulStarts = ((window as any).__kabulStarts ?? 0) + 1;
    (window as any).__kabulLastStart = { harness: model.harness, resume: resume ?? null };
    const cid = id();
    db.chats[cid] = { pending: null, turn: 0, ws: workspaceId, model: model.label, provider: ({ claude: "claude", codex: "codex", antigravity: "agy" } as Record<string, string>)[model.harness] ?? "local", since: now() };
    // Goose e OpenCode não têm plan mode no ACP: o Kabul emula.
    return { chat_id: cid, harness: model.harness, approvals: true, note: model.local?.note ?? null, plan: ["goose", "opencode", "cursor"].includes(model.harness) ? "emulated" : "native" };
  },
  // Troca ao vivo: todos menos o Antigravity (esse reinicia retomando a conversa).
  chat_set_mode: ({ chatId }) => { const c = db.chats[chatId]; return !!c && !(window as any).__kabulNoLiveMode; },
  chat_send: ({ chatId, text }) => (db.chats[chatId] && (db.chats[chatId].working = true), agentTurn(chatId, text, "")),
  chat_approve: ({ chatId, allow, updatedInput }) => {
    const ev = (e: unknown, t: number) => setTimeout(() => emit("chat-event", { chat_id: chatId, event: e }), t);
    const pend = db.chats[chatId]?.pending;
    if (pend === "agy") {
      db.chats[chatId].pending = null;
      if (allow) {
        ev({ type: "tool_use", id: "c:5-" + db.chats[chatId].turn, name: "Bash", input: { CommandLine: "npm audit", command: "npm audit" } }, 40);
        ev({ type: "tool_result", id: "c:5-" + db.chats[chatId].turn, output: "found 0 vulnerabilities", is_error: false }, 60);
      }
      ev({ type: "text_delta", text: allow ? "Nenhuma vulnerabilidade." : "Ok, sigo sem rodar." }, 90);
      ev({ type: "turn_completed", result: null, input_tokens: 15000, output_tokens: 30, cost_usd: null }, 120);
      ev({ type: "turn_completed", result: null, input_tokens: 15000, output_tokens: 30, cost_usd: null }, 121);
      return;
    }
    if (pend === "ExitPlanMode" || pend === "AskUserQuestion") {
      db.chats[chatId].pending = null;
      const msg = pend === "ExitPlanMode" ? (allow ? "Executando o plano." : "Ok, ajusto o plano.") : allow ? `Respostas: ${Object.values(updatedInput?.answers ?? {}).join(", ")}` : "Sem respostas.";
      ev({ type: "text", text: msg }, 60);
      ev({ type: "turn_completed", result: null, input_tokens: 15000, output_tokens: 30, cost_usd: 0.02 }, 100);
      return;
    }
    ev({ type: "tool_result", id: "t1-" + db.chats[chatId].turn, output: allow ? "arquivo criado" : "negado pelo usuário", is_error: !allow }, 60);
    ev({ type: "text", text: allow ? "Criei `ok.txt`." : "Ok, não criei o arquivo." }, 120);
    ev({ type: "turn_completed", result: null, input_tokens: 15000, output_tokens: 30, cost_usd: 0.02 }, 160);
    if (allow) for (const w of db.workspaces) (db.changed[w.id] ??= {})["ok.txt"] = "ok\n";
  },
  resources_get: () => {
    // Árvore sintética: app → Principal → agentes (por workspace) → filhos.
    const ws = db.workspaces[0]?.id ?? null;
    const n = (pid: number, name: string, cpu: number, mem: number, kind: string, children: any[] = [], extra: any = {}) => ({ pid, name, cpu: cpu + children.reduce((a: number, c: any) => a + c.cpu, 0), mem: mem + children.reduce((a: number, c: any) => a + c.mem, 0), kind, agent: kind === "agent" ? name : null, workspace_id: extra.ws ?? null, chat_id: extra.chat ?? null, children });
    const MB = 1024 * 1024;
    const kids = [
      n(11, "claude", 0.2, 510.8 * MB, "agent", [n(12, "node", 0, 673.4 * MB, "process", [], { ws }), n(13, "zsh", 0, 1.8 * MB, "terminal", [n(14, "cargo", 0, 71.3 * MB, "process", [], { ws })], { ws })], { ws, chat: Object.keys(db.chats)[0] ?? null }),
      n(21, "codex", 1.1, 120 * MB, "agent", [], { ws }),
      ...Array.from({ length: 8 }, (_, i) => n(30 + i, `helper-${i + 1}`, 0.1, (5 + i) * MB, "process")),
    ];
    const main = n(10, "Principal", 4.5, 238.2 * MB, "main", kids);
    const own = { ...main, cpu: 4.5, mem: 238.2 * MB };
    return { cpu: main.cpu, mem: main.mem, count: 15, root: { ...main, pid: 10, name: "App", kind: "app", children: [own] } };
  },
  chat_stop: ({ chatId }) => void releaseSlot(chatId),
  // Parar: "rode sleep 30" deixa só o comando em primeiro plano (o CLI encerra); "suba o servidor" deixa
  // o servidor em segundo plano e um contêiner com -d.
  chat_interrupt: ({ chatId }) => {
    releaseSlot(chatId);
    const ch = db.chats[chatId];
    const last = ch?.last ?? "";
    const t = now();
    const leftovers = /servidor/.test(last) ? [{ pid: 4242, start: t - 20, name: "node", cmd: "node node_modules/.bin/vite --port 3000", ports: [3000], age: 20 }] : [];
    const containers = /servidor/.test(last) ? [{ id: "abc123def456", image: "postgres:16", name: "kabul_db" }] : [];
    (window as any).__mock.interrupted = ((window as any).__mock.interrupted ?? 0) + 1;
    return { alive: true, leftovers, containers };
  },
  chat_processes: ({ chatIds }) => (chatIds as string[]).some((id) => /servidor/.test(db.chats[id]?.last ?? "")) ? [{ pid: 4242, start: now() - 20, name: "node", cmd: "node node_modules/.bin/vite --port 3000", ports: [3000], age: 20 }] : [],
  processes_keep: ({ items, workspaceId }) => void (db.kept = [...(db.kept ?? []), ...(items as any[]).map((x) => ({ ...x, workspace_id: workspaceId }))]),
  processes_kept: () => db.kept ?? [],
  process_kill: ({ keys }) => {
    const k = keys as { pid: number }[];
    db.kept = (db.kept ?? []).filter((x: any) => !k.some((y) => y.pid === x.pid));
    ((window as any).__mock.killed ??= []).push(...k.map((x) => x.pid));
    return k.length;
  },
  docker_stop: ({ id }) => void ((window as any).__mock.dockerStopped ??= []).push(id),
  history_list: ({ workspaceId }) => Object.values(db.history).filter((h: any) => h.workspace_id === workspaceId).map((h: any) => ({ id: h.id, title: h.title, model_key: h.model_key, updated_at: h.updated_at })),
  history_load: ({ id: hid }) => {
    if (!db.history[hid]) throw new Error("sessão não encontrada");
    return db.history[hid];
  },
  history_save: ({ record }) => void (db.history[record.id] = record),
  history_delete: ({ id: hid }) => void delete db.history[hid],
  history_search: ({ q }) => Object.values(db.history).filter((h: any) => JSON.stringify(h.items).toLowerCase().includes(q.toLowerCase())).map((h: any) => [h.workspace_id, h.id, h.title, q]),
  slash_commands: () => [["/compact", "resumir a conversa"], ["/review", "revisar as mudanças"], ["/plan", "alternar plan mode"]],
  external_sessions: () => {
    // Fora do Kabul: um codex no Terminal dentro do workspace e um claude numa pasta sem workspace.
    const w = db.workspaces[0];
    const t = Math.floor(Date.now() / 1000);
    return {
      running: [
        { agent: "codex", pid: 4242, cwd: w?.path ?? "/tmp/x", repo: "demo", branch: w?.branch ?? "main", running_secs: 754, terminal: "Terminal", session_id: "0000-codex-sess" },
        { agent: "claude", pid: 4343, cwd: "/fora/projeto", repo: "projeto", branch: "main", running_secs: 30, terminal: "iTerm2", session_id: "1111-claude-sess" },
      ],
      recent: [
        { agent: "claude", id: "2222-claude-hist", title: "Revisar a fila de mensagens", cwd: w?.path ?? "/tmp/x", repo: "demo", branch: "feat/fila", updated: t - 3600 },
        { agent: "agy", id: "3333-agy-hist", title: "Análise de segurança", cwd: "/fora/outro", repo: "outro", branch: null, updated: t - 86400 * 2 },
      ],
      cloud_note: "O Claude Code não lista sessões de nuvem fora de um terminal interativo. Cole o link ou o id.",
    };
  },
  sessions_list: () => ({ tmux: [{ session: "kabul-kabul", window_index: 0, pane_index: 0, pane_id: "%1", pid: 1, command: "zsh", path: "/mock/ws/kabul", active: true, title: "", agent: "shell" }], imported_workspaces: [], imported_sessions: [{ id: "c1", workspace_id: null, status: "idle", title: "Sessão importada", model: "opus", agent_type: "claude", updated_at: null }], imported_error: null }),
  auth_status: () => ["claude", "codex", "antigravity", "opencode", "qwen", "gemini"].map((k) => ({ kind: k, logged_in: !["qwen", "gemini"].includes(k), source: "mock", method: null, error: null, installed: !["qwen", "gemini"].includes(k) })),
  auth_login: ({ kind }) => {
    emit("auth-event", { kind, event: { Url: "https://claude.ai/oauth/authorize?mock=1" } });
    emit("auth-event", { kind, event: "PedeCodigo" });
  },
  auth_code: ({ kind }) => emit("auth-event", { kind, event: "Ok" }),
  auth_cancel: () => undefined,
  app_settings_get: () => db.settings,
  app_settings_save: ({ settings }) => void (db.settings = settings),
  notify: ({ title, body }) => void ((window as any).__notified ??= []).push(`${title}: ${body}`),
  badge_set: ({ count }) => void ((window as any).__badge = count),
  // Atualizações: `__mock.update` simula uma versão nova; `__mock.offline` simula sem rede.
  app_version: () => ({ version: __KABUL_VERSION__, protocol: 1, channel: db.settings.update_channel ?? "stable", updater: true }),
  update_check: ({ channel }) => {
    if ((window as any).__mock?.offline) throw "Sem conexão com o servidor de atualizações; tente mais tarde.";
    const u = (window as any).__mock?.update;
    return u ? { current: __KABUL_VERSION__, notes: null, date: null, channel: channel ?? db.settings.update_channel ?? "stable", ...u } : null;
  },
  update_install: () => void ((window as any).__updateInstalled = true),
  accounts_list: ({ provider }) => [{ id: `${provider}:sistema`, provider, nickname: "Padrão do sistema", email: null, plan: null, dir: null, default: !db.accounts.some((a: any) => a.provider === provider && a.default), logged_in: true, env_var: "CLAUDE_CONFIG_DIR", env_confirmed: true }, ...db.accounts.filter((a: any) => a.provider === provider)],
  account_add: ({ provider, nickname }) => { const a = { id: `${provider}:${id()}`, provider, nickname, email: null, plan: null, dir: `/mock/accounts/${provider}`, default: false, logged_in: false, env_var: "CLAUDE_CONFIG_DIR", env_confirmed: true }; db.accounts.push(a); return a; },
  account_update: ({ id: aid, nickname, makeDefault, remove }) => {
    if (remove) return void (db.accounts = db.accounts.filter((a: any) => a.id !== aid));
    const a = db.accounts.find((x: any) => x.id === aid);
    if (a && nickname) a.nickname = nickname;
    if (makeDefault) db.accounts.forEach((x: any) => (x.default = x.id === aid));
  },
  account_login: ({ id: aid }) => {
    // agy: link do Google e pedido de código na hora; a primeira tentativa "expira" rápido (no real, 60 s).
    if (aid.startsWith("agy:")) {
      const n = (db.agyLogins[aid] = (db.agyLogins[aid] ?? 0) + 1);
      emit("account-auth-event", { id: aid, event: { Url: `https://accounts.google.com/o/oauth2/auth?mock=${n}` } });
      emit("account-auth-event", { id: aid, event: "PedeCodigo" });
      if (n === 1) setTimeout(() => emit("account-auth-event", { id: aid, event: "Expirou" }), 1200);
      return;
    }
    emit("account-auth-event", { id: aid, event: { Url: "https://claude.ai/oauth/authorize?mock=1" } });
    emit("account-auth-event", { id: aid, event: "PedeCodigo" });
  },
  account_code: ({ id: aid }) => { const a = db.accounts.find((x: any) => x.id === aid); if (a) (a.logged_in = true, a.email = "dev2@example.com"); emit("account-auth-event", { id: aid, event: "Ok" }); },
  account_cancel: () => undefined,
  repo_branches: () => ["main", "dev/login-safari", "feat/relatorio-pdf"],
  repo_prs: () => [{ number: 42, title: "Corrige login no Safari", headRefName: "dev/login-safari", author: { login: "dev" }, isDraft: false, url: "https://github.com/x/y/pull/42" }],
  workspace_create_ex: ({ repoId, branch, pr, prHead, base }) => { const w: any = handlers.workspace_create({ repoId }); if (branch || pr) Object.assign(w, { branch: branch ?? prHead, user_set_branch: true }); if (base) w.target_branch = base; return w; },
  cloud_start: ({ prompt }) => ({ tmux: "kabul-kabul-cloud-1", info: { id: "session_01MockCloud", url: "https://claude.ai/code/session_01MockCloud?from=cli", title: String(prompt).slice(0, 40), warning: "Branch val/kabul is not on GitHub, so the cloud session starts from the newest commit beneath it that origin/main has.", exited: 0 } }),
  cloud_poll: () => ({ id: "session_01MockCloud", url: "https://claude.ai/code/session_01MockCloud?from=cli", title: "mock", warning: null, exited: 0 }),
  teleport: ({ id }) => `kabul-kabul-teleport-${String(id).slice(-6)}`,
  term_run: ({ name }) => `kabul-kabul-${name}`,
  mirror_status: () => ({ running: db.mirror, tmux: "kabul-kabul-mirror", link: db.mirror ? "https://claude.ai/code/session_01Mirror" : null }),
  mirror_start: () => ((db.mirror = true), { running: true, tmux: "kabul-kabul-mirror", link: "https://claude.ai/code/session_01Mirror" }),
  mirror_stop: () => void (db.mirror = false),
  workspace_fork: ({ workspaceId }) => { const src = ws(workspaceId); const w: any = handlers.workspace_create({ repoId: src.repo_id }); w.title = `${src.title ?? src.name} (fork)`; return w; },
  github_status: () => db.ghAccounts.map((a: any) => ({ ...a })),
  github_login: () => {
    emit("github-auth-event", { Codigo: "ABCD-1234" });
    emit("github-auth-event", { Url: "https://github.com/login/device" });
    setTimeout(() => { db.ghAccounts = [...db.ghAccounts, { host: "github.com", login: "dev-dois", active: false, scopes: ["repo"], source: "keyring", ok: true }]; emit("github-auth-event", "Ok"); }, 300);
  },
  github_cancel: () => undefined,
  github_switch: ({ login }) => void db.ghAccounts.forEach((a: any) => (a.active = a.login === login)),
  github_token: ({ token }) => ((db.ghToken = !!token), !!token),
  github_token_set: () => db.ghToken,
  github_repo_access: () => ({ slug: "dev/demo", ok: false, permission: null, message: "Missing GitHub access: a conta ativa não acessa dev/demo." }),
  mcp_list: () => [{ name: "linear", scope: "user", source: "~/.claude.json", transport: "http", target: "https://mcp.linear.app/mcp" }, { name: "docs", scope: "project", source: ".mcp.json", transport: "stdio", target: "npx -y docs-mcp" }],
  mcp_add: () => undefined,
  // Registro único: linear vem do Claude e do Codex; docs só do projeto (Claude); figma é remoto com login (não compartilhado).
  // Cópia, como o backend de verdade (JSON novo a cada chamada): o painel re-renderiza ao recarregar.
  mcp_shared: () => structuredClone(db.mcp ??= [
    { name: "docs", transport: "stdio", target: "npx -y docs-mcp", origins: [{ harness: "claude", scope: "project", source: ".mcp.json" }], conflict: false, shared: true, env_keys: [], weight: null },
    { name: "linear", transport: "http", target: "https://mcp.linear.app/mcp", origins: [{ harness: "claude", scope: "user", source: "~/.claude.json" }, { harness: "codex", scope: "user", source: "~/.codex/config.toml" }], conflict: false, shared: true, env_keys: ["Authorization"], weight: { tools: 24, tokens: 3200 } },
  ]),
  mcp_weigh: ({ name }) => { const m = db.mcp!.find((x: any) => x.name === name); m.weight = { tools: 6, tokens: 900 }; return m.weight; },
  mcp_set_shared: ({ name, on }) => void (db.mcp!.find((x: any) => x.name === name).shared = on),
  mcp_export_agy: () => "~/.gemini/config/mcp_config.json.bak-kabul-1",
  linear_status: () => ({ connected: db.linear, who: db.linear ? "Dev · Acme" : null, error: null }),
  linear_connect: ({ key }) => { if (!String(key).startsWith("lin_api_")) throw new Error("Linear: chave inválida"); db.linear = true; return "Dev · Acme"; },
  linear_disconnect: () => void (db.linear = false),
  linear_issues: ({ search }) => [{ id: "i1", identifier: "ENG-12", title: "Corrigir login no Safari", url: "https://linear.app/acme/issue/ENG-12", description: "O botão de login some no Safari 18.", state: "Todo", branchName: "dev/eng-12-corrigir-login-no-safari", priority: "High", assignee: "Dev", team: "ENG" }, { id: "i2", identifier: "ENG-15", title: "Exportar relatório em PDF", url: "https://linear.app/acme/issue/ENG-15", description: null, state: "In Progress", branchName: "dev/eng-15-exportar-relatorio", priority: "Medium", assignee: "Dev", team: "ENG" }].filter((i) => !search || (i.identifier + i.title).toLowerCase().includes(String(search).toLowerCase())),
  workspace_from_issue: ({ repoId, issue }) => { const w: any = handlers.workspace_create({ repoId }); Object.assign(w, { branch: issue.branchName, title: `${issue.identifier} ${issue.title}`, linear: { identifier: issue.identifier, title: issue.title, url: issue.url }, user_set_branch: true }); return w; },
  open_targets: () => [
    { id: "finder", name: "Finder", kind: "finder", app: "/System/Library/CoreServices/Finder.app", icon: null },
    { id: "vscode", name: "VS Code", kind: "editor", app: "/Applications/Visual Studio Code.app", icon: null },
    { id: "terminal", name: "Terminal", kind: "terminal", app: "/System/Applications/Utilities/Terminal.app", icon: null },
  ],
  open_in: ({ target, path }) => void ((window as any).__opened = `${target}:${path}`),
  pr_checks: () => (db as any).checks ?? ({ checks: [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://github.com/dev/demo/actions/runs/101/job/1", workflow: "CI", required: true }, { name: "e2e", state: "IN_PROGRESS", bucket: "pending", link: "https://github.com/dev/demo/actions/runs/101/job/2", workflow: "CI", required: true }, { name: "lint", state: "FAILURE", bucket: "fail", link: "https://github.com/dev/demo/actions/runs/102/job/3", workflow: "CI", required: true }], message: null }),
  open_external: ({ target }) => void ((window as any).__external = target),
  transcribe: () => "texto ditado de teste",
  // Escala (docs/escala.md): estado da fila, parar em lote, foco e configuração do limite.
  agents_status: () => ({ limit: agentLimit(), running: running.size, queued: waitingSlot.map((w, i) => ({ chat_id: w.chatId, position: i + 1, workspace_id: null })), running_chats: [...running], suspended: [], focus: (db as any).focus ?? null, idle_minutes: null }),
  agents_config: ({ limit }) => (limit !== undefined && ((window as any).__mock.agentLimit = limit), handlers.agents_status({})),
  agents_focus: ({ workspaceId }) => void ((db as any).focus = workspaceId),
  chats_interrupt: ({ chatIds }) => { const ids = chatIds as string[]; ids.forEach((c) => handlers.chat_interrupt({ chatId: c })); ((window as any).__mock.batchStopped ??= []).push(...ids); return { stopped: ids, errors: [] }; },
};

// Ganchos para os testes montarem estados de git/PR sem backend.
if (typeof window !== "undefined") (window as any).__mock = {
  db,
  pr: (wid: string | null, p: any) => { const w = wid ?? db.workspaces[0]?.id; db.pr[w] = p && { number: 7, title: "Corrige login", body: "Descrição do PR", url: "https://github.com/dev/demo/pull/7", state: "OPEN", is_draft: false, mergeable: "MERGEABLE", merge_state: "CLEAN", review_decision: "", head: ws(w)?.branch, base: "main", comments: [], ...p }; },
  git: (wid: string | null, g: any) => { const w = wid ?? db.workspaces[0]?.id; db.git[w] = { ...(db.git[w] ?? {}), ...g }; },
  emit: (channel: string, payload: unknown) => emit(channel, payload),
  change: (wid: string | null, path: string, body: string) => { const w = wid ?? db.workspaces[0]?.id; (db.changed[w] ??= {})[path] = body; },
};

// Ambiente de demonstração (`?mock&demo`, só no Vite dev): repos, workspaces, conversas e uso 100% fictícios
// para as capturas do README e do site (apps/web/demo/, `npm run demo:capture`). Fica fora do build de produção.
const demoReady: Promise<unknown> | null =
  import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("demo")
    ? import("../../demo/scenario").then((m) => m.install({ db, handlers, emit, models, usage }), (e) => console.error("demo:", e))
    : null;

/**
 * Cenário de escala (`window.__kabulSeed`, usado por `npm run perf`): N repositórios, M workspaces prontos e,
 * opcionalmente, uma conversa salva com `longChat` mensagens (metade sua, metade do agente) no workspace 0.
 */
function seedScale(seed: { repos?: number; workspaces?: number; longChat?: number; agentHistory?: number; agents?: number }) {
  const R = seed.repos ?? 5, W = seed.workspaces ?? 100;
  const st = ["in-progress", "in-review", "backlog", "done"];
  for (let r = 0; r < R; r++) db.repos.push({ id: `r${r}`, name: `projeto-${r + 1}`, path: `/mock/repos/projeto-${r + 1}`, default_branch: "main" });
  for (let i = 0; i < W; i++) {
    const name = `cidade-${i}`;
    db.workspaces.push({ id: `w${i}`, repo_id: `r${i % R}`, name, branch: `dev/${name}`, path: `/mock/ws/${name}`, archived: false, created_at: now() - i * 60, title: `Tarefa ${i}`, status: st[i % st.length], state: "ready", pinned: false, notes: "", port: 42000 + i * 10, target_branch: null, pr_url: null, archive_checkpoint: null, user_set_branch: false, files_copied: 0 });
    db.changed[`w${i}`] = i % 3 ? {} : { [`src/m${i}.ts`]: "export const x = 1;\n" };
  }
  const conv = (n: number) => {
  const items: any[] = [];
  for (let k = 0; k < n / 2; k++) {
    items.push({ k: "user", text: `Pergunta ${k}: ajuste o componente ${k % 40} e explique o que mudou` });
    if (k % 3 === 0) items.push({ k: "tool", id: `h${k}`, name: "Bash", input: { command: `rg -n comp${k % 40} src`, description: "Procura" }, output: `src/c${k % 40}.tsx:10: export function Comp${k % 40}()` });
    const code = k % 5 === 0 ? `\n\n\`\`\`ts\nexport function comp${k}(x: number) {\n  return x * ${k} + 1;\n}\n\`\`\`` : "";
    items.push({ k: "assistant", text: `Feito: o **componente ${k % 40}** agora valida a entrada antes de salvar. Mudei \`src/c${k % 40}.tsx\` e o teste correspondente; o resto do fluxo continua igual.${code}`, streaming: false });
    items.push({ k: "turn", meta: `${(k % 50) + 3}s · 10:${String(k % 60).padStart(2, "0")}`, copy: "Feito." });
  }
  return items;
  };
  // Conversas já com histórico nos workspaces dos agentes (sessões longas, como no uso real).
  for (let i = 1; i <= (seed.agents ?? 0); i++) if (seed.agentHistory) db.history[`chat-w${i}`] = { id: `chat-w${i}`, workspace_id: `w${i}`, title: `Sessão ${i}`, model_key: "claude:opus", agent_session: null, updated_at: now(), items: conv(seed.agentHistory) };
  if (seed.longChat) db.history["chat-longa"] = { id: "chat-longa", workspace_id: "w0", title: "Conversa longa", model_key: "claude:opus", agent_session: null, updated_at: now(), items: conv(seed.longChat) };
}
if (typeof window !== "undefined" && (window as any).__kabulSeed) seedScale((window as any).__kabulSeed);

export const mockTransport: Transport = {
  async call<T>(command: string, args?: Record<string, unknown>) {
    ((window as any).__calls ??= []).push(command);
    if (demoReady) await demoReady;
    if (command === "checkpoint_create" && (window as any).__mock?.holdModels === true) ((window as any).__mock.holdModels = false, (window as any).__mock.releaseModels?.());
    const h = handlers[command];
    if (!h) throw new Error(`mock: comando desconhecido ${command}`);
    await new Promise((r) => setTimeout(r, 15));
    return (await h(args ?? {})) as T;
  },
  subscribe(channel, handler) {
    // Contagem de inscrições por canal: o E2E confere que a aba não se reinscreve a cada render.
    const n = ((window as any).__subs ??= {} as Record<string, number>);
    n[channel] = (n[channel] ?? 0) + 1;
    const s = subs.get(channel) ?? new Set();
    // `__mock.slowListen`: registra como o Tauri (listen por IPC, assíncrono); evento emitido antes disso se perde.
    if ((window as any).__mock?.slowListen) {
      let dead = false;
      setTimeout(() => void (!dead && s.add(handler as H)), 20);
      subs.set(channel, s);
      return () => ((dead = true), s.delete(handler as H));
    }
    s.add(handler as H);
    subs.set(channel, s);
    return () => s.delete(handler as H);
  },
};
