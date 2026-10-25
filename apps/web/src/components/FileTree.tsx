import { memo, useMemo, useState } from "react";
import { FileIcon, IFolder } from "../icons";
import { LazyChunks } from "./LazyChunks";

interface Node { name: string; path: string; dir: boolean; children: Node[]; index: Map<string, Node> }

function build(paths: string[]): Node[] {
  const root: Node = { name: "", path: "", dir: true, children: [], index: new Map() };
  for (const p of paths) {
    let cur = root;
    const arr = p.split("/");
    arr.forEach((part, i) => {
      const isDir = i < arr.length - 1;
      // Índice por nome (antes, busca linear nos filhos: quadrático em pastas grandes).
      const k = (isDir ? "d:" : "f:") + part;
      let n = cur.index.get(k);
      if (!n) (n = { name: part, path: arr.slice(0, i + 1).join("/"), dir: isDir, children: [], index: new Map() }), cur.children.push(n), cur.index.set(k, n);
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

/** Árvore de arquivos do workspace: pastas recolhíveis, ícone por tipo de arquivo; virtualizada (milhares de arquivos). */
export const FileTree = memo(function FileTree({ files, onOpen, onContext, expanded }: { files: string[]; onOpen: (p: string) => void; onContext?: (p: string, e: React.MouseEvent) => void; expanded?: boolean }) {
  const tree = useMemo(() => build(files), [files]);
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set(expanded ? files.flatMap((f) => f.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))) : []));
  const toggle = (p: string) => setOpenDirs((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  // Linhas visíveis em ordem (pastas abertas expandidas), desenhadas por blocos perto da área visível.
  const rows = useMemo(() => {
    const out: { n: Node; depth: number }[] = [];
    const walk = (ns: Node[], depth: number) => ns.forEach((n) => (out.push({ n, depth }), n.dir && openDirs.has(n.path) && walk(n.children, depth + 1)));
    walk(tree, 0);
    return out;
  }, [tree, openDirs]);
  return (
    <div className="tree">
      <LazyChunks count={rows.length} chunk={150} rowPx={28} render={(a, b) => rows.slice(a, b).map(({ n, depth }) => (
        <div key={n.path + (n.dir ? "/" : "")} className="tree-row" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path))} onContextMenu={(e) => !n.dir && onContext && (e.preventDefault(), onContext(n.path, e))} title={n.path} data-testid="tree-row">
          {n.dir ? <IFolder size={15} open={openDirs.has(n.path)} /> : <FileIcon name={n.name} />}
          <span className="tree-name">{n.name}</span>
        </div>
      ))} />
    </div>
  );
});
