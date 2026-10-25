import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { logicallyContains } from "./Floating";

/**
 * Popovers, menus e dropdowns abertos fecham ao clicar fora (o clique segue para o alvo, sem ser
 * bloqueado) e com Esc. Os abertos formam uma pilha: Esc fecha só o de cima.
 */
const stack: symbol[] = [];

export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: (reason: "esc" | "outside") => void, extra?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const me = Symbol("popover");
    stack.push(me);
    // Portais do <Floating> contam como dentro da âncora (o popover não fica no DOM do dono).
    const inside = (t: EventTarget | null) => !!t && [ref.current, extra?.current].some((el) => logicallyContains(el, t as Node));
    // Fase de captura: um stopPropagation em outro lugar não impede o fechamento.
    const down = (e: PointerEvent | MouseEvent) => !inside(e.target) && closeRef.current("outside");
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack[stack.length - 1] !== me) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current("esc");
    };
    const t = setTimeout(() => document.addEventListener("mousedown", down, true), 0);
    document.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, ref, extra]);
}

/** Estado de um popover com fechamento por clique fora e Esc: `const p = usePopover(); <div ref={p.ref}>`. */
export function usePopover<T extends HTMLElement = HTMLDivElement>(initial = false) {
  const [open, setOpen] = useState(initial);
  const ref = useRef<T>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  return { open, setOpen, toggle: useCallback(() => setOpen((o) => !o), []), close, ref };
}

/** Há algum popover aberto? (atalhos globais como ⌘K/Esc consultam antes de agir). */
export const popoverOpen = () => stack.length > 0;
