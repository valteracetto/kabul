import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  await addRepo(page, "/mock/repos/demo");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-demo").click();
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}

test("plan mode: começa em plan e sai ao vivo, sem reiniciar a conversa", async ({ page }) => {
  await setup(page);
  const composer = page.getByTestId("composer");
  await composer.click();
  await composer.press("Shift+Tab");
  await expect(page.getByTestId("plan-chip")).toContainText("Plan mode");
  await composer.fill("Planeje a mudança");
  await composer.press("Enter");
  await expect(page.locator(".turn-meta")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__kabulStarts)).toBe(1);
  // Sai do plan (plano aprovado): a mesma sessão troca de modo.
  await composer.click();
  await composer.press("Shift+Tab");
  await expect(page.getByTestId("plan-chip")).toHaveCount(0);
  await composer.fill("Pode implementar");
  await composer.press("Enter");
  await expect(page.locator(".notice").filter({ hasText: "Saiu do plan mode" })).toBeVisible();
  await expect(page.locator(".turn-meta")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__kabulStarts)).toBe(1);
});

test("plan mode: sem troca ao vivo, retoma a sessão com o modo novo", async ({ page }) => {
  await page.addInitScript(() => ((window as any).__kabulNoLiveMode = true));
  await setup(page);
  const composer = page.getByTestId("composer");
  await composer.click();
  await composer.press("Shift+Tab");
  await composer.fill("Planeje");
  await composer.press("Enter");
  await expect(page.locator(".turn-meta")).toHaveCount(1);
  await composer.click();
  await composer.press("Shift+Tab");
  await composer.fill("Implemente");
  await composer.press("Enter");
  await expect(page.locator(".notice").filter({ hasText: "Continuando" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__kabulStarts)).toBe(2);
});
