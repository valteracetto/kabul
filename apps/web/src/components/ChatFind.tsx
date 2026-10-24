import { useEffect, useRef, useState } from "react";
import { noSuggest } from "../noSuggest";

type HL = { set: (k: string, h: unknown) => void; delete: (k: string) => void };
const highlights = (): HL | null => ((globalThis as unknown as { CSS?: { highlights?: HL } }).CSS?.highlights ?? null);
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** Ranges com o texto buscado dentro de `root` (mensagens, raciocínio e ferramentas), sem diferenciar maiúsculas. */
export function findRanges(root: HTMLElement, q: string): Range[] {
  if (!q) return [];
  const out: Range[] = [];
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? "").toLowerCase();
    for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
    }
  }
  return out;
}

/**
 * Busca no chat (⌘F): realça os resultados com a CSS Highlight API (sem mexer no DOM do React),
 * ⌘G / ↵ próximo, ⌘⇧G / ⇧↵ anterior, ⌘⌥J rola até o atual, Esc fecha.
 */
export function ChatFind({ root, scroller, onClose, version }: { root: React.RefObject<HTMLElement | null>; scroller: React.RefObject<HTMLElement | null>; onClose: () => void; version: number }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [count, setCount] = useState(0);
  const ranges = useRef<Range[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const show = (k: number) => {
    const r = ranges.current[k];
    const hl = highlights();
    if (hl && Highlight) {
      hl.set("kabul-find", new Highlight(...ranges.current));
      if (r) hl.set("kabul-find-current", new Highlight(r));
      else hl.delete("kabul-find-current");
    }
    if (r && scroller.current) {
      const box = r.getBoundingClientRect(), sb = scroller.current.getBoundingClientRect();
      if (box.top < sb.top + 40 || box.bottom > sb.bottom - 40) scroller.current.scrollTop += box.top - sb.top - sb.height / 2;
    }
  };
  useEffect(() => {
    ranges.current = root.current ? findRanges(root.current, q.trim()) : [];
    setCount(ranges.current.length);
    const k = Math.min(i, Math.max(0, ranges.current.length - 1));
    setI(k);
    show(k);
  }, [q, version]);
  useEffect(() => () => (highlights()?.delete("kabul-find"), highlights()?.delete("kabul-find-current")), []);
  const step = (d: number) => {
    if (!count) return;
    const k = (i + d + count) % count;
    setI(k);
    show(k);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.code === "KeyG") (e.preventDefault(), stepRef.current(e.shiftKey ? -1 : 1));
      else if (e.metaKey && e.altKey && e.code === "KeyJ") (e.preventDefault(), stepRef.current(0));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="chat-find" data-testid="chat-find">
      <input ref={input} {...noSuggest} autoComplete="off" placeholder="Buscar nas mensagens e no raciocínio" value={q} onChange={(e) => (setQ(e.target.value), setI(0))} data-testid="chat-find-input"
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), onClose());
          if (e.key === "Enter") (e.preventDefault(), step(e.shiftKey ? -1 : 1));
        }} />
      <span className="dim small" data-testid="chat-find-count">{q ? (count ? `${i + 1}/${count}` : "0/0") : ""}</span>
      <button className="icon-btn" title="Anterior (⌘⇧G)" onClick={() => step(-1)} disabled={!count}>↑</button>
      <button className="icon-btn" title="Próximo (⌘G)" onClick={() => step(1)} disabled={!count}>↓</button>
      <button className="icon-btn" title="Fechar (Esc)" onClick={onClose}>×</button>
    </div>
  );
}
