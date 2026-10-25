/**
 * Navegação em pilha da PWA pelo histórico do navegador (`#s=<sessão>`, `#v=new`, `#v=settings/<sub>`).
 * Cada tela empilhada é uma entrada do histórico: o voltar do sistema (Android, gesto, botão do
 * navegador) e o ‹ da barra fazem a mesma coisa. Folhas abertas também ocupam uma entrada, para o
 * voltar do Android fechá-las primeiro.
 */
export type Route = { kind: "root" } | { kind: "session"; id: string } | { kind: "new" } | { kind: "settings"; sub: string } | { kind: "usage" };

export function parseRoute(hash = location.hash): Route {
  const p = new URLSearchParams(hash.slice(1));
  const s = p.get("s");
  if (s) return { kind: "session", id: s };
  const v = p.get("v");
  if (v === "new") return { kind: "new" };
  // Custos e limites (só o dono): `#uso` ou `#v=usage`.
  if (p.has("uso") || v === "usage") return { kind: "usage" };
  if (v?.startsWith("settings/")) return { kind: "settings", sub: v.slice(9) };
  return { kind: "root" };
}

let dir: "push" | "pop" | "tab" | "none" = "none";
export const navDir = () => dir;
export const setNavDir = (d: typeof dir) => void (dir = d);

interface NavState { k?: number; sheet?: string }
const st = (): NavState => (history.state as NavState | null) ?? {};
const emit = () => window.dispatchEvent(new Event("kabul:route"));

/** Empilha uma tela. Com `replace`, troca a tela atual (ex.: "Novo workspace" vira a conversa criada). */
export function push(hash: string, replace = false) {
  dir = "push";
  const s = st();
  // Uma folha aberta dá lugar à tela nova (não sobra uma entrada "fantasma" de folha no histórico).
  if (replace) history.replaceState({ k: s.k ?? 0 }, "", `#${hash}`);
  else if (s.sheet) history.replaceState({ k: (s.k ?? 0) + 1 }, "", `#${hash}`);
  else history.pushState({ k: (s.k ?? 0) + 1 }, "", `#${hash}`);
  emit();
}
export const openSession = (id: string, replace = false) => push(`s=${encodeURIComponent(id)}`, replace);

export function back() {
  dir = "pop";
  if ((st().k ?? 0) > 0) return history.back();
  history.replaceState({ k: 0 }, "", location.pathname + location.search);
  emit();
}

/** Mudanças de rota: nossas (push/back) e do sistema (popstate, link com hash). */
export function onRoute(f: () => void): () => void {
  const pop = () => ((dir = "pop"), f());
  window.addEventListener("kabul:route", f);
  window.addEventListener("popstate", pop);
  window.addEventListener("hashchange", f);
  return () => (window.removeEventListener("kabul:route", f), window.removeEventListener("popstate", pop), window.removeEventListener("hashchange", f));
}

let sheetSeq = 0;
/** Registra uma folha aberta no histórico; devolve `dismiss` (fecha pelo histórico) e a limpeza. */
export function sheetHistory(onClose: () => void): { dismiss: () => void; cleanup: () => void } {
  const id = `sh${++sheetSeq}`;
  history.pushState({ ...st(), sheet: id }, "");
  let open = true;
  const pop = () => {
    if (open && st().sheet !== id) ((open = false), onClose());
  };
  window.addEventListener("popstate", pop);
  return {
    dismiss: () => (st().sheet === id ? history.back() : open && ((open = false), onClose())),
    cleanup: () => {
      window.removeEventListener("popstate", pop);
      // Fechou sem passar pelo histórico (ex.: abriu uma tela): tira a entrada se ainda está no topo.
      if (open && st().sheet === id) ((open = false), history.back());
    },
  };
}
