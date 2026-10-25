import { t } from "../i18n";
import { useRef, useSyncExternalStore } from "react";
import { api, type AgentEvent, type HarnessKind } from "../api";
import { liveChats } from "./Confirm";
import { apply, interrupted, type ChatMemory, type Item, type Live } from "./chatModel";
import type { McpLive } from "./McpPanel";

/**
 * Registro de todas as conversas com agente, de todos os workspaces (ESCALA).
 *
 * Uma inscrição só no canal `chat-event`. A conversa cuja aba está na tela recebe os eventos em lote,
 * um lote por frame. As demais (aba fechada em segundo plano, workspace desmontado) não desenham nada:
 * o evento é aplicado direto no estado guardado da conversa (sem React) e só o status e os contadores
 * (trabalhando, esperando você, aguardando vaga, ferramentas, custo, subagentes) avisam a tela, também
 * no máximo uma vez por frame. Ao abrir a aba, ela monta já com tudo o que aconteceu.
 */

export type ChatStatus = "idle" | "working" | "waiting" | "queued";
export interface SubNode { id: string; parent: string | null; name: string; description: string; status: "running" | "done" | "error" | "interrupted"; started: number; ended?: number; tools: number; tokensIn: number; tokensOut: number; costUsd: number }
export interface ChatInfo {
  session: string; ws: string; chat: string | null; harness: HarnessKind | null; model: string | null; title: string;
  busy: boolean; waiting: boolean; queue: { position: number; limit: number | null } | null; suspended: boolean; unread: boolean;
  startedAt: number | null; lastEventAt: number; events: number; tools: number; costUsd: number; tokensIn: number; tokensOut: number;
  subs: Record<string, SubNode>;
}
type Ev = { chat_id: string; event: AgentEvent };
type Sink = (batch: Ev[]) => void;
interface Entry { info: ChatInfo; wsName: string; sink: Sink | null; mem: ChatMemory | null; pending: Ev[]; persistT?: ReturnType<typeof setTimeout> }

const entries = new Map<string, Entry>();
const byChat = new Map<string, string>();
const listeners = new Set<() => void>();
let started = false;

export const statusOf = (i: Pick<ChatInfo, "busy" | "waiting" | "queue">): ChatStatus => (i.waiting ? "waiting" : i.queue ? "queued" : i.busy ? "working" : "idle");
const SUB_TOOLS = /^(Task|Agent)$/;

// ---------- agendamento por frame (com reserva por timer: o rAF para quando a janela está escondida) ----------
function perFrame(run: () => void) {
  let on = false;
  return () => {
    if (on) return;
    on = true;
    const go = () => on && ((on = false), run());
    requestAnimationFrame(go);
    setTimeout(go, 120);
  };
}
const notify = perFrame(() => listeners.forEach((l) => l()));
const flushQ = new Set<Entry>();
const flush = perFrame(() => {
  const q = [...flushQ];
  flushQ.clear();
  for (const e of q) {
    const b = e.pending;
    e.pending = [];
    if (e.sink) e.sink(b);
    else for (const x of b) applyDetached(e, x.chat_id, x.event);
  }
});

const touch = (e: Entry, patch: Partial<ChatInfo>) => {
  e.info = { ...e.info, ...patch };
  notify();
};

function ensure(session: string, ws = "", wsName = ""): Entry {
  let e = entries.get(session);
  if (!e) {
    e = { info: { session, ws, chat: null, harness: null, model: null, title: t("common.newChat"), busy: false, waiting: false, queue: null, suspended: false, unread: false, startedAt: null, lastEventAt: 0, events: 0, tools: 0, costUsd: 0, tokensIn: 0, tokensOut: 0, subs: {} }, wsName, sink: null, mem: null, pending: [] };
    entries.set(session, e);
  } else if (ws && (e.info.ws !== ws || e.wsName !== wsName)) (e.info = { ...e.info, ws }), (e.wsName = wsName);
  return e;
}

