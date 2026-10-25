import { lazy, Suspense, type ComponentProps } from "react";

/** xterm (≈ 290 KB) fora do JS inicial: carrega no primeiro terminal (e é pré-carregado com o app ocioso). */
export const loadTerminal = () => import("./TerminalTab");
const Impl = lazy(() => loadTerminal().then((m) => ({ default: m.TerminalTab })));

export function TerminalTab(p: ComponentProps<typeof Impl>) {
  return <Suspense fallback={<div className="terminal" />}><Impl {...p} /></Suspense>;
}
