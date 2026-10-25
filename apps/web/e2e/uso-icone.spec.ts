import { test, expect, type Page } from "../playwright-silencio";

// Uso: bloco por provedor/conta mesmo sem dados (Claude), fonte do CodexBar com link quebrado, e a escolha do
// que vai no ícone da barra de menus (automático, manual até 3, alfinete, estilo, gasto do dia).
const settings = (page: Page) => page.evaluate(() => import("/src/api.ts").then((m) => m.api.appSettings()));
/** Troca os limites do mock (segundos a partir de agora) e avisa a tela. */
const setLimits = (page: Page, lims: { provider: string; window: string; title: string; pct: number; account?: string }[]) =>
  page.evaluate((lims) => {
    const t = Math.floor(Date.now() / 1000);
    const m = (window as any).__mock;
    m.usageLimits = lims.map((l) => ({ provider: l.provider, account: l.account ?? `${l.provider}:sistema`, account_label: null, plan: null, window: l.window, title: l.title, used_pct: l.pct, window_mins: null, resets_at: t + 3600, source: "teste", updated_at: t }));
    m.emit("usage-changed", null);
  }, lims);
const FOUR = [
  { provider: "claude", window: "5h", title: "Sessão (5 h)", pct: 22 },
  { provider: "claude", window: "semana", title: "Semana", pct: 61 },
  { provider: "codex", window: "5h", title: "Sessão (5 h)", pct: 30 },
  { provider: "codex", window: "semana", title: "Semana", pct: 10 },
];

test("Claude sem dados de limite: o bloco aparece com como conectar; login vencido e CodexBar com link quebrado", async ({ page }) => {
  await page.goto("/?mock");
  // Só o Codex tem limites; o Claude foi usado (turnos) mas nenhuma fonte trouxe janela dele.
  await setLimits(page, [{ provider: "codex", window: "5h", title: "Sessão (5 h)", pct: 22 }]);
  await page.evaluate(() => ((window as any).__mock.usageSources = [
    { name: "Claude (assinatura) · Padrão do sistema", ok: false, detail: "sem login", provider: "claude", account: "claude:sistema", code: "no_login" },
    { name: "CodexBar", ok: false, detail: "CodexBar não encontrado (o link aponta para um app removido: /opt/homebrew/bin/codexbar → /Applications/CodexBar.app/Contents/Helpers/CodexBarCLI)", code: "codexbar_broken" },
  ]));
  await page.getByTestId("nav-usage").click();
  const claude = page.locator("[data-testid=limit-block][data-provider=claude]");
  await expect(claude).toHaveCount(1);
  await expect(claude).toHaveAttribute("data-empty", "true");
  await expect(claude).toContainText("Sem dados de limite ainda");
  await expect(claude.getByTestId("limit-connect")).toContainText("Sem login do Claude Code nesta conta");
  // Antigravity também foi usado e não informa limites: bloco próprio, com a dica do CodexBar.
  await expect(page.locator("[data-testid=limit-block][data-provider=agy]")).toContainText("CodexBar");
  await expect(page.getByTestId("usage-sources")).toContainText("Fontes:");
  await expect(page.getByTestId("usage-sources")).toContainText("CodexBar não encontrado (o link aponta para um app removido)");
  // Sem código conhecido: a dica geral de como conectar o Claude.
  await page.evaluate(() => ((window as any).__mock.usageSources = [], (window as any).__mock.emit("usage-changed", null)));
  await expect(claude.getByTestId("limit-connect")).toContainText("Entre no Claude Code com esta conta");
  // Login vencido: pede para entrar de novo, sem tentar renovar.
  await page.evaluate(() => ((window as any).__mock.usageCodes = { "claude:sistema": "expired" }, (window as any).__mock.emit("usage-changed", null)));
  await expect(claude.getByTestId("limit-connect")).toContainText("entre de novo no Claude Code");
  await page.screenshot({ path: "../../.context/e2e/uso-claude-sem-dados.png", fullPage: true });

  // O popover também mostra o bloco (não parece que sumiu).
  await page.goto("/?mock&view=tray");
  await setLimits(page, [{ provider: "codex", window: "5h", title: "Sessão (5 h)", pct: 22 }]);
  await expect(page.locator("[data-testid=limit-block][data-provider=claude][data-empty=true]")).toContainText("Sem dados de limite ainda");
});

