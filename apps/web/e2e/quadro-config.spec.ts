import { test, expect, type Locator, type Page } from "../playwright-silencio";
import { addRepo, navTo } from "./helpers";

/**
 * Quadro configurável (mock): colunas editáveis na engrenagem, vínculo com issue, mover o card atualiza
 * a issue (Linear de mentira), sem correspondência, erro com Tentar de novo e Desfazer.
 */
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await navTo(page, "dashboard");
}

async function dragTo(page: Page, card: Locator, col: Locator) {
  const from = (await card.boundingBox())!;
  const to = (await col.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 8 });
  await expect(col).toHaveClass(/over/);
  await page.mouse.up();
}

const rows = (page: Page) => page.getByTestId("board-col-row");
const calls = (page: Page) => page.evaluate(() => (window as any).__mock.boardCalls ?? []);

test("Quadro: engrenagem configura as colunas (nome, ícone, cor, ordem, adicionar, apagar movendo os cards)", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".kb-head .kb-name")).toHaveText(["Todo", "In progress", "In review", "Done"]);
  await page.getByTestId("board-settings").click();
  await expect(page.getByTestId("board-cfg")).toBeVisible();
  await expect(page.getByTestId("board-sync")).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => rows(page).getByTestId("board-col-name").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["Todo", "In progress", "In review", "Done"]);
  await expect(rows(page).first().getByTestId("board-col-up")).toBeDisabled();
  await expect(rows(page).last().getByTestId("board-col-down")).toBeDisabled();

  // Renomear (Enter grava) e trocar ícone/cor pelo seletor.
  await rows(page).first().getByTestId("board-col-name").fill("A fazer");
  await rows(page).first().getByTestId("board-col-name").press("Enter");
  await expect(page.locator(".kb-head .kb-name").first()).toHaveText("A fazer");
  await rows(page).first().getByTestId("board-col-icon").click();
  await page.getByTestId("board-icon-backlog").click();
  await page.getByTestId("board-color-blue").click();
  await expect(page.getByTestId("col-backlog").locator(".col-icon")).toHaveAttribute("data-icon", "backlog");
  await expect(page.getByTestId("col-backlog").locator(".col-icon")).toHaveAttribute("style", /--bc-blue/);

  // Subir/descer e arrastar pela alça.
  await rows(page).nth(3).getByTestId("board-col-up").click();
  await expect(page.locator(".kb-head .kb-name")).toHaveText(["A fazer", "In progress", "Done", "In review"]);
  const handle = rows(page).nth(3).getByTestId("board-col-drag");
  const target = (await rows(page).nth(2).boundingBox())!;
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(target.x + 30, target.y + 8, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".kb-head .kb-name")).toHaveText(["A fazer", "In progress", "In review", "Done"]);

  // Adicionar status: entra no fim com o nome selecionado.
  await page.getByTestId("board-add").click();
  await expect(rows(page)).toHaveCount(5);
  await rows(page).last().getByTestId("board-col-name").fill("Bloqueado");
  await rows(page).last().getByTestId("board-col-name").press("Enter");
  await expect(page.locator(".kb-head .kb-name")).toHaveText(["A fazer", "In progress", "In review", "Done", "Bloqueado"]);

  // Apagar coluna com card: pergunta para onde vão os cards.
  await expect(page.getByTestId("col-in-progress").getByTestId("kb-card")).toHaveCount(1);
  await rows(page).nth(1).getByTestId("board-col-delete").click();
  await expect(page.getByTestId("board-delete-confirm")).toContainText("Mover 1 card de \"In progress\" para:");
  await page.getByTestId("board-delete-target").selectOption({ label: "In review" });
  await page.getByTestId("board-delete-ok").click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("col-in-review").getByTestId("kb-card")).toHaveCount(1);
  // Coluna vazia sai direto.
  await rows(page).last().getByTestId("board-col-delete").click();
  await expect(rows(page)).toHaveCount(3);
  await page.screenshot({ path: "../../.context/e2e/quadro-config.png" });

  // Fecha com Esc; o status do workspace no cabeçalho usa o nome da coluna.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-cfg")).toHaveCount(0);
  await page.getByTestId("col-in-review").getByTestId("kb-card").click();
  await expect(page.locator(".ws-host:not([hidden])").getByTestId("status-pill")).toContainText("In review");
});

