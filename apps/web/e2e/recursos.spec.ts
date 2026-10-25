import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

test("recursos: chip com a memória, popover com CPU/Memória, árvore ordenável, agrupar, mostrar tudo e ir para o agente", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await page.getByTestId("ws-row").click();
  await chat(page).getByTestId("composer").fill("oi");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await page.locator(".side-nav button", { hasText: "Início" }).click();

  const chip = page.getByTestId("res-chip");
  await expect(chip).toContainText(/\d\.\d\d GB/);
  await chip.click();
  const pop = page.getByTestId("res-pop");
  await expect(pop).toContainText("RECURSOS");
  await expect(page.getByTestId("res-totals")).toContainText(/CPU \d+\.\d% Memória \d\.\d\d GB/);
  const rows = pop.getByTestId("res-row");
  await expect(rows.nth(0)).toContainText("App");
  await expect(rows.nth(1)).toContainText("Principal");
  // Mem ↓ por padrão: o claude (com os filhos) vem antes do codex.
  await expect(rows.nth(2)).toContainText("claude");
  await expect(rows).toHaveCount(8);
  await page.getByTestId("res-all").click();
  await expect(page.getByTestId("res-all")).toContainText("Mostrar menos");
  await expect(rows).toHaveCount(15);
  // Ordenar por nome (↑).
  await page.getByTestId("res-sort-name").click();
  await expect(rows.nth(2)).toContainText("claude");
  await expect(rows.nth(6)).toContainText("codex");
  await page.getByTestId("res-sort-mem").click();
  // Recolher o claude.
  await rows.nth(2).getByTestId("res-caret").click();
  await expect(pop.locator('[data-kind="terminal"]')).toHaveCount(0);
  await page.screenshot({ path: "../../.context/e2e/recursos.png" });
  // Só agentes e terminais; agrupado por workspace.
  await page.getByTestId("res-view-terminals").click();
  await expect(rows).toHaveCount(3);
  await page.getByTestId("res-view-workspace").click();
  await expect(rows.nth(0)).toHaveAttribute("data-kind", "workspace");
  await expect(rows.nth(1)).toContainText("claude");
  await page.getByTestId("res-view-tree").click();
  // Clique no agente leva ao workspace dele.
  await pop.locator('[data-kind="agent"]', { hasText: "claude" }).click();
  await expect(page.getByTestId("res-pop")).toHaveCount(0);
  await expect(chat(page).getByTestId("composer")).toBeVisible();
});

test("recursos: opção em Configurações › Geral esconde o chip", async ({ page }) => {
  await page.goto("/?mock");
  await expect(page.getByTestId("res-chip")).toBeVisible();
  await page.getByTestId("settings").click();
  await page.getByTestId("toggle-show_resources").click();
  await expect(page.getByTestId("res-chip")).toHaveCount(0);
});
