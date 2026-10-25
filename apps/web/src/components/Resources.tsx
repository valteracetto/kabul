import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type ResourceNode, type ResourceSnapshot, type Workspace } from "../api";
import { useDismiss } from "./useDismiss";
import { useSettings } from "./useSettings";

const P = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const IMem = () => <svg {...P}><rect x="4" y="2" width="8" height="12" rx="1.2" /><path d="M6.5 5h3M6.5 8h3M6.5 11h3M2.5 5h1.5M2.5 8h1.5M2.5 11h1.5M12 5h1.5M12 8h1.5M12 11h1.5" /></svg>;
const ITerm = () => <svg {...P}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="m5 6.5 2 1.5-2 1.5M8.5 10h2.5" /></svg>;
const ILayers = () => <svg {...P}><path d="M8 2.5 2.5 5.5 8 8.5l5.5-3Z" /><path d="m2.5 8 5.5 3 5.5-3M2.5 10.5l5.5 3 5.5-3" /></svg>;
const ITree = () => <svg {...P}><circle cx="8" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle cx="12" cy="12.5" r="1.5" /><path d="M8 5v3M4 11V9.5h8V11M8 8v1.5" /></svg>;
const ICopy = () => <svg {...P}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></svg>;

export function fmtMem(b: number) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}
const fmtCpu = (c: number) => `${c.toFixed(1)}%`;

type Sort = { by: "name" | "cpu" | "mem"; desc: boolean };
type View = "tree" | "workspace" | "terminals";
type Row = { n: ResourceNode; depth: number; key: string; hasKids: boolean };
/** Linhas visíveis até "Mostrar tudo". */
const FIRST = 8;

function sorted(ns: ResourceNode[], s: Sort) {
  const k = (n: ResourceNode) => (s.by === "name" ? n.name.toLowerCase() : s.by === "cpu" ? n.cpu : n.mem);
  return [...ns].sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0) * (s.desc ? -1 : 1));
}
const flat = (n: ResourceNode): ResourceNode[] => [n, ...n.children.flatMap(flat)];

