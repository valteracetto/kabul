import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

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

test("cards por ferramenta, passos recolhidos (⌃O), markdown, popover de tempo", async ({ page }) => {
  await setup(page);
  await say(page, "liste");
  await expect(host(page).locator(".turn-meta")).toBeVisible();
  await expect(host(page).getByTestId("expand-steps")).toContainText("3 ferramentas");
  await expect(host(page).getByTestId("steps-shell")).toBeVisible();
  await host(page).getByTestId("expand-steps").click();
  await expect(host(page).locator('[data-tool="TodoWrite"]')).toContainText("1/2 concluídas");
  await expect(host(page).locator('[data-tool="Edit"]')).toContainText('+ println!("olá");');
  await expect(host(page).locator(".md-table")).toContainText("main.rs");
  await expect(host(page).locator(".md-link", { hasText: "a doc" })).toBeVisible();
  await host(page).getByTestId("turn-time").hover();
  await expect(page.getByTestId("time-pop")).toContainText("Cache lido");
  await expect(page.getByTestId("time-pop")).toContainText("9.000");
  await page.screenshot({ path: "../../.context/e2e/p0-cards.png" });
  await say(page, "de novo");
  await expect(host(page).locator(".turn-meta")).toHaveCount(2);
  await expect(host(page).getByTestId("expand-steps")).toHaveCount(1);
  await host(page).getByTestId("composer").focus();
  await page.keyboard.press("Control+o");
  await expect(host(page).getByTestId("expand-steps")).toHaveCount(0);
});

test("aprovação: ⌘↵ sempre permitir, ⌫ nega; plano e perguntas", async ({ page }) => {
  await setup(page);
  await say(page, "crie o arquivo");
  await expect(host(page).getByTestId("approval")).toContainText("Criar/sobrescrever este arquivo?");
  await host(page).getByTestId("composer").press("Meta+Enter");
  await expect(host(page).getByTestId("approval")).toContainText("Sempre permitido (Write)");
  await say(page, "crie outro");
  await expect(host(page).getByTestId("approval").nth(1)).toBeVisible();
  await host(page).getByTestId("composer").press("Backspace");
  await expect(host(page).getByTestId("approval").nth(1)).toContainText("Negado");
  // Plano
  await say(page, "faça um plano");
  await expect(host(page).getByTestId("plan-card")).toContainText("Corrigir o login");
  await page.screenshot({ path: "../../.context/e2e/p0-plano.png" });
  await host(page).getByTestId("plan-approve").click();
  await expect(host(page).locator(".msg-assistant").last()).toContainText("Executando o plano.");
  // Perguntas: teclas 1 e →, enviar
  await say(page, "pergunte antes");
  await expect(host(page).getByTestId("question-card")).toContainText("Qual banco usar?");
  await host(page).getByTestId("question-card").click();
  await page.keyboard.press("2");
  await expect(host(page).getByTestId("question-card")).toContainText("Escrever testes?");
  await page.keyboard.press("1");
  await page.screenshot({ path: "../../.context/e2e/p0-perguntas.png" });
  await host(page).getByTestId("q-submit").click();
  await expect(host(page).locator(".msg-assistant").last()).toContainText("Respostas: SQLite, Sim");
});

test("fila: editar, apagar, enviar agora; segundo plano; parar ⌘⇧⌫", async ({ page }) => {
  await setup(page);
  await say(page, "crie o arquivo");
  await expect(host(page).getByTestId("approval")).toBeVisible();
  await say(page, "mensagem um");
  await say(page, "mensagem dois");
  await expect(host(page).getByTestId("queued-msg")).toHaveCount(2);
  await host(page).getByTestId("queue-delete").nth(1).click();
  await expect(host(page).getByTestId("queued-msg")).toHaveCount(1);
  await host(page).getByTestId("queue-edit").click();
  await expect(host(page).getByTestId("composer")).toHaveValue("mensagem um");
  await say(page, "mensagem um editada");
  await host(page).getByTestId("queue-steer").click();
  await expect(host(page).locator(".notice", { hasText: "Redirecionando" })).toBeVisible();
  await host(page).getByTestId("approval").getByRole("button", { name: /^Sim/ }).click();
  await expect(host(page).getByTestId("queued-msg")).toHaveCount(0);
  await say(page, "rode em segundo plano");
  await expect(host(page).getByTestId("bg-tasks")).toContainText("Aguardando 1 tarefa em segundo plano");
  await say(page, "crie mais um");
  await expect(host(page).getByTestId("stop")).toBeVisible();
  await page.keyboard.press("Meta+Shift+Backspace");
  await expect(host(page).locator(".notice", { hasText: "Interrompido" })).toBeVisible();
});

