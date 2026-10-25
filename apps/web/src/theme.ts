/** Tema: claro, escuro ou sistema (segue prefers-color-scheme). Persistido no aparelho. */
export type ThemePref = "light" | "dark" | "system";
// A PWA do celular (/m/) tem preferência própria e segue o sistema por padrão; o desktop começa escuro.
const mobile = () => typeof location !== "undefined" && location.pathname.startsWith("/m");
const key = () => (mobile() ? "kabul.m.theme" : "kabul.theme");
const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export const getThemePref = (): ThemePref => (localStorage.getItem(key()) as ThemePref) || (mobile() ? "system" : "dark");
export const effectiveTheme = (p = getThemePref()): "light" | "dark" => (p === "system" ? (mq?.matches ? "dark" : "light") : p);

export function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
  window.dispatchEvent(new Event("kabul:theme"));
}

export function setThemePref(p: ThemePref) {
  localStorage.setItem(key(), p);
  applyTheme();
}

export function cycleTheme(): ThemePref {
  const order: ThemePref[] = ["dark", "light", "system"];
  const next = order[(order.indexOf(getThemePref()) + 1) % order.length];
  setThemePref(next);
  return next;
}

/** Valor atual de uma variável CSS do tema. */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

mq?.addEventListener("change", () => getThemePref() === "system" && applyTheme());

/** Preferências de aparência do aparelho (Configurações › Aparência) aplicadas no <html>. */
export function applyAppearance() {
  const r = document.documentElement;
  const get = (k: string, d: string) => localStorage.getItem(k) ?? d;
  r.dataset.contrast = get("kabul.contrast", "normal");
  const cb = get("kabul.cb", "default");
  if (cb === "default") delete r.dataset.cb;
  else r.dataset.cb = cb;
  r.dataset.ligatures = get("kabul.ligatures", "on");
  r.dataset.sidebarDiffs = get("kabul.sidebarDiffs", "colored");
  r.style.setProperty("--mono-font", `"${get("kabul.monoFont", "Geist Mono")}"`);
  r.classList.toggle("md-tufte", get("kabul.mdStyle", "default") === "tufte");
}
