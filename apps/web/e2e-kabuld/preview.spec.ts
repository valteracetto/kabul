import { test, expect, type Page } from "../playwright-silencio";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { freePort, startKabuld, tmux, wsAction, type Kabuld } from "./helpers";

// iPhone (WebKit) contra o kabuld real: preview de arquivos do workspace, abrir arquivo a partir do
// chat, "perguntar no chat" e o app do workspace pelo proxy do Run.
let kd: Kabuld;
let app: Server;
let wsPort: number;
// Sessão própria no workspace (prefixo fora do `kabul-test-kd-`, que outros E2E na mesma máquina limpam
// ao terminar): garante o grupo "Login novo" na lista.
const own = `kabul-test-pv-${Math.random().toString(36).slice(2, 7)}`;

test.beforeAll(async () => {
  wsPort = await freePort();
  kd = await startKabuld({ trustLocalBrowser: false, wsPort });
  const w = kd.wsPath;
  mkdirSync(join(w, "src"), { recursive: true });
  mkdirSync(join(w, "docs"), { recursive: true });
  mkdirSync(join(w, "img"), { recursive: true });
  writeFileSync(join(w, "src/main.rs"), 'fn main() {\n    // ponto de entrada\n    let nome = "Kabul";\n    println!("oi, {nome}");\n}\n');
  writeFileSync(join(w, "README.md"), "# Projeto exemplo\n\nVeja o [guia](docs/guia.md) e o `src/main.rs`.\n\n- item um\n- item dois\n");
  writeFileSync(join(w, "docs/guia.md"), "# Guia de uso\n\nTexto do guia.\n");
  writeFileSync(join(w, "dados.csv"), 'nome,cidade,nota\nAna,"Lisboa, PT",10\nBia,Porto,9\n');
  writeFileSync(join(w, "dados.json"), JSON.stringify({ projeto: "exemplo", versao: 2, tags: ["a", "b"], dono: { nome: "Ana" } }));
  writeFileSync(join(w, "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><script>alert(1)</script><rect width='40' height='40' fill='red'/></svg>");
  copyFileSync(resolve(process.cwd(), "public/icon-192.png"), join(w, "img/icone.png"));
  writeFileSync(join(w, "manual.pdf"), "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  writeFileSync(join(w, "pacote.dat"), Buffer.from(Array.from({ length: 3000 }, (_, i) => i % 256)));
  writeFileSync(join(w, "grande.log"), Array.from({ length: 40000 }, (_, i) => `linha ${i + 1} do log`).join("\n") + "\n");
  // Mudança num arquivo rastreado (aparece em Alterações).
  writeFileSync(join(w, "a.txt"), "oi\nnovo conteúdo\n");
  // "App" do workspace rodando na porta dele.
  app = createServer((req, res) => res.end(`app do workspace em ${req.url}`)).listen(wsPort, "127.0.0.1");
  tmux("new-session", "-d", "-s", own, "-c", w, "sh");
  await new Promise((r) => setTimeout(r, 2500));
});
test.afterAll(() => {
  try {
    tmux("kill-session", "-t", `=${own}`);
  } catch {}
  app?.close();
  kd?.stop();
});

const shot = (page: Page, name: string) => page.screenshot({ path: `../../.context/e2e/preview-${name}.png` });

// Uma credencial (o QR é de uso único), posta no aparelho antes de cada teste.
let cred: { device: string; key: string } | null = null;
async function pairPhone(page: Page) {
  if (!cred) {
    const token = new URL(kd.pairLink).hash.match(/pair=([^&]+)/)![1];
    const r = await fetch(`${kd.base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, user: "Ana", device: "iPhone" }) });
    const v = (await r.json()).value;
    cred = { device: v.device.id, key: v.key };
  }
  await page.addInitScript((c) => localStorage.setItem("kabul.cred", JSON.stringify(c)), cred);
  await page.goto(`${kd.base}/m/`);
  await expect(page.getByTestId("m-list")).toBeVisible();
}

const openFromTree = async (page: Page, path: string) => {
  await page.getByTestId("pv-search").fill(path.split("/").pop()!);
  await page.locator(`[data-testid="pv-results"] [data-path="${path}"]`).click();
  await expect(page.getByTestId("pv-title")).toHaveText(path.split("/").pop()!);
};

test("árvore com busca e preview de cada tipo: código, Markdown, CSV, JSON, SVG, imagem com pinça, PDF, binário, arquivo grande em páginas", async ({ page, request }) => {
  await pairPhone(page);
  await wsAction(page, "Login novo", "m-files");
  await expect(page.getByTestId("pv-screen")).toBeVisible();
  await expect(page.getByTestId("pv-title")).toHaveText("Login novo");

  // Árvore: pastas recolhidas; abrir src e o arquivo.
  const tree = page.getByTestId("pv-tree");
  await expect(tree.locator('[data-testid="pv-dir"][data-path="src"]')).toBeVisible();
  await tree.locator('[data-testid="pv-dir"][data-path="src"]').click();
  await expect(tree.locator('[data-path="src/main.rs"]')).toBeVisible();
  await expect(tree.locator('[data-path="a.txt"] .pv-dot')).toBeVisible();
  await shot(page, "arvore");
  await tree.locator('[data-path="src/main.rs"]').click();
  const code = page.getByTestId("pv-code");
  await expect(code.locator('[data-line="1"] .pv-ln')).toHaveText("1");
  await expect(code.locator('[data-line="1"] .hl-kw').first()).toHaveText("fn");
  await expect(code.locator('[data-line="3"] .hl-str')).toHaveText('"Kabul"');
  await expect(page.getByTestId("pv-size")).toContainText("5 linhas");
  await shot(page, "codigo");
  await page.getByTestId("pv-back").click();

  // Busca e Markdown renderizado; link relativo abre o outro arquivo.
  await openFromTree(page, "README.md");
  await expect(page.getByTestId("pv-markdown").locator(".md-h1")).toHaveText("Projeto exemplo");
  await page.getByTestId("pv-markdown").getByText("guia", { exact: true }).click();
  await expect(page.getByTestId("pv-title")).toHaveText("guia.md");
  await expect(page.getByTestId("pv-markdown")).toContainText("Texto do guia.");
  await page.getByTestId("pv-mode-source").click();
  await expect(page.getByTestId("pv-code")).toContainText("# Guia de uso");
  await page.getByTestId("pv-back").click();
  await expect(page.getByTestId("pv-title")).toHaveText("README.md");
  await page.getByTestId("pv-back").click();

  // CSV em tabela (com aspas) e JSON em árvore.
  await openFromTree(page, "dados.csv");
  await expect(page.getByTestId("pv-csv-count")).toHaveText("2 linhas · 3 colunas");
  await expect(page.getByTestId("pv-csv").locator("tbody tr").first()).toContainText("Lisboa, PT");
  await page.getByTestId("pv-back").click();
  await openFromTree(page, "dados.json");
  await expect(page.getByTestId("pv-json")).toContainText("projeto");
  await expect(page.getByTestId("pv-json")).toContainText('"exemplo"');
  await page.getByTestId("pv-back").click();

  // SVG num <img> (não roda script) e servido com CSP sandbox.
  await openFromTree(page, "logo.svg");
  const svg = page.getByTestId("pv-image");
  await expect(svg).toBeVisible();
  const svgUrl = (await svg.getAttribute("src"))!;
  const r = await request.get(new URL(svgUrl, kd.base).toString());
  expect(r.headers()["content-security-policy"]).toContain("sandbox");
  expect(r.headers()["content-type"]).toBe("image/svg+xml");
  await page.getByTestId("pv-back").click();

  // Imagem: pinça amplia só a imagem; dois toques voltam a 1×.
  await openFromTree(page, "img/icone.png");
  const zoom = page.getByTestId("pv-zoom");
  await expect(page.getByTestId("pv-image")).toBeVisible();
  await expect(zoom).toHaveAttribute("data-scale", "1.00");
  await zoom.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const ev = (type: string, id: number, x: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: cy, bubbles: true, pointerType: "touch", isPrimary: id === 1 }));
    ev("pointerdown", 1, r.left + 100);
    ev("pointerdown", 2, r.left + 150);
    ev("pointermove", 2, r.left + 200);
    ev("pointermove", 2, r.left + 250);
    ev("pointerup", 2, r.left + 250);
    ev("pointerup", 1, r.left + 100);
  });
  expect(Number(await zoom.getAttribute("data-scale"))).toBeGreaterThan(2.5);
  await shot(page, "imagem-pinca");
  await zoom.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const ev = (type: string) => el.dispatchEvent(new PointerEvent(type, { pointerId: 3, clientX: r.left + 50, clientY: r.top + 50, bubbles: true, pointerType: "touch", isPrimary: true }));
    ev("pointerdown"), ev("pointerup"), ev("pointerdown"), ev("pointerup");
  });
  await expect(zoom).toHaveAttribute("data-scale", "1.00");
  await page.getByTestId("pv-back").click();

  // PDF: abre no visualizador do sistema; binário: tamanho e baixar.
  await openFromTree(page, "manual.pdf");
  await expect(page.getByTestId("pv-open")).toHaveAttribute("href", /\/api\/file\?t=/);
  await page.getByTestId("pv-back").click();
  await openFromTree(page, "pacote.dat");
  await expect(page.getByTestId("pv-card-size")).toContainText("2.9 KB");
  await expect(page.getByTestId("pv-download")).toHaveAttribute("download", "pacote.dat");
  await page.getByTestId("pv-back").click();

  // Arquivo grande: primeira página e "Carregar mais".
  await openFromTree(page, "grande.log");
  await expect(page.getByTestId("pv-code").locator('[data-line="1"]')).toContainText("linha 1 do log");
  await expect(page.getByTestId("pv-more")).toBeVisible();
  const before = await page.getByTestId("pv-code").locator(".pv-line").count();
  expect(before).toBeLessThan(40000);
  // Chegar perto do fim carrega a próxima página (o botão faz o mesmo).
  await page.getByTestId("pv-more").scrollIntoViewIfNeeded();
  await expect.poll(() => page.getByTestId("pv-code").locator(".pv-line").count()).toBeGreaterThan(before);
  await shot(page, "grande");
});

test("chat: caminho citado abre o preview, chips de alterados abrem o diff, perguntar sobre um trecho manda ao chat", async ({ page }) => {
  await pairPhone(page);
  await wsAction(page, "Login novo", "m-new-chat");
  await page.getByTestId("m-model").filter({ has: page.locator('[data-agent="claude"]') }).first().click();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await page.getByTestId("m-chat-input").fill("olhe `src/main.rs:3` e `README.md`");
  await page.getByTestId("m-chat-send").click();
  const reply = page.getByTestId("m-msg-agent").filter({ hasText: "eco:" });
  await expect(reply).toBeVisible();

  // Caminho com pasta (link do Markdown) com a linha; arquivo da raiz marcado pelo preview.
  await reply.locator(".md-file").click();
  await expect(page.getByTestId("pv-title")).toHaveText("main.rs");
  await expect(page.locator('[data-line="3"]')).toHaveClass(/sel/);
  await page.getByTestId("pv-back").click();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await reply.locator('code[data-kabul-file="README.md"]').click();
  await expect(page.getByTestId("pv-markdown")).toContainText("Projeto exemplo");
  await page.getByTestId("pv-back").click();

  // Chip do arquivo alterado → diff estreito com quebra de linha.
  await page.getByTestId("pv-chips").locator('[data-path="a.txt"]').click();
  const diff = page.getByTestId("pv-diff");
  await expect(diff.locator('.pv-dl[data-kind="a"]')).toContainText("novo conteúdo");
  await expect(diff.locator('.pv-dl[data-kind="c"]')).toContainText("oi");
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(width, "sem rolagem para o lado no diff").toBe(true);
  await shot(page, "diff");

  // Perguntar sobre a linha adicionada.
  await diff.locator('.pv-dl[data-kind="a"] .pv-ln').click();
  await page.getByTestId("pv-ask").click();
  await expect(page.getByTestId("pv-ask-sheet")).toBeVisible();
  await page.getByTestId("pv-ask-text").fill("por que mudou?");
  await page.getByTestId("pv-ask-send").click();
  await expect(page.getByTestId("m-chat")).toBeVisible();
  await expect(page.getByTestId("m-msg-user").last()).toContainText("Sobre `a.txt:2`");
  await expect(page.getByTestId("m-msg-agent").last()).toContainText("por que mudou?");
  await shot(page, "perguntou");
});

test("Alterações e o app do workspace pelo proxy do Run (outro endereço, só portas do workspace)", async ({ page }) => {
  await pairPhone(page);
  await wsAction(page, "Login novo", "m-files");
  await page.getByTestId("pv-tab-changes").click();
  await expect(page.getByTestId("pv-change").filter({ hasText: "a.txt" })).toBeVisible();
  await page.getByTestId("pv-scope-branch").click();
  await expect(page.getByTestId("pv-no-changes")).toBeVisible();
  await page.getByTestId("pv-scope-all").click();
  await page.getByTestId("pv-change").filter({ hasText: "a.txt" }).click();
  await expect(page.getByTestId("pv-diff")).toContainText("novo conteúdo");
  await page.getByTestId("pv-back").click();

  await page.getByTestId("pv-tab-app").click();
  const port = page.locator(`[data-testid="pv-port"][data-port="${wsPort}"]`);
  await expect(port).toHaveAttribute("data-listening", "true");
  // Porta do workspace sem nada no ar: confere no sistema (a máquina pode ter outro processo numa vizinha).
  const free = (p: number) => new Promise<boolean>((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(p, "127.0.0.1", () => s.close(() => r(true))); });
  let idle = 0;
  for (const p of [2, 3, 4, 5, 6, 7, 8, 9].map((i) => wsPort + i)) if (p !== kd.port && (await free(p))) { idle = p; break; }
  expect(idle, "alguma porta do workspace livre").toBeGreaterThan(0);
  await expect(page.locator(`[data-testid="pv-port"][data-port="${idle}"]`)).toHaveAttribute("data-listening", "false");
  await shot(page, "app");
  const [popup] = await Promise.all([page.waitForEvent("popup"), port.getByTestId("pv-port-open").click()]);
  await expect(popup.locator("body")).toContainText("app do workspace em /", { timeout: 15_000 });
  const u = new URL(popup.url());
  expect(u.port).not.toBe(String(kd.port));
  expect(u.port).not.toBe(String(wsPort));
  await popup.close();
});

test("Navegador do Kabul no celular: captura da página ao vivo, só leitura", async ({ page }) => {
  // O navegador do workspace aberto pelo CLI (mesmo estado do app): o kabuld só lê. Assíncrono: a
  // página é servida por este mesmo processo (o "app" do workspace) e um exec síncrono travaria o servidor.
  const root = resolve(process.cwd(), "../..");
  execFileSync("cargo", ["build", "-p", "kabul-cli"], { cwd: root, stdio: "inherit" });
  const run = promisify(execFile);
  const kabul = (...a: string[]) => run(join(root, "target/debug/kabul"), ["browser", ...a, "--home", join(kd.dir, "home"), "--workspace", "w1"]);
  try {
    await kabul("open", `http://127.0.0.1:${wsPort}/pagina-um`);
  } catch (e) {
    test.skip(String((e as { stderr?: string }).stderr ?? e).includes("Nenhum Chrome"), "sem Chrome/Chromium nesta máquina");
    throw e;
  }
  try {
    await pairPhone(page);
    await wsAction(page, "Login novo", "m-files");
    await page.getByTestId("pv-tab-browser").click();
    await expect(page.getByTestId("pv-browser-img")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("pv-browser-url")).toContainText("/pagina-um");
    // Sem controles de navegação nem entrada: só a imagem.
    await expect(page.getByTestId("pv-browser").locator("input, button")).toHaveCount(0);
    await shot(page, "navegador");
    // A página muda no computador; o celular acompanha.
    await kabul("open", `http://127.0.0.1:${wsPort}/pagina-dois`);
    await expect(page.getByTestId("pv-browser-url")).toContainText("/pagina-dois", { timeout: 10_000 });
    await kabul("stop");
    await expect(page.getByTestId("pv-browser-closed")).toBeVisible({ timeout: 10_000 });
  } finally {
    await kabul("stop").catch(() => {});
  }
});
