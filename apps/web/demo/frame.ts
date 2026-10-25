/* i18n-ignore-file: ferramenta das capturas de demonstração (não é interface do app). */
/**
 * Capturas do celular para o README e o site: tela cheia do PWA instalado (sem barra do navegador) e
 * moldura de aparelho desenhada em HTML/CSS (iPhone com Dynamic Island, Android com furo de câmera),
 * renderizada pelo próprio Playwright e reduzida para paleta de 256 cores (< 600 KB por imagem).
 *
 * Usado por demo/iphone.capture.ts e demo/android.capture.ts. Cru em <repo>/.context/demo/raw/,
 * final em <repo>/docs/assets/.
 */
import type { Browser, Page } from "../playwright-silencio";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const RAW = join(ROOT, ".context/demo/raw");
export const ASSETS = join(ROOT, "docs/assets");
export const BASE = "/m/?mock&demo";

export type Device = "iphone" | "android";
/** Área segura do PWA em tela cheia: barra de status em cima, indicador de gestos embaixo (pontos CSS). */
export const SAFE: Record<Device, { top: number; bottom: number; w: number; h: number }> = {
  iphone: { top: 59, bottom: 34, w: 393, h: 852 },
  android: { top: 36, bottom: 20, w: 412, h: 915 },
};

/**
 * O navegador do Playwright não tem área segura: troca `env(safe-area-inset-*)` nas folhas de estilo
 * (o Vite injeta o CSS em `<style>`, inclusive o das telas carregadas depois) pelos valores do aparelho.
 */
export async function prepare(page: Page, device: Device) {
  const { top, bottom } = SAFE[device];
  await page.addInitScript(({ top, bottom }) => {
    const fix = (el: Node | null) => {
      const s = el instanceof HTMLStyleElement ? el : el?.parentNode instanceof HTMLStyleElement ? el.parentNode : null;
      if (!s || !s.textContent?.includes("safe-area-inset")) return;
      s.textContent = s.textContent
        .replace(/env\(\s*safe-area-inset-top\s*(,[^)]*)?\)/g, `${top}px`)
        .replace(/env\(\s*safe-area-inset-bottom\s*(,[^)]*)?\)/g, `${bottom}px`)
        .replace(/env\(\s*safe-area-inset-(left|right)\s*(,[^)]*)?\)/g, "0px");
    };
    new MutationObserver((ms) => ms.forEach((m) => (m.addedNodes.forEach(fix), fix(m.target)))).observe(document, { childList: true, subtree: true, characterData: true });
    // Sem animação de entrada nas capturas e sem cursor piscando.
    document.addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }" +
        // O WebKit sem janela não desenha backdrop-filter: sem o desfoque do iOS, o texto passaria nítido por baixo
        // da barra de abas. Aqui a barra fica opaca, que é quase como o desfoque aparece no aparelho.
        ".m-tabbar, .m-nav.collapsed { background: var(--m-bg) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }";
      document.head.appendChild(st);
    });
  }, { top, bottom });
  page.on("pageerror", (e) => console.log(`[${device}] pageerror:`, e.message));
  page.on("console", (m) => m.type() === "error" && console.log(`[${device}] console:`, m.text()));
}

export async function shot(page: Page, name: string) {
  mkdirSync(RAW, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(RAW, `${name}.png`) });
}

// ---------------------------------------------------------------- moldura

export interface Phone { src: string; device: Device; theme: "dark" | "light" }

