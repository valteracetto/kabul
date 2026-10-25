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
