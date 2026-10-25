/**
 * Atalhos personalizados. Os handlers continuam escutando a tecla padrão do registro (`i18n/shortcuts.json`);
 * esta camada, na fase de captura, troca a tecla nova pela padrão (evento sintético) e bloqueia a padrão
 * quando ela foi remapeada para outro lugar. Assim qualquer atalho editável muda sem tocar nos handlers.
 * "Mod" = ⌘ no macOS e Ctrl no Windows/Linux (a notação guardada usa ⌘).
 */
import { SHORTCUTS, type Shortcut } from "../i18n";

const KEY = "kabul.keybindings.v1";
export interface Combo { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; key: string }

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
// i18n-ignore-next: "Espaço" é a notação guardada dos atalhos (localStorage), não texto traduzível.
const NAMES: Record<string, string> = { Slash: "/", Comma: ",", Period: ".", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Backquote: "`", Minus: "−", Equal: "+", Backslash: "\\", Enter: "↵", Backspace: "⌫", Tab: "⇥", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Espaço" };
const CODES: Record<string, { code: string; key: string }> = Object.fromEntries(Object.entries(NAMES).map(([code, n]) => [n, { code, key: ({ "↵": "Enter", "⌫": "Backspace", "⇥": "Tab", Esc: "Escape", "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight", "Espaço": " ", "−": "-", "+": "=" } as Record<string, string>)[n] ?? n }]));

/** "⌘⇧N" → combo. Só um atalho por texto (alternativas com " / " ou intervalos não são editáveis). */
export function parseCombo(s: string): Combo | null {
  if (!s || /\s\/\s|…| \/ /.test(s)) return null;
  const c: Combo = { meta: false, ctrl: false, alt: false, shift: false, key: "" };
  let rest = s;
  for (;;) {
    const ch = rest[0];
    if (ch === "⌘") c.meta = true;
    else if (ch === "⌃") c.ctrl = true;
    else if (ch === "⌥") c.alt = true;
    else if (ch === "⇧" && rest.length > 1) c.shift = true;
    else break;
    rest = rest.slice(1);
  }
  if (!rest || !(c.meta || c.ctrl || c.alt)) return null;
  c.key = rest.toUpperCase();
  return c;
}

export const formatCombo = (c: Combo) => `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.meta ? "⌘" : ""}${c.key}`;
/** Forma canônica para comparar (ordem dos modificadores não importa). */
const canon = (c: Combo) => `${+c.meta}${+c.ctrl}${+c.alt}${+c.shift}:${c.key}`;

/** Tecla do evento na notação do registro (pela posição física, que não muda com ⌥/⇧). */
export function comboFromEvent(e: KeyboardEvent): Combo | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const meta = isMac ? e.metaKey : e.ctrlKey;
  const ctrl = isMac ? e.ctrlKey : false;
  let key = NAMES[e.code];
  if (!key && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  if (!key && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  if (!key) key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return { meta, ctrl, alt: e.altKey, shift: e.shiftKey, key };
}

export const editable = (s: Shortcut) => !!parseCombo(s.keys);
export function overrides(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
export const effectiveKeys = (s: Shortcut) => overrides()[s.id] ?? s.keys;

/** Atalho (efetivo) que já usa esta combinação, fora `except`. */
export function conflict(c: Combo, except: string): Shortcut | null {
  const k = canon(c);
  for (const s of SHORTCUTS) {
    if (s.id === except) continue;
    // Também as alternativas dos fixos ("⌘⌥K / ⌘⌥J").
    if (effectiveKeys(s).split(" / ").some((part) => { const p = parseCombo(part.trim()); return p && canon(p) === k; })) return s;
  }
  return null;
}

export function setOverride(id: string, keys: string | null) {
  const o = overrides();
  if (keys === null) delete o[id];
  else o[id] = keys;
  localStorage.setItem(KEY, JSON.stringify(o));
  window.dispatchEvent(new Event("kabul:keybindings"));
}

let installed = false;
/** Liga a troca de teclas (uma vez, no início do app). */
export function installKeymap() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const synth = new WeakSet<Event>();
  window.addEventListener(
    "keydown",
    (e) => {
      if (synth.has(e) || !e.isTrusted) return;
      const o = overrides();
      if (!Object.keys(o).length) return;
      const got = comboFromEvent(e);
      if (!got) return;
      const k = canon(got);
      for (const s of SHORTCUTS) {
        const nu = o[s.id] && parseCombo(o[s.id]);
        const def = parseCombo(s.keys);
        if (!def) continue;
        if (nu && canon(nu) === k) {
          // Tecla nova: vira a padrão para os handlers de sempre.
          e.preventDefault();
          e.stopImmediatePropagation();
          const target = (e.target as EventTarget) ?? window;
          const m = CODES[def.key] ?? (/^[A-Z]$/.test(def.key) ? { code: `Key${def.key}`, key: def.shift ? def.key : def.key.toLowerCase() } : /^\d$/.test(def.key) ? { code: `Digit${def.key}`, key: def.key } : { code: "", key: def.key.toLowerCase() });
          const ev = new KeyboardEvent("keydown", { key: m.key, code: m.code, metaKey: isMac ? def.meta : false, ctrlKey: isMac ? def.ctrl : def.meta, altKey: def.alt, shiftKey: def.shift, bubbles: true, cancelable: true });
          synth.add(ev);
          target.dispatchEvent(ev);
          return;
        }
        if (o[s.id] && canon(def) === k && !SHORTCUTS.some((x) => x.id !== s.id && o[x.id] === undefined && parseCombo(x.keys) && canon(parseCombo(x.keys)!) === k)) {
          // Tecla padrão remapeada para outra: não dispara mais a ação antiga.
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
      }
    },
    true,
  );
}
