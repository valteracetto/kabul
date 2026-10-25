import { addRepo } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";

// Rodapé do turno no formato do Val, igual em pt-BR e em inglês: "2m, 21s · 23:36" e "45s" abaixo de 1 min
// (nunca "2 min 21 s" nem "11:36 PM"). A árvore de subagentes mostra "2m 21s" nos dois idiomas.
// O relógio da página é adiantado (page.clock) no meio do turno lento do mock ("devagar").
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
async function send(page: Page, text: string) {
  await chat(page).getByTestId("composer").fill(text);
  await chat(page).getByTestId("composer").press("Enter");
}

for (const locale of ["pt-BR", "en-US"]) {
  test.describe(locale, () => {
    test.use({ locale });
    test(`rodapé do turno compacto (${locale}): "2m, 21s · HH:MM", "45s" e subagente "2m 21s"`, async ({ page }) => {
      await page.clock.install();
      await page.goto("/?mock");
      await page.getByTestId("create-ws").click();
      if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
      await addRepo(page, "/mock/repos/demo");
      await page.getByTestId("create-go").click();
      await expect(page.getByTestId("ws-row")).toHaveCount(1);
      await page.getByTestId("ws-row").click();

      // Turno de 2 min 21 s: o subagente (Task) começa ~1,5 s depois; aí o relógio pula 2 min 21 s.
      await send(page, "faça devagar");
      await expect(chat(page).locator('[data-testid=tool-card][data-tool=Task]')).toBeVisible();
      await page.clock.fastForward("02:21");
      const meta = chat(page).getByTestId("turn-time");
      await expect(meta).toHaveCount(1);
      await expect(meta).toHaveText(/^2m, 2\ds · \d{2}:\d{2}$/);
      await chat(page).getByTestId("subagents-btn").click();
      await expect(page.getByTestId("subagent-row")).toHaveAttribute("data-status", "done");
      await expect(page.getByTestId("subagent-row")).toContainText(/2m 2\ds/);
      await page.keyboard.press("Escape");

      // Abaixo de 1 min: só segundos, colados ("45s").
      await send(page, "faça devagar de novo");
      await expect(chat(page).locator("[data-testid=tool-card][data-state=running]")).toHaveCount(1);
      await page.clock.fastForward("00:44");
      await expect(meta).toHaveCount(2);
      await expect(meta.last()).toHaveText(/^4[4-6]s · \d{2}:\d{2}$/);
    });
  });
}
