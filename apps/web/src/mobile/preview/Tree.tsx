import { useMemo, useState, type ReactNode } from "react";
import { base, dir } from "./api";

interface Node { name: string; path: string; dirs: Map<string, Node>; files: string[] }

function build(list: string[]): Node {
  const root: Node = { name: "", path: "", dirs: new Map(), files: [] };
  for (const f of list) {
    const parts = f.split("/");
    let n = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let c = n.dirs.get(parts[i]);
      if (!c) n.dirs.set(parts[i], (c = { name: parts[i], path: parts.slice(0, i + 1).join("/"), dirs: new Map(), files: [] }));
      n = c;
    }
    n.files.push(f);
  }
  return root;
}

/** Nota da busca: nome do arquivo vale mais que pasta; letras em ordem (subsequência) valem pouco. */
export function score(path: string, q: string): number {
  const p = path.toLowerCase(), b = base(p);
  if (b === q) return 100;
  if (b.startsWith(q)) return 80;
  if (b.includes(q)) return 60;
  if (p.includes(q)) return 40;
  let i = 0;
  for (const ch of p) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

const openKey = (ws: string) => `kabul.tree.${ws}`;

/** Árvore de arquivos com busca. Arquivos alterados ganham um ponto. */
export function Tree({ ws, list, changed, onOpen }: { ws: string; list: string[]; changed: Set<string>; onOpen: (p: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(openKey(ws)) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const root = useMemo(() => build(list), [list]);
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query) return [];
    return list.map((f) => [f, score(f, query)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, 200).map(([f]) => f);
  }, [list, query]);
  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      sessionStorage.setItem(openKey(ws), JSON.stringify([...n]));
      return n;
    });
  const file = (f: string, depth: number, showDir = false) => (
    <button key={f} className="pv-node file" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => onOpen(f)} data-testid="pv-file" data-path={f}>
      <span className="pv-ico">{fileIcon(f)}</span>
      <span className="pv-row-main">
        <span className="m-ellipsis">{base(f)}</span>
        {showDir && dir(f) && <span className="dim small m-ellipsis">{dir(f)}</span>}
      </span>
      {changed.has(f) && <span className="pv-dot" title="Alterado" />}
    </button>
  );
  const render = (n: Node, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const d of [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      const on = open.has(d.path);
      out.push(
        <button key={"d" + d.path} className="pv-node dir" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => toggle(d.path)} data-testid="pv-dir" data-path={d.path} aria-expanded={on}>
          <span className="pv-ico">{on ? "▾" : "▸"}</span>
          <span className="m-ellipsis">{d.name}</span>
        </button>,
      );
      if (on) out.push(...render(d, depth + 1));
    }
    for (const f of [...n.files].sort((a, b) => base(a).localeCompare(base(b)))) out.push(file(f, depth));
    return out;
  };
  return (
    <div className="pv-tree">
      <div className="pv-search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar em ${list.length} arquivos`} data-testid="pv-search" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </div>
      {query ? (
        <div data-testid="pv-results">
          {hits.length === 0 && <div className="m-empty dim">Nada com “{q}”.</div>}
          {hits.map((f) => file(f, 0, true))}
        </div>
      ) : (
        <div data-testid="pv-tree">{render(root, 0)}</div>
      )}
    </div>
  );
}

function fileIcon(f: string): string {
  const e = f.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp"].includes(e)) return "▣";
  if (["mp4", "mov", "webm", "m4v", "mp3", "wav", "ogg", "m4a"].includes(e)) return "▶";
  if (e === "pdf") return "▤";
  if (["md", "markdown", "mdx", "txt", "rst"].includes(e)) return "¶";
  return "·";
}
