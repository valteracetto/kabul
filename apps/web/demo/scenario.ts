/* i18n-ignore-file: dados fictícios da demonstração (em inglês, como o README). */
/**
 * Ambiente de demonstração para as capturas do README e do site (`?mock&demo`, só no Vite dev).
 *
 * Tudo aqui é inventado: a empresa "Acme", os repositórios acme-web, acme-api e mobile-app, a usuária
 * "Sam Rivera" (sam@acme.dev), a colega "Maya Chen" e os números de uso. Nenhum dado de máquina, conta,
 * token ou caminho real. O cenário instala dados no backend de mentira (src/transport/mock.ts) e troca o
 * agente falso por roteiros em inglês (passos de ferramenta, subagentes, aprovação, troca de modelo).
 *
 * Usado por `npm run demo:capture` (demo/capture.spec.ts). Para ver no navegador: `npx vite` e abrir
 * http://localhost:5173/?mock&demo (celular: /m/?mock&demo; barra do Kabul: /?mock&demo&view=tray).
 */
import { installMobile } from "./mobile";

type Ctx = { db: any; handlers: Record<string, (a: any) => unknown>; emit: (ch: string, p: unknown) => void; models: any[]; usage: { turns: any[]; seeded: boolean; limits: any[] | null } };

const now = () => Math.floor(Date.now() / 1000);
const H = 3600, D = 86400;
export const ME = { name: "Sam Rivera", login: "sam", email: "sam@acme.dev" };
export const HOME = "/Users/sam";

// ---------------------------------------------------------------- repositórios e workspaces

export const REPOS = [
  { id: "r-web", name: "acme-web", path: `${HOME}/code/acme-web`, default_branch: "main" },
  { id: "r-api", name: "acme-api", path: `${HOME}/code/acme-api`, default_branch: "main" },
  { id: "r-mobile", name: "mobile-app", path: `${HOME}/code/mobile-app`, default_branch: "main" },
];

type WsSeed = { id: string; repo: string; name: string; title: string; branch: string; status: string; ago: number; pr?: number; pinned?: boolean };
export const WS: WsSeed[] = [
  { id: "w-dark", repo: "r-web", name: "lisbon", title: "Dark mode for the dashboard", branch: "sam/dark-mode-dashboard", status: "in-progress", ago: 2 * H },
  { id: "w-router", repo: "r-web", name: "kyoto", title: "Migrate to React Router 7", branch: "sam/react-router-7", status: "in-progress", ago: 5 * H },
  { id: "w-safari", repo: "r-web", name: "oslo", title: "Fix checkout on Safari 18", branch: "sam/safari-checkout", status: "in-review", ago: 1 * D, pr: 482 },
  { id: "w-flaky", repo: "r-web", name: "porto", title: "Flaky cart totals test", branch: "sam/flaky-cart-totals", status: "in-review", ago: 3 * H, pr: 486 },
  { id: "w-rate", repo: "r-api", name: "quito", title: "Rate limiting for /v2", branch: "sam/rate-limit-v2", status: "in-progress", ago: 4 * H },
  { id: "w-otel", repo: "r-api", name: "nairobi", title: "OpenTelemetry tracing", branch: "sam/otel-tracing", status: "in-progress", ago: 6 * H },
  { id: "w-stripe", repo: "r-api", name: "cusco", title: "Retry Stripe webhooks", branch: "sam/stripe-webhook-retries", status: "done", ago: 2 * D, pr: 311 },
  { id: "w-sync", repo: "r-mobile", name: "hanoi", title: "Offline sync queue", branch: "sam/offline-sync-queue", status: "in-progress", ago: 1 * H },
  { id: "w-passkeys", repo: "r-web", name: "denver", title: "Sign in with passkeys", branch: "sam/passkeys", status: "backlog", ago: 4 * D },
  { id: "w-invoices", repo: "r-api", name: "lagos", title: "CSV export for invoices", branch: "sam/invoice-csv", status: "backlog", ago: 5 * D },
  { id: "w-a11y", repo: "r-mobile", name: "seoul", title: "Accessibility labels in the feed", branch: "sam/feed-a11y", status: "in-review", ago: 1 * D, pr: 97 },
  { id: "w-push", repo: "r-mobile", name: "zurich", title: "Push notification settings", branch: "sam/push-settings", status: "in-progress", ago: 3 * D },
];
const repoName = (rid: string) => REPOS.find((r) => r.id === rid)!.name;
const prUrl = (w: WsSeed) => (w.pr ? `https://github.com/acme/${repoName(w.repo)}/pull/${w.pr}` : null);

// ---------------------------------------------------------------- arquivos (base e mudanças por workspace)

const FILES: Record<string, string> = {
  "src/theme/tokens.ts": `export const tokens = {
  bg: "#ffffff",
  surface: "#f6f7f9",
  text: "#111827",
  muted: "#6b7280",
  accent: "#4f46e5",
  border: "#e5e7eb",
};

export type Token = keyof typeof tokens;
`,
  "src/components/Header.tsx": `import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

export function Header() {
  return (
    <header className="header">
      <Logo />
      <nav className="header-nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/reports">Reports</a>
      </nav>
      <UserMenu />
    </header>
  );
}
`,
  "src/styles/global.css": `:root {
  --bg: #ffffff;
  --text: #111827;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, sans-serif;
}
`,
  "README.md": "# acme-web\n\nThe Acme customer dashboard.\n",
  "package.json": '{\n  "name": "acme-web",\n  "private": true\n}\n',
  "src/routes/index.tsx": "export const routes = [];\n",
  "src/middleware/rateLimit.ts": "",
  "src/sync/queue.ts": "",
};

