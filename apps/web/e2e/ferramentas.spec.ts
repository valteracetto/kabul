import { addRepo } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";

// Ferramentas (desktop, mock com home sintético): abrir pelo menu Mais, pela paleta e pelo ⌘⇧U; busca,
// chips por IA e tipo, escopo Global/Este repo/Todos, matriz, fontes com a pegada, saúde com o "por que
// importa", detalhe com o SKILL.md renderizado, como chamar, mostrar na pasta, favorito e nota, e o popover
// das pastas lidas. Só leitura: nada aqui escreve nas pastas das IAs.
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}
const card = (page: Page, id: string) => page.locator(`[data-testid=tools-card][data-id="${id}"]`);

test("abre pelo Mais, pela paleta e pelo ⌘⇧U; busca, filtros e escopo", async ({ page }) => {
  await setup(page);
  // Menu "Mais" do rodapé, com o selo de erros (links quebrados).
  await page.getByTestId("nav-more").click();
  await expect(page.getByTestId("nav-tools-badge")).toHaveText("2");
  await page.getByTestId("nav-tools").click();
  const v = page.getByTestId("tools-view");
  await expect(v).toBeVisible();
  await expect(v.locator("h2")).toHaveText("Ferramentas");
  await expect(page.getByTestId("tools-card").first()).toBeVisible();
  const total = await page.getByTestId("tools-card").count();
  expect(total).toBeGreaterThan(10);
  // Selos: link tracejado, cópia divergente e link quebrado têm estados diferentes.
  await expect(card(page, "skill:test-driven-development").locator("[data-state=link]")).toHaveCount(3);
  await expect(card(page, "skill:code-review").locator("[data-state=drift]")).toHaveCount(2);
  await expect(card(page, "skill:prd-writer").locator("[data-state=broken]")).toHaveCount(2);
  await expect(card(page, "skill:test-driven-development")).toContainText("acme/agent-skills");

  // Busca e chips.
  await page.getByTestId("tools-search").fill("deploy");
  await expect(page.getByTestId("tools-card")).toHaveCount(1);
  await page.getByTestId("tools-search").fill("");
  await page.getByTestId("tools-chip-cursor").click();
  await expect(page.getByTestId("tools-card")).toHaveCount(3);
  await page.getByTestId("tools-chip-all").click();
  await page.getByTestId("tools-kind-mcp").click();
  await expect(page.getByTestId("tools-card")).toHaveCount(3);
  await page.getByTestId("tools-kind-all").click();

  // Escopo: Global esconde o que é do projeto; Este repo mostra o do repositório do workspace.
  await page.getByTestId("tools-scope-global").click();
  await expect(card(page, "skill:migrations-guide")).toHaveCount(0);
  await expect(card(page, "skill:test-driven-development")).toBeVisible();
  await page.getByTestId("tools-scope-repo").click();
  await expect(card(page, "skill:migrations-guide")).toBeVisible();
  await page.getByTestId("tools-scope-all").click();
  await expect(page.getByTestId("tools-card")).toHaveCount(total);

  // Atualizar relê o disco (refresh: true).
  await page.getByTestId("tools-refresh").click();
  await expect.poll(() => page.evaluate(() => (window as any).__toolsRefreshed ?? 0)).toBeGreaterThan(0);

  // Paleta: entrada "Ferramentas: saúde" e busca de itens ("Skill: x" abre o detalhe).
  await page.getByTestId("ws-row").first().click();
  await page.keyboard.press("Meta+k");
  await page.getByTestId("palette-input").fill("ferramentas: saúde");
  await page.getByTestId("pal-row").filter({ hasText: "Ferramentas: saúde" }).click();
  await expect(page.getByTestId("tools-health")).toBeVisible();
  await page.keyboard.press("Meta+k");
  await page.getByTestId("palette-input").fill("test-driven");
  await page.getByTestId("pal-row").filter({ hasText: "Skill: test-driven-development" }).click();
  await expect(page.getByTestId("tools-drawer")).toBeVisible();
  await expect(page.getByTestId("tools-drawer")).toContainText("test-driven-development");
  await page.getByTestId("tools-drawer-close").click();
  await page.keyboard.press("Meta+k");
  await page.getByTestId("palette-input").fill("docs-search");
  await expect(page.getByTestId("pal-row").filter({ hasText: "MCP: docs-search" })).toBeVisible();
  await page.keyboard.press("Escape");

  // ⌘⇧U de qualquer lugar.
  await page.getByTestId("ws-row").first().click();
  await expect(page.getByTestId("tools-view")).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+U");
  await expect(page.getByTestId("tools-view")).toBeVisible();
});

