import { test, expect, type Page } from "@playwright/test";

/**
 * Auditoria de controles: clica em cada botão visível das telas principais e exige efeito
 * (DOM muda, backend é chamado ou o foco muda). Controle sem efeito é bug.
 */
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  if (!(await page.getByTestId("repo-path").isVisible())) { await page.getByTestId("add-project").click(); }
  await page.getByTestId("repo-path").fill("/mock/repos/demo");
  await page.getByTestId("repo-path").press("Enter");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-demo").click();
  await page.getByTestId("create-go").click();
  await page.getByTestId("composer").fill("Liste os arquivos");
  await page.getByTestId("composer").press("Enter");
  await expect(page.locator(".turn-meta")).toBeVisible();
}

async function audit(page: Page, tela: string, scope: string, skip: RegExp) {
  const dead: string[] = [];
  const n = await page.locator(`${scope} button:visible`).count();
  for (let i = 0; i < n; i++) {
    const b = page.locator(`${scope} button:visible`).nth(i);
    if (!(await b.count()) || !(await b.isEnabled()) || /\bon\b/.test((await b.getAttribute("class")) ?? "")) continue;
    const label = ((await b.getAttribute("title")) || (await b.innerText()).trim() || (await b.getAttribute("data-testid")) || `#${i}`).slice(0, 40);
    if (skip.test(label)) continue;
    const before = await page.evaluate(() => ({ html: document.body.innerHTML.length + ":" + document.body.innerHTML.slice(-200), calls: ((window as any).__calls ?? []).length, focus: document.activeElement?.outerHTML.slice(0, 80), clip: (window as any).__clip }));
    await page.evaluate(() => navigator.clipboard && ((navigator.clipboard as any).writeText = (t: string) => ((window as any).__clip = t, Promise.resolve())));
    await b.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => ({ html: document.body.innerHTML.length + ":" + document.body.innerHTML.slice(-200), calls: ((window as any).__calls ?? []).length, focus: document.activeElement?.outerHTML.slice(0, 80), clip: (window as any).__clip }));
    if (before.html === after.html && before.calls === after.calls && before.focus === after.focus && before.clip === after.clip) dead.push(`${tela}: "${label}"`);
    await page.keyboard.press("Escape");
  }
  return dead;
}

test("nenhum botão sem efeito nas telas principais", async ({ page }) => {
  test.setTimeout(240_000);
  await setup(page);
  // Ações destrutivas/externas ficam fora (cobertas em outros testes).
  const skip = /Arquivar|Ocultar barra|Voltar|Avançar|Abrir em|Fechar|Interromper|Parar/i;
  const dead = [
    ...(await audit(page, "workspace", ".ws-host:not([hidden])", skip)),
  ];
  await page.getByTestId("settings").click();
  for (const tab of ["Geral", "Aparência", "Contas", "Integrações", "Repositório", "Atalhos"]) {
    await page.locator(".seg .rtab", { hasText: tab }).click();
    dead.push(...(await audit(page, `config/${tab}`, ".page", /Remover|Desconectar|Instalar|Entrar/i)));
  }
  await page.locator(".side-nav button", { hasText: "Modelos locais" }).click();
  dead.push(...(await audit(page, "modelos-locais", ".page", /Baixar|Instalar|Remover|Restaurar padrão/i)));
  console.log(dead.join("\n") || "todos os botões têm efeito");
  expect(dead, dead.join("\n")).toEqual([]);
});
