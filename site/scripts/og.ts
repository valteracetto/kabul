// Renders the Open Graph images (1200×630) from the hero screenshot with headless Chrome, so the text uses
// the real Geist font. The output is committed (site/public/og.png and og-pt-BR.png); run this again only
// when the hero or the tagline changes:
//
//   node scripts/og.ts            (npm run og)
//   CHROME=/path/to/chrome node scripts/og.ts
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { content, type Lang } from "../src/content.ts";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SITE, "..");
const CHROME =
  process.env.CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

const fileUrl = (p: string) => pathToFileURL(p).href;

function html(lang: Lang): string {
  const c = content[lang];
  const geist = fileUrl(join(SITE, "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2"));
  const hero = fileUrl(join(ROOT, "docs/assets/hero.png"));
  const icon = fileUrl(join(SITE, "public/favicon.svg"));
  const lanes = ["#e0a685", "#a6abf0", "#9cc0f0", "#8fb8e8", "#b5a3f0", "#c9c5c2", "#9fc4a8"];
  return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url("${geist}") format("woff2");font-weight:100 900}
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden;background:#141110;color:#eae8e6;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased}
.glow{position:absolute;inset:0;background:radial-gradient(70% 90% at 100% 100%,rgba(214,167,122,.16),transparent 60%)}
.text{position:absolute;left:72px;top:68px;width:560px}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:600;letter-spacing:-.01em}
.brand img{width:48px;height:48px}
h1{margin-top:44px;font-size:62px;line-height:1.02;letter-spacing:-.045em;font-weight:600}
p{margin-top:24px;font-size:23px;line-height:1.4;color:#a5a09c;width:500px}
.lanes{position:absolute;left:72px;bottom:64px;display:flex;gap:8px}
.lanes i{display:block;width:60px;height:3px;border-radius:2px}
.shot{position:absolute;left:668px;top:96px;width:900px;border-radius:16px;overflow:hidden;border:1px solid #34312f;box-shadow:0 -1px 0 rgba(214,167,122,.35),0 40px 100px rgba(0,0,0,.8)}
.shot img{display:block;width:100%}
</style></head><body><div class="glow"></div>
<div class="text"><div class="brand"><img src="${icon}" alt="">Kabul</div><h1>${c.hero.title}</h1><p>${c.lang === "en" ? "Claude, GPT, Gemini, Qwen and local models in parallel. Free and open source for macOS." : "Claude, GPT, Gemini, Qwen e modelos locais em paralelo. Gratuito e de código aberto para macOS."}</p></div>
<div class="lanes">${lanes.map((l) => `<i style="background:${l}"></i>`).join("")}</div>
<div class="shot"><img src="${hero}" alt=""></div>
</body></html>`;
}

const tmp = await mkdtemp(join(tmpdir(), "kabul-og-"));
try {
  await mkdir(join(SITE, "public"), { recursive: true });
  for (const lang of ["en", "pt-BR"] as Lang[]) {
    const page = join(tmp, `og-${lang}.html`);
    const shot = join(tmp, `og-${lang}.png`);
    await writeFile(page, html(lang));
    execFileSync(CHROME, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${join(tmp, "profile")}`,
      "--allow-file-access-from-files",
      "--virtual-time-budget=3000",
      "--window-size=1200,630",
      `--screenshot=${shot}`,
      fileUrl(page),
    ], { stdio: "ignore" });
    const out = join(SITE, "public", lang === "en" ? "og.png" : "og-pt-BR.png");
    await sharp(shot).resize(1200, 630, { fit: "cover", position: "top" }).png({ compressionLevel: 9, palette: false }).toFile(out);
    console.log(`og: ${out}`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
