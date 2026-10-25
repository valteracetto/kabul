/**
 * Idioma da interface. Preferência em `localStorage["kabul.lang"]`: "system" (padrão), "en" ou "pt-BR".
 * "system" segue `navigator.languages` (no app desktop, o idioma do macOS): português vira pt-BR e
 * qualquer outro idioma vira inglês. Trocar o idioma recarrega a janela (os textos são lidos uma vez).
 */
export type Lang = "pt-BR" | "en";
export type LangPref = "system" | Lang;
export const LANGS: Lang[] = ["en", "pt-BR"];
/** Nome de cada idioma nele mesmo (o seletor não traduz). */
export const LANG_NAMES: Record<Lang, string> = { en: "English", "pt-BR": "Português" };

const KEY = "kabul.lang";

export function langPref(): LangPref {
  let v: string | null = null;
  try {
    v = localStorage.getItem(KEY);
  } catch {
    /* sem localStorage (contexto isolado): segue o sistema */
  }
  if (v === "pt" || v === "pt-BR") return "pt-BR";
  if (v === "en") return "en";
  return "system";
}

/** Idioma do sistema: o primeiro idioma preferido que o Kabul conhece; senão, inglês. */
export function systemLang(): Lang {
  const prefs = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of prefs) {
    const base = (l || "").toLowerCase();
    if (base.startsWith("pt")) return "pt-BR";
    if (base.startsWith("en")) return "en";
  }
  return "en";
}

let cached: Lang | null = null;
/** Idioma em uso (resolvido uma vez por carga da página). */
export function lang(): Lang {
  return (cached ??= langPref() === "system" ? systemLang() : (langPref() as Lang));
}

/** Locale do Intl: pt-BR, ou a variante de inglês do sistema (en-GB formata datas como no Reino Unido). */
export function locale(): string {
  if (lang() === "pt-BR") return "pt-BR";
  const nav = typeof navigator === "undefined" ? "" : navigator.language || "";
  return /^en(-|$)/i.test(nav) ? nav : "en-US";
}

/** Grava a preferência e recarrega a janela para aplicar. */
export function setLangPref(p: LangPref, reload = true) {
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    /* ignora */
  }
  cached = null;
  if (reload && typeof location !== "undefined") location.reload();
}

/** Só para testes de unidade: esquece o idioma resolvido. */
export function _resetLangCache() {
  cached = null;
}
