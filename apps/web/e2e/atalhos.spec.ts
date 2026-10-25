import { test, expect } from "@playwright/test";

test("atalhos personalizados: gravar, conflito, a tecla nova abre e a antiga não; restaurar; fixos não editam", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-atalhos").click();
  const row = page.getByTestId("sc-palette");
  await row.getByTestId("sc-record").click();
  await expect(row.getByTestId("sc-record")).toContainText("Digite o atalho");
  // Conflito com ⌘B (barra lateral).
  await page.keyboard.press("Meta+b");
  await expect(row.getByTestId("sc-conflict")).toContainText("Já usado por");
  await expect(row.getByTestId("sc-conflict")).toContainText("barra lateral");
  await page.keyboard.press("Meta+Shift+k");
  await expect(row.getByTestId("sc-record")).toHaveText("⇧⌘K");
  await expect(row.getByTestId("sc-reset")).toBeVisible();
  // Atalho de contexto (↵ / ⌘↵ / ⌫) é fixo.
  await expect(page.getByTestId("sc-approve").getByTestId("sc-record")).toHaveCount(0);
  // ⌘B (barra lateral) para ⌥⌘J: a nova alterna, a antiga não faz mais nada.
  const side = page.getByTestId("sc-sidebar");
  await side.getByTestId("sc-record").click();
  await page.keyboard.press("Meta+Alt+j");
  await expect(side.getByTestId("sc-conflict")).toContainText("Já usado por");
  await page.keyboard.press("Meta+Alt+y");
  await expect(side.getByTestId("sc-record")).toHaveText("⌥⌘Y");
  await page.locator(".side-nav button", { hasText: "Painel" }).click();
  await page.keyboard.press("Meta+b");
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.keyboard.press("Meta+Alt+y");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await page.keyboard.press("Meta+Alt+y");
  await expect(page.getByTestId("sidebar")).toBeVisible();
  // ⇧⌘K abre a paleta.
  await page.keyboard.press("Meta+Shift+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
  // Restaurar volta ao ⌘K.
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-atalhos").click();
  await page.getByTestId("sc-palette").getByTestId("sc-reset").click();
  await expect(page.getByTestId("sc-palette").getByTestId("sc-record")).toHaveText("⌘K");
  await page.getByTestId("sc-sidebar").getByTestId("sc-reset").click();
  await page.locator(".side-nav button", { hasText: "Painel" }).click();
  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
});
