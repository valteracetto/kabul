import { test, expect, type Page, type CDPSession } from "../playwright-silencio";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Desempenho em escala (plano › Desempenho e ESCALA): 100 workspaces, 30 agentes de carga emitindo
 * eventos sem parar e uma conversa salva de 2.000 mensagens. Mede tempo até a tela útil, CPU ocioso e
 * sob carga, troca de workspace, latência de digitação no composer, abrir e rolar a conversa longa,
 * heap e nós do DOM, e o tamanho do JS inicial. Compara com perf-budgets.json e reprova o que passar.
 */
const here = dirname(fileURLToPath(import.meta.url));
const budgets: Record<string, number> = JSON.parse(readFileSync(join(here, "../perf-budgets.json"), "utf8"));
const AGENTS = Number(process.env.KABUL_PERF_AGENTS ?? 30);

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0; };
const r1 = (n: number) => Math.round(n * 10) / 10;

async function cpu(cdp: CDPSession, ms: number) {
  const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const a = await m();
  await new Promise((r) => setTimeout(r, ms));
  const b = await m();
  return ((b.TaskDuration - a.TaskDuration) / ((b.Timestamp - a.Timestamp) || ms / 1000)) * 100;
}

/** Clica na linha do workspace e espera a tela dele (título no topo e composer) pintada. */
async function switchTo(page: Page, id: string, title: string) {
  return page.evaluate(async ([id, title]) => {
    const row = document.querySelector<HTMLElement>(`[data-testid=ws-row][data-ws="${id}"]`)!;
    row.scrollIntoView({ block: "nearest" });
    const t0 = performance.now();
    row.click();
    const ok = () => {
      const h = document.querySelector(".ws-host:not([hidden])");
      return h?.querySelector(".crumb-title")?.textContent === title && h.querySelector("[data-testid=composer]");
    };
    await new Promise<void>((res) => { const loop = () => (ok() ? res() : requestAnimationFrame(loop)); loop(); });
    // Próximo frame pintado.
    await new Promise<void>((res) => requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); }));
    return performance.now() - t0;
  }, [id, title] as const);
}