test("Na barra de menus: automático, alfinete, escolha manual até 3, estilo e gasto; o mesmo em Configurações", async ({ page }) => {
  await page.goto("/?mock");
  await setLimits(page, FOUR);
  await page.getByTestId("nav-usage").click();
  const prefs = page.getByTestId("tray-prefs");
  await expect(page.getByTestId("tray-mode-auto")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("tray-pick")).toHaveCount(0);
  // Automático: nenhum alfinete marcado.
  await expect(page.locator("[data-testid=limit-pin][aria-pressed=true]")).toHaveCount(0);

  // Alfinete na Sessão do Claude: passa para o manual com só ela.
  const claude = page.locator("[data-testid=limit-block][data-provider=claude]");
  await claude.getByTestId("limit-row").filter({ hasText: "Sessão (5 h)" }).getByTestId("limit-pin").click();
  await expect.poll(async () => (await settings(page)).tray_icon).toEqual({ mode: "manual", pinned: [{ provider: "claude", account: "claude:sistema", window: "5h" }], style: "bars_percent", show_spend: false });
  await expect(page.getByTestId("tray-mode-manual")).toHaveAttribute("aria-checked", "true");
  await expect(claude.getByTestId("limit-row").filter({ hasText: "Sessão (5 h)" }).getByTestId("limit-pin")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tray-pinned-count")).toHaveText("1/3");

  // Lista: marca mais dois (até 3); o quarto fica desabilitado, no alfinete e na caixa.
  await page.locator('[data-testid=tray-pick-item][data-pin="codex|codex:sistema|5h"]').check();
  await page.locator('[data-testid=tray-pick-item][data-pin="claude|claude:sistema|semana"]').check();
  await expect(page.getByTestId("tray-pinned-count")).toHaveText("3/3");
  await expect(page.locator('[data-testid=tray-pick-item][data-pin="codex|codex:sistema|semana"]')).toBeDisabled();
  const codexWeekPin = page.locator("[data-testid=limit-block][data-provider=codex]").getByTestId("limit-row").filter({ hasText: "Semana" }).getByTestId("limit-pin");
  await expect(codexWeekPin).toBeDisabled();
  await expect(codexWeekPin).toHaveAttribute("title", "O ícone mostra até 3 limites: tire um antes");
  expect((await settings(page)).tray_icon!.pinned.map((p) => p.window)).toEqual(["5h", "5h", "semana"]);

  // Estilo e gasto do dia.
  await page.getByTestId("tray-style").selectOption("percent");
  await page.getByTestId("tray-show-spend").check();
  await expect.poll(async () => { const s = (await settings(page)).tray_icon!; return [s.style, s.show_spend]; }).toEqual(["percent", true]);
  await prefs.screenshot({ path: "../../.context/e2e/uso-barra-de-menus.png" });

  // Desmarca um pela lista (continua manual); volta ao automático: alfinetes desmarcados, escolha guardada.
  await page.locator('[data-testid=tray-pick-item][data-pin="codex|codex:sistema|5h"]').uncheck();
  await expect(page.getByTestId("tray-pinned-count")).toHaveText("2/3");
  await page.getByTestId("tray-mode-auto").click();
  await expect.poll(async () => (await settings(page)).tray_icon!.mode).toBe("auto");
  await expect(page.locator("[data-testid=limit-pin][aria-pressed=true]")).toHaveCount(0);
  expect((await settings(page)).tray_icon!.pinned).toHaveLength(2);

  // Configurações › Geral mostra a mesma escolha (e some com o ícone desligado).
  await page.getByTestId("settings").click();
  const sp = page.getByTestId("tray-prefs");
  await expect(sp).toBeVisible();
  await expect(sp.getByTestId("tray-style")).toHaveValue("percent");
  await sp.getByTestId("tray-mode-manual").click();
  await expect(sp.locator("[data-testid=tray-pick-item]:checked")).toHaveCount(2);
  await sp.getByTestId("tray-style").selectOption("icon");
  await expect.poll(async () => (await settings(page)).tray_icon!.style).toBe("icon");
  await page.getByTestId("toggle-tray").click();
  await expect(page.getByTestId("tray-prefs")).toHaveCount(0);
});

test("alfinete: tirar o último volta ao automático", async ({ page }) => {
  await page.goto("/?mock");
  await setLimits(page, FOUR);
  await page.getByTestId("nav-usage").click();
  const pin = page.locator("[data-testid=limit-block][data-provider=codex]").getByTestId("limit-row").filter({ hasText: "Semana" }).getByTestId("limit-pin");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await settings(page)).tray_icon).toEqual({ mode: "auto", pinned: [], style: "bars_percent", show_spend: false });
});
