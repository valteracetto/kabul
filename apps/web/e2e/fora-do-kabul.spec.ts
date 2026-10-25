import { addRepo, navTo } from "./helpers";
import { test, expect } from "../playwright-silencio";

test("Painel: agentes fora do Kabul, recentes dos CLIs, continuar no Kabul pela mesma sessão e nuvem por link", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await navTo(page, "sessions");

  const run = page.getByTestId("external-running").getByTestId("external-row");
  await expect(run).toHaveCount(2);
  await expect(run.nth(0)).toContainText("codex");
  await expect(run.nth(0)).toContainText("Fora do Kabul");
  await expect(run.nth(0)).toContainText("13 min");
  await expect(run.nth(0)).toContainText("Terminal");
  // Pasta sem workspace do Kabul: não dá para continuar (e o motivo aparece no título).
  await expect(run.nth(1).getByTestId("external-continue")).toBeDisabled();
  await expect(run.nth(1).getByTestId("external-continue")).toHaveAttribute("title", /Nenhum workspace/);
  const rec = page.getByTestId("external-recent").getByTestId("recent-row");
  await expect(rec).toHaveCount(2);
  await expect(rec.nth(0)).toContainText("Revisar a fila de mensagens");
  await expect(rec.nth(0)).toContainText("feat/fila");
  await expect(rec.nth(0)).toContainText("há 1 h");
  await page.screenshot({ path: "../../.context/e2e/painel-fora-do-kabul.png" });

  // Continuar o codex: abre o workspace numa aba nova retomando a mesma sessão.
  await run.nth(0).getByTestId("external-continue").click();
  const chat = page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
  await expect(chat.locator(".notice", { hasText: "Continuando" })).toContainText("codex");
  // O seletor já no modelo do agente da sessão (a lista de modelos chegou).
  await expect(chat.locator(".composer-wrap")).toContainText("GPT-6-Luna");
  await chat.getByTestId("composer").fill("continua daí");
  await chat.getByTestId("composer").press("Enter");
  await expect(chat.locator(".turn-meta")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).__kabulLastStart)).toEqual({ harness: "codex", resume: "0000-codex-sess" });

  // Recente do claude no mesmo workspace.
  await navTo(page, "sessions");
  await page.getByTestId("external-recent").getByTestId("recent-continue").first().click();
  await expect(chat.locator(".notice", { hasText: "Continuando" }).last()).toContainText("Revisar a fila de mensagens");
  await expect(chat.locator(".composer-wrap")).toContainText("Opus");
  await chat.getByTestId("composer").fill("segue");
  await chat.getByTestId("composer").press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).__kabulLastStart)).toEqual({ harness: "claude", resume: "2222-claude-hist" });

  // Nuvem criada fora: colar o link e trazer para o Mac.
  await navTo(page, "sessions");
  await expect(page.getByTestId("cloud-paste")).toContainText("Cole o link");
  await expect(page.getByTestId("cloud-paste-go")).toBeDisabled();
  await page.getByTestId("cloud-paste-input").fill("https://claude.ai/code/session_01AbCdEfGh");
  await page.getByTestId("cloud-paste-ws").selectOption({ index: 1 });
  await page.getByTestId("cloud-paste-go").click();
  await expect(page.getByTestId("cloud-paste")).toHaveCount(0);
});
