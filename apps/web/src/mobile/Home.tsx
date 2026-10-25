import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConnState } from "../transport/websocket";
import { RepoIcon } from "../components/RepoIcon";
import type { ExternalSessions, Model, Repo, Workspace } from "../api";
import { STATUS_LABEL as WS_STATUS } from "../api";
import { ago, modelFor, workspaceFor } from "../components/external";
import { AGENT_LABEL, canWrite, isOwner, k, me, ws, type LiveSession, type Ticket } from "./kabuld";
import { archiveWorkspace, refresh, setListPrefs, useKabul, useListPrefs, type ListPrefs } from "./data";
import { openSession, push } from "./nav";
import { ModelSheet } from "./ModelSheet";
import { FilesButton } from "./preview";
import { openFiles } from "./preview/route";
import { AgentIcon, Avatar, Empty, Group, I, NavBar, Row, RoundButton, RunsOnLabel, Segmented, Sheet, StatusPill, Swipe, TicketCard, haptic, useCollapse, useCountdown, usePullToRefresh, type SwipeAction } from "./ui";
import { t } from "../i18n";
import { trError } from "../i18n/errors";

type Filter = "all" | "waiting";
type WsActions = { ws: string; name: string; files: boolean; invite: boolean; chat: boolean };

/** Tela estreita (celular em pé): as ações do workspace vão para o menu "…" e o título fica com a linha. */
const NARROW = "(max-width: 520px)";
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = matchMedia(NARROW);
    const upd = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", upd);
    return () => mq.removeEventListener?.("change", upd);
  }, []);
  return narrow;
}

