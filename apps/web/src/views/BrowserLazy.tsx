import { lazy, Suspense, type ComponentProps } from "react";

/** Aba Browser fora do JS inicial: carrega quando a aba abre. */
const Impl = lazy(() => import("./BrowserTab").then((m) => ({ default: m.BrowserTab })));

export function BrowserTab(p: ComponentProps<typeof Impl>) {
  return <Suspense fallback={<div className="browser-tab" />}><Impl {...p} /></Suspense>;
}