const CHANGED: Record<string, Record<string, string>> = {
  "w-dark": {
    "src/theme/tokens.ts": `export const light = {
  bg: "#ffffff",
  surface: "#f6f7f9",
  text: "#111827",
  muted: "#6b7280",
  accent: "#4f46e5",
  border: "#e5e7eb",
};

export const dark: typeof light = {
  bg: "#0b0d12",
  surface: "#151821",
  text: "#e5e7eb",
  muted: "#9ca3af",
  accent: "#818cf8",
  border: "#262a35",
};

export type Token = keyof typeof light;
export const tokens = { light, dark };
`,
    "src/theme/useColorScheme.ts": `import { useEffect, useState } from "react";

export type Scheme = "light" | "dark" | "system";
const KEY = "acme.color-scheme";

/** The user's choice, falling back to the system setting. */
export function useColorScheme() {
  const [scheme, setScheme] = useState<Scheme>(() => (localStorage.getItem(KEY) as Scheme) ?? "system");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = scheme === "dark" || (scheme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    localStorage.setItem(KEY, scheme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [scheme]);
  return [scheme, setScheme] as const;
}
`,
    "src/components/Header.tsx": `import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";
import { ThemeToggle } from "./ThemeToggle";
import { useColorScheme } from "../theme/useColorScheme";

export function Header() {
  const [scheme, setScheme] = useColorScheme();
  return (
    <header className="header">
      <Logo />
      <nav className="header-nav">
        <a href="/dashboard">Dashboard</a>
        <a href="/reports">Reports</a>
      </nav>
      <ThemeToggle value={scheme} onChange={setScheme} />
      <UserMenu />
    </header>
  );
}
`,
    "src/styles/global.css": `:root {
  --bg: #ffffff;
  --text: #111827;
}

:root[data-theme="dark"] {
  --bg: #0b0d12;
  --text: #e5e7eb;
  color-scheme: dark;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: Inter, system-ui, sans-serif;
}
`,
  },
  "w-router": { "src/routes/index.tsx": 'import { createBrowserRouter } from "react-router";\nimport { Dashboard, dashboardLoader } from "./dashboard";\n\nexport const router = createBrowserRouter([\n  { path: "/", Component: Dashboard, loader: dashboardLoader },\n]);\n' },
  "w-safari": { "src/checkout/PayButton.tsx": "export function PayButton() {\n  return <button type=\"submit\">Pay</button>;\n}\n" },
  "w-flaky": { "e2e/cart.spec.ts": "test(\"cart totals\", async ({ page }) => {\n  await page.goto(\"/cart\");\n  await expect(page.getByTestId(\"total\")).toHaveText(\"$42.00\");\n});\n" },
  "w-rate": { "src/middleware/rateLimit.ts": "import { RateLimiterRedis } from \"rate-limiter-flexible\";\n\nexport const limiter = new RateLimiterRedis({ points: 120, duration: 60 });\n" },
  "w-otel": { "src/telemetry.ts": "import { NodeSDK } from \"@opentelemetry/sdk-node\";\n\nexport const sdk = new NodeSDK({ serviceName: \"acme-api\" });\n" },
  "w-sync": { "src/sync/queue.ts": "export class SyncQueue {\n  private items: Job[] = [];\n  push(job: Job) {\n    this.items.push(job);\n  }\n}\n" },
};

/** Diff unificado de verdade (LCS por linha): o do mock alinha por índice e fica feio numa captura. */
function lcsDiff(a: string[], b: string[]) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) (out.push(" " + a[i]), i++, j++);
    else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) (out.push("-" + a[i]), i++);
    else (out.push("+" + b[j]), j++);
  }
  return out;
}
const lines = (s: string) => (s ? s.replace(/\n$/, "").split("\n") : []);

// ---------------------------------------------------------------- conversas salvas

let tid = 0;
const tool = (name: string, input: unknown, output = "ok", extra: object = {}) => ({ k: "tool", id: `h${++tid}`, name, input, output, ...extra });
const user = (text: string) => ({ k: "user", text });
const say = (text: string) => ({ k: "assistant", text, streaming: false });
const turn = (meta: string, copy = "") => ({ k: "turn", meta, copy });

