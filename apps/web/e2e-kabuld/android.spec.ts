import { test, expect } from "@playwright/test";
import { startKabuld, type Kabuld } from "./helpers";

// Android (Pixel 8): visual Material pela plataforma e voltar do sistema pelo histórico (tela e folha).
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ fakeHome: true });
});
test.afterAll(() => kd?.stop());

test("android: plataforma, voltar do sistema fecha folha e tela", async ({ page }) => {
  await page.goto(`${kd.base}/m/`);
  await expect(page.getByTestId("m-list")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-platform", "android");

  // Folha aberta: o voltar do sistema fecha só a folha.
  await page.getByTestId("m-sort").click();
  await expect(page.getByTestId("m-sort-sheet")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("m-sort-sheet")).toHaveCount(0);
  await expect(page.getByTestId("m-list")).toBeVisible();

  // Tela empilhada: voltar do sistema e ‹ da barra levam à lista; avançar reabre.
  await page.getByTestId("m-group").filter({ hasText: "Login novo" }).getByTestId("m-new-chat").click();
  await page.getByTestId("m-model").filter({ has: page.locator('[data-agent="claude"]') }).first().click();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("m-session-view")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await page.getByTestId("m-back").click();
  await expect(page.getByTestId("m-session-view")).toHaveCount(0);

  // Ondulação no toque (Material).
  await page.getByTestId("m-tab-settings").click();
  await page.getByTestId("m-theme").dispatchEvent("pointerdown", { clientX: 40, clientY: 10 });
  await expect(page.locator(".m-ripple")).toHaveCount(1);
});
