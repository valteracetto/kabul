// Checks the links of the built site (run after npm run build):
//   node scripts/check-links.ts              internal links, assets and #anchors in dist/
//   node scripts/check-links.ts --external   also asks each external URL for a status (HEAD, then GET)
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const checkExternal = process.argv.includes("--external");

async function htmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await htmlFiles(p)));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile() || (s.isDirectory() && (await exists(join(p, "index.html"))));
  } catch {
    return false;
  }
}

const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const pageFor = (path: string) => join(DIST, path.endsWith("/") ? `${path}index.html` : path);

const problems: string[] = [];
const external = new Set<string>();
let checked = 0;

for (const file of await htmlFiles(DIST)) {
  const html = await readFile(file, "utf8");
  const rel = "/" + file.slice(DIST.length + 1).replace(/index\.html$/, "");
  const urls = [
    ...[...html.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\s(?:srcset|imagesrcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+/)[0])),
  ];
  for (const raw of urls) {
    const url = raw.replace(/&amp;/g, "&");
    if (/^(mailto:|tel:|data:)/.test(url)) continue;
    if (/^https?:\/\//.test(url)) {
      if (!url.startsWith("https://kabul.dev")) external.add(url);
      continue;
    }
    checked++;
    const [path, hash] = url.split("#");
    const target = path === "" ? rel : path;
    if (path && !(await exists(join(DIST, path)))) {
      problems.push(`${rel}: missing ${url}`);
      continue;
    }
    if (hash) {
      const targetHtml = path === "" ? html : await readFile(pageFor(target), "utf8").catch(() => "");
      if (!ids(targetHtml).has(hash)) problems.push(`${rel}: missing anchor ${url}`);
    }
  }
}

// llms.txt (https://llmstxt.org), llms-full.txt, the Markdown pages and robots.txt.
// Links to this site must exist in dist/; links to the repository (raw.githubusercontent.com) and to the
// docs (GitHub Pages) must exist as files in this checkout, so a renamed doc breaks the check.
const ROOT = resolve(DIST, "..", "..");
const RAW = "https://raw.githubusercontent.com/valteracetto/kabul/main/";
const DOCS = "https://valteracetto.github.io/kabul/";
async function textLink(file: string, url: string) {
  checked++;
  if (url.startsWith("https://kabul.dev/")) {
    const path = url.slice("https://kabul.dev".length).split("#")[0];
    if (!(await exists(join(DIST, path)))) problems.push(`${file}: missing ${url}`);
  } else if (url.startsWith(RAW)) {
    if (!(await exists(join(ROOT, url.slice(RAW.length))))) problems.push(`${file}: no such file in the repo: ${url}`);
  } else if (url.startsWith(DOCS)) {
    const page = url.slice(DOCS.length).replace(/\/$/, "/index") || "index";
    if (!(await exists(join(ROOT, "docs", `${page}.md`)))) problems.push(`${file}: no such docs page: ${url}`);
  } else external.add(url);
}
const llms = await readFile(join(DIST, "llms.txt"), "utf8");
{
  const lines = llms.split("\n");
  if (!/^# \S/.test(lines[0])) problems.push("llms.txt: must start with an H1");
  if (!lines.some((l) => l.startsWith("> "))) problems.push("llms.txt: needs a summary blockquote");
  if (lines.slice(1).some((l) => /^# /.test(l))) problems.push("llms.txt: only one H1");
  let section = "";
  for (const l of lines) {
    if (l.startsWith("## ")) section = l;
    else if (section && l.trim() && !/^- \[[^\]]+\]\(https:\/\/[^)\s]+\)(: .+)?$/.test(l)) problems.push(`llms.txt: under "${section}" every line must be "- [name](url): notes", got: ${l}`);
  }
  if (!section) problems.push("llms.txt: needs at least one ## section of links");
}
for (const name of ["llms.txt", "llms-full.txt", "index.md", "pt-BR/index.md"]) {
  const text = await readFile(join(DIST, name), "utf8");
  for (const m of text.matchAll(/https?:\/\/[^\s)<>|`]+/g)) await textLink(name, m[0].replace(/[.,;:]+$/, ""));
}
{
  const robots = await readFile(join(DIST, "robots.txt"), "utf8");
  const known = /^(user-agent|allow|disallow|sitemap|crawl-delay)\s*:/i;
  robots.split("\n").forEach((l, i) => {
    const t = l.trim();
    if (t && !t.startsWith("#") && !known.test(t)) problems.push(`robots.txt:${i + 1}: unknown directive: ${t}`);
  });
  if (!/^Sitemap: https:\/\/kabul\.dev\/sitemap\.xml$/m.test(robots)) problems.push("robots.txt: Sitemap line missing");
  if (!/llms\.txt/.test(robots)) problems.push("robots.txt: should mention llms.txt");
  for (const html of ["index.html", "pt-BR/index.html"])
    if (!(await readFile(join(DIST, html), "utf8")).includes('href="/llms.txt"')) problems.push(`${html}: no <link> to /llms.txt`);
}

console.log(`links: ${checked} internal links checked, ${external.size} distinct external URLs`);

if (checkExternal) {
  for (const url of [...external].sort()) {
    let status = 0;
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (res.status === 405 || res.status === 403) res = await fetch(url, { redirect: "follow" });
      status = res.status;
    } catch {
      status = -1;
    }
    console.log(`  ${status === 200 ? "ok " : String(status).padStart(3)} ${url}`);
  }
} else {
  for (const url of [...external].sort()) console.log(`  ext ${url}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("links: ok");
