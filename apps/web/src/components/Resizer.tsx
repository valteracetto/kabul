import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";

/** Tamanho de painel persistido (por janela) com limites. */
export function usePanelSize(key: string, def: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const v = Number(localStorage.getItem(`kabul.size.${key}`));
    return v >= min && v <= max ? v : def;
  });
  useEffect(() => localStorage.setItem(`kabul.size.${key}`, String(size)), [key, size]);
  return { size, setSize, def, min, max };
}

interface Props {
  /** "x": borda vertical (col-resize). "y": borda horizontal (row-resize). */
  axis: "x" | "y";
  size: number;
  min: number;
  max: number;
  def: number;
  /** +1: arrastar para a direita/baixo aumenta; -1: diminui (painel à direita ou embaixo). */
  dir: 1 | -1;
  onSize: (n: number) => void;
  /** Arrastar abaixo do mínimo recolhe o painel. */
  onCollapse?: () => void;
  testid?: string;
}

/** Alça de redimensionamento na borda de um painel. Duplo clique volta ao tamanho padrão. */
export function Resizer({ axis, size, min, max, def, dir, onSize, onCollapse, testid }: Props) {
  const down = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const start = axis === "x" ? e.clientX : e.clientY;
      const startSize = size;
      document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
      const move = (ev: PointerEvent) => {
        const raw = startSize + dir * ((axis === "x" ? ev.clientX : ev.clientY) - start);
        onSize(Math.max(min, Math.min(max, raw)));
        if (onCollapse && raw < min - 60) {
          up();
          onSize(def);
          onCollapse();
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.classList.remove("resizing-x", "resizing-y");
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [axis, size, min, max, def, dir, onSize, onCollapse],
  );
  return <div className={"resizer resizer-" + axis} onPointerDown={down} onDoubleClick={() => onSize(def)} title={t("app.resizer.title")} data-testid={testid} />;
}
