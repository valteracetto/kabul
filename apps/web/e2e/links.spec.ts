import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
const link = (page: Page, url: string) => page.evaluate((u) => (window as any).__mock.emit("deep-link", u), url);

test("links kabul://: abrir workspace e conversa, criar workspace com prompt, configurações; link inválido avisa", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  // Duas conversas; o link da primeira volta para ela.
  await host(page).getByTestId("ctab").first().click({ button: "right" });
  await page.getByTestId("tab-copy-link").click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-chat").click();
  await expect(host(page).getByTestId("ctab")).toHaveCount(2);
  await page.getByTestId("settings").click();
  await link(page, url);
  await expect(host(page).getByTestId("ctab").first()).toHaveClass(/on/);
  // Criar a partir de link: repo e prompt preenchidos.
  await link(page, "kabul://create?repo=demo&prompt=Corrigir%20o%20login");
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expect(page.getByTestId("create-text")).toHaveValue("Corrigir o login");
  await expect(page.getByTestId("create-repo")).toContainText("demo");
  await page.keyboard.press("Escape");
  await link(page, "kabul://settings?tab=git");
  await expect(page.getByTestId("set-tab-git")).toHaveClass(/on/);
  await link(page, "kabul://nada");
  await expect(page.getByRole("alert")).toContainText("Link do Kabul inválido");
});

test("notificação: o clique (app volta para a frente) abre a conversa que avisou; badge com os não lidos", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await chat(page).getByTestId("composer").fill("devagar");
  await chat(page).getByTestId("composer").press("Enter");
  // Vai para outra aba enquanto o agente trabalha: ao terminar, notifica com a conversa de origem.
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-chat").click();
  await expect(host(page).getByTestId("ctab").nth(1)).toHaveClass(/on/);
  await expect.poll(() => page.evaluate(() => (window as any).__notified?.length ?? 0), { timeout: 8000 }).toBeGreaterThan(0);
  await page.getByTestId("settings").click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(host(page).getByTestId("ctab").first()).toHaveClass(/on/);
  // Badge acompanha os workspaces não lidos (marcar/desmarcar alterna entre 0 e 1).
  const badge = () => page.evaluate(() => (window as any).__badge ?? 0);
  await page.getByTestId("settings").click();
  const before = await badge();
  await page.getByTestId("ws-row").click({ button: "right" });
  await page.getByTestId("ctx-read").click();
  await expect.poll(badge).toBe(1 - before);
  await page.getByTestId("ws-row").click({ button: "right" });
  await page.getByTestId("ctx-read").click();
  await expect.poll(badge).toBe(before);
});
