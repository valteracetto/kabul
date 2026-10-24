import { test, expect, type Page } from "@playwright/test";

async function addRepo(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  if (!(await page.getByTestId("repo-path").isVisible())) { await page.getByTestId("add-project").click(); }
  await page.getByTestId("repo-path").fill("/mock/repos/demo");
  await page.getByTestId("repo-path").press("Enter");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".repo-name", { hasText: "demo" })).toBeVisible();
}

test("⌘N: criar com a primeira mensagem já enviada", async ({ page }) => {
  await addRepo(page);
  await page.keyboard.press("Meta+n");
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expect(page.getByTestId("create-text")).toHaveAttribute("placeholder", "No que você quer trabalhar?");
  await page.getByTestId("create-more").click();
  await page.getByTestId("create-base").selectOption("feat/relatorio-pdf");
  await page.keyboard.press("Escape");
  await page.getByTestId("create-text").fill("Liste os arquivos do projeto");
  await page.screenshot({ path: "../../.context/e2e/criar-modal.png" });
  await page.getByTestId("create-text").press("Enter");
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await expect(page.locator(".ws-host:not([hidden]) .msg-user")).toContainText("Liste os arquivos do projeto");
  await expect(page.locator(".ws-host:not([hidden]) .msg-assistant")).toContainText("Recebi");
});

test("⌘⇧N: criar a partir de PR, branch e issue; backlog com ⌥↵", async ({ page }) => {
  await addRepo(page);
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.getByTestId("create-from-panel")).toBeVisible();
  await expect(page.getByTestId("create-from-item")).toContainText("#42 Corrige login no Safari");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("create-from-item").first()).toContainText("main");
  await page.getByTestId("create-from-item").filter({ hasText: "feat/relatorio-pdf" }).click();
  await expect(page.getByTestId("create-source")).toContainText("feat/relatorio-pdf");
  await page.getByTestId("create-text").fill("rascunho para depois");
  await page.getByTestId("create-text").press("Alt+Enter");
  await expect(page.locator(".ws-host:not([hidden]) .crumb-branch")).toHaveText("feat/relatorio-pdf");
  await expect(page.locator(".ws-host:not([hidden])").getByTestId("composer")).toHaveValue("rascunho para depois");
  await expect(page.locator(".ws-host:not([hidden]) .msg-user")).toHaveCount(0);
});

test("+ do repo e Criar abrem o modal com o repo selecionado (não criam direto)", async ({ page }) => {
  await addRepo(page);
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  if (!(await page.getByTestId("repo-path").isVisible())) { await page.getByTestId("add-project").click(); }
  await page.getByTestId("repo-path").fill("/mock/repos/outro");
  await page.getByTestId("repo-path").press("Enter");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-outro").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expect(page.getByTestId("create-repo")).toContainText("outro");
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-demo").click();
  await expect(page.getByTestId("create-repo")).toContainText("demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
});

test("Criar abre o modal; Adicionar projeto só no seletor de repo (rodapé); ⌥⌘A; estado vazio", async ({ page }) => {
  await page.goto("/?mock");
  await expect(page.locator(".side-nav button", { hasText: "Adicionar projeto" })).toHaveCount(0);
  await page.getByTestId("empty-add-project").click();
  await expect(page.getByTestId("repo-path")).toBeFocused();
  await page.getByTestId("repo-path").fill("/mock/repos/demo");
  await page.getByTestId("repo-path").press("Enter");
  await expect(page.getByTestId("create-repo")).toContainText("demo");
  await page.getByTestId("create-repo").click();
  await expect(page.locator(".repo-search input")).toBeFocused();
  await expect(page.getByTestId("add-project")).toContainText("Adicionar projeto");
  await page.getByTestId("add-project").click();
  await page.getByTestId("repo-path").fill("/mock/repos/outro");
  await page.getByTestId("repo-path").press("Enter");
  await expect(page.getByTestId("create-repo")).toContainText("outro");
  await page.screenshot({ path: "../../.context/e2e/criar-seletor-repo.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Alt+a");
  await expect(page.getByTestId("repo-path")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await page.getByTestId("create-from").click();
  await expect(page.getByTestId("create-from-panel")).toBeVisible();
});

test("Onde roda: Este Mac, nuvem do provedor (só com Claude), em breve; lembra por repo", async ({ page }) => {
  await addRepo(page);
  await page.getByTestId("create-ws").click();
  await page.getByTestId("create-where").click();
  await expect(page.getByTestId("where-remote")).toHaveClass(/disabled/);
  await expect(page.getByTestId("where-kabul_cloud")).toContainText("em breve");
  await page.getByTestId("where-provider_cloud").click();
  await expect(page.getByTestId("create-where")).toContainText("Nuvem do provedor");
  await page.screenshot({ path: "../../.context/e2e/criar-onde-roda.png" });
  await page.getByTestId("create-text").fill("responda ok");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("cloud-tab")).toContainText("session_01MockCloud");
  // Lembrou a escolha para o repo.
  await page.keyboard.press("Meta+n");
  await expect(page.getByTestId("create-where")).toContainText("Nuvem do provedor");
  // Modelo local: nuvem do provedor fica indisponível.
  await page.locator(".create-foot .picker-trigger").click();
  await page.locator(".pop-search input").fill("qwen");
  await page.locator(".pop-row.model", { hasText: "Qwen3 8B" }).click();
  await expect(page.getByTestId("create-where")).toContainText("Este Mac");
});
