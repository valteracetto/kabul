import { test, expect, type Page } from "../playwright-silencio";

const settings = (page: Page) => page.evaluate(() => (window as any).__mock.db.settings);

test("atualizações: versão, opção automática, canal beta, sem rede não quebra, instalar", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-avancado").click();
  await expect(page.getByTestId("app-version")).toHaveText(/^\d+\.\d+\.\d+/);

  // Liga/desliga e troca de canal ficam nas configurações do app.
  await page.getByTestId("toggle-auto_update").click();
  await expect.poll(() => settings(page)).toMatchObject({ auto_update: false });
  await page.getByTestId("toggle-auto_update").click();
  await page.getByTestId("update-channel").selectOption("beta");
  await expect.poll(() => settings(page)).toMatchObject({ auto_update: true, update_channel: "beta" });

  // Sem rede: mensagem curta, a página segue funcionando.
  await page.evaluate(() => ((window as any).__mock.offline = true));
  await page.getByTestId("update-check").click();
  await expect(page.getByTestId("update-status")).toContainText("Sem conexão");
  await expect(page.getByTestId("update-check")).toBeEnabled();

  // Já na mais nova.
  await page.evaluate(() => ((window as any).__mock.offline = false));
  await page.getByTestId("update-check").click();
  await expect(page.getByTestId("update-status")).toContainText("versão mais nova");

  // Versão nova no canal beta: botão de instalar.
  await page.evaluate(() => ((window as any).__mock.update = { version: "9.9.9-beta.1" }));
  await page.getByTestId("update-check").click();
  await expect(page.getByTestId("update-status")).toContainText("9.9.9-beta.1");
  await page.getByTestId("update-install-now").click();
  await expect.poll(() => page.evaluate(() => (window as any).__updateInstalled)).toBe(true);
});

test("atualizações: aviso no topo quando a checagem automática acha versão nova", async ({ page }) => {
  await page.goto("/?mock");
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  await page.evaluate(() => (window as any).__mock.emit("update-available", { current: "0.9.0", version: "0.10.0", notes: null, date: null, channel: "stable" }));
  await expect(page.getByTestId("update-banner")).toContainText("Kabul 0.10.0 disponível");
  await page.getByTestId("update-install").click();
  await expect.poll(() => page.evaluate(() => (window as any).__updateInstalled)).toBe(true);
});
