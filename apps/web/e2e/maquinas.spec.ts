import { test, expect } from "../playwright-silencio";

test("seletor de máquina no topo: nome do Mac, conta, ⌃1…⌃9, adicionar máquina; sem a tag LOCAL", async ({ page }) => {
  await page.goto("/?mock");
  await page.evaluate(() => ((window as any).__noReload = true));
  await expect(page.getByTestId("machine-picker")).toContainText("Mac de Dev");
  await expect(page.locator(".side-foot")).not.toContainText("LOCAL");
  await page.getByTestId("machine-picker").click();
  await expect(page.getByTestId("machine-who")).toHaveText("dev@example.com");
  await expect(page.getByTestId("machine-local")).toContainText("✓");
  await expect(page.getByTestId("machine-pop")).toContainText("Nuvem Kabul");
  await expect(page.getByTestId("machine-pop")).not.toContainText("Upgrade");
  await page.screenshot({ path: "../../.context/e2e/maquinas-pop.png" });
  await page.getByTestId("machine-add").click();
  await expect(page.getByTestId("machines-empty")).toBeVisible();
  await page.getByTestId("machine-name").fill("Mac do escritório");
  await page.getByTestId("machine-url").fill("mac-escritorio.tailnet.ts.net");
  await page.getByTestId("machine-save").click();
  await expect(page.getByTestId("machine-item")).toContainText("ws://mac-escritorio.tailnet.ts.net:7777/ws");
  await page.getByTestId("machine-picker").click();
  await expect(page.getByTestId("machine-row")).toContainText("⌃2");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("Control+2");
  expect(await page.evaluate(() => localStorage.getItem("kabul.machine"))).toMatch(/^m/);
  await page.keyboard.press("Control+1");
  expect(await page.evaluate(() => localStorage.getItem("kabul.machine"))).toBe("local");
});
