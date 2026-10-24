import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}

test("⌘K: abas (Tab/⇧Tab), ações do workspace, arquivados, configurações; zoom ⌘+/−/0; zen ⌘.", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("pal-tab-all")).toHaveClass(/on/);
  await expect(page.getByTestId("palette")).toContainText("Workspace: Kabul");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("pal-tab-workspaces")).toHaveClass(/on/);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("pal-tab-settings")).toHaveClass(/on/);
  await page.getByTestId("palette-input").fill("git");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("git-settings")).toBeVisible();
  // Ação do workspace pela paleta
  await page.getByTestId("ws-row").click();
  await page.keyboard.press("Meta+k");
  await page.getByTestId("palette-input").fill("mostrar checks");
  await page.keyboard.press("Enter");
  await expect(host(page).getByTestId("tab-checks")).toHaveClass(/on/);
  await page.keyboard.press("Meta+k");
  await page.getByTestId("pal-tab-actions").click();
  await expect(page.getByTestId("palette")).toContainText("Modo zen");
  await page.screenshot({ path: "../../.context/e2e/paleta-acoes.png" });
  await page.getByTestId("palette-input").fill("buscar nos arquivos");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-files")).toBeVisible();
  await page.keyboard.press("Escape");
  // Arquivados
  await page.keyboard.press("Meta+Shift+a");
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await page.getByTestId("pal-tab-workspaces").click();
  await page.getByTestId("pal-archived").click();
  await expect(page.getByTestId("pal-row")).toContainText("Kabul");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  // Zoom
  await page.keyboard.press("Meta+=");
  await page.keyboard.press("Meta+=");
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("zoom") || (document.documentElement.style as any).zoom)).toBe("120%");
  await page.keyboard.press("Meta+-");
  expect(await page.evaluate(() => (document.documentElement.style as any).zoom)).toBe("110%");
  await page.keyboard.press("Meta+0");
  expect(await page.evaluate(() => (document.documentElement.style as any).zoom)).toBe("100%");
  // Zen: some a barra lateral e o painel direito; ⌘. volta
  await expect(host(page).locator("aside.right")).toBeVisible();
  await page.keyboard.press("Meta+.");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await expect(host(page).locator("aside.right")).toBeHidden();
  await page.keyboard.press("Meta+.");
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(host(page).locator("aside.right")).toBeVisible();
});