/** Sessões de fora do Kabul (só o dono): recarrega a cada 15 s. */
function useExternal(on: boolean) {
  const [ext, setExt] = useState<ExternalSessions | null>(null);
  useEffect(() => {
    if (!on) return;
    const load = () => k.external().then(setExt, () => {});
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [on]);
  return ext;
}

const EXTERNAL_RECENT = 10;
/** Linhas da lista com o filtro "Todas": workspaces, sessões (soltas ou dentro deles) e as de fora do Kabul. */
const countRows = (groups: GroupNode[], ext: ExternalSessions | null) =>
  groups.reduce((n, g) => n + g.items.reduce((m, it) => m + (it.kind === "ws" ? 1 + it.sessions.length : 1), 0), 0) + (ext ? ext.running.length + Math.min(ext.recent.length, EXTERNAL_RECENT) : 0);

interface WsNode { kind: "ws"; key: string; ws: Workspace | null; id: string; title: string; branch: string | null; repo: string; sessions: LiveSession[]; activity: number }
interface Loose { kind: "s"; key: string; s: LiveSession }
interface GroupNode { key: string; label: string; repo: string; head: ReactNode; items: (WsNode | Loose)[]; rank: number }

const rankOf = (ss: LiveSession[]) => (ss.some((s) => s.status === "waiting") ? 0 : ss.some((s) => s.status === "working") ? 1 : 2);
const now = () => Date.now() / 1000;

/** Tela inicial: workspaces por repo/seção com as sessões de cada um, ordenar/filtrar, criar. */
export function Home({ conn, onSettings }: { conn: ConnState; onSettings: () => void }) {
  const snap = useKabul();
  const prefs = useListPrefs();
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, onScroll] = useCollapse();
  const [sheet, setSheet] = useState<null | { kind: "sort" } | { kind: "machine" } | { kind: "invite"; ws: string; name: string } | { kind: "chat"; ws: string; name: string } | ({ kind: "ws" } & WsActions)>(null);
  // Do menu "…" para outra folha/tela: fechar a folha volta uma entrada no histórico (assíncrono); abrir a
  // próxima antes disso faria esse "voltar" fechá-la na hora. Então só abre depois do popstate.
  const afterSheet = (next: () => void) => {
    setSheet(null);
    let done = false;
    const go = () => void (!done && ((done = true), next()));
    window.addEventListener("popstate", go, { once: true });
    setTimeout(go, 400);
  };
  const narrow = useNarrow();
  const owner = isOwner();
  const ext = useExternal(owner);
  const ptr = usePullToRefresh(refresh);
  const who = me();
  const { list, workspaces, repos, sections } = snap;
  const waiting = list.filter((s) => s.status === "waiting").length;

  const repoIds = useMemo(() => repos.map((r) => ({ id: r.id, name: r.name, icon: r.icon, github_avatar: r.github_avatar })), [repos]);
  const groups = useMemo(() => buildGroups(list, workspaces, repoIds, sections, prefs, filter), [list, workspaces, repoIds, sections, prefs, filter]);
  // "Todas" conta o que a lista mostra com esse filtro (antes contava só as sessões ao vivo: 0 com o computador parado).
  const allGroups = useMemo(() => (filter === "all" ? groups : buildGroups(list, workspaces, repoIds, sections, prefs, "all")), [filter, groups, list, workspaces, repoIds, sections, prefs]);
  const total = countRows(allGroups, owner ? ext : null);
  const reorder = (g: GroupNode, from: string, to: string) => {
    const ids = g.items.filter((x): x is WsNode => x.kind === "ws" && !!x.ws).map((x) => x.id);
    const a = ids.indexOf(from);
    const b = ids.indexOf(to);
    if (a < 0 || b < 0 || a === b) return;
    ids.splice(b, 0, ...ids.splice(a, 1));
    void Promise.all(ids.map((id, i) => k.workspaceUpdate(id, { pin_order: i }))).then(refresh);
  };

  return (
    <div className="m-page" data-testid="m-list">
      <NavBar
        collapsed={collapsed}
        left={
          <button className="m-round avatar" onClick={(e) => (haptic(e.currentTarget), onSettings())} aria-label={t("mobile.home.settings")} data-testid="m-menu">
            {who ? <Avatar name={who.user} color={who.color || "#8a847f"} size={36} /> : <I.gear size={20} />}
          </button>
        }
        right={
          <>
            <RoundButton onClick={() => setSheet({ kind: "sort" })} label={t("mobile.home.sortFilter")} testid="m-sort"><I.filter /></RoundButton>
            <button className="m-pill" onClick={(e) => (haptic(e.currentTarget), setSheet({ kind: "machine" }))} data-testid="m-machine-pill">
              <span className={`m-conn m-conn-${conn}`} title={conn === "open" ? t("mobile.home.connected") : t("mobile.home.reconnecting")} data-testid="m-conn" />
              <span className="m-ellipsis" data-testid="m-machine">{snap.machine || "Kabul"}</span>
              <I.updown />
            </button>
          </>
        }
      />
      <main className={"m-scroll has-tabbar" + (owner ? " has-fab" : "")} onScroll={onScroll} {...ptr.handlers}>
        {ptr.indicator}
        <h1 className="m-large-title">{t("mobile.home.title")}</h1>
        <div className="m-under-title">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { v: "all", label: <>{t("mobile.home.all")} {snap.loaded && <span className="dim" data-testid="m-count-all">{total}</span>}</> },
              { v: "waiting", label: <>{t("mobile.home.waitingYou")} {waiting > 0 && <span className="m-count">{waiting}</span>}</>, testid: "m-filter-waiting" },
            ]}
          />
        </div>
        {snap.err && <div className="m-error">{trError(snap.err)}</div>}
        {/* Ainda sem conexão e sem dados: diz o que está acontecendo (antes ficava "Todas 0" e a lista vazia). */}
        {!snap.loaded && conn !== "open" && (
          <div className="m-empty m-connecting" data-testid="m-connecting">
            <span className="m-spinner" aria-hidden="true" />
            <b>{t("mobile.home.connecting")}</b>
            <span>{t("mobile.home.connectingSub")}</span>
            <button className="m-chip-btn" onClick={(e) => (haptic(e.currentTarget), ws()?.reconnect())} data-testid="m-reconnect">{t("mobile.home.tryNow")}</button>
          </div>
        )}
        {snap.loaded && groups.length === 0 && (
          filter === "waiting" ? <Empty testid="m-empty" title={t("mobile.home.emptyWaiting")} sub={t("mobile.home.emptyWaitingSub")} /> : <Empty testid="m-empty" title={t("mobile.home.empty")} sub={t("mobile.home.emptySub")} />
        )}
        {groups.map((g) => (
          <section key={g.key} className="m-group" data-testid="m-group" data-repo={g.repo}>
            <div className="m-grp-head">{g.head}</div>
            <div className="m-grp-body">
              {g.items.map((it) =>
                it.kind === "ws" ? (
                  <WsBlock key={it.key} n={it} manual={prefs.manual && !!it.ws} onDrop={(to) => reorder(g, it.id, to)} onChat={() => setSheet({ kind: "chat", ws: it.id, name: it.title })} onInvite={() => setSheet({ kind: "invite", ws: it.id, name: it.title })} narrow={narrow} onMore={(a) => setSheet({ kind: "ws", ...a })} os={snap.os} machine={snap.machine} />
                ) : (
                  <SessionRow key={it.key} s={it.s} os={snap.os} machine={snap.machine} />
                ),
              )}
            </div>
          </section>
        ))}
        {owner && filter === "all" && <ExternalSection ext={ext} />}
        <div className="m-scroll-end" />
      </main>
      {owner && (
        <button className="m-fab" onClick={(e) => (haptic(e.currentTarget), push("v=new"))} data-testid="m-create">
          <I.plus size={20} /> {t("mobile.home.create")}
        </button>
      )}
      {sheet?.kind === "sort" && <SortSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === "machine" && <MachineSheet conn={conn} onClose={() => setSheet(null)} />}
      {sheet?.kind === "ws" && (
        <Sheet title={sheet.name} onClose={() => setSheet(null)} testid="m-ws-actions">
          <Group>
            {sheet.files && <Row icon={<I.folder />} title={t("mobile.pv.files")} onClick={() => afterSheet(() => openFiles(sheet.ws))} testid="m-files" />}
            {sheet.invite && <Row icon={<I.personPlus />} title={t("mobile.home.invite")} onClick={() => afterSheet(() => setSheet({ kind: "invite", ws: sheet.ws, name: sheet.name }))} testid="m-invite" />}
            {sheet.chat && <Row icon={<I.chatPlus />} title={t("common.newChat")} onClick={() => afterSheet(() => setSheet({ kind: "chat", ws: sheet.ws, name: sheet.name }))} testid="m-new-chat" />}
          </Group>
        </Sheet>
      )}
      {sheet?.kind === "invite" && <InviteSheet ws={sheet.ws} name={sheet.name} onClose={() => setSheet(null)} />}
      {sheet?.kind === "chat" && (
        <ModelSheet
          title={t("mobile.home.newChatIn", { name: sheet.name })}
          testid="m-chat-sheet"
          mode="start"
          onClose={() => setSheet(null)}
          onPick={(m, o) => k.chatStart(sheet.ws, m, undefined, o).then((c) => (setSheet(null), openSession(`chat:${c.id}`)))}
        />
      )}
    </div>
  );
}

