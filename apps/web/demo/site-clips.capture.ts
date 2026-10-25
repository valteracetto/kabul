/* i18n-ignore-file: clipes da landing page (não é interface do app). */
import { test, expect, type Page, type Locator } from "../playwright-silencio";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, SAFE, iphoneStatusBarHtml, prepare } from "./frame";

/**
 * Clipes curtos da landing page (`npm run demo:site-clips`), no ambiente de demonstração (dados fictícios):
 * - switch: troca de Claude para Codex na mesma conversa (desktop, tema escuro);
 * - agents: painel Agentes com vários agentes trabalhando ao vivo;
 * - phone: iPhone (PWA em tela cheia), lista → conversa esperando aprovação → aprovar.
 * Cada teste grava o vídeo inteiro e as marcas do trecho útil (segundos desde o início do vídeo) em
 * <repo>/.context/demo/raw/clip-<nome>.webm|.json; `node demo/site-clips.mjs` corta e codifica.
 * O vídeo do WebKit sai em pixels CSS (borrado no site): o do celular é montado com screenshots em 2×. A página
 * do iPhone tem 393×793 (abaixo da barra de status opaca do iOS); a barra vai em clip-phone-bar.png.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RAW = join(ROOT, ".context/demo/raw");
mkdirSync(RAW, { recursive: true });

const host = (p: Page) => p.locator(".ws-host:not([hidden])");
const chat = (p: Page) => p.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

/** Marcas do trecho útil, em segundos desde a criação da página (o vídeo começa junto). */
function marks() {
  const t0 = Date.now();
  const m: Record<string, number> = {};
  return { at: (k: string) => (m[k] = (Date.now() - t0) / 1000), m };
}

/**
 * Gravador por screenshots (WebKit): tira quadros em sequência enquanto o teste roda e, no fim, monta um .webm
 * (VP9 quase sem perda) com a duração real de cada quadro. Marcas em segundos desde o primeiro quadro.
 */
