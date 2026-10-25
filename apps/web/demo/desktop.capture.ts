import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Capturas do desktop (1600×1000 @2x) no ambiente de demonstração (`?mock&demo`, dados fictícios em inglês).
 * Saída crua em ../../.context/demo/raw/; `node demo/finish.mjs` otimiza e grava em docs/assets/.
 */
const RAW = "../../.context/demo/raw";
mkdirSync(RAW, { recursive: true });

const host = (p: Page) => p.locator(".ws-host:not([hidden])");
const chat = (p: Page) => p.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

async function shot(p: Page, name: string, clip?: Locator, pad = 0) {
  await p.waitForTimeout(400);
  if (!clip) return p.screenshot({ path: `${RAW}/${name}.png` });
  const b = (await clip.boundingBox())!;
  const vp = p.viewportSize()!;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  return p.screenshot({ path: `${RAW}/${name}.png`, clip: { x, y, width: Math.min(vp.width - x, b.width + pad * 2), height: Math.min(vp.height - y, b.height + pad * 2) } });
}

async function open(p: Page, title: string) {
  await p.getByTestId("ws-row").filter({ hasText: title }).first().click();
  await expect(host(p).locator(".ws-title, [data-testid=ws-title]").first()).toBeVisible().catch(() => {});
  await p.waitForTimeout(500);
}

async function send(p: Page, text: string) {
  const c = chat(p).getByTestId("composer");
  await c.fill(text);
  await c.press("Enter");
}

async function boot(p: Page, theme: "dark" | "light" = "dark") {
  await p.addInitScript((th) => {
    localStorage.setItem("kabul.theme", th);
    localStorage.setItem("kabul.rightPanel", "1");
    localStorage.setItem("kabul.modelPrefs", JSON.stringify({ favorites: ["claude:opus", "codex:gpt-6-luna", "agy:gemini-4-argon"], selected: "claude:opus", effort: "high", fast: false }));
    localStorage.setItem("kabul.modelPrefs.geminiSeeded", "1");
  }, theme);
  // Relógio fixo numa quinta de manhã (horários das conversas e "há X min" estáveis); o tempo continua andando.
  await p.clock.install({ time: new Date("2026-10-22T10:24:00-07:00") });
  await p.goto("/?mock&demo");
  await expect(p.getByTestId("ws-row").first()).toBeVisible();
}

/** Agentes trabalhando em três workspaces e um esperando aprovação (sidebar viva). */
/** Manda a primeira mensagem, espera o turno curto acabar e manda a segunda (trabalho longo ou aprovação). */
async function twoTurns(p: Page, title: string, first: string, second: string) {
  await open(p, title);
  const before = await chat(p).locator(".turn-meta").count();
  await send(p, first);
  // O turno curto "dura" uns 40 s (o rodapé mostra a duração).
  await p.waitForTimeout(150);
  await p.clock.fastForward(38_000 + title.length * 700);
  await expect(chat(p).locator(".turn-meta")).toHaveCount(before + 1);
  await expect(chat(p).getByTestId("stop")).toHaveCount(0);
  await p.waitForTimeout(300);
  await send(p, second);
}

/** Agentes trabalhando em três workspaces e um esperando aprovação (sidebar viva). */
async function startAgents(p: Page) {
  await twoTurns(p, "Migrate to React Router 7", "Plan the remaining pages first.", "Go ahead and convert them to loaders.");
  await twoTurns(p, "OpenTelemetry tracing", "Start with the SDK bootstrap.", "Add Postgres and Redis spans next.");
  await twoTurns(p, "Offline sync queue", "How would you split this up?", "Go ahead with the three parts in parallel.");
  await twoTurns(p, "Push notification settings", "Sketch the settings screen.", "Looks right, wire up the toggles.");
  await twoTurns(p, "Rate limiting for /v2", "Is the middleware ready?", "Run the migration and wire it in.");
  await expect(chat(p).locator(".approval")).toBeVisible();
}

