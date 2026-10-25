import { test, expect, devices, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { startKabuld, wsAction, type Kabuld } from "./helpers";

// Capturas da PWA no iPhone para comparar versões da interface (antes/depois de uma mudança visual).
// Grava em .context/comparar/mobile/<CAPTURA>/ (CAPTURA=antes|depois; padrão "atual").
// Só usa os data-testid estáveis, para rodar igual em versões diferentes da interface.
let kd: Kabuld;
test.beforeEach(async () => {
  kd = await startKabuld({ trustLocalBrowser: false });
});
test.afterEach(() => kd?.stop());

// Uma pasta por aparelho: iphone/ (WebKit, iPhone 15) e android/ (Chromium, Pixel 8).
const android = () => test.info().project.name.includes("android");
const dir = () => `../../.context/comparar/mobile/${process.env.CAPTURA ?? "atual"}/${android() ? "android" : "iphone"}`;
const shot = (page: Page, name: string) => page.waitForTimeout(450).then(() => (mkdirSync(dir(), { recursive: true }), page.screenshot({ path: `${dir()}/${name}.png` })));

async function phone(browser: Browser, colorScheme: "dark" | "light"): Promise<Page> {
  const ctx = await browser.newContext({ ...devices[android() ? "Pixel 8" : "iPhone 15"], colorScheme });
  return ctx.newPage();
}

for (const scheme of ["dark", "light"] as const) {
  test(`capturas do celular (${scheme})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const page = await phone(browser, scheme);
    const sfx = scheme === "dark" ? "" : "-claro";
    if (scheme === "dark") {
      await page.goto(`${kd.base}/m/`);
      await expect(page.getByTestId("m-need-pairing")).toBeVisible();
      await shot(page, `01-sem-pareamento${sfx}`);
    }
    await page.goto(kd.pairLink);
    await expect(page.getByTestId("m-pair")).toBeVisible();
    await page.getByTestId("m-pair-user").fill(scheme === "dark" ? "Ana" : "Bia");
    await shot(page, `02-pareamento${sfx}`);
    await page.getByTestId("m-pair-go").click();
    await expect(page.getByTestId("m-list")).toBeVisible();
    await expect(page.getByTestId("m-session").first()).toBeVisible();
    await shot(page, `03-lista${sfx}`);

    // Folha de novo chat (seletor de modelo) e o chat com aprovação.
    await wsAction(page, "Login novo", "m-new-chat");
    await expect(page.getByTestId("m-model").first()).toBeVisible();
    await shot(page, `04-seletor-modelo${sfx}`);
    await page.getByTestId("m-model").filter({ has: page.locator('[data-agent="claude"]') }).first().click();
    await expect(page.getByTestId("m-chat")).toBeVisible();
    await page.getByTestId("m-chat-input").fill("oi do celular");
    await page.getByTestId("m-chat-send").click();
    await expect(page.getByTestId("m-msg-agent").last()).toContainText("eco: oi do celular");
    await page.getByTestId("m-chat-input").fill("rode os testes e aprovar");
    await page.getByTestId("m-chat-send").click();
    await expect(page.getByTestId("m-approve").last()).toBeVisible();
    await shot(page, `05-chat-aprovacao${sfx}`);
    await page.getByTestId("m-approve").last().click();
    await expect(page.getByTestId("m-msg-agent").last()).toContainText("Rodei os testes");
    await page.getByTestId("m-chat-input").fill("texto no composer");
    await shot(page, `06-chat${sfx}`);

    // Cartão do plano (só na interface nova).
    if (await page.getByTestId("m-plan-toggle").count()) {
      await page.getByTestId("m-chat-input").fill("planejar o login");
      await page.getByTestId("m-chat-send").click();
      await expect(page.getByTestId("m-plan-approve")).toBeVisible();
      await shot(page, `06b-plano${sfx}`);
      await page.getByTestId("m-plan-approve").click();
      await expect(page.getByTestId("m-msg-agent").last()).toContainText("Executando o plano");
    }

    // Terminal ao vivo de um shell com a barra de teclas.
    await page.getByTestId("m-back").click();
    await expect(page.getByTestId("m-list")).toBeVisible();
    await page.locator(`[data-id="tmux:${kd.sessions.shell}"]`).click();
    await expect(page.getByTestId("m-terminal")).toBeVisible();
    await page.getByTestId("m-term-input").fill("echo ola-$((40+2))");
    await page.getByTestId("m-term-send").click();
    await expect(page.locator(".m-term .xterm-rows")).toContainText("ola-42", { timeout: 10_000 });
    await shot(page, `07-terminal${sfx}`);

    // Menu/configurações.
    await page.getByTestId("m-back").click();
    await page.getByTestId("m-menu").click();
    await shot(page, `08-menu${sfx}`);

    // Telas que só existem na interface nova (abas, ordenar/filtrar, criar workspace, uso).
    if (!(await page.getByTestId("m-tabbar").count())) return;
    await page.getByTestId("m-devices").click();
    await expect(page.getByTestId("m-device").first()).toBeVisible({ timeout: 15_000 });
    await shot(page, `09-controle-remoto${sfx}`);
    await page.getByTestId("m-back").click();
    await page.getByTestId("m-tab-usage").click();
    await expect(page.getByTestId("m-usage-model").first()).toBeVisible({ timeout: 15_000 });
    await shot(page, `10-uso${sfx}`);
    await page.getByTestId("m-tab-home").click();
    await page.getByTestId("m-sort").click();
    await shot(page, `11-ordenar-filtrar${sfx}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("m-create").click();
    await page.getByTestId("m-new-prompt").fill("Revisar o fluxo de cadastro");
    await shot(page, `12-novo-workspace${sfx}`);
    await page.getByTestId("m-new-options").click();
    await page.getByTestId("m-new-plan").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("m-plan-chip")).toBeVisible();
    await shot(page, `12b-novo-workspace-plano${sfx}`);
    await page.getByTestId("m-new-repo").click();
    await shot(page, `13-selecionar-repo${sfx}`);
    await page.keyboard.press("Escape");
    await page.getByTestId("m-new-model").click();
    await shot(page, `14-selecionar-modelo${sfx}`);
  });
}