const HISTORY: Record<string, { title: string; model: string; items: any[] }> = {
  "w-dark": {
    title: "Add a dark mode to the dashboard",
    model: "claude:opus",
    items: [
      user("Add a dark mode to the dashboard. Use our design tokens, follow the system setting by default and add a toggle in the header."),
      { k: "reasoning", text: "The tokens live in src/theme/tokens.ts and the CSS reads them through custom properties. I'll split light/dark, add a hook for the choice and wire a toggle into Header." },
      tool("Read", { file_path: "src/theme/tokens.ts" }, FILES["src/theme/tokens.ts"]),
      tool("Grep", { pattern: "var\\(--", path: "src", output_mode: "files_with_matches" }, "src/styles/global.css\nsrc/components/Card.css\nsrc/components/Chart.css"),
      tool("TodoWrite", { todos: [{ content: "Split tokens into light and dark", status: "completed" }, { content: "useColorScheme hook (system by default)", status: "completed" }, { content: "Theme toggle in the header", status: "completed" }, { content: "Run unit tests", status: "completed" }] }),
      tool("Edit", { file_path: "src/theme/tokens.ts", old_string: "export const tokens = {", new_string: "export const light = {" }),
      tool("Write", { file_path: "src/theme/useColorScheme.ts", content: CHANGED["w-dark"]["src/theme/useColorScheme.ts"] }),
      tool("Edit", { file_path: "src/components/Header.tsx", old_string: "      <UserMenu />", new_string: "      <ThemeToggle value={scheme} onChange={setScheme} />\n      <UserMenu />" }),
      tool("Bash", { command: "npm test -- --run theme", description: "Run the theme tests" }, " ✓ src/theme/useColorScheme.test.ts (4 tests) 38ms\n ✓ src/components/Header.test.tsx (3 tests) 61ms\n\n Test Files  2 passed (2)\n      Tests  7 passed (7)"),
      say("Dark mode is in. Here's what changed:\n\n| File | Change |\n|---|---|\n| `src/theme/tokens.ts` | `light` and `dark` palettes from the same tokens |\n| `src/theme/useColorScheme.ts` | new hook: **system** by default, remembers the choice |\n| `src/components/Header.tsx` | theme toggle next to the user menu |\n| `src/styles/global.css` | `[data-theme=\"dark\"]` overrides |\n\nAll **7 tests** pass. Contrast for body text is 13.4:1 in dark mode."),
      turn("1m, 48s · 10:12","Dark mode is in."),
    ],
  },
  "w-router": {
    title: "Migrate to React Router 7",
    model: "codex:gpt-6-luna",
    items: [
      user("Migrate the app from React Router 6 to 7 with data loaders. Keep the URLs exactly the same."),
      tool("Bash", { command: "rg -l \"useNavigate|<Route\" src | wc -l", description: "Count route files" }, "23"),
      tool("Read", { file_path: "src/routes/index.tsx" }),
      say("23 files use the old API. I'll move the route table to `createBrowserRouter` first, then convert pages to loaders one by one."),
      turn("52s · 09:41"),
    ],
  },
  "w-safari": {
    title: "Fix checkout on Safari 18",
    model: "claude:opus",
    items: [
      user("Checkout's Pay button does nothing on Safari 18. Find out why and fix it."),
      tool("Grep", { pattern: "requestSubmit", path: "src/checkout" }, "src/checkout/Form.tsx:41:    form.requestSubmit(button);"),
      say("Safari 18 throws when `requestSubmit` gets a button outside the form. I moved the Pay button inside the `<form>` and added a regression test."),
      turn("2m, 5s · 16:38"),
    ],
  },
  "w-flaky": {
    title: "Flaky cart totals test",
    model: "agy:gemini-4-argon",
    items: [
      user("The cart totals e2e test fails about 1 in 10 runs on CI. Find the root cause."),
      tool("Bash", { command: "npx playwright test e2e/cart.spec.ts --repeat-each 20", description: "Reproduce the flake" }, "  18 passed\n  2 failed\n    e2e/cart.spec.ts:12 › cart totals — Expected \"$42.00\", received \"$38.00\""),
      tool("Read", { file_path: "src/cart/useTotals.ts" }),
      say("Reproduced: **2 of 20** runs fail. The total is read before the shipping estimate resolves, so the test sees the subtotal. The race is in `useTotals`, which renders a total while `shipping` is still `undefined`."),
      turn("3m, 12s · 11:02"),
      { k: "handoff", text: "Switched to GPT-6-Luna · Codex" },
      user("Codex, write the fix and keep the change small."),
      tool("Edit", { file_path: "src/cart/useTotals.ts", old_string: "const total = subtotal + (shipping ?? 0);", new_string: "if (shipping === undefined) return { status: \"loading\" } as const;\nconst total = subtotal + shipping;" }),
      tool("Bash", { command: "npx playwright test e2e/cart.spec.ts --repeat-each 50", description: "Run the test 50 times" }, "  50 passed (41.8s)"),
      say("Fixed in `useTotals`: no total until shipping is known, and the cart shows a skeleton meanwhile. **50/50** runs pass."),
      turn("1m, 37s · 11:09"),
      { k: "handoff", text: "Switched to Gemini 4 Argon · Antigravity" },
      user("Gemini, review the diff before I open the PR."),
      tool("Bash", { command: "git diff main --stat", description: "Summarize the branch" }, " src/cart/useTotals.ts      | 6 ++++--\n src/cart/CartTotal.tsx     | 4 +++-\n e2e/cart.spec.ts           | 2 +-\n 3 files changed, 8 insertions(+), 4 deletions(-)"),
      say("Looks good. One suggestion: `CartTotal` should keep the old total visible while reloading to avoid layout shift. Otherwise ready for review. ✅"),
      turn("48s · 11:12"),
    ],
  },
  "w-rate": {
    title: "Rate limiting for /v2",
    model: "codex:gpt-6-luna",
    items: [
      user("Add per-key rate limiting to the /v2 endpoints: 120 requests per minute, backed by Redis, with the standard RateLimit headers."),
      tool("Read", { file_path: "src/server.ts" }),
      tool("Write", { file_path: "src/middleware/rateLimit.ts", content: "…" }),
      say("Middleware is ready. Before wiring it in I need to run the migration that adds `api_keys.rate_limit`."),
      turn("1m, 2s · 10:30"),
    ],
  },
  "w-otel": {
    title: "OpenTelemetry tracing",
    model: "agy:gemini-4-argon",
    items: [user("Instrument the API with OpenTelemetry: HTTP, Postgres and Redis spans, exported over OTLP."), say("Starting with the SDK bootstrap in `src/telemetry.ts`."), turn("31s · 09:15")],
  },
  "w-stripe": {
    title: "Retry Stripe webhooks",
    model: "claude:opus",
    items: [user("Make the Stripe webhook handler idempotent and retry failed deliveries with backoff."), say("Done and merged in #311."), turn("4m, 10s · 15:20")],
  },
  "w-sync": {
    title: "Offline sync queue",
    model: "claude:opus",
    items: [user("Build an offline queue for writes: persist to SQLite, replay in order when back online, and resolve conflicts last-write-wins."), say("I'll split this into storage, replay and conflict handling, and run them as parallel subagents."), turn("44s · 11:20")],
  },
};

// ---------------------------------------------------------------- roteiros do agente (eventos ao vivo)

type Step = [number, any];
const BG_STEPS: Record<string, { tools: [string, any, string][]; tasks: string[]; text: string }> = {
  "w-router": {
    tools: [["Read", { file_path: "src/pages/Dashboard.tsx" }, "export default function Dashboard() { … }"], ["Edit", { file_path: "src/pages/Dashboard.tsx", old_string: "useEffect(load, [])", new_string: "useLoaderData()" }, "ok"], ["Bash", { command: "npm run typecheck", description: "Typecheck" }, "Found 0 errors."], ["Read", { file_path: "src/pages/Reports.tsx" }, "…"]],
    tasks: ["Convert /reports to a loader", "Convert /settings to a loader"],
    text: "Converting the next route to a data loader…",
  },
  "w-otel": {
    tools: [["Read", { file_path: "src/db/pool.ts" }, "export const pool = new Pool(config);"], ["Edit", { file_path: "src/telemetry.ts", old_string: "instrumentations: []", new_string: "instrumentations: [new HttpInstrumentation(), new PgInstrumentation(), new IORedisInstrumentation()]" }, "ok"], ["Bash", { command: "npm run dev:otel", description: "Start with a local collector" }, "otel-collector: 42 spans received"]],
    tasks: ["Trace the Postgres pool", "Check span names against the conventions"],
    text: "Wiring the Postgres and Redis instrumentations…",
  },
  "w-sync": {
    tools: [["Read", { file_path: "src/sync/queue.ts" }, "export class SyncQueue { … }"], ["Bash", { command: "npm test -- sync", description: "Run the sync tests" }, "✓ 12 passed"], ["Edit", { file_path: "src/sync/replay.ts", old_string: "for (const job of jobs)", new_string: "for (const job of jobs.sort(byCreatedAt))" }, "ok"]],
    tasks: ["SQLite storage for queued writes", "Replay in order when online", "Last-write-wins conflict resolution"],
    text: "Three subagents are working on storage, replay and conflicts…",
  },
  "w-push": {
    tools: [["Read", { file_path: "app/settings/notifications.tsx" }, "…"], ["Edit", { file_path: "app/settings/notifications.tsx", old_string: "<Switch />", new_string: "<Switch value={prefs.mentions} onValueChange={setMentions} />" }, "ok"], ["Bash", { command: "npx expo-doctor", description: "Check the Expo project" }, "✔ 17/17 checks passed"]],
    tasks: ["Per-channel notification toggles"],
    text: "Building the notification settings screen…",
  },
  "w-dark": {
    tools: [["Read", { file_path: "src/components/Chart.tsx" }, "…"], ["Bash", { command: "npm test -- --run chart", description: "Chart tests" }, "✓ 5 passed"]],
    tasks: ["Audit chart colors for contrast"],
    text: "Updating the chart palette…",
  },
};

