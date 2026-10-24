import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api, type Workspace } from "../api";
import { cssVar } from "../theme";

const termTheme = () => ({ background: cssVar("--panel"), foreground: cssVar("--text"), cursor: cssVar("--text"), selectionBackground: cssVar("--track") });

/**
 * Terminal ligado a uma sessão tmux por stream (cliente `tmux -C` no backend): a tela inicial vem
 * de um snapshot e o resto chega como eventos `term-output`. Digitação vai por send-keys -H.
 */
export function TerminalTab({ ws, session, visible, onError }: { ws: Workspace; session?: string | null; visible: boolean; onError: (e: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<{ session: string; pane: string; snapshot: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api.termOpen(ws.id, session ?? null).then((t) => alive && setInfo(t), (e) => onError(String(e)));
    return () => void (alive = false);
  }, [ws.id, session, onError]);

  useEffect(() => {
    if (!info || !host.current) return;
    const term = new Terminal({
      fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: termTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    term.write(info.snapshot);
    const retheme = () => (term.options.theme = termTheme());
    window.addEventListener("kabul:theme", retheme);
    const off = api.onTerm((p) => {
      if (p.session === info.session) term.write(new Uint8Array(p.data));
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
    };
  }, [info, onError]);

  return (
    <div className="terminal" data-testid="terminal">
      <div className="term-host" ref={host} style={{ visibility: visible ? "visible" : "hidden" }} />
    </div>
  );
}
