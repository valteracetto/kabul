/* i18n-ignore-file: dados fictícios da demonstração. */
import { test, expect, devices, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// PWA do celular instalada na Tela de Início (standalone), em tela cheia: o topo encosta na barra de status
// (área segura de cima), a barra de abas encosta na base com só a área do indicador de gestos dentro dela,
// nada fica atrás do botão Criar e o contador "Todas" conta o que a lista mostra. Dados 100% fictícios
// (`/m/?mock&demo`). Capturas em .context/comparar/mobile-fix/ (CAPTURA=depois, ou outro prefixo).

const OUT = "../../.context/comparar/mobile-fix";
const URL = "/m/?mock&demo&quieto&fora";

type Aparelho = { nome: string; uso: (typeof devices)[string]; sat: number; sab: number; ios: boolean };
const APARELHOS: Aparelho[] = [
  // iPhone 16 Pro (Dynamic Island): 402×874 pt @3x, área segura 62 pt em cima e 34 pt embaixo.
  { nome: "iphone", uso: { ...devices["iPhone 16 Pro"], viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 } }, sat: 62, sab: 34, ios: true },
  // Pixel 8 instalado (Chrome): barra de status e barra de gestos dentro da área segura.
  { nome: "android", uso: { ...devices["Pixel 8"], viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 } }, sat: 36, sab: 20, ios: false },
];

/**
 * Standalone de verdade não existe no Playwright: `navigator.standalone` e `(display-mode: standalone)`
 * passam a responder sim, as áreas seguras entram pelas variáveis `--m-sat/--m-sab` (o CSS usa env() por
 * elas) e, no iPhone, a altura que o iOS 26 informa na PWA vem curta pela área segura de cima (o defeito do
 * aparelho do Val: `innerHeight`/`visualViewport.height` = tela − 62 pt).
 */
async function standalone(page: Page, a: Aparelho) {
  await page.addInitScript(({ sat, sab, ios }) => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (/display-mode:\s*standalone/.test(q) ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as MediaQueryList) : mm(q));
    if (ios) {
      Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });
      const short = (proto: object, prop: string) => {
        const d = Object.getOwnPropertyDescriptor(proto, prop);
        if (d?.get) Object.defineProperty(proto, prop, { configurable: true, get(this: unknown) { return Math.max(0, (d.get!.call(this) as number) - sat); } });
      };
      short(Window.prototype, "innerHeight");
      short(window, "innerHeight");
      if (window.VisualViewport) short(VisualViewport.prototype, "height");
    }
    const st = document.createElement("style");
    st.textContent = `:root { --m-sat: ${sat}px !important; --m-sab: ${sab}px !important; } *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }`;
    const put = () => document.documentElement.appendChild(st);
    if (document.documentElement) put();
    else document.addEventListener("DOMContentLoaded", put);
  }, { sat: a.sat, sab: a.sab, ios: a.ios });
}

const box = async (page: Page, testid: string) => (await page.getByTestId(testid).first().boundingBox())!;

