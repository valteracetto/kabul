// Acabamento das capturas do desktop e do vídeo (rodado por `npm run demo:capture`, depois dos specs):
// - PNGs do desktop: 256 cores (libimagequant pelo sharp; sem ele, ffmpeg), cada um < 600 KB, em docs/assets/;
// - barra do Kabul: o popover sobre um fundo com a barra de menus do macOS desenhada em HTML;
// - vídeo: corta o trecho útil do .webm, acelera um pouco e gera demo.mp4 (H.264) e demo.gif (≤ 6 MB).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const RAW = join(ROOT, ".context/demo/raw");
const ASSETS = join(ROOT, "docs/assets");
const LIMIT = 600 * 1024;
const kb = (p) => `${Math.round(statSync(p).size / 1024)} KB`;
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

async function quantize(src, dst, { width } = {}) {
  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {}
  for (const colours of [256, 192, 128]) {
    if (sharp) {
      let img = sharp(src);
      if (width) img = img.resize({ width });
      writeFileSync(dst, await img.png({ palette: true, colours, quality: 100, effort: 10, dither: 0.6, compressionLevel: 9 }).toBuffer());
    } else {
      const scale = width ? `scale=${width}:-1:flags=lanczos,` : "";
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-filter_complex", `[0:v]${scale}split[a][b];[a]palettegen=max_colors=${colours}:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a`, dst]);
    }
    if (statSync(dst).size < LIMIT) break;
  }
  console.log(`finish: ${dst.replace(ROOT + "/", "")} ${kb(dst)}`);
}

// Capturas do desktop (nome cru → nome final).
const DESKTOP = {
  hero: "hero",
  workspaces: "workspaces",
  "switch-llm-plain": "switch-llm",
  "switch-llm": "model-picker",
  agents: "agents",
  usage: "usage",
  mcp: "mcp",
  collab: "collab",
  "light-switch": "switch-llm-light",
  "light-usage": "usage-light",
};
if (want("png")) for (const [raw, out] of Object.entries(DESKTOP)) {
  const src = join(RAW, `${raw}.png`);
  if (existsSync(src)) await quantize(src, join(ASSETS, `${out}.png`));
  else console.log(`finish: falta ${raw}.png (rode os specs antes)`);
}

// Barra do Kabul: popover sob o ícone, numa barra de menus desenhada (sem nada da máquina de verdade).
if (want("menubar") && existsSync(join(RAW, "menubar.png"))) {
  const pop = readFileSync(join(RAW, "menubar.png")).toString("base64");
  const html = `<!doctype html><html><body style="margin:0">
<div id="stage" style="width:600px;height:600px;position:relative;overflow:hidden;font:13px -apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;
  background:radial-gradient(120% 90% at 20% 10%,#3b2f63 0%,#1d2140 45%,#0e1424 100%)">
  <div style="position:absolute;inset:0 0 auto 0;height:28px;background:rgba(20,20,28,.55);backdrop-filter:blur(20px);color:#f2f2f2;display:flex;align-items:center;gap:18px;padding:0 14px;box-sizing:border-box">
    <svg width="14" height="16" viewBox="0 0 14 17" fill="#f2f2f2"><path d="M11.6 9c0-2 1.6-3 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7C3.4 4.4 2 5.2 1.3 6.5c-1.5 2.6-.4 6.4 1 8.5.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.3 0 0-2.3-.9-2.3-3.8zM9.6 3c.6-.7 1-1.6.9-2.6-.8 0-1.8.6-2.4 1.3-.5.6-1 1.6-.9 2.5.9.1 1.8-.5 2.4-1.2z"/></svg>
    <b>Kabul</b><span>File</span><span>Edit</span><span>View</span>
    <span style="flex:1"></span>
    <span style="background:rgba(255,255,255,.22);border-radius:5px;padding:2px 7px;display:flex;align-items:center;gap:5px">
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1 11 6 6 11 1 6Z" fill="#e8a888"/></svg><span>64%</span></span>
    <span>Thu 10:24 AM</span>
  </div>
  <img src="data:image/png;base64,${pop}" style="position:absolute;top:36px;right:64px;width:380px;border-radius:12px;box-shadow:0 0 0 .5px rgba(255,255,255,.18),0 24px 60px rgba(0,0,0,.55)">
</div></body></html>`;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 2 });
  await p.setContent(html);
  await p.waitForTimeout(300);
  const box = await p.evaluate(() => { const i = document.querySelector("img"); return i.getBoundingClientRect().bottom; });
  await p.setViewportSize({ width: 600, height: Math.ceil(box + 40) });
  await p.evaluate((h) => (document.getElementById("stage").style.height = `${h}px`), Math.ceil(box + 40));
  const tmp = join(RAW, "_menubar-framed.png");
  await p.locator("#stage").screenshot({ path: tmp });
  await b.close();
  await quantize(tmp, join(ASSETS, "menubar.png"));
}

// Vídeo: trecho entre as marcas do spec, 1,1× mais rápido; MP4 e GIF.
if (want("video") && existsSync(join(RAW, "demo.webm"))) {
  const cut = JSON.parse(readFileSync(join(RAW, "demo-cut.json"), "utf8"));
  const ss = Math.max(0, cut.start - 0.3), dur = cut.end - ss + 0.3;
  const speed = Math.max(1, (dur + 0.5) / 19.5);
  const src = join(RAW, "demo.webm");
  const mp4 = join(ASSETS, "demo.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(ss), "-t", String(dur), "-i", src, "-vf", `setpts=PTS/${speed.toFixed(3)},fps=30,format=yuv420p`, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", mp4]);
  console.log(`finish: docs/assets/demo.mp4 ${kb(mp4)} (${(dur / speed).toFixed(1)} s)`);
  const gif = join(ASSETS, "demo.gif");
  for (const [w, fps] of [[1000, 12], [900, 10], [800, 10]]) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-filter_complex", `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
    if (statSync(gif).size < 6 * 1024 * 1024) break;
  }
  console.log(`finish: docs/assets/demo.gif ${kb(gif)}`);
}