test("Quadro: repositório com colunas próprias (desligado herda as globais)", async ({ page }) => {
  await setup(page);
  await page.getByTestId("board-repo").selectOption({ label: "demo" });
  await page.getByTestId("board-settings").click();
  await expect(page.getByTestId("board-cfg-scope")).toContainText("demo");
  await expect(page.getByTestId("board-own")).toHaveAttribute("aria-checked", "false");
  await expect(rows(page).first().getByTestId("board-col-name")).toBeDisabled();
  await page.getByTestId("board-own").click();
  await expect(page.getByTestId("board-own")).toHaveAttribute("aria-checked", "true");
  await rows(page).first().getByTestId("board-col-name").fill("Fila");
  await rows(page).first().getByTestId("board-col-name").press("Enter");
  await expect(page.locator(".kb-head .kb-name").first()).toHaveText("Fila");
  // Todos os repositórios: o global não mudou.
  await page.keyboard.press("Escape");
  await page.getByTestId("board-repo").selectOption({ value: "" });
  await expect(page.locator(".kb-head .kb-name").first()).toHaveText("Todo");
});

test("Quadro: mover card vinculado atualiza a issue no Linear; Desfazer volta o card e o estado", async ({ page }) => {
  await setup(page);
  const card = page.getByTestId("kb-card").first();
  await card.hover();
  await card.getByTestId("kb-link").click();
  await page.getByTestId("kb-link-input").fill("https://linear.app/acme/issue/ENG-12/corrigir-login");
  await page.getByTestId("kb-link-input").press("Enter");
  await expect(card.getByTestId("kb-issue")).toContainText("ENG-12");

  await page.getByTestId("board-settings").click();
  await page.getByTestId("board-sync").click();
  await expect(page.getByTestId("board-sync")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("board-reverse")).toBeVisible();
  // Correspondência automática por nome/tipo.
  await expect(rows(page).getByTestId("board-col-map")).toHaveText(["Linear: Todo", "Linear: In Progress", "Linear: In Review", "Linear: Done"]);
  await page.keyboard.press("Escape");

  await dragTo(page, page.getByTestId("kb-card").first(), page.getByTestId("col-in-review"));
  const fb = page.getByTestId("board-feedback");
  await expect(fb).toHaveAttribute("data-status", "ok");
  await expect(fb).toContainText("ENG-12 → In Review no Linear");
  await expect(page.getByTestId("col-in-review").getByTestId("kb-issue")).toContainText("In Review");
  expect(await calls(page)).toEqual([{ issue: "ENG-12", tracker: "linear", to: "In Review" }]);

  await page.getByTestId("board-undo").click();
  await expect(page.getByTestId("col-in-progress").getByTestId("kb-card")).toHaveCount(1);
  await expect.poll(() => calls(page)).toEqual([{ issue: "ENG-12", tracker: "linear", to: "In Review" }, { issue: "ENG-12", tracker: "linear", to: "Todo" }]);
});

test("Quadro: coluna sem correspondência avisa e não mexe na issue", async ({ page }) => {
  await setup(page);
  const card = page.getByTestId("kb-card").first();
  await card.hover();
  await card.getByTestId("kb-link").click();
  await page.getByTestId("kb-link-input").fill("ENG-7");
  await page.getByTestId("kb-link-ok").click();
  await page.getByTestId("board-settings").click();
  await page.getByTestId("board-sync").click();
  await page.getByTestId("board-add").click();
  await rows(page).last().getByTestId("board-col-name").fill("Bloqueado");
  await rows(page).last().getByTestId("board-col-name").press("Enter");
  await rows(page).last().getByTestId("board-col-icon").click();
  await page.getByTestId("board-icon-blocked").click();
  await expect(rows(page).last().getByTestId("board-col-map")).toHaveText("Linear: sem correspondência");
  // Override manual: "Nunca sincronizar" numa coluna que casava.
  await rows(page).nth(2).getByTestId("board-col-map").click();
  await page.getByTestId("board-map-linear").selectOption("off");
  await expect(rows(page).nth(2).getByTestId("board-col-map")).toHaveText("Linear: sem correspondência");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const blocked = page.locator(".kb-col").last();
  await dragTo(page, page.getByTestId("kb-card").first(), blocked);
  const fb = page.getByTestId("board-feedback");
  await expect(fb).toHaveAttribute("data-status", "no_match");
  await expect(fb).toContainText("sem correspondência no Linear para \"Bloqueado\"");
  await expect(blocked.getByTestId("kb-card")).toHaveCount(1);
  expect(await calls(page)).toEqual([]);
});