test("fork para nova aba e novo workspace, reset chat, menu da aba, ⌘/ abre o seletor, handoff de harness", async ({ page }) => {
  await setup(page);
  await say(page, "primeira");
  await expect(host(page).locator(".turn-meta")).toHaveCount(1);
  await say(page, "segunda");
  await expect(host(page).locator(".turn-meta")).toHaveCount(2);
  // Fork para nova aba a partir do primeiro turno
  await host(page).getByTestId("turn-more").first().click();
  await page.getByTestId("fork-tab").click();
  await expect(host(page).locator(".ctab", { hasText: "Fork" })).toBeVisible();
  await expect(chat(page).locator(".msg-user")).toHaveCount(1);
  await expect(host(page).locator(".notice", { hasText: "Fork desta conversa" })).toBeVisible();
  // Menu da aba: fechar as outras, ficando com o fork (1 turno). Antes o menu abria na primeira aba (a
  // original, com 2 turnos): o total final era 4 e o "3" só passava no intervalo entre o fim da
  // "terceira" e o da "quarta" (falhava no runner lento).
  await host(page).locator(".ctab", { hasText: "Fork" }).click({ button: "right" });
  await expect(page.getByTestId("tab-menu")).toContainText("Copiar transcript");
  await page.getByTestId("tab-close-others").click();
  await expect(host(page).getByTestId("ctab")).toHaveCount(1);
  await expect(host(page).getByTestId("ctab")).toContainText("Fork");
  // Reset chat (com "também restaurar arquivos")
  await say(page, "terceira");
  await say(page, "quarta");
  // 3 é o estado final (fork + terceira + quarta), não um intervalo no meio da fila.
  await expect(chat(page).locator(".turn-meta")).toHaveCount(3);
  await expect(chat(page).getByTestId("queued-msg")).toHaveCount(0);
  await chat(page).getByTestId("turn-more").nth(1).click();
  await page.getByTestId("reset-chat").click();
  await page.getByTestId("confirm-check").check();
  await page.getByTestId("confirm-ok").click();
  await expect(host(page).locator(".notice", { hasText: "resetada" })).toBeVisible();
  await expect(chat(page).locator(".turn-meta")).toHaveCount(2);
  // ⌘/ abre o seletor; trocar para Gemini (outro harness) mostra o divisor de handoff
  await host(page).getByTestId("composer").focus();
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".picker-pop")).toBeVisible();
  await page.locator(".pop-row.model", { hasText: "Gemini 4 Argon" }).click();
  await say(page, "continue");
  await expect(host(page).getByTestId("handoff")).toContainText("Trocou para Gemini 4 Argon · Antigravity");
  await page.screenshot({ path: "../../.context/e2e/p0-handoff.png" });
  // Fork para novo workspace
  await host(page).getByTestId("turn-more").first().click();
  await page.getByTestId("fork-ws").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(2);
  await expect(host(page).locator(".ctab", { hasText: "Fork" })).toBeVisible();
});

test("⌘O abre no app padrão das configurações; ⌘⇧O abre a lista", async ({ page }) => {
  await setup(page);
  await page.getByTestId("settings").click();
  await page.getByTestId("open-default").selectOption("terminal");
  await page.getByTestId("ws-row").click();
  await page.keyboard.press("Meta+o");
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toBe("terminal:/mock/ws/kabul");
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".open-pop")).toBeVisible();
});

