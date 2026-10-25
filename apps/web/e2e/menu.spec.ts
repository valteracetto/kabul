import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
const menu = (page: Page, id: string) => page.evaluate((i) => (window as any).__mock.emit("menu", i), id);
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}

test("menu nativo: Configurações, Ver (barra lateral, zen, zoom), Ajuda (atalhos, diagnóstico, feedback); ⌘Q com agente rodando pede confirmação", async ({ page }) => {
  await setup(page);
  await menu(page, "toggle-sidebar");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await menu(page, "toggle-sidebar");
  await menu(page, "zoom-in");
  expect(await page.evaluate(() => (document.documentElement.style as any).zoom)).toBe("110%");
  await menu(page, "zoom-reset");
  await menu(page, "diagnostics");
  await expect(page.getByTestId("diagnostics")).toBeVisible();
  await menu(page, "shortcuts");
  await expect(page.getByTestId("shortcuts")).toBeVisible();
  await menu(page, "feedback");
  await expect(page.getByTestId("feedback")).toBeVisible();
  await page.keyboard.press("Escape");
  await menu(page, "settings");
  await expect(page.getByTestId("general")).toBeVisible();
  // Sair sem agentes: direto.
  await page.evaluate(() => (window as any).__mock.emit("quit-requested", null));
  await expect.poll(() => page.evaluate(() => (window as any).__quit)).toBe(true);
  await page.evaluate(() => ((window as any).__quit = false));
  // Com agente rodando: confirmação.
  await page.getByTestId("ws-row").click();
  await chat(page).getByTestId("composer").fill("tarefa demorada");
  await chat(page).getByTestId("composer").press("Enter");
  await page.evaluate(() => (window as any).__mock.emit("quit-requested", null));
  await expect(page.getByTestId("confirm")).toContainText("Há 1 agente rodando");
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => page.evaluate(() => (window as any).__quit)).toBe(true);
});

test("fechar conversa rodando pede confirmação; ⌘⇧T reabre a aba fechada; ⌃Tab troca de aba", async ({ page }) => {
  await setup(page);
  await chat(page).getByTestId("composer").fill("tarefa demorada");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(host(page).getByTestId("ctab").first()).toContainText("tarefa demorada");
  await host(page).getByTestId("ctab").first().getByTitle("Fechar (⌘W)").click();
  await expect(page.getByTestId("confirm")).toContainText("O agente está trabalhando");
  await page.getByTestId("confirm-ok").click();
  await expect(host(page).getByTestId("ctab").first()).toHaveText(/Nova conversa/);
  await chat(page).getByTestId("composer").focus();
  await page.keyboard.press("Meta+Shift+t");
  await expect(host(page).getByTestId("ctab")).toHaveCount(2);
  await expect(host(page).getByTestId("ctab").nth(1)).toContainText("tarefa demorada");
  await page.keyboard.press("Control+Tab");
  await expect(host(page).getByTestId("ctab").first()).toHaveClass(/ on/);
});
