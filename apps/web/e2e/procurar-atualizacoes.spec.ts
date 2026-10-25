import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

// "Procurar atualizações…": botão no rodapé da barra lateral, ⌘K, menu nativo (Kabul › / Ajuda ›) e barra
// do Kabul. Canal estável por padrão; diálogo com notas, tamanho, progresso; agentes rodando pedem
// confirmação (esperar ou reiniciar); erros com link para os releases; fora do app empacotado abre a página.

const RELEASES = "https://github.com/valteracetto/kabul/releases";
const mock = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => Object.assign((window as any).__mock, p), patch);
const checks = (page: Page) => page.evaluate(() => (window as any).__updateChecks ?? []);
const installed = (page: Page) => page.evaluate(() => !!(window as any).__updateInstalled);
const dialog = (page: Page) => page.getByTestId("update-dialog");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

const NEW = { version: "0.10.0", notes: "- Botão de atualização visível\n- Correções no terminal", size: 18_400_000, published_at: 1_792_000_000 };

test("sem atualização: rodapé, ⌘K, menu nativo e barra do Kabul procuram no canal estável", async ({ page }) => {
  await page.goto("/?mock");
  await expect(page.getByTestId("check-updates")).toBeVisible();
  await expect(page.getByTestId("update-dot")).toHaveCount(0);

  // Rodapé da barra lateral.
  await page.getByTestId("check-updates").click();
  await expect(dialog(page).getByTestId("upd-none")).toHaveText(/Você está na versão mais recente \(\d+\.\d+\.\d+.*\)\./);
  await expect(dialog(page)).toContainText("canal estável");
  await page.getByTestId("upd-ok").click();
  await expect(dialog(page)).toHaveCount(0);

  // Paleta ⌘K.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Procurar atualizações");
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByTestId("upd-none")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // Menu nativo (Kabul › Procurar atualizações…) e menu da barra do Kabul.
  await page.evaluate(() => (window as any).__mock.emit("menu", "check-updates"));
  await expect(dialog(page).getByTestId("upd-none")).toBeVisible();
  await page.getByTestId("upd-ok").click();
  await page.evaluate(() => (window as any).__mock.emit("tray-action", { action: "check-updates", workspace_id: null }));
  await expect(dialog(page).getByTestId("upd-none")).toBeVisible();

  expect(await checks(page)).toEqual(["stable", "stable", "stable", "stable"]);
});

test("com atualização: notas, tamanho, Depois, ponto no rodapé e Atualizar e reiniciar com progresso", async ({ page }) => {
  await page.goto("/?mock");
  await mock(page, { update: NEW });
  await page.getByTestId("check-updates").click();
  await expect(dialog(page).getByTestId("upd-version")).toHaveText("Kabul 0.10.0 está disponível");
  await expect(dialog(page).getByTestId("upd-meta")).toContainText("canal estável");
  await expect(dialog(page).getByTestId("upd-meta")).toContainText("18,4 MB");
  await expect(dialog(page).getByTestId("upd-notes")).toContainText("Botão de atualização visível");
  await expect(dialog(page).getByTestId("upd-changelog")).toBeVisible();

  // Depois: fecha, e o rodapé fica com o ponto (e o título com a versão).
  await page.getByTestId("upd-later").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId("update-dot")).toBeVisible();
  // O aviso do topo é da checagem automática; na manual, o diálogo já mostrou.
  await expect(page.getByTestId("update-banner")).toHaveCount(0);
  await expect(page.getByTestId("check-updates")).toHaveAttribute("title", "Kabul 0.10.0 disponível");
  expect(await installed(page)).toBe(false);

  // Notas completas: página da release.
  await page.getByTestId("check-updates").click();
  await dialog(page).getByTestId("upd-changelog").click();
  await expect.poll(() => page.evaluate(() => (window as any).__external)).toBe(`${RELEASES}/tag/v0.10.0`);

  // Atualizar e reiniciar: barra de progresso até instalar.
  await page.getByTestId("upd-install").click();
  await expect(dialog(page).getByTestId("upd-progress")).toBeVisible();
  await expect(dialog(page).getByTestId("upd-progress-text")).toHaveText(/%|Instalando/);
  await expect.poll(() => installed(page)).toBe(true);
  await expect(dialog(page).getByTestId("upd-progress-text")).toHaveText("Instalando e reiniciando…");
});

