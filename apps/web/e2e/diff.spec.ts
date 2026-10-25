import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
async function setup(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await page.evaluate(() => {
    const m = (window as any).__mock;
    m.change(null, "main.rs", 'fn main() {\n    println!("olá");\n    let x = 1;  \n}\n');
    m.change(null, "README.md", "# demo\n\nNovo texto.\n");
    m.change(null, "notas.txt", "arquivo novo\n");
  });
}

test("diff: unificado/lado a lado, opções, realce, visto ⌃V, ↑↓ entre arquivos, ⌥⌘J/K, escopo, branch alvo, menu do arquivo", async ({ page }) => {
  await setup(page);
  await host(page).locator(".rtab", { hasText: "Alterações" }).click();
  await expect(host(page).getByTestId("change-row")).toHaveCount(3);
  await host(page).getByTestId("change-row").filter({ hasText: "main.rs" }).click();
  await expect(host(page).getByTestId("patch")).toContainText('println!("olá");');
  await expect(host(page).locator(".patch .hl-str").first()).toBeVisible();
  // Lado a lado
  await host(page).getByTestId("diff-split").click();
  await expect(host(page).locator(".patch.split .srow").first()).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/diff-split.png" });
  await host(page).getByText("Unificado").click();
  // Opções: quebra de linha e ocultar espaços
  await host(page).getByTestId("diff-options").click();
  await page.getByTestId("diff-wrap").check();
  await expect(host(page).locator(".filediff.wrap")).toBeVisible();
  await page.keyboard.press("Escape");
  // Comentários e ⌥⌘J
  await host(page).locator(".pl .ln.can").nth(1).click();
  await host(page).locator(".comment-box textarea").fill("Use uma constante");
  await host(page).locator(".comment-box textarea").press("Enter");
  await host(page).locator(".pl .ln.can").nth(2).click();
  await host(page).locator(".comment-box textarea").fill("Nome melhor");
  await host(page).locator(".comment-box textarea").press("Enter");
  await expect(host(page).getByTestId("diff-comment")).toHaveCount(2);
  await host(page).getByTestId("filediff").focus();
  await page.keyboard.press("Meta+Alt+j");
  await expect(host(page).locator(".comment.focus")).toContainText("Use uma constante");
  await page.keyboard.press("Meta+Alt+j");
  await expect(host(page).locator(".comment.focus")).toContainText("Nome melhor");
  // Visto (⌃V) e ↓ para o próximo arquivo
  await page.keyboard.press("Control+v");
  await expect(host(page).getByTestId("diff-viewed")).toBeChecked();
  await expect(host(page).getByTestId("change-row").filter({ hasText: "main.rs" })).toHaveClass(/viewed/);
  await host(page).getByTestId("filediff").focus();
  await page.keyboard.press("ArrowDown");
  await expect(host(page).getByTestId("filediff").locator("code").first()).toHaveText("README.md");
  await page.keyboard.press("ArrowUp");
  await expect(host(page).getByTestId("filediff").locator("code").first()).toHaveText("main.rs");
  // Escopo: commits da branch não mostra o arquivo novo
  await host(page).getByTestId("diff-scope").selectOption("branch");
  await expect(host(page).getByTestId("change-row")).toHaveCount(2);
  await host(page).getByTestId("diff-scope").selectOption("all");
  await host(page).getByTestId("changes-filter").fill("read");
  await expect(host(page).getByTestId("change-row")).toHaveCount(1);
  await host(page).getByTestId("changes-filter").fill("");
  // Branch alvo
  await host(page).getByTestId("target-branch").click();
  await page.getByTestId("target-row").filter({ hasText: "feat/relatorio-pdf" }).click();
  await expect(host(page).getByTestId("target-branch")).toContainText("feat/relatorio-pdf");
  // Menu do arquivo: copiar caminho relativo, anexar no chat, descartar
  await host(page).getByTestId("change-row").filter({ hasText: "notas.txt" }).click({ button: "right" });
  await page.getByTestId("file-copy-rel").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("notas.txt");
  await host(page).getByTestId("change-row").filter({ hasText: "notas.txt" }).click({ button: "right" });
  await page.getByTestId("file-discard").click();
  await page.getByTestId("confirm-ok").click();
  await expect(host(page).getByTestId("change-row")).toHaveCount(2);
});

test("⌘P abre arquivo, ⌘⇧F busca nos arquivos, ⌘F busca no chat (⌘G)", async ({ page }) => {
  await setup(page);
  await expect(host(page).locator(".rtab", { hasText: "Alterações" })).toContainText("3");
  await host(page).getByTestId("composer").focus();
  await page.keyboard.press("Meta+p");
  await page.getByTestId("quick-open-input").fill("mainrs");
  await expect(page.getByTestId("quick-open-row").first()).toContainText("main.rs");
  await page.keyboard.press("Enter");
  await expect(host(page).getByTestId("filediff")).toBeVisible();
  await page.keyboard.press("Meta+Shift+f");
  await page.getByTestId("search-files-input").fill("PRINTLN");
  await expect(page.getByTestId("search-hit")).toHaveCount(1);
  await page.screenshot({ path: "../../.context/e2e/buscar-arquivos.png" });
  await page.keyboard.press("Enter");
  await expect(host(page).getByTestId("fileview").locator(".pl.hit")).toContainText("println");
  // Busca no chat
  await host(page).getByTestId("ctab").first().click();
  await host(page).getByTestId("composer").fill("liste os arquivos");
  await host(page).getByTestId("composer").press("Enter");
  await expect(host(page).locator(".turn-meta")).toBeVisible();
  await page.keyboard.press("Meta+f");
  await page.getByTestId("chat-find-input").fill("arquivo");
  await expect(page.getByTestId("chat-find-count")).toHaveText(/^1\/\d+$/);
  const total = Number((await page.getByTestId("chat-find-count").textContent())!.split("/")[1]);
  expect(total).toBeGreaterThan(1);
  await page.keyboard.press("Meta+g");
  await expect(page.getByTestId("chat-find-count")).toHaveText(`2/${total}`);
  await page.keyboard.press("Meta+Shift+g");
  await expect(page.getByTestId("chat-find-count")).toHaveText(`1/${total}`);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chat-find")).toHaveCount(0);
});