for (const a of APARELHOS) {
  test.describe(a.nome, () => {
    test(`${a.nome}: topo, base, botão Criar, contador e linhas`, async ({ playwright, baseURL }) => {
      // Cada aparelho no seu navegador (WebKit no iPhone, Chromium no Pixel) sem trocar de worker.
      const { defaultBrowserType, ...uso } = a.uso;
      const br = await playwright[defaultBrowserType].launch();
      const ctx = await br.newContext({ ...uso, baseURL, locale: "pt-BR", colorScheme: "dark" });
      const page = await ctx.newPage();
      await standalone(page, a);
      await page.goto(URL);
      await expect(page.getByTestId("m-ws").first()).toBeVisible();
      await expect(page.getByTestId("m-external-recent").first()).toBeVisible();
      const H = page.viewportSize()!.height;
      mkdirSync(OUT, { recursive: true });
      const pre = process.env.CAPTURA ?? "depois";
      await page.screenshot({ path: `${OUT}/${pre}-${a.nome}-topo.png` });

      // Topo: o cabeçalho começa logo abaixo da área segura (nada de área somada duas vezes)...
      const menu = await box(page, "m-menu");
      expect(menu.y).toBeGreaterThanOrEqual(a.sat - 1);
      expect(menu.y - a.sat).toBeLessThanOrEqual(8);
      // ...e atrás da barra de status o fundo é sólido, da cor do app (sem brilho nem desfoque vazando).
      const topo = await page.evaluate(() => {
        const app = document.querySelector<HTMLElement>(".m-app")!;
        const s = getComputedStyle(app, "::after");
        const probe = document.createElement("div");
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--m-bg").trim();
        document.body.appendChild(probe);
        const cor = getComputedStyle(probe).color;
        probe.remove();
        const nav = document.querySelector<HTMLElement>(".m-nav")!;
        return { pos: s.position, top: s.top, h: s.height, bg: s.backgroundColor, cor, z: Number(s.zIndex), navZ: Number(getComputedStyle(nav).zIndex), appTop: app.getBoundingClientRect().top };
      });
      expect(topo.appTop).toBe(0);
      expect(topo.pos).toBe("absolute");
      expect(topo.top).toBe("0px");
      expect(topo.h).toBe(`${a.sat}px`);
      expect(topo.bg).toBe(topo.cor);
      expect(topo.z).toBeGreaterThan(topo.navZ);

      // Base: a barra de abas encosta na borda de baixo e só a área do indicador fica dentro dela.
      const app = await page.locator(".m-app").first().boundingBox();
      expect(Math.round(app!.y + app!.height)).toBe(H);
      const tab = await page.locator(".m-tabbar").boundingBox();
      expect(Math.round(tab!.y + tab!.height)).toBe(H);
      const pad = await page.locator(".m-tabbar").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      expect(pad).toBe(a.sab);

      // Contador "Todas": conta as linhas da lista (workspaces, sessões e as de fora do Kabul), mesmo sem sessões ao vivo.
      const linhas = await page.locator('[data-testid="m-ws"], [data-testid="m-session"], [data-testid^="m-external-"][data-testid$="running"], [data-testid="m-external-recent"]').count();
      const todas = Number(await page.getByTestId("m-count-all").textContent());
      expect(todas).toBeGreaterThan(0);
      expect(todas).toBe(linhas);

      // Linha do workspace: o título fica com a maior parte da largura (ações num menu "…").
      const row = page.getByTestId("m-ws").first();
      const rb = (await row.boundingBox())!;
      const tb = (await row.locator(".m-row-text").boundingBox())!;
      expect(tb.width / rb.width).toBeGreaterThan(0.6);
      await row.getByTestId("m-ws-more").click();
      await expect(page.getByTestId("m-ws-actions")).toBeVisible();
      await expect(page.getByTestId("m-ws-actions").getByTestId("m-files")).toBeVisible();
      await expect(page.getByTestId("m-ws-actions").getByTestId("m-invite")).toBeVisible();
      await expect(page.getByTestId("m-ws-actions").getByTestId("m-new-chat")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${pre}-${a.nome}-menu.png` });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("m-ws-actions")).toHaveCount(0);

      // Fora do Kabul: sem "· ?" quando não há repositório (vale a pasta) e "Continuar" com contraste de botão.
      const ext = page.getByTestId("m-external");
      await expect(ext).not.toContainText("· ?");
      await expect(ext.getByTestId("m-external-running").filter({ hasText: "Gemini CLI" })).toContainText("notes");
      await expect(ext.getByTestId("m-external-recent").filter({ hasText: "Benchmark" })).toContainText("bench");
      for (const b of await ext.getByTestId("m-external-continue").all()) {
        await expect(b).toBeEnabled();
        expect(Number(await b.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
      }
      // Sem workspace do Kabul na pasta: o toque explica, logo abaixo da linha.
      const bench = ext.getByTestId("m-external-recent").filter({ hasText: "Benchmark" });
      await bench.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await bench.getByTestId("m-external-continue").click();
      await expect(ext.getByTestId("m-external-why")).toBeVisible();

      // Rola até o fim: a última linha (com o aviso embaixo) aparece inteira acima do botão Criar e da barra de abas.
      await page.locator("main.m-scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(150);
      const fab = await box(page, "m-create");
      const ultima = (await page.locator(".m-grp-body > :last-child").last().boundingBox())!;
      expect(ultima.y + ultima.height).toBeLessThanOrEqual(fab.y);
      expect(fab.y + fab.height).toBeLessThanOrEqual(tab!.y);
      await page.screenshot({ path: `${OUT}/${pre}-${a.nome}-fim.png` });
      await br.close();
    });
  });
}
