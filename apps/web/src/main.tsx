import { lazy, Profiler, Suspense, type ProfilerOnRenderCallback } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { App } from "./App";
import { applyAppearance, applyTheme } from "./theme";
import { installKeymap } from "./components/keymap";
import { lang } from "./i18n/lang";
import { loadMessages } from "./i18n";
// PWA do celular e popover da barra: carregados só quando usados (fora do JS inicial do desktop).
const MobileApp = lazy(() => import("./mobile/MobileApp").then((m) => ({ default: m.MobileApp })));
const TrayPopover = lazy(() => import("./components/TrayPopover").then((m) => ({ default: m.TrayPopover })));

applyTheme();
applyAppearance();
// Atalhos personalizados (Configurações › Atalhos) valem antes de qualquer handler.
installKeymap();
// Zoom guardado (⌘+/⌘−/⌘0).
(document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = `${localStorage.getItem("kabul.zoom") ?? "100"}%`;

// PWA do celular em /m/ (servida pelo kabuld). Em tela estreita, fora do app desktop, vai para lá.
const isTauri = "__TAURI_INTERNALS__" in window;
// Idioma (Configurações › Geral): <html lang> e, no desktop, menus nativos, barra do Kabul e notificações.
document.documentElement.lang = lang();
if (isTauri) import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_ui_lang", { lang: lang() })).catch(() => {});
const q = new URLSearchParams(location.search);
if (!isTauri && !q.has("mock") && !q.has("http") && location.pathname === "/" && window.innerWidth < 700) history.replaceState(null, "", "/m/" + location.hash);
const mobile = location.pathname.startsWith("/m");
if (mobile) applyTheme();
// Celular: o service worker escreve as notificações push no idioma em uso (public/sw.js).
if (mobile) navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: "kabul-lang", lang: lang() })).catch(() => {});
// Popover da barra do Kabul: a janela `tray` do desktop (ou `?view=tray` no navegador, para o E2E).
const tray = q.get("view") === "tray" || (isTauri && (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "tray");
if (tray) document.documentElement.classList.add("tray-window");

// `?profile` (em dev): React Profiler por área em window.__profile (commits e ms), para caçar re-render em cascata.
// No build de produção o `npm run perf` conta os renders pelo gancho do DevTools (perf/escala.spec.ts).
const prof: ProfilerOnRenderCallback = (id, phase, ms) => {
  const p = ((window as unknown as { __profile?: Record<string, { commits: number; ms: number; mounts: number }> }).__profile ??= {});
  const e = (p[id] ??= { commits: 0, ms: 0, mounts: 0 });
  (e.commits++, (e.ms += ms), phase === "mount" && e.mounts++);
};
const root = tray ? <Suspense fallback={null}><TrayPopover /></Suspense> : mobile ? <Suspense fallback={null}><MobileApp /></Suspense> : <App />;
// Os textos do idioma em uso chegam antes da primeira tela (só esse idioma é baixado).
loadMessages().then(() => createRoot(document.getElementById("root")!).render(import.meta.env.DEV && q.has("profile") ? <Profiler id="app" onRender={prof}>{root}</Profiler> : root));
