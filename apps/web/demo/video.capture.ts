import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";

/**
 * Vídeo do fluxo principal (1280×800): criar workspace → agente trabalhando → trocar de Claude para Codex na
 * mesma conversa → aprovar → abrir o PR. Grava o vídeo inteiro e anota quando o trecho útil começa e acaba
 * (../../.context/demo/raw/demo-cut.json); `node demo/finish.mjs` corta, acelera as esperas e gera demo.mp4/demo.gif.
 */
const RAW = "../../.context/demo/raw";
mkdirSync(RAW, { recursive: true });

const host = (p: Page) => p.locator(".ws-host:not([hidden])");
const chat = (p: Page) => p.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

/** Cursor visível no vídeo (o headless não desenha o do sistema). */
async function cursor(p: Page) {
  await p.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "demo-cursor";
      c.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:18px;height:18px;margin:-3px 0 0 -3px;pointer-events:none;transition:transform .35s cubic-bezier(.2,.7,.2,1);";
      c.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1.5 15.5 9 9.4 10.4 6.6 16.2Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.body.appendChild(c);
      addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`), true);
    });
  });
}

/** Move o mouse até o elemento (com o cursor deslizando) e clica. */
async function click(p: Page, el: ReturnType<Page["locator"]>) {
  const b = (await el.boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await p.waitForTimeout(250);
  await el.click();
}

test("vídeo: workspace novo, troca de Claude para Codex, aprovação e PR", async ({ page: p }) => {
  await cursor(p);
  await p.addInitScript(() => {
    localStorage.setItem("kabul.theme", "dark");
    localStorage.setItem("kabul.rightPanel", "1");
    localStorage.setItem("kabul.modelPrefs", JSON.stringify({ favorites: ["claude:opus", "codex:gpt-6-luna", "agy:gemini-4-argon"], selected: "claude:opus", effort: "high", fast: false }));
    localStorage.setItem("kabul.modelPrefs.geminiSeeded", "1");
  });
  await p.clock.install({ time: new Date("2026-10-22T10:24:00-07:00") });
  const t0 = Date.now();
  const mark: Record<string, number> = {};
  const at = (k: string) => (mark[k] = (Date.now() - t0) / 1000);

  await p.goto("/?mock&demo");
  await expect(p.getByTestId("ws-row").first()).toBeVisible();
  await p.mouse.move(640, 400);
  await p.waitForTimeout(1200);
  at("start");

  // 1) Criar workspace a partir de um pedido.
  await click(p, p.getByTestId("create-ws"));
  await expect(p.getByTestId("create-modal")).toBeVisible();
  if (!(await p.getByTestId("create-repo").textContent())?.includes("acme-web")) {
    await click(p, p.getByTestId("create-repo"));
    await click(p, p.getByTestId("repo-pop").locator(".pop-row", { hasText: "acme-web" }));
  }
  await p.getByTestId("create-text").pressSequentially("Add CSV export to the Reports page", { delay: 28 });
  await p.waitForTimeout(400);
  await p.getByTestId("create-text").press("Enter");

  // 2) Claude trabalha.
  await expect(chat(p).locator(".msg-assistant").last()).toContainText("CSV export", { timeout: 15_000 });
  await expect(chat(p).getByTestId("stop")).toHaveCount(0);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${RAW}/video-1.png` });

  // 3) Troca para o Codex na mesma conversa.
  await click(p, chat(p).locator(".picker-trigger"));
  await p.waitForTimeout(500);
  await click(p, p.locator(".picker-pop .pop-row, .picker-pop [role=option]", { hasText: "GPT-6-Luna" }).first());
  await p.waitForTimeout(400);
  const c = chat(p).getByTestId("composer");
  await c.click();
  await c.pressSequentially("Write the tests and run them", { delay: 28 });
  await c.press("Enter");
  await expect(chat(p).locator(".approval")).toBeVisible({ timeout: 15_000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${RAW}/video-2.png` });

  // 4) Aprovar.
  await click(p, chat(p).locator(".approval button", { hasText: "Yes" }).first());
  await p.mouse.move(1090, 330, { steps: 14 });
  await expect(chat(p).locator(".msg-assistant").last()).toContainText("14 tests", { timeout: 15_000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${RAW}/video-3.png` });

  // 5) Abrir o PR.
  await click(p, host(p).getByRole("button", { name: /^Create PR$/ }).first());
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${RAW}/video-4.png` });
  const form = p.getByTestId("pr-form");
  if (await form.isVisible().catch(() => false)) await click(p, form.getByRole("button", { name: /Push and create/ }));
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${RAW}/video-5.png` });
  at("end");

  writeFileSync(`${RAW}/demo-cut.json`, JSON.stringify(mark));
  const v = p.video();
  await p.close();
  if (v) copyFileSync(await v.path(), `${RAW}/demo.webm`);
});
