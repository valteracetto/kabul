import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, STATUS_LABEL, STATUS_ORDER, wsTitle, type Repo, type Section, type Workspace } from "../api";
import type { AgentState, Route } from "../App";
import { RunsOnBadge, cloudList, cloudRunsOn } from "../components/RunsOn";
import { MachinePicker } from "../components/MachinePicker";
import { confirmDialog } from "../components/Confirm";
import { useDismiss, usePopover } from "../components/useDismiss";
import { noSuggest } from "../noSuggest";
import { IArchive, IBack, IChevronDown, IChevronRight, ICube, IFwd, IGear, IGrid, IHelp, IHome, IMore, IPin, IPlus, IRestore, ISearch, ISidebar, RepoMark } from "../icons";

const COLLAPSED = "kabul.collapsedRepos";
const PREFS = "kabul.sidebar";
type Prefs = { groupBy: "project" | "status"; sortBy: "updated" | "created"; showHidden: boolean };
const loadPrefs = (): Prefs => ({ groupBy: "project", sortBy: "updated", showHidden: false, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") });

/** Última atividade por workspace (para "Ordenar por atualização"), gravada no aparelho. */
export const touchWorkspace = (id: string) => {
  const m = JSON.parse(localStorage.getItem("kabul.activity") ?? "{}");
  m[id] = Date.now();
  localStorage.setItem("kabul.activity", JSON.stringify(m));
};
const activity = (): Record<string, number> => JSON.parse(localStorage.getItem("kabul.activity") ?? "{}");

export const workspaceLink = (w: Workspace) => `kabul://workspace?id=${w.id}`;

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
  onHelp: () => void;
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
type Menu = { kind: "ws"; w: Workspace; x: number; y: number } | { kind: "repo"; r: Repo; x: number; y: number } | { kind: "section"; s: Section; x: number; y: number };
type Drop = { kind: "section"; id: string } | { kind: "pinned" } | { kind: "repo"; id: string } | { kind: "status"; id: string };

export function Sidebar({ repos, workspaces, stats, agents, onBack, onFwd, route, onRoute, onChange, onError, onSearch, onCollapse, onCreate, onAddProject, onHelp }: Props) {
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((x) => x + 1);
    window.addEventListener("kabul:cloud-changed", h);
    return () => window.removeEventListener("kabul:cloud-changed", h);
  }, []);
  const [collapsed, setCollapsed] = useState<string[]>(() => JSON.parse(localStorage.getItem(COLLAPSED) ?? "[]"));
  const toggleGroup = (id: string) => setCollapsed((c) => {
    const n = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
    localStorage.setItem(COLLAPSED, JSON.stringify(n));
    return n;
  });
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) => setPrefsState((o) => { const n = { ...o, ...p }; localStorage.setItem(PREFS, JSON.stringify(n)); return n; });
  const [sections, setSections] = useState<Section[]>([]);
  const loadSections = useCallback(() => void api.sections().then(setSections, () => {}), []);
  useEffect(() => loadSections(), [loadSections, workspaces]);
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, !!menu, useCallback(() => setMenu(null), []));
  const [sub, setSub] = useState<"status" | "section" | null>(null);
  const [dialog, setDialog] = useState<{ kind: "section"; s?: Section; ws?: string } | { kind: "rename"; w: Workspace } | null>(null);
  const groupMenu = usePopover();
  useEffect(() => {
    const h = () => setDialog({ kind: "section" });
    window.addEventListener("kabul:new-section", h);
    return () => window.removeEventListener("kabul:new-section", h);
  }, []);

  const patch = (w: Workspace, p: Parameters<typeof api.updateWorkspace>[1]) => api.updateWorkspace(w.id, p).then(onChange, (e) => onError(String(e)));
  const archived = workspaces.filter((w) => w.archived);
  const live = workspaces.filter((w) => !w.archived);
  const act = activity();
  const sortFn = (a: Workspace, b: Workspace) => (prefs.sortBy === "created" ? b.created_at - a.created_at : (act[b.id] ?? b.created_at * 1000) - (act[a.id] ?? a.created_at * 1000));
  const pinned = live.filter((w) => w.pinned).sort((a, b) => (a.pin_order ?? 1e9) - (b.pin_order ?? 1e9) || sortFn(a, b));
  const inSection = (sid: string) => live.filter((w) => !w.pinned && w.section === sid).sort(sortFn);
  const free = live.filter((w) => !w.pinned && !(w.section && sections.some((s) => s.id === w.section)));
  const visibleRepos = repos.filter((r) => prefs.showHidden || !r.hidden);

  // ---------- arrastar (ponteiro, a partir de 5 px; Esc cancela; rola sozinho perto das bordas) ----------
  const [drag, setDrag] = useState<{ w: Workspace; x: number; y: number; over: string | null } | null>(null);
  const start = useRef<{ w: Workspace; x: number; y: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const dropAt = (x: number, y: number): [string, Drop] | null => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
    return el ? [el.dataset.drop!, JSON.parse(el.dataset.dropv!)] : null;
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (!drag && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) return;
      const sc = scroll.current?.getBoundingClientRect();
      if (sc && scroll.current) {
        if (e.clientY < sc.top + 24) scroll.current.scrollTop -= 8;
        else if (e.clientY > sc.bottom - 24) scroll.current.scrollTop += 8;
      }
      setDrag({ w: s.w, x: e.clientX, y: e.clientY, over: dropAt(e.clientX, e.clientY)?.[0] ?? null });
    };
    const up = (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!drag || !s) return setDrag(null);
      setDrag(null);
      const d = dropAt(e.clientX, e.clientY)?.[1];
      if (!d) return;
      const w = s.w;
      if (d.kind === "pinned") patch(w, { pinned: true, pin_order: pinned.length });
      else if (d.kind === "section") patch(w, { section: d.id, pinned: false });
      else if (d.kind === "repo") patch(w, { section: "", pinned: false });
      else if (d.kind === "status") patch(w, { status: d.id, pinned: false, section: "" });
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (start.current || drag) && ((start.current = null), setDrag(null));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", esc);
    return () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up), window.removeEventListener("keydown", esc));
  });
  const dropProps = (key: string, d: Drop) => ({ "data-drop": key, "data-dropv": JSON.stringify(d) });
  const over = (key: string) => (drag && drag.over === key ? " drop-on" : "");

  // ---------- linha do workspace ----------
  const row = (w: Workspace) => {
    const s = stats[w.id];
    const ag = agents[w.id];
    const on = route.kind === "workspace" && route.id === w.id;
    return (
      <div key={w.id} className={"ws-row" + (on ? " on" : "") + (w.unread && !on ? " unread" : "") + (drag?.w.id === w.id ? " dragging" : "")}
        onPointerDown={(e) => e.button === 0 && (start.current = { w, x: e.clientX, y: e.clientY })}
        onClick={() => !drag && onRoute({ kind: "workspace", id: w.id })}
        onContextMenu={(e) => (e.preventDefault(), setSub(null), setMenu({ kind: "ws", w, x: e.clientX, y: e.clientY }))}
        title={`${w.branch} · ${STATUS_LABEL[w.status] ?? w.status}`} data-testid="ws-row" data-ws={w.id}>
        {ag === "working" ? <span className="spinner tiny" title="Agente trabalhando" /> : ag === "waiting" ? <span className="agent-dot waiting" title="Esperando você" /> : w.state === "setting_up" ? <span className="spinner tiny" title="Rodando setup" /> : prefs.groupBy === "status" ? <RepoMark name={repos.find((r) => r.id === w.repo_id)?.name ?? "?"} size={14} /> : <span className={"st-icon st-" + w.status} title={STATUS_LABEL[w.status]} />}
        <span className="ws-title">{wsTitle(w)}</span>
        {cloudList(w.id)[0] && <RunsOnBadge r={cloudRunsOn(cloudList(w.id)[0])} size={12} />}
        {w.unread && !on && <span className="unread-dot" title="Não lido" />}
        <span className="grow" />
        {s && (s[0] > 0 || s[1] > 0) && <span className="ws-stat"><span className="add">+{fmt(s[0])}</span>{s[1] > 0 && <span className="del"> -{fmt(s[1])}</span>}</span>}
        <button className="icon-btn hover-only" title="Arquivar (⌘⇧A)" data-testid="archive" onClick={(e) => (e.stopPropagation(), window.dispatchEvent(new CustomEvent("kabul:archive", { detail: w.id })))}><IArchive size={14} /></button>
      </div>
    );
  };

  // R e P com o menu de contexto aberto.
  useEffect(() => {
    if (menu?.kind !== "ws") return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "r") (e.preventDefault(), setMenu(null), patch(menu.w, { unread: !menu.w.unread }));
      if (e.key.toLowerCase() === "p") (e.preventDefault(), setMenu(null), patch(menu.w, { pinned: !menu.w.pinned, pin_order: pinned.length }));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [menu]);

  const groupHead = (key: string, label: React.ReactNode, count: number, extra?: React.ReactNode, drop?: Drop, ctx?: (e: React.MouseEvent) => void) => (
    <div className="repo-row" onClick={() => toggleGroup(key)} onContextMenu={ctx} {...(drop ? dropProps(key, drop) : {})} data-testid={`group-${key}`}>
      <span className="repo-chevron">{collapsed.includes(key) ? <IChevronRight size={12} /> : <IChevronDown size={12} />}</span>
      {label}
      {count > 0 && <span className="dim small">{count}</span>}
      <span className="grow" />
      {extra}
    </div>
  );

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="side-top" data-tauri-drag-region>
        <button className="icon-btn" title="Ocultar barra lateral (⌘B)" onClick={onCollapse}><ISidebar /></button>
        <div className="grow" data-tauri-drag-region />
        <button className="icon-btn" title="Voltar (⌘[)" disabled={!onBack} onClick={onBack}><IBack /></button>
        <button className="icon-btn" title="Avançar (⌘])" disabled={!onFwd} onClick={onFwd}><IFwd /></button>
      </div>
      <div className="machine"><MachinePicker onRoute={onRoute} /></div>
      <nav className="side-nav">
        <button className={route.kind === "sessions" ? "on" : ""} onClick={() => onRoute({ kind: "sessions" })}><IGrid /> Painel</button>
        <button className={route.kind === "home" ? "on" : ""} onClick={() => onRoute({ kind: "home" })}><IHome /> Início <span className="grow" /><kbd>⌘⇧H</kbd></button>
        <button onClick={() => onCreate()} data-testid="create-ws"><IPlus /> Criar <span className="grow" /><kbd>⌘N</kbd></button>
        <button onClick={onSearch}><ISearch /> Buscar <span className="grow" /><kbd>⌘K</kbd></button>
        <button className={route.kind === "local" ? "on" : ""} onClick={() => onRoute({ kind: "local" })}><ICube /> Modelos locais</button>
      </nav>
      <div className="side-section side-group-head">
        <span>Meus workspaces</span><span className="grow" />
        <span className="picker" ref={groupMenu.ref}>
          <button className="icon-btn" title="Agrupar, ordenar, seções" onClick={groupMenu.toggle} data-testid="group-menu"><IMore size={13} /></button>
          {groupMenu.open && (
            <div className="popover status-pop group-pop" data-testid="group-pop">
              <div className="pop-title">Agrupar por</div>
              <div className={"pop-row" + (prefs.groupBy === "project" ? " on" : "")} onClick={() => setPrefs({ groupBy: "project" })} data-testid="group-project">Projeto</div>
              <div className={"pop-row" + (prefs.groupBy === "status" ? " on" : "")} onClick={() => setPrefs({ groupBy: "status" })} data-testid="group-status">Status</div>
              <div className="pop-sep" />
              <div className="pop-title">Ordenar por</div>
              <div className={"pop-row" + (prefs.sortBy === "updated" ? " on" : "")} onClick={() => setPrefs({ sortBy: "updated" })}>Atualização</div>
              <div className={"pop-row" + (prefs.sortBy === "created" ? " on" : "")} onClick={() => setPrefs({ sortBy: "created" })} data-testid="sort-created">Criação</div>
              <div className="pop-sep" />
              <div className="pop-row" onClick={() => (groupMenu.close(), setDialog({ kind: "section" }))} data-testid="new-section">Nova seção…</div>
              <div className="pop-row" onClick={() => (groupMenu.close(), onAddProject())}>Adicionar projeto…</div>
              {repos.some((r) => r.hidden) && <div className="pop-row" onClick={() => setPrefs({ showHidden: !prefs.showHidden })} data-testid="toggle-hidden">{prefs.showHidden ? "Esconder repositórios ocultos" : "Mostrar repositórios ocultos"}</div>}
            </div>
          )}
        </span>
      </div>
      <div className="side-scroll" ref={scroll}>
        {repos.length === 0 && <div className="side-empty">Adicione um projeto para começar. <button className="text-btn" onClick={() => onAddProject()} data-testid="empty-add-project">Adicionar projeto…</button></div>}
        {(pinned.length > 0 || drag) && (
          <div className={"repo-group pinned-group" + over("pinned")} {...dropProps("pinned", { kind: "pinned" })} data-testid="pinned">
            {groupHead("pinned", <><IPin size={13} /><span className="repo-name">Fixados</span></>, pinned.length, undefined, { kind: "pinned" })}
            {!collapsed.includes("pinned") && pinned.map(row)}
            {pinned.length === 0 && <div className="ws-empty">Solte aqui para fixar</div>}
          </div>
        )}
        {sections.map((s) => {
          const list = inSection(s.id);
          const key = `section-${s.id}`;
          return (
            <div key={s.id} className={"repo-group" + over(key)} {...dropProps(key, { kind: "section", id: s.id })} data-testid="section">
              {groupHead(key, <><span className="sec-emoji">{s.emoji || "•"}</span><span className="repo-name">{s.name}</span></>, list.length, undefined, { kind: "section", id: s.id }, (e) => (e.preventDefault(), setMenu({ kind: "section", s, x: e.clientX, y: e.clientY })))}
              {!collapsed.includes(key) && list.map(row)}
              {!collapsed.includes(key) && list.length === 0 && <div className="ws-empty">Arraste um workspace para cá</div>}
            </div>
          );
        })}
        {prefs.groupBy === "status"
          ? STATUS_ORDER.map((st) => {
              const list = free.filter((w) => w.status === st).sort(sortFn);
              const key = `status-${st}`;
              if (!list.length && !drag) return null;
              return (
                <div key={st} className={"repo-group" + over(key)} {...dropProps(key, { kind: "status", id: st })} data-testid="status-group">
                  {groupHead(key, <><span className={"st-icon st-" + st} /><span className="repo-name">{STATUS_LABEL[st]}</span></>, list.length, undefined, { kind: "status", id: st })}
                  {!collapsed.includes(key) && list.map(row)}
                </div>
              );
            })
          : visibleRepos.map((r) => {
              const list = free.filter((w) => w.repo_id === r.id).sort(sortFn);
              const isCollapsed = collapsed.includes(r.id);
              const liveAg = list.map((w) => agents[w.id]).filter(Boolean);
              return (
                <div key={r.id} className={"repo-group" + (isCollapsed ? " collapsed" : "") + (r.hidden ? " hidden-repo" : "") + over(`repo-${r.id}`)} {...dropProps(`repo-${r.id}`, { kind: "repo", id: r.id })}>
                  <div className="repo-row" title={r.path} onClick={() => toggleGroup(r.id)} onContextMenu={(e) => (e.preventDefault(), setMenu({ kind: "repo", r, x: e.clientX, y: e.clientY }))} data-testid={`repo-${r.name}`}>
                    <span className="repo-chevron">{isCollapsed ? <IChevronRight size={12} /> : <IChevronDown size={12} />}</span>
                    {r.icon ? <span className="sec-emoji">{r.icon}</span> : <RepoMark name={r.name} />}
                    <span className="repo-name">{r.name}</span>
                    {list.length > 0 && <span className="dim small">{list.length}</span>}
                    {isCollapsed && liveAg.length > 0 && <span className={"agent-dot " + (liveAg.includes("waiting") ? "waiting" : "working")} title={liveAg.includes("waiting") ? "Agente esperando você" : "Agente trabalhando"} data-testid="collapsed-indicator" />}
                    <span className="grow" />
                    <button className="icon-btn hover-only-repo" title="Ações do repositório" onClick={(e) => (e.stopPropagation(), setMenu({ kind: "repo", r, x: e.clientX, y: e.clientY }))} data-testid={`repo-more-${r.name}`}><IMore size={13} /></button>
                    <button className="icon-btn" title="Novo workspace (⌘N)" onClick={(e) => (e.stopPropagation(), onCreate(r.id))} data-testid={`new-ws-${r.name}`}><IPlus /></button>
                  </div>
                  {!isCollapsed && list.length === 0 && <div className="ws-empty">Sem workspaces. <button className="text-btn" onClick={() => onCreate(r.id)}>Criar um</button></div>}
                  {!isCollapsed && list.map(row)}
                </div>
              );
            })}
        {archived.length > 0 && (
          <div className="repo-group">
            <div className="side-section clickable" onClick={() => setShowArchived(!showArchived)}>Arquivados ({archived.length}) {showArchived ? "▾" : "▸"}</div>
            {showArchived && archived.map((w) => (
              <div key={w.id} className="ws-row archived" data-testid="archived-row">
                <IArchive size={13} /><span className="ws-title">{wsTitle(w)}</span><span className="grow" />
                <button className="icon-btn" title="Desarquivar (recria o worktree com as mudanças)" data-testid="unarchive" onClick={() => api.unarchiveWorkspace(w.id).then(() => (onChange(), onRoute({ kind: "workspace", id: w.id })), (e) => onError(String(e)))}><IRestore size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="side-foot">
        <span className="grow" />
        <button className="icon-btn" title="Ajuda" onClick={onHelp} data-testid="help"><IHelp /></button>
        <button className={"icon-btn" + (route.kind === "settings" ? " on" : "")} title="Configurações (⌘,)" onClick={() => onRoute({ kind: "settings", tab: "geral" })} data-testid="settings"><IGear /></button>
      </div>

      {drag && createPortal(<div className="drag-ghost" style={{ left: drag.x + 10, top: drag.y + 6 }}>{wsTitle(drag.w)}</div>, document.body)}

      {menu && createPortal(
        <div ref={menuRef} className="popover status-pop ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 330) }} data-testid={`${menu.kind}-ctx`}>
          {menu.kind === "ws" && (() => {
            const w = menu.w;
            const close = () => setMenu(null);
            return (
              <>
                <div className="pop-row" onClick={() => (close(), onRoute({ kind: "workspace", id: w.id }))}>Abrir</div>
                <div className="pop-row" onClick={() => (close(), patch(w, { unread: !w.unread }))} data-testid="ctx-read">{w.unread ? "Marcar como lido" : "Marcar como não lido"}<span className="grow" /><span className="kbd-hint">R</span></div>
                <div className="pop-row" onClick={() => (close(), patch(w, { pinned: !w.pinned, pin_order: pinned.length }))} data-testid="ctx-pin">{w.pinned ? "Desafixar" : "Fixar"}<span className="grow" /><span className="kbd-hint">P</span></div>
                <div className="pop-row sub" onMouseEnter={() => setSub("status")} onClick={() => setSub("status")} data-testid="ctx-status">Status <span className="grow" />▸
                  {sub === "status" && (
                    <div className="popover status-pop submenu-pop">
                      {STATUS_ORDER.map((st) => <div key={st} className={"pop-row" + (w.status === st ? " on" : "")} onClick={(e) => (e.stopPropagation(), close(), patch(w, { status: st }))} data-testid={`ctx-status-${st}`}><span className={"st-icon st-" + st} /> {STATUS_LABEL[st]}</div>)}
                    </div>
                  )}
                </div>
                <div className="pop-row sub" onMouseEnter={() => setSub("section")} onClick={() => setSub("section")} data-testid="ctx-section">Mover para seção <span className="grow" />▸
                  {sub === "section" && (
                    <div className="popover status-pop submenu-pop">
                      {sections.map((s) => <div key={s.id} className={"pop-row" + (w.section === s.id ? " on" : "")} onClick={(e) => (e.stopPropagation(), close(), patch(w, { section: s.id, pinned: false }))} data-testid="ctx-section-item">{s.emoji} {s.name}</div>)}
                      {w.section && <div className="pop-row" onClick={(e) => (e.stopPropagation(), close(), patch(w, { section: "" }))}>Tirar da seção</div>}
                      <div className="pop-sep" />
                      <div className="pop-row" onClick={(e) => (e.stopPropagation(), close(), setDialog({ kind: "section", ws: w.id }))} data-testid="ctx-section-new">Nova seção…</div>
                    </div>
                  )}
                </div>
                <div className="pop-sep" />
                <div className="pop-row" onClick={() => (close(), setDialog({ kind: "rename", w }))} data-testid="ctx-rename">Renomear…</div>
                <div className="pop-row" onClick={() => (close(), navigator.clipboard.writeText(workspaceLink(w)))} data-testid="ctx-link">Copiar link<span className="grow" /><span className="kbd-hint">⌘⇧C</span></div>
                <div className="pop-row" onClick={() => (close(), navigator.clipboard.writeText(w.path))}>Copiar caminho</div>
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={() => (close(), window.dispatchEvent(new CustomEvent("kabul:archive", { detail: w.id })))} data-testid="ctx-archive">Arquivar<span className="grow" /><span className="kbd-hint">⌘⇧A</span></div>
              </>
            );
          })()}
          {menu.kind === "repo" && (() => {
            const r = menu.r;
            const close = () => setMenu(null);
            return (
              <>
                <div className="pop-row" onClick={() => (close(), onCreate(r.id))} data-testid="repo-ctx-create">Criar workspace<span className="grow" /><span className="kbd-hint">⌘N</span></div>
                <div className="pop-row" onClick={() => (close(), onCreate(r.id, true))}>Criar a partir de…<span className="grow" /><span className="kbd-hint">⌘⇧N</span></div>
                <div className="pop-row" onClick={() => (close(), onRoute({ kind: "settings", tab: "repo", repoId: r.id }))}>Configurações do repositório<span className="grow" /><span className="kbd-hint">⌘,</span></div>
                <div className="pop-row" onClick={() => (close(), api.repoUpdate(r.id, { hidden: !r.hidden }).then(onChange, (e) => onError(String(e))))} data-testid="repo-ctx-hide">{r.hidden ? "Mostrar repositório" : "Ocultar repositório"}</div>
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={async () => { close(); if (await confirmDialog(`Remover ${r.name} do Kabul? A pasta e o repositório continuam no disco; os workspaces precisam estar arquivados.`, { ok: "Remover", danger: true })) api.removeRepo(r.id).then(onChange, (e) => onError(String(e))); }} data-testid="repo-ctx-remove">Remover repositório…</div>
              </>
            );
          })()}
          {menu.kind === "section" && (
            <>
              <div className="pop-row" onClick={() => (setMenu(null), setDialog({ kind: "section", s: menu.s }))} data-testid="section-edit">Editar seção…</div>
              <div className="pop-row danger" onClick={() => (setMenu(null), api.sectionDelete(menu.s.id).then(() => (loadSections(), onChange()), (e) => onError(String(e))))} data-testid="section-delete">Apagar seção</div>
            </>
          )}
        </div>, document.body)}

      {dialog?.kind === "section" && <SectionDialog s={dialog.s} onClose={() => setDialog(null)} onSave={async (name, emoji) => {
        try {
          const s = await api.sectionSave({ ...(dialog.s ?? {}), name, emoji });
          if (dialog.ws) await api.updateWorkspace(dialog.ws, { section: s.id, pinned: false });
          setDialog(null);
          loadSections();
          onChange();
        } catch (e) {
          onError(String(e));
        }
      }} />}
      {dialog?.kind === "rename" && <RenameDialog w={dialog.w} onClose={() => setDialog(null)} onSave={async (title, branch) => {
        try {
          await api.updateWorkspace(dialog.w.id, { title });
          if (branch) await api.renameBranch(dialog.w.id, branch);
          setDialog(null);
          onChange();
        } catch (e) {
          onError(String(e));
        }
      }} />}
    </aside>
  );
}

const EMOJIS = ["🚀", "🐛", "✨", "🔥", "🧪", "📦", "🎨", "📚", "⏳", "✅", "💡", "🛠️"];

function SectionDialog({ s, onClose, onSave }: { s?: Section; onClose: () => void; onSave: (name: string, emoji: string) => void }) {
  const [name, setName] = useState(s?.name ?? "");
  const [emoji, setEmoji] = useState(s?.emoji ?? "🚀");
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover dialog" onMouseDown={(e) => e.stopPropagation()} data-testid="section-dialog" onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && (e.metaKey || (e.target as HTMLElement).tagName === "INPUT") && name.trim()) onSave(name.trim(), emoji); }}>
        <div className="dialog-title">{s ? "Editar seção" : "Nova seção"}</div>
        <div className="emoji-grid">{EMOJIS.map((e) => <button key={e} className={"emoji" + (e === emoji ? " on" : "")} onClick={() => setEmoji(e)}>{e}</button>)}</div>
        <input autoFocus {...noSuggest} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da seção" data-testid="section-name" />
        <div className="row end"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), emoji)} data-testid="section-save">Salvar <span className="kbd-hint">⌘↵</span></button></div>
      </div>
    </div>, document.body);
}

function RenameDialog({ w, onClose, onSave }: { w: Workspace; onClose: () => void; onSave: (title: string, branch: string | null) => void }) {
  const [title, setTitle] = useState(wsTitle(w));
  const [also, setAlso] = useState(false);
  const slug = useMemo(() => title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40), [title]);
  const prefix = w.branch.includes("/") ? w.branch.slice(0, w.branch.lastIndexOf("/") + 1) : "";
  const save = () => title.trim() && onSave(title.trim(), also && slug ? prefix + slug : null);
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover dialog" onMouseDown={(e) => e.stopPropagation()} data-testid="rename-dialog" onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") save(); }}>
        <div className="dialog-title">Renomear workspace</div>
        <input autoFocus {...noSuggest} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="rename-title" />
        <label className="check-row"><input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} data-testid="rename-branch" /> Renomear a branch também {also && slug && <code>{prefix + slug}</code>}</label>
        <div className="row end"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} data-testid="rename-save">Renomear ↵</button></div>
      </div>
    </div>, document.body);
}
