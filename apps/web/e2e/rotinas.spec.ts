import { test, expect, type Page } from "../playwright-silencio";
import { addRepo, navTo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
async function setup(page: Page) {
  await page.addInitScript(() => void ((window as any).__routinePoll = 400));
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}

test("Quadro: colunas por status; arrastar o cartão muda o status; clique abre o workspace", async ({ page }) => {
  await setup(page);
  await navTo(page, "dashboard");
  const card = page.getByTestId("kb-card").first();
  await expect(page.getByTestId("col-in-progress").getByTestId("kb-card")).toHaveCount(1);
  const from = (await card.boundingBox())!;
  const to = (await page.getByTestId("col-in-review").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 8 });
  await expect(page.getByTestId("col-in-review")).toHaveClass(/over/);
  await page.mouse.up();
  await expect(page.getByTestId("col-in-review").getByTestId("kb-card")).toHaveCount(1);
  await page.getByTestId("col-in-review").getByTestId("kb-card").click();
  await expect(host(page).getByTestId("composer")).toBeVisible();
  await expect(host(page).getByTestId("status-pill")).toContainText("Em revisão");
});

test("Rotinas: cron validado (mínimo 15 min), próximas execuções, salvar ⌘S, rodar agora abre conversa; evento de PR (merge) dispara", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mock.pr(null, { state: "OPEN" }));
  await navTo(page, "routines");
  await page.getByTestId("routine-new").click();
  await page.getByTestId("routine-name").fill("Revisar PRs");
  await page.getByTestId("routine-prompt").fill("liste");
  await page.getByTestId("routine-cron").fill("*/5 * * * *");
  await expect(page.getByTestId("routine-error")).toContainText("Intervalo mínimo de 15 minutos");
  await page.getByTestId("routine-cron").fill("0 9 * * 1-5");
  await expect(page.getByTestId("routine-error")).toHaveCount(0);
  await expect(page.getByTestId("routine-next")).toContainText("09:00");
  await page.keyboard.press("Meta+s");
  await expect(page.getByTestId("routine-row")).toContainText("cron 0 9 * * 1-5");
  await page.getByTestId("routine-run").click();
  await expect(page.getByTestId("routine-runrow")).toContainText("manual");
  // A conversa da rotina nasce no workspace (em segundo plano) e o prompt é enviado.
  await page.getByTestId("ws-row").click();
  await expect(host(page).getByTestId("ctab")).toHaveCount(2);
  await expect(host(page).locator(".ctab.on")).toContainText("Revisar PRs");
  await expect(host(page).locator(".center-body:not([hidden]) .msg-user")).toHaveText("liste");
  // Evento do PR: com merge, roda.
  await navTo(page, "routines");
  await page.getByTestId("routine-new").click();
  await page.getByTestId("routine-name").fill("Depois do merge");
  await page.getByTestId("routine-prompt").fill("liste de novo");
  await page.getByTestId("routine-trigger").selectOption("merged");
  await page.getByTestId("routine-save").click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as any).__mock.pr(null, { state: "MERGED" }));
  await expect(page.getByTestId("routine-runrow")).toContainText("PR com merge", { timeout: 5000 });
});
