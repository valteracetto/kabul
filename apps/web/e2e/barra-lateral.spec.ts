import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

async function setup(page: Page, n = 3) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?mock");
  for (let i = 0; i < n; i++) {
    await page.getByTestId("create-ws").click();
    if (i === 0) await addRepo(page, "/mock/repos/demo");
    await page.getByTestId("create-go").click();
    await expect(page.getByTestId("ws-row")).toHaveCount(i + 1);
  }
}
const row = (page: Page, name: string) => page.getByTestId("ws-row").filter({ hasText: name });

test("barra lateral: clique direito (lido R, fixar P, status, seção, renomear, copiar link, arquivar), Fixados, seções com emoji, agrupar por status, arrastar", async ({ page }) => {
  await setup(page);
  // Clique direito: não lido (R) e fixar (P)
  await row(page, "Lisboa").click({ button: "right" });
  await expect(page.getByTestId("ws-ctx")).toBeVisible();
  await page.keyboard.press("r");
  await expect(row(page, "Lisboa")).toHaveClass(/unread/);
  await row(page, "Lisboa").click({ button: "right" });
  await page.keyboard.press("p");
  await expect(page.getByTestId("pinned")).toContainText("Lisboa");
  // Status pelo submenu
  await row(page, "Cusco").click({ button: "right" });
  await page.getByTestId("ctx-status").hover();
  await page.getByTestId("ctx-status-backlog").click();
  await expect(row(page, "Cusco").locator(".st-icon")).toHaveClass(/st-backlog/);
  // Nova seção a partir do menu do workspace
  await row(page, "Cusco").click({ button: "right" });
  await page.getByTestId("ctx-section").hover();
  await page.getByTestId("ctx-section-new").click();
  await page.getByTestId("section-name").fill("Revisar amanhã");
  await page.getByTestId("section-save").click();
  await expect(page.getByTestId("section")).toContainText("Revisar amanhã");
  await expect(page.getByTestId("section")).toContainText("Cusco");
  // Renomear com a branch
  await row(page, "Kabul").click({ button: "right" });
  await page.getByTestId("ctx-rename").click();
  await page.getByTestId("rename-title").fill("Login no Safari");
  await page.getByTestId("rename-branch").check();
  await page.getByTestId("rename-save").click();
  await expect(row(page, "Login no Safari")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mock.db.workspaces.find((w: any) => w.title === "Login no Safari").branch)).toBe("dev/login-no-safari");
  // Copiar link
  await row(page, "Login no Safari").click({ button: "right" });
  await page.getByTestId("ctx-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^kabul:\/\/workspace\?id=/);
  // Arrastar para a seção (ponteiro, 5 px de limiar)
  const src = await row(page, "Login no Safari").boundingBox();
  const dst = await page.getByTestId("section").boundingBox();
  await page.mouse.move(src!.x + 20, src!.y + 10);
  await page.mouse.down();
  await page.mouse.move(src!.x + 22, src!.y + 14);
  await page.mouse.move(dst!.x + 30, dst!.y + 10, { steps: 6 });
  await expect(page.locator(".drag-ghost")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("section")).toContainText("Login no Safari");
  // Agrupar por status
  await page.getByTestId("group-menu").click();
  await page.getByTestId("group-status").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("status-group")).toHaveCount(0); // todos estão em seções/fixados
  await page.screenshot({ path: "../../.context/e2e/barra-lateral.png" });
  // Apagar seção devolve os workspaces
  await page.getByTestId("section").locator(".repo-row").click({ button: "right" });
  await page.getByTestId("section-delete").click();
  await expect(page.getByTestId("status-group")).toHaveCount(2);
  // Arquivar pelo menu
  await row(page, "Cusco").click({ button: "right" });
  await page.getByTestId("ctx-archive").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(2);
});

test("repo: clique direito (criar, ocultar, remover); ⌘⌥↓ e ⌘⇧H; não lido ao terminar fora da tela; ajuda e diagnóstico", async ({ page }) => {
  await setup(page, 2);
  await page.getByTestId("repo-demo").click({ button: "right" });
  await expect(page.getByTestId("repo-ctx")).toBeVisible();
  await page.getByTestId("repo-ctx-create").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("repo-demo").click({ button: "right" });
  await page.getByTestId("repo-ctx-hide").click();
  await expect(page.getByTestId("repo-demo")).toHaveCount(0);
  await page.getByTestId("group-menu").click();
  await page.getByTestId("toggle-hidden").click();
  await expect(page.getByTestId("repo-demo")).toBeVisible();
  await page.keyboard.press("Escape");
  // Navegação entre workspaces
  await page.getByTestId("ws-row").first().click();
  const first = await page.getByTestId("ws-row").first().getAttribute("data-ws");
  await page.keyboard.press("Meta+Alt+ArrowDown");
  await expect(page.getByTestId("ws-row").nth(1)).toHaveClass(/ on/);
  await page.keyboard.press("Meta+Shift+h");
  await expect(page.locator(".home")).toBeVisible();
  // Agente termina num workspace fora da tela → não lido
  await page.locator(`[data-ws="${first}"]`).click();
  const host = page.locator(".ws-host:not([hidden])");
  await host.getByTestId("composer").fill("tarefa demorada");
  await host.getByTestId("composer").press("Enter");
  await expect(page.locator(`[data-ws="${first}"] .spinner`)).toBeVisible();
  await page.locator(".side-nav button", { hasText: "Painel" }).click();
  await expect(page.locator(`[data-ws="${first}"]`)).toHaveClass(/unread/);
  await page.keyboard.press("Meta+Alt+l");
  await expect(page.locator(`[data-ws="${first}"]`)).not.toHaveClass(/unread/);
  // Ajuda e diagnóstico
  await page.getByTestId("help").click();
  await page.getByTestId("help-diagnostics").click();
  await expect(page.getByTestId("diag-row")).toHaveCount(4);
  await page.getByTestId("diag-copy-redacted").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("HOME ~");
  await page.keyboard.press("Meta+Alt+f");
  await page.getByTestId("feedback-text").fill("Gostei");
  await page.getByTestId("feedback-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Gostei\n\n---\nKabul v/);
});
