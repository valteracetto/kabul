import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { App } from "./App";
import { applyAppearance, applyTheme } from "./theme";
import { MobileApp } from "./mobile/MobileApp";

applyTheme();
applyAppearance();
// Zoom guardado (⌘+/⌘−/⌘0).
(document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = `${localStorage.getItem("kabul.zoom") ?? "100"}%`;

// PWA do celular em /m/ (servida pelo kabuld). Em tela estreita, fora do app desktop, vai para lá.
const isTauri = "__TAURI_INTERNALS__" in window;
const q = new URLSearchParams(location.search);
if (!isTauri && !q.has("mock") && !q.has("http") && location.pathname === "/" && window.innerWidth < 700) history.replaceState(null, "", "/m/" + location.hash);
const mobile = location.pathname.startsWith("/m");

createRoot(document.getElementById("root")!).render(mobile ? <MobileApp /> : <App />);
