import { useCallback, useEffect, useRef, useState } from "react";
import { Floating } from "./Floating";
import { useDismiss } from "./useDismiss";
import { api, type OpenTarget } from "../api";
import { IChevronDown, ICopy } from "../icons";

let cache: Promise<OpenTarget[]> | null = null;
const KEY = "kabul.openIn.last";

function AppIcon({ t, size = 18 }: { t: OpenTarget | undefined; size?: number }) {
  if (t?.icon) return <img src={t.icon} width={size} height={size} alt="" draggable={false} />;
  // Sem ícone (navegador/mock): quadrado com a inicial.
  return <span className="app-fallback" style={{ width: size, height: size }}>{t?.name[0] ?? "?"}</span>;
}

/** Botão dividido "Abrir em": abre no último app usado; o menu lista os apps detectados, com atalhos 1…N e ⌘O. */
export function OpenIn({ path, onError }: { path: string; onError: (e: string) => void }) {
  const [targets, setTargets] = useState<OpenTarget[]>([]);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState(() => localStorage.getItem(KEY) ?? "finder");
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (cache ??= api.openTargets()).then(setTargets, (e) => ((cache = null), onError(String(e))));
  }, [onError]);

  const run = (id: string) => {
    setOpen(false);
    if (id === "copy") {
      navigator.clipboard.writeText(path).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)));
      return;
    }
    localStorage.setItem(KEY, id);
    setLast(id);
    api.openIn(id, path).catch((e) => onError(String(e)));
  };
  const items = [...targets.map((t) => t.id), "copy"];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "o" && root.current?.offsetParent) {
        e.preventDefault();
        setOpen(true);
      } else if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "o" && root.current?.offsetParent) {
        e.preventDefault();
        run(localStorage.getItem("kabul.openIn.default") || last || "finder");
      } else if (open && /^[1-9]$/.test(e.key) && items[Number(e.key) - 1]) {
        e.preventDefault();
        run(items[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, items.join(), path]);
  useDismiss(root, open, useCallback(() => setOpen(false), []));

  const lastT = targets.find((t) => t.id === last) ?? targets[0];
  return (
    <div className="open-in" ref={root} data-testid="open-in">
      <div className="split-btn">
        <button className="btn icon-only" title={lastT ? `Abrir em ${lastT.name}` : "Abrir"} onClick={() => lastT && run(lastT.id)}>{copied ? <span className="ok small">✓</span> : <AppIcon t={lastT} />}</button>
        <button className="btn caret-btn" title="Abrir em…" onClick={() => setOpen(!open)} data-testid="open-in-menu"><IChevronDown size={12} /></button>
      </div>
      {open && (
        <Floating className="open-pop" placement="bottom-end">
          {targets.map((t, i) => (
            <div key={t.id} className={"pop-row" + (t.id === last ? " on" : "")} onClick={() => run(t.id)}>
              <AppIcon t={t} size={20} /><span className="label">{t.name}</span><span className="grow" />
              {t.id === (localStorage.getItem("kabul.openIn.default") || last) && <span className="kbd-hint">⌘O</span>}<span className="num">{i + 1}</span>
            </div>
          ))}
          <div className="pop-row" onClick={() => run("copy")}>
            <span className="app-glyph"><ICopy size={17} /></span><span className="label">Copiar caminho</span><span className="grow" /><span className="num">{targets.length + 1}</span>
          </div>
        </Floating>
      )}
    </div>
  );
}
