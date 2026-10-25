// Encodes the hero loop for the landing page from docs/assets/demo.mp4 (the README demo) into site/media/:
// WebM (VP9) and MP4 (H.264, faststart), at 1280 and 720 px wide, no audio. The build only copies these
// files with a content hash; it never runs ffmpeg, so CI doesn't need it.
//
//   npm run media          (needs ffmpeg with libvpx-vp9 and libx264)
//
// The short feature clips in site/media (switch, agents, phone) come from the app's demo environment:
// `cd apps/web && npm run demo:site-clips`.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(SITE, "..", "docs", "assets", "demo.mp4");
const OUT = join(SITE, "media");
mkdirSync(OUT, { recursive: true });

const ff = (args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", SRC, "-an", ...args], { stdio: "inherit" });
const kb = (p: string) => `${Math.round(statSync(p).size / 1024)} KB`;

for (const [w, vp9, h264] of [
  [1280, 37, 27],
  [720, 36, 27],
] as const) {
  const scale = `scale=${w}:-2:flags=lanczos,fps=25,format=yuv420p`;
  const webm = join(OUT, `hero-${w}.webm`);
  const mp4 = join(OUT, `hero-${w}.mp4`);
  ff(["-vf", scale, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(vp9), "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", webm]);
  ff(["-vf", scale, "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-crf", String(h264), "-movflags", "+faststart", mp4]);
  console.log(`media: hero-${w}.webm ${kb(webm)}, hero-${w}.mp4 ${kb(mp4)}`);
}
