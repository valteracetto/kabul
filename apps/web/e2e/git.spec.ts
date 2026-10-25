import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const mock = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => ((window as any).__mock[f as string](...(a as unknown[])), window.dispatchEvent(new Event("kabul:git-refresh"))), [fn, args] as const);
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}
const lastUser = (page: Page) => host(page).locator(".msg-user").last();

test("git: botão principal muda com o estado; ready, corrigir erros (⌘⇧X) com log, commit e push (⌘⇧Y), pull (⌘⇧L), abrir PR (⌘⇧G)", async ({ page }) => {
  await setup(page);
  await expect(host(page).getByTestId("create-pr")).toHaveAttribute("data-action", "create-pr");
  await host(page).getByTestId("create-pr").click();
  await expect(page.getByTestId("pr-form")).toBeVisible();
  await page.keyboard.press("Escape");
  // PR rascunho (checks passando) → "Pronto para revisão"
  await page.evaluate(() => ((window as any).__mock.db.checks = { checks: [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://github.com/dev/demo/actions/runs/101/job/1", workflow: "CI" }], message: null }));
  await mock(page, "pr", null, { is_draft: true, merge_state: "DRAFT" });
  await expect(page.getByTestId("pr-pill")).toContainText("#7 Rascunho");
  await expect(page.getByTestId("git-primary")).toHaveAttribute("data-action", "ready");
  await page.getByTestId("git-primary").click();
  await host(page).getByTestId("tab-checks").click();
  await expect(page.getByTestId("git-result")).toContainText("gh pr ready");
  await expect(page.getByTestId("git-primary")).toHaveAttribute("data-action", "merge");
  await page.evaluate(() => delete (window as any).__mock.db.checks);
  await mock(page, "git", null, {});
  // Check falhando → "Corrigir erros"; ⌘⇧X manda o prompt com o log
  await expect(page.getByTestId("git-primary")).toHaveAttribute("data-action", "fix");
  await expect(host(page).getByTestId("tab-checks")).toContainText("1");
  await page.keyboard.press("Meta+Shift+x");
  await expect(lastUser(page)).toContainText("Os checks do PR falharam");
  await expect(lastUser(page)).toContainText("no-unused-vars");
  // Mudança não commitada → "Commit e push" (⌘⇧Y vai para o agente)
  await mock(page, "change", null, "main.rs", 'fn main() {\n    println!("tchau");\n}\n');
  await expect(page.getByTestId("git-primary")).toHaveAttribute("data-action", "commit");
  await expect(host(page).getByTestId("gitrow-uncommitted")).toContainText("1 mudança não commitada");
  await page.keyboard.press("Meta+Shift+y");
  await expect(lastUser(page)).toContainText("Faça commit de todas as mudanças");
  // Atrás do remoto → Pull (⌘⇧L)
  await mock(page, "git", null, { upstream: "origin/dev/kabul", behind: 2 });
  await expect(host(page).getByTestId("gitrow-behind")).toContainText("2 commits atrás do remoto");
  await page.keyboard.press("Meta+Shift+l");
  await expect(page.getByTestId("git-result")).toContainText("git pull --no-rebase --no-edit origin");
  await expect(host(page).getByTestId("gitrow-behind")).toHaveCount(0);
  // Detalhes do PR e ⌘⇧G
  await page.getByTestId("pr-pill").click();
  await expect(page.getByTestId("pr-details")).toContainText("dev/kabul");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Shift+g");
  await expect.poll(() => page.evaluate(() => (window as any).__external)).toBe("https://github.com/dev/demo/pull/7");
  // Menu com todas as ações (as indisponíveis apagadas)
  await page.getByTestId("git-menu").click();
  await expect(page.getByTestId("git-ready")).toHaveClass(/disabled/);
  await expect(page.getByTestId("git-commit")).not.toHaveClass(/disabled/);
  await page.screenshot({ path: "../../.context/e2e/git-menu.png" });
  await page.keyboard.press("Escape");
});

test("Checks: log embutido, enviar log ao chat, re-rodar falhas, PR editável, comentários ao chat; merge com arquivar", async ({ page }) => {
  await setup(page);
  await mock(page, "pr", null, { review_decision: "CHANGES_REQUESTED", comments: [{ author: "rev", body: "Faltou teste", url: null, path: null, line: null, kind: "comment", state: null }, { author: "rev", body: "Nome ruim", url: null, path: "src/app.tsx", line: 12, kind: "inline", state: null }] });
  await host(page).getByTestId("tab-checks").click();
  await expect(host(page).getByTestId("gitrow-changes-requested")).toBeVisible();
  await host(page).getByTestId("check-row").first().click();
  await expect(host(page).getByTestId("check-log")).toContainText("no-unused-vars");
  await host(page).getByTestId("log-to-chat").click();
  await expect(host(page).getByTestId("composer")).toHaveValue(/O check "lint" falhou/);
  await host(page).getByTestId("composer").fill("");
  await host(page).getByTestId("checks-rerun").click();
  await expect(page.getByTestId("git-result")).toContainText("gh run rerun 102 --failed");
  await page.getByTestId("pr-edit").click();
  await page.getByTestId("pr-title-input").fill("Corrige o login no Safari");
  await page.getByTestId("pr-save").click();
  await expect(page.getByTestId("pr-title")).toHaveText("Corrige o login no Safari");
  await expect(page.getByTestId("pr-comment")).toHaveCount(2);
  await host(page).getByTestId("comments-all").click();
  await expect(host(page).getByTestId("composer")).toHaveValue(/rev em src\/app.tsx:12: Nome ruim/);
  await page.screenshot({ path: "../../.context/e2e/checks.png" });
  // Merge pelo menu; com "arquivar ao fazer merge" o workspace sai da lista.
  await page.evaluate(() => ((window as any).__mock.db.settings.archive_on_merge = true));
  await page.getByTestId("git-menu").click();
  await page.getByTestId("git-merge").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
});

test("arquivar com agente rodando: parar e arquivar; fechar o PR junto", async ({ page }) => {
  await setup(page);
  await mock(page, "pr", null, {});
  await page.evaluate(() => { const w = (window as any).__mock.db.workspaces[0]; w.pr_url = "https://github.com/dev/demo/pull/7"; });
  await host(page).getByTestId("composer").fill("crie o arquivo");
  await host(page).getByTestId("composer").press("Enter");
  await expect(host(page).getByTestId("approval")).toBeVisible();
  await page.keyboard.press("Meta+Shift+a");
  await expect(page.getByTestId("confirm")).toContainText("Há um agente rodando");
  await expect(page.getByTestId("confirm-ok")).toHaveText("Parar agentes e arquivar");
  await page.getByTestId("confirm-check").check();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
  // O PR fecha no segundo plano, junto com o resto do arquivamento.
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.pr[(window as any).__mock.db.workspaces[0].id].state)).toBe("CLOSED");
});