test("escala: 100 workspaces, 30 agentes, conversa de 2.000 mensagens", async ({ page }) => {
  if (process.env.KABUL_PERF_NOWEBGL) await page.addInitScript(() => ((window as any).__noWebgl = 1));
  await page.addInitScript(() => {
    const w = window as any;
    if ((w as any).__noWebgl) localStorage.setItem("kabul.term.webgl", "0");
    w.__kabulSeed = { repos: 5, workspaces: 100, longChat: 2000, agents: 30, agentHistory: 300 };
    // Tela útil: barra lateral com os 100 workspaces e a tela inicial, no frame pintado.
    const obs = new MutationObserver(() => {
      if (w.__ttu || document.querySelectorAll("[data-testid=ws-row]").length < 100 || !document.querySelector(".home")) return;
      obs.disconnect();
      requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => (w.__ttu = performance.now()); ch.port2.postMessage(0); });
    });
    document.addEventListener("DOMContentLoaded", () => obs.observe(document.documentElement, { childList: true, subtree: true }));
    // Latência por tecla no composer: do evento (timeStamp) até depois do próximo frame.
    w.__keys = [];
    // Contador de renders (como o React DevTools faz, também no build de produção): componentes que
    // renderizaram em cada commit. Só conta durante a janela medida (percorrer a árvore custa).
    w.__rc = { on: false, commits: 0, renders: 0 };
    const visit = (f: any) => {
      for (let c = f; c; c = c.sibling) {
        if ((c.tag === 0 || c.tag === 1 || c.tag === 11 || c.tag === 14 || c.tag === 15) && (c.flags & 1)) w.__rc.renders++;
        // Subárvore reaproveitada sem trabalho (mesmo filho do commit anterior): ninguém ali renderizou.
        if (c.child && !(c.alternate && c.alternate.child === c.child)) visit(c.child);
      }
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject: () => 1, checkDCE: () => {}, onScheduleFiberRoot: () => {}, onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {}, setStrictMode: () => {},
      onCommitFiberRoot: (_id: number, root: any) => { if (!w.__rc.on) return; w.__rc.commits++; visit(root.current.child); },
    };
    addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.dataset?.testid !== "composer" || !w.__measureKeys) return;
      const t0 = e.timeStamp;
      requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => w.__keys.push(performance.now() - t0); ch.port2.postMessage(0); });
    }, true);
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const out: Record<string, number> = {};

  // 1) Tempo até a tela útil.
  await page.goto("/?mock");
  await page.waitForFunction(() => (window as any).__ttu, null, { timeout: 30_000 });
  out.ttu_ms = Math.round(await page.evaluate(() => (window as any).__ttu));

  // 2) CPU com tudo ocioso (100 workspaces, nenhum agente).
  await page.waitForTimeout(1500);
  out.idle_cpu_pct = r1(await cpu(cdp, 4000));

  // 3) 30 agentes de carga, cada um no seu workspace.
  for (let i = 1; i <= AGENTS; i++) {
    await switchTo(page, `w${i}`, `Tarefa ${i}`);
    const c = host(page).getByTestId("composer");
    await c.fill(`carga ${i}`);
    await c.press("Enter");
    await expect(host(page).getByTestId("stop")).toBeVisible({ timeout: 20_000 });
  }
  await page.waitForTimeout(1500);
  out.load_cpu_pct = r1(await cpu(cdp, 5000));
  // Fluidez com os agentes emitindo (tela de um agente visível): frames por segundo e frames longos.
  const lf: number[] = await page.evaluate(() => new Promise<number[]>((res) => {
    const fs: number[] = [];
    let last = performance.now();
    const t0 = last;
    const step = (t: number) => (fs.push(t - last), (last = t), t - t0 < 3000 ? requestAnimationFrame(step) : res(fs.slice(1)));
    requestAnimationFrame(step);
  }));
  out.load_fps = r1(lf.length / (lf.reduce((a, b) => a + b, 0) / 1000));
  out.load_jank_pct = r1((lf.filter((f) => f > 25).length / lf.length) * 100);
  // Re-render em cascata: commits e componentes renderizados por segundo com os agentes emitindo.
  const rc = await page.evaluate(async () => {
    const w = window as any;
    Object.assign(w.__rc, { on: true, commits: 0, renders: 0 });
    await new Promise((r) => setTimeout(r, 3000));
    w.__rc.on = false;
    return { commits: w.__rc.commits / 3, renders: w.__rc.renders / 3 };
  });
  out.load_commits_per_s = r1(rc.commits);
  out.load_renders_per_s = Math.round(rc.renders);

  // 4) Troca de workspace com os agentes rodando (idas e voltas entre workspaces com e sem agente).
  const times: number[] = [];
  for (let k = 0; k < 20; k++) {
    const id = k % 2 ? 1 + ((k * 3) % AGENTS) : 31 + (k % 10);
    times.push(await switchTo(page, `w${id}`, `Tarefa ${id}`));
  }
  out.switch_p50_ms = Math.round(pct(times, 50));
  out.switch_p95_ms = Math.round(pct(times, 95));

  // 5) Digitação no composer com os agentes rodando.
  const comp = host(page).getByTestId("composer");
  await comp.click();
  await page.evaluate(() => ((window as any).__measureKeys = true));
  await page.keyboard.type("ajuste o formulário de login e rode os testes", { delay: 35 });
  const keys: number[] = await page.evaluate(() => ((window as any).__measureKeys = false, (window as any).__keys));
  out.typing_p95_ms = r1(pct(keys, 95));
  out.typing_max_ms = r1(Math.max(...keys));
  await comp.fill("");

  // 6) Conversa de 2.000 mensagens: abrir e rolar.
  out.long_chat_open_ms = Math.round(await page.evaluate(async () => {
    const row = document.querySelector<HTMLElement>(`[data-testid=ws-row][data-ws="w0"]`)!;
    row.scrollIntoView({ block: "nearest" });
    const t0 = performance.now();
    row.click();
    const ok = () => document.querySelector(".ws-host:not([hidden]) .crumb-title")?.textContent === "Tarefa 0" && document.querySelectorAll(".ws-host:not([hidden]) .center-body:not([hidden]) .msg-assistant").length > 0;
    await new Promise<void>((res) => { const loop = () => (ok() ? res() : requestAnimationFrame(loop)); loop(); });
    await new Promise<void>((res) => requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); }));
    return performance.now() - t0;
  }));
  const frames: number[] = await page.evaluate(async () => {
    const sc = document.querySelector<HTMLElement>(".ws-host:not([hidden]) .center-body:not([hidden]) .messages")!;
    sc.scrollTop = sc.scrollHeight;
    await new Promise((r) => setTimeout(r, 400));
    const fs: number[] = [];
    let last = performance.now(), dir = -1;
    const t0 = last;
    return new Promise<number[]>((res) => {
      const step = (t: number) => {
        fs.push(t - last);
        last = t;
        sc.scrollTop += dir * 250;
        if (sc.scrollTop <= 0) dir = 1;
        if (t - t0 < 4000) requestAnimationFrame(step);
        else res(fs.slice(1));
      };
      requestAnimationFrame(step);
    });
  });
  out.scroll_fps_min = r1(frames.length / (frames.reduce((a, b) => a + b, 0) / 1000));
  out.scroll_jank_pct = r1((frames.filter((f) => f > 25).length / frames.length) * 100);

  // 7) Memória e DOM depois de tudo (com os 30 agentes ainda rodando).
  await cdp.send("HeapProfiler.collectGarbage");
  out.heap_mb = r1((await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576);
  out.dom_nodes = await page.evaluate(() => document.getElementsByTagName("*").length);

  // 8) JS inicial (gzip) do build de produção.
  const dist = join(here, "../dist");
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const main = /<script[^>]+src="\/?([^"]+\.js)"/.exec(html)![1];
  out.main_js_kb_gz = r1(gzipSync(readFileSync(join(dist, main))).length / 1024);

  // Relatório: tabela no console e JSON em .context/perf/.
  const rows = Object.entries(out).map(([k, v]) => ({ métrica: k, valor: v, orçamento: budgets[k], ok: budgets[k] == null || (/fps/.test(k) ? v >= budgets[k] : v <= budgets[k]) }));
  console.table(rows);
  const dir = join(here, "../../../.context/perf");
  mkdirSync(dir, { recursive: true });
  const rec = { at: new Date().toISOString(), label: process.env.KABUL_PERF_LABEL ?? null, agents: AGENTS, metrics: out, switch_ms: times.map(Math.round), keys_ms: keys.map(r1) };
  writeFileSync(join(dir, `resultado${process.env.KABUL_PERF_LABEL ? "-" + process.env.KABUL_PERF_LABEL : ""}.json`), JSON.stringify(rec, null, 2));
  expect(errors, "erros na página").toEqual([]);
  const bad = rows.filter((r) => !r.ok);
  expect(bad, `Fora do orçamento: ${bad.map((b) => `${b.métrica}=${b.valor} (limite ${b.orçamento})`).join(", ")}`).toEqual([]);
});
