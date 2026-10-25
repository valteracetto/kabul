import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Primeiro ancestral que rola (raiz do IntersectionObserver: a margem de pré-desenho vale dentro dele). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * Virtualização por blocos para listas longas de altura variável (diff, arquivo, árvore, alterações):
 * só os blocos perto da área visível são desenhados; os outros viram um espaço com a altura medida
 * (ou estimada), então a barra de rolagem e a posição continuam certas. `pin` mantém blocos sempre
 * desenhados (ex.: o que tem a linha pedida ou um comentário).
 */
export function LazyChunks({ count, chunk = 200, rowPx, render, pin = [], margin = 1200, table = 0 }: { count: number; chunk?: number; rowPx: number; render: (start: number, end: number) => ReactNode; pin?: number[]; margin?: number; /** Dentro de <table>: cada bloco é um <tbody> (com este número de colunas). */ table?: number }) {
  const n = Math.ceil(count / chunk);
  const [shown, setShown] = useState<Set<number>>(() => new Set([0, 1, n - 1].filter((c) => c >= 0 && c < n)));
  const heights = useRef(new Map<number, number>());
  const els = useRef(new Map<number, HTMLDivElement>());
  const box = useRef<HTMLDivElement>(null);
  const io = useRef<IntersectionObserver | null>(null);
  useLayoutEffect(() => {
    if (n <= 2) return;
    const obs = new IntersectionObserver((entries) => {
      setShown((s) => {
        let next: Set<number> | null = null;
        for (const e of entries) {
          const c = Number((e.target as HTMLElement).dataset.chunk);
          if (e.isIntersecting && !s.has(c)) (next ??= new Set(s)).add(c);
          else if (!e.isIntersecting && s.has(c)) {
            heights.current.set(c, (e.target as HTMLElement).offsetHeight);
            (next ??= new Set(s)).delete(c);
          }
        }
        return next ?? s;
      });
    }, { root: scrollParent(box.current ?? [...els.current.values()][0] ?? null), rootMargin: `${margin}px 0px` });
    io.current = obs;
    els.current.forEach((el) => obs.observe(el));
    return () => void (obs.disconnect(), (io.current = null));
  }, [n, margin]);
  useEffect(() => void (pin.length && setShown((s) => (pin.every((c) => s.has(c)) ? s : new Set([...s, ...pin])))), [pin.join()]);
  // Um callback de ref estável por bloco (sem desinscrever e reinscrever no observer a cada render).
  const refs = useRef(new Map<number, (el: HTMLDivElement | null) => void>());
  const ref = (c: number) => {
    let f = refs.current.get(c);
    if (!f) refs.current.set(c, (f = (el: HTMLDivElement | null) => {
      const old = els.current.get(c);
      if (old && old !== el) io.current?.unobserve(old);
      if (el) (els.current.set(c, el), io.current?.observe(el));
      else els.current.delete(c);
    }));
    return f;
  };
  const out: ReactNode[] = [];
  for (let c = 0; c < n; c++) {
    const start = c * chunk, end = Math.min(count, start + chunk);
    const on = n <= 2 || shown.has(c) || pin.includes(c);
    const h = heights.current.get(c) ?? (end - start) * rowPx;
    if (table) out.push(<tbody key={c} data-chunk={c} ref={ref(c) as never}>{on ? render(start, end) : <tr aria-hidden><td colSpan={table} style={{ height: h, padding: 0, border: 0 }} /></tr>}</tbody>);
    else out.push(on ? <div key={c} data-chunk={c} ref={ref(c)} className="lazy-chunk">{render(start, end)}</div> : <div key={c} data-chunk={c} ref={ref(c)} className="lazy-chunk" style={{ height: h }} />);
  }
  return table ? <>{out}</> : <div ref={box} className="lazy-chunks">{out}</div>;
}