export const mcpFrom = (ev: Extract<AgentEvent, { type: "session_info" }>): McpLive => {
  const tools: Record<string, number> = {};
  for (const t of ev.tools) if (t.startsWith("mcp__")) tools[t.split("__")[1]] = (tools[t.split("__")[1]] ?? 0) + 1;
  return { status: Object.fromEntries(ev.mcp_servers.map((m) => [m.name, m.status])), tools, total: ev.tools.length };
};

/** Status, contadores e árvore de subagentes: valem com a aba aberta ou não. */
function track(e: Entry, ev: AgentEvent) {
  const i = e.info;
  const p: Partial<ChatInfo> = { events: i.events + 1, lastEventAt: Date.now() };
  const parent = ev.parent_tool_use_id ?? null;
  let subs = i.subs;
  const sub = (id: string, f: (n: SubNode) => SubNode) => subs[id] && (subs = { ...subs, [id]: f(subs[id]) });
  if (ev.type === "tool_use") {
    if (SUB_TOOLS.test(ev.name)) {
      const inp = (ev.input ?? {}) as { description?: string; prompt?: string; subagent_type?: string };
      subs = { ...subs, [ev.id]: { id: ev.id, parent, name: inp.subagent_type ?? ev.name, description: inp.description ?? String(inp.prompt ?? "").slice(0, 60), status: "running", started: Date.now(), tools: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 } };
    }
    if (parent) sub(parent, (n) => ({ ...n, tools: n.tools + 1 }));
    else p.tools = i.tools + 1;
  } else if (ev.type === "tool_result") sub(ev.id, (n) => ({ ...n, status: ev.is_error ? "error" : "done", ended: Date.now() }));
  else if (ev.type === "usage" && parent) sub(parent, (n) => ({ ...n, tokensIn: n.tokensIn + (ev.input ?? 0), tokensOut: n.tokensOut + (ev.output ?? 0) }));
  else if (ev.type === "turn_completed") {
    if (parent) sub(parent, (n) => ({ ...n, costUsd: n.costUsd + (ev.cost_usd ?? 0), tokensOut: n.tokensOut + (ev.output_tokens ?? 0) }));
    else Object.assign(p, { costUsd: i.costUsd + (ev.cost_usd ?? 0), tokensIn: ev.input_tokens ?? i.tokensIn, tokensOut: i.tokensOut + (ev.output_tokens ?? 0) });
  } else if (ev.type === "exited") {
    for (const n of Object.values(subs)) if (n.status === "running") sub(n.id, (x) => ({ ...x, status: "interrupted", ended: Date.now() }));
  } else if (ev.type === "queued") p.queue = { position: ev.position, limit: ev.limit };
  else if (ev.type === "slot_acquired") p.queue = null;
  else if (ev.type === "suspended") Object.assign(p, { suspended: true, busy: false });
  else if (ev.type === "resumed") p.suspended = false;
  if (subs !== i.subs) p.subs = subs;
  if (!parent && (ev.type === "turn_completed" || ev.type === "exited")) p.queue = null;
  // Sem a aba aberta, o status vem dos eventos (com a aba, a própria conversa informa).
  if (!e.sink && !parent && e.mem?.stopped !== e.info.chat) {
    if (ev.type === "approval_request") Object.assign(p, { waiting: true, busy: false });
    else if (ev.type === "turn_completed" || ev.type === "exited") Object.assign(p, { busy: false, waiting: false });
    else if (!["log", "raw", "session_info", "session_started", "suspended", "resumed"].includes(ev.type)) Object.assign(p, { busy: true, startedAt: i.busy ? i.startedAt : Date.now() });
  }
  touch(e, p);
}

function intake({ chat_id, event }: Ev) {
  const s = byChat.get(chat_id);
  const e = s ? entries.get(s) : undefined;
  if (!e) return;
  track(e, event);
  e.pending.push({ chat_id, event });
  flushQ.add(e);
  flush();
}

