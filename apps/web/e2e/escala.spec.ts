import { test, expect, type Page } from "@playwright/test";

// Escala (docs/escala.md): só o workspace visível montado (estado guardado), eventos em segundo plano,
// painel Agentes (filtros, subagentes, parar em lote), fila "aguardando vaga" e janela do chat longo.
const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
async function open(page: Page, seed: Record<string, unknown> = {}) {
  await page.addInitScript((s) => ((window as any).__kabulSeed = { repos: 2, workspaces: 6, ...s }), seed);
  await page.goto("/?mock");
  await expect(page.getByTestId("ws-row")).toHaveCount(6);
}
async function goWs(page: Page, id: string) {
  await page.locator(`[data-testid=ws-row][data-ws="${id}"]`).click();
  await expect(host(page).locator(".crumb-title")).toHaveText(`Tarefa ${id.slice(1)}`);
}
async function say(page: Page, t: string) {
  await chat(page).getByTestId("composer").fill(t);
  await chat(page).getByTestId("composer").press("Enter");
}

test("só o workspace visível fica montado; rascunho, conversa, terminal e eventos em segundo plano voltam ao reabrir", async ({ page }) => {
  await open(page);
  await goWs(page, "w0");
  // Terminal: o que foi digitado continua no buffer depois de sair e voltar.
  await page.locator(".term-host").click();
  await page.keyboard.type("ls");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("mock: comando executado");
  // Turno lento (com subagente): sai do workspace no meio dele.
  await say(page, "faça devagar");
  await expect(page.locator('[data-ws="w0"] .spinner')).toBeVisible();
  await goWs(page, "w1");
  await expect(page.locator(".ws-host")).toHaveCount(1);
  await chat(page).getByTestId("composer").fill("rascunho que não foi enviado");
  // Fim do turno fora da tela: o status chega pelo registro (sem a tela montada) e vira não lido.
  await expect(page.locator('[data-ws="w0"] .spinner')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('[data-ws="w0"]')).toHaveClass(/unread/);
  await goWs(page, "w0");
  await expect(chat(page).locator(".msg-assistant").last()).toContainText("Sem vulnerabilidades.");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await expect(page.locator(".xterm-rows")).toContainText("mock: comando executado");
  // Subagente do turno: na árvore, concluído.
  await chat(page).getByTestId("subagents-btn").click();
  await expect(page.getByTestId("subagent-row")).toHaveCount(1);
  await expect(page.getByTestId("subagent-row")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("subagent-row")).toContainText("Revisar o lockfile");
  await page.keyboard.press("Escape");
  await goWs(page, "w1");
  await expect(chat(page).getByTestId("composer")).toHaveValue("rascunho que não foi enviado");
});

test("painel Agentes: todos os ativos, filtros, subagentes com filhos, abrir a conversa e parar em lote", async ({ page }) => {
  await open(page);
  await goWs(page, "w1");
  await say(page, "carga 1");
  await goWs(page, "w2");
  await say(page, "carga 2");
  await expect(chat(page).getByTestId("stop")).toBeVisible();
  // Subagente com eventos filhos (parent_tool_use_id): ferramentas e tokens no nó.
  await expect(chat(page).getByTestId("subagents-btn")).toContainText("subagente", { timeout: 6000 });
  await page.getByTestId("nav-agents").click();
  await expect(page.getByTestId("agents-count")).toHaveText("2");
  const rows = page.getByTestId("agent-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute("data-status", "working");
  await page.getByTestId("agents-filter-waiting").click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId("agents-filter-active").click();
  await page.getByTestId("agents-search").fill("Tarefa 2");
  await expect(rows).toHaveCount(1);
  await rows.first().getByTestId("agent-subs").click();
  await expect(page.getByTestId("subagent-row").first()).toContainText("Revisar parte");
  await expect(page.getByTestId("subagent-row").first()).toContainText("1 ferr.", { timeout: 5000 });
  // Abrir a conversa a partir do painel.
  await rows.first().getByTestId("agent-open").click();
  await expect(host(page).locator(".crumb-title")).toHaveText("Tarefa 2");
  await expect(chat(page).getByTestId("stop")).toBeVisible();
  // Parar em lote (os dois workspaces fora da tela: um comando só no backend).
  await page.getByTestId("nav-agents").click();
  await page.getByTestId("agents-search").fill("");
  await page.getByTestId("agents-select-all").click();
  await page.getByTestId("agents-stop-selected").click();
  await page.getByTestId("confirm-ok").click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId("agents-count")).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__mock.batchStopped)).length).toBe(2);
  await goWs(page, "w1");
  await expect(chat(page).locator(".notice").last()).toHaveText("Interrompido");
  await expect(chat(page).getByTestId("stop")).toHaveCount(0);
});

