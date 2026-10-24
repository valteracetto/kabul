import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

const shot = (page: Page, name: string) => page.screenshot({ path: `../../.context/e2e/r3-${name}.png` });
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

test("MCP da sessão, contexto, minimapa", async ({ page }) => {
  await setup(page);
  await page.getByTestId("composer").fill("Liste os arquivos");
  await page.getByTestId("composer").press("Enter");
  await expect(page.locator(".turn-meta")).toBeVisible();
  await page.getByTestId("apps").click();
  await expect(page.getByTestId("mcp-row")).toHaveCount(2);
  await expect(page.getByTestId("mcp-panel")).toContainText("2 ferramentas");
  await expect(page.getByTestId("mcp-panel")).toContainText("falhou");
  await page.getByTestId("mcp-row").first().locator(".toggle").click();
  await expect(page.getByTestId("mcp-row").first()).toHaveClass(/off/);
  await shot(page, "mcp");
  await page.getByTestId("apps").click();
  await page.getByTestId("context-ring").click();
  await expect(page.getByTestId("context-panel")).toContainText("Mensagens");
  await expect(page.getByTestId("context-panel")).toContainText("de 200k tokens");
  await shot(page, "contexto");
  await page.getByTestId("turn-more").first().click();
  await expect(page.locator(".turn-pop")).toContainText("Restaurar arquivos");
  await page.getByTestId("turn-more").first().click();
  await page.getByTestId("new-terminal").click();
  await expect(page.locator(".btab", { hasText: "Terminal 2" })).toBeVisible();
  await page.getByTestId("context-ring").click();
  await page.getByTestId("composer").fill("Mais uma");
  await page.getByTestId("composer").press("Enter");
  await expect(page.locator(".turn-meta")).toHaveCount(2);
  await expect(page.getByTestId("minimap").locator(".mm")).toHaveCount(4);
  // Próximo turno reinicia com o MCP desligado (aviso de continuação).
  await expect(page.locator(".notice").first()).toContainText("Continuando");
});

test("Linear: conectar, criar workspace da issue, @mencionar, PR com Closes", async ({ page }) => {
  await setup(page);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-integracoes").click();
  await page.getByTestId("integrations").locator("input").fill("lin_api_teste");
  await page.getByTestId("integrations").getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByTestId("integrations")).toContainText("conectado");
  await page.getByTestId("create-ws").click();
  await page.getByTestId("create-from").click();
  await page.locator(".create-from .rtab", { hasText: "Issues" }).click();
  await expect(page.getByTestId("create-from-item")).toHaveCount(2);
  await shot(page, "linear-picker");
  await page.getByTestId("create-from-item").first().click();
  await page.getByTestId("create-text").press("Alt+Enter");
  const host = page.locator(".ws-host:not([hidden])");
  await expect(host.locator(".crumb-branch")).toHaveText("dev/eng-12-corrigir-login-no-safari");
  await expect(host.locator(".issue-chip")).toHaveText(/ENG-12/);
  await expect(host.getByTestId("composer")).toHaveValue(/Issue ENG-12: Corrigir login no Safari/);
  await host.getByTestId("composer").fill("veja @ENG");
  await expect(page.getByTestId("suggest")).toContainText("Corrigir login no Safari");
  await host.getByTestId("composer").press("Enter");
  await expect(host.getByTestId("composer")).toHaveValue(/\[ENG-12: Corrigir login no Safari\]\(https:\/\/linear\.app/);
  await host.getByTestId("create-pr").click();
  await expect(page.getByTestId("pr-form").locator("textarea")).toHaveValue(/Closes ENG-12/);
  await shot(page, "linear-ws");
});

test("tema, repos recolhíveis, Abrir em, árvore, Checks, semáforos", async ({ page }) => {
  await setup(page);
  // Abrir em: menu com números, copiar caminho, lembra o último.
  await page.getByTestId("open-in-menu").click();
  await expect(page.locator(".open-pop .pop-row")).toHaveCount(4);
  await page.keyboard.press("2");
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toBe("vscode:/mock/ws/kabul");
  await expect(page.getByTestId("open-in").locator(".btn.icon-only")).toHaveAttribute("title", "Abrir em VS Code");
  // Árvore com pastas e ícones.
  await page.locator(".rtab", { hasText: "Arquivos" }).click();
  await expect(page.getByTestId("tree-row").first()).toContainText(".context");
  await expect(page.getByTestId("tree-row").filter({ hasText: "docs" })).toBeVisible();
  await page.getByTestId("tree-row").filter({ hasText: "src" }).click();
  await expect(page.getByTestId("tree-row").filter({ hasText: "app.tsx" })).toBeVisible();
  await shot(page, "arvore");
  await page.evaluate(() => ((window as any).__mock.pr(null, {}), window.dispatchEvent(new Event("kabul:git-refresh"))));
  await page.getByTestId("tab-checks").click();
  await expect(page.getByTestId("checks")).toContainText("1 ok · 1 falhando · 1 rodando");
  await shot(page, "checks");
  // Repo recolhível com estado salvo.
  await page.getByTestId("repo-demo").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
  await page.getByTestId("repo-demo").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  // Barra lateral oculta: breadcrumb não fica embaixo dos semáforos (x >= 80).
  await page.keyboard.press("Meta+b");
  const crumb = await page.locator(".center-top .repo-mark").boundingBox();
  expect(crumb!.x).toBeGreaterThanOrEqual(80);
  await page.keyboard.press("Meta+b");
  // Tema claro e sistema.
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-aparencia").click();
  await page.locator(".theme-card", { hasText: "Claro" }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await shot(page, "tema-claro-config");
  await page.locator(".theme-card", { hasText: "Escuro" }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});
