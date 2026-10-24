import { test, expect, type Page } from "@playwright/test";

const WIDTHS = [900, 1280, 1440, 1920, 2560];
const THEMES = ["dark", "light"] as const;

/** Filhos visíveis que se sobrepõem nos contêineres de linha, e textos estourados sem reticências. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const rows = document.querySelectorAll(".topbar, .rtabs, .btabs, .composer-foot, .side-nav button, .ws-row, .repo-row, .tabstrip, .file-row, .tree-row, .pop-row, .script-bar, .acc-head, .set-row, .source-head, .side-top, .side-foot");
    const name = (e: Element) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "");
    rows.forEach((row) => {
      const kids = [...row.children].filter((k) => {
        const r = k.getBoundingClientRect(), cs = getComputedStyle(k);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.position !== "absolute" && cs.position !== "fixed";
      });
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) out.push(`sobreposição em ${name(row)}: ${name(kids[i])} × ${name(kids[j])}`);
      }
      const rr = row.getBoundingClientRect();
      kids.forEach((k) => { const r = k.getBoundingClientRect(); if (r.right > rr.right + 2 && getComputedStyle(row).overflowX === "visible") out.push(`vaza de ${name(row)}: ${name(k)}`); });
    });
    document.querySelectorAll("span, b, div, button, code, a").forEach((e) => {
      const el = e as HTMLElement;
      if (!el.offsetParent || el.children.length || !el.textContent?.trim()) return;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== "visible" && cs.textOverflow !== "ellipsis" && cs.whiteSpace === "nowrap") out.push(`texto cortado sem reticências: ${name(el)} "${el.textContent.slice(0, 30)}"`);
    });
    // Minimapa não cobre mensagens.
    const mm = document.querySelector(".ws-host:not([hidden]) .minimap")?.getBoundingClientRect();
    if (mm) document.querySelectorAll(".ws-host:not([hidden]) .msg-user, .ws-host:not([hidden]) .msg-assistant").forEach((m) => {
      const r = m.getBoundingClientRect();
      if (r.right > mm.left + 1 && r.top < mm.bottom && r.bottom > mm.top) out.push("minimapa sobre mensagem");
    });
    // Nada sob os semáforos (x < 76, y < 30) além da área de arrasto.
    document.querySelectorAll(".crumb-repo, .crumb-branch, .repo-mark, .machine, .side-nav").forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width && r.left < 76 && r.top < 30) out.push(`sob os semáforos: ${name(e)}`);
    });
    return [...new Set(out)];
  });
}

async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  if (!(await page.getByTestId("repo-path").isVisible())) { await page.getByTestId("add-project").click(); }
  await page.getByTestId("repo-path").fill("/mock/repos/um-repositorio-com-nome-bem-comprido");
  await page.getByTestId("repo-path").press("Enter");
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid^="new-ws-"]').first().click();
  await page.getByTestId("create-go").click();
  await page.getByTestId("composer").fill("Liste os arquivos deste projeto, por favor, com detalhes de cada pasta e um resumo final bem longo para testar quebra de linha");
  await page.getByTestId("composer").press("Enter");
  await expect(page.locator(".turn-meta")).toBeVisible();
}

for (const theme of THEMES) {
  test(`varredura de sobreposição · tema ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const found: string[] = [];
    await page.addInitScript((t) => localStorage.setItem("kabul.theme", t), theme);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: Math.round(w * 0.6) < 700 ? 700 : Math.round(w * 0.6) });
      await setup(page);
      const check = async (tela: string) => {
        for (const p of await problems(page)) found.push(`${w}px ${tela}: ${p}`);
        await page.screenshot({ path: `../../.context/comparar/tema-${theme}-${w}-${tela}.png` });
      };
      await check("workspace");
      await page.keyboard.press("Meta+b");
      await check("sem-sidebar");
      await page.keyboard.press("Meta+b");
      await page.getByTestId("settings").click();
      await check("configuracoes");
      await page.locator(".side-nav button", { hasText: "Modelos locais" }).click();
      await check("modelos-locais");
      await page.locator(".side-nav button", { hasText: "Painel" }).click();
      await check("painel");
    }
    console.log(found.join("\n") || "sem problemas");
    expect(found, found.join("\n")).toEqual([]);
  });
}
