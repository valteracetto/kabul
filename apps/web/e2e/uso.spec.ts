import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

// Uso, custos e limites: aba Uso, popover da barra do Kabul, celular e a troca de conta/LLM sugerida perto do limite.
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}
async function send(page: Page, text: string) {
  await chat(page).getByTestId("composer").fill(text);
  await chat(page).getByTestId("composer").press("Enter");
}

test("aba Uso: resumo, limites com contagem, gráfico com hover, agrupamentos, sessões e CSV; turno novo entra sozinho", async ({ page }) => {
  await setup(page);
  await page.getByTestId("nav-usage").click();
  const v = page.getByTestId("usage-view");
  await expect(v).toBeVisible();
  await expect(page.getByTestId("usage-today")).toContainText("US$");
  // Um bloco por provedor/conta; o Claude passa do alerta (86% ≥ 80%) e mostra ícone + rótulo, não só cor.
  await expect(page.getByTestId("limit-block")).toHaveCount(2);
  const claude = page.locator("[data-testid=limit-block][data-provider=claude]");
  await expect(claude).toContainText("Sessão (5 h)");
  await expect(claude).toContainText("86%");
  await expect(claude).toContainText("perto do limite");
  await expect(claude).toContainText(/reinicia em 2 h (9|10) min/);
  await expect(page.locator("[data-testid=limit-block][data-provider=codex]")).toContainText("Lentidão parcial");
  await expect(page.getByTestId("usage-alert").first()).toContainText("Claude");
  // Gráfico: 30 dias, hover mostra o dia e o valor.
  await expect(page.getByTestId("chart-bar")).toHaveCount(30);
  await page.getByTestId("chart-bar").last().hover();
  await expect(page.getByTestId("chart-tip")).toContainText("US$");
  await page.getByTestId("metric-tokens").click();
  await page.getByTestId("chart-bar").last().hover();
  await expect(page.getByTestId("chart-tip")).toContainText("tokens");
  await page.getByTestId("usage-days-7").click();
  await expect(page.getByTestId("chart-bar")).toHaveCount(7);
  // Agrupamentos.
  await expect(page.getByTestId("usage-row").first()).toContainText("Opus 5.5");
  await page.getByTestId("group-provider").click();
  await expect(page.getByTestId("usage-table")).toContainText("Antigravity");
  await page.getByTestId("group-account").click();
  await expect(page.getByTestId("usage-table")).toContainText("Padrão do sistema");
  // Sessões com duração e custo; sessão sem custo reportado mostra "—".
  await expect(page.getByTestId("usage-session").first()).toContainText("45 s");
  await expect(page.getByTestId("usage-sessions")).toContainText("—");
  // CSV no navegador: download.
  const dl = page.waitForEvent("download");
  await page.getByTestId("usage-csv").click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^kabul-uso-\d{4}-\d{2}-\d{2}\.csv$/);
  // Atualizar limites chama o backend.
  await page.getByTestId("usage-refresh").click();
  await expect.poll(() => page.evaluate(() => (window as any).__usageRefreshed)).toBe(1);
  await page.screenshot({ path: "../../.context/e2e/uso.png", fullPage: true });

  // Um turno no workspace entra no Uso sem recarregar (evento usage-changed).
  await page.getByTestId("usage-days-30").click();
  await expect(page.getByTestId("chart-bar")).toHaveCount(30);
  const before = await page.getByTestId("usage-session").count();
  await page.getByTestId("ws-row").click();
  await send(page, "oi");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await page.getByTestId("nav-usage").click();
  await expect(page.getByTestId("usage-session")).toHaveCount(before + 1);
});

test("sugestão perto do limite: trocar para outra conta do mesmo provedor vale na conversa aberta", async ({ page }) => {
  await setup(page);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-contas").click();
  await page.getByTestId("account-add-claude").fill("Trabalho");
  await page.getByTestId("account-add-claude").press("Enter");
  await expect(page.getByTestId("accounts-claude").getByTestId("account-row")).toHaveCount(2);
  await page.getByTestId("ws-row").click();
  await send(page, "primeira");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await expect(page.getByTestId("account-chip")).toContainText("Conta padrão");
  await page.getByTestId("nav-usage").click();
  const s = page.getByTestId("usage-suggestion").first();
  await expect(s).toContainText("Usar a conta Trabalho");
  await s.getByTestId("suggest-apply").click();
  await expect(page.getByTestId("usage-note")).toContainText("Trabalho");
  await page.getByTestId("ws-row").click();
  await expect(page.getByTestId("account-chip")).toContainText("Trabalho");
  // O próximo envio troca a conta na mesma conversa (handoff), como a troca manual.
  await send(page, "segunda");
  await expect(chat(page)).toContainText("Trocou para a conta Trabalho");
});

test("sugestão sem outra conta: trocar de provedor (LLM) na mesma conversa", async ({ page }) => {
  await setup(page);
  await page.getByTestId("ws-row").click();
  await send(page, "primeira");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await page.getByTestId("nav-usage").click();
  const s = page.getByTestId("usage-suggestion").first();
  await expect(s).toContainText("Codex");
  await s.getByTestId("suggest-apply").click();
  await page.getByTestId("ws-row").click();
  await send(page, "segunda");
  await expect.poll(() => page.evaluate(() => (window as any).__kabulLastStart?.harness)).toBe("codex");
});

