// Gera os ícones e as telas de abertura (splash) da PWA a partir de um SVG, renderizando no Chromium
// do Playwright. Uso: `node scripts/gen-pwa-icons.mjs` (dentro de apps/web). Saída em public/.
// - icon-192/512 e apple-touch-icon: quadrado cheio (o iOS/Android arredondam), sem cantos transparentes;
// - icon-maskable-512: marca dentro da zona segura de 80%;
// - splash/*: uma por tamanho de iPhone, escura e clara; imprime os <link rel="apple-touch-startup-image"> do index.html.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../public/", import.meta.url));

/** Marca do Kabul (losango vazado com losango cheio no centro) num quadrado de `s` px. */
function mark(s, { bg = true, scale = 1 } = {}) {
  const c = s / 2;
  const outer = s * 0.24 * scale;
  const inner = s * 0.095 * scale;
  const sw = s * 0.024 * scale;
  const d = (r) => `M${c} ${c - r} L${c + r} ${c} L${c} ${c + r} L${c - r} ${c} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2623"/><stop offset="1" stop-color="#131110"/></linearGradient></defs>
    ${bg ? `<rect width="${s}" height="${s}" fill="url(#g)"/>` : ""}
    <path d="${d(outer)}" fill="none" stroke="#d6a77f" stroke-width="${sw}" stroke-linejoin="miter"/>
    <path d="${d(inner)}" fill="#d6a77f"/>
  </svg>`;
}

const SPLASH = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [390, 844, 3], [428, 926, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2],
];

const browser = await chromium.launch();
async function png(html, w, h, dpr, file) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await p.setContent(`<html><body style="margin:0">${html}</body></html>`);
  await p.screenshot({ path: OUT + file, omitBackground: false });
  await p.close();
}

for (const [s, file] of [[192, "icon-192.png"], [512, "icon-512.png"], [180, "apple-touch-icon.png"]]) await png(mark(s), s, s, 1, file);
await png(mark(512, { scale: 0.82 }), 512, 512, 1, "icon-maskable-512.png");

mkdirSync(OUT + "splash", { recursive: true });
const links = [];
for (const [w, h, dpr] of SPLASH) {
  for (const [theme, bg] of [["escuro", "#0c0a09"], ["claro", "#f2f1ee"]]) {
    const icon = 112;
    const html = `<div style="width:${w}px;height:${h}px;background:${bg};display:grid;place-items:center"><div style="width:${icon}px;height:${icon}px;border-radius:${icon * 0.225}px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.25)">${mark(icon)}</div></div>`;
    const file = `splash/${w * dpr}x${h * dpr}-${theme}.png`;
    await png(html, w, h, dpr, file);
    links.push(`<link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${theme === "escuro" ? "dark" : "light"})" href="/${file}" />`);
  }
}
await browser.close();
// Cole estas linhas no <head> do index.html (já estão lá para os tamanhos acima).
console.log(links.join("\n"));