// ---------------- montagem dos grupos ----------------

function buildGroups(list: LiveSession[], wss: Workspace[], repos: Pick<Repo, "id" | "name" | "icon" | "github_avatar">[], sections: { id: string; name: string; emoji: string; order: number }[], p: ListPrefs, filter: Filter): GroupNode[] {
  const shown = filter === "waiting" ? list.filter((s) => s.status === "waiting") : list;
  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? "?";
  const byWs = new Map<string, LiveSession[]>();
  const loose: LiveSession[] = [];
  for (const s of shown) {
    const id = s.group.workspace_id;
    if (id) byWs.set(id, [...(byWs.get(id) ?? []), s]);
    else loose.push(s);
  }
  const nodes: WsNode[] = [];
  const seen = new Set<string>();
  const activity = (ss: LiveSession[], created: number) => (ss.length ? Math.max(...ss.map((s) => now() - s.idle_secs)) : created);
  for (const w of wss) {
    seen.add(w.id);
    if (p.workspaces === "active" && w.archived) continue;
    if (p.workspaces === "archived" && !w.archived) continue;
    const ss = byWs.get(w.id) ?? [];
    if (filter === "waiting" && !ss.length) continue;
    nodes.push({ kind: "ws", key: w.id, ws: w, id: w.id, title: w.title || w.name, branch: w.branch, repo: repoName(w.repo_id), sessions: ss, activity: activity(ss, w.created_at) });
  }
  // Sessões de workspaces que a lista não trouxe (ex.: estado ainda carregando).
  for (const [id, ss] of byWs) {
    if (seen.has(id) || p.workspaces === "archived") continue;
    const g = ss[0].group;
    nodes.push({ kind: "ws", key: id, ws: null, id, title: g.workspace ?? g.repo, branch: null, repo: g.repo, sessions: ss, activity: activity(ss, 0) });
  }
  const repoOk = (r: string) => p.repo === "all" || p.repo === r;
  const secOk = (w: WsNode) => p.section === "all" || w.ws?.section === p.section;
  const vis = nodes.filter((n) => repoOk(n.repo) && secOk(n));
  const looseVis = p.section === "all" && p.workspaces !== "archived" ? loose.filter((s) => repoOk(s.group.repo) || s.group.key === "outras") : [];

  const order = (a: WsNode, b: WsNode) =>
    p.manual ? (a.ws?.pin_order ?? 1e9) - (b.ws?.pin_order ?? 1e9) || b.activity - a.activity : rankOf(a.sessions) - rankOf(b.sessions) || b.activity - a.activity;
  const sessOrder = (a: LiveSession, b: LiveSession) => rankOf([a]) - rankOf([b]) || a.idle_secs - b.idle_secs;
  vis.forEach((n) => n.sessions.sort(sessOrder));

  // "Outras sessões" é o rótulo que o kabuld dá às sessões soltas (dado, não texto da tela). i18n-ignore
  const repoHead = (r: string) => (r === "Outras sessões" ? <span className="m-grp-title">{t("mobile.home.otherSessions")}</span> : <><RepoIcon repo={repos.find((x) => x.name === r)} name={r || "?"} size={16} /><span className="m-grp-title">{r}</span></>);

  if (p.sort === "recent") {
    const items: (WsNode | Loose)[] = [...vis.map((n) => n as WsNode | Loose), ...looseVis.map((s) => ({ kind: "s" as const, key: s.id, s }))];
    const act = (x: WsNode | Loose) => (x.kind === "ws" ? x.activity : now() - x.s.idle_secs);
    items.sort((a, b) => act(b) - act(a));
    return items.length ? [{ key: "recentes", label: t("mobile.home.recent"), repo: "Recentes", head: <span className="m-grp-title">{t("mobile.home.recentActivity")}</span>, items, rank: 0 }] : [];
  }

  const groups = new Map<string, GroupNode>();
  const put = (key: string, label: string, head: ReactNode, rank: number, item: WsNode | Loose, repo = label) => {
    const g = groups.get(key) ?? { key, label, repo, head, items: [], rank };
    g.items.push(item);
    groups.set(key, g);
  };
  const secs = [...sections].sort((a, b) => a.order - b.order);
  for (const n of vis) {
    const sec = p.sort === "sections" && n.ws?.section ? secs.find((s) => s.id === n.ws!.section) : undefined;
    if (p.sort === "sections" && n.ws?.pinned) put("pinned", t("mobile.home.pinned"), <><span className="m-grp-emoji">📌</span><span className="m-grp-title">{t("mobile.home.pinned")}</span></>, -2, n);
    else if (sec) put(`sec:${sec.id}`, sec.name, <><span className="m-grp-emoji">{sec.emoji || "▪︎"}</span><span className="m-grp-title">{sec.name}</span></>, -1 + secs.indexOf(sec) / 1000, n);
    else put(`repo:${n.repo}`, n.repo, repoHead(n.repo), 0, n);
  }
  for (const s of looseVis) put(s.group.key === "outras" ? "outras" : `repo:${s.group.repo}`, s.group.repo, repoHead(s.group.repo), 0, { kind: "s", key: s.id, s });
  const all = [...groups.values()];
  for (const g of all) {
    const ws = g.items.filter((x): x is WsNode => x.kind === "ws").sort(order);
    const ls = g.items.filter((x): x is Loose => x.kind === "s").sort((a, b) => sessOrder(a.s, b.s));
    g.items = [...ws, ...ls];
    const ss = g.items.flatMap((x) => (x.kind === "ws" ? x.sessions : [x.s]));
    if (g.rank === 0) g.rank = g.key === "outras" ? 9 : rankOf(ss);
  }
  return all.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

// ---------------- linhas ----------------

function WsBlock({ n, manual, narrow, onDrop, onChat, onInvite, onMore, os, machine }: { n: WsNode; manual: boolean; narrow: boolean; onDrop: (to: string) => void; onChat: () => void; onInvite: () => void; onMore: (a: WsActions) => void; os: string; machine: string }) {
  const w = n.ws;
  const owner = isOwner();
  const [over, setOver] = useState(false);
  const actions: SwipeAction[] = [];
  if (owner && w) {
    actions.push({ label: w.pinned ? t("mobile.home.unpin") : t("mobile.home.pin"), tone: "orange", icon: <span>📌</span>, onClick: () => void k.workspaceUpdate(w.id, { pinned: !w.pinned }).then(refresh), testid: "m-ws-pin" });
    actions.push({ label: w.archived ? t("mobile.home.restore") : t("mobile.home.archive"), tone: w.archived ? "blue" : "gray", icon: <ArchiveIcon />, onClick: () => void archiveWorkspace(w.id, !w.archived), testid: "m-ws-archive" });
  }
  const drag = useDragHandle(n.id, onDrop, setOver);
  const status = w ? WS_STATUS[w.status] ?? w.status : null;
  const can = { files: !!w && !w.archived, invite: owner && !w?.archived, chat: canWrite() && !w?.archived };
  return (
    <div className={"m-ws" + (w?.archived ? " archived" : "") + (over ? " drop" : "")} data-ws-row={n.id}>
      <Swipe actions={actions}>
        <div className="m-row m-ws-row" data-testid="m-ws" data-ws={n.id}>
          <span className="m-row-icon m-ws-icon"><I.branch /></span>
          <span className="m-row-text">
            <span className="m-row-title">{n.title}{w?.unread && <span className="m-unread" aria-label={t("mobile.home.new")} />}</span>
            <span className="m-row-sub">{[n.branch, status, w?.archived ? t("mobile.home.archived") : null].filter(Boolean).join(" · ")}</span>
          </span>
          {narrow && (can.files || can.invite || can.chat) && (
            <button className="m-icon-btn" onClick={(e) => (haptic(e.currentTarget), onMore({ ws: n.id, name: n.title, ...can }))} data-testid="m-ws-more" aria-label={t("mobile.home.wsActions")}>
              <I.more />
            </button>
          )}
          {!narrow && can.files && <FilesButton ws={n.id} small />}
          {!narrow && can.invite && (
            <button className="m-icon-btn" onClick={(e) => (haptic(e.currentTarget), onInvite())} data-testid="m-invite" aria-label={t("mobile.home.invite")}>
              <I.personPlus />
            </button>
          )}
          {!narrow && can.chat && (
            <button className="m-icon-btn" onClick={(e) => (haptic(e.currentTarget), onChat())} data-testid="m-new-chat" aria-label={t("common.newChat")}>
              <I.chatPlus />
            </button>
          )}
          {manual && (
            <span className="m-grip" {...drag} aria-label={t("mobile.home.dragReorder")} data-testid="m-grip">
              <I.grip />
            </span>
          )}
        </div>
      </Swipe>
      {n.sessions.map((s) => (
        <SessionRow key={s.id} s={s} os={os} machine={machine} nested />
      ))}
    </div>
  );
}

const ArchiveIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="4.5" rx="1" /><path d="M5 9v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></svg>
);

