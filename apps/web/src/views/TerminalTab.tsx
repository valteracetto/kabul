import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import type { WebglAddon } from "@xterm/addon-webgl";
import { api, type TermInfo, type Workspace } from "../api";
import { cssVar, effectiveTheme } from "../theme";
import { noSuggest } from "../noSuggest";

/** Paleta ANSI medida (normal/bright) para o tema escuro e o claro. */
const ANSI = {
  dark: { black: "#47423e", red: "#f87272", green: "#4ade80", yellow: "#ffea80", blue: "#61a6fa", magenta: "#e852ff", cyan: "#3ed8ef", white: "#eae8e6", brightBlack: "#a5a09c", brightRed: "#fca6a6", brightGreen: "#85efac", brightYellow: "#fff1ad", brightBlue: "#91c3fd", brightMagenta: "#f08fff", brightCyan: "#7bebf9", brightWhite: "#ffffff" },
  light: { black: "#2c2826", red: "#dc2828", green: "#16a249", yellow: "#ffdc2e", blue: "#2463eb", magenta: "#cb00eb", cyan: "#098dae", white: "#eae8e6", brightBlack: "#766f6b", brightRed: "#ef4343", brightGreen: "#21c45d", brightYellow: "#ffe561", brightBlue: "#3c83f6", brightMagenta: "#e014ff", brightCyan: "#07b6d5", brightWhite: "#f3f2f1" },
};
const termTheme = () => ({ background: cssVar("--panel"), foreground: cssVar("--text"), cursor: cssVar("--text"), selectionBackground: cssVar("--track"), ...ANSI[effectiveTheme()] });

/** Preferências do terminal (Configurações › Aparência e › Avançado), guardadas no aparelho. */
export const termPrefs = () => ({
  family: localStorage.getItem("kabul.term.font") || "",
  size: Math.min(20, Math.max(10, Number(localStorage.getItem("kabul.term.size") ?? "12") || 12)),
  scrollbackMb: Number(localStorage.getItem("kabul.term.scrollback") ?? "10") || 10,
});

/** Sessões que já receberam o comando inicial (a aba remonta, mas o comando roda uma vez). */
const presetSent = new Set<string>();

/**
 * Terminais vivos, por sessão. A aba desmonta (workspace fora da tela), mas o xterm continua: a saída
 * segue chegando no buffer dele e, ao voltar, o mesmo elemento é recolocado na tela, com rolagem e
 * scrollback. Os mais antigos fora da tela são descartados acima do limite (voltam pelo snapshot do tmux).
 * Escrita em lote (um `write` por frame) e renderizador WebGL só enquanto o terminal está na tela
 * (o navegador limita os contextos WebGL).
 */
interface Live { key: string; term: Terminal; fit: FitAddon; search: SearchAddon; el: HTMLDivElement; info: TermInfo; off: () => void; webgl: WebglAddon | null; attached: boolean; used: number; queue: Uint8Array[]; flushing: boolean; onFind: () => void; gpu: boolean; rate: { at: number; bytes: number } }
const live = new Map<string, Live>();
const MAX_TERMS = 12;
let webglOk = true;

function trim() {
  const idle = [...live.values()].filter((l) => !l.attached).sort((a, b) => a.used - b.used);
  while (live.size > MAX_TERMS && idle.length) {
    const l = idle.shift()!;
    l.off();
    l.term.dispose();
    live.delete(l.key);
  }
}

function flush(l: Live) {
  if (l.flushing) return;
  l.flushing = true;
  const go = () => {
    if (!l.flushing) return;
    l.flushing = false;
    const q = l.queue;
    l.queue = [];
    if (!q.length) return;
    // Saída pesada (mais de 256 KB em 2 s): passa para o renderizador WebGL.
    const now = Date.now(), n = q.reduce((a, b) => a + b.length, 0);
    if (now - l.rate.at > 2000) l.rate = { at: now, bytes: 0 };
    if ((l.rate.bytes += n) > 256 * 1024 && l.attached) webgl(l);
    if (q.length === 1) return l.term.write(q[0]);
    const all = new Uint8Array(q.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const c of q) (all.set(c, o), (o += c.length));
    l.term.write(all);
  };
  requestAnimationFrame(go);
  setTimeout(go, 100);
}