test("canal beta só quando escolhido nas Configurações", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("check-updates").click();
  await page.getByTestId("upd-ok").click();
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-avancado").click();
  await page.getByTestId("update-channel").selectOption("beta");
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.settings.update_channel)).toBe("beta");
  await mock(page, { update: { version: "0.10.0-beta.1" } });
  await page.getByTestId("check-updates").click();
  await expect(dialog(page).getByTestId("upd-meta")).toContainText("canal beta");
  expect(await checks(page)).toEqual(["stable", "beta"]);
});

test("erros: 404/sem assinatura → não foi possível verificar, com link para os releases; sem internet", async ({ page }) => {
  await page.goto("/?mock");
  await mock(page, { updateError: true });
  await page.getByTestId("check-updates").click();
  await expect(dialog(page).getByTestId("upd-error")).toHaveText("Não foi possível verificar agora.");
  await dialog(page).getByTestId("upd-releases").click();
  await expect.poll(() => page.evaluate(() => (window as any).__external)).toBe(RELEASES);

  await mock(page, { updateError: false, offline: true });
  await page.getByTestId("upd-retry").click();
  await expect(dialog(page).getByTestId("upd-error")).toContainText("Sem conexão");

  // Voltou a internet: tentar de novo acha a versão nova.
  await mock(page, { offline: false, update: NEW });
  await page.getByTestId("upd-retry").click();
  await expect(dialog(page).getByTestId("upd-version")).toContainText("0.10.0");
});

test("fora do app empacotado (dev/web): o botão abre a página de releases", async ({ page }) => {
  await page.goto("/?mock");
  await mock(page, { noUpdater: true });
  await page.getByTestId("check-updates").click();
  await expect.poll(() => page.evaluate(() => (window as any).__external)).toBe(RELEASES);
  await expect(dialog(page)).toHaveCount(0);
  expect(await checks(page)).toEqual([]);
});

async function withAgent(page: Page, text: string) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await chat(page).getByTestId("composer").fill(text);
  await chat(page).getByTestId("composer").press("Enter");
  await expect(page.getByTestId("agents-count")).toHaveText("1");
  await mock(page, { update: NEW });
  await page.getByTestId("check-updates").click();
  await page.getByTestId("upd-install").click();
  await expect(page.getByTestId("confirm")).toContainText("há 1 agente rodando");
}

test("agentes rodando: esperar terminarem instala sozinho depois; reiniciar agora não espera", async ({ page }) => {
  await withAgent(page, "rode sleep 30");
  await expect(page.getByTestId("confirm-cancel")).toHaveText("Esperar terminarem");
  await page.getByTestId("confirm-cancel").click();
  await expect(dialog(page).getByTestId("upd-waiting")).toHaveText(/Esperando 1 agente terminar/);
  await page.waitForTimeout(1800);
  expect(await installed(page)).toBe(false);
  // O agente parou (mesmo caminho do "Pausar todos" da barra do Kabul): atualiza e reinicia.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("kabul:stop-all", { detail: "*" })));
  await expect.poll(() => installed(page), { timeout: 10_000 }).toBe(true);
});

test("agentes rodando: reiniciar mesmo assim", async ({ page }) => {
  await withAgent(page, "rode sleep 30");
  await page.getByTestId("confirm-ok").click();
  await expect.poll(() => installed(page)).toBe(true);
});

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("Configurações › Sobre: versão do Kabul no Mac e atualização disponível (só informativo)", async ({ page }) => {
    let update: unknown = null;
    await page.route("**/api/health", (r) => r.fulfill({ json: { kabuld: true, name: "MacBook do Val", version: "0.9.0", protocol: 1, min_protocol: 1, update } }));
    await page.goto("/m/?mock#v=settings/about");
    await expect(page.getByTestId("m-mac-version")).toHaveText("0.9.0");
    await expect(page.getByTestId("m-mac-update")).toHaveCount(0);
    update = { version: "0.10.0", channel: "stable" };
    await page.reload();
    await expect(page.getByTestId("m-mac-update")).toHaveText("0.10.0");
    await expect(page.getByText("Kabul › Procurar atualizações…")).toBeVisible();
  });
});
