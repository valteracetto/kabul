import { test, expect } from "@playwright/test";
import { startKabuld, type Kabuld } from "./helpers";

// Plan mode no celular (iPhone e Android): nativo no Claude ao criar o workspace, cartão do plano com
// Ajustar e Aprovar, e plano emulado (instrução na mensagem) ao ligar no meio da conversa.
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ fakeHome: true });
});
test.afterAll(() => kd?.stop());

test("plan mode: workspace novo em plano nativo, cartão com Ajustar e Aprovar, plano emulado no meio da conversa", async ({ page }) => {
  await page.goto(`${kd.base}/m/`);
  await page.getByTestId("m-create").click();
  await page.getByTestId("m-new-repo").click();
  await page.getByTestId("m-repo").filter({ hasText: "app-exemplo" }).click();
  await page.getByTestId("m-new-options").click();
  await page.getByTestId("m-new-plan").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("m-plan-chip")).toHaveText(/Plano$/);
  await page.getByTestId("m-new-prompt").fill("planejar o login");
  await page.getByTestId("m-new-go").click();

  // O agente propõe o plano: cartão listrado + folha com Ajustar / Aprovar e executar.
  await expect(page.getByTestId("m-plan-card")).toContainText("Corrigir a validação", { timeout: 20_000 });
  await expect(page.getByTestId("m-plan-chip")).toHaveAttribute("data-mode", "native");
  await page.getByTestId("m-plan-adjust").click();
  await page.getByTestId("m-plan-adjust-text").fill("incluir testes");
  await page.getByTestId("m-plan-adjust-send").click();
  // Ajustar nega o plano e manda o ajuste; o agente (em plan mode) responde com "(plano)".
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("(plano) eco: incluir testes");

  await page.getByTestId("m-chat-input").fill("planejar de novo");
  await page.getByTestId("m-chat-send").click();
  await page.getByTestId("m-plan-approve").click();
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("Executando o plano");
  // Aprovado: sai do plano nativo.
  await expect(page.getByTestId("m-plan-toggle")).toBeVisible();

  // Ligar no meio da conversa = plano emulado (instrução na mensagem).
  await page.getByTestId("m-plan-toggle").click();
  await expect(page.getByTestId("m-plan-chip")).toHaveText("Plano (emulado)");
  await page.getByTestId("m-chat-input").fill("arrumar o rodapé");
  await page.getByTestId("m-chat-send").click();
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("[Modo plano]");
  await expect(page.getByTestId("m-msg-user").last()).toContainText("planoarrumar o rodapé");
});