/** Conversa fora da tela: aplica o evento no estado guardado (o mesmo que a aba faria), sem desenhar. */
function applyDetached(e: Entry, chat_id: string, ev: AgentEvent) {
  const m = e.mem;
  if (!m) return;
  if (m.stopped === chat_id) return void (ev.type === "session_started" && (m.agentSession = ev.session_id));
  if (ev.type === "log" || ev.type === "raw" || ev.parent_tool_use_id) return;
  m.seq++;
  if (ev.type === "session_started") m.agentSession = ev.session_id;
  if (ev.type === "usage") m.usage = ev;
  if (ev.type === "session_info") m.mcpLive = mcpFrom(ev);
  if (ev.type === "turn_completed" && ev.input_tokens) (m.ctxUsed = ev.input_tokens), (m.ctxBase = m.ctxBase || ev.input_tokens);
  if (ev.type === "turn_completed" || ev.type === "exited" || ev.type === "approval_request") m.busy = false;
  if (ev.type === "turn_completed") {
    touch(e, { unread: true });
    api.notify(`Kabul · ${e.wsName}`, t("chat.notify.turnDone"), { ws: e.info.ws, session: e.info.session }).catch(() => {});
  }
  if (ev.type === "approval_request") api.notify(`Kabul · ${e.wsName}`, t("chat.notify.permission", { tool: ev.tool }), { ws: e.info.ws, session: e.info.session }).catch(() => {});
  if (ev.type === "exited") (m.live = null), bind(e.info.session, null);
  const next = apply(m.items, ev, m.started);
  if (ev.type === "turn_completed") {
    const last = next[next.length - 1];
    if (last?.k === "turn" && next !== m.items) next[next.length - 1] = { ...last, usage: m.usage ?? undefined, started: m.started, ended: Date.now() };
    m.usage = null;
  }
  m.items = next;
  persistSoon(e);
  if (ev.type === "turn_completed") dequeue(e);
}

function persistSoon(e: Entry) {
  clearTimeout(e.persistT);
  e.persistT = setTimeout(() => {
    const m = e.mem;
    if (!m || e.sink || !m.items.length) return;
    const first = m.items.find((i) => i.k === "user") as { text: string } | undefined;
    api.historySave({ id: e.info.session, workspace_id: e.info.ws, title: first ? first.text.slice(0, 40) : t("common.newChat"), model_key: m.modelKey, agent_session: m.agentSession, updated_at: Math.floor(Date.now() / 1000), items: m.items.map((i) => (i.k === "assistant" ? { ...i, streaming: false } : i)) }).catch(() => {});
  }, 1200);
}

/** Fila de mensagens de uma conversa fora da tela: manda a próxima quando o agente fica livre. */
function dequeue(e: Entry) {
  const m = e.mem;
  if (!m || e.sink || !m.queue.length || m.queuePaused || !m.live || m.replay || m.stopped || e.info.waiting) return;
  const [msgText, ...rest] = m.queue;
  const live = m.live;
  m.queue = rest;
  m.busy = true;
  m.started = Date.now();
  touch(e, { busy: true, startedAt: m.started });
  void api.createCheckpoint(e.info.ws, t("chat.checkpointBefore", { text: msgText.slice(0, 60) })).catch(() => null).then((ck) => {
    const qi = m.items.findIndex((i) => i.k === "user" && i.queued && i.text === msgText);
    const u: Item = { k: "user", text: msgText, checkpoint: ck?.id };
    m.items = qi >= 0 ? [...m.items.slice(0, qi), ...m.items.slice(qi + 1), u] : [...m.items, u];
    m.seq++;
    api.chatSend(live.id, msgText).catch(() => touch(e, { busy: false }));
  });
}

function bind(session: string, live: Live | null, model?: string | null) {
  const e = entries.get(session);
  if (!e) return;
  if (e.info.chat && e.info.chat !== live?.id) byChat.delete(e.info.chat);
  if (live) byChat.set(live.id, session), liveChats.set(session, { chat: live.id, ws: e.info.ws });
  else liveChats.delete(session);
  // Conversa que começou e desmontou antes do agente responder: o estado guardado fica com o agente.
  if (!e.sink && e.mem) e.mem.live = live;
  if (e.info.chat !== (live?.id ?? null) || (model !== undefined && model !== e.info.model)) touch(e, { chat: live?.id ?? null, harness: live?.harness ?? e.info.harness, ...(model !== undefined ? { model } : {}) });
}