test("limite de agentes: o segundo fica 'aguardando vaga' (conversa, aba, barra lateral e painel) e entra quando o primeiro para", async ({ page }) => {
  await open(page);
  await page.evaluate(() => ((window as any).__mock.agentLimit = 1));
  await goWs(page, "w1");
  await say(page, "carga 1");
  await expect(chat(page).getByTestId("working")).toBeVisible();
  await goWs(page, "w2");
  await say(page, "carga 2");
  await expect(chat(page).getByTestId("slot-wait")).toContainText("Aguardando vaga · 1º na fila (limite de 1 agentes ao mesmo tempo)");
  await expect(host(page).getByTestId("tab-queued")).toBeVisible();
  await expect(page.locator('[data-ws="w2"]').getByTestId("ws-queued")).toBeVisible();
  await page.getByTestId("nav-agents").click();
  await expect(page.getByTestId("agents-limit")).toContainText("Limite: 1 ao mesmo tempo · 1 rodando · 1 na fila");
  await page.getByTestId("agents-filter-queued").click();
  await expect(page.getByTestId("agent-row")).toHaveCount(1);
  await expect(page.getByTestId("agent-row")).toContainText("Aguardando vaga · 1º");
  // Para o primeiro: o da fila ganha a vaga.
  await page.getByTestId("agents-filter-working").click();
  await page.getByTestId("agent-row").getByTestId("agent-stop").click();
  await page.getByTestId("agents-filter-active").click();
  await expect(page.getByTestId("agent-row")).toHaveCount(1);
  await expect(page.getByTestId("agent-row")).toHaveAttribute("data-status", "working");
  await goWs(page, "w2");
  await expect(chat(page).getByTestId("slot-wait")).toHaveCount(0);
  await expect(chat(page).getByTestId("working")).toBeVisible();
  // Limite pelo painel (agents_config).
  await page.getByTestId("nav-agents").click();
  await page.getByTestId("agents-limit-input").fill("4");
  await page.getByTestId("agents-limit-input").press("Enter");
  await expect(page.getByTestId("agents-limit")).toContainText("Limite: 4");
});

test("conversa longa: desenha as mensagens recentes e traz as anteriores ao rolar até o topo", async ({ page }) => {
  await open(page, { longChat: 2000 });
  await goWs(page, "w0");
  await expect(chat(page).locator(".msg-assistant").last()).toContainText("componente");
  const users = chat(page).locator(".msg-user");
  const first = await users.count();
  expect(first).toBeLessThan(200);
  await expect(chat(page).getByTestId("load-older")).toBeVisible();
  await chat(page).locator(".messages").evaluate((el) => (el.scrollTop = 0));
  await expect.poll(() => users.count()).toBeGreaterThan(first);
  // Minimapa e ⌘F continuam: a busca desenha tudo.
  await chat(page).getByTestId("composer").click();
  await page.keyboard.press("Meta+f");
  await page.getByTestId("chat-find-input").fill("Pergunta 3:");
  await expect(page.getByTestId("chat-find-count")).toHaveText("1/1");
  await expect(users).toHaveCount(1000);
});
