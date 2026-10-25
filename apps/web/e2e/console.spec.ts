import { test, expect, type Page } from "../playwright-silencio";
import { addRepo, navTo } from "./helpers";

// Avisos do React que indicam loop de setState ou setState durante o render. Qualquer um reprova.
const RUIM = /Maximum update depth exceeded|Cannot update a component .* while rendering|Too many re-renders/;

function vigiar(page: Page) {
  const ruins: string[] = [];
  page.on("console", (m) => void (RUIM.test(m.text()) && ruins.push(m.text().slice(0, 200))));
  page.on("pageerror", (e) => void (RUIM.test(e.message) && ruins.push(e.message.slice(0, 200))));
  return ruins;
}
const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
const inscricoes = (page: Page) => page.evaluate(() => (window as any).__subs?.["chat-event"] ?? 0);

test("console sem loop de render: workspace, aba nova, configurações, Painel e modal", async ({ page }) => {
  const ruins = vigiar(page);
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  // Parado, a aba não se reinscreve em chat-event (o loop refazia a inscrição milhares de vezes por segundo).
  const a = await inscricoes(page);
  await page.waitForTimeout(1000);
  expect(await inscricoes(page)).toBe(a);
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-chat").click();
  await page.waitForTimeout(500);
  await page.getByTestId("settings").click();
  await page.waitForTimeout(300);
  await navTo(page, "sessions");
  await page.waitForTimeout(300);
  await page.getByTestId("create-ws").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.getByTestId("ws-row").first().click();
  await page.waitForTimeout(500);
  expect(ruins).toEqual([]);
});

test("aba nova com listen assíncrono (como no Tauri): a resposta do agente chega", async ({ page }) => {
  const ruins = vigiar(page);
  await page.goto("/?mock");
  await page.evaluate(() => ((window as any).__mock.slowListen = true));
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-chat").click();
  await chat(page).getByTestId("composer").fill("oi");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).locator(".msg-assistant").last()).not.toBeEmpty({ timeout: 10_000 });
  await expect(chat(page).getByTestId("send")).toBeVisible();
  expect(ruins).toEqual([]);
});

test("mensagem enviada antes dos modelos chegarem: a lista chega no meio do envio e a mensagem sai", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  // A aba nova só recebe os modelos quando o envio já começou (entre o Enter e o checkpoint).
  await page.evaluate(() => ((window as any).__mock.holdModels = true));
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await chat(page).getByTestId("composer").fill("crie o arquivo");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(host(page).getByTestId("approval")).toBeVisible({ timeout: 5000 });
});

// Aba nova, envio imediato (a lista de modelos chega no meio do envio), para cada harness: o chat_start sai.
for (const [key, harness] of [["claude:opus", "claude"], ["codex:gpt-6-luna", "codex"], ["agy:gemini-4-argon", "antigravity"], ["local:lmstudio:qwen3-8b", "opencode"]] as const) {
  test(`aba nova e envio imediato com ${harness}: o agente inicia e responde`, async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem("kabul.modelPrefs", JSON.stringify({ selected: k })), key);
    await page.goto("/?mock");
    await page.getByTestId("create-ws").click();
    await addRepo(page, "/mock/repos/demo");
    await page.getByTestId("create-go").click();
    await expect(page.getByTestId("ws-row")).toHaveCount(1);
    await page.evaluate(() => ((window as any).__mock.holdModels = true));
    await host(page).getByTestId("new-tab").click();
    await page.getByTestId("new-chat").click();
    await chat(page).getByTestId("composer").fill("oi");
    await chat(page).getByTestId("composer").press("Enter");
    await expect.poll(() => page.evaluate(() => (window as any).__kabulLastStart?.harness)).toBe(harness);
    await expect(chat(page).locator(".msg-assistant").last()).not.toBeEmpty({ timeout: 10_000 });
  });
}
