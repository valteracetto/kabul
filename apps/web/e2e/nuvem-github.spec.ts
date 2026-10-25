import { addRepo, navTo } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";

const shot = (page: Page, n: string) => page.screenshot({ path: `../../.context/e2e/ng-${n}.png` });
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

test("nuvem: criar pelo +, aba ☁︎, abrir no claude.ai, trazer para o Mac; ⌘K; espelhar", async ({ page }) => {
  await setup(page);
  await page.getByTestId("new-tab").click();
  await page.getByTestId("new-cloud").click();
  await page.getByTestId("cloud-dialog").locator("textarea").fill("responda ok");
  await page.getByTestId("cloud-dialog").locator("input").fill("env_123");
  await page.getByTestId("cloud-go").click();
  await expect(page.getByTestId("cloud-tab")).toContainText("session_01MockCloud");
  await expect(page.getByTestId("cloud-tab")).toContainText("not on GitHub");
  await expect(page.locator(".ctab", { hasText: "responda ok" })).toBeVisible();
  await expect(page.locator(".ctab").getByTestId("runs-on-provider_cloud")).toHaveAttribute("title", "Rodando na nuvem da Anthropic (claude.ai)");
  await expect(page.getByTestId("ws-row").getByTestId("runs-on-provider_cloud")).toBeVisible();
  await shot(page, "nuvem");
  await page.getByTestId("cloud-open").click();
  await expect.poll(() => page.evaluate(() => (window as any).__calls.includes("open_external"))).toBe(true);
  await page.getByTestId("cloud-teleport").click();
  await expect(page.locator(".ctab", { hasText: "Teleport" })).toBeVisible();
  // ⌘K → nuvem
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("nuvem");
  await page.locator(".palette .pop-row", { hasText: "Nova sessão na nuvem" }).first().click();
  await expect(page.getByTestId("cloud-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await navTo(page, "sessions");
  await expect(page.getByTestId("cloud-sessions")).toContainText("session_01MockCloud");
  await page.getByTestId("ws-row").click();
  // Espelhar no celular/claude.ai
  await page.getByTestId("ws-menu").click();
  await page.getByTestId("mirror-toggle").click();
  await expect(page.getByTestId("mirror-chip")).toContainText("espelhado ↗");
  await expect(page.getByTestId("mirror-chip").getByTestId("runs-on-mirrored")).toHaveAttribute("title", /espelhada/);
  await page.getByTestId("ws-menu").click();
  await page.getByTestId("mirror-toggle").click();
  await expect(page.getByTestId("mirror-chip")).toHaveCount(0);
});

test("GitHub: status, entrar com código, trocar conta, token, aviso de acesso e prefixo padrão", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("gh-warn")).toContainText("Missing GitHub access");
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-git").click();
  await expect(page.getByTestId("git-prefix")).toHaveValue("github");
  await page.getByTestId("set-tab-contas").click();
  await expect(page.getByTestId("github")).toContainText("@dev");
  await expect(page.getByTestId("github")).toContainText("repo, workflow");
  await page.getByTestId("gh-login").click();
  await expect(page.getByTestId("gh-code")).toHaveText("ABCD-1234");
  await expect(page.getByTestId("github")).toContainText("github.com/login/device");
  await shot(page, "github-codigo");
  await expect(page.getByTestId("github")).toContainText("Conta conectada.");
  await page.getByTestId("github").getByRole("button", { name: "Fechar" }).click();
  await page.getByTestId("gh-switch").click();
  await expect(page.getByTestId("github").locator(".acc-head")).toContainText("@dev-dois");
  await page.getByTestId("github").locator('input[type="password"]').fill("ghp_teste");
  await page.getByTestId("gh-token-save").click();
  await expect(page.getByTestId("github")).toContainText("token pessoal ativo");
  await shot(page, "github");
});
