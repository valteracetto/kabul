import { test, expect } from "@playwright/test";
import { startKabuld, type Kabuld } from "./helpers";

// Desktop (Chromium, 1440 px) servido pelo próprio kabuld: o navegador local é o dono.
// Configurações › Celular e remoto, e operar outra máquina pareada pelo mesmo transporte.
let kd: Kabuld;
let outra: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld();
  outra = await startKabuld({ trustLocalBrowser: false, repoName: "repo-da-outra" });
});
test.afterAll(() => (kd?.stop(), outra?.stop()));

test("Celular e remoto: QR com validade, regenerar, ampliar, dispositivos com revogar, convite e outra máquina pelo seletor", async ({ page, request }) => {
  await page.goto(`${kd.base}/`);
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = false));
  await expect(page.getByTestId("machine-picker")).toBeVisible();
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("button", { name: "Celular e remoto" }).click();
  const panel = page.getByTestId("remote-panel");
  await expect(panel.getByTestId("remote-on")).toBeVisible();
  await expect(panel.getByTestId("remote-address")).toContainText(`127.0.0.1:${kd.port}`);
  // kabuld de teste sobe com --no-tailscale: o painel diz que só este computador acessa.
  await expect(panel.getByTestId("remote-net-badge")).toHaveText("só local");
  await expect(panel.getByTestId("remote-https")).toHaveCount(0);

  // QR de pareamento com validade; regenerar invalida o anterior.
  const url1 = (await panel.getByTestId("ticket-url").first().textContent())!;
  expect(url1).toContain("/m/#pair=");
  await expect(panel.getByTestId("ticket-left").first()).toContainText(/Expira em [45]:\d\d/);
  await expect(panel.getByTestId("ticket-qr").first().locator("svg")).toBeVisible();
  await panel.getByTestId("ticket-regen").first().click();
  await expect(panel.getByTestId("ticket-url").first()).not.toHaveText(url1);
  const url2 = (await panel.getByTestId("ticket-url").first().textContent())!;
  const token = (u: string) => new URLSearchParams(u.split("#")[1]).get("pair")!;
  const old = await request.post(`${kd.base}/api/pair`, { data: { token: token(url1), user: "x", device: "y" } });
  expect(old.status()).toBe(401);

  // Ampliar.
  await panel.getByTestId("pair-enlarge").click();
  await expect(page.getByTestId("pair-big")).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/kabuld-painel-qr-grande.png" });
  await page.getByTestId("pair-big").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("pair-big")).toHaveCount(0);

  // Um aparelho pareia com o QR atual e aparece na lista; revogar tira.
  const ok = await request.post(`${kd.base}/api/pair`, { data: { token: token(url2), user: "Dev", device: "iPhone" } });
  expect(ok.status()).toBe(200);
  await expect(panel.getByTestId("device-row")).toContainText("Dev · iPhone", { timeout: 8000 });
  await page.screenshot({ path: "../../.context/e2e/kabuld-painel.png", fullPage: true });
  await panel.getByTestId("device-revoke").click();
  await panel.getByTestId("device-revoke-confirm").click();
  await expect(panel.getByTestId("devices-empty")).toBeVisible();

  // Convite de observador para o workspace.
  await panel.getByTestId("invite-role").selectOption("observer");
  await panel.getByTestId("invite-go").click();
  await expect(panel.getByTestId("ticket-url").last()).toContainText("&w=w1");

  // Outra máquina: cola o link de pareamento dela, aparece no seletor e opera por WebSocket.
  await panel.getByTestId("machine-pair-name").fill("Mac do escritório");
  await panel.getByTestId("machine-pair-link").fill(outra.pairLink);
  await panel.getByTestId("machine-pair-go").click();
  await expect(panel.getByTestId("machine-pair-ok")).toContainText("Mac do escritório");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kabul.machines") ?? "[]"));
  expect(saved[0].url).toBe(`ws://127.0.0.1:${outra.port}/ws`);
  expect(saved[0].device).toMatch(/^d_/);
  await page.getByTestId("machine-picker").click();
  await page.getByTestId("machine-row").filter({ hasText: "Mac do escritório" }).click();
  await page.waitForLoadState("load");
  await expect(page.getByTestId("machine-picker")).toContainText("Mac do escritório");
  await expect(page.locator("body")).toContainText("repo-da-outra", { timeout: 10_000 });
  await page.screenshot({ path: "../../.context/e2e/kabuld-outra-maquina.png" });
  await page.evaluate(() => localStorage.setItem("kabul.machine", "local"));
});
