import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");

test("terminal grande como aba: preset (Claude) roda ao abrir a aba ⌘⇧T, uma vez por sessão; comando livre", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-aparencia").click();
  await page.getByTestId("term-preset").selectOption("claude");
  await page.getByTestId("ws-row").click();
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-term-tab").click();
  await expect(host(page).locator(".ctab.on")).toContainText("claude 1");
  await expect.poll(() => page.evaluate(() => (window as any).__termInput?.filter((x: string[]) => x[1] === "claude\r").length ?? 0)).toBe(1);
  // Comando livre.
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-aparencia").click();
  await page.getByTestId("term-preset").selectOption("custom");
  await page.getByTestId("term-preset-cmd").fill("npm run dev");
  await page.getByTestId("ws-row").click();
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-term-tab").click();
  await expect.poll(() => page.evaluate(() => (window as any).__termInput?.some((x: string[]) => x[1] === "npm run dev\r"))).toBe(true);
  expect(await page.evaluate(() => (window as any).__termInput.filter((x: string[]) => x[1] === "claude\r").length)).toBe(1);
});
