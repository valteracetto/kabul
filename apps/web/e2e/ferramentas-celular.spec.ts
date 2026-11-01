import { test, expect, devices, type Page } from "../playwright-silencio";

// Ferramentas no celular (PWA, só leitura), no iPhone e no Android: Configurações → Ferramentas e o atalho
// da tela inicial; catálogo por categoria, fontes, saúde e a folha de detalhe com o SKILL.md. Mock com
// home sintético.
// Tela, toque e user agent de cada aparelho; o navegador é o do projeto (Chromium), como nos outros specs.
const semNavegador = ({ defaultBrowserType: _, ...d }: (typeof devices)[string]) => d;
const APARELHOS = [
  { nome: "iphone", uso: semNavegador(devices["iPhone 15"]) },
  { nome: "android", uso: semNavegador(devices["Pixel 7"]) },
];

async function catalogo(page: Page) {
  const tela = page.getByTestId("m-tools");
  await expect(tela).toBeVisible();
  await expect(page.getByTestId("m-tools-row").first()).toBeVisible();
  expect(await page.getByTestId("m-tools-row").count()).toBeGreaterThan(10);
  await expect(page.getByTestId("m-tools-group").first()).toBeVisible();
}

for (const a of APARELHOS) {
  test.describe(a.nome, () => {
    test.use(a.uso);

    test(`${a.nome}: Configurações → Ferramentas, abas e detalhe`, async ({ page }) => {
      await page.goto("/m/?mock");
      await page.getByTestId("m-tab-settings").click();
      await page.getByTestId("m-tools-entry").click();
      await expect(page).toHaveURL(/#v=tools/);
      await catalogo(page);
      // Busca.
      await page.getByTestId("m-tools-search").fill("deploy");
      await expect(page.getByTestId("m-tools-row")).toHaveCount(1);
      await page.getByTestId("m-tools-search").fill("");
      // Fontes e saúde.
      await page.getByTestId("m-tools-seg-sources").click();
      await expect(page.getByTestId("m-tools-source").filter({ hasText: "acme/agent-skills" })).toBeVisible();
      await page.getByTestId("m-tools-seg-health").click();
      await expect(page.getByTestId("m-tools-finding").filter({ hasText: "link quebrado" }).first()).toBeVisible();
      // Achado com item abre o detalhe.
      await page.getByTestId("m-tools-finding").filter({ hasText: "cópias idênticas" }).click();
      await expect(page.getByTestId("m-tools-sheet")).toContainText("deploy-checklist");
      await expect(page.getByTestId("m-tools-place")).toHaveCount(4);
      await page.goBack();
      await expect(page.getByTestId("m-tools-sheet")).toHaveCount(0);
      // Catálogo → detalhe com o SKILL.md renderizado e como chamar.
      await page.getByTestId("m-tools-seg-catalog").click();
      await page.getByTestId("m-tools-row").filter({ hasText: "test-driven-development" }).click();
      const sheet = page.getByTestId("m-tools-sheet");
      await expect(sheet.getByTestId("m-tools-body").locator(".md-h1")).toHaveText("test-driven-development");
      await expect(sheet.getByTestId("m-tools-invoke")).toContainText("/test-driven-development");
      // Só leitura: nada de "mostrar na pasta" no celular.
      await expect(sheet.getByTestId("tools-reveal")).toHaveCount(0);
      await page.goBack();
      await expect(sheet).toHaveCount(0);
      await page.getByTestId("m-tools-back").click();
      await expect(page.getByTestId("m-tools")).toHaveCount(0);
    });

    test(`${a.nome}: atalho na tela inicial`, async ({ page }) => {
      await page.goto("/m/?mock");
      await page.getByTestId("m-tab-home").click();
      await page.getByTestId("m-tools-shortcut").click();
      await catalogo(page);
      await page.getByTestId("m-tools-back").click();
      await expect(page.getByTestId("m-list")).toBeVisible();
    });
  });
}