/** Arrastar pela alça (toque ou ponteiro): solta sobre outra linha de workspace do mesmo grupo. */
function useDragHandle(id: string, onDrop: (to: string) => void, setOver: (b: boolean) => void) {
  const last = useRef<HTMLElement | null>(null);
  const target = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-ws-row]") ?? null;
  const mark = (el: HTMLElement | null) => {
    if (last.current && last.current !== el) last.current.classList.remove("drop");
    if (el && el.dataset.wsRow !== id) el.classList.add("drop");
    last.current = el;
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setOver(true);
      haptic(e.currentTarget);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => e.currentTarget.hasPointerCapture(e.pointerId) && mark(target(e.clientX, e.clientY)),
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      setOver(false);
      const tgt = target(e.clientX, e.clientY);
      mark(null);
      if (tgt && tgt.dataset.wsRow && tgt.dataset.wsRow !== id) onDrop(tgt.dataset.wsRow);
    },
  };
}

function SessionRow({ s, os, machine, nested }: { s: LiveSession; os: string; machine: string; nested?: boolean }) {
  const chat = s.kind === "chat";
  const chatId = s.id.slice(5);
  const actions: SwipeAction[] = [];
  if (canWrite() && s.status !== "idle")
    actions.push({
      label: t("common.stop"),
      tone: "red",
      icon: <I.stop size={16} />,
      onClick: () => void (chat ? k.chatStop(chatId) : s.pane ? k.termKeys(s.name, s.pane, ["C-c"]) : Promise.resolve()).catch(() => {}),
      testid: "m-swipe-stop",
    });
  if (isOwner() && chat) actions.push({ label: t("mobile.home.archive"), tone: "gray", icon: <ArchiveIcon />, onClick: () => void k.chatClose(chatId).then(refresh, () => {}), testid: "m-swipe-archive" });
  const sub = s.status === "waiting" && s.detail ? s.detail : chat ? s.preview : `${AGENT_LABEL[s.agent] ?? s.agent} · ${s.preview}`;
  return (
    <Swipe actions={actions} className={nested ? "nested" : ""}>
      <button className={`m-row tappable m-session m-session-${s.status}`} onClick={(e) => (haptic(e.currentTarget), openSession(s.id))} data-testid="m-session" data-id={s.id}>
        <AgentIcon agent={s.agent} size={30} status={s.status} />
        <span className="m-row-text">
          <span className="m-row-title">{s.name}</span>
          <span className="m-session-line">
            <StatusPill status={s.status} detail={s.detail} compact />
            <RunsOnLabel r={s.runs_on} machine={s.machine ?? machine} os={os} />
          </span>
          <span className={"m-session-sub" + (chat ? "" : " mono")}>{sub}</span>
        </span>
        <span className="m-row-chev"><I.chevron /></span>
      </button>
    </Swipe>
  );
}

