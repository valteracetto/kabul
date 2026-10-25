import { Fragment, type ReactNode } from "react";
import { t, type Key, type Vars } from "./index";

/**
 * Texto traduzido com elementos no meio: `tNode("git.pushHint", { branch: <code>{b}</code> })`
 * para `"Envie {branch} antes"`. Variáveis texto/número também valem; `count` escolhe o plural.
 */
export function tNode(k: Key, vars: Record<string, ReactNode> = {}): ReactNode {
  const plain: Vars = {};
  for (const [name, v] of Object.entries(vars)) if (typeof v === "string" || typeof v === "number") plain[name] = v;
  // Interpola só os textos; as marcas dos elementos ficam para dividir depois.
  const s = t(k, Object.fromEntries(Object.keys(vars).map((name) => [name, name in plain ? plain[name] : `\u0000${name}\u0000`])));
  if (!s.includes("\u0000")) return s;
  return s.split(/\u0000(\w+)\u0000/).map((part, i) => (i % 2 ? <Fragment key={i}>{vars[part]}</Fragment> : part));
}

/** Componente: `<T k="chat.empty" vars={{ link: <a …>…</a> }} />`. */
export function T({ k, vars }: { k: Key; vars?: Record<string, ReactNode> }) {
  return <>{tNode(k, vars)}</>;
}
