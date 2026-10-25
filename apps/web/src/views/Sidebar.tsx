import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Floating } from "../components/Floating";
import { createPortal } from "react-dom";
import { api, STATUS_LABEL, STATUS_ORDER, wsTitle, type Repo, type Section, type Workspace } from "../api";
import type { AgentState, Route } from "../App";
import { RunsOnBadge, cloudList, cloudRunsOn, type CloudRecord } from "../components/RunsOn";
import { MachinePicker } from "../components/MachinePicker";
import { ResourcesChip } from "../components/Resources";
import { confirmDialog } from "../components/Confirm";
import { chatStore, statusOf, useChatSelect } from "../components/chatStore";
import { useDismiss, usePopover } from "../components/useDismiss";
import { noSuggest } from "../noSuggest";
import { t } from "../i18n";
import { IBranch, IEye, IEyeOff, IHistory, ILink, IList, IPR, ITrash } from "../icons";
import { IArchive, IBack, IChevronDown, IChevronRight, ICube, IFwd, IGauge, IGear, IGrid, IHelp, IHome, IMore, IPin, IPlus, ISearch, ISidebar, RepoMark } from "../icons";

type RowH = { down: (w: Workspace, e: React.PointerEvent) => void; click: (w: Workspace) => void; ctx: (w: Workspace, e: React.MouseEvent) => void; enter: (w: Workspace) => void; leave: () => void; mdown: () => void; stay: () => void };

/**
 * Linha do workspace, memorizada: com 100 workspaces, um evento de um agente só re-renderiza a linha
 * dele (antes, a barra lateral inteira). Fora da tela, o navegador pula layout e pintura (content-visibility).
 */
