import { useEffect, type RefObject } from "react";

/** Fecha um popover ao clicar fora dele ou apertar Esc. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    const t = setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key);
    return () => (clearTimeout(t), document.removeEventListener("mousedown", down), document.removeEventListener("keydown", key));
  }, [open, ref, close]);
}