// ---------------- folhas ----------------

function SortSheet({ onClose }: { onClose: () => void }) {
  const p = useListPrefs();
  const { sections, repos } = useKabul();
  const [sub, setSub] = useState<null | "workspaces" | "section" | "repo">(null);
  const wsLabel = { active: t("mobile.home.wsActive"), archived: t("mobile.home.wsArchived"), all: t("mobile.home.wsAll") };
  const secName = p.section === "all" ? t("mobile.home.all") : sections.find((s) => s.id === p.section)?.name ?? t("mobile.home.all");
  const pick = (patch: Partial<ListPrefs>) => (setListPrefs(patch), setSub(null));
  const title = sub === "workspaces" ? t("mobile.home.title") : sub === "section" ? t("mobile.home.sections") : sub === "repo" ? t("mobile.home.repo") : t("mobile.home.sortFilter");
  return (
    <Sheet title={title} onClose={onClose} testid="m-sort-sheet" full onBack={sub ? () => setSub(null) : undefined}>
      {!sub && (
        <>
          <Group header={t("mobile.home.sort")}>
            <Row title={t("mobile.home.sectionsFirst")} check={p.sort === "sections"} onClick={() => setListPrefs({ sort: "sections" })} testid="m-sort-sections" />
            <Row title={t("mobile.home.workspacesFirst")} check={p.sort === "workspaces"} onClick={() => setListPrefs({ sort: "workspaces" })} testid="m-sort-workspaces" />
            <Row title={t("mobile.home.recentActivity")} check={p.sort === "recent"} onClick={() => setListPrefs({ sort: "recent" })} testid="m-sort-recent" />
          </Group>
          <Group header={t("mobile.home.filter")}>
            <Row title={t("mobile.home.title")} value={wsLabel[p.workspaces]} chevron onClick={() => setSub("workspaces")} testid="m-filter-ws" />
            <Row title={t("mobile.home.sections")} value={secName} chevron onClick={() => setSub("section")} />
            <Row title={t("mobile.home.repo")} value={p.repo === "all" ? t("mobile.home.wsAll") : p.repo} chevron onClick={() => setSub("repo")} />
          </Group>
        </>
      )}
      {sub === "workspaces" && (
        <Group>
          {(["active", "archived", "all"] as const).map((v) => (
            <Row key={v} title={wsLabel[v]} check={p.workspaces === v} onClick={() => pick({ workspaces: v })} testid={`m-filter-ws-${v}`} />
          ))}
        </Group>
      )}
      {sub === "section" && (
        <Group footer={sections.length ? undefined : t("mobile.home.createSectionsHint")}>
          <Row title={t("mobile.home.all")} check={p.section === "all"} onClick={() => pick({ section: "all" })} />
          {[...sections].sort((a, b) => a.order - b.order).map((s) => (
            <Row key={s.id} icon={<span>{s.emoji || "▪︎"}</span>} title={s.name} check={p.section === s.id} onClick={() => pick({ section: s.id })} />
          ))}
        </Group>
      )}
      {sub === "repo" && (
        <Group>
          <Row title={t("mobile.home.wsAll")} check={p.repo === "all"} onClick={() => pick({ repo: "all" })} />
          {repos.map((r) => (
            <Row key={r.id} icon={<RepoIcon repo={r} size={22} />} title={r.name} sub={r.default_branch} check={p.repo === r.name} onClick={() => pick({ repo: r.name })} />
          ))}
        </Group>
      )}
    </Sheet>
  );
}

