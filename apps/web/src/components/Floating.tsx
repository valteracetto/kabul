import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, computePosition, flip, offset, shift, size, type Placement } from "@floating-ui/dom";

/**
 * Popover/menu ancorado, renderizado em portal no <body> (acima de todos os painéis, nunca cortado pelo
 * overflow de um painel) e posicionado pela viewport: vira para o outro lado (flip) e desliza (shift)
 * quando não cabe, e limita a altura ao espaço disponível.
 *
 * Âncora: por padrão o elemento pai do lugar onde o <Floating> aparece no JSX (o wrapper do botão),
 * ou `anchor` explícito. O clique dentro do portal conta como "dentro" para o `useDismiss` do dono.
 */
export function Floating({ placement = "bottom-start", gap = 4, anchor, className, style, children, testid, onMouseDown, onKeyDown }: {
  placement?: Placement;
  gap?: number;
  anchor?: () => Element | null | undefined;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  testid?: string;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; maxH?: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor?.() ?? marker.current?.parentElement;
    const f = el.current;
    if (!a || !f) return;
    // O portal é "filho lógico" da âncora: useDismiss e outros testes de contenção seguem por aqui.
    (f as unknown as { __anchor?: Element }).__anchor = a;
    return autoUpdate(a, f, () => {
      void computePosition(a, f, {
        strategy: "fixed",
        placement,
        middleware: [offset(gap), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply: ({ availableHeight }) => setPos((p) => (p && p.maxH === Math.floor(availableHeight) ? p : { x: p?.x ?? 0, y: p?.y ?? 0, maxH: Math.floor(availableHeight) })) })],
      }).then(({ x, y }) => setPos((p) => (p && p.x === Math.round(x) && p.y === Math.round(y) ? p : { x: Math.round(x), y: Math.round(y), maxH: p?.maxH })));
    });
  }, [placement, gap, anchor]);
  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <div ref={el} className={"popover floating " + (className ?? "")} data-testid={testid} data-floating="" onMouseDown={onMouseDown} onKeyDown={onKeyDown}
          style={{ ...style, position: "fixed", zIndex: 2000, left: pos?.x ?? -9999, top: pos?.y ?? -9999, right: "auto", bottom: "auto", margin: 0, transform: "none", maxHeight: pos?.maxH, overflowY: "auto", opacity: pos ? 1 : 0, pointerEvents: pos ? undefined : "none" }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

/** `container` contém `node`, considerando portais do <Floating> como filhos da âncora. */
export function logicallyContains(container: Element | null | undefined, node: Node | null): boolean {
  let n: Node | null = node;
  for (let i = 0; n && i < 20; i++) {
    if (container?.contains(n)) return true;
    const f = (n instanceof Element ? n : n.parentElement)?.closest("[data-floating]") as (Element & { __anchor?: Element }) | null;
    n = f?.__anchor ?? null;
  }
  return false;
}
