/** Tema: claro, escuro ou sistema (segue prefers-color-scheme). Persistido no aparelho. */
export type ThemePref = "light" | "dark" | "system";
const KEY = "kabul.theme";
const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export const getThemePref = (): ThemePref => (localStorage.getItem(KEY) as ThemePref) || "dark";
export const effectiveTheme = (p = getThemePref()): "light" | "dark" => (p === "system" ? (mq?.matches ? "dark" : "light") : p);

export function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
  window.dispatchEvent(new Event("kabul:theme"));
}

export function setThemePref(p: ThemePref) {
  localStorage.setItem(KEY, p);
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
