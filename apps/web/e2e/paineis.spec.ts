import { addRepo } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";

async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  await addRepo(page, "/mock/repos/demo");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-demo").click();
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}
const width = (page: Page, sel: string) => page.locator(sel).evaluate((e) => e.getBoundingClientRect().width);
const height = (page: Page, sel: string) => page.locator(sel).evaluate((e) => e.getBoundingClientRect().height);
async function drag(page: Page, testid: string, dx: number, dy: number) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, testid === "resize-bottom" ? y : y + 200);
  await page.mouse.down();
  await page.mouse.move(x + dx, (testid === "resize-bottom" ? y : y + 200) + dy, { steps: 8 });
  await page.mouse.up();
}

test("painéis redimensionáveis: arrastar, limites, duplo clique, recolher, persistência", async ({ page }) => {
  await setup(page);
  const s0 = await width(page, ".sidebar");
  await drag(page, "resize-sidebar", 80, 0);
  expect(await width(page, ".sidebar")).toBeGreaterThan(s0 + 60);
  await drag(page, "resize-sidebar", 2000, 0);
  expect(await width(page, ".sidebar")).toBeLessThanOrEqual(521); // máximo
  await page.getByTestId("resize-sidebar").dblclick();
  expect(Math.round(await width(page, ".sidebar"))).toBe(Math.round(s0)); // padrão

  const r0 = await width(page, ".right");
  await drag(page, "resize-right", -100, 0);
  expect(await width(page, ".right")).toBeGreaterThan(r0 + 80);
  const r1 = await width(page, ".right");

  const b0 = await height(page, ".bottom");
  await drag(page, "resize-bottom", 0, -80);
  expect(await height(page, ".bottom")).toBeGreaterThan(b0 + 60);
  // O xterm acompanha (fit) e nada encavala: terminal dentro do painel.
  const term = await page.locator(".term-host").boundingBox();
  const bottom = await page.locator(".bottom").boundingBox();
  expect(term!.y + term!.height).toBeLessThanOrEqual(bottom!.y + bottom!.height + 1);
  await page.screenshot({ path: "../../.context/e2e/paineis-redimensionados.png" });

  // Persistência: recarrega e mantém o tamanho do painel direito.
  await page.reload();
  await setup(page);
  expect(Math.abs((await width(page, ".right")) - r1)).toBeLessThan(2);

  // Arrastar abaixo do mínimo recolhe.
  await drag(page, "resize-right", 900, 0);
  await expect(page.locator(".right")).toBeHidden();
  await page.getByTestId("toggle-right").click();
  await expect(page.locator(".right")).toBeVisible();
  await drag(page, "resize-sidebar", -700, 0);
  await expect(page.locator(".sidebar")).toHaveCount(0);
});