function create(key: string, info: TermInfo, ws: Workspace, el: HTMLDivElement, onError: (e: string) => void): Live {
  const p = termPrefs();
  const term = new Terminal({
    fontFamily: `${p.family ? `"${p.family}", ` : ""}Menlo, Monaco, "Courier New", monospace`,
    fontSize: p.size,
    lineHeight: 1.2,
    cursorBlink: true,
    allowProposedApi: true,
    // Scrollback em linhas a partir do limite em MB (~120 bytes por linha).
    scrollback: Math.round((p.scrollbackMb * 1024 * 1024) / 120),
    theme: termTheme(),
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.open(el);
  term.write(info.snapshot);
  const l: Live = { key, term, fit, search, el, info, off: () => {}, webgl: null, attached: false, used: Date.now(), queue: [], flushing: false, onFind: () => {}, gpu: false, rate: { at: 0, bytes: 0 } };
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown" || !e.metaKey) return true;
    if (e.code === "KeyF" && !e.shiftKey) return (e.preventDefault(), l.onFind(), false);
    if (e.code === "KeyK" && !e.shiftKey) return (e.preventDefault(), term.clear(), api.termInput(info.session, info.pane, "\x0c").catch(() => {}), false);
    if (e.code === "KeyR" && !e.shiftKey) return (e.preventDefault(), void api.runScript(ws.id, "run").catch((x) => onError(String(x))), false);
    if (e.code === "KeyB" && e.shiftKey) return (e.preventDefault(), void api.openExternal(`http://localhost:${ws.port}`).catch(() => {}), false);
    return true;
  });
  const retheme = () => (term.options.theme = termTheme());
  window.addEventListener("kabul:theme", retheme);
  const offOut = api.onTerm((d) => {
    if (d.session !== info.session) return;
    l.queue.push(new Uint8Array(d.data));
    flush(l);
  });
  const sub = term.onData((d) => api.termInput(info.session, info.pane, d).catch((e) => onError(String(e))));
  l.off = () => (offOut(), sub.dispose(), window.removeEventListener("kabul:theme", retheme), l.webgl?.dispose());
  live.set(key, l);
  return l;
}

/**
 * Renderizador WebGL nos terminais que precisam: abas de terminal grande (agentes de TUI redesenham a
 * tela toda) e qualquer terminal com saída pesada. Carregado com o app ocioso, depois de o terminal já
 * estar na tela (criar o contexto custa dezenas de ms e não pode atrasar a troca de workspace). Fica
 * com os terminais usados por último (até MAX_GL; o navegador limita os contextos), mesmo fora da tela.
 */
const MAX_GL = 4;
const idle = (f: () => void) => ("requestIdleCallback" in window ? (window as unknown as { requestIdleCallback: (f: () => void, o: { timeout: number }) => void }).requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 300));
function webgl(l: Live) {
  if (!webglOk || l.webgl || localStorage.getItem("kabul.term.webgl") === "0") return;
  idle(async () => {
    if (!l.attached || l.webgl) return;
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      if (!l.attached || l.webgl) return;
      const gl = [...live.values()].filter((x) => x.webgl && x !== l).sort((a, b) => a.used - b.used);
      while (gl.length >= MAX_GL) { const o = gl.shift()!; o.webgl?.dispose(); o.webgl = null; }
      const a = new WebglAddon();
      a.onContextLoss(() => (a.dispose(), l.webgl === a && (l.webgl = null)));
      l.term.loadAddon(a);
      l.webgl = a;
    } catch {
      // Sem WebGL (ou contexto recusado): fica o renderizador DOM.
      webglOk = false;
    }
  });
}

/**
 * Terminal ligado a uma sessão tmux por stream (cliente `tmux -C` no backend): a tela inicial vem
 * de um snapshot e o resto chega como eventos `term-output`. Digitação vai por send-keys -H.
 * Com o foco no terminal: ⌘F busca, ⌘K limpa, ⌘R roda o run script, ⌘⇧B abre o localhost da porta.
 */
