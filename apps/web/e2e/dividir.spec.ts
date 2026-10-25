import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const bodies = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

test("abas divididas: dividir à direita pelo menu da aba, setas ajustam de 2 em 2% (20–80%), ⌘D desfaz e divide", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-chat").click();
  await expect(host(page).getByTestId("ctab")).toHaveCount(2);
  await host(page).getByTestId("ctab").first().click();
  await host(page).getByTestId("ctab").nth(1).click({ button: "right" });
  await page.getByTestId("tab-split").click();
  await expect(bodies(page)).toHaveCount(2);
  const [a, b] = [(await bodies(page).nth(0).boundingBox())!, (await bodies(page).nth(1).boundingBox())!];
  expect(Math.abs(a.width - b.width)).toBeLessThan(12);
  // As duas conversas funcionam lado a lado.
  await bodies(page).nth(1).getByTestId("composer").fill("liste");
  await bodies(page).nth(1).getByTestId("composer").press("Enter");
  await expect(bodies(page).nth(1).locator(".turn-meta")).toHaveCount(1);
  await expect(bodies(page).nth(0).locator(".turn-meta")).toHaveCount(0);
  const div = host(page).getByTestId("split-divider");
  await div.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(div).toHaveAttribute("aria-valuenow", "60");
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
  await expect(div).toHaveAttribute("aria-valuenow", "20");
  await page.keyboard.press("Meta+d");
  await expect(bodies(page)).toHaveCount(1);
  await page.keyboard.press("Meta+d");
  await expect(bodies(page)).toHaveCount(2);
  await host(page).getByTestId("split-close").click();
  await expect(bodies(page)).toHaveCount(1);
});
