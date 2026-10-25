import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

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

test("MCP compartilhado: origem, peso, perfis, economia e escolha lembrada na sessão", async ({ page }) => {
  await setup(page);
  await page.getByTestId("composer").fill("Liste os arquivos");
  await page.getByTestId("composer").press("Enter");
  await expect(page.locator(".turn-meta")).toBeVisible();
  await page.getByTestId("apps").click();
  const panel = page.getByTestId("mcp-panel");
  const row = (n: string) => page.getByTestId("mcp-row").filter({ hasText: n });
  // Registro único: o linear aparece com as duas origens; o docs só do projeto do Claude.
  await expect(row("linear")).toContainText("do Claude");
  await expect(row("linear")).toContainText("do Codex");
  await expect(row("docs")).toContainText("do Claude");
  // Peso: ferramentas vistas na sessão + tokens medidos; o docs ainda sem medida.
  await expect(row("linear").getByTestId("mcp-weight")).toContainText("2 ferramentas · ~3,2k tokens");
  await row("docs").getByTestId("mcp-weigh").click();
  await expect(row("docs").getByTestId("mcp-weight")).toContainText("6 ferramentas · ~900 tokens");
  await expect(page.getByTestId("mcp-savings")).toContainText("~4,1k tokens/turno");
  // Perfil "Só o essencial": marca o docs com ★ e desliga o resto; mostra a economia.
  await row("docs").getByTestId("mcp-star").click();
  await page.getByTestId("mcp-profile-essential").click();
  await expect(row("linear")).toHaveClass(/off/);
  await expect(row("docs")).not.toHaveClass(/off/);
  await expect(page.getByTestId("mcp-savings")).toContainText("−3,2k tokens por turno");
  // A escolha fica na sessão: fecha e abre o painel, continua igual.
  await page.getByTestId("apps").click();
  await page.getByTestId("apps").click();
  await expect(row("linear")).toHaveClass(/off/);
  // "Todos" volta tudo.
  await page.getByTestId("mcp-profile-all").click();
  await expect(row("linear")).not.toHaveClass(/off/);
  await expect(panel).not.toContainText("−");
  // Só nos CLIs de origem.
  await row("docs").getByTestId("mcp-share").click();
  await expect(row("docs").getByTestId("mcp-share")).not.toHaveClass(/on/);
});
