/**
 * Rotas do preview na hash da PWA (o resto do app usa `#s=<sessão>`):
 * `#f=<workspace>&t=files|changes|app|browser` (lista), `&p=<arquivo>&l=<linha>` (preview), `&d=<arquivo>`
 * (diff). `from=<sessão>` lembra de onde veio (voltar e "perguntar sobre isto" no mesmo chat).
 */
export type Tab = "files" | "changes" | "app" | "browser";
export interface FilesRoute { ws: string; tab: Tab; path: string | null; diff: string | null; line: number | null; from: string | null }

export function filesRoute(hash = location.hash): FilesRoute | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const ws = q.get("f");
  if (!ws) return null;
  const t = q.get("t");
  const line = Number(q.get("l"));
  return { ws, tab: t === "changes" || t === "app" || t === "browser" ? t : "files", path: q.get("p"), diff: q.get("d"), line: Number.isFinite(line) && line > 0 ? line : null, from: q.get("from") };
}

export function filesHash(r: Partial<FilesRoute> & { ws: string }): string {
  const q = new URLSearchParams({ f: r.ws });
  if (r.tab && r.tab !== "files") q.set("t", r.tab);
  if (r.path) q.set("p", r.path);
  if (r.diff) q.set("d", r.diff);
  if (r.line) q.set("l", String(r.line));
  if (r.from) q.set("from", r.from);
  return q.toString();
}

/** Navegações feitas dentro do preview (para "voltar" usar o histórico do navegador). */
let depth = 0;

export function go(r: Partial<FilesRoute> & { ws: string }, replace = false) {
  const h = "#" + filesHash(r);
  if (replace) {
    history.replaceState(null, "", h);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    depth++;
    location.hash = h;
  }
}

/** Volta um passo; sem histórico próprio, sobe para `parent`. */
export function back(parent: string) {
  if (depth > 0) {
    depth--;
    history.back();
  } else {
    history.replaceState(null, "", parent ? "#" + parent : location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

/** Abre um arquivo no preview (do chat, da lista ou de um link). */
export function openFile(ws: string, path: string, opts: { line?: number | null; from?: string | null } = {}) {
  go({ ws, path, line: opts.line ?? null, from: opts.from ?? null });
}

export function openFiles(ws: string, from?: string | null, tab: Tab = "files") {
  go({ ws, from: from ?? null, tab });
}
