import { addRepo } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";

/**
 * Aba Browser (navegador do Kabul por workspace, compartilhado com os agentes) com o backend mock:
 * abrir por ⌘⇧B / "+" / paleta / deep link, barra de endereço, clique na página vira evento de entrada
 * em pixels da página, indicador de agente + assumir controle, aprovações (na aba e no banner global),
 * download do navegador quando não há nenhum, configurações e o MCP embutido no painel.
 */
const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const calls = (page: Page, cmd: string) => page.evaluate((c) => ((window as any).__browserCalls ?? []).filter((x: [string, unknown]) => x[0] === c).map((x: [string, unknown]) => x[1]), cmd) as Promise<any[]>;
const mock = (page: Page, f: string, ...args: unknown[]) => page.evaluate(([f, args]) => (window as any).__mock[f as string](...(args as unknown[])), [f, args] as const);

async function setup(page: Page, extra = "") {
  await page.goto("/?mock" + extra);
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  await addRepo(page, "/mock/repos/demo");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-demo").click();
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await expect(host(page).getByTestId("ctab")).toHaveCount(1);
}

test("⌘⇧B abre a aba Browser; abrir, navegar pela barra, voltar; clique e teclado viram eventos da página", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Meta+Shift+B");
  await expect(host(page).getByTestId("ctab-browser")).toBeVisible();
  await expect(page.getByTestId("browser-closed")).toBeVisible();
  await page.getByTestId("browser-open").click();
  await expect(page.getByTestId("browser-frame")).toBeVisible();
  // Barra de endereço: sem esquema vira http://localhost (local) ou https (resto) no backend.
  await page.getByTestId("browser-address").fill("localhost:3000/login");
  await page.getByTestId("browser-address").press("Enter");
  await expect(page.getByTestId("browser-address")).toHaveValue("http://localhost:3000/login");
  expect((await calls(page, "browser_nav")).at(-1)).toMatchObject({ action: "goto", url: "localhost:3000/login" });
  // Screencast ligado com a aba visível.
  expect((await calls(page, "browser_screencast")).some((a) => a.on === true)).toBe(true);
  // Clique a 50% × 25% da imagem = (640, 200) na página de 1280×800 (a imagem é menor que a página).
  const box = (await page.getByTestId("browser-frame").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25);
  await expect.poll(async () => (await calls(page, "browser_input")).filter((a) => a.event.kind === "down").length).toBeGreaterThan(0);
  const down = (await calls(page, "browser_input")).find((a) => a.event.kind === "down").event;
  expect(down.type).toBe("mouse");
  expect(Math.abs(down.x - 640)).toBeLessThanOrEqual(2);
  expect(Math.abs(down.y - 200)).toBeLessThanOrEqual(2);
  expect(down.button).toBe("left");
  // Teclado com a página focada: tecla com texto.
  await page.keyboard.press("a");
  await expect.poll(async () => (await calls(page, "browser_input")).some((a) => a.event.type === "key" && a.event.kind === "down" && a.event.text === "a")).toBe(true);
  // Voltar e avançar.
  await page.getByTestId("browser-back").click();
  await expect(page.getByTestId("browser-address")).toHaveValue("");
  await page.getByTestId("browser-forward").click();
  await expect(page.getByTestId("browser-address")).toHaveValue("http://localhost:3000/login");
  // "+" também abre (e não duplica a aba).
  await host(page).getByTestId("ctab").first().click();
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-browser-tab").click();
  await expect(host(page).getByTestId("ctab-browser")).toHaveCount(1);
  await expect(page.getByTestId("browser-tab")).toBeVisible();
  // Portas do workspace.
  await page.getByTestId("browser-ports").click();
  await page.getByTestId("browser-port").nth(1).click();
  await expect(page.getByTestId("browser-address")).toHaveValue(/^http:\/\/localhost:\d+$/);
  // Celular: viewport muda e a imagem passa a valer 390 px de largura.
  await page.getByTestId("browser-menu").click();
  await page.getByTestId("browser-vp-mobile").click();
  expect((await calls(page, "browser_resize")).at(-1)).toMatchObject({ preset: "mobile" });
});

