import { addRepo, navTo } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";

const WIDTHS = [900, 1280, 1440, 1920, 2560];
const THEMES = ["dark", "light"] as const;

/** Filhos visíveis que se sobrepõem nos contêineres de linha, e textos estourados sem reticências. */
async function problems(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const rows = document.querySelectorAll(".topbar, .rtabs, .btabs, .composer-foot, .side-nav2 button, .usage-meter, .ws-row, .repo-row, .tabstrip, .file-row, .tree-row, .pop-row, .script-bar, .acc-head, .set-row, .source-head, .side-top, .side-foot");
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
    document.querySelectorAll(".crumb-repo, .crumb-branch, .repo-mark, .machine, .side-nav2").forEach((e) => {
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
  await addRepo(page, "/mock/repos/um-repositorio-com-nome-bem-comprido");
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
      await navTo(page, "local");
      await check("modelos-locais");
      await navTo(page, "sessions");
      await check("painel");
    }
    console.log(found.join("\n") || "sem problemas");
    expect(found, found.join("\n")).toEqual([]);
  });
}

/** Popover aberto (portal [data-floating]) 100% dentro da janela e por cima de tudo: amostra pontos internos
 *  e confere que o elemento no topo pertence ao popover (nenhum painel o cobre). */
async function popoverOk(page: Page, nome: string): Promise<string[]> {
  await page.waitForTimeout(120);
  return page.evaluate((nome) => {
    const out: string[] = [];
    const pops = [...document.querySelectorAll("[data-floating]")] as HTMLElement[];
    if (!pops.length) return [`${nome}: não abriu`];
    const el = pops[pops.length - 1];
    const r = el.getBoundingClientRect();
    if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(`${nome}: fora da janela (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)})`);
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const top = document.elementFromPoint(x, y);
      if (top && !el.contains(top)) { out.push(`${nome}: coberto em (${Math.round(x)},${Math.round(y)}) por ${top.tagName.toLowerCase()}.${(top.className as string).toString().split(" ")[0]}`); break; }
    }
    return out;
  }, nome);
}

test("popovers inteiros e por cima dos painéis, em várias larguras e com a barra lateral estreita", async ({ page }) => {
  test.setTimeout(180_000);
  const found: string[] = [];
  for (const [w, side] of [[900, 200], [1280, 200], [1440, 300], [1920, 200]] as const) {
    await page.addInitScript((s) => localStorage.setItem("kabul.size.sidebar", String(s)), side);
    await page.setViewportSize({ width: w, height: w < 1000 ? 700 : 900 });
    await setup(page);
    const host = page.locator(".ws-host:not([hidden])");
    const chat = page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
    await chat.getByTestId("composer").fill("liste");
    await chat.getByTestId("composer").press("Enter");
    await expect(host.locator(".turn-meta")).toBeVisible();
    const abre = async (nome: string, click: () => Promise<unknown>) => {
      await click();
      for (const p of await popoverOk(page, nome)) found.push(`${w}px/${side}: ${p}`);
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-floating]")).toHaveCount(0);
    };
    await abre("Meus workspaces ···", () => page.getByTestId("group-menu").click());
    await abre("máquina", () => page.getByTestId("machine-picker").click());
    await abre("seletor de modelo", () => chat.locator(".picker-trigger").click());
    await abre("ações do workspace", () => host.getByTestId("ws-menu").click());
    await abre("nova aba", () => host.getByTestId("new-tab").click());
    await abre("abrir em", () => host.getByTestId("open-in").locator("button").last().click());
    await abre("git", () => page.getByTestId("git-menu").click());
    await abre("ações da mensagem", () => host.getByTestId("turn-more").last().click());
  }
  expect(found, found.join("\n")).toEqual([]);
});