/** Para uma conversa que não está na tela (Parar no painel Agentes, arquivar com agentes rodando). */
async function stopDetached(e: Entry, interruptCall = true) {
  const m = e.mem, chat = e.info.chat;
  if (m) (m.stopped = chat), (m.items = interrupted(m.items)), (m.busy = false), m.seq++;
  const subs = Object.fromEntries(Object.entries(e.info.subs).map(([k, n]) => [k, n.status === "running" ? { ...n, status: "interrupted" as const, ended: Date.now() } : n]));
  touch(e, { busy: false, waiting: false, queue: null, subs });
  if (!chat || !interruptCall) return persistSoon(e);
  // kabuld não tem chat_interrupt (lá o parar é chat_stop): sem ele, encerra o agente.
  const r = await api.chatInterrupt(chat).catch(() => api.chatStop(chat).then(() => ({ alive: false, leftovers: [], containers: [] }), () => null));
  if (r && !r.alive) (m && (m.live = null), bind(e.info.session, null));
  if (m && r && (r.leftovers.length || r.containers.length)) (m.items = [...m.items, { k: "leftovers", procs: r.leftovers, containers: r.containers }]), m.seq++;
  persistSoon(e);
}

export const chatStore = {
  /** Assina o canal de eventos (uma vez, ao abrir o app). */
  init() {
    if (started) return;
    started = true;
    api.onChat(intake);
  },
  register: (session: string, ws: string, wsName: string) => void ensure(session, ws, wsName),
  get: (session: string) => entries.get(session)?.info,
  memory: (session: string) => entries.get(session)?.mem ?? null,
  /**
   * A aba entrou na tela: passa a receber os eventos em lote. Se algo chegou entre o render e este
   * ponto (estado guardado mudou), devolve o estado novo para a aba se acertar.
   */
  attach(session: string, sink: Sink, seq: number | null): ChatMemory | null {
    const e = ensure(session);
    e.sink = sink;
    return e.mem && seq !== null && e.mem.seq !== seq ? e.mem : null;
  },
  /** A aba saiu da tela: guarda o estado; o que estava no lote ainda não entregue é aplicado nele. */
  detach(session: string, mem: ChatMemory) {
    const e = entries.get(session);
    if (!e) return;
    e.sink = null;
    e.mem = mem;
    const b = e.pending;
    e.pending = [];
    for (const x of b) applyDetached(e, x.chat_id, x.event);
  },
  bind,
  /** Com a aba aberta, ela informa trabalhando/esperando (o que a fila e os cartões sabem). */
  report(session: string, s: { busy?: boolean; waiting?: boolean }) {
    const e = entries.get(session);
    if (!e) return;
    const p: Partial<ChatInfo> = {};
    if (s.busy !== undefined && s.busy !== e.info.busy) Object.assign(p, { busy: s.busy, startedAt: s.busy ? Date.now() : e.info.startedAt });
    if (s.waiting !== undefined && s.waiting !== e.info.waiting) p.waiting = s.waiting;
    if (Object.keys(p).length) touch(e, p);
  },
  setTitle: (session: string, title: string) => { const e = entries.get(session); if (e && e.info.title !== title) touch(e, { title }); },
  setModel: (session: string, model: string | null) => { const e = entries.get(session); if (e && e.info.model !== model) touch(e, { model }); },
  /** Parar com a aba aberta: subagentes em andamento viram interrompidos. */
  interruptSubs(session: string) {
    const e = entries.get(session);
    if (!e || !Object.values(e.info.subs).some((n) => n.status === "running")) return;
    touch(e, { subs: Object.fromEntries(Object.entries(e.info.subs).map(([k, n]) => [k, n.status === "running" ? { ...n, status: "interrupted" as const, ended: Date.now() } : n])) });
  },
  markUnread: (session: string, unread: boolean) => { const e = entries.get(session); if (e && e.info.unread !== unread) touch(e, { unread }); },
  /** Subagentes de turnos antigos (histórico): os Task/Agent do fio viram nós concluídos. */
  seedSubs(session: string, items: Item[]) {
    const e = entries.get(session);
    if (!e || Object.keys(e.info.subs).length) return;
    const subs: Record<string, SubNode> = {};
    for (const i of items) if (i.k === "tool" && SUB_TOOLS.test(i.name)) {
      const inp = (i.input ?? {}) as { description?: string; prompt?: string; subagent_type?: string };
      subs[i.id] = { id: i.id, parent: null, name: inp.subagent_type ?? i.name, description: inp.description ?? String(inp.prompt ?? "").slice(0, 60), status: i.error ? "error" : i.output === undefined || i.interrupted ? "interrupted" : "done", started: 0, tools: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    }
    if (Object.keys(subs).length) touch(e, { subs });
  },
  /** Parar várias conversas (painel Agentes): as abertas param pela própria aba; as outras, em lote. */
  async stopMany(sessions: string[]) {
    const away: Entry[] = [];
    for (const s of sessions) {
      const e = entries.get(s);
      if (!e) continue;
      if (e.sink) window.dispatchEvent(new CustomEvent("kabul:stop-chat", { detail: s }));
      else away.push(e);
    }
    if (!away.length) return;
    const chats = away.map((e) => e.info.chat).filter((c): c is string => !!c);
    const batch = chats.length > 1 ? await api.chatsInterrupt(chats).catch(() => null) : null;
    await Promise.all(away.map((e) => stopDetached(e, !batch || !batch.stopped.includes(e.info.chat ?? ""))));
  },
  stop: (session: string) => chatStore.stopMany([session]),
  /** Arquivar com agentes rodando: para todas as conversas ativas do workspace. */
  stopWorkspace: (ws: string) => chatStore.stopMany([...entries.values()].filter((e) => e.info.ws === ws && statusOf(e.info) !== "idle").map((e) => e.info.session)),
  /** Aba fechada: esquece a conversa. */
  forget(session: string) {
    const e = entries.get(session);
    if (!e) return;
    clearTimeout(e.persistT);
    if (e.info.chat) byChat.delete(e.info.chat);
    liveChats.delete(session);
    entries.delete(session);
    notify();
  },
  all: () => [...entries.values()].map((e) => e.info),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

const shallow = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};

/** Lê do registro com seletor: a tela só re-renderiza quando o valor escolhido muda. */
export function useChatSelect<T>(sel: () => T, eq: (a: T, b: T) => boolean = shallow): T {
  const ref = useRef<{ v: T } | null>(null);
  const get = () => {
    const v = sel();
    if (ref.current && eq(ref.current.v, v)) return ref.current.v;
    ref.current = { v };
    return v;
  };
  return useSyncExternalStore(chatStore.subscribe, get, get);
}

export type WsAgent = "working" | "waiting" | "queued";
const RANK: Record<WsAgent, number> = { queued: 1, working: 2, waiting: 3 };
/** Estado de agente por workspace (o mais urgente das conversas dele). */
export const workspaceAgents = (): Record<string, WsAgent> => {
  const out: Record<string, WsAgent> = {};
  for (const { info } of entries.values()) {
    const s = statusOf(info);
    if (s !== "idle" && (!out[info.ws] || RANK[s] > RANK[out[info.ws]])) out[info.ws] = s;
  }
  return out;
};
export const useWorkspaceAgents = () => useChatSelect(workspaceAgents);
/** Status de uma aba (spinner, ponto de não lido, fila). */
export const useChatStatus = (session: string) => useChatSelect(() => {
  const i = entries.get(session)?.info;
  return { status: i ? statusOf(i) : ("idle" as ChatStatus), unread: !!i?.unread, queue: i?.queue?.position ?? null, subs: i ? Object.keys(i.subs).length : 0 };
});
