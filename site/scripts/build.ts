// Builds the landing page into site/dist (static files for Cloudflare Pages).
//
//   node scripts/build.ts            (npm run build)
//   SITE_URL=https://example.com node scripts/build.ts
//
// Images come from docs/assets (the same screenshots as the README) and are converted to AVIF and WebP
// at a few widths, cached in site/.cache/img. Everything under /assets/ is content-hashed, so _headers
// can cache it forever.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import subsetFont from "subset-font";
import { config } from "../src/config.ts";
import type { Clip, Img } from "../src/content.ts";
import { llmsFull, llmsTxt, pageMarkdown } from "../src/llms.ts";
import { renderPage, type ClipMedia, type Ctx, type Loop, type Picture } from "../src/page.ts";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SITE, "..");
const DIST = join(SITE, "dist");
const CACHE = join(SITE, ".cache", "img");
const ASSETS = join(ROOT, "docs", "assets");
const ICONS = join(ROOT, "apps", "desktop", "src-tauri", "icons");
/** Encoded video (npm run media for the hero loop, apps/web `npm run demo:site-clips` for the clips). */
const MEDIA = join(SITE, "media");

const IMAGES: Record<Img, number[]> = {
  hero: [640, 960, 1440, 1920, 2560],
  "model-picker": [480, 800, 1280, 1600],
  "switch-llm": [480, 800, 1280, 1600],
  agents: [480, 800, 1280, 1600],
  usage: [480, 800, 1280, 1600],
  "collab-mobile": [480, 680, 1000, 1400],
  mobile: [400, 680, 1000, 1400],
  "mobile-android": [400, 680, 1000, 1400],
  mcp: [468, 936],
  menubar: [400, 800, 1200],
};

const hash = (buf: Buffer | string, n = 10) => createHash("sha256").update(buf).digest("hex").slice(0, n);

async function emit(rel: string, data: Buffer | string): Promise<string> {
  const out = join(DIST, rel);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, data);
  return "/" + rel.split("\\").join("/");
}

async function hashed(name: string, ext: string, data: Buffer | string): Promise<string> {
  return emit(`assets/${name}.${hash(data)}.${ext}`, data);
}