export function TerminalTab({ ws, session, visible, initialCommand, gpu = false, onError }: { ws: Workspace; session?: string | null; visible: boolean; initialCommand?: string; gpu?: boolean; onError: (e: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<TermInfo | null>(null);
  const [find, setFind] = useState<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const errRef = useRef(onError);
  errRef.current = onError;

  useEffect(() => {
    let alive = true;
    let cur: Live | null = null;
    let ro: ResizeObserver | null = null;
    const key = session ?? `ws:${ws.id}`;
    const attach = (l: Live) => {
      if (!alive || !host.current) return;
      cur = l;
      l.attached = true;
      l.used = Date.now();
      l.onFind = () => setFind("");
      if (l.el.parentElement !== host.current) host.current.appendChild(l.el);
      termRef.current = l.term;
      searchRef.current = l.search;
      setInfo(l.info);
      const resize = () => {
        try {
          l.fit.fit();
          api.termResize(l.info.session, l.term.cols, l.term.rows).catch(() => {});
        } catch {}
      };
      resize();
      l.term.refresh(0, l.term.rows - 1);
      ro = new ResizeObserver(resize);
      ro.observe(host.current);
      if (gpu) l.gpu = true;
      if (l.gpu) webgl(l);
    };
    const cached = live.get(key);
    if (cached) attach(cached);
    else {
      const el = document.createElement("div");
      el.className = "term-el";
      el.style.height = "100%";
      api.termOpen(ws.id, session ?? null).then((ti) => {
        if (!alive || !host.current) return;
        // Terminal grande com preset: roda o comando escolhido uma vez por sessão.
        if (initialCommand && !presetSent.has(ti.session)) (presetSent.add(ti.session), void api.termInput(ti.session, ti.pane, initialCommand + "\r").catch(() => {}));
        host.current.appendChild(el);
        attach(live.get(key) ?? create(key, ti, ws, el, (e) => errRef.current(e)));
      }, (e) => onError(String(e)));
    }
    return () => {
      alive = false;
      ro?.disconnect();
      if (cur) {
        cur.attached = false;
        cur.used = Date.now();
        cur.onFind = () => {};
        cur.el.remove();
      }
      termRef.current = null;
      trim();
    };
  }, [ws.id, session]);

  /** Manda o que está na tela do terminal para o chat (como texto no composer). */
  const attachToChat = () => {
    const term = termRef.current;
    if (!term) return;
    const buf = term.buffer.active;
    const lines: string[] = [];
    for (let i = Math.max(0, buf.length - 200); i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    const text = lines.join("\n").replace(/\n+$/, "");
    window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: ws.id, text: `${t("code.term.output")}\n\n\`\`\`\n${text.slice(-6000)}\n\`\`\`` } }));
  };

  return (
    <div className="terminal" data-testid="terminal">
      <div className="term-tools">
        <button className="text-btn small" title={t("code.term.attachTitle")} onClick={attachToChat} data-testid="term-attach">{t("code.term.attach")}</button>
        <button className="text-btn small" title={t("code.term.clearTitle")} onClick={() => (termRef.current?.clear(), info && api.termInput(info.session, info.pane, "\x0c").catch(() => {}))} data-testid="term-clear">{t("code.term.clear")}</button>
        <button className="text-btn small" title={t("code.term.findTitle")} onClick={() => setFind("")} data-testid="term-find">{t("common.search")}</button>
      </div>
      {find !== null && (
        <div className="term-find" data-testid="term-find-bar">
          <input autoFocus {...noSuggest} autoComplete="off" value={find} placeholder={t("code.term.findPlaceholder")} onChange={(e) => (setFind(e.target.value), searchRef.current?.findNext(e.target.value))} data-testid="term-find-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.preventDefault(), e.shiftKey ? searchRef.current?.findPrevious(find) : searchRef.current?.findNext(find));
              if (e.key === "Escape") (e.stopPropagation(), setFind(null), searchRef.current?.clearDecorations(), termRef.current?.focus());
            }} />
          <button className="icon-btn" onClick={() => searchRef.current?.findPrevious(find)}>↑</button>
          <button className="icon-btn" onClick={() => searchRef.current?.findNext(find)}>↓</button>
          <button className="icon-btn" onClick={() => (setFind(null), searchRef.current?.clearDecorations())}>×</button>
        </div>
      )}
      <div className="term-host" ref={host} style={{ visibility: visible ? "visible" : "hidden" }} />
    </div>
  );
}
