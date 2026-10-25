import { test, expect, type Page } from "../playwright-silencio";
import { addRepo, navTo, type NavDest } from "./helpers";

// Barra lateral enxuta: no topo só "Novo workspace" + Buscar e a "Visão geral"; Início, Rotinas e Modelos
// locais no menu "Mais" do rodapé, Uso no medidor. Todo destino em no máximo 2 cliques e pela paleta ⌘K.

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
async function setup(page: Page, init?: () => void) {
  if (init) await page.addInitScript(init);
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await expect(host(page).getByTestId("composer")).toBeVisible();
}

/** A tela de cada destino (o que prova que a navegação chegou lá). */
const arrived = (page: Page, d: NavDest) => {
  const ov = (k: string) => expect(page.getByTestId(`ov-${k}`)).toHaveAttribute("aria-selected", "true");
  switch (d) {
    case "agents": return expect(page.getByTestId("agents-view")).toBeVisible();
    case "dashboard": return expect(page.getByTestId("dashboard")).toBeVisible();
    case "sessions": return ov("sessions");
    case "home": return expect(page.locator(".home")).toBeVisible();
    case "routines": return expect(page.getByTestId("routines")).toBeVisible();
    case "local": return expect(page.getByTestId("local-page")).toBeVisible();
    case "usage": return expect(page.getByTestId("usage-view")).toBeVisible();
  }
};
const ALL: NavDest[] = ["agents", "dashboard", "sessions", "home", "routines", "local", "usage"];
// Rótulo na paleta (grupo Navegação).
const PAL: Record<NavDest, string> = { agents: "Agentes", dashboard: "Quadro", sessions: "Painel de sessões", home: "Início", routines: "Rotinas", local: "Modelos locais", usage: "Uso e limites" };

test("topo enxuto: Novo workspace, Buscar e Visão geral; o resto no rodapé", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".side-nav2 button")).toHaveCount(3);
  await expect(page.getByTestId("create-ws")).toContainText("Novo workspace");
  await expect(page.getByTestId("nav-overview")).toHaveText(/Visão geral/);
  await expect(page.getByTestId("nav-usage")).toBeVisible();
  await expect(page.getByTestId("nav-usage")).toContainText("%");
  // Buscar abre a paleta; Novo workspace abre o modal.
  await page.getByTestId("nav-search").click();
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("create-modal")).toHaveCount(0);
});

test("todo destino em no máximo 2 cliques, saindo de um workspace", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => document.addEventListener("click", () => ((window as any).__clicks = ((window as any).__clicks ?? 0) + 1), { capture: true }));
  for (const d of ALL) {
    await page.getByTestId("ws-row").first().click();
    await expect(host(page).getByTestId("composer")).toBeVisible();
    await page.evaluate(() => ((window as any).__clicks = 0));
    await navTo(page, d);
    await arrived(page, d);
    expect(await page.evaluate(() => (window as any).__clicks), `cliques até ${d}`).toBeLessThanOrEqual(2);
  }
});

test("Visão geral: seletor Agentes · Quadro · Painel e volta para a última aba", async ({ page }) => {
  await setup(page);
  await page.getByTestId("nav-overview").click();
  await expect(page.getByTestId("ov-agents")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("nav-overview")).toHaveClass(/ on/);
  await page.getByTestId("ov-dashboard").click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await page.getByTestId("ws-row").first().click();
  await expect(page.getByTestId("nav-overview")).not.toHaveClass(/ on/);
  // Volta para o Quadro (a última aba usada).
  await page.getByTestId("nav-overview").click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByTestId("ov-dashboard")).toHaveAttribute("aria-selected", "true");
});

test("contador de agentes ativos na Visão geral e no seletor (esperando você em destaque)", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("agents-count")).toHaveCount(0);
  await host(page).getByTestId("composer").fill("pergunte");
  await host(page).getByTestId("composer").press("Enter");
  await expect(page.getByTestId("agents-count")).toHaveText("1");
  await expect(page.getByTestId("agents-count")).toHaveClass(/waiting/);
  await page.getByTestId("nav-overview").click();
  await expect(page.getByTestId("ov-agents-count")).toHaveText("1");
  await expect(page.getByTestId("agent-row")).toHaveCount(1);
});

test("paleta ⌘K alcança todos os destinos", async ({ page }) => {
  await setup(page);
  for (const d of ALL) {
    await page.getByTestId("ws-row").first().click();
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("palette")).toBeVisible();
    await page.getByTestId("palette-input").fill(PAL[d]);
    await page.getByTestId("pal-row").filter({ has: page.locator(".label", { hasText: new RegExp(`^${PAL[d]}$`) }) }).first().click();
    await expect(page.getByTestId("palette")).toHaveCount(0);
    await arrived(page, d);
  }
});

test("atalhos continuam: ⌘N, ⌘K, ⌘⇧H e ⌘B", async ({ page }) => {
  await setup(page);
  await page.keyboard.press("Meta+n");
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("create-modal")).toHaveCount(0);
  await page.keyboard.press("Meta+k");
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Shift+h");
  await expect(page.locator(".home")).toBeVisible();
  await page.keyboard.press("Meta+b");
  await expect(page.getByTestId("sidebar")).toHaveCount(0);
  await page.keyboard.press("Meta+b");
  await expect(page.getByTestId("create-ws")).toBeVisible();
});

test("barra estreita: rótulo curto, sem atalho, nada cortado no rodapé", async ({ page }) => {
  await setup(page, () => localStorage.setItem("kabul.size.sidebar", "200"));
  await expect(page.getByTestId("create-ws").locator(".side-new-short")).toBeVisible();
  await expect(page.getByTestId("create-ws").locator(".side-new-short")).toHaveText("Novo");
  await expect(page.getByTestId("create-ws").locator(".side-new-label")).toBeHidden();
  await expect(page.getByTestId("create-ws").locator("kbd")).toBeHidden();
  const side = (await page.getByTestId("sidebar").boundingBox())!;
  for (const id of ["nav-search", "nav-usage", "nav-more", "help", "settings"]) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x + b.width, id).toBeLessThanOrEqual(side.x + side.width);
  }
});

test("alternativa B (flag de dev): faixa de ícones, um clique por destino", async ({ page }) => {
  await setup(page, () => localStorage.setItem("kabul.dev.sidebarNav", "icons"));
  await expect(page.getByTestId("nav-overview")).toHaveCount(0);
  await expect(page.getByTestId("nav-more")).toHaveCount(0);
  for (const d of ALL) {
    await page.getByTestId(`nav-${d}`).click();
    await arrived(page, d);
  }
});
