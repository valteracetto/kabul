import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

// Configuração legada de outro app: avisos do que não foi lido e "Importar configuração legada" com prévia e
// confirmação. O mock devolve o que o backend devolveria (os casos de leitura estão nos testes do kabul-core).
const mock = (page: Page) => page.evaluate(() => (window as any).__mock.db);

async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await page.evaluate(() => {
    const db = (window as any).__mock.db;
    db.repoLayers = [
      { name: "usuário", path: "~/.kabul/settings.toml", found: false, warnings: [] },
      { name: "repo", path: "/mock/repos/demo/.legado/settings.toml", found: true, warnings: [
        { file: "/mock/repos/demo/.legado/settings.toml", key: "file_include_globs", kind: "type", expected: "string|list", found: "integer" },
        { file: "/mock/repos/demo/.legado/settings.toml", key: "enterprise_data_privacy", kind: "unsupported" },
        { file: "/mock/repos/demo/.legado/settings.toml", key: "git.branch_prefix", kind: "app_setting", detail: "git" },
      ] },
      { name: "repo local", path: "/mock/repos/demo/.legado/settings.local.toml", found: false, warnings: [] },
      { name: "gerenciado", path: "~/.kabul/settings.managed.toml", found: false, warnings: [] },
    ];
    db.importPreview = {
      available: true,
      source: ".legado/",
      digest: "abc",
      warnings: [{ file: ".legado/settings.toml", key: "enterprise_data_privacy", kind: "unsupported" }],
      files: [{ source: ".legado/settings.toml", target: ".kabul/settings.toml", content: "# Importado de .legado/settings.toml.\n# Não importado: enterprise_data_privacy (sem equivalente no Kabul)\n\nschema_version = 1\n\n[scripts.run.dev]\ncommand = \"pnpm dev\"\ndefault = true\n" }],
    };
  });
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-repo").click();
}

test("configuração de outro app: avisos do que não foi lido e importação só com confirmação", async ({ page }) => {
  await setup(page);
  const warn = page.getByTestId("settings-warnings");
  await expect(warn).toContainText("Algumas configurações não foram lidas");
  await expect(page.getByTestId("settings-warning")).toHaveCount(3);
  await expect(page.getByTestId("settings-warning").nth(0)).toContainText(".legado/settings.toml › file_include_globs — tipo errado: esperado texto ou lista, encontrado número inteiro");
  await expect(page.getByTestId("settings-warning").nth(1)).toContainText("sem equivalente no Kabul");
  await expect(page.getByTestId("settings-warning").nth(2)).toContainText("no Kabul fica em Configurações › Git");

  // Prévia: mostra o arquivo gerado e não grava nada; Cancelar fecha.
  await expect(page.getByTestId("import-settings")).toHaveText("Importar configuração legada");
  await page.getByTestId("import-settings").click();
  await expect(page.getByTestId("import-settings")).toHaveCount(0);
  await expect(page.getByTestId("import-file")).toContainText('[scripts.run.dev]');
  await expect(page.getByTestId("import-preview")).toContainText("1 chave não será importada");
  await page.screenshot({ path: "../../.context/e2e/config-legada-previa.png" });
  expect((await mock(page)).importWritten).toEqual([]);
  await page.getByTestId("import-cancel").click();
  await expect(page.getByTestId("import-preview")).toHaveCount(0);
  expect((await mock(page)).importWritten).toEqual([]);

  // Confirmar grava o que a prévia mostrou e a faixa some (as settings são lidas de novo).
  await page.getByTestId("import-settings").click();
  await page.getByTestId("import-confirm").click();
  await expect(page.getByTestId("import-done")).toContainText(".kabul/settings.toml");
  expect((await mock(page)).importWritten).toEqual([".kabul/settings.toml"]);
  await expect(page.getByTestId("settings-warnings")).toHaveCount(0);
});

test("prévia vencida: gravar recusa e mostra o erro", async ({ page }) => {
  await setup(page);
  await page.getByTestId("import-settings").click();
  await expect(page.getByTestId("import-preview")).toBeVisible();
  // Outro objeto (o mock devolve a mesma referência que a tela guardou).
  await page.evaluate(() => { const db = (window as any).__mock.db; db.importPreview = { ...db.importPreview, digest: "mudou" }; });
  await page.getByTestId("import-confirm").click();
  await expect(page.getByText("a configuração mudou desde a prévia", { exact: false })).toBeVisible();
  expect((await mock(page)).importWritten).toEqual([]);
});
