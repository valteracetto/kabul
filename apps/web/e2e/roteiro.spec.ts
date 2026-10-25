import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

const shot = (page: Page, name: string) => page.screenshot({ path: `../../.context/e2e/${name}.png` });

test("roteiro completo de um usuário (backend mock)", async ({ page }) => {
  await page.goto("/?mock");

  await test.step("01 abrir o app: estado vazio", async () => {
    await expect(page.getByText("Adicione um repositório git em Criar para começar.")).toBeVisible();
    await shot(page, "01-vazio");
  });

  await test.step("02 adicionar repositório", async () => {
    await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  await addRepo(page, "/mock/repos/demo");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
    await expect(page.locator(".repo-name", { hasText: "demo" })).toBeVisible();
    await shot(page, "02-repo");
  });

  await test.step("03 criar workspace (worktree + setup)", async () => {
    await page.getByTestId("new-ws-demo").click();
  await page.getByTestId("create-go").click();
    await expect(page.getByTestId("ws-row")).toHaveCount(1);
    await expect(page.locator(".crumb-branch")).toHaveText("dev/kabul");
    await shot(page, "03-workspace");
  });

  await test.step("04 seletor de modelo: Gemini, local e esforço", async () => {
    await page.locator(".picker-trigger").click();
    await expect(page.locator(".picker-pop")).toBeVisible();
    await page.locator(".pop-search input").fill("qwen");
    await expect(page.locator(".pop-row.model .local-badge").first()).toBeVisible();
    await shot(page, "04a-busca-local");
    await page.locator(".pop-search input").fill("");
    await page.locator(".pop-row.model", { hasText: "Gemini 4 Argon" }).click();
    await expect(page.locator(".picker-trigger")).toContainText("Gemini 4 Argon");
    await page.locator(".picker-trigger").click();
    await page.locator(".pop-row.model", { hasText: "Opus 5.5" }).click();
    await page.locator(".picker-trigger").click();
    await page.locator(".pop-row.setting", { hasText: "Esforço" }).click();
    await page.locator(".submenu").getByText("High", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".picker-trigger")).toContainText("High");
    await shot(page, "04b-esforco");
  });

  await test.step("05 prompt curto: resposta e card de ferramenta", async () => {
    await page.getByTestId("composer").fill("Liste os arquivos do projeto");
    await page.getByTestId("composer").press("Enter");
    await expect(page.locator(".msg-assistant")).toContainText("Recebi");
    await expect(page.locator(".turn-meta")).toBeVisible();
    // Passos recolhidos numa linha; um clique mostra os cartões das ferramentas.
    await page.getByTestId("expand-steps").click();
    await expect(page.getByTestId("tool-card").first()).toBeVisible();
    await shot(page, "05-resposta");
  });

  await test.step("06 aprovar uma ferramenta", async () => {
    await page.getByTestId("composer").fill("Crie o arquivo ok.txt");
    await page.getByTestId("composer").press("Enter");
    await expect(page.getByTestId("approval")).toBeVisible();
    await shot(page, "06a-pedido");
    await page.getByTestId("approval").getByRole("button", { name: /^Sim/ }).click();
    await expect(page.getByTestId("approval").getByText("Aprovado")).toBeVisible();
    await expect(page.locator(".msg-assistant").last()).toContainText("ok.txt");
    await shot(page, "06b-aprovado");
  });

  await test.step("07 anexar, @mencionar e /comando", async () => {
    await page.getByTestId("attach").click();
    await expect(page.getByTestId("composer")).toHaveValue(/@\.context\/attachments\/especificacao\.pdf/);
    await page.getByTestId("composer").fill("veja @mai");
    await expect(page.getByTestId("suggest")).toContainText("main.rs");
    await page.getByTestId("composer").press("Enter");
    await expect(page.getByTestId("composer")).toHaveValue("veja @main.rs ");
    await page.getByTestId("composer").fill("/rev");
    await expect(page.getByTestId("suggest")).toContainText("/review");
    await shot(page, "07-slash");
    await page.getByTestId("composer").press("Tab");
    await expect(page.getByTestId("composer")).toHaveValue("/review ");
    await page.getByTestId("composer").fill("");
  });

  await test.step("08 plan mode e ditado", async () => {
    await page.getByTestId("composer").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".plan-chip")).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".plan-chip")).toHaveCount(0);
    await expect(page.getByTestId("mic")).toBeVisible();
    await expect(page.getByTestId("context-ring")).toHaveAttribute("title", /Contexto: 15\.000 de 200\.000/);
    await shot(page, "08-composer");
  });

  await test.step("09 terminal", async () => {
    await page.locator(".btab", { hasText: "Terminal" }).click();
    await page.locator(".term-host").click();
    await page.keyboard.type("ls");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("mock: comando executado");
    await shot(page, "09-terminal");
  });

  await test.step("10 setup e run", async () => {
    await page.locator(".btab", { hasText: "Setup" }).click();
    await expect(page.locator(".script-cmd")).toHaveText("echo instalando");
    await page.locator(".btab", { hasText: "Run" }).click();
    await page.locator(".script-bar .btn", { hasText: "web" }).click();
    await expect(page.locator(".script-bar")).toContainText("Parar");
    await shot(page, "10-run");
  });

  await test.step("11 diff e comentário de linha", async () => {
    await page.locator(".rtab", { hasText: "Alterações" }).click();
    await page.locator(".file-row", { hasText: "ok.txt" }).click();
    await page.locator(".pl .ln.can").first().click();
    await page.locator(".comment-box textarea").fill("Use letras maiúsculas aqui");
    await page.locator(".comment-box .btn.primary").click();
    await expect(page.getByTestId("diff-comment")).toContainText("maiúsculas");
    await shot(page, "11-comentario");
    await page.getByRole("button", { name: /Enviar 1 comentário/ }).click();
    await expect(page.getByTestId("composer")).toHaveValue(/maiúsculas/);
    await page.getByTestId("composer").fill("");
  });

  await test.step("12 checkpoint e restaurar", async () => {
    await page.getByTestId("tab-checkpoints").click();
    await expect(page.locator(".files .file-row").first()).toContainText("antes:");
    await shot(page, "12-checkpoints");
    await page.locator(".files .file-row").first().locator(".icon-btn").click();
    await page.getByTestId("confirm-ok").click();
    await page.locator(".rtab", { hasText: "Alterações" }).click();
    await expect(page.locator(".file-row", { hasText: "ok.txt" })).toHaveCount(0);
  });

  await test.step("13 ⌘K e atalhos", async () => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.keyboard.type("arquivos");
    await expect(page.getByTestId("palette")).toContainText("💬");
    await shot(page, "13-busca");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+Alt+Slash");
    await expect(page.getByTestId("shortcuts")).toContainText("Plan mode");
    await page.keyboard.press("Meta+1");
    await expect(page.locator(".crumb-repo")).toBeVisible();
  });

  await test.step("14 criar PR em simulação (sem push)", async () => {
    await page.getByTestId("create-pr").click();
    await page.getByTestId("pr-form").getByText("Rascunho (draft)").click();
    await page.getByTestId("pr-form").getByText("Só mostrar os comandos").click();
    await page.getByTestId("pr-form").getByRole("button", { name: "Simular" }).click();
    await expect(page.getByTestId("pr-result")).toContainText("--draft");
    await shot(page, "14-pr-simulado");
  });

  await test.step("15 arquivar e desarquivar", async () => {
    await page.getByTestId("ws-row").hover();
    await page.getByTestId("archive").click();
    await expect(page.getByTestId("confirm")).toContainText("Arquivar");
    await page.getByTestId("confirm-ok").click();
    await expect(page.getByTestId("ws-row")).toHaveCount(0);
    await page.getByText(/Arquivados \(1\)/).click();
    await shot(page, "15-arquivado");
    await page.getByTestId("unarchive").click();
    await expect(page.getByTestId("ws-row")).toHaveCount(1);
  });

  await test.step("16 configurações e contas", async () => {
    await page.getByTestId("settings").click();
    await page.getByTestId("set-tab-git").click();
    await expect(page.getByTestId("settings-page")).toContainText("Prefixo da branch");
    await shot(page, "16a-geral");
    await page.getByTestId("set-tab-contas").click();
    await expect(page.getByTestId("account")).toHaveCount(6);
    await shot(page, "16b-contas");
    await page.getByTestId("set-tab-repo").click();
    await expect(page.getByTestId("repo-settings")).toContainText("Camadas de configuração");
    await shot(page, "16c-repo");
  });

  await test.step("17 modelos locais", async () => {
    await page.locator(".side-nav button", { hasText: "Modelos locais" }).click();
    await expect(page.getByTestId("source")).toHaveCount(2);
    await expect(page.getByTestId("local-page")).toContainText("Qwen3 8B");
    await shot(page, "17-locais");
  });

  await test.step("18 painel de sessões", async () => {
    await page.locator(".side-nav button", { hasText: "Painel" }).click();
    await expect(page.locator(".page table").first()).toContainText("kabul-kabul");
    await shot(page, "18-painel");
  });
});