test("matriz, fontes, saúde, pastas lidas e detalhe (markdown, como chamar, pasta, favorito e nota)", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Meta+Shift+U");
  await expect(page.getByTestId("tools-card").first()).toBeVisible();

  // Matriz: item × IA; "só com problema" deixa os que têm aviso/erro.
  await page.getByTestId("tools-tab-matrix").click();
  const rows = page.getByTestId("tools-matrix-row");
  const all = await rows.count();
  await page.getByTestId("tools-only-problems").check();
  await expect.poll(() => rows.count()).toBeLessThan(all);
  await expect(page.locator('[data-testid=tools-matrix-row][data-id="skill:prd-writer"]')).toContainText("✕");
  await expect(page.locator('[data-testid=tools-matrix-row][data-id="skill:test-driven-development"]')).toHaveCount(0);

  // Fontes: lock com URL e a pegada de uma ferramenta (pasta, programa, npm, hook).
  await page.getByTestId("tools-tab-sources").click();
  await expect(page.locator('[data-testid=tools-source][data-id="gh:acme/agent-skills"]')).toContainText("https://github.com/acme/agent-skills");
  const tool = page.locator('[data-testid=tools-source][data-id="tool:notifier"]');
  await expect(tool.getByTestId("tools-footprint")).toContainText("@acme/notifier@1.4.0");
  await expect(tool.getByTestId("tools-footprint")).toContainText("~/.notifier/bin/notify-done");

  // Saúde: por severidade, com o texto e o "por que importa".
  await page.getByTestId("tools-tab-health").click();
  const broken = page.locator("[data-testid=tools-finding][data-kind=brokenLink]").first();
  await expect(broken).toContainText("prd-writer: link quebrado em ~/.qwen/skills/prd-writer");
  await expect(broken).toContainText("Por que importa:");
  await expect(page.locator("[data-testid=tools-finding][data-kind=duplicateCopy]")).toContainText("4 cópias idênticas");
  await expect(page.locator("[data-testid=tools-finding][data-kind=unpinnedMcp]")).toContainText("npx -y docs-search-mcp");
  await expect(page.locator("[data-testid=tools-finding][data-kind=nestedRepo]")).toContainText("1 repositório dentro de acme-web");
  await expect(page.getByTestId("tools-health-count")).toHaveText("2");

  // Pastas lidas: cada raiz com a conta isolada e a variável que a moveu; pastas que não existem.
  await page.getByTestId("tools-roots").click();
  const pop = page.getByTestId("tools-roots-pop");
  await expect(pop).toContainText("CLAUDE_CONFIG_DIR");
  await expect(pop).toContainText("conta Trabalho");
  await expect(pop.locator("[data-testid=tools-root][data-status=missing]").first()).toContainText("não existe");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);

  // Detalhe de uma skill: SKILL.md renderizado, como chamar em cada IA, onde está, mostrar na pasta.
  await page.getByTestId("tools-tab-catalog").click();
  await card(page, "skill:test-driven-development").click();
  const d = page.getByTestId("tools-drawer");
  await expect(d.getByTestId("tools-body").locator(".md-h1")).toHaveText("test-driven-development");
  await expect(d.getByTestId("tools-body")).toContainText("Write a failing test");
  await expect(d.getByTestId("tools-invoke")).toContainText("/test-driven-development");
  await expect(d.getByTestId("tools-invoke")).toContainText("$test-driven-development");
  await expect(d.getByTestId("tools-place")).toHaveCount(4);
  await expect(d.locator("[data-testid=tools-place][data-state=link]")).toHaveCount(3);
  await d.getByTestId("tools-reveal").click();
  await expect.poll(() => page.evaluate(() => (window as any).__opened)).toBe("finder:/Users/dev/.agents/skills/test-driven-development/SKILL.md");

  // Favorito e nota pessoal (tools_prefs_set): o cartão ganha a estrela e o grupo Favoritos aparece.
  await d.getByTestId("tools-fav").click();
  await d.getByTestId("tools-note").fill("uso antes de todo PR");
  await d.getByTestId("tools-note-save").click();
  await expect(d.getByTestId("tools-note-saved")).toBeVisible();
  const prefs = await page.evaluate(() => (window as any).__toolsPrefs);
  expect(prefs).toEqual([{ id: "skill:test-driven-development", favorite: true }, { id: "skill:test-driven-development", note: "uso antes de todo PR" }]);
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(page.locator("[data-testid=tools-group][data-cat=__fav]")).toContainText("test-driven-development");

  // MCP e hook: sem corpo (configuração não é mostrada inteira), com os riscos.
  await card(page, "mcp:issue-tracker").click();
  await expect(d.getByTestId("tools-risk")).toContainText("texto de exemplo");
  await expect(d.getByTestId("tools-body")).toHaveCount(0);
  await expect(d).toContainText("ISSUE_TRACKER_TOKEN");
  await d.getByTestId("tools-drawer-close").click();
  await card(page, "hook:notify-done").click();
  await expect(d.getByTestId("tools-risk")).toContainText("roda código");
  await expect(d).toContainText("Stop, Notification");
});

test.describe("em inglês", () => {
  test.use({ locale: "en-US" });
  test("Tools: abas, saúde e detalhe sem texto em português nem chave crua", async ({ page }) => {
    const raw: string[] = [];
    page.on("console", (m) => m.text().includes("[i18n]") && raw.push(m.text()));
    await page.goto("/?mock");
    await expect(page.getByTestId("create-ws")).toBeVisible();
    await page.keyboard.press("Meta+Shift+U");
    const v = page.getByTestId("tools-view");
    await expect(v.locator("h2")).toHaveText("Tools");
    await expect(page.getByTestId("tools-tab-catalog")).toHaveText("Catalog");
    await expect(page.getByTestId("tools-roots")).toContainText("folders read");
    await page.getByTestId("tools-tab-health").click();
    await expect(page.locator("[data-testid=tools-finding][data-kind=brokenLink]").first()).toContainText("broken link at");
    await expect(page.locator("[data-testid=tools-finding][data-kind=orphan]")).toContainText("is only in the shared folder");
    await page.getByTestId("tools-tab-sources").click();
    await expect(page.locator('[data-testid=tools-source][data-id="local"]')).toContainText("Local (no install record)");
    await page.getByTestId("tools-tab-catalog").click();
    await card(page, "skill:deploy-checklist").click();
    await expect(page.getByTestId("tools-drawer")).toContainText("Where it is (4 places)");
    await expect(page.getByTestId("tools-drawer")).toContainText("account Trabalho");
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\btools\.[a-z][\w.]*[a-zA-Z]\b/);
    expect(text).not.toMatch(/\b(Ferramentas|Catálogo|Saúde|Fontes|cópia|não existe)\b/);
    expect(raw).toEqual([]);
  });
});