const ICONS = {
  iphone: (c: string) => `
    <svg width="19" height="12" viewBox="0 0 19 12"><g fill="${c}"><rect x="0" y="8" width="3.2" height="4" rx=".8"/><rect x="5" y="5.5" width="3.2" height="6.5" rx=".8"/><rect x="10" y="3" width="3.2" height="9" rx=".8"/><rect x="15" y="0" width="3.2" height="12" rx=".8"/></g></svg>
    <svg width="17" height="12" viewBox="0 0 17 12"><path fill="${c}" d="M8.5 2.6c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.8 10.8 0 0 0 8.5.8 10.8 10.8 0 0 0 1 3.8l1.2 1.3a9 9 0 0 1 6.3-2.5Zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3a7.2 7.2 0 0 0-9.8 0l1.2 1.3c1-.9 2.3-1.4 3.7-1.4Zm0 3.6c-.5 0-1 .2-1.3.5l1.3 1.4 1.3-1.4c-.3-.3-.8-.5-1.3-.5Z"/></svg>
    <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="${c}" stroke-opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2.5" fill="${c}"/><path d="M25 4.5v4a2.2 2.2 0 0 0 0-4Z" fill="${c}" fill-opacity=".45"/></svg>`,
  android: (c: string) => `
    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="${c}" d="M12 20.5 1 8.6A16.4 16.4 0 0 1 12 4.5c4.2 0 8 1.6 11 4.1Z"/></svg>
    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="${c}" d="M2 22h20V2Z"/></svg>
    <svg width="10" height="17" viewBox="0 0 10 17"><rect x="3" y="0" width="4" height="2" rx=".6" fill="${c}"/><rect x=".5" y="1.5" width="9" height="15" rx="1.8" fill="${c}"/></svg>`,
};

function phoneHtml(p: Phone, data: string) {
  const s = SAFE[p.device];
  const fg = p.theme === "dark" ? "#fff" : "#000";
  if (p.device === "iphone") {
    return `<div class="phone iphone" style="--w:${s.w}px;--h:${s.h}px">
      <div class="btn b1"></div><div class="btn b2"></div><div class="btn b3"></div><div class="btn b4"></div>
      <div class="screen"><img src="${data}">
        <div class="sb" style="color:${fg}"><span class="time">9:41</span><span class="icons">${ICONS.iphone(fg)}</span></div>
        <div class="island"></div><div class="home" style="background:${fg}"></div>
      </div></div>`;
  }
  return `<div class="phone android" style="--w:${s.w}px;--h:${s.h}px">
    <div class="btn a1"></div><div class="btn a2"></div>
    <div class="screen"><img src="${data}">
      <div class="sb" style="color:${fg}"><span class="time">9:41</span><span class="icons">${ICONS.android(fg)}</span></div>
      <div class="cam"></div><div class="home" style="background:${fg}"></div>
    </div></div>`;
}

const CSS = `
  html, body { margin: 0; background: transparent; }
  .stage { display: inline-flex; align-items: center; gap: var(--gap); padding: 24px; }
  .phone { position: relative; flex: none; }
  .screen { position: absolute; overflow: hidden; background: #000; }
  .screen img { display: block; width: var(--w); height: var(--h); }
  .sb { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; font: 600 17px/1 -apple-system, "SF Pro Text", system-ui, sans-serif; letter-spacing: -.2px; }
  .sb .icons { display: inline-flex; align-items: center; }
  .btn { position: absolute; background: linear-gradient(90deg, #2b2b2e, #4a4a4f 50%, #2b2b2e); }

  .iphone { width: calc(var(--w) + 26px); height: calc(var(--h) + 26px); border-radius: 68px; background: #0b0b0c;
    box-shadow: inset 0 0 0 2px #5b5b60, inset 0 0 0 4px #1d1d1f, inset 0 0 0 5px #3a3a3e; }
  .iphone .screen { inset: 13px; border-radius: 55px; }
  .iphone .sb { height: 54px; padding: 3px 34px 0 52px; }
  .iphone .sb .time { width: 54px; text-align: center; }
  .iphone .sb .icons { gap: 6px; }
  .iphone .island { position: absolute; top: 11px; left: 50%; width: 125px; height: 37px; margin-left: -62.5px; border-radius: 20px; background: #000; }
  .iphone .home { position: absolute; bottom: 8px; left: 50%; width: 136px; height: 5px; margin-left: -68px; border-radius: 3px; opacity: .92; }
  .iphone .b1 { left: -3px; top: 150px; width: 4px; height: 32px; border-radius: 2px 0 0 2px; }
  .iphone .b2 { left: -3px; top: 215px; width: 4px; height: 62px; border-radius: 2px 0 0 2px; }
  .iphone .b3 { left: -3px; top: 292px; width: 4px; height: 62px; border-radius: 2px 0 0 2px; }
  .iphone .b4 { right: -3px; top: 250px; width: 4px; height: 98px; border-radius: 0 2px 2px 0; }

  .android { width: calc(var(--w) + 22px); height: calc(var(--h) + 22px); border-radius: 46px; background: #101012;
    box-shadow: inset 0 0 0 2px #55555a, inset 0 0 0 3px #1c1c1e; }
  .android .screen { inset: 11px; border-radius: 35px; }
  .android .sb { height: 36px; padding: 0 22px 0 26px; font: 500 15px/1 Roboto, "Google Sans", system-ui, sans-serif; letter-spacing: .2px; }
  .android .sb .icons { gap: 5px; }
  .android .cam { position: absolute; top: 9px; left: 50%; width: 19px; height: 19px; margin-left: -9.5px; border-radius: 50%; background: radial-gradient(circle at 40% 38%, #2b3242 0 22%, #07080a 46%); box-shadow: 0 0 0 1.5px #000; }
  .android .home { position: absolute; bottom: 7px; left: 50%; width: 108px; height: 4px; margin-left: -54px; border-radius: 2px; opacity: .8; }
  .android .a1 { right: -3px; top: 200px; width: 4px; height: 52px; border-radius: 0 2px 2px 0; }
  .android .a2 { right: -3px; top: 290px; width: 4px; height: 104px; border-radius: 0 2px 2px 0; }
`;

