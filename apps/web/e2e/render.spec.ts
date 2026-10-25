import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
test("Mermaid e KaTeX desenhados (com fallback para a fonte) e chips de arquivos no rodapé do turno", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await chat(page).getByTestId("composer").fill("liste");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).getByTestId("file-chip")).toHaveText(/main\.rs \+1 −1/);
  await chat(page).getByTestId("file-chip").click();
  await expect(page.locator(".ws-host:not([hidden])").locator("[data-testid=filediff], [data-testid=fileview]")).toContainText("main.rs");
  await page.locator(".ws-host:not([hidden])").getByTestId("ctab").first().click();
  await chat(page).getByTestId("composer").fill("faça um diagrama");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).getByTestId("mermaid").locator("svg").first()).toBeVisible({ timeout: 20_000 });
  await expect(chat(page).getByTestId("katex").locator(".katex")).toBeVisible();
  await expect(chat(page).locator(".md-render-err")).toContainText("Não deu para desenhar");
  await expect(chat(page).getByText("Copiar fonte do Mermaid").first()).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/mermaid-katex.png" });
});
