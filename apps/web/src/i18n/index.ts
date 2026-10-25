/**
 * Textos da interface (desktop, celular e barra do Kabul) em inglês e português.
 *
 * - Os textos ficam em `locales/<idioma>/<área>.json`; toda chave começa pelo nome da área
 *   (`settings.title` em `settings.json`). As duas línguas têm as mesmas chaves (`npm run i18n:check`).
 * - `t("chave", { nome: "x" })` troca `{nome}`. Plural: o valor é um objeto `{ "one": "…", "other": "…" }`
 *   e a escolha usa `count` (Intl.PluralRules), ex.: `t("git.files", { count: 3 })`.
 * - Datas, números, moeda e durações: `./format`. Texto com elementos (links, negrito): `tNode` em `./react`.
 * - Idioma: `./lang` (Sistema/English/Português em Configurações › Geral).
 */
import shortcuts from "./shortcuts.json";
import { lang } from "./lang";

export { LANG_NAMES, LANGS, lang, langPref, locale, setLangPref, systemLang, type Lang, type LangPref } from "./lang";

/** Texto simples ou formas de plural (CLDR: zero, one, two, few, many, other). */
export type Msg = string | { [form: string]: string };

// Só o idioma em uso é baixado (pedaço de JS à parte): `loadMessages()` roda em main.tsx antes de desenhar a
// tela. Por isso `t()` não pode ser chamado na carga de um módulo (o i18n:check acusa): só dentro de funções.
type Dict = (typeof import("./locales/pt-BR"))["default"];
let DICT: Record<string, Msg> | null = null;

/** Baixa o dicionário do idioma em uso. Chamar (e esperar) antes do primeiro `t()`. */
export async function loadMessages(): Promise<void> {
  if (!DICT) DICT = (lang() === "en" ? await import("./locales/en") : await import("./locales/pt-BR")).default;
}

export type Key = keyof Dict;
export type Vars = Record<string, string | number | null | undefined>;

const plurals = new Map<string, Intl.PluralRules>();
function pluralForm(n: number): string {
  const l = lang();
  let r = plurals.get(l);
  if (!r) plurals.set(l, (r = new Intl.PluralRules(l)));
  return r.select(n);
}

const reported = new Set<string>();
function missing(k: string) {
  if (reported.has(k)) return;
  reported.add(k);
  // O E2E em inglês falha com isto no console (e2e/idioma-en.spec.ts).
  console.error(`[i18n] chave sem texto em ${lang()}: ${k}`);
}

/** Mensagem crua (string ou formas de plural) no idioma atual. */
export function msg(k: Key | string): Msg | undefined {
  if (!DICT) {
    console.error(`[i18n] t("${k}") antes de loadMessages(): chamada na carga do módulo?`);
    return undefined;
  }
  return DICT[k];
}

/** A chave existe? (para textos montados a partir de dados, ex.: `usage.window.${id}`). */
export function has(k: string): k is Key {
  return !!DICT && k in DICT;
}

/** Texto traduzido. `vars.count` escolhe o plural; `{x}` é trocado por `vars.x`. */
export function t(k: Key, vars: Vars = {}): string {
  let m = msg(k);
  if (m === undefined) {
    missing(k);
    return k;
  }
  if (typeof m !== "string") {
    const n = Number(vars.count ?? 0);
    m = m[pluralForm(n)] ?? m.other ?? Object.values(m)[0] ?? k;
  }
  return interpolate(m, vars);
}

/**
 * Tabela de rótulos montada na primeira leitura (depois do `loadMessages`), para constantes de módulo:
 * `export const LABEL = lazyRecord(() => ({ done: t("app.status.done") }))`. Só objetos (não arrays).
 */
export function lazyRecord<T extends object>(make: () => T): T {
  let v: T | null = null;
  const get = () => (v ??= make());
  return new Proxy({} as T, {
    get: (_, k) => Reflect.get(get(), k),
    has: (_, k) => Reflect.has(get(), k),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(get(), k);
      return d && { ...d, configurable: true };
    },
  });
}

export function interpolate(s: string, vars: Vars): string {
  return s.replace(/\{(\w+)\}/g, (all, v) => (v in vars ? String(vars[v] ?? "") : all));
}

export interface Shortcut { id: string; keys: string; cat: string; pt: string; en: string }
/** Registro único de atalhos: a tabela das configurações e a documentação saem daqui. */
export const SHORTCUTS: Shortcut[] = shortcuts;
export const CATEGORIES = ["general", "view", "navigation", "workspace", "tabs", "chat", "git", "diff", "terminal"] as const;
/** Descrição do atalho no idioma atual. */
export const shortcutLabel = (s: Shortcut) => (lang() === "en" ? s.en : s.pt);
