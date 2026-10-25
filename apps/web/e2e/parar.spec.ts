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
async function say(page: Page, t: string) {
  await chat(page).getByTestId("composer").fill(t);
  await chat(page).getByTestId("composer").press("Enter");
}

test("Parar com comando longo: o passo vira 'Interrompido' (sem girar), o marcador fica no fim e eventos atrasados são descartados", async ({ page }) => {
  await setup(page);
  await say(page, "rode sleep 30");
  const step = host(page).locator('[data-tool="Bash"]');
  await expect(step).toHaveAttribute("data-state", "running");
  await expect(step.locator(".spinner")).toBeVisible();
  await host(page).getByTestId("stop").click();
  await expect(step).toHaveAttribute("data-state", "interrupted");
  await expect(step.locator(".spinner")).toHaveCount(0);
  await expect(step.getByTestId("step-interrupted")).toHaveText("Interrompido");
  // Parou pelo protocolo do agente (a sessão continua), sem "processos deixados".
  await expect.poll(() => page.evaluate(() => (window as any).__mock.interrupted)).toBe(1);
  await expect(host(page).getByTestId("leftovers")).toHaveCount(0);
  // "Interrompido" depois do último passo.
  const last = host(page).locator(".thread > *").last();
  await expect(last).toHaveText("Interrompido");
  // O resultado e o fim do turno chegam 3 s depois: descartados.
  await page.waitForTimeout(3400);
  await expect(host(page).getByText("saída atrasada")).toHaveCount(0);
  await expect(host(page).getByText("Texto atrasado.")).toHaveCount(0);
  await expect(host(page).locator(".turn-meta")).toHaveCount(0);
  await expect(host(page).locator(".thread > *").last()).toHaveText("Interrompido");
  // A conversa segue: o próximo envio funciona.
  await say(page, "liste");
  await expect(host(page).locator(".turn-meta")).toHaveCount(1);
});

test("Parar com servidor em segundo plano: lista o que ficou rodando; manter (padrão) vai para Recursos/Painel com Encerrar; encerrar só os marcados; docker stop", async ({ page }) => {
  await setup(page);
  await say(page, "suba o servidor");
  await expect(host(page).locator('[data-tool="Bash"]').nth(1)).toHaveAttribute("data-state", "running");
  await host(page).getByTestId("stop").click();
  const card = host(page).getByTestId("leftovers");
  await expect(card).toContainText("O agente deixou 1 processo rodando");
  await expect(card.getByTestId("leftover-row")).toContainText("vite --port 3000");
  await expect(card.getByTestId("leftover-row")).toContainText(":3000");
  await expect(card.getByTestId("leftover-container")).toContainText("postgres:16");
  await expect(card.getByTestId("leftovers-kill")).toBeDisabled();
  await card.getByTestId("docker-stop").click();
  await expect(card.getByTestId("leftover-container")).toContainText("parado");
  expect(await page.evaluate(() => (window as any).__mock.dockerStopped)).toEqual(["abc123def456"]);
  // Manter rodando (padrão): nada é encerrado; aparece em Recursos e no Painel com "Encerrar".
  await card.getByTestId("leftovers-keep").click();
  await expect(card.getByTestId("leftovers-decided")).toContainText("Mantidos rodando");
  expect(await page.evaluate(() => (window as any).__mock.killed)).toBeUndefined();
  await page.getByTestId("res-chip").click();
  await expect(page.getByTestId("kept-row")).toContainText("vite --port 3000");
  await page.keyboard.press("Escape");
  await page.getByTestId("sidebar").getByRole("button", { name: "Painel", exact: true }).click();
  await expect(page.getByTestId("kept-row")).toContainText("vite --port 3000");
  await page.getByTestId("kept-kill").click();
  await expect(page.getByTestId("kept-row")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mock.killed)).toEqual([4242]);
});

test("Parar e encerrar os marcados; 'Lembrar para este workspace' aplica sozinho na próxima vez", async ({ page }) => {
  await setup(page);
  await say(page, "suba o servidor");
  await expect(host(page).locator('[data-tool="Bash"]').nth(1)).toHaveAttribute("data-state", "running");
  await host(page).getByTestId("stop").click();
  const card = host(page).getByTestId("leftovers");
  await card.getByTestId("leftover-check").check();
  await card.getByTestId("leftovers-remember").check();
  await card.getByTestId("leftovers-kill").click();
  await expect(card.getByTestId("leftovers-decided")).toContainText("Encerrados");
  expect(await page.evaluate(() => (window as any).__mock.killed)).toEqual([4242]);
  await say(page, "suba o servidor de novo");
  await expect(host(page).locator('[data-tool="Bash"]').nth(3)).toHaveAttribute("data-state", "running");
  await host(page).getByTestId("stop").click();
  await expect(host(page).getByTestId("leftovers").nth(1).getByTestId("leftovers-decided")).toContainText("Encerrados");
  expect(await page.evaluate(() => (window as any).__mock.killed)).toEqual([4242, 4242]);
});

test("Fechar a aba e arquivar listam os processos que o agente abriu; continuam rodando salvo os marcados", async ({ page }) => {
  await setup(page);
  await say(page, "suba o servidor");
  await expect(host(page).locator('[data-tool="Bash"]').nth(1)).toHaveAttribute("data-state", "running");
  await host(page).getByTestId("ctab").first().hover();
  await host(page).locator(".ctab .x, .ctab [title^='Fechar']").first().click();
  await expect(page.getByTestId("confirm-procs")).toContainText("vite --port 3000");
  await expect(page.getByTestId("confirm")).toContainText("O agente deixou 1 processo rodando");
  await page.getByTestId("confirm-ok").click();
  // Mantido (não marcado): vai para a lista de mantidos.
  await page.getByTestId("sidebar").getByRole("button", { name: "Painel", exact: true }).click();
  await expect(page.getByTestId("kept-row")).toContainText("vite --port 3000");
});
