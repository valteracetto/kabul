/* i18n-ignore-file: nomes de repositório e donos fictícios. */
import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

// Ícone do repositório = avatar do dono no GitHub (organização ou usuário), sem rede: o mock devolve uma
// imagem fixa para os repos listados em `__mockAvatar.owners`. Prioridade: emoji > avatar > letra (também
// enquanto carrega e sem rede).

async function mockAvatar(page: Page, cfg: { owners: Record<string, string>; offline?: boolean }) {
  await page.addInitScript((c) => ((window as any).__mockAvatar = c), cfg);
}

const head = (page: Page, repo: string) => page.getByTestId(`repo-${repo}`);

test("desktop: avatar do GitHub na barra lateral; emoji vence; desligar volta à letra; Atualizar", async ({ page }) => {
  await mockAvatar(page, { owners: { demo: "acme" } });
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  // Segundo repo (só local) pelo seletor de projeto do Criar.
  await page.getByTestId("create-ws").click();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  await addRepo(page, "/mock/repos/so-local");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(2);

  // Repo do GitHub: avatar (imagem local em data URL, sem rede no WebView). Repo só local: letra.
  const av = head(page, "demo").getByTestId("repo-avatar");
  await expect(av).toBeVisible();
  expect(await av.getAttribute("src")).toMatch(/^data:image\//);
  await expect(av).toHaveAttribute("title", "github.com/acme");
  await expect(head(page, "so-local").getByTestId("repo-avatar")).toHaveCount(0);
  await expect(head(page, "so-local").locator(".repo-mark")).toHaveText("S");
  // Uma busca por repo na sessão (a barra, o topo e os menus dividem o mesmo resultado).
  const calls = await page.evaluate(() => (window as any).__mockAvatar.calls.length);
  expect(calls).toBeLessThanOrEqual(2);

  // Configurações › Diversos: opção ligada por padrão, com o dono e o Atualizar.
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-diversos").click();
  const row = page.locator('[data-setting="github_avatar"]');
  await expect(page.getByTestId("toggle-github-avatar")).toHaveAttribute("aria-checked", "true");
  await expect(row).toContainText("github.com/acme");
  await page.getByTestId("github-avatar-refresh").click();
  await expect.poll(() => page.evaluate(() => (window as any).__mockAvatar.calls.some((c: any) => c.refresh))).toBe(true);
  await expect(page.getByTestId("github-avatar-refresh")).toBeEnabled();

  // Emoji escolhido vence o avatar; "nenhum" volta ao avatar.
  await page.getByTestId("repo-icon").nth(1).click();
  await expect(head(page, "demo")).toContainText("🚀");
  await expect(head(page, "demo").getByTestId("repo-avatar")).toHaveCount(0);
  await page.getByTestId("repo-icon").nth(0).click();
  await expect(head(page, "demo").getByTestId("repo-avatar")).toBeVisible();

  // Desligar "Usar a imagem do GitHub": letra colorida.
  await page.getByTestId("toggle-github-avatar").click();
  await expect(page.getByTestId("toggle-github-avatar")).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => (window as any).__mock.db.repos.find((r: any) => r.name === "demo").github_avatar)).toBe(false);
  await expect(head(page, "demo").getByTestId("repo-avatar")).toHaveCount(0);
  await expect(head(page, "demo").locator(".repo-mark")).toHaveText("D");
  // Religar: o avatar volta.
  await page.getByTestId("toggle-github-avatar").click();
  await expect(head(page, "demo").getByTestId("repo-avatar")).toBeVisible();
});

test("desktop: sem rede fica a letra; Atualizar com a rede de volta traz o avatar", async ({ page }) => {
  await mockAvatar(page, { owners: { demo: "acme" }, offline: true });
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(head(page, "demo").locator(".repo-mark")).toHaveText("D");
  await expect(head(page, "demo").getByTestId("repo-avatar")).toHaveCount(0);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-diversos").click();
  await expect(page.locator('[data-setting="github_avatar"]')).toContainText("sem rede");
  await page.evaluate(() => ((window as any).__mockAvatar.offline = false));
  await page.getByTestId("github-avatar-refresh").click();
  await expect(head(page, "demo").getByTestId("repo-avatar")).toBeVisible();
});

const MOBILE = { viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true };

test.describe("celular", () => {
  test.use(MOBILE);

  test("avatar do GitHub no grupo do repositório e na lista de repos", async ({ page }) => {
    await mockAvatar(page, { owners: { "acme-web": "acme" } });
    await page.goto("/m/?mock&demo&quieto");
    const web = page.locator(".m-grp-head").filter({ hasText: "acme-web" }).first();
    await expect(web.getByTestId("repo-avatar")).toBeVisible();
    expect(await web.getByTestId("repo-avatar").getAttribute("src")).toMatch(/^data:image\//);
    // Repo sem GitHub no mock: letra.
    const api = page.locator(".m-grp-head").filter({ hasText: "acme-api" }).first();
    await expect(api.locator(".repo-mark")).toHaveText("A");
    await expect(api.getByTestId("repo-avatar")).toHaveCount(0);
  });

  test("sem rede: letra no lugar do avatar", async ({ page }) => {
    await mockAvatar(page, { owners: { "acme-web": "acme" }, offline: true });
    await page.goto("/m/?mock&demo&quieto");
    const web = page.locator(".m-grp-head").filter({ hasText: "acme-web" }).first();
    await expect(web.locator(".repo-mark")).toHaveText("A");
    await expect(web.getByTestId("repo-avatar")).toHaveCount(0);
  });
});