test("hero: workspaces em paralelo, aprovação e diff", async ({ page: p }) => {
  await boot(p);
  await startAgents(p);
  await twoTurns(p, "Dark mode for the dashboard", "Looks great. Make the charts follow the theme too, and avoid the white flash on first load.", "Yes, go ahead with the inline script.");
  await expect(chat(p).locator(".approval")).toBeVisible();
  await host(p).locator(".rtab", { hasText: "Changes" }).click();
  await p.mouse.move(1500, 700);
  await p.waitForTimeout(1500);
  await shot(p, "hero-a");
  // Diff com comentário de linha à esquerda e a conversa (aprovação) à direita.
  await host(p).getByTestId("change-row").filter({ hasText: "tokens.ts" }).click();
  await p.waitForTimeout(800);
  await host(p).getByTestId("ctab").first().click({ button: "right" });
  await p.getByTestId("tab-split").click();
  await p.getByTestId("toggle-right").click();
  await p.mouse.move(1250, 500);
  await p.mouse.wheel(0, 4000);
  await p.getByTestId("sidebar").locator(".side-scroll").evaluate((e) => (e.scrollTop = 0)).catch(() => {});
  await p.mouse.move(800, 980);
  await p.waitForTimeout(1500);
  await shot(p, "hero");

  // Painel Agentes: todos os ativos, com a árvore de subagentes da fila offline aberta.
  await p.getByTestId("nav-agents").click();
  await expect(p.getByTestId("agent-row").first()).toBeVisible();
  await p.waitForTimeout(2500);
  for (const row of await p.getByTestId("agent-row").all()) {
    const subs = row.getByTestId("agent-subs");
    if (await subs.isEnabled()) await subs.click();
  }
  await p.mouse.move(1500, 980);
  await p.waitForTimeout(1200);
  await shot(p, "agents");

  // Board: workspaces por status.
  await p.getByTestId("nav-dashboard").click();
  await p.waitForTimeout(1500);
  await shot(p, "workspaces");
});

test("troca de LLM na mesma conversa (Claude → Codex → Gemini) e seletor de modelo", async ({ page: p }) => {
  await boot(p);
  await open(p, "Flaky cart totals test");
  await p.getByTestId("tab-checks").click();
  await p.mouse.move(1500, 980);
  await p.waitForTimeout(1200);
  await shot(p, "switch-llm-plain");
  await chat(p).locator(".picker-trigger").click();
  await p.waitForTimeout(800);
  await shot(p, "switch-llm");
});

test("uso, MCP e barra do Kabul", async ({ page: p }) => {
  await boot(p);
  await p.getByTestId("nav-usage").click();
  await expect(p.getByTestId("usage-view")).toBeVisible();
  await p.waitForTimeout(1500);
  await shot(p, "usage");

  await twoTurns(p, "Dark mode for the dashboard", "Looks great. Make the charts follow the theme too, and avoid the white flash on first load.", "Yes, go ahead with the inline script.");
  await expect(chat(p).locator(".approval")).toBeVisible();
  await chat(p).getByTestId("apps").click();
  await expect(p.getByTestId("mcp-panel")).toBeVisible();
  await p.waitForTimeout(800);
  // Desliga dois servidores nesta sessão para mostrar a economia de tokens.
  for (const name of ["figma", "sentry", "postgres"]) {
    const row = p.getByTestId("mcp-row").filter({ hasText: name });
    const tg = row.locator(".mcp-toggle .toggle");
    if (await tg.evaluate((e) => e.classList.contains("on")).catch(() => false)) await tg.click();
  }
  await p.waitForTimeout(600);
  await p.mouse.move(1500, 300);
  await p.waitForTimeout(400);
  await shot(p, "mcp-full");
  await shot(p, "mcp", p.getByTestId("mcp-panel"), 24);
});

test("barra do Kabul (popover)", async ({ page: p }) => {
  await p.setViewportSize({ width: 380, height: 860 });
  await p.goto("/?mock&demo&view=tray");
  await expect(p.getByTestId("tray-agent").first()).toBeVisible();
  await p.waitForTimeout(1200);
  await shot(p, "menubar", p.getByTestId("tray-popover"));
});

test("tema claro", async ({ page: p }) => {
  await boot(p, "light");
  await open(p, "Flaky cart totals test");
  await p.mouse.move(1500, 980);
  await p.waitForTimeout(1200);
  await shot(p, "light-switch");
  await p.getByTestId("nav-usage").click();
  await p.waitForTimeout(1500);
  await shot(p, "light-usage");
});

test("colaboração: aparelhos pareados e convite (editor) para o workspace", async ({ page: p }) => {
  await boot(p);
  await p.keyboard.press("Meta+Comma");
  await p.getByTestId("set-tab-celular").click();
  await expect(p.getByTestId("invite-go")).toBeVisible();
  await p.getByTestId("invite-ws").selectOption({ label: "Dark mode for the dashboard" }).catch(() => {});
  await p.getByTestId("invite-role").selectOption("editor");
  await p.getByTestId("invite-go").click();
  await p.mouse.move(1500, 980);
  await p.waitForTimeout(800);
  // Recorte: aparelhos pareados (Sam e Maya) e o convite com o QR.
  const head = p.locator("h3", { hasText: "Paired devices" });
  await head.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await p.waitForTimeout(500);
  const top = (await head.boundingBox())!;
  const qr = (await p.locator("h3", { hasText: "Invite" }).locator("xpath=following-sibling::div[1]").boundingBox())!;
  await p.screenshot({ path: `${RAW}/collab.png`, clip: { x: top.x - 28, y: top.y - 24, width: 1000, height: Math.min(1000 - (top.y - 24), qr.y + qr.height - top.y + 48) } });
});