function MachineSheet({ conn, onClose }: { conn: ConnState; onClose: () => void }) {
  const { machine, os, list } = useKabul();
  const sistema = os === "macos" ? "macOS" : os === "windows" ? "Windows" : os === "linux" ? "Linux" : os || "—";
  return (
    <Sheet title={t("mobile.home.thisComputer")} onClose={onClose} testid="m-machine-sheet">
      <Group footer={t("mobile.home.machineFooter")}>
        <Row icon={<I.laptop />} title={machine || "—"} sub={sistema} check />
        <Row title={t("mobile.home.connection")} value={<span className="m-conn-label"><span className={`m-conn m-conn-${conn}`} />{conn === "open" ? t("mobile.home.connected") : t("mobile.home.reconnecting")}</span>} />
        <Row title={t("mobile.home.sessions")} value={String(list.length)} />
      </Group>
      <Group>
        <Row title={t("mobile.home.refreshNow")} onClick={() => void refresh().then(onClose)} />
      </Group>
    </Sheet>
  );
}

function InviteSheet({ ws: wsId, name, onClose }: { ws: string; name: string; onClose: () => void }) {
  const [role, setRole] = useState<"editor" | "observer">("editor");
  const [tk, setTk] = useState<Ticket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const left = useCountdown(tk?.expires_at ?? null);
  const make = () => k.invite(wsId, role).then(setTk, (e) => setErr(String(e)));
  return (
    <Sheet title={t("mobile.home.inviteTo", { name })} onClose={onClose} testid="m-invite-sheet">
      <p className="m-sheet-note">{t("mobile.home.inviteNote")}</p>
      <div className="m-pad">
        <Segmented
          value={role}
          onChange={(v) => (setRole(v), setTk(null))}
          options={[
            { v: "editor", label: t("mobile.home.editor"), testid: "m-role-editor" },
            { v: "observer", label: t("mobile.home.observer"), testid: "m-role-observer" },
          ]}
        />
      </div>
      {!tk && <div className="m-pad"><button className="m-cta" onClick={make} data-testid="m-invite-go">{t("mobile.home.makeInvite")}</button></div>}
      {tk && <TicketCard svg={tk.qr_svg} url={tk.url} left={left} onRegen={make} />}
      {err && <div className="m-error">{trError(err)}</div>}
    </Sheet>
  );
}