/**
 * Aparelhos lado a lado sobre fundo transparente, renderizados no navegador do projeto e gravados em
 * docs/assets/<out>.png com paleta de 256 cores. `scale` é a densidade da imagem final (2 = ~2000 px
 * para dois aparelhos).
 */
export async function frame(browser: Browser, phones: Phone[], out: string, { scale = 2, gap = 72 } = {}) {
  for (const p of phones) if (!existsSync(join(RAW, `${p.src}.png`))) return console.log(`frame: falta ${p.src}.png, ${out}.png não foi gerado`);
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 }, deviceScaleFactor: scale, colorScheme: "dark" });
  const page = await ctx.newPage();
  const imgs = phones.map((p) => `data:image/png;base64,${readFileSync(join(RAW, `${p.src}.png`)).toString("base64")}`);
  await page.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body><div class="stage" style="--gap:${gap}px">${phones.map((p, i) => phoneHtml(p, imgs[i])).join("")}</div></body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const stage = page.locator(".stage");
  mkdirSync(ASSETS, { recursive: true });
  const png = await stage.screenshot({ omitBackground: true });
  await ctx.close();
  const path = join(ASSETS, `${out}.png`);
  writeFileSync(path, await quantize(png));
  const kb = Math.round(statSync(path).size / 1024);
  console.log(`frame: ${out}.png ${kb} KB`);
  return path;
}

/** Colaboração: o iPhone da Sam e o Android da Maya na mesma conversa (quem rodar por último compõe). */
export const composeCollab = (browser: Browser) =>
  frame(browser, [{ src: "iphone-collab", device: "iphone", theme: "dark" }, { src: "android-collab", device: "android", theme: "dark" }], "collab-mobile");

/**
 * 256 cores com transparência: libimagequant pelo sharp (vem com as dependências do web); sem ele,
 * ffmpeg (palettegen + paletteuse, dither sierra2_4a).
 */
async function quantize(png: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(png).png({ palette: true, colours: 256, quality: 100, effort: 10, dither: 0.8, compressionLevel: 9 }).toBuffer();
  } catch (e) {
    console.log("frame: sharp indisponível, usando ffmpeg:", (e as Error).message);
    mkdirSync(RAW, { recursive: true });
    const src = join(RAW, "_frame-in.png");
    const dst = join(RAW, "_frame-out.png");
    writeFileSync(src, png);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-filter_complex", "[0:v]split[a][b];[a]palettegen=max_colors=256:stats_mode=full:reserve_transparent=1[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=128", dst]);
    return readFileSync(dst);
  }
}
