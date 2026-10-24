import { test, expect, devices, type Browser, type Page } from "@playwright/test";
import { startKabuld, type Kabuld } from "./helpers";

// Colaboração em tempo real: Ana (dona, pareada pelo QR), Bia (editora, por convite) e Caio
// (observador) no mesmo workspace, cada um num iPhone. Chat com agente falso (stream-json do Claude).
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ trustLocalBrowser: false });
});
test.afterAll(() => kd?.stop());

async function phone(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...devices["iPhone 15"] });
  return ctx.newPage();
}

async function pairAs(page: Page, link: string, name: string) {
  await page.goto(link);
  await page.getByTestId("m-pair-user").fill(name);
  await page.getByTestId("m-pair-go").click();
  await expect(page.getByTestId("m-list")).toBeVisible();
}

async function invite(ana: Page, role: "editor" | "observer"): Promise<string> {
  await ana.getByTestId("m-group").filter({ hasText: "Login novo" }).getByTestId("m-invite").click();
  await ana.getByTestId(role === "editor" ? "m-role-editor" : "m-role-observer").click();
  await ana.getByTestId("m-invite-go").click();
  const url = (await ana.getByTestId("ticket-url").textContent())!.trim();
  await expect(ana.getByTestId("ticket-left")).toContainText("Expira em");
  await ana.keyboard.press("Escape");
  return url;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `../../.context/e2e/kabuld-colab-${name}.png` });

test("dois clientes no mesmo chat: autoria, digitando, fila única, primeira aprovação vale, terminal compartilhado, observador e revogação", async ({ browser }) => {
  test.setTimeout(150_000);
  const ana = await phone(browser);
  await pairAs(ana, kd.pairLink, "Ana");

  // Convite de editor para o workspace "Login novo".
  const bia = await phone(browser);
  await pairAs(bia, await invite(ana, "editor"), "Bia");
  // A convidada só vê o workspace compartilhado.
  await expect(bia.getByTestId("m-group")).toHaveCount(1);
  await expect(bia.getByTestId("m-group")).toContainText("Login novo");
  await expect(bia.locator(`[data-id="tmux:${kd.sessions.shell}"]`)).toHaveCount(0);
  await expect(bia.getByTestId("m-invite")).toHaveCount(0);

  // Ana abre um chat no workspace (agente falso no lugar do claude).
  await ana.getByTestId("m-group").filter({ hasText: "Login novo" }).getByTestId("m-new-chat").click();
  await ana.getByTestId("m-model").filter({ has: ana.locator('[data-agent="claude"]') }).first().click();
  await expect(ana.getByTestId("m-chat")).toBeVisible();
  const chatId = decodeURIComponent(new URL(ana.url()).hash.replace("#s=", ""));

  // Bia acha o chat na lista e entra; os dois aparecem na presença.
  await expect(bia.locator(`[data-id="${chatId}"]`)).toBeVisible({ timeout: 10_000 });
  await bia.locator(`[data-id="${chatId}"]`).click();
  await expect(bia.getByTestId("m-chat")).toBeVisible();
  await expect(ana.locator('[data-testid="m-presence-user"][data-name="Bia"]')).toBeVisible();
  await expect(bia.locator('[data-testid="m-presence-user"][data-name="Ana"]')).toBeVisible();

  // Bia digitando → Ana vê; Bia manda → os dois veem a mensagem com autoria e a resposta.
  await bia.getByTestId("m-chat-input").pressSequentially("oi do celular", { delay: 20 });
  await expect(ana.getByTestId("m-typing")).toContainText("Bia digitando");
  await bia.getByTestId("m-chat-send").click();
  for (const p of [ana, bia]) {
    await expect(p.locator('[data-testid="m-msg-user"][data-author="Bia"]')).toContainText("oi do celular");
    await expect(p.getByTestId("m-msg-agent").last()).toContainText("eco: oi do celular");
  }
  await expect(ana.getByTestId("m-typing")).toHaveCount(0, { timeout: 8000 });

  // Fila única: Ana manda algo demorado; Bia e Ana mandam mais duas enquanto o agente trabalha.
  await ana.getByTestId("m-chat-input").fill("devagar um");
  await ana.getByTestId("m-chat-send").click();
  await bia.getByTestId("m-chat-input").fill("segunda da Bia");
  await bia.getByTestId("m-chat-send").click();
  await ana.getByTestId("m-chat-input").fill("terceira da Ana");
  await ana.getByTestId("m-chat-send").click();
  await expect(ana.getByTestId("m-queue-item")).toHaveCount(2);
  await expect(ana.getByTestId("m-queue-item").first()).toContainText("segunda da Bia");
  await expect(bia.getByTestId("m-queue-item").nth(1)).toContainText("terceira da Ana");
  await shot(ana, "fila");
  await expect(ana.getByTestId("m-queue")).toHaveCount(0, { timeout: 15_000 });
  const replies = await ana.getByTestId("m-msg-agent").allTextContents();
  expect(replies.slice(-3)).toEqual(["eco: devagar um", "eco: segunda da Bia", "eco: terceira da Ana"]);

  // Aprovação: aparece para os dois; Bia aprova primeiro; Ana vê quem aprovou.
  await ana.getByTestId("m-chat-input").fill("rode os testes e aprovar");
  await ana.getByTestId("m-chat-send").click();
  await expect(bia.getByTestId("m-approve").last()).toBeVisible();
  await expect(ana.getByTestId("m-approve").last()).toBeVisible();
  await bia.getByTestId("m-approve").last().click();
  await expect(ana.getByTestId("m-decision").last()).toHaveText("Aprovado por Bia");
  await expect(ana.getByTestId("m-msg-agent").last()).toContainText("Rodei os testes");
  await shot(ana, "aprovado");

  // Terminal compartilhado: Bia digita no tmux do workspace e Ana vê ao vivo.
  for (const p of [ana, bia]) {
    await p.getByTestId("m-back").click();
    await p.locator(`[data-id="tmux:${kd.sessions.claude}"]`).click();
    await expect(p.getByTestId("m-terminal")).toBeVisible();
  }
  await bia.getByTestId("m-term-input").fill("feito pela Bia");
  await bia.getByTestId("m-term-send").click();
  await expect(ana.locator(".m-term .xterm-rows")).toContainText("feito pela Bia");

  // Observador: vê, mas não digita nem aprova.
  await ana.getByTestId("m-back").click();
  const caio = await phone(browser);
  await pairAs(caio, await invite(ana, "observer"), "Caio");
  await expect(caio.getByTestId("m-new-chat")).toHaveCount(0);
  await caio.locator(`[data-id="${chatId}"]`).click();
  await expect(caio.getByTestId("m-readonly")).toBeVisible();
  await expect(caio.getByTestId("m-msg-user").first()).toBeVisible();
  await expect(caio.getByTestId("m-chat-input")).toHaveCount(0);
  await expect(caio.getByTestId("m-approve")).toHaveCount(0);

  // Revogar a Bia derruba a conexão dela na hora.
  await ana.getByTestId("m-menu").click();
  await ana.getByTestId("m-devices").click();
  const row = ana.getByTestId("m-device").filter({ hasText: "Bia" });
  await row.getByTestId("m-revoke").click();
  await row.getByTestId("m-revoke-confirm").click();
  await expect(bia.getByTestId("m-need-pairing")).toContainText("Acesso revogado");
  await shot(bia, "revogada");
});