test("agy: comando negado vira cartão com a regra; permitir uma vez continua; fim de turno não duplica", async ({ page }) => {
  await setup(page);
  await say(page, "agy-negado");
  const card = host(page).getByTestId("approval");
  await expect(card).toContainText("Rodar este comando?");
  await expect(card).toContainText("npm audit");
  await expect(card.getByTestId("approval-rule")).toContainText("command(npm audit)");
  await expect(card.getByTestId("approve-always")).toContainText("Sempre permitir neste workspace");
  await expect(card).toContainText("Permitir uma vez");
  await expect(card).toContainText("Negar");
  await page.screenshot({ path: "../../.context/e2e/p0-agy-aprovacao.png" });
  await host(page).getByTestId("composer").press("Enter");
  await expect(card).toContainText("Aprovado");
  await expect(host(page).locator(".msg-assistant").last()).toContainText("Nenhuma vulnerabilidade.");
  await expect(host(page).locator(".turn-meta")).toHaveCount(1);
  await expect(host(page).locator(".msg-assistant .caret")).toHaveCount(0);
});

test("Configurações › Modelos: 'Gemini: aprovar tudo' desligado por padrão e pede confirmação", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-modelos").click();
  const t = page.getByTestId("toggle-agy_skip_permissions");
  await expect(t).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-setting^="Gemini: aprovar tudo"]')).toContainText("pede aprovação num cartão");
  await t.click();
  await expect(page.getByTestId("confirm-ok")).toContainText("Aprovar tudo");
  await page.keyboard.press("Escape");
  await expect(t).toHaveAttribute("aria-checked", "false");
  await t.click();
  await page.getByTestId("confirm-ok").click();
  await expect(t).toHaveAttribute("aria-checked", "true");
});

test("IA trabalhando: passos ao vivo um por linha, linha de status com cronômetro; Parar e Enviar lado a lado; recolhe ao terminar", async ({ page }) => {
  await setup(page);
  await say(page, "devagar");
  const line = host(page).getByTestId("working");
  await expect(line).toContainText("Rodando npm audit");
  await expect(line.getByTestId("working-time")).toHaveText(/^\d+\.\ds$/);
  const t1 = Number((await line.getByTestId("working-time").textContent())!.slice(0, -1));
  await page.waitForTimeout(400);
  expect(Number((await line.getByTestId("working-time").textContent())!.slice(0, -1))).toBeGreaterThan(t1);
  await expect(host(page).getByTestId("stop")).toBeVisible();
  await expect(host(page).getByTestId("send")).toBeVisible();
  await expect(host(page).getByTestId("send")).toBeDisabled();
  await host(page).getByTestId("composer").fill("depois disso, rode os testes");
  await expect(host(page).getByTestId("send")).toBeEnabled();
  await expect(host(page).getByTestId("stop")).toBeVisible();
  await page.screenshot({ path: "../../.context/e2e/p0-trabalhando.png" });
  await expect(line).toContainText("Aguardando subagente Revisar o lockfile");
  // Passos do turno em andamento ao vivo, um por linha: ícone, rótulo e chip com o argumento (sem cartão).
  const bash = host(page).locator('[data-tool="Bash"]');
  await expect(bash.locator(".step-label")).toHaveText("Audita");
  await expect(bash.locator(".step-chip")).toHaveText("npm audit");
  await expect(host(page).getByTestId("thinking").locator(".step-label")).toHaveText("Pensando");
  await expect(host(page).locator('[data-tool="Task"] .step-label')).toHaveText("Revisar o lockfile");
  await expect(host(page).getByTestId("expand-steps")).toHaveCount(0);
  // Ao terminar, os passos recolhem em "N ferramentas, M mensagens".
  await expect(host(page).locator('[data-tool="Bash"]')).toHaveCount(0);
  await expect(host(page).locator(".turn-meta")).toHaveCount(1);
  await expect(host(page).getByTestId("working")).toHaveCount(0);
  await expect(host(page).getByTestId("expand-steps")).toContainText("2 ferramentas, 1 mensagem");
  await expect(host(page).getByTestId("steps-shell")).toBeVisible();
  await host(page).getByTestId("expand-steps").click();
  await expect(host(page).locator('[data-tool="Bash"]')).toContainText("npm audit");
  // Hover: fundo sutil e "+" no lugar do ícone; clique abre o detalhe (comando e saída).
  const head = host(page).locator('[data-tool="Bash"] .step-head');
  await head.hover();
  await expect(head.locator(".si-hover")).toBeVisible();
  await expect(head.locator(".si-kind")).toBeHidden();
  await head.click();
  await expect(host(page).locator('[data-tool="Bash"] .step-body')).toContainText("found 0 vulnerabilities");
});
