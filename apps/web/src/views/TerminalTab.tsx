import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { api, type Workspace } from "../api";
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

/**
 * Terminal ligado a uma sessão tmux por stream (cliente `tmux -C` no backend): a tela inicial vem
 * de um snapshot e o resto chega como eventos `term-output`. Digitação vai por send-keys -H.
 * Com o foco no terminal: ⌘F busca, ⌘K limpa, ⌘R roda o run script, ⌘⇧B abre o localhost da porta.
 */
export function TerminalTab({ ws, session, visible, onError }: { ws: Workspace; session?: string | null; visible: boolean; onError: (e: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ session: string; pane: string; snapshot: string } | null>(null);
  const [find, setFind] = useState<string | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);

  useEffect(() => {
    let alive = true;
    api.termOpen(ws.id, session ?? null).then((t) => alive && setInfo(t), (e) => onError(String(e)));
    return () => void (alive = false);
  }, [ws.id, session, onError]);

  useEffect(() => {
    if (!info || !host.current) return;
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
    term.open(host.current);
    term.write(info.snapshot);
    termRef.current = term;
    searchRef.current = search;
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.metaKey) return true;
      if (e.code === "KeyF" && !e.shiftKey) return (e.preventDefault(), setFind(""), false);
      if (e.code === "KeyK" && !e.shiftKey) return (e.preventDefault(), term.clear(), api.termInput(info.session, info.pane, "\x0c").catch(() => {}), false);
      if (e.code === "KeyR" && !e.shiftKey) return (e.preventDefault(), void api.runScript(ws.id, "run").catch((x) => onError(String(x))), false);
      if (e.code === "KeyB" && e.shiftKey) return (e.preventDefault(), void api.openExternal(`http://localhost:${ws.port}`).catch(() => {}), false);
      return true;
    });
    const retheme = () => (term.options.theme = termTheme());
    window.addEventListener("kabul:theme", retheme);
    const off = api.onTerm((d) => {
      if (d.session === info.session) term.write(new Uint8Array(d.data));
    });
    const resize = () => {
      try {
        fit.fit();
        api.termResize(info.session, term.cols, term.rows).catch(() => {});
      } catch {}
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host.current);
    const sub = term.onData((d) => api.termInput(info.session, info.pane, d).catch((e) => onError(String(e))));
    return () => {
      off();
      window.removeEventListener("kabul:theme", retheme);
      ro.disconnect();
      sub.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [info, onError]);

  /** Manda o que está na tela do terminal para o chat (como texto no composer). */
  const attach = () => {
    const t = termRef.current;
    if (!t) return;
    const buf = t.buffer.active;
    const lines: string[] = [];
    for (let i = Math.max(0, buf.length - 200); i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
    const text = lines.join("\n").replace(/\n+$/, "");
    window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: ws.id, text: `Saída do terminal:\n\n\`\`\`\n${text.slice(-6000)}\n\`\`\`` } }));
  };

  return (
    <div className="terminal" data-testid="terminal">
      <div className="term-tools">
        <button className="text-btn small" title="Mandar a saída para o chat" onClick={attach} data-testid="term-attach">Mandar ao chat</button>
        <button className="text-btn small" title="Limpar (⌘K)" onClick={() => (termRef.current?.clear(), info && api.termInput(info.session, info.pane, "\x0c").catch(() => {}))} data-testid="term-clear">Limpar</button>
        <button className="text-btn small" title="Buscar (⌘F)" onClick={() => setFind("")} data-testid="term-find">Buscar</button>
      </div>
      {find !== null && (
        <div className="term-find" data-testid="term-find-bar">
          <input autoFocus {...noSuggest} autoComplete="off" value={find} placeholder="Buscar no terminal" onChange={(e) => (setFind(e.target.value), searchRef.current?.findNext(e.target.value))} data-testid="term-find-input"
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
