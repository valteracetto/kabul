import { test, expect } from "../playwright-silencio";
import { startKabuld, type Kabuld } from "./helpers";

// Celular (dono): a lista mostra as sessões de fora do Kabul e "Continuar" retoma a mesma conversa.
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ fakeHome: true });
});
test.afterAll(() => kd?.stop());

test("celular: recentes fora do Kabul e continuar pela mesma sessão", async ({ page }) => {
  await page.goto(`${kd.base}/m/`);
  await expect(page.getByTestId("m-list")).toBeVisible();
  const ext = page.getByTestId("m-external");
  const rec = ext.getByTestId("m-external-recent").filter({ hasText: "Arrumar o login (de fora)" });
  await expect(rec).toBeVisible({ timeout: 20_000 });
  await expect(rec).toContainText("Claude Code");
  await rec.getByTestId("m-external-continue").click();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await page.getByTestId("m-chat-input").fill("segue daqui");
  await page.getByTestId("m-chat-send").click();
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("retomada aaaa-1111-fora: eco: segue daqui");
});

test("celular: criar workspace (repo, prompt, modelo), ordenar e filtrar, tema e organizar manualmente", async ({ page }) => {
  await page.goto(`${kd.base}/m/`);
  await expect(page.getByTestId("m-list")).toBeVisible();

  // Criar: repositório pela folha, o que fazer e o modelo; abre a conversa já com a 1ª mensagem.
  await page.getByTestId("m-create").click();
  await expect(page.getByTestId("m-new-ws")).toBeVisible();
  await page.getByTestId("m-new-repo").click();
  await expect(page.getByTestId("m-repo-sheet")).toContainText("Selecionar repositório");
  await page.getByTestId("m-repo").filter({ hasText: "app-exemplo" }).click();
  await expect(page.getByTestId("m-new-go")).toBeDisabled();
  await page.getByTestId("m-new-prompt").fill("revisar o cadastro pelo celular");
  await page.getByTestId("m-new-model").click();
  await expect(page.getByTestId("m-effort")).toBeVisible();
  await page.getByTestId("m-model").filter({ has: page.locator('[data-agent="claude"]') }).first().click();
  await page.getByTestId("m-new-go").click();
  await expect(page.getByTestId("m-chat")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("eco: revisar o cadastro pelo celular");
  await page.getByTestId("m-back").click();
  const novo = page.getByTestId("m-ws").filter({ hasText: "revisar o cadastro pelo celular" });
  await expect(novo).toBeVisible();
  await expect(page.getByTestId("m-group").filter({ has: novo })).toHaveAttribute("data-repo", "app-exemplo");

  // Ordenar e filtrar: atividade recente junta tudo num grupo; a escolha fica guardada.
  await page.getByTestId("m-sort").click();
  await page.getByTestId("m-sort-recent").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("m-group").first()).toHaveAttribute("data-repo", "Recentes");
  await page.reload();
  await expect(page.getByTestId("m-group").first()).toHaveAttribute("data-repo", "Recentes");
  await page.getByTestId("m-sort").click();
  await page.getByTestId("m-filter-ws").click();
  await page.getByTestId("m-filter-ws-archived").click();
  await page.getByTestId("m-sort-sections").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("m-ws")).toHaveCount(0);
  await page.getByTestId("m-sort").click();
  await page.getByTestId("m-filter-ws").click();
  await page.getByTestId("m-filter-ws-active").click();
  await page.keyboard.press("Escape");

  // Configurações pelo avatar: organizar manualmente mostra as alças; tema claro vale na hora.
  await page.getByTestId("m-menu").click();
  await page.getByTestId("m-manual").click();
  await page.getByTestId("m-tab-home").click();
  await expect(page.getByTestId("m-grip").first()).toBeVisible();
  await page.getByTestId("m-tab-settings").click();
  await page.getByTestId("m-theme").click();
  await page.getByTestId("m-theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTestId("m-back").click();
  await page.getByTestId("m-tab-usage").click();
  await expect(page.getByTestId("m-usage-model").first()).toContainText("Opus");
});