test("troca de LLM vale já no primeiro envio, mesmo com a lista de modelos chegando depois da mensagem", async ({ page }) => {
  await setup(page);
  await page.getByTestId("ws-row").click();
  await send(page, "primeira");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await page.getByTestId("nav-usage").click();
  const s = page.getByTestId("usage-suggestion").first();
  await expect(s).toContainText("Codex");
  await s.getByTestId("suggest-apply").click();
  // A conversa remonta ao voltar e pede a lista de modelos de novo; ela só chega depois do envio já feito
  // (máquina lenta, como no CI do macOS). A troca pendente tem que valer nesse envio, não no seguinte.
  await page.evaluate(() => ((window as any).__mock.holdModels = "manual"));
  await page.getByTestId("ws-row").click();
  await send(page, "segunda");
  await expect(chat(page)).toContainText("segunda");
  expect(await page.evaluate(() => (window as any).__kabulStarts)).toBe(1);
  await page.evaluate(() => ((window as any).__mock.holdModels = false, (window as any).__mock.releaseModels?.()));
  await expect.poll(() => page.evaluate(() => (window as any).__kabulLastStart?.harness)).toBe("codex");
  await expect(chat(page)).toContainText("Trocou para");
  // Um agente só para o envio: o Codex. Nada saiu antes pelo Claude.
  expect(await page.evaluate(() => (window as any).__kabulStarts)).toBe(2);
  await expect(chat(page).locator(".turn-meta")).toHaveCount(2);
});

test("barra do Kabul: popover com gasto, limites, agentes e ações rápidas", async ({ page }) => {
  await page.goto("/?mock&view=tray");
  const pop = page.getByTestId("tray-popover");
  await expect(pop).toBeVisible();
  await expect(page.getByTestId("tray-spend")).toContainText("Hoje");
  await expect(page.getByTestId("limit-block")).toHaveCount(2);
  await expect(page.getByTestId("tray-alert")).toContainText("Claude");
  await expect(pop).toContainText("Nenhuma conversa aberta.");
  await expect(page.getByTestId("tray-pause")).toBeDisabled();
  await page.getByTestId("tray-new").click();
  await page.getByTestId("tray-open").click();
  await page.getByTestId("tray-usage").click();
  await expect.poll(() => page.evaluate(() => (window as any).__trayActions)).toEqual(["new-workspace", "open", "usage"]);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => (window as any).__trayHidden)).toBe(true);
  await page.setViewportSize({ width: 340, height: 520 });
  await page.screenshot({ path: "../../.context/e2e/barra-kabul.png" });
});

test("barra do Kabul → janela principal: abrir Uso, novo workspace, abrir workspace e pausar todos", async ({ page }) => {
  await setup(page);
  await page.getByTestId("ws-row").click();
  // O popover chama tray_action; o backend repassa à janela principal como evento `tray-action`.
  const act = (a: string, ws: string | null = null) => page.evaluate(([a, ws]) => import("/src/api.ts").then((m) => m.api.trayAction(a as any, ws)), [a, ws] as const);
  await act("usage");
  await expect(page.getByTestId("usage-view")).toBeVisible();
  const wsId = await page.getByTestId("ws-row").first().getAttribute("data-ws");
  await act("open-workspace", wsId);
  await expect(page.getByTestId("usage-view")).toHaveCount(0);
  await expect(chat(page).getByTestId("composer")).toBeVisible();
  // Agente trabalhando (comando longo) → pausar todos para pelo mesmo caminho do botão Parar.
  await send(page, "rode sleep 30");
  await expect.poll(() => page.evaluate(() => import("/src/api.ts").then((m) => m.api.agentsRunning()).then((r) => r.filter((x) => x.working).length))).toBe(1);
  await act("pause-all");
  await expect.poll(() => page.evaluate(() => (window as any).__mock?.interrupted ?? 0)).toBeGreaterThan(0);
  await act("new-workspace");
  await expect(page.getByTestId("create-go")).toBeVisible();
});

test("Configurações: ícone na barra de menus e alertas de uso", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("settings").click();
  const t = page.getByTestId("toggle-tray");
  await expect(t).toHaveAttribute("aria-checked", "true");
  await t.click();
  await expect(t).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("usage-alert-pct").selectOption("90");
  await page.getByTestId("usage-daily-budget").fill("5");
  await page.getByTestId("usage-daily-budget").blur();
  const s = await page.evaluate(() => import("/src/api.ts").then((m) => m.api.appSettings()));
  expect([s.tray, s.usage_alert_pct, s.usage_daily_budget]).toEqual([false, 90, 5]);
  // Com 90%, o Claude a 86% não alerta mais; o orçamento de US$ 5 por dia ainda não foi atingido.
  await page.getByTestId("nav-usage").click();
  await expect(page.getByTestId("usage-view")).toBeVisible();
  await expect(page.getByTestId("usage-alert")).toHaveCount(0);
  await expect(page.locator("[data-testid=limit-block][data-provider=claude]")).not.toContainText("perto do limite");
});

test("celular: rota de Uso com gasto, limites, gráfico e sessões", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/m/?mock");
  // Aba Uso do celular → Custos e limites (só o dono).
  await page.getByTestId("m-tab-usage").click();
  await page.getByTestId("m-open-usage").click();
  await expect(page.getByTestId("m-usage-detail")).toBeVisible();
  await expect(page.getByTestId("m-usage-today")).toContainText("US$");
  await expect(page.getByTestId("limit-block")).toHaveCount(2);
  await expect(page.getByTestId("m-usage-alert").first()).toContainText("Claude");
  await expect(page.getByTestId("chart-bar")).toHaveCount(30);
  await expect(page.getByTestId("m-usage-session").first()).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/uso-celular.png", fullPage: true });
  await page.getByTestId("m-usage-back").click();
  await expect(page.getByTestId("m-usage-detail")).toHaveCount(0);
  await expect(page.getByTestId("m-usage")).toBeVisible();
});
