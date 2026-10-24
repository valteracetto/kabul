import { confirmDialog } from "../components/Confirm";
import { useState } from "react";
import { api, wsTitle, type Repo, type Workspace } from "../api";
import type { AgentState, Route } from "../App";
import { RunsOnBadge, cloudList, cloudRunsOn } from "../components/RunsOn";
import { useEffect } from "react";
import { IArchive, IBack, IBranch, IChevronDown, IChevronRight, ICube, IFwd, IGear, IGrid, IHelp, IHome, IPin, IPlus, IRestore, ISearch, ISidebar, RepoMark } from "../icons";

const COLLAPSED = "kabul.collapsedRepos";

interface Props {
  repos: Repo[];
  workspaces: Workspace[];
  stats: Record<string, [number, number]>;
  agents: Record<string, AgentState | undefined>;
  onBack?: () => void;
  onFwd?: () => void;
  route: Route;
  onRoute: (r: Route) => void;
  onChange: () => void;
  onError: (e: string) => void;
  onSearch: () => void;
  onCollapse: () => void;
  onLinear: () => void;
  onCreate: (repoId?: string, from?: boolean) => void;
  onAddProject: () => void;
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

export function Sidebar({ repos, workspaces, stats, agents, onBack, onFwd, route, onRoute, onChange, onError, onSearch, onCollapse, onLinear, onCreate, onAddProject }: Props) {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((x) => x + 1);
    window.addEventListener("kabul:cloud-changed", h);
    return () => window.removeEventListener("kabul:cloud-changed", h);
  }, []);
  const [collapsed, setCollapsed] = useState<string[]>(() => JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]"));
  const toggleRepo = (id: string) => setCollapsed((c) => {
    const n = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
    localStorage.setItem(COLLAPSED, JSON.stringify(n));
    return n;
  });
  const [busy, setBusy] = useState<string | null>(null);

  const [showArchived, setShowArchived] = useState(false);

  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await f();
      onChange();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const archived = workspaces.filter((w) => w.archived);

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="side-top" data-tauri-drag-region>
        <button className="icon-btn" title="Ocultar barra lateral (⌘B)" onClick={onCollapse}><ISidebar /></button>
        <div className="grow" data-tauri-drag-region />
        <button className="icon-btn" title="Voltar (⌘[)" disabled={!onBack} onClick={onBack}><IBack /></button>
        <button className="icon-btn" title="Avançar (⌘])" disabled={!onFwd} onClick={onFwd}><IFwd /></button>
      </div>
      <div className="machine">Kabul <span className="dim">· este Mac</span></div>
      <nav className="side-nav">
        <button className={route.kind === "sessions" ? "on" : ""} onClick={() => onRoute({ kind: "sessions" })}><IGrid /> Painel</button>
        <button className={route.kind === "home" ? "on" : ""} onClick={() => onRoute({ kind: "home" })}><IHome /> Início</button>
        <button onClick={() => onCreate()} data-testid="create-ws"><IPlus /> Criar <span className="grow" /><kbd>⌘N</kbd></button>
        <button onClick={onSearch}><ISearch /> Buscar <span className="grow" /><kbd>⌘K</kbd></button>
        <button className={route.kind === "local" ? "on" : ""} onClick={() => onRoute({ kind: "local" })}><ICube /> Modelos locais</button>
      </nav>
      <div className="side-section">Meus workspaces</div>
      <div className="side-scroll">
        {repos.length === 0 && <div className="side-empty">Nenhum projeto ainda. <button className="text-btn" onClick={() => onAddProject()} data-testid="empty-add-project">Adicionar projeto…</button></div>}
        {repos.map((r) => {
          const list = workspaces.filter((w) => w.repo_id === r.id && !w.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at - a.created_at);
          const isCollapsed = collapsed.includes(r.id);
          const live = list.map((w) => agents[w.id]).filter(Boolean);
          return (
            <div key={r.id} className={"repo-group" + (isCollapsed ? " collapsed" : "")}>
              <div className="repo-row" title={r.path} onClick={() => toggleRepo(r.id)} data-testid={`repo-${r.name}`}>
                <span className="repo-chevron">{isCollapsed ? <IChevronRight size={12} /> : <IChevronDown size={12} />}</span>
                <RepoMark name={r.name} />
                <span className="repo-name">{r.name}</span>
                {list.length > 0 && <span className="dim small">{list.length}</span>}
                {isCollapsed && live.length > 0 && <span className={"agent-dot " + (live.includes("waiting") ? "waiting" : "working")} title={live.includes("waiting") ? "Agente esperando você" : "Agente trabalhando"} data-testid="collapsed-indicator" />}
                <span className="grow" />
                <button className="icon-btn hover-only-repo" title="Configurações do repositório" onClick={(e) => (e.stopPropagation(), onRoute({ kind: "settings", tab: "repo", repoId: r.id }))}><IGear size={13} /></button>
                <button className="icon-btn" title="Novo workspace (⌘N)" disabled={busy !== null} onClick={(e) => (e.stopPropagation(), onCreate(r.id))} data-testid={`new-ws-${r.name}`}>{busy === r.id ? <span className="spinner" /> : <IPlus />}</button>
              </div>
              {!isCollapsed && list.length === 0 && <div className="ws-empty">Sem workspaces. <button className="text-btn" onClick={() => onCreate(r.id)}>Criar um</button></div>}
              {!isCollapsed && list.map((w) => {
                const s = stats[w.id];
                const ag = agents[w.id];
                return (
                  <div key={w.id} className={"ws-row" + (route.kind === "workspace" && route.id === w.id ? " on" : "")} onClick={() => onRoute({ kind: "workspace", id: w.id })} title={`${w.branch} · ${w.status}`} data-testid="ws-row">
                    {ag === "working" ? <span className="spinner tiny" title="Agente trabalhando" /> : ag === "waiting" ? <span className="agent-dot waiting" title="Esperando você" /> : w.state === "setting_up" ? <span className="spinner tiny" title="Rodando setup" /> : <IBranch size={14} />}
                    <span className="ws-title">{wsTitle(w)}</span>
                    {cloudList(w.id)[0] && <RunsOnBadge r={cloudRunsOn(cloudList(w.id)[0])} size={12} />}
                    {w.pinned && <IPin size={11} />}
                    <span className={"dot st-" + w.status} />
                    <span className="grow" />
                    {s && (s[0] > 0 || s[1] > 0) && <span className="ws-stat"><span className="add">+{fmt(s[0])}</span>{s[1] > 0 && <span className="del"> -{fmt(s[1])}</span>}</span>}
                    <button className="icon-btn hover-only" title="Arquivar" data-testid="archive" onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirmDialog(`Arquivar ${wsTitle(w)}? As mudanças ficam num checkpoint e o worktree é removido; dá para desarquivar.`, { ok: "Arquivar", danger: true })) run("arch" + w.id, () => api.archiveWorkspace(w.id));
                    }}><IArchive size={14} /></button>
                  </div>
                );
              })}
            </div>
          );
        })}
        {archived.length > 0 && (
          <div className="repo-group">
            <div className="side-section clickable" onClick={() => setShowArchived(!showArchived)}>Arquivados ({archived.length}) {showArchived ? "▾" : "▸"}</div>
            {showArchived && archived.map((w) => (
              <div key={w.id} className="ws-row archived" data-testid="archived-row">
                <IArchive size={13} /><span className="ws-title">{wsTitle(w)}</span><span className="grow" />
                <button className="icon-btn" title="Desarquivar (recria o worktree com as mudanças)" data-testid="unarchive" onClick={() => run("un" + w.id, async () => { await api.unarchiveWorkspace(w.id); onRoute({ kind: "workspace", id: w.id }); })}><IRestore size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="side-foot">
        <span className="tier">LOCAL</span>
        <span className="grow" />
        <button className="icon-btn" title="Atalhos (⌘/)" onClick={() => onRoute({ kind: "settings", tab: "atalhos" })}><IHelp /></button>
        <button className={"icon-btn" + (route.kind === "settings" ? " on" : "")} title="Configurações (⌘,)" onClick={() => onRoute({ kind: "settings", tab: "geral" })} data-testid="settings"><IGear /></button>
      </div>
    </aside>
  );
}
