import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

// Arquivar é instantâneo para o usuário: o workspace some na hora (mesmo com o backend lento), com
// "Desfazer"; o trabalho pesado roda em segundo plano e um erro lá volta o workspace com "Tentar de novo".

async function setup(page: Page, n = 2) {
  await page.goto("/?mock");
  for (let i = 0; i < n; i++) {
    await page.getByTestId("create-ws").click();
    if (i === 0) await addRepo(page, "/mock/repos/demo");
    await page.getByTestId("create-go").click();
    await expect(page.getByTestId("ws-row")).toHaveCount(i + 1);
  }
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.workspaces.every((w: any) => w.state === "ready"))).toBe(true);
}
const row = (page: Page, name: string) => page.getByTestId("ws-row").filter({ hasText: name });
const mockSet = (page: Page, o: Record<string, unknown>) => page.evaluate((o) => Object.assign((window as any).__mock, o), o);
const state = (page: Page, name: string) => page.evaluate((n) => (window as any).__mock.db.workspaces.find((w: any) => w.name === n)?.state, name);

async function archive(page: Page, name: string) {
  await row(page, name).hover();
  await row(page, name).getByTestId("archive").click();
  await page.getByTestId("confirm-ok").click();
}

test("some da lista na hora, mesmo com o backend demorando; termina em segundo plano", async ({ page }) => {
  await setup(page);
  // A chamada leva 4 s e o trabalho mais 4 s (como o backend síncrono de antes, com node_modules grande).
  await mockSet(page, { archiveCallMs: 4000, archiveMs: 4000 });
  const t0 = Date.now();
  await archive(page, "Kabul");
  await expect(page.getByTestId("ws-row")).toHaveCount(1, { timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1500);
  await expect(page.getByTestId("archive-toast")).toContainText("Arquivando Kabul");
  await expect(page.getByTestId("archive-undo")).toBeVisible();
  // A lista continua respondendo enquanto isso: dá para arquivar outro (em paralelo, sem fila).
  await archive(page, "Lisboa");
  await expect(page.getByTestId("ws-row")).toHaveCount(0, { timeout: 1000 });
  await page.screenshot({ path: "../../.context/e2e/arquivar-instantaneo.png" });
  await expect.poll(() => state(page, "kabul"), { timeout: 10_000 }).toBe("archived");
  await expect.poll(() => state(page, "lisboa"), { timeout: 10_000 }).toBe("archived");
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
  // Arquivados: pela paleta, como antes.
  await page.keyboard.press("Meta+k");
  await page.getByTestId("pal-tab-workspaces").click();
  await page.getByTestId("pal-archived").click();
  await expect(page.getByTestId("pal-row")).toHaveCount(2);
});

test("desfazer volta o workspace na hora e cancela o arquivamento", async ({ page }) => {
  await setup(page);
  await mockSet(page, { archiveMs: 3000 });
  await archive(page, "Kabul");
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await expect.poll(() => state(page, "kabul")).toBe("archiving");
  // Na paleta, o arquivado ainda em andamento aparece como "arquivando…".
  await page.keyboard.press("Meta+k");
  await page.getByTestId("pal-tab-workspaces").click();
  await page.getByTestId("pal-archived").click();
  await expect(page.getByTestId("pal-row")).toContainText("arquivando…");
  await page.keyboard.press("Escape");
  await page.getByTestId("archive-undo").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(2, { timeout: 1000 });
  await expect(page.getByTestId("archive-toast")).toHaveCount(0);
  await expect.poll(() => state(page, "kabul")).toBe("ready");
  // O "fim" do arquivamento cancelado não acontece.
  await page.waitForTimeout(3500);
  expect(await state(page, "kabul")).toBe("ready");
  await expect(page.getByTestId("ws-row")).toHaveCount(2);
});

test("erro no segundo plano: o workspace volta e o aviso oferece tentar de novo", async ({ page }) => {
  await setup(page);
  await mockSet(page, { archiveMs: 400, archiveFail: "git ocupado (busy:merge); termine a operação antes de arquivar" });
  await archive(page, "Lisboa");
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  // Falhou: volta para a lista e o aviso troca o "Arquivando…" pelo erro, com "Tentar de novo".
  await expect(row(page, "Lisboa")).toHaveCount(1, { timeout: 5000 });
  await expect(page.getByTestId("archive-toast")).toContainText("Não deu para arquivar Lisboa");
  await expect(page.getByTestId("archive-toast")).toContainText("git ocupado");
  await page.screenshot({ path: "../../.context/e2e/arquivar-erro.png" });
  // Resolvido o problema, "Tentar de novo" arquiva sem perguntar de novo.
  await mockSet(page, { archiveFail: null });
  await page.getByTestId("archive-retry").click();
  await expect(page.getByTestId("confirm")).toHaveCount(0);
  await expect(row(page, "Lisboa")).toHaveCount(0, { timeout: 1000 });
  await expect.poll(() => state(page, "lisboa"), { timeout: 5000 }).toBe("archived");
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
});
