import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}
const settings = (page: Page) => page.evaluate(() => (window as any).__mock.db.settings);

test("configurações: Geral (som com Testar, contexto, colagem longa, absolutely right), Aparência, Modelos, Avançado", async ({ page }) => {
  await setup(page);
  await page.getByTestId("settings").click();
  await page.getByTestId("sound-select").selectOption("Ping");
  await page.getByTestId("sound-test").click();
  await expect.poll(() => page.evaluate(() => (window as any).__sound)).toBe("Ping");
  await page.getByTestId("toggle-not_absolutely_right").click();
  await expect.poll(() => settings(page)).toMatchObject({ completion_sound: "Ping", not_absolutely_right: true });
  // Aparência
  await page.getByTestId("set-tab-aparencia").click();
  await page.getByTestId("contrast").selectOption("low");
  await page.getByTestId("cb").selectOption("deuteranopia");
  await page.getByTestId("md-style").selectOption("tufte");
  await page.getByTestId("mono-font").selectOption("Menlo");
  expect(await page.evaluate(() => [document.documentElement.dataset.contrast, document.documentElement.dataset.cb, document.documentElement.classList.contains("md-tufte"), document.documentElement.style.getPropertyValue("--mono-font")])).toEqual(["low", "deuteranopia", true, '"Menlo"']);
  await page.getByTestId("term-size").fill("16");
  expect(await page.evaluate(() => localStorage.getItem("kabul.term.size"))).toBe("16");
  await page.screenshot({ path: "../../.context/e2e/config-aparencia.png" });
  await page.getByTestId("contrast").selectOption("normal");
  await page.getByTestId("cb").selectOption("default");
  await page.getByTestId("md-style").selectOption("default");
  // Modelos
  await page.getByTestId("set-tab-modelos").click();
  await page.getByTestId("output-style").selectOption("Explanatory");
  await page.getByTestId("review-model").selectOption("codex:gpt-6-luna");
  await page.getByTestId("toggle-default_plan").click();
  await expect.poll(() => settings(page)).toMatchObject({ claude_output_style: "Explanatory", review_model: "codex:gpt-6-luna", default_plan: true });
  // Avançado
  await page.getByTestId("set-tab-avancado").click();
  await page.getByTestId("bin-claude_path").fill("/opt/claude/bin/claude");
  await page.getByTestId("bin-claude_path").blur();
  await expect.poll(() => settings(page)).toMatchObject({ claude_path: "/opt/claude/bin/claude" });
  // Efeitos no chat: plano por padrão, frase escondida, revisão com outro modelo
  await page.getByTestId("ws-row").click();
  await host(page).getByTestId("new-tab").click();
  await page.getByTestId("new-chat").click();
  await expect(host(page).locator(".composer.plan")).toBeVisible();
  await chat(page).getByTestId("composer").press("Shift+Tab");
  await chat(page).getByTestId("composer").fill("você está certo?");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).locator(".msg-assistant").last()).toHaveText("Corrigi o teste.");
  await page.keyboard.press("Meta+Shift+r");
  await expect(host(page).getByTestId("ctab").last()).toContainText("Revis");
  await expect(chat(page).locator(".composer .picker-trigger")).toContainText("GPT-6-Luna");
  // Colar texto longo vira anexo
  await chat(page).getByTestId("composer").focus();
  await page.evaluate(() => {
    const t = document.querySelector(".ws-host:not([hidden]) .center-body:not([hidden]) [data-testid=composer]") as HTMLTextAreaElement;
    const dt = new DataTransfer();
    dt.setData("text/plain", "x".repeat(6000));
    t.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(chat(page).getByTestId("composer")).toHaveValue(/@\.context\/attachments\/colado-\d+\.txt/);
});

test("configurações por repositório: Ambiente (usuário e repo, herança, colar em bloco), Ações (prompt usado no Revisar), Diversos (ícone, preview)", async ({ page }) => {
  await setup(page);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-ambiente").click();
  await page.getByTestId("env-bulk").fill("export API_URL=http://localhost:3000\nDEBUG='1'\n# comentário\n1RUIM=x");
  await page.getByTestId("env-bulk-add").click();
  await expect(page.getByTestId("env-row")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.settings.env.map((e: any) => `${e.key}=${e.value}`))).toEqual(["API_URL=http://localhost:3000", "DEBUG=1"]);
  await page.getByTestId("env-scope-repo").click();
  await expect(page.getByTestId("repo-env-row").filter({ hasText: "API_URL" })).toContainText("herdada do repositório");
  await expect(page.getByTestId("repo-env-row").filter({ hasText: "LOG" })).toContainText("sobrescrita localmente");
  await page.screenshot({ path: "../../.context/e2e/config-ambiente.png" });
  // Ações
  await page.getByTestId("set-tab-acoes").click();
  await page.getByTestId("prompt-review").fill("Foque em segurança e em SQL injection.");
  await page.getByTestId("prompt-review").blur();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.repoSettings.prompts.review)).toBe("Foque em segurança e em SQL injection.");
  // Diversos
  await page.getByTestId("set-tab-diversos").click();
  await page.getByTestId("repo-icon").nth(1).click();
  await expect(page.getByTestId("repo-demo")).toContainText("🚀");
  await page.getByTestId("preview-url").fill("http://localhost:$((KABUL_PORT+1))");
  await page.getByTestId("preview-url").blur();
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.repoSettings.preview_url)).toBe("http://localhost:$((KABUL_PORT+1))");
  // O Revisar usa o prompt do repo
  await page.getByTestId("ws-row").click();
  await page.keyboard.press("Meta+Shift+r");
  await expect(chat(page).locator(".msg-user").last()).toContainText("Foque em segurança e em SQL injection.");
});
