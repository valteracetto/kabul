import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConnState } from "../transport/websocket";
import { RepoMark } from "../icons";
import type { ExternalSessions, Model, Workspace } from "../api";
import { STATUS_LABEL as WS_STATUS } from "../api";
import { ago, modelFor, workspaceFor } from "../components/external";
import { AGENT_LABEL, canWrite, isOwner, k, me, type LiveSession, type Ticket } from "./kabuld";
import { refresh, setListPrefs, useKabul, useListPrefs, type ListPrefs } from "./data";
import { openSession, push } from "./nav";
import { ModelSheet } from "./ModelSheet";
import { FilesButton } from "./preview";
import { AgentIcon, Avatar, Empty, Group, I, NavBar, Row, RoundButton, RunsOnLabel, Segmented, Sheet, StatusPill, Swipe, TicketCard, haptic, useCollapse, useCountdown, usePullToRefresh, type SwipeAction } from "./ui";

type Filter = "all" | "waiting";

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
  const [sheet, setSheet] = useState<null | { kind: "sort" } | { kind: "machine" } | { kind: "invite"; ws: string; name: string } | { kind: "chat"; ws: string; name: string }>(null);
  const ptr = usePullToRefresh(refresh);
  const who = me();
  const { list, workspaces, repos, sections } = snap;
  const waiting = list.filter((s) => s.status === "waiting").length;

  const groups = useMemo(() => buildGroups(list, workspaces, repos.map((r) => ({ id: r.id, name: r.name })), sections, prefs, filter), [list, workspaces, repos, sections, prefs, filter]);
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
          <button className="m-round avatar" onClick={(e) => (haptic(e.currentTarget), onSettings())} aria-label="Configurações" data-testid="m-menu">
            {who ? <Avatar name={who.user} color={who.color || "#8a847f"} size={36} /> : <I.gear size={20} />}
          </button>
        }
        right={
          <>
            <RoundButton onClick={() => setSheet({ kind: "sort" })} label="Ordenar e filtrar" testid="m-sort"><I.filter /></RoundButton>
            <button className="m-pill" onClick={(e) => (haptic(e.currentTarget), setSheet({ kind: "machine" }))} data-testid="m-machine-pill">
              <span className={`m-conn m-conn-${conn}`} title={conn === "open" ? "Conectado" : "Reconectando…"} data-testid="m-conn" />
              <span className="m-ellipsis" data-testid="m-machine">{snap.machine || "Kabul"}</span>
              <I.updown />
            </button>
          </>
        }
      />
      <main className="m-scroll has-tabbar" onScroll={onScroll} {...ptr.handlers}>
        {ptr.indicator}
        <h1 className="m-large-title">Workspaces</h1>
        <div className="m-under-title">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { v: "all", label: <>Todas <span className="dim">{list.length}</span></> },
              { v: "waiting", label: <>Esperando você {waiting > 0 && <span className="m-count">{waiting}</span>}</>, testid: "m-filter-waiting" },
            ]}
          />
        </div>
        {snap.err && <div className="m-error">{snap.err}</div>}
        {snap.loaded && groups.length === 0 && (
          filter === "waiting" ? <Empty testid="m-empty" title="Ninguém esperando você" sub="Quando um agente pedir uma decisão, ele aparece aqui." /> : <Empty testid="m-empty" title="Nenhuma sessão rodando" sub="Sessões e workspaces deste computador aparecem aqui sozinhos." />
        )}
        {groups.map((g) => (
          <section key={g.key} className="m-group" data-testid="m-group" data-repo={g.repo}>
            <div className="m-grp-head">{g.head}</div>
            <div className="m-grp-body">
              {g.items.map((it) =>
                it.kind === "ws" ? (
                  <WsBlock key={it.key} n={it} manual={prefs.manual && !!it.ws} onDrop={(to) => reorder(g, it.id, to)} onChat={() => setSheet({ kind: "chat", ws: it.id, name: it.title })} onInvite={() => setSheet({ kind: "invite", ws: it.id, name: it.title })} os={snap.os} machine={snap.machine} />
                ) : (
                  <SessionRow key={it.key} s={it.s} os={snap.os} machine={snap.machine} />
                ),
              )}
            </div>
          </section>
        ))}
        {isOwner() && filter === "all" && <ExternalSection />}
        <div className="m-scroll-end" />
      </main>
      {isOwner() && (
        <button className="m-fab" onClick={(e) => (haptic(e.currentTarget), push("v=new"))} data-testid="m-create">
          <I.plus size={20} /> Criar
        </button>
      )}
      {sheet?.kind === "sort" && <SortSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === "machine" && <MachineSheet conn={conn} onClose={() => setSheet(null)} />}
      {sheet?.kind === "invite" && <InviteSheet ws={sheet.ws} name={sheet.name} onClose={() => setSheet(null)} />}
      {sheet?.kind === "chat" && (
        <ModelSheet
          title={`Nova conversa em ${sheet.name}`}
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

function buildGroups(list: LiveSession[], wss: Workspace[], repos: { id: string; name: string }[], sections: { id: string; name: string; emoji: string; order: number }[], p: ListPrefs, filter: Filter): GroupNode[] {
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

  const repoHead = (r: string) => (r === "Outras sessões" ? <span className="m-grp-title">Outras sessões</span> : <><RepoMark name={r || "?"} size={16} /><span className="m-grp-title">{r}</span></>);

  if (p.sort === "recent") {
    const items: (WsNode | Loose)[] = [...vis.map((n) => n as WsNode | Loose), ...looseVis.map((s) => ({ kind: "s" as const, key: s.id, s }))];
    const act = (x: WsNode | Loose) => (x.kind === "ws" ? x.activity : now() - x.s.idle_secs);
    items.sort((a, b) => act(b) - act(a));
    return items.length ? [{ key: "recentes", label: "Recentes", repo: "Recentes", head: <span className="m-grp-title">Atividade recente</span>, items, rank: 0 }] : [];
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
    if (p.sort === "sections" && n.ws?.pinned) put("pinned", "Fixados", <><span className="m-grp-emoji">📌</span><span className="m-grp-title">Fixados</span></>, -2, n);
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

function WsBlock({ n, manual, onDrop, onChat, onInvite, os, machine }: { n: WsNode; manual: boolean; onDrop: (to: string) => void; onChat: () => void; onInvite: () => void; os: string; machine: string }) {
  const w = n.ws;
  const owner = isOwner();
  const [over, setOver] = useState(false);
  const actions: SwipeAction[] = [];
  if (owner && w) {
    actions.push({ label: w.pinned ? "Desafixar" : "Fixar", tone: "orange", icon: <span>📌</span>, onClick: () => void k.workspaceUpdate(w.id, { pinned: !w.pinned }).then(refresh), testid: "m-ws-pin" });
    actions.push({ label: w.archived ? "Restaurar" : "Arquivar", tone: w.archived ? "blue" : "gray", icon: <ArchiveIcon />, onClick: () => void k.workspaceArchive(w.id, !w.archived).then(refresh, (e) => alert(String(e))), testid: "m-ws-archive" });
  }
  const drag = useDragHandle(n.id, onDrop, setOver);
  const status = w ? WS_STATUS[w.status] ?? w.status : null;
  return (
    <div className={"m-ws" + (w?.archived ? " archived" : "") + (over ? " drop" : "")} data-ws-row={n.id}>
      <Swipe actions={actions}>
        <div className="m-row m-ws-row" data-testid="m-ws" data-ws={n.id}>
          <span className="m-row-icon m-ws-icon"><I.branch /></span>
          <span className="m-row-text">
            <span className="m-row-title">{n.title}{w?.unread && <span className="m-unread" aria-label="Novidade" />}</span>
            <span className="m-row-sub">{[n.branch, status, w?.archived ? "arquivado" : null].filter(Boolean).join(" · ")}</span>
          </span>
          {w && !w.archived && <FilesButton ws={w.id} small />}
          {owner && !w?.archived && (
            <button className="m-icon-btn" onClick={(e) => (haptic(e.currentTarget), onInvite())} data-testid="m-invite" aria-label="Convidar">
              <I.personPlus />
            </button>
          )}
          {canWrite() && !w?.archived && (
            <button className="m-icon-btn" onClick={(e) => (haptic(e.currentTarget), onChat())} data-testid="m-new-chat" aria-label="Nova conversa">
              <I.chatPlus />
            </button>
          )}
          {manual && (
            <span className="m-grip" {...drag} aria-label="Arrastar para reordenar" data-testid="m-grip">
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
      const t = target(e.clientX, e.clientY);
      mark(null);
      if (t && t.dataset.wsRow && t.dataset.wsRow !== id) onDrop(t.dataset.wsRow);
    },
  };
}

function SessionRow({ s, os, machine, nested }: { s: LiveSession; os: string; machine: string; nested?: boolean }) {
  const chat = s.kind === "chat";
  const chatId = s.id.slice(5);
  const actions: SwipeAction[] = [];
  if (canWrite() && s.status !== "idle")
    actions.push({
      label: "Parar",
      tone: "red",
      icon: <I.stop size={16} />,
      onClick: () => void (chat ? k.chatStop(chatId) : s.pane ? k.termKeys(s.name, s.pane, ["C-c"]) : Promise.resolve()).catch(() => {}),
      testid: "m-swipe-stop",
    });
  if (isOwner() && chat) actions.push({ label: "Arquivar", tone: "gray", icon: <ArchiveIcon />, onClick: () => void k.chatClose(chatId).then(refresh, () => {}), testid: "m-swipe-archive" });
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
  const wsLabel = { active: "Ativos", archived: "Arquivados", all: "Todos" };
  const secName = p.section === "all" ? "Todas" : sections.find((s) => s.id === p.section)?.name ?? "Todas";
  const pick = (patch: Partial<ListPrefs>) => (setListPrefs(patch), setSub(null));
  const title = sub === "workspaces" ? "Workspaces" : sub === "section" ? "Seções" : sub === "repo" ? "Repositório" : "Ordenar e filtrar";
  return (
    <Sheet title={title} onClose={onClose} testid="m-sort-sheet" full onBack={sub ? () => setSub(null) : undefined}>
      {!sub && (
        <>
          <Group header="Ordenar">
            <Row title="Seções primeiro" check={p.sort === "sections"} onClick={() => setListPrefs({ sort: "sections" })} testid="m-sort-sections" />
            <Row title="Workspaces primeiro" check={p.sort === "workspaces"} onClick={() => setListPrefs({ sort: "workspaces" })} testid="m-sort-workspaces" />
            <Row title="Atividade recente" check={p.sort === "recent"} onClick={() => setListPrefs({ sort: "recent" })} testid="m-sort-recent" />
          </Group>
          <Group header="Filtrar">
            <Row title="Workspaces" value={wsLabel[p.workspaces]} chevron onClick={() => setSub("workspaces")} testid="m-filter-ws" />
            <Row title="Seções" value={secName} chevron onClick={() => setSub("section")} />
            <Row title="Repositório" value={p.repo === "all" ? "Todos" : p.repo} chevron onClick={() => setSub("repo")} />
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
        <Group footer={sections.length ? undefined : "Crie seções na barra lateral do app desktop."}>
          <Row title="Todas" check={p.section === "all"} onClick={() => pick({ section: "all" })} />
          {[...sections].sort((a, b) => a.order - b.order).map((s) => (
            <Row key={s.id} icon={<span>{s.emoji || "▪︎"}</span>} title={s.name} check={p.section === s.id} onClick={() => pick({ section: s.id })} />
          ))}
        </Group>
      )}
      {sub === "repo" && (
        <Group>
          <Row title="Todos" check={p.repo === "all"} onClick={() => pick({ repo: "all" })} />
          {repos.map((r) => (
            <Row key={r.id} icon={<RepoMark name={r.name} size={22} />} title={r.name} sub={r.default_branch} check={p.repo === r.name} onClick={() => pick({ repo: r.name })} />
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
    <Sheet title="Este computador" onClose={onClose} testid="m-machine-sheet">
      <Group footer="O celular fala com o kabuld deste computador pela sua tailnet. Outras máquinas pareadas aparecem no app desktop.">
        <Row icon={<I.laptop />} title={machine || "—"} sub={sistema} check />
        <Row title="Conexão" value={<span className="m-conn-label"><span className={`m-conn m-conn-${conn}`} />{conn === "open" ? "Conectado" : "Reconectando…"}</span>} />
        <Row title="Sessões" value={String(list.length)} />
      </Group>
      <Group>
        <Row title="Atualizar agora" onClick={() => void refresh().then(onClose)} />
      </Group>
    </Sheet>
  );
}

function InviteSheet({ ws: wsId, name, onClose }: { ws: string; name: string; onClose: () => void }) {
  const [role, setRole] = useState<"editor" | "observer">("editor");
  const [t, setT] = useState<Ticket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const left = useCountdown(t?.expires_at ?? null);
  const make = () => k.invite(wsId, role).then(setT, (e) => setErr(String(e)));
  return (
    <Sheet title={`Convidar para ${name}`} onClose={onClose} testid="m-invite-sheet">
      <p className="m-sheet-note">Quem abrir o link (pela sua tailnet) entra só neste workspace: vê o stream, a conversa e o terminal. Editor também manda mensagens, aprova e digita.</p>
      <div className="m-pad">
        <Segmented
          value={role}
          onChange={(v) => (setRole(v), setT(null))}
          options={[
            { v: "editor", label: "Editor", testid: "m-role-editor" },
            { v: "observer", label: "Observador", testid: "m-role-observer" },
          ]}
        />
      </div>
      {!t && <div className="m-pad"><button className="m-cta" onClick={make} data-testid="m-invite-go">Gerar convite</button></div>}
      {t && <TicketCard svg={t.qr_svg} url={t.url} left={left} onRegen={make} />}
      {err && <div className="m-error">{err}</div>}
    </Sheet>
  );
}

/** Agentes e sessões de fora do Kabul (só o dono vê): mesma lista do Painel do desktop. */
function ExternalSection() {
  const [ext, setExt] = useState<ExternalSessions | null>(null);
  const { workspaces: wss } = useKabul();
  const [models, setModels] = useState<Model[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => k.external().then(setExt, () => {});
    load();
    k.models().then(setModels, () => {});
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!ext || (!ext.running.length && !ext.recent.length)) return null;
  const t = now();
  const cont = async (agent: string, id: string | null, cwd: string | null) => {
    const w = workspaceFor(cwd, wss);
    // A lista de modelos pode demorar (o Codex lista pelo app-server): espera aqui se ainda não chegou.
    const m = modelFor(agent, models.length ? models : await k.models().catch(() => []));
    if (!w || !id || !m) return setErr(!w ? "Nenhum workspace do Kabul nesta pasta." : !id ? "Id da sessão ainda desconhecido." : `Sem modelo do ${agent}.`);
    k.chatStart(w.id, m, id).then((c) => openSession(`chat:${c.id}`), (e) => setErr(String(e)));
  };
  const row = (key: string, agent: string, title: string, sub: string, id: string | null, cwd: string | null, testid: string) => (
    <div key={key} className="m-row m-external" data-testid={testid}>
      <AgentIcon agent={agent} size={30} />
      <span className="m-row-text">
        <span className="m-row-title">{title}</span>
        <span className="m-row-sub">{sub}</span>
      </span>
      <button className="m-chip-btn" disabled={!id || !workspaceFor(cwd, wss)} onClick={(e) => (haptic(e.currentTarget), cont(agent, id, cwd))} data-testid="m-external-continue">Continuar</button>
    </div>
  );
  return (
    <section className="m-group" data-testid="m-external">
      <div className="m-grp-head"><span className="m-grp-title">Fora do Kabul</span></div>
      {err && <div className="m-error">{err}</div>}
      <div className="m-grp-body">
        {ext.running.map((r) => row(`r${r.pid}`, r.agent, `${AGENT_LABEL[r.agent] ?? r.agent} · ${r.repo ?? "?"}`, `${r.terminal ?? "outro terminal"} · ${ago(r.running_secs)}${r.branch ? ` · ${r.branch}` : ""}`, r.session_id, r.cwd, "m-external-running"))}
        {ext.recent.slice(0, 10).map((r) => row(`h${r.agent}${r.id}`, r.agent, r.title, `${AGENT_LABEL[r.agent] ?? r.agent} · ${r.repo ?? "?"} · há ${ago(t - r.updated)}`, r.id, r.cwd, "m-external-recent"))}
      </div>
    </section>
  );
}