const WsRow = memo(function WsRow({ w, s, ag, on, dragging, dragActive, byStatus, repoName, peek, cloud, h }: {
  w: Workspace; s?: [number, number]; ag?: AgentState; on: boolean; dragging: boolean; dragActive: boolean; byStatus: boolean; repoName: string; peek: boolean; cloud?: CloudRecord; h: React.RefObject<RowH>;
}) {
  return (
    <div className={"ws-row" + (on ? " on" : "") + (w.unread && !on ? " unread" : "") + (dragging ? " dragging" : "")}
      onPointerDown={(e) => e.button === 0 && h.current!.down(w, e)}
      onClick={() => h.current!.click(w)}
      onContextMenu={(e) => h.current!.ctx(w, e)}
      onMouseEnter={() => !dragActive && h.current!.enter(w)} onMouseLeave={() => h.current!.leave()} onMouseDown={() => h.current!.mdown()}
      data-testid="ws-row" data-ws={w.id}>
      {ag === "working" ? <span className="spinner tiny" title={t("app.side.agentWorking")} /> : ag === "waiting" ? <span className="agent-dot waiting" title={t("app.agents.status.waiting")} /> : ag === "queued" ? <span className="agent-dot queued" title={t("app.side.agentQueued")} data-testid="ws-queued" /> : w.state === "setting_up" ? <span className="spinner tiny" title={t("app.side.settingUp")} /> : byStatus ? <RepoMark name={repoName || "?"} size={14} /> : w.pr_url ? <span className="ws-ico" data-status={w.status} title={`PR · ${STATUS_LABEL[w.status] ?? w.status}`}><IPR size={14} /></span> : <span className="ws-ico" data-status={w.status} title={STATUS_LABEL[w.status] ?? w.status}><IBranch size={14} /></span>}
      <span className="ws-title">{wsTitle(w)}</span>
      {cloud && <RunsOnBadge r={cloudRunsOn(cloud)} size={12} />}
      {w.unread && !on && <span className="unread-dot" title={t("app.side.unread")} />}
      <span className="grow" />
      {s && (s[0] > 0 || s[1] > 0) && <span className="ws-stat"><span className="add">+{fmt(s[0])}</span>{s[1] > 0 && <span className="del"> -{fmt(s[1])}</span>}</span>}
      <button className="icon-btn hover-only" title={t("app.side.archiveTitle")} data-testid="archive" onClick={(e) => (e.stopPropagation(), window.dispatchEvent(new CustomEvent("kabul:archive", { detail: w.id })))}><IArchive size={14} /></button>
      {peek && (
        <Floating className="ws-peek" placement="right-start" gap={8} testid="ws-peek">
          <div onMouseEnter={() => h.current!.stay()} onMouseLeave={() => h.current!.leave()} onClick={(e) => e.stopPropagation()}>
            <div className="peek-title">{wsTitle(w)}</div>
            <div className="dim small">{repoName} · <span className="mono">{w.branch}</span></div>
            <div className="peek-row"><span className={"st-icon st-" + w.status} /> {STATUS_LABEL[w.status] ?? w.status}{ag && <span className="dim"> · {ag === "working" ? t("app.side.peek.working") : ag === "queued" ? t("app.side.peek.queued") : t("app.side.peek.waiting")}</span>}</div>
            {s && (s[0] > 0 || s[1] > 0) && <div className="peek-row mono small"><span className="add">+{s[0]}</span> <span className="del">−{s[1]}</span> <span className="dim">{t("app.side.lines")}</span></div>}
            {w.pr_url && <div className="peek-row small">{"PR" /* i18n-ignore */} <span className="mono">{w.pr_url.split("/").pop()}</span></div>}
            {w.notes && <div className="peek-notes small">{w.notes}</div>}
            <div className="dim small">{t("app.side.port", { port: w.port, path: w.path.split(/[\\/]/).slice(-2).join("/") })}</div>
          </div>
        </Floating>
      )}
    </div>
  );
});

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
  const [cloudBump, bump] = useState(0);
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

  // Conversas com agente ativo (todas as abas de todos os workspaces), para o contador de "Agentes".
  const activeAgents = useChatSelect(() => chatStore.all().filter((c) => statusOf(c) !== "idle").length, Object.is);
  const patch = (w: Workspace, p: Parameters<typeof api.updateWorkspace>[1]) => api.updateWorkspace(w.id, p).then(onChange, (e) => onError(String(e)));
  const archived = workspaces.filter((w) => w.archived);
  const live = workspaces.filter((w) => !w.archived);
  const act = activity();
  const sortFn = (a: Workspace, b: Workspace) => (prefs.sortBy === "created" ? b.created_at - a.created_at : (act[b.id] ?? b.created_at * 1000) - (act[a.id] ?? a.created_at * 1000));
  const pinned = live.filter((w) => w.pinned).sort((a, b) => (a.pin_order ?? 1e9) - (b.pin_order ?? 1e9) || sortFn(a, b));
  const inSection = (sid: string) => live.filter((w) => !w.pinned && w.section === sid).sort(sortFn);
  const free = live.filter((w) => !w.pinned && !(w.section && sections.some((s) => s.id === w.section)));
  const visibleRepos = repos.filter((r) => prefs.showHidden || !r.hidden);
  const repoNames = useMemo(() => new Map(repos.map((r) => [r.id, r.name])), [repos]);
  const repoName = (id: string) => repoNames.get(id) ?? "";

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

  // ---------- cartão de prévia (hover): abre em 700 ms, fecha 200 ms depois de sair ----------
  const [peek, setPeek] = useState<string | null>(null);
  const peekT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekIn = (id: string) => (peekT.current && clearTimeout(peekT.current), (peekT.current = setTimeout(() => setPeek(id), 700)));
  const peekOut = () => (peekT.current && clearTimeout(peekT.current), (peekT.current = setTimeout(() => setPeek(null), 200)));
  const peekStay = () => peekT.current && clearTimeout(peekT.current);

  // ---------- linha do workspace (memorizada; os handlers vão por ref) ----------
  const cloudOf = useMemo(() => new Map(live.map((w) => [w.id, cloudList(w.id)[0]])), [live.length, workspaces, cloudBump]);
  const rowH = useRef<RowH>(null as never);
  rowH.current = {
    down: (w, e) => void (start.current = { w, x: e.clientX, y: e.clientY }),
    click: (w) => !drag && onRoute({ kind: "workspace", id: w.id }),
    ctx: (w, e) => (e.preventDefault(), setSub(null), setMenu({ kind: "ws", w, x: e.clientX, y: e.clientY })),
    enter: (w) => peekIn(w.id),
    leave: peekOut,
    mdown: () => (peekT.current && clearTimeout(peekT.current), setPeek(null)),
    stay: () => void peekStay(),
  };
  const row = (w: Workspace) => (
    <WsRow key={w.id} w={w} s={stats[w.id]} ag={agents[w.id]} on={route.kind === "workspace" && route.id === w.id} dragging={drag?.w.id === w.id} dragActive={!!drag}
      byStatus={prefs.groupBy === "status"} repoName={repoName(w.repo_id)} peek={peek === w.id && !drag && !menu} cloud={cloudOf.get(w.id)} h={rowH} />
  );
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
        <button className="icon-btn" title={t("app.side.hideSidebar")} onClick={onCollapse}><ISidebar /></button>
        <div className="grow" data-tauri-drag-region />
        <ResourcesChip workspaces={workspaces} onOpen={(id, chat) => (onRoute({ kind: "workspace", id }), chat && setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:focus-chat", { detail: chat })), 50))} />
        <button className="icon-btn" title={t("app.side.back")} disabled={!onBack} onClick={onBack}><IBack /></button>
        <button className="icon-btn" title={t("app.side.forward")} disabled={!onFwd} onClick={onFwd}><IFwd /></button>
      </div>
      <div className="machine"><MachinePicker onRoute={onRoute} /></div>
      <nav className="side-nav">
        <button className={route.kind === "sessions" ? "on" : ""} onClick={() => onRoute({ kind: "sessions" })}><IGrid /> {t("app.sessions.title")}</button>
        <button className={route.kind === "agents" ? "on" : ""} onClick={() => onRoute({ kind: "agents" })} data-testid="nav-agents"><ICube /> {t("app.agents.title")} <span className="grow" />{activeAgents > 0 && <span className="nav-count" data-testid="agents-count">{activeAgents}</span>}</button>
        <button className={route.kind === "dashboard" ? "on" : ""} onClick={() => onRoute({ kind: "dashboard" })} data-testid="nav-dashboard"><IList /> {t("app.board.title")}</button>
        <button className={route.kind === "home" ? "on" : ""} onClick={() => onRoute({ kind: "home" })}><IHome /> {t("app.pal.n.home")} <span className="grow" /><kbd>⌘⇧H</kbd></button>
        <button onClick={() => onCreate()} data-testid="create-ws"><IPlus /> {t("app.side.create")} <span className="grow" /><kbd>⌘N</kbd></button>
        <button className={route.kind === "routines" ? "on" : ""} onClick={() => onRoute({ kind: "routines" })} data-testid="nav-routines"><IHistory /> {t("app.routine.title")}</button>
        <button onClick={onSearch}><ISearch /> {t("common.search")} <span className="grow" /><kbd>⌘K</kbd></button>
        <button className={route.kind === "local" ? "on" : ""} onClick={() => onRoute({ kind: "local" })}><ICube /> {t("app.pal.n.local")}</button>
        <button className={route.kind === "usage" ? "on" : ""} onClick={() => onRoute({ kind: "usage" })} data-testid="nav-usage"><IGauge /> {t("app.side.usage")}</button>
      </nav>
      <div className="side-section side-group-head">
        <span>{t("app.side.myWorkspaces")}</span><span className="grow" />
        <span className="picker" ref={groupMenu.ref}>
          <button className="icon-btn" title={t("app.side.groupTitle")} onClick={groupMenu.toggle} data-testid="group-menu"><IMore size={13} /></button>
          {groupMenu.open && (
            <Floating className="status-pop group-pop" placement="bottom-end" testid="group-pop">
              <div className="pop-title">{t("app.side.groupBy")}</div>
              <div className={"pop-row" + (prefs.groupBy === "project" ? " on" : "")} onClick={() => setPrefs({ groupBy: "project" })} data-testid="group-project">{t("app.side.groupProject")}</div>
              <div className={"pop-row" + (prefs.groupBy === "status" ? " on" : "")} onClick={() => setPrefs({ groupBy: "status" })} data-testid="group-status">{t("app.side.groupStatus")}</div>
              <div className="pop-sep" />
              <div className="pop-title">{t("app.side.sortBy")}</div>
              <div className={"pop-row" + (prefs.sortBy === "updated" ? " on" : "")} onClick={() => setPrefs({ sortBy: "updated" })}>{t("app.side.sortUpdated")}</div>
              <div className={"pop-row" + (prefs.sortBy === "created" ? " on" : "")} onClick={() => setPrefs({ sortBy: "created" })} data-testid="sort-created">{t("app.side.sortCreated")}</div>
              <div className="pop-sep" />
              <div className="pop-row" onClick={() => (groupMenu.close(), setDialog({ kind: "section" }))} data-testid="new-section">{t("app.side.newSection")}</div>
              <div className="pop-row" onClick={() => (groupMenu.close(), onAddProject())}>{t("app.side.addProject")}</div>
              {repos.some((r) => r.hidden) && <div className="pop-row" onClick={() => setPrefs({ showHidden: !prefs.showHidden })} data-testid="toggle-hidden">{prefs.showHidden ? t("app.side.hideHidden") : t("app.side.showHidden")}</div>}
              {archived.length > 0 && <div className="pop-row" onClick={() => (groupMenu.close(), window.dispatchEvent(new CustomEvent("kabul:palette", { detail: "archived" /* i18n-ignore: id */ })))} data-testid="view-archived">{t("app.side.viewArchived", { n: archived.length })} <span className="grow" /><span className="kbd-hint">⌘K</span></div>}
            </Floating>
          )}
        </span>
      </div>
      <div className="side-scroll" ref={scroll}>
        {repos.length === 0 && <div className="side-empty">{t("app.side.emptyLead")} <button className="text-btn" onClick={() => onAddProject()} data-testid="empty-add-project">{t("app.side.addProject")}</button></div>}
        {(pinned.length > 0 || drag) && (
          <div className={"repo-group pinned-group" + over("pinned")} {...dropProps("pinned", { kind: "pinned" })} data-testid="pinned">
            {groupHead("pinned", <><IPin size={13} /><span className="repo-name">{t("app.side.pinned")}</span></>, pinned.length, undefined, { kind: "pinned" })}
            {!collapsed.includes("pinned") && pinned.map(row)}
            {pinned.length === 0 && <div className="ws-empty">{t("app.side.dropToPin")}</div>}
          </div>
        )}
        {sections.map((s) => {
          const list = inSection(s.id);
          const key = `section-${s.id}`;
          return (
            <div key={s.id} className={"repo-group" + over(key)} {...dropProps(key, { kind: "section", id: s.id })} data-testid="section">
              {groupHead(key, <><span className="sec-emoji">{s.emoji || "•"}</span><span className="repo-name">{s.name}</span></>, list.length, undefined, { kind: "section", id: s.id }, (e) => (e.preventDefault(), setMenu({ kind: "section", s, x: e.clientX, y: e.clientY })))}
              {!collapsed.includes(key) && list.map(row)}
              {!collapsed.includes(key) && list.length === 0 && <div className="ws-empty">{t("app.side.dragHere")}</div>}
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
                    {isCollapsed && liveAg.length > 0 && <span className={"agent-dot " + (liveAg.includes("waiting") ? "waiting" : "working")} title={liveAg.includes("waiting") ? t("app.side.agentWaiting") : t("app.side.agentWorking")} data-testid="collapsed-indicator" />}
                    <span className="grow" />
                    <button className="icon-btn hover-only-repo" title={t("app.side.repoActions")} onClick={(e) => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); setMenu({ kind: "repo", r, x: Math.max(8, b.left - 24), y: b.bottom + 4 }); }} data-testid={`repo-more-${r.name}`}><IMore size={13} /></button>
                    <button className="icon-btn" title={t("app.side.newWorkspace")} onClick={(e) => (e.stopPropagation(), onCreate(r.id))} data-testid={`new-ws-${r.name}`}><IPlus /></button>
                  </div>
                  {!isCollapsed && list.length === 0 && <div className="ws-empty">{t("app.side.noWorkspaces")} <button className="text-btn" onClick={() => onCreate(r.id)}>{t("app.side.createOne")}</button></div>}
                  {!isCollapsed && list.map(row)}
                </div>
              );
            })}
      </div>
      <div className="side-foot">
        <span className="grow" />
        <button className="icon-btn" title={t("app.side.help")} onClick={onHelp} data-testid="help"><IHelp /></button>
        <button className={"icon-btn" + (route.kind === "settings" ? " on" : "")} title={t("app.side.settingsTitle")} onClick={() => onRoute({ kind: "settings", tab: "geral" })} data-testid="settings"><IGear /></button>
      </div>

      {drag && createPortal(<div className="drag-ghost" style={{ left: drag.x + 10, top: drag.y + 6 }}>{wsTitle(drag.w)}</div>, document.body)}

      {menu && createPortal(
        <div ref={menuRef} className="popover status-pop ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.min(menu.y, window.innerHeight - 330) }} data-testid={`${menu.kind}-ctx`}>
          {menu.kind === "ws" && (() => {
            const w = menu.w;
            const close = () => setMenu(null);
            return (
              <>
                <div className="pop-row" onClick={() => (close(), onRoute({ kind: "workspace", id: w.id }))}>{t("common.open")}</div>
                <div className="pop-row" onClick={() => (close(), patch(w, { unread: !w.unread }))} data-testid="ctx-read">{w.unread ? t("app.side.markRead") : t("app.side.markUnread")}<span className="grow" /><span className="kbd-hint">R</span></div>
                <div className="pop-row" onClick={() => (close(), patch(w, { pinned: !w.pinned, pin_order: pinned.length }))} data-testid="ctx-pin">{w.pinned ? t("app.side.unpin") : t("app.side.pin")}<span className="grow" /><span className="kbd-hint">P</span></div>
                <div className="pop-row sub" onMouseEnter={() => setSub("status")} onClick={() => setSub("status")} data-testid="ctx-status">{t("app.side.groupStatus")} <span className="grow" />▸
                  {sub === "status" && (
                    <div className="popover status-pop submenu-pop">
                      {STATUS_ORDER.map((st) => <div key={st} className={"pop-row" + (w.status === st ? " on" : "")} onClick={(e) => (e.stopPropagation(), close(), patch(w, { status: st }))} data-testid={`ctx-status-${st}`}><span className={"st-icon st-" + st} /> {STATUS_LABEL[st]}</div>)}
                    </div>
                  )}
                </div>
                <div className="pop-row sub" onMouseEnter={() => setSub("section")} onClick={() => setSub("section")} data-testid="ctx-section">{t("app.side.moveToSection")} <span className="grow" />▸
                  {sub === "section" && (
                    <div className="popover status-pop submenu-pop">
                      {sections.map((s) => <div key={s.id} className={"pop-row" + (w.section === s.id ? " on" : "")} onClick={(e) => (e.stopPropagation(), close(), patch(w, { section: s.id, pinned: false }))} data-testid="ctx-section-item">{s.emoji} {s.name}</div>)}
                      {w.section && <div className="pop-row" onClick={(e) => (e.stopPropagation(), close(), patch(w, { section: "" }))}>{t("app.side.removeFromSection")}</div>}
                      <div className="pop-sep" />
                      <div className="pop-row" onClick={(e) => (e.stopPropagation(), close(), setDialog({ kind: "section", ws: w.id }))} data-testid="ctx-section-new">{t("app.side.newSection")}</div>
                    </div>
                  )}
                </div>
                <div className="pop-sep" />
                <div className="pop-row" onClick={() => (close(), setDialog({ kind: "rename", w }))} data-testid="ctx-rename">{t("app.side.renameDots")}</div>
                <div className="pop-row" onClick={() => (close(), navigator.clipboard.writeText(workspaceLink(w)))} data-testid="ctx-link">{t("app.side.copyLink")}<span className="grow" /><span className="kbd-hint">⌘⇧C</span></div>
                <div className="pop-row" onClick={() => (close(), navigator.clipboard.writeText(w.path))}>{t("app.openIn.copyPath")}</div>
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={() => (close(), window.dispatchEvent(new CustomEvent("kabul:archive", { detail: w.id })))} data-testid="ctx-archive">{t("app.side.archive")}<span className="grow" /><span className="kbd-hint">⌘⇧A</span></div>
              </>
            );
          })()}
          {menu.kind === "repo" && (() => {
            const r = menu.r;
            const close = () => setMenu(null);
            return (
              <>
                <div className="pop-row" onClick={() => (close(), onCreate(r.id))} data-testid="repo-ctx-create"><IPlus size={14} /> {t("app.pal.g.createWorkspace")}</div>
                <div className="pop-row" onClick={() => (close(), onCreate(r.id, true))} data-testid="repo-ctx-from"><ILink size={14} /> {t("app.side.createFrom")}</div>
                <div className="pop-row" onClick={() => (close(), onRoute({ kind: "settings", tab: "repo", repoId: r.id }))} data-testid="repo-ctx-config"><IGear size={14} /> {t("app.side.repoConfig")}</div>
                <div className="pop-row" onClick={() => (close(), api.repoUpdate(r.id, { hidden: !r.hidden }).then(onChange, (e) => onError(String(e))))} data-testid="repo-ctx-hide">{r.hidden ? <IEye size={14} /> : <IEyeOff size={14} />} {r.hidden ? t("app.side.showRepo") : t("app.side.hideRepo")}</div>
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={async () => { close(); if (await confirmDialog(t("app.side.removeRepoConfirm", { name: r.name }), { ok: t("common.remove"), danger: true })) api.removeRepo(r.id).then(onChange, (e) => onError(String(e))); }} data-testid="repo-ctx-remove"><ITrash size={14} /> {t("app.side.removeRepo")}</div>
              </>
            );
          })()}
          {menu.kind === "section" && (
            <>
              <div className="pop-row" onClick={() => (setMenu(null), setDialog({ kind: "section", s: menu.s }))} data-testid="section-edit">{t("app.side.editSectionDots")}</div>
              <div className="pop-row danger" onClick={() => (setMenu(null), api.sectionDelete(menu.s.id).then(() => (loadSections(), onChange()), (e) => onError(String(e))))} data-testid="section-delete">{t("app.side.deleteSection")}</div>
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
        <div className="dialog-title">{s ? t("app.side.editSection") : t("app.pal.g.newSection")}</div>
        <div className="emoji-grid">{EMOJIS.map((e) => <button key={e} className={"emoji" + (e === emoji ? " on" : "")} onClick={() => setEmoji(e)}>{e}</button>)}</div>
        <input autoFocus {...noSuggest} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("app.side.sectionName")} data-testid="section-name" />
        <div className="row end"><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim(), emoji)} data-testid="section-save">{t("common.save")} <span className="kbd-hint">⌘↵</span></button></div>
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
        <div className="dialog-title">{t("app.side.renameWorkspace")}</div>
        <input autoFocus {...noSuggest} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="rename-title" />
        <label className="check-row"><input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} data-testid="rename-branch" /> {t("app.side.renameBranchToo")} {also && slug && <code>{prefix + slug}</code>}</label>
        <div className="row end"><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" onClick={save} data-testid="rename-save">{t("app.side.renameGo")}</button></div>
      </div>
    </div>, document.body);
}