function shots(p: Page) {
  const t0 = Date.now();
  const frames: { t: number; buf: Buffer }[] = [];
  let on = true;
  const loop = (async () => {
    while (on) {
      const t = Date.now();
      const buf = await p.screenshot({ type: "jpeg", quality: 95 }).catch(() => null);
      if (!buf) break;
      frames.push({ t, buf });
    }
  })();
  const m: Record<string, number> = {};
  return {
    at: (k: string) => (m[k] = (Date.now() - t0) / 1000),
    async save(name: string) {
      on = false;
      await loop;
      const dir = join(RAW, `_clip-${name}-frames`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const list: string[] = [];
      frames.forEach((f, i) => {
        const file = `${String(i).padStart(5, "0")}.jpg`;
        writeFileSync(join(dir, file), f.buf);
        const next = frames[i + 1]?.t ?? f.t + 100;
        list.push(`file '${file}'`, `duration ${((next - f.t) / 1000).toFixed(3)}`);
      });
      list.push(`file '${String(frames.length - 1).padStart(5, "0")}.jpg'`);
      writeFileSync(join(dir, "list.txt"), list.join("\n") + "\n");
      // Marcas relativas ao primeiro quadro (o início do .webm montado).
      const shift = (frames[0].t - t0) / 1000;
      const rel = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +(v - shift).toFixed(3)]));
      writeFileSync(join(RAW, `clip-${name}.json`), JSON.stringify(rel));
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "fps=30,format=yuv420p", "-c:v", "libvpx-vp9", "-crf", "8", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an", join(RAW, `clip-${name}.webm`)]);
      const fps = frames.length / ((frames[frames.length - 1].t - frames[0].t) / 1000);
      console.log(`clip-${name}: ${frames.length} quadros, ~${fps.toFixed(1)} por segundo`);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function save(p: Page, name: string, m: Record<string, number>) {
  writeFileSync(join(RAW, `clip-${name}.json`), JSON.stringify(m));
  const v = p.video();
  await p.close();
  if (v) copyFileSync(await v.path(), join(RAW, `clip-${name}.webm`));
}

/** Cursor visível no vídeo (o headless não desenha o do sistema). */
async function cursor(p: Page) {
  await p.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "demo-cursor";
      c.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:20px;height:20px;margin:-3px 0 0 -3px;pointer-events:none;";
      c.innerHTML = '<svg width="20" height="20" viewBox="0 0 18 18"><path d="M2 1.5 15.5 9 9.4 10.4 6.6 16.2Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
      addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`), true);
    });
  });
}

/** Move o mouse até o elemento (o cursor desliza) e clica. */
async function click(p: Page, el: Locator, { steps = 10, pause = 160, dispatch = false } = {}) {
  const b = (await el.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
  await p.waitForTimeout(pause);
  // Tabela que se redesenha a cada evento (painel Agentes): o clique de verdade perde a corrida; dispara direto.
  if (dispatch) await el.dispatchEvent("click");
  else await el.click();
}

async function boot(p: Page) {
  await cursor(p);
  await p.addInitScript(() => {
    localStorage.setItem("kabul.theme", "dark");
    localStorage.setItem("kabul.rightPanel", "0");
    localStorage.setItem("kabul.modelPrefs", JSON.stringify({ favorites: ["claude:opus", "codex:gpt-6-luna", "agy:gemini-4-argon"], selected: "claude:opus", effort: "high", fast: false }));
    localStorage.setItem("kabul.modelPrefs.geminiSeeded", "1");
  });
  // Relógio fixo numa quinta de manhã (horários estáveis); o tempo continua andando.
  await p.clock.install({ time: new Date("2026-10-22T10:24:00-07:00") });
  await p.goto("/?mock&demo");
  await expect(p.getByTestId("ws-row").first()).toBeVisible();
}

async function open(p: Page, title: string) {
  await p.getByTestId("ws-row").filter({ hasText: title }).first().click();
  await p.waitForTimeout(300);
}

async function send(p: Page, text: string) {
  const c = chat(p).getByTestId("composer");
  await c.fill(text);
  await c.press("Enter");
}

/** Primeira mensagem, turno curto (adiantado no relógio) e a segunda (trabalho longo ou aprovação). */
async function twoTurns(p: Page, title: string, first: string, second: string) {
  await open(p, title);
  const before = await chat(p).locator(".turn-meta").count();
  await send(p, first);
  await p.waitForTimeout(150);
  await p.clock.fastForward(38_000 + title.length * 700);
  await expect(chat(p).locator(".turn-meta")).toHaveCount(before + 1);
  await expect(chat(p).getByTestId("stop")).toHaveCount(0);
  await p.waitForTimeout(200);
  await send(p, second);
}

test("switch: Claude → Codex na mesma conversa @desktop", async ({ page: p }) => {
  const { at, m } = marks();
  await boot(p);

  // Preparação (fica fora do corte): workspace novo com o Claude terminando o primeiro turno.
  await p.getByTestId("create-ws").click();
  await expect(p.getByTestId("create-modal")).toBeVisible();
  if (!(await p.getByTestId("create-repo").textContent())?.includes("acme-web")) {
    await p.getByTestId("create-repo").click();
    await p.getByTestId("repo-pop").locator(".pop-row", { hasText: "acme-web" }).click();
  }
  await p.getByTestId("create-text").fill("Add CSV export to the Reports page");
  await p.getByTestId("create-text").press("Enter");
  await expect(chat(p).locator(".msg-assistant").last()).toContainText("CSV export", { timeout: 15_000 });
  await expect(chat(p).getByTestId("stop")).toHaveCount(0);
  const vp = p.viewportSize()!;
  await p.mouse.move(vp.width * 0.62, vp.height * 0.45);
  await p.waitForTimeout(900);
  at("start");

  // Seletor de modelo → GPT-6-Luna (Codex).
  await click(p, chat(p).locator(".picker-trigger"), { steps: 14, pause: 200 });
  await p.waitForTimeout(450);
  await click(p, p.locator(".picker-pop .pop-row, .picker-pop [role=option]", { hasText: "GPT-6-Luna" }).first(), { steps: 10, pause: 250 });
  await p.waitForTimeout(250);
  const c = chat(p).getByTestId("composer");
  await c.click();
  await c.pressSequentially("Write the tests and run them", { delay: 22 });
  await c.press("Enter");
  // O Codex continua na mesma conversa: divisor da troca, testes escritos, pede para rodar.
  await expect(chat(p).locator(".approval")).toBeVisible({ timeout: 15_000 });
  await p.waitForTimeout(500);
  await click(p, chat(p).locator(".approval button", { hasText: "Yes" }).first(), { steps: 10, pause: 200 });
  await expect(chat(p).locator(".msg-assistant").last()).toContainText("14 tests", { timeout: 15_000 });
  await p.mouse.move(vp.width * 0.62, vp.height * 0.4, { steps: 10 });
  await p.waitForTimeout(1300);
  at("end");
  await p.screenshot({ path: join(RAW, "clip-switch-end.png") });
  await save(p, "switch", m);
});

// O painel Agentes é uma tabela larga: 1280×800 (mesma proporção do vídeo) para caber até o botão Stop.
test.describe(() => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("agents: painel Agentes ao vivo @desktop", async ({ page: p }) => {
    const { at, m } = marks();
    await boot(p);
    // Preparação (fora do corte): quatro agentes trabalhando, um esperando aprovação e o do dark mode também.
    await twoTurns(p, "Migrate to React Router 7", "Plan the remaining pages first.", "Go ahead and convert them to loaders.");
    await twoTurns(p, "OpenTelemetry tracing", "Start with the SDK bootstrap.", "Add Postgres and Redis spans next.");
    await twoTurns(p, "Offline sync queue", "How would you split this up?", "Go ahead with the three parts in parallel.");
    await twoTurns(p, "Push notification settings", "Sketch the settings screen.", "Looks right, wire up the toggles.");
    await twoTurns(p, "Rate limiting for /v2", "Is the middleware ready?", "Run the migration and wire it in.");
    await expect(chat(p).locator(".approval")).toBeVisible();
    await p.getByTestId("nav-overview").click();
    await p.getByTestId("ov-agents").click();
    await expect(p.getByTestId("agent-row").first()).toBeVisible();
    // Sem a barra lateral: a tabela inteira (até a coluna de custo) cabe no quadro.
    await p.getByRole("button", { name: /^Hide sidebar/ }).click();
    await expect(p.getByTestId("sidebar")).toHaveCount(0);
    // Abre a árvore de subagentes de quem tem (menos a primeira, que abre na frente da câmera).
    const rows = await p.getByTestId("agent-row").all();
    const withSubs: Locator[] = [];
    for (const row of rows) if (await row.getByTestId("agent-subs").isEnabled().catch(() => false)) withSubs.push(row.getByTestId("agent-subs"));
    for (const b of withSubs.slice(1)) await b.dispatchEvent("click");
    const vp = p.viewportSize()!;
    await p.mouse.move(vp.width * 0.55, vp.height * 0.85);
    await p.waitForTimeout(1500);
    at("start");
    await p.waitForTimeout(1200);
    if (withSubs[0]) await click(p, withSubs[0], { steps: 14, pause: 220, dispatch: true });
    await p.mouse.move(vp.width * 0.62, vp.height * 0.93, { steps: 14 });
    await p.waitForTimeout(5200);
    at("end");
    await p.screenshot({ path: join(RAW, "clip-agents-end.png") });
    await save(p, "agents", m);
  });
});

test("phone: lista → conversa → aprovar @phone", async ({ page: p }) => {
  await prepare(p, "iphone");
  // Toque visível: um círculo onde o dedo encosta (sem transição, que o prepare desliga).
  await p.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const d = document.createElement("div");
      d.style.cssText =
        "position:fixed;z-index:2147483647;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.35);box-shadow:0 0 0 2px rgba(255,255,255,.6);pointer-events:none;display:none;";
      document.body.appendChild(d);
      (window as any).__tap = (x: number, y: number, on: boolean) => {
        d.style.transform = `translate(${x}px, ${y}px)`;
        d.style.display = on ? "block" : "none";
      };
    });
  });
  const tap = async (el: Locator) => {
    const b = (await el.boundingBox())!;
    const x = b.x + b.width / 2,
      y = b.y + b.height / 2;
    await p.evaluate(([x, y]) => (window as any).__tap(x, y, true), [x, y]);
    await p.waitForTimeout(220);
    await el.tap();
    await p.waitForTimeout(120);
    await p.evaluate(() => (window as any).__tap(0, 0, false)).catch(() => {});
  };

  await p.goto(BASE);
  await expect(p.getByTestId("m-session")).toHaveCount(9);
  await expect(p.locator('[data-status="waiting"]').first()).toBeVisible();
  const rec = shots(p);
  const at = rec.at;
  await p.waitForTimeout(600);
  at("start");
  await p.waitForTimeout(900);

  // Filtro "Waiting on you" → a conversa do dark mode (sem rolar a lista).
  await tap(p.getByTestId("m-filter-waiting"));
  const dark = p.locator('[data-testid="m-session"][data-id="chat:c-dark"]');
  await expect(dark).toBeVisible();
  await p.waitForTimeout(900);
  await tap(dark);
  await expect(p.getByTestId("m-approve")).toBeVisible();
  await p.waitForTimeout(1600);
  await tap(p.getByTestId("m-approve"));
  await expect(p.getByText("Updated 6 baselines", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await p.waitForTimeout(1800);
  at("end");
  await rec.save("phone");
  await p.screenshot({ path: join(RAW, "clip-phone-end.png") });
  // Barra de status opaca do iOS (a página começa abaixo dela): o site-clips.mjs cola esta faixa em cima.
  // Mesmo contexto (2×) do vídeo: uma página nova só com a faixa, recortada em 393×59.
  const bar = await p.context().newPage();
  await bar.setContent(iphoneStatusBarHtml("dark"));
  await bar.screenshot({ path: join(RAW, "clip-phone-bar.png"), clip: { x: 0, y: 0, width: SAFE.iphone.w, height: SAFE.iphone.bar } });
  await bar.close();
});
