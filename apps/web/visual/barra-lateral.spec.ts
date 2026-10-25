import { test, expect, type Page } from "../playwright-silencio";

/**
 * Capturas do topo da barra lateral para comparar (antes/depois): `KABUL_FASE=antes|depois npx playwright test -c
 * playwright.visual.config.ts barra-lateral`. Saída em ../../.context/comparar/sidebar/ (fora do git).
 * "depois" captura as duas alternativas: A (padrão, "Visão geral" + Mais) e B (flag de dev `kabul.dev.sidebarNav=icons`).
 */
const OUT = "../../.context/comparar/sidebar";
const fase = process.env.KABUL_FASE ?? "depois";
const variantes: [string, string | null][] = fase === "antes" ? [["antes", null]] : [["A", null], ["B", "icons"]];

async function abrir(p: Page, tema: string, largura: number, flag: string | null, lang = "pt-BR") {
  await p.addInitScript(([t, w, f, l]) => {
    localStorage.setItem("kabul.theme", t as string);
    localStorage.setItem("kabul.size.sidebar", String(w));
    localStorage.setItem("kabul.lang", l as string);
    if (f) localStorage.setItem("kabul.dev.sidebarNav", f as string);
    else localStorage.removeItem("kabul.dev.sidebarNav");
  }, [tema, largura, flag, lang] as const);
  await p.goto("/?mock&demo");
  await expect(p.getByTestId("ws-row").first()).toBeVisible();
  await p.waitForTimeout(1200);
}

async function topo(p: Page, nome: string, altura = 520) {
  const b = (await p.getByTestId("sidebar").boundingBox())!;
  await p.screenshot({ path: `${OUT}/${nome}.png`, clip: { x: b.x, y: b.y, width: b.width, height: Math.min(altura, b.height) } });
}

for (const [v, flag] of variantes) {
  for (const tema of ["dark", "light"]) {
    test(`${v} ${tema}`, async ({ page: p }) => {
      await abrir(p, tema, 300, flag);
      await topo(p, `${v}-${tema}-topo`);
      await p.screenshot({ path: `${OUT}/${v}-${tema}-janela.png` });
    });
  }
  test(`${v} estreita`, async ({ page: p }) => {
    await abrir(p, "dark", 200, flag);
    await topo(p, `${v}-dark-estreita`, 2000);
  });
  test(`${v} visao geral e mais`, async ({ page: p }) => {
    await abrir(p, "dark", 300, flag);
    if (flag) await p.getByTestId("nav-agents").click();
    else await p.getByTestId("nav-overview").click();
    await expect(p.getByTestId("overview-tabs")).toBeVisible();
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/${v}-dark-visao-geral.png` });
    if (!flag) {
      await p.getByTestId("nav-more").click();
      await expect(p.getByTestId("more-pop")).toBeVisible();
      await p.screenshot({ path: `${OUT}/${v}-dark-menu-mais.png`, clip: { x: 0, y: 650, width: 520, height: 400 } });
    }
  });
  test(`${v} en`, async ({ page: p }) => {
    await abrir(p, "dark", 300, flag, "en");
    await topo(p, `${v}-dark-en-topo`);
  });
}
