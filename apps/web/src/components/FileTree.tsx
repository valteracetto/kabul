import { useMemo, useState } from "react";
import { FileIcon, IFolder } from "../icons";

interface Node { name: string; path: string; dir: boolean; children: Node[] }

function build(paths: string[]): Node[] {
  const root: Node = { name: "", path: "", dir: true, children: [] };
  for (const p of paths) {
    let cur = root;
    p.split("/").forEach((part, i, arr) => {
      const isDir = i < arr.length - 1;
      let n = cur.children.find((c) => c.name === part && c.dir === isDir);
      if (!n) cur.children.push((n = { name: part, path: arr.slice(0, i + 1).join("/"), dir: isDir, children: [] }));
      cur = n;
    });
  }
  const sort = (ns: Node[]) => {
    ns.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    ns.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

/** Árvore de arquivos do workspace: pastas recolhíveis, ícone por tipo de arquivo. */
export function FileTree({ files, onOpen }: { files: string[]; onOpen: (p: string) => void }) {
  const tree = useMemo(() => build(files), [files]);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const toggle = (p: string) => setOpenDirs((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const render = (ns: Node[], depth: number): React.ReactNode =>
    ns.map((n) => (
      <div key={n.path}>
        <div className="tree-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path))} title={n.path} data-testid="tree-row">
          {n.dir ? <IFolder size={15} open={openDirs.has(n.path)} /> : <FileIcon name={n.name} />}
          <span className="tree-name">{n.name}</span>
        </div>
        {n.dir && openDirs.has(n.path) && render(n.children, depth + 1)}
      </div>
    ));
  return <div className="tree">{render(tree, 0)}</div>;
}