/** Agentes e sessões de fora do Kabul (só o dono vê): mesma lista do Painel do desktop. */
function ExternalSection({ ext }: { ext: ExternalSessions | null }) {
  const { workspaces: wss } = useKabul();
  const [models, setModels] = useState<Model[]>([]);
  // O motivo de não continuar aparece logo abaixo da linha tocada (no topo da seção ninguém via).
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null);
  useEffect(() => void k.models().then(setModels, () => {}), []);
  if (!ext || (!ext.running.length && !ext.recent.length)) return null;
  const nowS = now();
  const cont = async (key: string, agent: string, id: string, cwd: string | null) => {
    setErr(null);
    const w = workspaceFor(cwd, wss);
    if (!w) return setErr({ key, msg: t("mobile.home.noWorkspaceHere") });
    // A lista de modelos pode demorar (o Codex lista pelo app-server): espera aqui se ainda não chegou.
    const m = modelFor(agent, models.length ? models : await k.models().catch(() => []));
    if (!m) return setErr({ key, msg: t("mobile.home.noModelFor", { agent }) });
    k.chatStart(w.id, m, id).then((c) => openSession(`chat:${c.id}`), (e) => setErr({ key, msg: String(e) }));
  };
  // Sem repositório vale o nome da pasta (o "?" não dizia nada); sem pasta, nada.
  const where = (repo: string | null, cwd: string | null) => repo || cwd?.replace(/\/+$/, "").split("/").pop() || null;
  const label = (agent: string) => AGENT_LABEL[agent] ?? agent;
  const row = (key: string, agent: string, title: string, sub: string, id: string | null, cwd: string | null, testid: string) => (
    <div key={key} className="m-external-item">
      <div className="m-row m-external" data-testid={testid}>
        <AgentIcon agent={agent} size={30} />
        <span className="m-row-text">
          <span className="m-row-title">{title}</span>
          <span className="m-row-sub">{sub}</span>
        </span>
        {/* Sem id de sessão não há o que continuar: sem botão (apagado, parecia quebrado). */}
        {id && <button className="m-chip-btn" onClick={(e) => (haptic(e.currentTarget), cont(key, agent, id, cwd))} data-testid="m-external-continue">{t("common.continue")}</button>}
      </div>
      {err?.key === key && <div className="m-external-why" data-testid="m-external-why">{trError(err.msg)}</div>}
    </div>
  );
  return (
    <section className="m-group" data-testid="m-external">
      <div className="m-grp-head"><span className="m-grp-title">{t("mobile.home.outsideKabul")}</span></div>
      <div className="m-grp-body">
        {ext.running.map((r) => {
          const w = where(r.repo, r.cwd);
          return row(`r${r.pid}`, r.agent, w ? `${label(r.agent)} · ${w}` : label(r.agent), `${r.terminal ?? t("mobile.home.otherTerminal")} · ${ago(r.running_secs)}${r.branch ? ` · ${r.branch}` : ""}`, r.session_id, r.cwd, "m-external-running");
        })}
        {ext.recent.slice(0, EXTERNAL_RECENT).map((r) => {
          const w = where(r.repo, r.cwd);
          const sub = w ? t("mobile.home.recentSub", { agent: label(r.agent), repo: w, ago: ago(nowS - r.updated) }) : t("mobile.home.recentSubNoRepo", { agent: label(r.agent), ago: ago(nowS - r.updated) });
          return row(`h${r.agent}${r.id}`, r.agent, r.title, sub, r.id, r.cwd, "m-external-recent");
        })}
      </div>
    </section>
  );
}