test("Quadro: erro do rastreador fica visível com Tentar de novo e Desfazer", async ({ page }) => {
  await setup(page);
  const card = page.getByTestId("kb-card").first();
  await card.hover();
  await card.getByTestId("kb-link").click();
  await page.getByTestId("kb-link-input").fill("acme/demo#12");
  await page.getByTestId("kb-link-input").press("Enter");
  await expect(card.getByTestId("kb-issue")).toContainText("#12");
  await page.getByTestId("board-settings").click();
  await page.getByTestId("board-sync").click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => ((window as any).__mock.boardFail = "gh issue: HTTP 403: Resource not accessible"));

  await dragTo(page, page.getByTestId("kb-card").first(), page.getByTestId("col-done"));
  const fb = page.getByTestId("board-feedback");
  await expect(fb).toHaveAttribute("data-status", "error");
  await expect(fb).toHaveAttribute("role", "alert");
  await expect(fb).toContainText("Não deu para atualizar #12 no GitHub: gh issue: HTTP 403");
  await expect(page.getByTestId("col-done").getByTestId("kb-card")).toHaveCount(1);

  // Tentar de novo (agora o GitHub aceita): fecha a issue.
  await page.evaluate(() => ((window as any).__mock.boardFail = null));
  await page.getByTestId("board-retry").click();
  await expect(fb).toHaveAttribute("data-status", "ok");
  await expect(fb).toContainText("#12 → Closed no GitHub");

  // Erro de novo e Desfazer: o card volta.
  await page.evaluate(() => ((window as any).__mock.boardFail = "rede caiu"));
  await dragTo(page, page.getByTestId("col-done").getByTestId("kb-card"), page.getByTestId("col-in-review"));
  await expect(fb).toHaveAttribute("data-status", "error");
  await page.getByTestId("board-undo").click();
  await expect(page.getByTestId("col-done").getByTestId("kb-card")).toHaveCount(1);
});

test("Quadro: o menu de status da barra lateral usa as colunas e sincroniza", async ({ page }) => {
  await setup(page);
  await page.getByTestId("board-settings").click();
  await rows(page).first().getByTestId("board-col-name").fill("Fila");
  await rows(page).first().getByTestId("board-col-name").press("Enter");
  await page.keyboard.press("Escape");
  await page.getByTestId("ws-row").first().click({ button: "right" });
  await page.getByTestId("ctx-status").hover();
  await expect(page.getByTestId("ctx-status-backlog")).toContainText("Fila");
  await page.getByTestId("ctx-status-backlog").click();
  await expect(page.getByTestId("col-backlog").getByTestId("kb-card")).toHaveCount(1);
  await expect(page.getByTestId("board-feedback")).toContainText("→ Fila");
});

test.describe("tema claro", () => {
  test.use({ colorScheme: "light" });
  test.beforeEach(async ({ page }) => page.addInitScript(() => localStorage.setItem("kabul.theme", "light")));
  test("Quadro: popover e correspondência no tema claro", async ({ page }) => {
    await setup(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByTestId("board-settings").click();
    await page.getByTestId("board-sync").click();
    await expect(rows(page).first().getByTestId("board-col-map")).toHaveText("Linear: Todo");
    await rows(page).nth(1).getByTestId("board-col-map").click();
    await expect(page.getByTestId("board-col-mapping")).toBeVisible();
    await page.screenshot({ path: "../../.context/e2e/quadro-config-claro.png" });
  });
});
