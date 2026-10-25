import { test, expect } from "@playwright/test";
import { addRepo } from "./helpers";

test("cartão de prévia do workspace: abre após 700 ms de hover, some 200 ms depois de sair; passada rápida não abre", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  const row = page.getByTestId("ws-row");
  // Passada rápida.
  await row.hover();
  await page.waitForTimeout(300);
  await page.mouse.move(900, 600);
  await page.waitForTimeout(700);
  await expect(page.getByTestId("ws-peek")).toHaveCount(0);
  // Hover demorado.
  await row.hover();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("ws-peek")).toHaveCount(0);
  await expect(page.getByTestId("ws-peek")).toBeVisible({ timeout: 1500 });
  await expect(page.getByTestId("ws-peek")).toContainText("demo");
  await expect(page.getByTestId("ws-peek")).toContainText("Em andamento");
  const box = (await page.getByTestId("ws-peek").boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(280);
  expect(box.width).toBeLessThanOrEqual(340);
  await page.mouse.move(900, 600);
  await expect(page.getByTestId("ws-peek")).toHaveCount(0, { timeout: 1000 });
});
