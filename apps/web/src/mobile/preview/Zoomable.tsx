import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent } from "react";

interface T { s: number; x: number; y: number }
type Pt = { x: number; y: number };

const MAX = 8;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Pinça para ampliar, arrastar quando ampliado e dois toques para alternar 1× / 2,5× (no desktop,
 * Ctrl + roda). Só a imagem muda de escala: a página não dá zoom junto (`touch-action: none`).
 */
export function Zoomable({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setRaw] = useState<T>({ s: 1, x: 0, y: 0 });
  const tr = useRef(t);
  // O valor vai para a ref na hora: movimentos em sequência não esperam o React renderizar.
  const setT = (n: T) => {
    tr.current = n;
    setRaw(n);
  };
  const pts = useRef(new Map<number, Pt>());
  const gesture = useRef<null | { kind: "pinch"; d: number; c: Pt; s: number } | { kind: "pan"; p: Pt; x: number; y: number }>(null);
  const lastTap = useRef(0);
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const set = (n: T) => setT(n.s <= 1.01 ? { s: 1, x: 0, y: 0 } : n);
  const startGesture = () => {
    const v = [...pts.current.values()];
    const cur = tr.current;
    if (v.length >= 2) {
      const m = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
      // Ponto do conteúdo sob o meio dos dedos: fica embaixo deles durante a pinça.
      gesture.current = { kind: "pinch", d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1, c: { x: (m.x - cur.x) / cur.s, y: (m.y - cur.y) / cur.s }, s: cur.s };
    } else if (v.length === 1) gesture.current = { kind: "pan", p: v[0], x: cur.x, y: cur.y };
    else gesture.current = null;
  };
  const down = (e: RPointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    pts.current.set(e.pointerId, local(e));
    startGesture();
  };
  const move = (e: RPointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const v = [...pts.current.values()];
    if (g?.kind === "pinch" && v.length >= 2) {
      const d = Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
      const m = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
      const s = clamp((g.s * d) / g.d, 1, MAX);
      setT({ s, x: m.x - g.c.x * s, y: m.y - g.c.y * s });
    } else if (g?.kind === "pan" && tr.current.s > 1) {
      setT({ ...tr.current, x: g.x + v[0].x - g.p.x, y: g.y + v[0].y - g.p.y });
    }
  };
  const up = (e: RPointerEvent) => {
    const p = pts.current.get(e.pointerId);
    pts.current.delete(e.pointerId);
    const g = gesture.current;
    const tap = g?.kind === "pan" && !!p && Math.hypot(p.x - g.p.x, p.y - g.p.y) < 12;
    startGesture();
    if (pts.current.size === 0) {
      set(tr.current);
      // Dois toques: alterna entre 1× e 2,5× no ponto tocado.
      const now = Date.now();
      if (!tap) lastTap.current = 0;
      else if (p && now - lastTap.current < 350) {
        lastTap.current = 0;
        const cur = tr.current;
        if (cur.s > 1) set({ s: 1, x: 0, y: 0 });
        else set({ s: 2.5, x: p.x - p.x * 2.5, y: p.y - p.y * 2.5 });
      } else lastTap.current = now;
    }
  };
  const wheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const p = local(e);
    const cur = tr.current;
    const s = clamp(cur.s * Math.exp(-e.deltaY / 200), 1, MAX);
    const c = { x: (p.x - cur.x) / cur.s, y: (p.y - cur.y) / cur.s };
    set({ s, x: p.x - c.x * s, y: p.y - c.y * s });
  };
  return (
    <div ref={box} className="pv-zoom" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} data-testid="pv-zoom" data-scale={t.s.toFixed(2)}>
      <div className="pv-zoom-in" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>{children}</div>
      {t.s > 1 && <button className="m-btn small pv-zoom-reset" onPointerDown={(e) => e.stopPropagation()} onClick={() => set({ s: 1, x: 0, y: 0 })}>{t.s.toFixed(1)}× · 1×</button>}
    </div>
  );
}