/** Chip "▤ 2.91 GB" (memória do Kabul e filhos) e o popover RECURSOS com a árvore de processos. */
export function ResourcesChip({ workspaces, onOpen }: { workspaces: Workspace[]; onOpen: (workspaceId: string, chatId: string | null) => void }) {
  const set = useSettings();
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<ResourceSnapshot | null>(null);
  const [sort, setSort] = useState<Sort>({ by: "mem", desc: true });
  const [view, setView] = useState<View>("tree");
  const [all, setAll] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []), popRef);
  const enabled = set?.show_resources !== false;
  const load = useCallback(() => api.resources().then(setSnap, () => {}), []);
  // Popover aberto: a cada ~2 s; fechado, o chip atualiza devagar.
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, open ? 2000 : 10000);
    return () => clearInterval(t);
  }, [enabled, open, load]);
  const wsName = useMemo(() => Object.fromEntries(workspaces.map((w) => [w.id, w.title || w.name])), [workspaces]);

  const rows: Row[] = useMemo(() => {
    if (!snap) return [];
    const out: Row[] = [];
    const walk = (n: ResourceNode, depth: number, key: string) => {
      out.push({ n, depth, key, hasKids: n.children.length > 0 });
      if (closed.has(key)) return;
      sorted(n.children, sort).forEach((c) => walk(c, depth + 1, `${key}/${c.pid}`));
    };
    if (view === "tree") walk(snap.root, 0, String(snap.root.pid));
    else if (view === "terminals") {
      // Só agentes e terminais, em lista.
      sorted(flat(snap.root).filter((n) => n.kind === "agent" || n.kind === "terminal"), sort).forEach((n) => out.push({ n: { ...n, children: [] }, depth: 0, key: `t${n.pid}`, hasKids: false }));
    } else {
      // Por workspace: cada agente/terminal de topo sob o nome do workspace.
      const tops = flat(snap.root).filter((n) => n.workspace_id && (n.kind === "agent" || n.kind === "terminal"));
      const seen = new Set<number>();
      const groups = new Map<string, ResourceNode[]>();
      for (const n of tops) {
        if (seen.has(n.pid)) continue;
        flat(n).forEach((x) => seen.add(x.pid));
        groups.set(n.workspace_id!, [...(groups.get(n.workspace_id!) ?? []), n]);
      }
      for (const [ws, ns] of groups) {
        const g: ResourceNode = { pid: -1, name: wsName[ws] ?? ws, cpu: ns.reduce((a, n) => a + n.cpu, 0), mem: ns.reduce((a, n) => a + n.mem, 0), kind: "workspace", agent: null, workspace_id: ws, chat_id: null, children: ns };
        walk(g, 0, `w${ws}`);
      }
    }
    return out;
  }, [snap, sort, view, closed, wsName]);

  if (!enabled) return null;
  const shown = all ? rows : rows.slice(0, FIRST);
  const toggle = (k: string) => setClosed((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const head = (by: Sort["by"], label: string) => (
    <button className={"res-th" + (sort.by === by ? " on" : "")} onClick={() => setSort((s) => ({ by, desc: s.by === by ? !s.desc : by !== "name" }))} data-testid={`res-sort-${by}`}>
      {label}{sort.by === by && <span className="dim">{sort.desc ? " ↓" : " ↑"}</span>}
    </button>
  );
  const copy = () => navigator.clipboard.writeText(rows.map((r) => `${"  ".repeat(r.depth)}${r.n.name}\t${fmtCpu(r.n.cpu)}\t${fmtMem(r.n.mem)}`).join("\n")).catch(() => {});
  return (
    <div className="res-wrap" ref={ref}>
      <button className={"res-chip" + (open ? " on" : "")} onClick={() => setOpen(!open)} title="Uso de recursos do Kabul e dos agentes" data-testid="res-chip">
        <IMem /> <span className="mono">{snap ? fmtMem(snap.mem) : "…"}</span>
      </button>
      {open && snap && createPortal(
        // No body (a barra lateral corta o que passa da largura dela), abaixo do chip.
        <div className="popover res-pop" data-testid="res-pop" ref={popRef} style={{ top: (ref.current?.getBoundingClientRect().bottom ?? 30) + 6, left: Math.max(8, ref.current?.getBoundingClientRect().left ?? 8) }}>
          <div className="res-top">
            <span className="res-title">RECURSOS</span>
            <span className="grow" />
            <button className={"icon-btn" + (view === "terminals" ? " on" : "")} title="Só agentes e terminais" onClick={() => setView(view === "terminals" ? "tree" : "terminals")} data-testid="res-view-terminals"><ITerm /></button>
            <button className={"icon-btn" + (view === "workspace" ? " on" : "")} title="Agrupar por workspace" onClick={() => setView(view === "workspace" ? "tree" : "workspace")} data-testid="res-view-workspace"><ILayers /></button>
            <button className={"icon-btn" + (view === "tree" ? " on" : "")} title="Árvore de processos" onClick={() => setView("tree")} data-testid="res-view-tree"><ITree /></button>
            <button className="icon-btn" title="Copiar" onClick={copy} data-testid="res-copy"><ICopy /></button>
          </div>
          <div className="res-totals" data-testid="res-totals"><span className="dim">CPU</span> {fmtCpu(snap.cpu)} <span className="dim">Memória</span> {fmtMem(snap.mem)}</div>
          <div className="res-table">
            <div className="res-row res-head">{head("name", "Nome")}{head("cpu", "CPU")}{head("mem", "Mem")}</div>
            {shown.map((r) => {
              const go = r.n.workspace_id && (r.n.kind === "agent" || r.n.kind === "workspace");
              return (
                <div key={r.key} className={"res-row" + (go ? " link" : "") + ` k-${r.n.kind}`} data-testid="res-row" data-kind={r.n.kind}
                  onClick={() => go && (setOpen(false), onOpen(r.n.workspace_id!, r.n.chat_id))}>
                  <span className="res-name" style={{ paddingLeft: r.depth * 14 }}>
                    {r.hasKids ? <button className="res-caret" onClick={(e) => (e.stopPropagation(), toggle(r.key))} data-testid="res-caret">{closed.has(r.key) ? "›" : "⌄"}</button> : <span className="res-caret" />}
                    {r.n.name}
                    {r.n.kind === "agent" && r.n.workspace_id && wsName[r.n.workspace_id] && <span className="dim small"> · {wsName[r.n.workspace_id]}</span>}
                  </span>
                  <span className="res-num mono">{fmtCpu(r.n.cpu)}</span>
                  <span className="res-num mono dim">{fmtMem(r.n.mem)}</span>
                </div>
              );
            })}
          </div>
          {rows.length > FIRST && <button className="res-all" onClick={() => setAll(!all)} data-testid="res-all">{all ? "Mostrar menos" : `Mostrar tudo (${rows.length})`}</button>}
        </div>,
        document.body,
      )}
    </div>
  );
}
