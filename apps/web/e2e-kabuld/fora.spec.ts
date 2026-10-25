import { test, expect } from "@playwright/test";
import { startKabuld, type Kabuld } from "./helpers";

// Celular (dono): a lista mostra as sessões de fora do Kabul e "Continuar" retoma a mesma conversa.
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ fakeHome: true });
});
test.afterAll(() => kd?.stop());

test("celular: recentes fora do Kabul e continuar pela mesma sessão", async ({ page }) => {
  await page.goto(`${kd.base}/m/`);
  await expect(page.getByTestId("m-list")).toBeVisible();
  const ext = page.getByTestId("m-external");
  const rec = ext.getByTestId("m-external-recent").filter({ hasText: "Arrumar o login (de fora)" });
  await expect(rec).toBeVisible({ timeout: 20_000 });
  await expect(rec).toContainText("Claude Code");
  await rec.getByTestId("m-external-continue").click();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await page.getByTestId("m-chat-input").fill("segue daqui");
  await page.getByTestId("m-chat-send").click();
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("retomada aaaa-1111-fora: eco: segue daqui");
});