test("⌘⇧B no terminal: abre a última URL local da saída na aba Browser", async ({ page }) => {
  await setup(page);
  await host(page).locator(".term-host").first().click();
  const name = await page.evaluate(() => (window as any).__mock.db.workspaces[0].name);
  const out = "  VITE ready\r\n  Local:   http://localhost:5173/\r\n  Network: http://0.0.0.0:5174/app\r\n";
  await page.evaluate(([s, d]) => (window as any).__mock.emit("term-output", { session: s, pane: "%1", data: [...new TextEncoder().encode(d)] }), [`kabul-${name}`, out]);
  await expect(page.locator(".xterm-rows")).toContainText("0.0.0.0:5174");
  await host(page).locator(".term-host").first().click();
  await page.keyboard.press("Meta+Shift+B");
  await expect(host(page).getByTestId("ctab-browser")).toBeVisible();
  // A última da saída; 0.0.0.0 (escuta) vira localhost.
  await expect(page.getByTestId("browser-address")).toHaveValue("http://localhost:5174/app");
});

test("agente controlando: indicador, assumir controle e devolver; ações dos agentes", async ({ page }) => {
  await setup(page);
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-browser-tab").click();
  await page.getByTestId("browser-open").click();
  await expect(page.getByTestId("browser-frame")).toBeVisible();
  const ws = await page.evaluate(() => (window as any).__mock.db.workspaces[0].id);
  await mock(page, "browserAgent", ws, "Codex", "click", "e42");
  await expect(page.getByTestId("browser-agent")).toContainText("Codex está controlando o navegador");
  // Um botão "Assumir controle" só: o da faixa do agente (o da barra some enquanto o agente controla).
  await expect(page.getByRole("button", { name: "Assumir controle" })).toHaveCount(1);
  await expect(page.getByTestId("browser-control")).toHaveCount(0);
  await page.getByTestId("browser-take-over").click();
  expect((await calls(page, "browser_control")).at(-1)).toMatchObject({ paused: true });
  await expect(page.getByTestId("browser-paused")).toBeVisible();
  await expect(page.getByTestId("browser-control")).toHaveText("Devolver ao agente");
  await page.getByTestId("browser-control").click();
  expect((await calls(page, "browser_control")).at(-1)).toMatchObject({ paused: false });
  await expect(page.getByTestId("browser-paused")).toHaveCount(0);
  await page.getByTestId("browser-menu").click();
  await page.getByTestId("browser-log-toggle").click();
  await expect(page.getByTestId("browser-log")).toContainText("Codex");
  await expect(page.getByTestId("browser-log")).toContainText("e42");
});

test("aprovações: na aba (permitir sempre / negar) e no banner global com a aba fechada", async ({ page }) => {
  await setup(page);
  const ws = await page.evaluate(() => (window as any).__mock.db.workspaces[0].id);
  // Sem a aba aberta: banner global.
  await mock(page, "browserApproval", ws, { kind: "navigate", detail: "https://example.org/docs", agent: "gemini" });
  await expect(page.getByTestId("browser-approval-banner")).toContainText("gemini quer abrir https://example.org/docs");
  await page.getByTestId("browser-banner-deny").click();
  await expect(page.getByTestId("browser-approval-banner")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__mock.browserDecisions)).toEqual([expect.objectContaining({ allow: false })]);
  // Com a aba aberta: a faixa da aba (o banner não repete).
  await page.keyboard.press("Meta+Shift+B");
  await page.getByTestId("browser-open").click();
  await mock(page, "browserApproval", ws, { kind: "navigate", detail: "https://staging.exemplo.com/", agent: "claude" });
  await expect(page.getByTestId("browser-approval")).toContainText("claude quer abrir https://staging.exemplo.com/");
  await expect(page.getByTestId("browser-approval-banner")).toHaveCount(0);
  await page.getByTestId("browser-always").click();
  await expect(page.getByTestId("browser-approval")).toHaveCount(0);
  await expect.poll(async () => (await page.evaluate(() => (window as any).__mock.browserDecisions)).at(-1)).toMatchObject({ allow: true, always: true });
  await mock(page, "browserApproval", ws, { kind: "evaluate", detail: "document.title", agent: "qwen" });
  await expect(page.getByTestId("browser-approval")).toContainText("qwen quer rodar JavaScript");
  await expect(page.getByTestId("browser-always")).toHaveCount(0);
  await page.getByTestId("browser-allow").click();
  await expect.poll(async () => (await page.evaluate(() => (window as any).__mock.browserDecisions)).at(-1)).toMatchObject({ allow: true, always: false });
});

