// Acabamento dos clipes da landing page (rodado por `npm run demo:site-clips`, depois do spec
// demo/site-clips.capture.ts): corta o trecho útil de cada .webm cru (marcas no .json ao lado), acelera se
// passar de ~9,6 s e grava em <repo>/site/media/:
//   <nome>.webm (VP9), <nome>.mp4 (H.264 high, faststart), <nome>-poster.webp e <nome>-poster.avif (sharp).
// Sem áudio. Cada arquivo ≤ 1,5 MB: se passar, sobe o crf e tenta de novo.
// Uso: node demo/site-clips.mjs [switch|agents|phone ...]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT = resolve(import.meta.dirname, "../../..");
const RAW = join(ROOT, ".context/demo/raw");
const OUT = join(ROOT, "site/media");
const LIMIT = 1.5 * 1024 * 1024;
const MAX_S = 9.6;
const only = process.argv.slice(2);

// Desktop em 1280×800 (o site mostra com ~720 px; em tela retina isso é ~1440 px, então 1280 segura o texto nítido).
// Celular: só a tela do app (393×852 lógicos), em 430 px de largura.
const CLIPS = {
  switch: { width: 1280, fps: 25, pad: [0.1, 0.2] },
  agents: { width: 1280, fps: 25, pad: [0.1, 0.2] },
  phone: { width: 430, fps: 30, pad: [0.1, 0.2] },
};

const ff = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const probe = (f) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration,size", "-of", "json", f]).toString());
  const [n, d] = j.streams[0].avg_frame_rate.split("/").map(Number);
  return { w: j.streams[0].width, h: j.streams[0].height, fps: d ? n / d : n, dur: +j.format.duration, size: +j.format.size };
};
const kb = (b) => `${Math.round(b / 1024)} KB`;

// sharp vem com as dependências do web (é o mesmo do finish.mjs); senão, o do site.
let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  try {
    sharp = createRequire(join(ROOT, "site/package.json"))("sharp");
  } catch {}
}

mkdirSync(OUT, { recursive: true });
let failed = false;

for (const [name, c] of Object.entries(CLIPS)) {
  if (only.length && !only.includes(name)) continue;
  const src = join(RAW, `clip-${name}.webm`);
  const marks = join(RAW, `clip-${name}.json`);
  if (!existsSync(src) || !existsSync(marks)) {
    console.log(`site-clips: falta ${src.replace(ROOT + "/", "")} (rode o spec antes)`);
    failed = true;
    continue;
  }
  const { start, end } = JSON.parse(readFileSync(marks, "utf8"));
  const ss = Math.max(0, start - c.pad[0]);
  const dur = end + c.pad[1] - ss;
  const speed = Math.max(1, dur / MAX_S);
  const vf = `setpts=PTS/${speed.toFixed(4)},fps=${c.fps},scale=${c.width}:-2:flags=lanczos,format=yuv420p`;
  const cut = ["-ss", ss.toFixed(3), "-t", dur.toFixed(3), "-i", src, "-vf", vf, "-an"];

  const webm = join(OUT, `${name}.webm`);
  for (const crf of [32, 36, 40, 44, 48]) {
    ff([...cut, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", "-g", String(c.fps * 4), webm]);
    if (statSync(webm).size <= LIMIT) break;
  }
  const mp4 = join(OUT, `${name}.mp4`);
  for (const crf of [23, 26, 29, 32, 35]) {
    ff([...cut, "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
    if (statSync(mp4).size <= LIMIT) break;
  }

  // Poster: o último quadro do trecho (o resultado na tela), tirado do cru em alta e reduzido pelo sharp.
  const at = Math.max(ss, end - 0.1);
  const png = join(RAW, `_clip-${name}-poster.png`);
  ff(["-ss", at.toFixed(3), "-i", src, "-frames:v", "1", "-update", "1", png]);
  const posters = [];
  if (sharp) {
    const img = () => sharp(png).resize({ width: c.width });
    writeFileSync(join(OUT, `${name}-poster.webp`), await img().webp({ quality: 78, effort: 6 }).toBuffer());
    writeFileSync(join(OUT, `${name}-poster.avif`), await img().avif({ quality: 55, effort: 6 }).toBuffer());
    posters.push(`${name}-poster.webp`, `${name}-poster.avif`);
  } else {
    // Sem sharp: sem encoder de WebP no ffmpeg daqui; fica o AVIF pelo SVT-AV1.
    ff(["-i", png, "-vf", `scale=${c.width}:-2:flags=lanczos,format=yuv420p`, "-frames:v", "1", "-c:v", "libsvtav1", "-crf", "35", "-svtav1-params", "loglevel=0", join(OUT, `${name}-poster.avif`)]);
    posters.push(`${name}-poster.avif`);
  }
  rmSync(png, { force: true });

  for (const f of [webm, mp4]) {
    const p = probe(f);
    const ok = p.size <= LIMIT && p.dur <= 10;
    if (!ok) failed = true;
    console.log(`site-clips: site/media/${f.split("/").pop()} ${kb(p.size)} · ${p.dur.toFixed(2)} s · ${p.w}×${p.h} · ${Math.round(p.fps)} fps${speed > 1 ? ` · ${speed.toFixed(2)}×` : ""}${ok ? "" : "  ← PASSOU DO LIMITE"}`);
  }
  for (const f of posters) console.log(`site-clips: site/media/${f} ${kb(statSync(join(OUT, f)).size)}`);
}

if (failed) process.exit(1);
