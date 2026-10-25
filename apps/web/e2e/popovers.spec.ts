import { test, expect, type Page, type Locator } from "../playwright-silencio";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");

/** Abre o menu, confere que abriu, clica fora (num alvo que também precisa reagir) e confere que fechou; depois o mesmo com Esc. */
async function check(page: Page, name: string, open: () => Promise<unknown>, menu: Locator, outside: Locator, afterOutside?: () => Promise<unknown>, pos?: { x: number; y: number }) {
  await open();
  await expect(menu, `${name}: abriu`).toBeVisible();
  await outside.click(pos ? { position: pos } : undefined);
  await expect(menu, `${name}: fechou com clique fora`).toHaveCount(0);
  if (afterOutside) await afterOutside();
  await open();
  await expect(menu, `${name}: abriu de novo`).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu, `${name}: fechou com Esc`).toHaveCount(0);
}

test("todo menu/popover fecha com clique fora (sem engolir o clique) e com Esc", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  // Modal de criação: seletor de repo, submenu Adicionar projeto, "···", onde roda.
  const text = page.getByTestId("create-text");
  const corner = { x: 840, y: 160 };
  await check(page, "seletor de repo", () => page.getByTestId("create-repo").click(), page.getByTestId("repo-pop"), text, () => expect(text).toBeFocused(), corner);
  await check(page, "submenu adicionar", async () => (await page.getByTestId("create-repo").click(), await page.getByTestId("add-project").click()), page.getByTestId("add-menu"), text, undefined, corner);
  await check(page, "··· do modal", () => page.getByTestId("create-more").click(), page.locator(".more-pop"), text, undefined, corner);
  await check(page, "onde roda", () => page.getByTestId("create-where").click(), page.locator(".where-pop"), text, undefined, corner);
  await check(page, "modelo no modal", () => page.locator(".create-modal .picker-trigger").click(), page.locator(".picker-pop"), text, undefined, corner);
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await host(page).getByTestId("composer").fill("liste");
  await host(page).getByTestId("composer").press("Enter");
  await expect(host(page).locator(".turn-meta")).toBeVisible();

  const composer = host(page).locator(".messages");
  const free = { x: 640, y: 420 };
  // O clique fora num botão da barra lateral precisa navegar (não é engolido).
  const home = page.getByTestId("settings");
  const backToWs = async () => (await expect(page.getByTestId("settings-page")).toBeVisible(), await page.getByTestId("ws-row").click());
  await check(page, "seletor de máquina", () => page.getByTestId("machine-picker").click(), page.getByTestId("machine-pop"), home, backToWs);
  await check(page, "··· do workspace", () => host(page).getByTestId("ws-menu").click(), page.locator(".ws-menu"), home, backToWs);
  await check(page, "status", () => host(page).getByTestId("status-pill").click(), page.locator(".status-pop").first(), composer, undefined, free);
  await check(page, "Abrir em", () => host(page).getByTestId("open-in-menu").click(), page.locator(".open-pop"), composer, undefined, free);
  await check(page, "+ de aba", () => host(page).getByTestId("new-tab").click(), page.locator(".plus-pop"), composer, undefined, free);
  await check(page, "modelo", () => host(page).locator(".composer .picker-trigger").click(), page.locator(".picker-pop"), composer, undefined, free);
  await check(page, "contexto", () => host(page).getByTestId("context-ring").click(), page.getByTestId("context-panel"), composer, undefined, free);
  await check(page, "MCP", () => host(page).getByTestId("apps").click(), page.getByTestId("mcp-panel"), composer, undefined, free);
  await check(page, "conta", () => page.getByTestId("account-chip").click(), page.locator(".account-pop"), composer, undefined, free);
  await check(page, "··· do turno", () => host(page).getByTestId("turn-more").click(), page.locator(".turn-pop"), composer, undefined, free);
  await check(page, "menu da aba", () => host(page).getByTestId("ctab").first().click({ button: "right" }), page.getByTestId("tab-menu"), composer, undefined, free);
});