test("deep link kabul://browser?url= e paleta abrem a aba no workspace atual", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).__mock.emit("deep-link", "kabul://browser?url=http%3A%2F%2Flocalhost%3A5173%2Fapp"));
  await expect(host(page).getByTestId("ctab-browser")).toBeVisible();
  await expect(page.getByTestId("browser-address")).toHaveValue("http://localhost:5173/app");
  expect((await calls(page, "browser_open")).at(-1)).toMatchObject({ url: "http://localhost:5173/app" });
  // Paleta (⌘K): ação do workspace traz a aba de volta.
  await host(page).getByTestId("ctab").first().click();
  await page.keyboard.press("Meta+k");
  await page.getByTestId("palette-input").fill("abrir o navegador");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("browser-tab")).toBeVisible();
  // Fora de um workspace: avisa.
  await page.getByTestId("settings").click();
  await page.evaluate(() => (window as any).__mock.emit("deep-link", "kabul://browser?url=http://localhost:1"));
  await expect(page.getByRole("alert").filter({ hasText: "Abra um workspace" })).toBeVisible();
});

test("sem navegador instalado: oferta de baixar (com confirmação) e abre depois", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => ((window as any).__mock.noBrowser = true));
  await page.keyboard.press("Meta+Shift+B");
  await page.getByTestId("browser-open").click();
  await expect(page.getByTestId("browser-no-binary")).toBeVisible();
  await page.getByTestId("browser-install").click();
  await expect(page.getByText(/chrome-headless-shell.*100 MB/)).toBeVisible();
  await page.getByRole("button", { name: "Baixar navegador do Kabul" }).last().click();
  await expect(page.getByTestId("browser-frame")).toBeVisible();
  expect((await calls(page, "browser_install")).length).toBe(1);
});

test("configurações › Navegador: política, Claude com Chrome e domínios do projeto; MCP embutido no painel", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => ((window as any).__mock.claudeChrome = true));
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-navegador").click();
  await expect(page.getByTestId("browser-settings")).toBeVisible();
  await expect(page.getByTestId("claude-chrome-status")).toContainText("detectada");
  await page.getByTestId("browser-policy").selectOption("ask");
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.settings.browser_policy)).toBe("ask");
  await page.getByTestId("toggle-claude_chrome").click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.settings.claude_chrome)).toBe(true);
  await page.getByTestId("toggle-browser_mcp").click();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.settings.browser_mcp)).toBe(false);
  // Domínios do projeto (configurações do repo › Diversos).
  await page.getByTestId("set-tab-diversos").click();
  await page.getByTestId("browser-hosts").fill("staging.exemplo.com, *.exemplo.dev");
  await page.getByTestId("browser-hosts").blur();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.repoSettings.browser_hosts)).toEqual(["staging.exemplo.com", "*.exemplo.dev"]);
});

test("painel de MCP: kabul-browser embutido, do Kabul, para todas as IAs, liga/desliga na sessão", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => ((window as any).__mock.builtinMcp = true));
  await page.getByTestId("composer").fill("Liste os arquivos");
  await page.getByTestId("composer").press("Enter");
  await expect(page.locator(".turn-meta")).toBeVisible();
  await page.getByTestId("apps").click();
  const row = page.getByTestId("mcp-row").filter({ hasText: "kabul-browser" });
  await expect(row).toContainText("do Kabul");
  await expect(row.getByTestId("mcp-builtin")).toBeVisible();
  await expect(row.getByTestId("mcp-share")).toHaveCount(0);
  await expect(row.getByTestId("mcp-weight")).toContainText("15 ferramentas");
});

test.describe("em inglês", () => {
  test.use({ locale: "en-US" });
  test("aba Browser, aprovação e erro sem navegador em inglês", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => ((window as any).__mock.noBrowser = true));
    await page.keyboard.press("Meta+Shift+B");
    await expect(host(page).getByTestId("ctab-browser")).toHaveText("Browser");
    await expect(page.getByTestId("browser-closed")).toContainText("Browser closed");
    await page.getByTestId("browser-open").click();
    await expect(page.getByTestId("browser-no-binary")).toContainText("No Chrome, Edge or Chromium on this computer.");
    await page.evaluate(() => ((window as any).__mock.noBrowser = false));
    await page.getByTestId("browser-open").click();
    const ws = await page.evaluate(() => (window as any).__mock.db.workspaces[0].id);
    await mock(page, "browserApproval", ws, { kind: "navigate", detail: "https://example.org/", agent: "codex" });
    await expect(page.getByTestId("browser-approval")).toContainText("codex wants to open https://example.org/");
    await expect(page.getByTestId("browser-always")).toHaveText("Always for this domain");
    await expect(page.getByTestId("browser-control")).toHaveText("Take control");
  });
});
