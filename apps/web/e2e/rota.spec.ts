import { test, expect } from "../playwright-silencio";
import { addRepo } from "./helpers";

test("ao abrir, volta à última rota; links do workspace e da conversa", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  const host = page.locator(".ws-host:not([hidden])");
  await host.getByTestId("ws-menu").click();
  await page.getByTestId("ws-copy-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^kabul:\/\/workspace\?id=/);
  await host.getByTestId("ctab").first().click({ button: "right" });
  await page.getByTestId("tab-copy-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/&session=chat-/);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-git").click();
  // O mock perde o estado ao recarregar; a rota salva aponta para as configurações (que sempre existem).
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("kabul.lastRoute")))!)).toMatchObject({ kind: "settings", tab: "git" });
});
