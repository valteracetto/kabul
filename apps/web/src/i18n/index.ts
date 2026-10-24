/**
 * Textos da interface centralizados. Hoje só pt-BR é mostrado; a estrutura já aceita inglês
 * (`en`). Para traduzir um texto novo: acrescente a chave em `pt` e `en` abaixo e use `t("chave")`.
 */
import shortcuts from "./shortcuts.json";

export type Lang = "pt" | "en";
export const lang = (): Lang => (localStorage.getItem("kabul.lang") as Lang) || "pt";

const STRINGS = {
  pt: {
    "settings.title": "Configurações",
    "settings.group.personal": "Pessoal",
    "settings.group.env": "Agentes e ambiente",
    "settings.group.repo": "Repositório",
    "settings.group.more": "Mais",
    "shortcuts.search": "Buscar atalhos…",
    "cat.general": "Geral", "cat.view": "Ver", "cat.navigation": "Navegação", "cat.workspace": "Workspace", "cat.tabs": "Abas", "cat.chat": "Chat", "cat.git": "Git", "cat.diff": "Revisão de código", "cat.terminal": "Terminal",
  },
  en: {
    "settings.title": "Settings",
    "settings.group.personal": "Personal",
    "settings.group.env": "Agents & environment",
    "settings.group.repo": "Repository",
    "settings.group.more": "More",
    "shortcuts.search": "Search shortcuts…",
    "cat.general": "General", "cat.view": "View", "cat.navigation": "Navigation", "cat.workspace": "Workspace", "cat.tabs": "Tabs", "cat.chat": "Chat", "cat.git": "Git", "cat.diff": "Code review", "cat.terminal": "Terminal",
  },
} as const;

export type Key = keyof (typeof STRINGS)["pt"];
export function t(k: Key, vars: Record<string, string | number> = {}): string {
  const s: string = STRINGS[lang()][k] ?? STRINGS.pt[k] ?? k;
  return s.replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ""));
}

export interface Shortcut { id: string; keys: string; cat: string; pt: string; en: string }
/** Registro único de atalhos: a tabela das configurações e a documentação saem daqui. */
export const SHORTCUTS: Shortcut[] = shortcuts;
export const CATEGORIES = ["general", "view", "navigation", "workspace", "tabs", "chat", "git", "diff", "terminal"] as const;