const SUB_TOOLS: [string, any][] = [["Read", { file_path: "src/sync/db.ts" }], ["Grep", { pattern: "INSERT INTO", path: "src" }], ["Bash", { command: "npm test -- storage", description: "Tests" }], ["Read", { file_path: "src/sync/replay.ts" }], ["Edit", { file_path: "src/sync/conflicts.ts", old_string: "a", new_string: "b" }]];

export function install(ctx: Ctx) {
  const { db, handlers, emit, models, usage } = ctx;
  const t0 = now();
  // Comportamento do agente por workspace (o spec pode trocar): "background" trabalha sem parar, "approval" pede
  // permissão; os outros seguem o roteiro do vídeo.
  (window as any).__demo = { ctx, mode: { "w-push": "background", "w-router": "background", "w-otel": "background", "w-sync": "background", "w-rate": "approval", "w-dark": "approval" }, ...(window as any).__demo };

  // ---------------------------------------------------------------- dados
  db.repos.push(...REPOS.map((r) => ({ ...r })));
  for (const w of WS) {
    db.workspaces.push({ id: w.id, repo_id: w.repo, name: w.name, branch: w.branch, path: `${HOME}/kabul/workspaces/${repoName(w.repo)}/${w.name}`, archived: false, created_at: t0 - w.ago, title: w.title, status: w.status, state: "ready", pinned: !!w.pinned, notes: "", port: 4100 + db.workspaces.length * 10, target_branch: null, pr_url: prUrl(w), archive_checkpoint: null, user_set_branch: true, files_copied: 2 });
    db.changed[w.id] = { ...(CHANGED[w.id] ?? {}) };
    if (w.pr) db.pr[w.id] = { number: w.pr, title: w.title, body: "", url: prUrl(w), state: w.status === "done" ? "MERGED" : "OPEN", is_draft: false, mergeable: "MERGEABLE", merge_state: "CLEAN", review_decision: w.id === "w-safari" ? "APPROVED" : "REVIEW_REQUIRED", head: w.branch, base: "main", comments: [] };
    db.git[w.id] = { upstream: w.pr ? "origin/" + w.branch : null, ahead: w.pr ? 0 : 2 };
  }
  Object.assign(db.files, FILES);
  delete db.files["main.rs"];
  db.files["README.md"] = FILES["README.md"];
  for (const [wid, h] of Object.entries(HISTORY)) {
    const hid = `chat-${wid}`;
    db.history[hid] = { id: hid, workspace_id: wid, title: h.title, model_key: h.model, agent_session: null, updated_at: t0 - 600, items: h.items };
  }
  db.comments.push({ id: "c-1", workspace_id: "w-dark", path: "src/theme/tokens.ts", line: 13, end_line: null, body: "Can we reuse the brand indigo here instead of a new accent?", resolved: false, created_at: t0 - 900 });
  db.ghAccounts = [{ host: "github.com", login: ME.login, active: true, scopes: ["repo", "workflow", "read:org"], source: "keyring", ok: true }];
  db.settings.clone_dir = "~/code";
  db.accounts.push({ id: "claude:work", provider: "claude", nickname: "Work", email: "sam@acme.dev", plan: "max", dir: `${HOME}/.kabul/accounts/claude-work`, default: false, logged_in: true, env_var: "CLAUDE_CONFIG_DIR", env_confirmed: true });

  // Modelos: Claude Code, Codex, Antigravity, Gemini CLI, Qwen Code e um local.
  models.splice(0, models.length,
    { key: "claude:opus", harness: "claude", id: "opus", label: "Opus 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "xhigh", "max"], effort_in_id: false, local: null, context: 1000000 },
    { key: "claude:sonnet", harness: "claude", id: "sonnet", label: "Sonnet 5", provider: "anthropic", efforts: ["low", "medium", "high"], effort_in_id: false, local: null, context: 1000000 },
    { key: "codex:gpt-6-luna", harness: "codex", id: "gpt-6-luna", label: "GPT-6-Luna", provider: "openai", efforts: ["low", "medium", "high"], effort_in_id: false, local: null, context: 272000 },
    { key: "codex:gpt-6-luna-mini", harness: "codex", id: "gpt-6-luna-mini", label: "GPT-6-Luna mini", provider: "openai", efforts: ["low", "medium", "high"], effort_in_id: false, local: null, context: 272000 },
    { key: "agy:gemini-4-argon", harness: "antigravity", id: "gemini-4-argon", label: "Gemini 4 Argon", provider: "google", efforts: ["low", "medium", "high"], effort_in_id: true, local: null, context: 1000000 },
    { key: "local:lmstudio:qwen3-coder-30b", harness: "opencode", id: "qwen3-coder-30b", label: "Qwen3 Coder 30B", provider: "local", efforts: [], effort_in_id: false, context: 131072, local: { source: "lmstudio", source_name: "LM Studio", model: "qwen3-coder-30b", family: "Qwen", note: "qwen → Qwen Code", missing: [], size_bytes: 17_200_000_000, quant: "4bit", fits: true } },
  );

  // ---------------------------------------------------------------- respostas em inglês no lugar das do mock (pt-BR)
  const orig = { ...handlers };
  handlers.machine_info = () => ({ name: "Sam's MacBook Pro", user: { login: ME.login, email: ME.email, avatar: null } });
  handlers.git_identity = () => ({ name: ME.name, email: ME.email, scope: "global", global_name: ME.name, global_email: ME.email });
  handlers.workspace_files = () => Object.keys(db.files).filter((p) => db.files[p]).concat(["src/components/Chart.tsx", "src/components/ThemeToggle.tsx", "src/pages/Dashboard.tsx", ".gitignore", "tsconfig.json", "vite.config.ts"]);
  handlers.workspace_changes = ({ workspaceId }) => Object.entries(db.changed[workspaceId] ?? {}).map(([path, body]) => {
    const d = lcsDiff(lines(db.files[path] ?? ""), lines(body as string));
    return { path, added: d.filter((l) => l[0] === "+").length, removed: d.filter((l) => l[0] === "-").length, untracked: !db.files[path] };
  });
  handlers.workspaces_stats = () => Object.fromEntries(db.workspaces.map((w: any) => [w.id, (handlers.workspace_changes({ workspaceId: w.id }) as any[]).reduce((a, c) => [a[0] + c.added, a[1] + c.removed], [0, 0])]));
  handlers.workspace_file_diff = ({ workspaceId, path }) => {
    const a = lines(db.files[path] ?? ""), b = lines(db.changed[workspaceId]?.[path] ?? "");
    return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`, ...lcsDiff(a, b)].join("\n");
  };
  handlers.pr_checks = () => ({ checks: [
    { name: "build", state: "SUCCESS", bucket: "pass", link: "https://github.com/acme/acme-web/actions/runs/9001/job/1", workflow: "CI", required: true },
    { name: "unit", state: "SUCCESS", bucket: "pass", link: "https://github.com/acme/acme-web/actions/runs/9001/job/2", workflow: "CI", required: true },
    { name: "e2e (chromium)", state: "SUCCESS", bucket: "pass", link: "https://github.com/acme/acme-web/actions/runs/9001/job/3", workflow: "CI", required: true },
    { name: "e2e (webkit)", state: "SUCCESS", bucket: "pass", link: "https://github.com/acme/acme-web/actions/runs/9001/job/4", workflow: "CI", required: true },
    { name: "Vercel preview", state: "SUCCESS", bucket: "pass", link: "https://vercel.com/acme/acme-web", workflow: "", required: false },
  ], message: null });
  handlers.workspace_pr = ({ workspaceId, options }) => {
    const w = db.workspaces.find((x: any) => x.id === workspaceId);
    const r = REPOS.find((x) => x.id === w.repo_id)!;
    const number = 490;
    const url = `https://github.com/acme/${r.name}/pull/${number}`;
    w.pr_url = url;
    w.status = "in-review";
    db.pr[workspaceId] = { number, title: options.title, body: options.body ?? "", url, state: "OPEN", is_draft: !!options.draft, mergeable: "MERGEABLE", merge_state: "CLEAN", review_decision: "REVIEW_REQUIRED", head: w.branch, base: "main", comments: [] };
    db.git[workspaceId] = { ...(db.git[workspaceId] ?? {}), upstream: "origin/" + w.branch, ahead: 0 };
    return { url, dry_run: false, commands: ["git push -u origin HEAD", `gh pr create --base main --title '${options.title}'`] };
  };
  // Workspace novo (vídeo): cidade e branch com o prefixo da Sam, sem os nomes do mock.
  const createWs = handlers.workspace_create;
  const CITIES = ["madrid", "austin", "bergen", "tbilisi", "valencia"];
  handlers.workspace_create = (a) => {
    const w: any = createWs(a);
    const name = CITIES.find((c) => !db.workspaces.some((x: any) => x.name === c)) ?? w.name;
    return Object.assign(w, { name, branch: `sam/${name}`, path: `${HOME}/kabul/workspaces/${repoName(w.repo_id)}/${name}` });
  };
  handlers.workspace_auto_branch = ({ workspaceId, text }) => {
    const w = db.workspaces.find((x: any) => x.id === workspaceId);
    if (w.user_set_branch || w.branch !== `sam/${w.name}`) return null;
    if (!w.title) w.title = String(text).replace(/^\w/, (c) => c.toUpperCase()).slice(0, 48);
    w.branch = "sam/" + String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean).slice(0, 5).join("-");
    return w;
  };
  handlers.repo_branches = () => ["main", "release/2026.10", "sam/dark-mode-dashboard"];
  handlers.repo_prs = () => [{ number: 486, title: "Flaky cart totals test", headRefName: "sam/flaky-cart-totals", author: { login: ME.login }, isDraft: false, url: "https://github.com/acme/acme-web/pull/486" }];
  handlers.term_open = ({ workspaceId, name }) => { const w = db.workspaces.find((x: any) => x.id === workspaceId); return { session: name ?? `kabul-${w.name}`, pane: "%1", snapshot: `sam@macbook ${w.name} % ` }; };
  handlers.slash_commands = () => [["/compact", "summarize the conversation"], ["/review", "review the changes"], ["/plan", "toggle plan mode"]];
  handlers.accounts_list = ({ provider }) => [{ id: `${provider}:sistema`, provider, nickname: "Personal", email: ME.email, plan: provider === "claude" ? "max" : "plus", dir: null, default: true, logged_in: true, env_var: "CLAUDE_CONFIG_DIR", env_confirmed: true }, ...db.accounts.filter((a: any) => a.provider === provider)];
  handlers.github_repo_access = ({ repoId }) => ({ slug: `acme/${repoName(repoId)}`, ok: true, permission: "WRITE", message: null });
  handlers.diagnostics = () => ({ checks: [], report: "", redacted: "" });
  handlers.external_sessions = () => ({ running: [], recent: [], cloud_note: "" });
  handlers.sessions_list = () => ({ tmux: [], imported_workspaces: [], imported_sessions: [], imported_error: null });
  handlers.linear_status = () => ({ connected: true, who: "Sam · Acme", error: null });
  handlers.linear_issues = () => [{ id: "i1", identifier: "WEB-218", title: "Dark mode for the dashboard", url: "https://linear.app/acme/issue/WEB-218", description: null, state: "In Progress", branchName: "sam/web-218-dark-mode", priority: "High", assignee: "Sam", team: "WEB" }];

  // MCP: seis servidores, de Claude Code e Codex, com o peso de cada um no contexto.
  db.mcp = [
    { name: "github", transport: "stdio", target: "npx -y @modelcontextprotocol/server-github", origins: [{ harness: "claude", scope: "user", source: "~/.claude.json" }, { harness: "codex", scope: "user", source: "~/.codex/config.toml" }], conflict: false, shared: true, env_keys: ["GITHUB_TOKEN"], weight: { tools: 38, tokens: 14200 } },
    { name: "linear", transport: "http", target: "https://mcp.linear.app/mcp", origins: [{ harness: "claude", scope: "user", source: "~/.claude.json" }], conflict: false, shared: true, env_keys: ["Authorization"], weight: { tools: 24, tokens: 6800 } },
    { name: "playwright", transport: "stdio", target: "npx -y @playwright/mcp", origins: [{ harness: "claude", scope: "project", source: ".mcp.json" }], conflict: false, shared: true, env_keys: [], weight: { tools: 21, tokens: 9400 } },
    { name: "sentry", transport: "http", target: "https://mcp.sentry.dev/mcp", origins: [{ harness: "codex", scope: "user", source: "~/.codex/config.toml" }], conflict: false, shared: true, env_keys: [], weight: { tools: 14, tokens: 5100 } },
    { name: "postgres", transport: "stdio", target: "npx -y @modelcontextprotocol/server-postgres", origins: [{ harness: "claude", scope: "project", source: ".mcp.json" }], conflict: false, shared: true, env_keys: ["DATABASE_URL"], weight: { tools: 6, tokens: 1900 } },
    { name: "figma", transport: "http", target: "https://mcp.figma.com/mcp", origins: [{ harness: "claude", scope: "user", source: "~/.claude.json" }], conflict: false, shared: false, env_keys: [], weight: { tools: 12, tokens: 4300 } },
  ];

  // ---------------------------------------------------------------- uso, custos e limites (30 dias)
  usage.seeded = true;
  usage.turns.length = 0;
  const wsIds = WS.map((w) => w.id);
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const mix: [string, string, string, number][] = [["claude", "claude", "Opus 5.5", 15], ["claude", "claude", "Sonnet 5", 3], ["codex", "codex", "GPT-6-Luna", 0], ["agy", "antigravity", "Gemini 4 Argon", 0], ["local", "opencode", "Qwen3 Coder 30B", 0]];
  for (let d = 29; d >= 0; d--) {
    const weekend = new Date((t0 - d * D) * 1000).getDay() % 6 === 0;
    const n = d === 0 ? 9 : weekend ? 3 + Math.floor(rand() * 4) : 10 + Math.floor(rand() * 14);
    for (let i = 0; i < n; i++) {
      const r = rand();
      const [provider, harness, model, price] = r < 0.55 ? mix[0] : r < 0.68 ? mix[1] : r < 0.86 ? mix[2] : r < 0.96 ? mix[3] : mix[4];
      const input = Math.round(20_000 + rand() * 90_000), output = Math.round(input / (12 + rand() * 10));
      const ws = wsIds[Math.floor(rand() * wsIds.length)];
      usage.turns.push({ at: t0 - d * D - Math.floor(rand() * (d === 0 ? 2.5 : 9) * H), provider, harness, model, account: provider === "claude" && rand() < 0.3 ? "claude:work" : `${provider}:sistema`, workspace_id: ws, session: `s-${ws}-${model}-${Math.floor(d / 2)}`, input, output, cache_read: input * 4, cache_write: Math.round(input / 3), cost_usd: price ? +(((input + output * 5) / 1e6) * price + input * 4 * price * 0.1 / 1e6).toFixed(4) : null, duration_ms: Math.round(30_000 + rand() * 240_000) });
    }
  }
  usage.limits = [
    { provider: "claude", account: "claude:sistema", account_label: ME.email, plan: "max", window: "5h", title: "Session (5 h)", used_pct: 64, window_mins: 300, resets_at: t0 + 2 * H + 1200, source: "claude-stream", updated_at: t0 },
    { provider: "claude", account: "claude:sistema", account_label: ME.email, plan: "max", window: "semana", title: "Week", used_pct: 41, window_mins: 10080, resets_at: t0 + 3 * D + 5 * H, source: "codexbar", updated_at: t0 },
    { provider: "claude", account: "claude:sistema", account_label: ME.email, plan: "max", window: "opus", title: "Week · Opus", used_pct: 83, window_mins: 10080, resets_at: t0 + 3 * D + 5 * H, source: "codexbar", updated_at: t0 },
    { provider: "codex", account: "codex:sistema", account_label: ME.email, plan: "plus", window: "5h", title: "Session (5 h)", used_pct: 22, window_mins: 300, resets_at: t0 + 4 * H, source: "codex-app-server", updated_at: t0 },
    { provider: "codex", account: "codex:sistema", account_label: ME.email, plan: "plus", window: "semana", title: "Week", used_pct: 57, window_mins: 10080, resets_at: t0 + 5 * D, source: "codex-app-server", updated_at: t0 },
  ];
  const ov = handlers.usage_overview;
  handlers.usage_overview = (a) => {
    const o: any = ov(a);
    const PL: Record<string, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity", local: "Local" };
    o.by_account = o.by_account.map((r: any) => ({ ...r, label: r.key === "claude:work" ? "Claude · Work" : `${PL[r.key.split(":")[0]] ?? r.key} · Personal` }));
    o.limits.status = [];
    o.limits.sources = [{ name: "Claude Code stream · Personal", ok: true, detail: "1 window" }, { name: "Codex app-server · Personal", ok: true, detail: "2 windows" }, { name: "CodexBar", ok: true, detail: "2 windows" }];
    o.alerts = o.alerts.map((x: any) => ({ ...x, text: x.text.replace(" em ", " at ") }));
    o.suggestions = o.suggestions.map((s: any) => ({ ...s, to_account: { id: "claude:work", nickname: "Work" }, to_provider: null, text: `Claude is close to the limit (${s.text.match(/\(([^)]*)\)/)?.[1] ?? ""}). Use the Work account in your chats.` }));
    return o;
  };
  db.settings.usage_alert_pct = 80;

  // Popover da barra do Kabul (`?view=tray`, janela sem conversas abertas): agentes rodando nos workspaces.
  if (new URLSearchParams(location.search).get("view") === "tray") {
    const run: [string, string, string, boolean][] = [["w-dark", "Opus 5.5", "claude", true], ["w-router", "GPT-6-Luna", "codex", true], ["w-otel", "Gemini 4 Argon", "agy", true], ["w-sync", "Opus 5.5", "claude", true], ["w-rate", "GPT-6-Luna", "codex", false], ["w-flaky", "Gemini 4 Argon", "agy", false]];
    run.forEach(([w, model, provider, working], i) => (db.chats[`tray-${i}`] = { pending: null, turn: 1, ws: w, model, provider, since: t0 - (i + 1) * 420, working }));
  }

  // ---------------------------------------------------------------- agente: roteiros em inglês
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  const later = (chatId: string, ms: number, f: () => void) => { const t = setTimeout(f, ms); (timers.get(chatId) ?? timers.set(chatId, []).get(chatId)!).push(t); };
  const ev = (chatId: string, e: unknown) => emit("chat-event", { chat_id: chatId, event: e });
  const play = (chatId: string, steps: Step[]) => steps.forEach(([ms, e]) => later(chatId, ms, () => ev(chatId, e)));
  const stopAll = (chatId: string) => { for (const t of timers.get(chatId) ?? []) (clearTimeout(t), clearInterval(t)); timers.delete(chatId); };
  const finish = (chatId: string, text: string, at: number, tokens = 48_000, cost: number | null = 0.42): Step[] => [
    [at, { type: "text", text }],
    [at + 30, { type: "usage", input: tokens, output: Math.round(tokens / 18), cache_read: tokens * 3, cache_write: 2400, duration_ms: at }],
    [at + 60, { type: "turn_completed", result: null, input_tokens: tokens, output_tokens: Math.round(tokens / 18), cost_usd: cost }],
  ];
  const started = (chatId: string): Step[] => [[20, { type: "session_started", session_id: "sess-" + chatId, model: null }], [30, { type: "session_info", tools: ["Bash", "Read", "Edit", "Write", "Grep", "Task", ...Array.from({ length: 38 }, (_, i) => `mcp__github__t${i}`), ...Array.from({ length: 24 }, (_, i) => `mcp__linear__t${i}`), ...Array.from({ length: 21 }, (_, i) => `mcp__playwright__t${i}`), ...Array.from({ length: 6 }, (_, i) => `mcp__postgres__t${i}`)], mcp_servers: [{ name: "github", status: "connected" }, { name: "linear", status: "connected" }, { name: "playwright", status: "connected" }, { name: "postgres", status: "connected" }, { name: "figma", status: "pending" }] }]];

  /** Agente que trabalha sem parar (workspaces "trabalhando" das capturas): ferramentas e subagentes em inglês. */
  const background = (chatId: string, wid: string) => {
    const s = BG_STEPS[wid] ?? BG_STEPS["w-router"];
    play(chatId, [...started(chatId), [60, { type: "reasoning", text: s.text }]]);
    let n = 0;
    s.tasks.forEach((desc, i) => {
      const task = `task-${chatId}-${i}`;
      later(chatId, 200 + i * 350, () => ev(chatId, { type: "tool_use", id: task, name: "Task", input: { description: desc, prompt: desc, subagent_type: i === 0 ? "general-purpose" : i === 1 ? "code-reviewer" : "test-runner" } }));
      const tick = setInterval(() => {
        const [name, input] = SUB_TOOLS[(n++ + i) % SUB_TOOLS.length];
        const id = `${task}-${n}`;
        ev(chatId, { type: "tool_use", id, name, input, parent_tool_use_id: task });
        setTimeout(() => ev(chatId, { type: "tool_result", id, output: "ok", is_error: false, parent_tool_use_id: task }), 250);
        ev(chatId, { type: "usage", input: 6000 + i * 900, output: 400, cache_read: 0, cache_write: 0, duration_ms: 800, parent_tool_use_id: task });
      }, 900 + i * 300);
      (timers.get(chatId) ?? timers.set(chatId, []).get(chatId)!).push(tick as any);
      if (i === 0 && s.tasks.length > 1) later(chatId, 5200, () => ev(chatId, { type: "tool_result", id: task, output: "Done.", is_error: false }));
    });
    s.tools.forEach(([name, input, output], i) => {
      const id = `bg-${chatId}-${i}`;
      later(chatId, 500 + i * 900, () => ev(chatId, { type: "tool_use", id, name, input }));
      later(chatId, 900 + i * 900, () => ev(chatId, { type: "tool_result", id, output, is_error: false }));
    });
    later(chatId, 600, () => ev(chatId, { type: "usage", input: 88_000, output: 3200, cache_read: 240_000, cache_write: 9000, duration_ms: 600 }));
  };

  /** Pedido de aprovação (workspace "esperando você"). */
  const approval = (chatId: string, wid: string) => {
    const c = db.chats[chatId];
    if (wid === "w-rate") {
      c.pending = { tool: "Bash", id: "ap-" + chatId, ok: "Migration applied. Wiring the limiter into `/v2` and adding the `RateLimit-*` headers next." };
      play(chatId, [...started(chatId), [80, { type: "tool_use", id: "ap-" + chatId, name: "Bash", input: { command: "npm run db:migrate -- --name add_rate_limit_to_api_keys", description: "Run the database migration" } }], [160, { type: "approval_request", request_id: "req-" + chatId, tool: "Bash", input: { command: "npm run db:migrate -- --name add_rate_limit_to_api_keys", description: "Run the database migration" } }]]);
      return;
    }
    // Hero: edição do index.html para evitar o flash branco.
    c.pending = { tool: "Edit", id: "ap-" + chatId, ok: "Done: the theme is applied before the first paint, so there's no white flash. Charts follow the theme too." };
    const input = { file_path: "index.html", old_string: "    <title>Acme</title>", new_string: "    <title>Acme</title>\n    <script>\n      const s = localStorage.getItem(\"acme.color-scheme\");\n      const dark = s === \"dark\" || (s !== \"light\" && matchMedia(\"(prefers-color-scheme: dark)\").matches);\n      document.documentElement.dataset.theme = dark ? \"dark\" : \"light\";\n    </script>" };
    play(chatId, [...started(chatId), [60, { type: "reasoning", text: "The flash happens because the theme is applied after React mounts. An inline script in index.html can set data-theme before the first paint." }], [120, { type: "tool_use", id: "ap-r-" + chatId, name: "Read", input: { file_path: "index.html" } }], [160, { type: "tool_result", id: "ap-r-" + chatId, output: "<!doctype html>…", is_error: false }], [220, { type: "tool_use", id: "ap-" + chatId, name: "Edit", input }], [300, { type: "approval_request", request_id: "req-" + chatId, tool: "Edit", input }]]);
  };

  /** Fluxo do vídeo: o primeiro turno (Claude) investiga e edita; depois da troca, o Codex pede para rodar os testes. */
  const flow = (chatId: string, text: string) => {
    const c = db.chats[chatId];
    const wid = c.ws;
    if (c.provider === "claude") {
      db.changed[wid] = db.changed[wid] ?? {};
      play(chatId, [
        ...started(chatId),
        [300, { type: "reasoning", text: "Exports are built in src/reports/export.ts. I'll add a CSV writer next to the PDF one and a button on the Reports page." }],
        [800, { type: "tool_use", id: "f1-" + chatId, name: "Read", input: { file_path: "src/reports/export.ts" } }],
        [1100, { type: "tool_result", id: "f1-" + chatId, output: "export async function exportPdf(report: Report) { … }", is_error: false }],
        [1500, { type: "tool_use", id: "f2-" + chatId, name: "TodoWrite", input: { todos: [{ content: "CSV writer with proper escaping", status: "in_progress" }, { content: "Export button on Reports", status: "pending" }, { content: "Tests", status: "pending" }] } }],
        [1600, { type: "tool_result", id: "f2-" + chatId, output: "ok", is_error: false }],
        [2300, { type: "tool_use", id: "f3-" + chatId, name: "Write", input: { file_path: "src/reports/csv.ts", content: "export function toCsv(rows: Row[]) { … }" } }],
        [2500, { type: "tool_result", id: "f3-" + chatId, output: "ok", is_error: false }],
        [3100, { type: "tool_use", id: "f4-" + chatId, name: "Edit", input: { file_path: "src/pages/Reports.tsx", old_string: "<ExportPdf />", new_string: "<ExportPdf />\n<ExportCsv />" } }],
        [3300, { type: "tool_result", id: "f4-" + chatId, output: "ok", is_error: false }],
        ...finish(chatId, "Added **CSV export** to the Reports page:\n\n- `src/reports/csv.ts`: RFC 4180 writer (quotes, commas, newlines)\n- `src/pages/Reports.tsx`: *Export CSV* button next to *Export PDF*\n\nNext: unit tests for the escaping rules.", 3900, 61_000, 0.58),
      ]);
      later(chatId, 3200, () => Object.assign(db.changed[wid], { "src/reports/csv.ts": "export function toCsv(rows: Row[]): string {\n  const esc = (v: unknown) => /[\",\\n]/.test(String(v)) ? `\"${String(v).replace(/\"/g, '\"\"')}\"` : String(v);\n  return rows.map((r) => r.map(esc).join(\",\")).join(\"\\n\");\n}\n", "src/pages/Reports.tsx": "<ExportPdf />\n<ExportCsv />\n" }));
      return;
    }
    // Depois da troca (Codex ou Gemini): escreve os testes e pede para rodar.
    c.pending = { tool: "Bash", id: "g2-" + chatId, tests: true, ok: "All **14 tests** pass, including quotes, commas and line breaks inside cells. Ready for a PR." };
    play(chatId, [
      ...started(chatId),
      [300, { type: "reasoning", text: "Picking up from the handoff: csv.ts exists, tests are missing." }],
      [700, { type: "tool_use", id: "g1-" + chatId, name: "Write", input: { file_path: "src/reports/csv.test.ts", content: "describe(\"toCsv\", () => { … })" } }],
      [900, { type: "tool_result", id: "g1-" + chatId, output: "ok", is_error: false }],
      [1300, { type: "tool_use", id: "g2-" + chatId, name: "Bash", input: { command: "npm test -- reports", description: "Run the report tests" } }],
      [1500, { type: "approval_request", request_id: "req-" + chatId, tool: "Bash", input: { command: "npm test -- reports", description: "Run the report tests" } }],
    ]);
    later(chatId, 800, () => ((db.changed[wid] ??= {})["src/reports/csv.test.ts"] = "describe(\"toCsv\", () => {\n  it(\"quotes commas\", () => expect(toCsv([[\"a,b\"]])).toBe('\"a,b\"'));\n});\n"));
    void text;
  };

  /** Primeiro turno curto (com custo e tokens) antes do trabalho longo ou do pedido de aprovação. */
  const INTRO: Record<string, [string, any, string][]> = {
    "w-dark": [["Read", { file_path: "src/components/Chart.tsx" }, "export function Chart({ data }: Props) { … }"], ["Edit", { file_path: "src/components/Chart.tsx", old_string: "const colors = PALETTE;", new_string: "const colors = scheme === \"dark\" ? PALETTE_DARK : PALETTE;" }, "ok"]],
  };
  const INTRO_TEXT: Record<string, string> = {
    "w-dark": "Charts now read the palette from the active theme. The white flash comes from applying the theme after React mounts; I can fix it with an inline script in `index.html`.",
    "w-router": "Plan: route table first, then one page at a time, typecheck after each. 23 files to touch.",
    "w-otel": "SDK bootstrap is in. Next: Postgres and Redis instrumentations.",
    "w-sync": "Split into three independent parts: storage, replay and conflicts.",
    "w-push": "Settings screen sketched; wiring the per-channel toggles to the API next.",
    "w-rate": "The limiter middleware is ready; it needs a migration for `api_keys.rate_limit` before I wire it in.",
  };
  const INTRO_TOK: Record<string, number> = { "w-dark": 84_200, "w-router": 131_900, "w-otel": 57_400, "w-sync": 112_600, "w-rate": 38_700, "w-push": 26_100 };
  const intro = (chatId: string, wid: string) => {
    const tools = INTRO[wid] ?? [["Read", { file_path: "README.md" }, "…"]];
    play(chatId, [...started(chatId), ...tools.flatMap(([name, input, output], i): Step[] => [[150 + i * 250, { type: "tool_use", id: `in-${chatId}-${i}`, name, input }], [260 + i * 250, { type: "tool_result", id: `in-${chatId}-${i}`, output, is_error: false }]]), ...finish(chatId, INTRO_TEXT[wid] ?? "Done.", 900, INTRO_TOK[wid] ?? 41_300, db.chats[chatId].provider === "claude" ? +((INTRO_TOK[wid] ?? 41_300) / 160_000).toFixed(2) : null)]);
  };

  handlers.chat_send = ({ chatId, text }) => {
    const c = db.chats[chatId];
    if (!c) return;
    c.working = true;
    c.turn++;
    c.last = text;
    const mode = (window as any).__demo.mode?.[c.ws] as string | undefined;
    if (mode && c.turn === 1) return intro(chatId, c.ws);
    if (mode === "background") return background(chatId, c.ws);
    if (mode === "approval") return approval(chatId, c.ws);
    return flow(chatId, text);
  };
  handlers.chat_approve = ({ chatId, allow }) => {
    const c = db.chats[chatId];
    const p = c?.pending;
    if (!p) return orig.chat_approve({ chatId, allow });
    c.pending = null;
    const out = p.tests ? " ✓ src/reports/csv.test.ts (14 tests) 22ms\n\n Test Files  1 passed (1)\n      Tests  14 passed (14)" : p.tool === "Bash" ? "Applied 1 migration: 20261025_add_rate_limit_to_api_keys" : "ok";
    play(chatId, [[60, { type: "tool_result", id: p.id, output: allow ? out : "Denied by the user", is_error: !allow }], ...finish(chatId, allow ? p.ok : "OK, I won't run it.", 700, 72_000, c.provider === "claude" ? 0.31 : null)]);
  };
  handlers.agents_status = () => ({ limit: 8, running: Object.values(db.chats).filter((c: any) => c.working && !c.pending).length, queued: [], running_chats: [], suspended: [], focus: null, idle_minutes: null });
  handlers.chat_stop = ({ chatId }) => (stopAll(chatId), orig.chat_stop({ chatId }));
  handlers.chat_interrupt = ({ chatId }) => (stopAll(chatId), { alive: true, leftovers: [], containers: [] });

  installMobile(ctx);
}