async function readVersion(): Promise<string> {
  try {
    const toml = await readFile(join(ROOT, "Cargo.toml"), "utf8");
    const m = toml.match(/^\s*version\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return config.fallbackVersion;
}

async function buildImage(key: string, widths: number[], src = join(ASSETS, `${key}.png`)): Promise<Picture> {
  const input = await readFile(src);
  const meta = await sharp(input).metadata();
  const w0 = meta.width!;
  const h0 = meta.height!;
  const srcHash = hash(input, 12);
  const pic: Picture = { width: 0, height: 0, avif: [], webp: [] };
  const usable = widths.filter((w) => w <= w0);
  if (usable.length === 0) usable.push(w0);
  for (const w of usable) {
    for (const fmt of ["avif", "webp"] as const) {
      const cached = join(CACHE, `${key}-${srcHash}-${w}.${fmt}`);
      let data: Buffer;
      try {
        data = await readFile(cached);
      } catch {
        const pipeline = sharp(input).resize({ width: w, withoutEnlargement: true });
        data =
          fmt === "avif"
            ? await pipeline.avif({ quality: 58, effort: 5, chromaSubsampling: "4:4:4" }).toBuffer()
            : await pipeline.webp({ quality: 78, effort: 5, smartSubsample: true }).toBuffer();
        await mkdir(CACHE, { recursive: true });
        await writeFile(cached, data);
      }
      const url = await emit(`assets/img/${key}-${w}.${hash(data)}.${fmt}`, data);
      pic[fmt].push({ w, url });
    }
  }
  // Intrinsic size of the largest variant, for width/height attributes (aspect ratio, no layout shift).
  const big = usable[usable.length - 1];
  pic.width = big;
  pic.height = Math.round((h0 * big) / w0);
  return pic;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Copies a video into /media with a content hash (cached forever by _headers). */
async function media(name: string, ext: "webm" | "mp4"): Promise<string> {
  const data = await readFile(join(MEDIA, `${name}.${ext}`));
  return emit(`media/${name}.${hash(data)}.${ext}`, data);
}

async function loop(name: string, width: number, height: number): Promise<Loop> {
  return { webm: await media(name, "webm"), mp4: await media(name, "mp4"), width, height };
}

/** A feature clip with its poster (AVIF and WebP, from <name>-poster.webp). Null when it wasn't recorded. */
async function clipMedia(name: Clip, widths: number[]): Promise<ClipMedia | null> {
  const posterSrc = join(MEDIA, `${name}-poster.webp`);
  if (!(await exists(join(MEDIA, `${name}.webm`))) || !(await exists(join(MEDIA, `${name}.mp4`))) || !(await exists(posterSrc))) {
    console.warn(`site: clip "${name}" not found in site/media, using the screenshot instead`);
    return null;
  }
  const meta = await sharp(await readFile(posterSrc)).metadata();
  const poster = await buildImage(`clip-${name}`, widths, posterSrc);
  return { ...(await loop(name, meta.width!, meta.height!)), poster };
}

async function copyDir(from: string, to: string) {
  let entries: string[] = [];
  try {
    entries = await readdir(from);
  } catch {
    return;
  }
  for (const name of entries) {
    const s = join(from, name);
    const d = join(to, name);
    if ((await stat(s)).isDirectory()) {
      await mkdir(d, { recursive: true });
      await copyDir(s, d);
    } else {
      await mkdir(dirname(d), { recursive: true });
      await copyFile(s, d);
    }
  }
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

async function main() {
  const t0 = Date.now();
  const siteUrl = config.siteUrl;
  const version = await readVersion();
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // Static files that ship as they are (og images, favicon, video poster).
  await copyDir(join(SITE, "public"), DIST);

  // Fonts
  const geist = await readFile(join(SITE, "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2"));
  const geistMono = await readFile(join(SITE, "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2"));
  // Subset to the characters the page can show (the copy and the markup, plus printable ASCII):
  // about 70 KB down to about 25 KB per font, which matters for the first paint on a phone.
  const charset = [
    ...new Set(
      (await readFile(join(SITE, "src/content.ts"), "utf8")) +
        (await readFile(join(SITE, "src/page.ts"), "utf8")) +
        String.fromCharCode(...Array.from({ length: 95 }, (_, i) => 32 + i)),
    ),
  ]
    .filter((ch) => ch >= " ")
    .join("");
  const fontUrl = await hashed("geist", "woff2", await subsetFont(geist, charset, { targetFormat: "woff2" }));
  const monoUrl = await hashed("geist-mono", "woff2", await subsetFont(geistMono, charset, { targetFormat: "woff2" }));

  // CSS, inlined. Its hash goes into the CSP.
  const css = minifyCss(
    (await readFile(join(SITE, "src/styles.css"), "utf8")).replace("__GEIST__", fontUrl).replace("__GEIST_MONO__", monoUrl),
  );
  const cssHash = createHash("sha256").update(css).digest("base64");

  // JS (progressive enhancement only)
  const js = await hashed("site", "js", await readFile(join(SITE, "src/site.js")));

  // Images
  const pictures = {} as Record<Img, Picture>;
  for (const [key, widths] of Object.entries(IMAGES) as [Img, number[]][]) {
    pictures[key] = await buildImage(key, widths);
  }

  // Icons and manifest
  const source = await readFile(join(ICONS, "source-1024.png"));
  const ink = { r: 20, g: 17, b: 16, alpha: 1 };
  await emit("apple-touch-icon.png", await sharp(source).resize(180, 180).flatten({ background: ink }).png().toBuffer());
  await emit("icon-192.png", await sharp(source).resize(192, 192).png().toBuffer());
  await emit("icon-512.png", await sharp(source).resize(512, 512).png().toBuffer());
  const maskable = await sharp(source).resize(400, 400).extend({ top: 56, bottom: 56, left: 56, right: 56, background: ink }).flatten({ background: ink }).png().toBuffer();
  await emit("icon-maskable-512.png", maskable);
  const manifest = {
    name: "Kabul",
    short_name: "Kabul",
    description: "Every coding agent at its best, side by side.",
    start_url: "/",
    scope: "/",
    display: "browser",
    background_color: "#141110",
    theme_color: "#141110",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  await emit("site.webmanifest", JSON.stringify(manifest, null, 2));

  // Hero loop (the README demo, re-encoded by `npm run media`) and the feature clips.
  const hero = { large: await loop("hero-1280", 1280, 800), small: await loop("hero-720", 720, 450) };
  const clips: Record<Clip, ClipMedia | null> = {
    switch: await clipMedia("switch", [480, 800, 1280]),
    agents: await clipMedia("agents", [480, 800, 1280]),
    phone: await clipMedia("phone", [300, 430, 600, 860]),
  };

  const base: Omit<Ctx, "og"> = {
    siteUrl,
    version,
    css,
    js,
    font: fontUrl,
    pictures,
    icons: { svg: "/favicon.svg", ico: "/favicon.ico", apple: "/apple-touch-icon.png", manifest: "/site.webmanifest" },
    hero,
    clips,
  };

  await emit("index.html", renderPage("en", { ...base, og: { url: "/og.png", width: 1200, height: 630 } }));
  await emit("pt-BR/index.html", renderPage("pt-BR", { ...base, og: { url: "/og-pt-BR.png", width: 1200, height: 630 } }));
  await emit("404.html", notFound(css));

  // For LLMs and AI search (https://llmstxt.org): an index, the full text, and each page as Markdown.
  await emit("llms.txt", llmsTxt(siteUrl, version));
  await emit("llms-full.txt", llmsFull(siteUrl, version));
  await emit("index.md", pageMarkdown("en", siteUrl, version));
  await emit("pt-BR/index.md", pageMarkdown("pt-BR", siteUrl, version));

  // SEO files
  const today = new Date().toISOString().slice(0, 10);
  const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${siteUrl}/"/><xhtml:link rel="alternate" hreflang="pt-BR" href="${siteUrl}/pt-BR/"/><xhtml:link rel="alternate" hreflang="x-default" href="${siteUrl}/"/>`;
  await emit(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
<url><loc>${siteUrl}/</loc><lastmod>${today}</lastmod>${alternates}</url>
<url><loc>${siteUrl}/pt-BR/</loc><lastmod>${today}</lastmod>${alternates}</url>
</urlset>
`,
  );
  await emit("robots.txt", robots(siteUrl));

  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'sha256-${cssHash}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  await emit(
    "_headers",
    `# Generated by scripts/build.ts. The CSP carries the hash of the inlined stylesheet, so rebuild after CSS changes.
/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/media/*
  Cache-Control: public, max-age=31536000, immutable

/og.png
  Cache-Control: public, max-age=86400

/og-pt-BR.png
  Cache-Control: public, max-age=86400

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/llms.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=3600

/llms-full.txt
  Content-Type: text/plain; charset=utf-8
  Cache-Control: public, max-age=3600

/robots.txt
  Content-Type: text/plain; charset=utf-8

/index.md
  Content-Type: text/markdown; charset=utf-8
  Cache-Control: public, max-age=3600
  Link: <${siteUrl}/>; rel="canonical"

/pt-BR/index.md
  Content-Type: text/markdown; charset=utf-8
  Cache-Control: public, max-age=3600
  Link: <${siteUrl}/pt-BR/>; rel="canonical"
`,
  );
  // Which paths run Functions (the host redirect in functions/_middleware.ts and /api/waitlist). Hashed
  // assets, media and icons are served straight from the edge: free, unlimited, and only ever requested by
  // a page that the middleware already let through.
  await emit(
    "_routes.json",
    JSON.stringify(
      {
        version: 1,
        include: ["/*"],
        exclude: ["/assets/*", "/media/*", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/icon-*", "/og.png", "/og-pt-BR.png", "/site.webmanifest"],
      },
      null,
      2,
    ),
  );
  await emit(
    "_redirects",
    `# Generated by scripts/build.ts
/pt       /pt-BR/   301
/pt/      /pt-BR/   301
/pt-br    /pt-BR/   301
/pt-br/   /pt-BR/   301
/en       /         301
/en/      /         301
/download ${config.download.mac} 302
/github   ${config.repo} 302
/docs     ${config.docs.en} 302
`,
  );

  const files = await countFiles(DIST);
  console.log(`site: built ${files} files into dist/ for ${siteUrl} (v${version}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

/**
 * Everyone may crawl everything except the waitlist API. The AI crawlers are listed by name so the
 * intent is explicit (and survives a stricter default someday); each group repeats the rules because a
 * crawler follows only the most specific group that names it.
 */
function robots(siteUrl: string): string {
  const ai = [
    // OpenAI
    "GPTBot", "OAI-SearchBot", "ChatGPT-User",
    // Anthropic
    "ClaudeBot", "Claude-SearchBot", "Claude-User", "anthropic-ai",
    // Perplexity
    "PerplexityBot", "Perplexity-User",
    // Google (Gemini training and grounding) and Apple (Apple Intelligence)
    "Google-Extended", "Applebot-Extended",
    // Common Crawl, Meta, Amazon, ByteDance, Mistral, DuckDuckGo, You.com, Cohere
    "CCBot", "meta-externalagent", "FacebookBot", "Amazonbot", "Bytespider", "MistralAI-User", "DuckAssistBot", "YouBot", "cohere-ai",
  ];
  const search = ["Googlebot", "Bingbot", "Applebot", "DuckDuckBot", "YandexBot", "Baiduspider"];
  const rules = "Allow: /\nDisallow: /api/\n";
  return `# robots.txt for ${siteUrl}
# Kabul is open source (MIT) and this site is public: search engines and AI crawlers are welcome.
# Only the waitlist endpoint (/api/) is off limits.
#
# LLM-friendly versions of this site (https://llmstxt.org):
#   ${siteUrl}/llms.txt         index
#   ${siteUrl}/llms-full.txt    everything in one file
#   ${siteUrl}/index.md         the page as Markdown (Portuguese: ${siteUrl}/pt-BR/index.md)
#
# Content signals (contentsignals.org): search=yes, ai-input=yes, ai-train=yes

User-agent: *
${rules}
# Search engines
${search.map((b) => `User-agent: ${b}`).join("\n")}
${rules}
# AI crawlers and assistants
${ai.map((b) => `User-agent: ${b}`).join("\n")}
${rules}
Sitemap: ${siteUrl}/sitemap.xml
`;
}

function notFound(css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Kabul</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${css}</style>
</head>
<body>
<main id="main" class="section"><div class="wrap">
<h1>Page not found</h1>
<p class="lede">This page doesn't exist. <a href="/">Go to the home page</a>.</p>
<p class="lede" lang="pt-BR">Esta página não existe. <a href="/pt-BR/">Ir para o início</a>.</p>
</div></main>
</body>
</html>
`;
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    n += (await stat(p)).isDirectory() ? await countFiles(p) : 1;
  }
  return n;
}

await main();
