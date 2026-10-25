import { createPortal } from "react-dom";
import { FileIcon, IFork, IForkTab, IVolume } from "../icons";
import { confirmDialog } from "../components/Confirm";
import { Floating } from "../components/Floating";
import { noSuggest } from "../noSuggest";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, HARNESS_LABEL, type AgentEvent, type Model, type Workspace } from "../api";
import { ModelPicker } from "../components/ModelPicker";
import { effortFor, useModelPrefs } from "../components/prefs";
import { useDictation } from "../components/useDictation";
import { Markdown } from "../components/Markdown";
import { McpPanel, repoDisabled, saveSessionDisabled, sessionDisabled, type McpLive } from "../components/McpPanel";
import { ContextPanel } from "../components/ContextPanel";
import { useDismiss } from "../components/useDismiss";
import type { LinearIssue } from "../api";
import { ToolCard, ThinkingCard, ApprovalCard, PlanCard, QuestionCard, LeftoversCard } from "../components/ToolCards";
import { chatPrefs, pendingFork, pendingModel, type PendingFork } from "../components/chatPrefs";
import { ChatFind } from "../components/ChatFind";
import { WorkingLine, activity } from "../components/WorkingLine";
import { stripAbsolutelyRight, useSettings } from "../components/useSettings";
import { IApps, IArrowUp, ICopy, IMic, IPlan, IPlus, IRestore, IStop } from "../icons";
import { apply, interrupted, type ChatMemory, type Item, type Live, type Usage } from "../components/chatModel";
import { chatStore, mcpFrom, useChatSelect } from "../components/chatStore";
import { markUsageSwitch, pendingUsageSwitches } from "../components/usageSwitch";
import { SubagentTree } from "../components/SubagentTree";
import { t } from "../i18n";
import { tNode } from "../i18n/react";
import { locale } from "../i18n/lang";
import { fmtDate, fmtNum } from "../i18n/format";

export type { Item } from "../components/chatModel";

/** Texto de handoff (replay) para um agente novo continuar a conversa (espelha `transcript::handoff_prompt`). */
export function handoffText(items: Item[], changes: string[], branch: string, lastN = 12): string {
  // i18n-ignore: prompt de handoff enviado ao agente (espelha transcript::handoff_prompt do core), não é texto da tela.
  const msgs = items.flatMap((i) => (i.k === "user" && !i.queued ? [`**Usuário:** ${i.text}`] : i.k === "assistant" ? [`**Agente:** ${i.text}`] : i.k === "tool" ? [`_(ferramenta ${i.name}${i.error ? ", falhou" : ""})_`] : []));
  const tail = msgs.slice(-lastN);
  // i18n-ignore (mesmo prompt)
  return `Você está continuando uma conversa que começou com outro agente, no mesmo repositório e na mesma branch. Leia o contexto e continue de onde parou; não refaça o que já foi feito.\n\n## Últimas mensagens (${tail.length} de ${msgs.length})\n\n${tail.join("\n\n")}\n\n## Estado do código\n\nBranch \`${branch}\`. Arquivos alterados: ${changes.join(", ") || "nenhum"}. Arquivos de contexto em \`.context/\`.\n`;
}

const PROVIDER_OF: Partial<Record<string, string>> = { claude: "claude", codex: "codex", antigravity: "agy" };
/** Modelo e conta com que o próximo envio sai. */
type Choice = { sel: Model; acc: { id: string; nickname: string } | null };
/** Mensagens desenhadas de início (as mais recentes); rolar até o topo traz mais, em blocos. */
const WINDOW = 120, WINDOW_STEP = 150;
interface Props { ws: Workspace; sessionId: string; active: boolean; onTitle: (t: string) => void; onError: (e: string) => void; onWorkspaceChange: () => void }

/** Anel de uso de contexto (tokens de entrada do último turno ÷ janela do modelo). */
function ContextRing({ used, total, onClick, on, quiet }: { used: number; total: number | null; onClick: () => void; on: boolean; quiet?: boolean }) {
  const pct = total ? Math.min(1, used / total) : 0;
  const r = 7, c = 2 * Math.PI * r;
  // Abaixo de 70% o anel fica discreto (aparece ao passar o mouse no composer), a menos que "sempre mostrar" esteja ligado.
  return (
    <button className={"ctx-ring icon-btn" + (on ? " on" : "") + (quiet && pct < 0.7 && !on ? " ctx-quiet" : "")} data-pct={Math.round(pct * 100)} onClick={onClick} title={total ? t("chat.ctxRing", { used: fmtNum(used), total: fmtNum(total), pct: Math.round(pct * 100) }) : t("chat.ctxRingUnknown")} data-testid="context-ring">
      <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r={r} stroke="var(--track)" strokeWidth="2" fill="none" /><circle cx="9" cy="9" r={r} stroke={pct > 0.85 ? "var(--del)" : "var(--muted)"} strokeWidth="2" fill="none" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 9 9)" strokeLinecap="round" /></svg>
    </button>
  );
}

/**
 * Arranjo do fio numa passada só (antes era quadrático: com milhares de itens, cada evento custava
 * milhões de operações): o que fica recolhido, os toggles dos passos, e por turno/erro o checkpoint,
 * se é o último turno, os arquivos mudados e se é o erro do fim da conversa.
 */
interface Layout { hidden: Uint8Array; toggles: Map<number, string>; turn: Map<number, { isLast: boolean; checkpoint?: string; files: string }>; err: Map<number, { tail: boolean; lastUser?: string }>; userIdx: number[] }
function layoutOf(items: Item[], noCollapse: boolean, expanded: Set<number>, root: string): Layout {
  const n = items.length;
  const hidden = new Uint8Array(n);
  const toggles = new Map<number, string>();
  const turn = new Map<number, { isLast: boolean; checkpoint?: string; files: string }>();
  const err = new Map<number, { tail: boolean; lastUser?: string }>();
  const userIdx: number[] = [];
  let u = -1, seg: number[] = [], files: Map<string, { add: number; del: number }> = new Map();
  let lastUserText: string | undefined, lastCk: string | undefined;
  const lines = (t: unknown) => (typeof t === "string" && t ? t.split("\n").length : 0);
  for (let k = 0; k < n; k++) {
    const it = items[k];
    if (it.k === "user" && !it.queued) (u = k), (seg = []), (files = new Map()), (lastUserText = it.text), (lastCk = it.checkpoint), userIdx.push(k);
    else if (u >= 0 && (it.k === "tool" || it.k === "reasoning" || it.k === "assistant")) seg.push(k);
    if (it.k === "tool" && !it.error && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(it.name)) {
      const inp = (it.input ?? {}) as { file_path?: string; content?: string; edits?: { old_string?: string; new_string?: string }[]; old_string?: string; new_string?: string };
      if (inp.file_path) {
        const p = inp.file_path.startsWith(root + "/") ? inp.file_path.slice(root.length + 1) : inp.file_path;
        const cur = files.get(p) ?? { add: 0, del: 0 };
        for (const e of inp.edits ?? [inp]) (cur.add += lines(e.new_string ?? inp.content)), (cur.del += lines(e.old_string));
        files.set(p, cur);
      }
    }
    if (it.k === "turn") {
      turn.set(k, { isLast: true, checkpoint: lastCk, files: JSON.stringify([...files].map(([path, v]) => ({ path, ...v }))) });
      if (!noCollapse && u >= 0 && !expanded.has(u)) {
        let finalA = -1;
        for (const j of seg) if (items[j].k === "assistant") finalA = j;
        const mid = seg.filter((j) => j < (finalA >= 0 ? finalA : k));
        if (mid.length >= 2) {
          for (const j of mid) hidden[j] = 1;
          const tools = mid.filter((j) => items[j].k === "tool");
          toggles.set(mid[0], [u, tools.length, mid.length - tools.length, tools.some((j) => (items[j] as { name: string }).name === "Bash") ? 1 : 0].join("|"));
        }
      }
    }
    if (it.k === "error") err.set(k, { tail: true, lastUser: lastUserText });
  }
  // Último turno: não há mensagem sua depois. Erro do fim: nem mensagem sua nem outro erro depois.
  for (const [k, t] of turn) t.isLast = !userIdx.some((x) => x > k);
  let after = false;
  for (let k = n - 1; k >= 0; k--) {
    const it = items[k];
    if (it.k === "error") (err.get(k)!.tail = !after), (after = true);
    else if (it.k === "user") after = true;
  }
  return { hidden, toggles, turn, err, userIdx };
}

/** Arquivos mudados no turno (Edit/MultiEdit/Write), com +/− aproximados pelas strings da ferramenta. */
export function turnFiles(items: Item[], n: number, root: string): { path: string; add: number; del: number }[] {
  return JSON.parse(layoutOf(items.slice(0, n + 1), true, new Set(), root).turn.get(n)?.files ?? "[]");
}

export function ChatTab({ ws, sessionId, active, onTitle, onError, onWorkspaceChange }: Props) {
  // Callbacks do pai sempre pela versão mais recente: o pai cria funções novas a cada render, e um efeito
  // que dependesse delas rodaria a cada render (avisar o pai → pai re-renderiza → função nova → efeito de novo).
  const parent = useRef({ onTitle });
  parent.current = { onTitle };
  // Estado guardado quando a aba desmontou (workspace fora da tela): volta exatamente como estava.
  const [m0] = useState<ChatMemory | null>(() => (chatStore.register(sessionId, ws.id, ws.name), chatStore.memory(sessionId)));
  const [models, setModels] = useState<Model[]>([]);
  const { prefs, setPrefs, selected, effort } = useModelPrefs(models);
  const [live, setLiveState] = useState<Live | null>(m0?.live ?? null);
  const [agentSession, setAgentSession] = useState<string | null>(m0?.agentSession ?? null);
  const [items, setItems] = useState<Item[]>(m0?.items ?? []);
  const [busy, setBusyState] = useState(m0?.busy ?? false);
  const [text, setText] = useState(m0?.text ?? "");
  const [queue, setQueue] = useState<string[]>(m0?.queue ?? []);
  const [queuePaused, setQueuePaused] = useState(m0?.queuePaused ?? false);
  const appSet = useSettings();
  useEffect(() => {
    const k = pendingModel[sessionId] ?? m0?.modelKey;
    if (pendingModel[sessionId]) delete pendingModel[sessionId];
    if (k) setPrefs((p) => ({ ...p, selected: k }));
  }, [sessionId]);
  const [plan, setPlan] = useState(m0?.plan ?? false);
  // "Conversas novas em plan mode" (Configurações › Modelos).
  const planInit = useRef(!!m0);
  useEffect(() => void (appSet && !planInit.current && ((planInit.current = true), appSet.default_plan && setPlan(true))), [appSet]);
  const [ctxUsed, setCtxUsed] = useState(m0?.ctxUsed ?? 0);
  const [appsOpen, setAppsOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const appsRef = useRef<HTMLDivElement>(null), ctxRef = useRef<HTMLDivElement>(null);
  useDismiss(appsRef, appsOpen, useCallback(() => setAppsOpen(false), []));
  useDismiss(ctxRef, ctxOpen, useCallback(() => setCtxOpen(false), []));
  const [mcpLive, setMcpLive] = useState<McpLive | null>(m0?.mcpLive ?? null);
  // MCP desligado nesta sessão: lembrado por aba (vale no próximo turno, em qualquer IA).
  const [sessionOff, setSessionOffRaw] = useState<string[]>(() => m0?.sessionOff ?? sessionDisabled(sessionId));
  const setSessionOff = (v: string[]) => (saveSessionDisabled(sessionId, v), setSessionOffRaw(v));
  const [ctxBase, setCtxBase] = useState(m0?.ctxBase ?? 0);
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [suggest, setSuggest] = useState<{ kind: "@" | "/"; q: string; sel: number } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [commands, setCommands] = useState<[string, string][]>([]);
  const [loaded, setLoaded] = useState(!!m0);
  const [account, setAccount] = useState<{ id: string; nickname: string } | null>(m0?.account ?? null);
  const [accounts, setAccounts] = useState<import("../api").AccountRow[]>([]);
  const [accOpen, setAccOpen] = useState(false);
  const accRef = useRef<HTMLDivElement>(null);
  useDismiss(accRef, accOpen, useCallback(() => setAccOpen(false), []));
  const pendingApproval = useMemo(() => { for (let j = items.length - 1; j >= 0; j--) { const i = items[j]; if (i.k === "approval" && !i.decided) return i; } return undefined; }, [items]);
  const waiting = !!pendingApproval;
  const replayRef = useRef(m0?.replay ?? false);
  const forkRef = useRef(m0?.fork ?? false);
  const harnessRef = useRef(m0?.harness ?? null);
  const usageRef = useRef<Usage | null>(m0?.usage ?? null);
  const [noCollapse, setNoCollapse] = useState(chatPrefs.noCollapse());
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(m0?.expanded ?? []));
  const [note, setNote] = useState<string | null>(m0?.note ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [finding, setFinding] = useState(false);
  const [quoteBtn, setQuoteBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<Live | null>(live);
  const started = useRef(m0?.started ?? Date.now());
  // Conversa parada pelo usuário: eventos do turno interrompido são descartados até o próximo envio.
  const stoppedRef = useRef<string | null>(m0?.stopped ?? null);
  const itemsRef = useRef<Item[]>(items);
  liveRef.current = live;
  itemsRef.current = items;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** Agente vivo desta conversa: o registro passa a encaminhar os eventos dele para cá na hora. */
  const setLive = useCallback((l: Live | null, label?: string | null) => {
    liveRef.current = l;
    chatStore.bind(sessionId, l, label);
    setLiveState(l);
  }, [sessionId]);

  const setBusy = useCallback((b: boolean) => setBusyState(b), []);
  useEffect(() => chatStore.report(sessionId, { busy, waiting }), [busy, waiting, sessionId]);
  useEffect(() => void (selected && chatStore.setModel(sessionId, selected.label)), [selected?.label, sessionId]);

  useEffect(() => void api.models().then(setModels, (e) => onError(String(e))), [onError]);
  useEffect(() => {
    const pf = m0 ? null : pendingFork[sessionId];
    if (pf) {
      delete pendingFork[sessionId];
      setItems([...(pf.items as Item[]), { k: "notice", text: t("chat.forkNotice") }]);
      setAgentSession(pf.resume);
      forkRef.current = pf.forkSession;
      replayRef.current = pf.replay;
      if (pf.modelKey) setPrefs((p) => ({ ...p, selected: pf.modelKey }));
      setLoaded(true);
    } else if (!m0) api.historyLoad(ws.id, sessionId).then(
      (r) => {
        const its = (r?.items as Item[]) ?? [];
        setItems(its);
        chatStore.seedSubs(sessionId, its);
        setAgentSession(r?.agent_session ?? null);
        if (r?.model_key) setPrefs((p) => ({ ...p, selected: r.model_key }));
        setLoaded(true);
      },
      () => setLoaded(true),
    );
    api.files(ws.id).then(setFiles, () => {});
    api.linearStatus().then((s) => void (s.connected && api.linearIssues(null).then(setIssues, () => {})), () => {});
    api.slashCommands(ws.id).then(setCommands, () => {});
  }, [ws.id, sessionId]);

  const persist = useCallback(
    (its: Item[], agent: string | null) => {
      const firstUser = its.find((i) => i.k === "user") as { text: string } | undefined;
      const title = firstUser ? firstUser.text.slice(0, 40) : t("common.newChat");
      parent.current.onTitle(title);
      chatStore.setTitle(sessionId, title);
      api.historySave({ id: sessionId, workspace_id: ws.id, title, model_key: prefs.selected, agent_session: agent, updated_at: Math.floor(Date.now() / 1000), items: its.map((i) => (i.k === "assistant" ? { ...i, streaming: false } : i)) }).catch(() => {});
    },
    [sessionId, ws.id, prefs.selected],
  );

  // Eventos do agente, em lote (um por frame) pelo registro de conversas.
  const onBatch = (batch: { chat_id: string; event: AgentEvent }[]) => {
    const evs: AgentEvent[] = [];
    for (const { chat_id, event } of batch) {
      if (chat_id !== liveRef.current?.id) continue;
      // Depois do Parar, o que o agente ainda mandar do turno interrompido (resultado atrasado, fim de
      // turno) é descartado: o "Interrompido" fica no fim do turno. Vale até o próximo envio.
      if (stoppedRef.current === chat_id) { if (event.type === "session_started") setAgentSession(event.session_id); continue; }
      if (event.type === "log" || event.type === "raw" || event.parent_tool_use_id) continue;
      if (event.type === "session_started") setAgentSession(event.session_id);
      if (event.type === "session_info") setMcpLive(mcpFrom(event));
      if (event.type === "turn_completed") {
        if (event.input_tokens) (setCtxUsed(event.input_tokens), setCtxBase((b) => b || event.input_tokens!));
        if (!activeRef.current || !document.hasFocus()) {
          if (!activeRef.current) chatStore.markUnread(sessionId, true);
          api.notify(`Kabul · ${ws.name}`, t("chat.notify.turnDone"), { ws: ws.id, session: sessionId }).catch(() => {});
        }
      }
      if (event.type === "approval_request" && (!activeRef.current || !document.hasFocus())) api.notify(`Kabul · ${ws.name}`, t("chat.notify.permission", { tool: event.tool }), { ws: ws.id, session: sessionId }).catch(() => {});
      if (event.type === "turn_completed" || event.type === "exited" || event.type === "approval_request") setBusy(false);
      if (event.type === "exited") setLive(null);
      evs.push(event);
    }
    if (!evs.length) return;
    setItems((it) => {
      let next = it;
      for (const event of evs) {
        if (event.type === "usage") { usageRef.current = event; continue; }
        const before = next;
        next = apply(next, event, started.current);
        if (event.type === "turn_completed" && next !== before) {
          const last = next[next.length - 1];
          if (last?.k === "turn") next[next.length - 1] = { ...last, usage: usageRef.current ?? undefined, started: started.current, ended: Date.now() };
          usageRef.current = null;
        }
      }
      return next;
    });
  };
  const onBatchRef = useRef(onBatch);
  onBatchRef.current = onBatch;
  // Estado completo para guardar ao desmontar (lido na hora da limpeza).
  const scrollPos = useRef<{ top: number; bottom: boolean }>(m0?.scroll ?? { top: 0, bottom: true });
  const [win, setWin] = useState(m0?.window ?? WINDOW);
  const snap = useRef<() => ChatMemory>(() => null as never);
  snap.current = () => ({
    items: itemsRef.current, live: liveRef.current, agentSession, text, queue, queuePaused, plan, ctxUsed, ctxBase, mcpLive, sessionOff, account, note,
    scroll: scrollPos.current, expanded: [...expanded], harness: harnessRef.current, fork: forkRef.current, replay: replayRef.current, stopped: stoppedRef.current,
    started: started.current, usage: usageRef.current, modelKey: prefs.selected, busy, window: win, seq: 0,
  });
  useLayoutEffect(() => {
    const fresh = chatStore.attach(sessionId, (b) => onBatchRef.current(b), m0 ? m0.seq : null);
    if (fresh) {
      // Chegou evento entre o render e agora: pega o estado guardado mais novo.
      setItems(fresh.items);
      setAgentSession(fresh.agentSession);
      setBusyState(fresh.busy);
      setQueue(fresh.queue);
      liveRef.current = fresh.live;
      setLiveState(fresh.live);
      stoppedRef.current = fresh.stopped;
    }
    return () => chatStore.detach(sessionId, snap.current());
  }, [sessionId]);
  // Salva com o id do agente quando ele aparece.
  useEffect(() => {
    if (!loaded || !items.length) return;
    const t = setTimeout(() => persist(items, agentSession), 400);
    return () => clearTimeout(t);
  }, [agentSession, items, loaded]);
  // Tarefas em segundo plano do agente (Bash com run_in_background ainda não encerradas).
  const bgTasks = useMemo(() => {
    let st = 0, killed = 0;
    for (const i of items) if (i.k === "tool") (i.name === "Bash" && (i.input as { run_in_background?: boolean })?.run_in_background && st++), /^Kill(Shell|Bash)$/.test(i.name) && killed++;
    return Math.max(0, st - killed);
  }, [items]);

  // Rolagem: gruda no fim enquanto você está no fim; rolar até o topo desenha as mensagens anteriores.
  const anchor = useRef<{ h: number; top: number } | null>(null);
  const jumpTo = useRef<number | null>(null);
  const firstScroll = useRef(true);
  useLayoutEffect(() => {
    const s = scroller.current;
    if (!s) return;
    if (firstScroll.current && m0?.scroll && !m0.scroll.bottom) {
      firstScroll.current = false;
      s.scrollTop = m0.scroll.top;
      return;
    }
    firstScroll.current = false;
    if (anchor.current) {
      s.scrollTop = anchor.current.top + (s.scrollHeight - anchor.current.h);
      anchor.current = null;
    } else if (jumpTo.current !== null) {
      s.querySelector(`[data-msg="${jumpTo.current}"]`)?.scrollIntoView({ block: "start" });
      jumpTo.current = null;
    } else if (scrollPos.current.bottom) s.scrollTop = s.scrollHeight;
  }, [items, win]);
  const onScroll = () => {
    const s = scroller.current;
    if (!s) return;
    scrollPos.current = { top: s.scrollTop, bottom: s.scrollHeight - s.scrollTop - s.clientHeight < 80 };
    if (s.scrollTop < 400 && startIdx > 0 && !anchor.current) (anchor.current = { h: s.scrollHeight, top: s.scrollTop }), setWin((w) => w + WINDOW_STEP);
  };
  const toBottom = () => (scrollPos.current = { ...scrollPos.current, bottom: true });

  // Texto vindo de fora (comentários de diff, etc.).
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { chat: string; text: string };
      if (d.chat === sessionId) (setText((t) => (t ? t + "\n\n" : "") + d.text), setTimeout(() => input.current?.focus(), 50));
    };
    const send = (e: Event) => {
      const d = (e as CustomEvent).detail as { chat: string; text: string; plan?: boolean };
      if (d.chat !== sessionId) return;
      // Primeira mensagem do modal em plan mode: liga o plano antes de enviar.
      if (d.plan) (setPlan(true), setTimeout(() => sendRef.current(d.text), 0));
      else sendRef.current(d.text);
    };
    const forkLast = (e: Event) => {
      if ((e as CustomEvent).detail.chat !== sessionId) return;
      const lastTurn = [...itemsRef.current.keys()].filter((k) => itemsRef.current[k].k === "turn").pop();
      if (lastTurn !== undefined) forkTabRef.current(lastTurn);
    };
    // Painel de recursos: clicar no agente desta conversa traz a aba para a frente.
    const focusChat = (e: Event) => (e as CustomEvent).detail === liveRef.current?.id && window.dispatchEvent(new CustomEvent("kabul:activate-tab", { detail: sessionId }));
    window.addEventListener("kabul:focus-chat", focusChat);
    window.addEventListener("kabul:fork-last", forkLast);
    window.addEventListener("kabul:compose-chat", h);
    window.addEventListener("kabul:send-chat", send);
    return () => (window.removeEventListener("kabul:focus-chat", focusChat), window.removeEventListener("kabul:compose-chat", h), window.removeEventListener("kabul:send-chat", send), window.removeEventListener("kabul:fork-last", forkLast));
  }, [sessionId]);

  const dictation = useDictation(useCallback((t: string) => setText((x) => (x && !x.endsWith(" ") ? x + " " : x) + t), []), onError);

  /** Agente para o envio, com o modelo e a conta efetivos (`resolveSwitches`), não os do último render. */
  const ensure = async ({ sel: selected, acc: account }: Choice): Promise<Live | null> => {
    const effort = effortFor(selected, prefs.effort);
    const cur = liveRef.current;
    const mcpOff = [...new Set([...sessionOff, ...repoDisabled(ws.repo_id)])].sort();
    const acc = account?.id ?? null;
    if (cur && cur.key === selected.key && cur.effort === effort && cur.fast === prefs.fast && cur.plan === plan && cur.mcpOff === mcpOff.join() && cur.account === acc) return cur;
    // Só o plan mode mudou (ex.: plano aprovado): troca ao vivo, sem reiniciar a conversa.
    if (cur && cur.key === selected.key && cur.effort === effort && cur.fast === prefs.fast && cur.plan !== plan && cur.mcpOff === mcpOff.join() && cur.account === acc) {
      const ok = await api.chatSetMode(cur.id, plan ? "plan" : "default").catch(() => false);
      if (ok) {
        const l = { ...cur, plan };
        setLive(l, selected.label);
        setItems((it) => [...it, { k: "notice", text: plan ? t("chat.planOn") : t("chat.planOff") }]);
        return l;
      }
    }
    if (cur && cur.account !== acc && cur.harness === selected.harness) {
      // Outra conta do mesmo provedor: config isolada, então a conversa continua por handoff.
      await api.chatStop(cur.id).catch(() => {});
      liveRef.current = null;
      replayRef.current = true;
      setAgentSession(null);
      setItems((it) => [...it, { k: "handoff", text: t("chat.switchedAccount", { name: account?.nickname ?? t("chat.account.defaultShort") }) }]);
      try {
        const r = await api.chatStart(ws.id, selected, effort, prefs.fast, null, plan, mcpOff, false, acc);
        const l = { id: r.chat_id, harness: r.harness, key: selected.key, effort, fast: prefs.fast, plan, approvals: r.approvals, mcpOff: mcpOff.join(), account: acc, planKind: r.plan };
        setLive(l, selected.label);
        return l;
      } catch (e) {
        onError(String(e));
        return null;
      }
    }
    let resume: string | null = agentSession;
    const lastHarness = harnessRef.current;
    if (cur || (lastHarness && lastHarness !== selected.harness && items.length)) {
      if (cur) await api.chatStop(cur.id).catch(() => {});
      if ((cur?.harness ?? lastHarness) !== selected.harness) {
        // Troca de harness na mesma conversa: o agente novo recebe o handoff (mesma branch e worktree).
        resume = null;
        replayRef.current = true;
        setItems((it) => [...it, { k: "handoff", text: t("chat.switchedTo", { model: selected.label, harness: HARNESS_LABEL[selected.harness] }) }]);
      } else {
        setItems((it) => [...it, { k: "notice", text: t("chat.continuingWith", { model: `${selected.label}${effort ? " · " + effort : ""}${plan ? " · plan mode" : ""}` }) }]);
      }
    } else if (resume && items.length) {
      setItems((it) => [...it, { k: "notice", text: t("chat.resuming", { model: selected.label }) }]);
    }
    try {
      const r = await api.chatStart(ws.id, selected, effort, prefs.fast, resume, plan, mcpOff, forkRef.current, account?.id ?? null);
      forkRef.current = false;
      harnessRef.current = r.harness;
      if (r.note) setNote(r.note);
      const l = { id: r.chat_id, harness: r.harness, key: selected.key, effort, fast: prefs.fast, plan, approvals: r.approvals, mcpOff: mcpOff.join(), account: account?.id ?? null, planKind: r.plan };
      setLive(l, selected.label);
      return l;
    } catch (e) {
      onError(String(e));
      return null;
    }
  };

  const dispatch = async (txt: string) => {
    setBusy(true);
    started.current = Date.now();
    toBottom();
    const ck = await api.createCheckpoint(ws.id, t("chat.checkpointBefore", { text: txt.slice(0, 60) })).catch(() => null);
    const firstMessage = !itemsRef.current.some((i) => i.k === "user" && !i.queued);
    setItems((it) => {
      const qi = it.findIndex((i) => i.k === "user" && i.queued && i.text === txt);
      const u: Item = { k: "user", text: txt, checkpoint: ck?.id };
      return qi >= 0 ? [...it.slice(0, qi), ...it.slice(qi + 1), u] : [...it, u];
    });
    if (firstMessage) api.autoBranch(ws.id, txt).then((w) => w && onWorkspaceChange(), () => {});
    // A lista de modelos ainda não chegou (aba recém-aberta) ou há troca da aba Uso que ainda não dá para
    // aplicar: envia assim que der, sem perder a mensagem. Lê pelo ref e pelo `sendNowRef`: depois dos awaits
    // acima, `selected` desta closure pode estar velho (a lista chegou no meio).
    if (!resolveSwitches()) return void (pendingSendRef.current = txt);
    await sendNowRef.current(txt);
  };
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const accountRef = useRef(account);
  accountRef.current = account;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // Modelo/conta já decididos por uma troca, mas que o render ainda pode não mostrar (setPrefs/setAccount
  // são assíncronos): o envio usa este valor, não o `selected` velho. Some quando o render alcança.
  const choiceRef = useRef<Choice | null>(null);
  useEffect(() => void (choiceRef.current = null), [prefs.selected, account]);
  /**
   * Aba Uso / barra do Kabul: perto do limite, troca a conta ou o LLM desta conversa (pelo mesmo caminho da
   * troca manual: handoff na mesma conversa e branch). Fora da tela a aba não está montada: o pedido fica
   * guardado (usageSwitch.ts) e é aplicado aqui. Devolve o modelo e a conta efetivos para o envio, já com as
   * trocas pendentes aplicadas de forma síncrona; `null` enquanto não dá para aplicar (lista de modelos ou
   * histórico ainda chegando): aí nenhum envio sai, para não ir pelo provedor que estava no limite.
   */
  const resolveSwitches = (): Choice | null => {
    const base = choiceRef.current ?? (selectedRef.current ? { sel: selectedRef.current, acc: accountRef.current } : null);
    const list = pendingUsageSwitches(sessionId);
    if (!list.length) return base;
    if (!base || !modelsRef.current.length || !loadedRef.current) return null;
    let { sel, acc } = base;
    for (const d of list) {
      // Avaliado com o modelo e a conta reais: aplicado, ou não vale para esta conversa (outro provedor, local).
      markUsageSwitch(sessionId, d);
      if (PROVIDER_OF[sel.harness] !== d.provider || sel.local) continue;
      if (d.account) acc = d.account;
      const m = d.toProvider ? modelsRef.current.find((x) => !x.local && PROVIDER_OF[x.harness] === d.toProvider) : undefined;
      if (m) (sel = m), (acc = null);
    }
    if (sel === base.sel && acc === base.acc) return base;
    const key = sel.key;
    choiceRef.current = { sel, acc };
    setPrefs((p) => ({ ...p, selected: key }));
    setAccount(acc);
    return choiceRef.current;
  };
  const resolveRef = useRef(resolveSwitches);
  resolveRef.current = resolveSwitches;
  useEffect(() => {
    resolveRef.current();
    const h = () => resolveRef.current();
    window.addEventListener("kabul:usage-switch", h);
    return () => window.removeEventListener("kabul:usage-switch", h);
  }, [models, sessionId, !!selected, loaded]);
  const pendingSendRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingSendRef.current || !resolveSwitches()) return;
    const t = pendingSendRef.current;
    pendingSendRef.current = null;
    void sendNow(t);
  }, [selected, loaded]);
  const sendNowRef = useRef<(t: string) => Promise<void>>(async () => {});
  sendNowRef.current = (t: string) => sendNow(t);
  const sendNow = async (t: string) => {
    const c = resolveSwitches();
    if (!c) return void (pendingSendRef.current = t);
    stoppedRef.current = null;
    const l = await ensure(c);
    if (!l) return setBusy(false);
    let payload = t;
    if (replayRef.current) {
      replayRef.current = false;
      const ch = await api.changes(ws.id).catch(() => []);
      payload = `${handoffText(itemsRef.current.filter((i) => !(i.k === "user" && i.text === t)), ch.map((c) => c.path), ws.branch)}\n---\n\n${t}`;
    }
    api.chatSend(l.id, payload).catch((e) => (onError(String(e)), setBusy(false)));
  };

  // Fila: manda a próxima quando o agente fica livre.
  useEffect(() => {
    if (!busy && !waiting && queue.length && !queuePaused) {
      const [next, ...rest] = queue;
      setQueue(rest);
      dispatch(next);
    }
  }, [busy, waiting, queue, queuePaused]);

  const sendRef = useRef<(t: string) => void>(() => {});
  sendRef.current = (t: string) => (busy || waiting ? (setQueue((q) => [...q, t]), setItems((it) => [...it, { k: "user", text: t, queued: true }])) : dispatch(t));
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    setSuggest(null);
    toBottom();
    if (t === "/plan") return setPlan((p) => !p);
    // Agente trabalhando ou esperando aprovação: a mensagem entra na fila (ou redireciona).
    if (busy || waiting) {
      if (chatPrefs.followUp() === "steer" && live) return steer(t);
      setQueue((q) => [...q, t]);
      setItems((it) => [...it, { k: "user", text: t, queued: true }]);
      return;
    }
    dispatch(t);
  };
  /** Redirecionar: manda já, no meio do turno (o Claude incorpora a mensagem no turno em andamento). */
  const steer = (txt: string) => {
    if (!live) return dispatch(txt);
    setItems((it) => [...it.filter((i) => !(i.k === "user" && i.queued && i.text === txt)), { k: "user", text: txt }, { k: "notice", text: t("chat.steering") }]);
    setQueue((q) => q.filter((x) => x !== txt));
    api.chatSend(live.id, txt).catch((e) => onError(String(e)));
  };
  const editQueued = (t: string) => {
    setQueue((q) => q.filter((x) => x !== t));
    setItems((it) => it.filter((i) => !(i.k === "user" && i.queued && i.text === t)));
    setText(t);
    input.current?.focus();
  };
  const deleteQueued = (t: string) => {
    setQueue((q) => q.filter((x) => x !== t));
    setItems((it) => it.filter((i) => !(i.k === "user" && i.queued && i.text === t)));
  };

  // Parar: interrompe só o agente (pelo protocolo dele; a sessão continua retomável). Passos pendentes viram
  // "interrompido" e o marcador vai no fim do turno. O que o agente deixou rodando é listado para o usuário
  // decidir (manter é o padrão); nada é encerrado sozinho.
  const stop = async () => {
    const cur = liveRef.current;
    if (cur) stoppedRef.current = cur.id;
    setBusy(false);
    chatStore.interruptSubs(sessionId);
    setItems((it) => interrupted(it));
    if (!cur) return;
    const r = await api.chatInterrupt(cur.id).catch(() => null);
    if (!r?.alive) setLive(null);
    if (!r || (!r.leftovers.length && !r.containers.length)) return;
    const remember = localStorage.getItem(`kabul.leftovers.${ws.id}`);
    if (remember === "kill") {
      await api.processKill(r.leftovers.map(({ pid, start }) => ({ pid, start }))).catch((e) => onError(String(e)));
      for (const c of r.containers) await api.dockerStop(c.id).catch((e) => onError(String(e)));
      return setItems((it) => [...it, { k: "leftovers", procs: r.leftovers, containers: r.containers, decided: "killed", killed: r.leftovers.map((p) => p.pid), stopped: r.containers.map((c) => c.id) }]);
    }
    if (remember === "keep") {
      await api.processesKeep(r.leftovers, ws.id).catch(() => {});
      return setItems((it) => [...it, { k: "leftovers", procs: r.leftovers, containers: r.containers, decided: "kept" }]);
    }
    setItems((it) => [...it, { k: "leftovers", procs: r.leftovers, containers: r.containers }]);
  };
  const decideLeftovers = async (n: number, kill: import("../api").Leftover[], keep: import("../api").Leftover[], remember: "keep" | "kill" | null) => {
    if (remember) localStorage.setItem(`kabul.leftovers.${ws.id}`, remember);
    if (keep.length) await api.processesKeep(keep, ws.id).catch(() => {});
    if (kill.length) await api.processKill(kill.map(({ pid, start }) => ({ pid, start }))).catch((e) => onError(String(e)));
    setItems((it) => it.map((x, j) => (j === n && x.k === "leftovers" ? { ...x, decided: kill.length ? "killed" : "kept", killed: kill.map((p) => p.pid) } : x)));
  };
  const stopContainer = async (n: number, id: string) => {
    await api.dockerStop(id).then(() => setItems((it) => it.map((x, j) => (j === n && x.k === "leftovers" ? { ...x, stopped: [...(x.stopped ?? []), id] } : x))), (e) => onError(String(e)));
  };

  // Arquivar/sair com agentes rodando: "parar e arquivar" para todas as conversas do workspace.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const h = (e: Event) => ((e as CustomEvent).detail === ws.id || (e as CustomEvent).detail === "*") && busy && stopRef.current();
    const one = (e: Event) => (e as CustomEvent).detail === sessionId && stopRef.current();
    window.addEventListener("kabul:stop-all", h);
    window.addEventListener("kabul:stop-chat", one);
    return () => (window.removeEventListener("kabul:stop-all", h), window.removeEventListener("kabul:stop-chat", one));
  }, [ws.id, busy]);

  const decide = (rid: string, allow: boolean, always = false, updatedInput?: unknown) => {
    if (!live) return;
    const tool = (items.find((i) => i.k === "approval" && i.id === rid) as { tool?: string } | undefined)?.tool;
    setItems((it) => it.map((i) => (i.k === "approval" && i.id === rid ? { ...i, decided: true, allow, always } : i)));
    setBusy(true);
    api.chatApprove(live.id, rid, allow, { tool, always, updatedInput }).catch((e) => onError(String(e)));
  };

  // Fork e reset a partir de um turno.
  const turnBounds = (n: number) => {
    const nextUser = items.findIndex((x, k) => k > n && x.k === "user" && !x.queued);
    const nextCk = nextUser >= 0 ? (items[nextUser] as { checkpoint?: string }).checkpoint ?? null : null;
    return { isLast: nextUser < 0, nextCk };
  };
  const forkTab = (n: number) => {
    const { isLast } = turnBounds(n);
    window.dispatchEvent(new CustomEvent("kabul:fork-tab", { detail: { ws: ws.id, fork: { items: items.slice(0, n + 1), resume: agentSession, forkSession: isLast && harnessRef.current === "claude", replay: !(isLast && harnessRef.current === "claude"), modelKey: prefs.selected } as PendingFork } }));
  };
  const forkTabRef = useRef(forkTab);
  forkTabRef.current = forkTab;
  const forkWorkspace = async (n: number) => {
    const { isLast, nextCk } = turnBounds(n);
    try {
      const w = await api.workspaceFork(ws.id, isLast ? null : nextCk, agentSession);
      window.dispatchEvent(new CustomEvent("kabul:fork-ws", { detail: { ws: w.id, fork: { items: items.slice(0, n + 1), resume: agentSession, forkSession: harnessRef.current === "claude", replay: harnessRef.current !== "claude", modelKey: prefs.selected } as PendingFork } }));
      onWorkspaceChange();
      window.dispatchEvent(new CustomEvent("kabul:route", { detail: { kind: "workspace", id: w.id } }));
    } catch (e) {
      onError(String(e));
    }
  };
  const resetChat = async (n: number) => {
    const { isLast, nextCk } = turnBounds(n);
    if (isLast) return;
    if (!(await confirmDialog(t("chat.reset.confirm"), { ok: t("chat.reset.ok"), danger: true, checkbox: { label: t("chat.reset.files"), key: "kabul.resetFiles" } }))) return;
    if (live) await api.chatStop(live.id).catch(() => {});
    setLive(null);
    setBusy(false);
    if (localStorage.getItem("kabul.resetFiles") === "1" && nextCk) await api.restoreCheckpoint(ws.id, nextCk).then(onWorkspaceChange, (e) => onError(String(e)));
    setItems((it) => [...it.slice(0, n + 1), { k: "notice", text: t("chat.reset.done") }]);
    setAgentSession(null);
    replayRef.current = true;
  };

  const restore = async (ck: string) => {
    if (!(await confirmDialog(t("chat.restore.confirm"), { ok: t("chat.restore.ok"), danger: true }))) return;
    try {
      await api.restoreCheckpoint(ws.id, ck);
      setItems((it) => [...it, { k: "notice", text: t("chat.restore.done") }]);
      onWorkspaceChange();
    } catch (e) {
      onError(String(e));
    }
  };

  const attach = async () => {
    const p = await api.pickFile().catch(() => null);
    if (!p) return;
    try {
      const rel = await api.attachFile(ws.id, p);
      setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${rel} `);
      input.current?.focus();
    } catch (e) {
      onError(String(e));
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.files][0];
    const pasted = e.clipboardData.getData("text/plain");
    // Texto colado com mais de 5.000 caracteres vira anexo (Configurações › Geral).
    if (!f && pasted.length > 5000 && appSet?.auto_convert_long_text !== false) {
      e.preventDefault();
      const rel = await api.attachBytes(ws.id, `colado-${Date.now()}.txt`, Array.from(new TextEncoder().encode(pasted)));
      setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${rel} `);
      return;
    }
    if (!f) return;
    e.preventDefault();
    const rel = await api.attachBytes(ws.id, f.name || `colado-${Date.now()}.png`, Array.from(new Uint8Array(await f.arrayBuffer())));
    setText((t) => `${t} @${rel} `);
  };

  // Autocomplete de @arquivo e /comando.
  const onChangeText = (v: string, caret: number) => {
    setText(v);
    const before = v.slice(0, caret);
    const m = before.match(/(^|\s)([@/])([^\s]*)$/);
    if (m && (m[2] === "@" || m[1] !== "" || before.startsWith("/"))) setSuggest({ kind: m[2] as "@" | "/", q: m[3], sel: 0 });
    else if (suggest) setSuggest(null);
  };
  const options = useMemo(() => {
    if (!suggest) return [];
    const q = suggest.q.toLowerCase();
    return suggest.kind === "@"
      ? [...issues.filter((i) => `${i.identifier} ${i.title}`.toLowerCase().includes(q)).slice(0, 4).map((i) => [i.identifier, `Linear · ${i.title}`] as [string, string]), ...files.filter((f) => f.toLowerCase().includes(q)).slice(0, 8).map((f) => [f, ""] as [string, string])]
      : commands.filter(([c]) => c.slice(1).toLowerCase().startsWith(q)).slice(0, 8);
  }, [suggest, files, commands]);
  const pickOption = (o: string) => {
    const el = input.current!;
    const caret = el.selectionStart;
    const issue = issues.find((i) => i.identifier === o);
    const before = text.slice(0, caret).replace(/([@/])[^\s]*$/, (_m, s) => (issue ? `[${issue.identifier}: ${issue.title}](${issue.url}) ` : `${s}${suggest?.kind === "/" ? o.slice(1) : o} `));
    setText(before + text.slice(caret));
    setSuggest(null);
    el.focus();
  };

  // Atalhos do composer.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "Tab" && document.activeElement === input.current) {
        e.preventDefault();
        setPlan((p) => !p);
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        dictation.toggle();
        return;
      }
      if (e.ctrlKey && !e.metaKey && e.code === "KeyO") {
        e.preventDefault();
        setNoCollapse((v) => (chatPrefs.set("noCollapse", v ? "0" : "1"), !v));
        return;
      }
      if (e.key === "Escape" && busy && !suggest) {
        e.preventDefault();
        stop();
        return;
      }
      if (!e.metaKey) return;
      // ⌘F busca no chat (no terminal, o ⌘F é do terminal).
      if (e.code === "KeyF" && !e.shiftKey && !e.altKey && !(document.activeElement as HTMLElement | null)?.closest(".terminal")) {
        e.preventDefault();
        setFinding(true);
        return;
      }
      if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const k = prefs.favorites[Number(e.key) - 1];
        if (k) (e.preventDefault(), setPrefs((p) => ({ ...p, selected: k })));
      } else if (e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setPrefs((p) => ({ ...p, fast: !p.fast }));
      } else if (e.shiftKey && (e.key === "/" || e.key === "?")) {
        e.preventDefault();
        if (selected?.efforts.length) {
          const i = selected.efforts.indexOf(effort ?? "");
          setPrefs((p) => ({ ...p, effort: selected.efforts[(i + 1) % selected.efforts.length] }));
        }
      } else if (e.shiftKey && e.key === "Backspace") {
        e.preventDefault();
        if (busy) stop();
      } else if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        const lastTurn = [...items.keys()].filter((k) => items[k].k === "turn").pop();
        if (lastTurn !== undefined) forkTab(lastTurn);
      } else if (e.key.toLowerCase() === "u" && !e.shiftKey) {
        e.preventDefault();
        attach();
      } else if (e.key.toLowerCase() === "l" && !e.shiftKey) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, prefs.favorites, selected, effort, dictation, setPrefs, busy, suggest]);

  // ---------- fio: arranjo em uma passada, janela das mensagens recentes e linhas memorizadas ----------
  const layout = useMemo(() => layoutOf(items, noCollapse, expanded, ws.path), [items, noCollapse, expanded, ws.path]);
  // A janela começa numa mensagem sua (um turno nunca aparece cortado); ⌘F desenha tudo para buscar.
  let startIdx = finding ? 0 : Math.max(0, items.length - win);
  if (startIdx > 0) startIdx = [...layout.userIdx].reverse().find((k) => k <= startIdx) ?? 0;
  const ctx = useRef<RowCtx>(null as never);
  ctx.current = {
    openFile: (p: string) => window.dispatchEvent(new CustomEvent("kabul:open-file", { detail: { ws: ws.id, path: p.startsWith(ws.path) ? p.slice(ws.path.length + 1) : p } })),
    expand: (u: number) => setExpanded((e) => new Set(e).add(u)),
    editQueued, deleteQueued, steer, restore, decide, setPlan, send: (t: string) => sendRef.current(t),
    newChatWith: (t: string) => window.dispatchEvent(new CustomEvent("kabul:new-chat-with", { detail: { ws: ws.id, text: t } })),
    decideLeftovers, stopContainer,
    quote: (t: string) => setText((x) => `${x}${x ? "\n" : ""}> ${t.split("\n").join("\n> ")}\n\n`),
    forkTab, forkWorkspace, resetChat,
  };
  const jump = (n: number) => {
    if (n < startIdx) {
      jumpTo.current = n;
      setWin(items.length - n + 20);
    } else scroller.current?.querySelector(`[data-msg="${n}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const jumpRef = useRef(jump);
  jumpRef.current = jump;
  const onJump = useCallback((n: number) => jumpRef.current(n), []);
  const harnessNow = live?.harness ?? selected?.harness;
  const slot = useChatSelect(() => chatStore.get(sessionId)?.queue ?? null);
  return (
    <div className="chat">
      <Minimap items={items} onJump={onJump} />
      {finding && <ChatFind root={threadRef} scroller={scroller} version={items.length} onClose={() => setFinding(false)} />}
      {quoteBtn && createPortal(
        <button className="btn small quote-btn" style={{ left: quoteBtn.x, top: quoteBtn.y }} onMouseDown={(e) => e.preventDefault()}
          onClick={() => (setText((x) => `${x}${x ? "\n" : ""}> ${quoteBtn.text.split("\n").join("\n> ")}\n\n`), setQuoteBtn(null), window.getSelection()?.removeAllRanges(), setTimeout(() => input.current?.focus(), 0))} data-testid="quote-selection">{t("chat.quote")}</button>,
        document.body,
      )}
      <div className="messages" ref={scroller} onScroll={onScroll} onMouseUp={() => {
        // Citar: texto selecionado numa resposta vira citação na próxima mensagem.
        const sel = window.getSelection();
        const picked = sel?.toString().trim();
        const node = sel?.anchorNode instanceof Element ? sel.anchorNode : sel?.anchorNode?.parentElement;
        if (!picked || !sel?.rangeCount || !node?.closest(".msg-assistant")) return setQuoteBtn(null);
        const r = sel.getRangeAt(0).getBoundingClientRect();
        setQuoteBtn({ x: Math.round(r.left), y: Math.round(r.top - 34), text: picked });
      }}>
        <div className="thread" ref={threadRef}>
          {items.length === 0 && (
            <div className="chat-empty">
              <div className="ce-title">{ws.title || ws.name}</div>
              <div className="dim">{tNode("chat.empty.branch", { branch: <code>{ws.branch}</code>, from: ws.port, to: ws.port + 9 })}</div>
              <div className="ce-hints dim">{tNode("chat.empty.hints", { at: <kbd>@</kbd>, slash: <kbd>/</kbd>, plan: <kbd>⇧⇥</kbd>, attach: <kbd>⌘U</kbd> })}</div>
            </div>
          )}
          {startIdx > 0 && <button className="text-btn small older-btn" onClick={() => { const s = scroller.current; if (s) anchor.current = { h: s.scrollHeight, top: s.scrollTop }; setWin((w) => w + WINDOW_STEP); }} data-testid="load-older">{t("chat.loadOlder", { n: startIdx })}</button>}
          <Thread items={items} start={startIdx} layout={layout} busy={busy} noAbs={!!appSet?.not_absolutely_right} ctx={ctx} />
          {!busy && bgTasks > 0 && <WorkingLine testid="bg-tasks" since={started.current} text={t("chat.bgTasks", { count: bgTasks })} />}
          {busy && !waiting && slot && <WorkingLine testid="slot-wait" since={started.current} text={t("chat.slotWait", { pos: slot.position }) + (slot.limit ? t("chat.slotLimit", { n: slot.limit }) : "")} />}
          {busy && !waiting && !slot && <WorkingLine since={started.current} text={activity(items.slice(items.map((x) => x.k).lastIndexOf("user") + 1) as never)} />}
        </div>
      </div>

      <div className="composer-wrap">
        {(queue.length > 0 || note || (live && !live.approvals)) && (
          <div className="composer-notes">
            {queue.length > 0 && <span><IQueueIcon /> {t("chat.queue.count", { n: queue.length })} <button className="text-btn" onClick={() => setQueuePaused((p) => !p)}>{queuePaused ? t("chat.queue.resume") : t("chat.queue.pause")}</button> <button className="text-btn" onClick={() => { setQueue([]); setItems((it) => it.filter((i) => !(i.k === "user" && i.queued))); }}>{t("chat.queue.clear")}</button></span>}
            {note && <span title={t("chat.noteTitle")}>{note}</span>}
            {live && !live.approvals && <span>{t("chat.noApprovals", { harness: HARNESS_LABEL[live.harness] })}</span>}
          </div>
        )}
        <SubagentBar session={sessionId} />
        <div className={"composer" + (plan ? " plan" : "")}>
          {suggest && options.length > 0 && (
            <Floating className="suggest" placement="top-start" testid="suggest">
              {options.map(([o, d], k) => (
                <div key={o} className={"pop-row" + (k === suggest.sel ? " on" : "")} onMouseDown={(e) => (e.preventDefault(), pickOption(o))}>
                  <span className="label">{o}</span><span className="grow" /><span className="dim">{d}</span>
                </div>
              ))}
            </Floating>
          )}
          {!text && <span className="focus-hint">{t("chat.focusHint")}</span>}
          {plan && <div className="plan-chip" data-testid="plan-chip"><IPlan size={13} /> {live?.planKind === "emulated" ? t("chat.plan.emulated") : t("chat.plan.mode")} <span className="dim">· {live?.planKind === "emulated" ? t("chat.plan.emulatedHint", { harness: HARNESS_LABEL[live.harness] }) : t("chat.plan.hint")}</span></div>}
          <textarea ref={input} rows={3} autoCorrect="off" {...noSuggest} placeholder={t("chat.composer.placeholder")} value={text} data-testid="composer"
            onChange={(e) => onChangeText(e.target.value, e.target.selectionStart)} onPaste={onPaste}
            onKeyDown={(e) => {
              if (suggest && options.length) {
                if (e.key === "ArrowDown") return (e.preventDefault(), setSuggest({ ...suggest, sel: (suggest.sel + 1) % options.length }));
                if (e.key === "ArrowUp") return (e.preventDefault(), setSuggest({ ...suggest, sel: (suggest.sel - 1 + options.length) % options.length }));
                if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pickOption(options[suggest.sel][0]));
                if (e.key === "Escape") return (e.preventDefault(), setSuggest(null));
              }
              const pending = pendingApproval;
              if (pending && !text.trim() && pending.tool !== "AskUserQuestion") {
                if (pending.tool === "ExitPlanMode" && e.key === "Enter" && e.metaKey && e.shiftKey) return (e.preventDefault(), decide(pending.id, true), setPlan(false));
                if (pending.tool !== "ExitPlanMode") {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return (e.preventDefault(), decide(pending.id, true, true));
                  if (e.key === "Enter" && !e.shiftKey) return (e.preventDefault(), decide(pending.id, true));
                  if (e.key === "Backspace") return (e.preventDefault(), decide(pending.id, false));
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                const cmd = e.metaKey || e.ctrlKey;
                if (chatPrefs.sendKey() === "cmdEnter" && !cmd) return;
                e.preventDefault();
                send();
              }
            }} />
          <div className="composer-foot">
            <ModelPicker models={models} prefs={prefs} setPrefs={setPrefs} selected={selected} effort={effort} activeHarness={live?.harness ?? null} listen={active} />
            {selected && PROVIDER_OF[selected.harness] && !selected.local && (
              <div className="picker" ref={accRef}>
                <button className="account-chip" title={t("chat.account.title")} onClick={() => (setAccOpen(!accOpen), api.accountsList(PROVIDER_OF[selected.harness]!).then(setAccounts, () => {}))} data-testid="account-chip">
                  {account?.nickname ?? t("chat.account.default")} <span className="dim">˅</span>
                </button>
                {accOpen && (
                  <Floating className="status-pop account-pop" placement="top-start" testid="account-menu">
                    <div className="pop-title">{t("chat.account.thisChat")}</div>
                    {accounts.map((a) => (
                      <div key={a.id} className={"pop-row" + ((account?.id ?? accounts.find((x) => x.default)?.id) === a.id ? " on" : "")} onClick={() => (setAccount({ id: a.id, nickname: a.nickname }), setAccOpen(false))} data-testid="account-option">
                        {a.nickname}{a.default && <span className="dim small"> · {t("chat.account.defaultShort")}</span>}<span className="grow" /><span className={"badge " + (a.logged_in ? "ok" : "")}>{a.logged_in ? t("chat.account.loggedIn") : t("chat.account.noLogin")}</span>
                      </div>
                    ))}
                    <div className="pop-sep" />
                    <div className="pop-row" onClick={() => (setAccOpen(false), window.dispatchEvent(new CustomEvent("kabul:route", { detail: { kind: "settings", tab: "contas" } })))}>{t("chat.account.manage")}</div>
                  </Floating>
                )}
              </div>
            )}
            {plan && <span className="dim small">{t("chat.plan.short")}</span>}
            <div className="grow" />
            <div className="picker" ref={appsRef}>
              <button className={"icon-btn" + (appsOpen ? " on" : "")} title={t("chat.apps")} onClick={() => (setAppsOpen(!appsOpen), setCtxOpen(false))} data-testid="apps"><IApps /></button>
              {appsOpen && harnessNow && <McpPanel workspaceId={ws.id} repoId={ws.repo_id} harness={harnessNow} live={mcpLive} sessionOff={sessionOff} setSessionOff={setSessionOff} onError={onError} />}
            </div>
            <div className="picker" ref={ctxRef}>
              <ContextRing used={ctxUsed} total={selected?.context ?? null} on={ctxOpen} quiet={!appSet?.always_show_context} onClick={() => (setCtxOpen(!ctxOpen), setAppsOpen(false))} />
              {ctxOpen && (() => {
                const tools = mcpLive?.total ?? 0;
                const mcpTools = Object.values(mcpLive?.tools ?? {}).reduce((a, b) => a + b, 0);
                const files = items.reduce((a, i) => a + (i.k === "tool" && /read|glob|grep|cat/i.test(i.name) ? (i.output?.length ?? 0) / 4 : 0), 0);
                const base = Math.min(ctxBase || ctxUsed, ctxUsed);
                const toolsT = Math.min(base * 0.45, (tools - mcpTools) * 350);
                const mcpT = Math.min(base - toolsT, mcpTools * 450);
                const parts = { system: Math.max(0, base - toolsT - mcpT), tools: toolsT, mcp: mcpT, files: Math.min(files, Math.max(0, ctxUsed - base)), messages: 0 };
                parts.messages = Math.max(0, ctxUsed - base - parts.files);
                return <ContextPanel used={ctxUsed} total={selected?.context ?? null} parts={parts} canCompact={harnessNow === "claude" || harnessNow === "qwen" || harnessNow === "opencode"} onCompact={() => (setCtxOpen(false), dispatch("/compact"))} />;
              })()}
            </div>
            <button className="icon-btn" title={t("chat.attach")} onClick={attach} data-testid="attach"><IPlus /></button>
            <button className={"icon-btn mic " + dictation.state} title={t("chat.dictation.title")} onClick={dictation.toggle} data-testid="mic">
              {dictation.state === "transcribing" ? <span className="spinner" /> : <IMic />}
            </button>
            {/* Trabalhando: Parar e Enviar lado a lado (enviar enfileira ou redireciona). */}
            {busy && <button className="send stop" title={t("chat.stop")} onClick={stop} data-testid="stop"><IStop size={12} /></button>}
            <button className="send" title={busy ? (chatPrefs.followUp() === "steer" ? t("chat.steerNow") : t("chat.enqueue")) : t("common.send")} disabled={!text.trim()} onClick={send} data-testid="send"><IArrowUp size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RowCtx {
  openFile: (p: string) => void; expand: (u: number) => void; editQueued: (t: string) => void; deleteQueued: (t: string) => void; steer: (t: string) => void;
  restore: (ck: string) => void; decide: (rid: string, allow: boolean, always?: boolean, updatedInput?: unknown) => void; setPlan: (p: boolean) => void; send: (t: string) => void;
  newChatWith: (t: string) => void; decideLeftovers: (n: number, kill: import("../api").Leftover[], keep: import("../api").Leftover[], remember: "keep" | "kill" | null) => void;
  stopContainer: (n: number, id: string) => void; quote: (t: string) => void; forkTab: (n: number) => void; forkWorkspace: (n: number) => void; resetChat: (n: number) => void;
}

/** O fio desenhado: só a janela [start, fim), e cada linha só re-renderiza se o item dela mudou. */
const Thread = memo(function Thread({ items, start, layout, busy, noAbs, ctx }: { items: Item[]; start: number; layout: Layout; busy: boolean; noAbs: boolean; ctx: React.RefObject<RowCtx> }) {
  const out: React.ReactNode[] = [];
  for (let n = start; n < items.length; n++) {
    const i = items[n];
    const tu = i.k === "turn" ? layout.turn.get(n) : undefined;
    const er = i.k === "error" ? layout.err.get(n) : undefined;
    out.push(<Row key={n} item={i} n={n} toggle={layout.toggles.get(n)} hidden={!!layout.hidden[n]} busy={i.k === "user" || i.k === "error" ? busy : false} noAbs={i.k === "assistant" && noAbs}
      isLast={tu?.isLast} checkpoint={tu?.checkpoint} files={tu?.files} tail={er ? er.tail && !busy : undefined} lastUser={er?.lastUser} ctx={ctx} />);
  }
  return <>{out}</>;
});

const Row = memo(function Row({ item: i, n, toggle, hidden, busy, noAbs, isLast, checkpoint, files, tail, lastUser, ctx }: {
  item: Item; n: number; toggle?: string; hidden: boolean; busy: boolean; noAbs: boolean; isLast?: boolean; checkpoint?: string; files?: string; tail?: boolean; lastUser?: string; ctx: React.RefObject<RowCtx>;
}) {
  const c = () => ctx.current!;
  let tg: React.ReactNode = null;
  if (toggle) {
    const [user, tools, msgs, shell] = toggle.split("|").map(Number);
    tg = (
      <button className="steps-toggle" onClick={() => c().expand(user)} data-testid="expand-steps" title={t("chat.steps.show")}>
        <span className="st-chev">›</span>
        {[tools && t("chat.steps.tools", { count: tools }), msgs && t("chat.steps.msgs", { count: msgs })].filter(Boolean).join(", ")}
        {shell ? <span className="st-shell mono" data-testid="steps-shell">{">_"}</span> : null}
      </button>
    );
  }
  if (hidden) return tg;
  let body: React.ReactNode = null;
  switch (i.k) {
    case "user": body = (
      <div data-msg={n} className={"msg-user" + (i.queued ? " queued" : "")} data-testid={i.queued ? "queued-msg" : undefined}>
        {i.text}
        {i.queued && <span className="badge">{t("chat.queue.badge")}</span>}
        {i.queued && (
          <span className="q-actions">
            <button className="text-btn small" onClick={() => c().editQueued(i.text)} data-testid="queue-edit">{t("common.edit")} <kbd>e</kbd></button>
            <button className="text-btn small" onClick={() => c().deleteQueued(i.text)} data-testid="queue-delete">{t("common.delete")} <kbd>⌫</kbd></button>
            <button className="text-btn small" onClick={() => c().steer(i.text)} data-testid="queue-steer">{t("chat.queue.sendNow")} <kbd>↵</kbd></button>
          </span>
        )}
        {i.checkpoint && !busy && <button className="icon-btn restore" title={t("chat.restore.title")} onClick={() => c().restore(i.checkpoint!)}><IRestore size={13} /></button>}
      </div>
    ); break;
    case "assistant": body = <div data-msg={n} className="msg-assistant"><MdMemo text={noAbs ? stripAbsolutelyRight(i.text) : i.text} ctx={ctx} />{i.streaming && <span className="caret" />}</div>; break;
    case "reasoning": body = <ThinkingCard text={i.text} />; break;
    case "tool": body = <ToolCard name={i.name} input={i.input} output={i.output} error={i.error} interrupted={i.interrupted} onOpenFile={(p) => c().openFile(p)} />; break;
    case "leftovers": body = <LeftoversCard item={i} onDecide={(kill, keep, remember) => c().decideLeftovers(n, kill, keep, remember)} onDockerStop={(id) => c().stopContainer(n, id)} />; break;
    case "approval":
      if (i.tool === "ExitPlanMode") body = <PlanCard plan={String((i.input as { plan?: string })?.plan ?? "")} decided={i.decided} allow={i.allow}
        onApprove={() => (c().decide(i.id, true), c().setPlan(false))}
        onAdjust={(adj) => (c().decide(i.id, false), setTimeout(() => c().send(adj), 300))}
        onHandOff={() => (c().decide(i.id, false), c().newChatWith(t("chat.plan.implement", { plan: (i.input as { plan?: string })?.plan ?? "" })))} />;
      else if (i.tool === "AskUserQuestion") body = <QuestionCard input={i.input} decided={i.decided} onSubmit={(answers) => c().decide(i.id, true, false, { ...(i.input as object), answers })} onSkip={() => c().decide(i.id, false)} />;
      else body = <ApprovalCard tool={i.tool} input={i.input} decided={i.decided} allow={i.allow} always={i.always} onDecide={(a, al) => c().decide(i.id, a, al)} />;
      break;
    case "turn": body = <TurnMeta item={i} files={JSON.parse(files ?? "[]")} onOpenFile={(p) => c().openFile(p)} checkpoint={checkpoint}
      isLast={!!isLast} onRestore={(ck) => c().restore(ck)} onQuote={(q) => c().quote(q)}
      onForkTab={() => c().forkTab(n)} onForkWorkspace={() => c().forkWorkspace(n)} onReset={() => c().resetChat(n)} />; break;
    case "handoff": body = <div className="handoff-divider" data-testid="handoff"><span>{i.text}</span></div>; break;
    case "notice": body = <div className="notice">{i.text}</div>; break;
    case "error": body = (
      // Último erro do fim da conversa: tentar de novo (aqui ou numa conversa nova) e copiar os detalhes.
      <div className="msg-error" data-testid="msg-error">
        <div>{i.text}</div>
        {tail && (
          <div className="row err-actions">
            {lastUser && <button className="btn small" onClick={() => c().send(lastUser)} data-testid="retry">{t("common.retry")}</button>}
            {lastUser && <button className="btn small" onClick={() => c().newChatWith(lastUser)} data-testid="retry-new">{t("chat.retryNew")}</button>}
            <button className="text-btn small" onClick={() => navigator.clipboard.writeText(i.text)} data-testid="copy-error">{t("chat.copyDetails")}</button>
          </div>
        )}
      </div>
    ); break;
  }
  return <>{tg}{body}</>;
});

/** Markdown memorizado pelo texto (o parse só refaz quando a mensagem muda). */
const MdMemo = memo(function MdMemo({ text, ctx }: { text: string; ctx: React.RefObject<RowCtx> }) {
  const onFile = useCallback((p: string) => ctx.current!.openFile(p), [ctx]);
  return <Markdown text={text} onFile={onFile} />;
});

/** Subagentes da conversa (pai → filhos): status, tempo, ferramentas, tokens e custo de cada um. */
function SubagentBar({ session }: { session: string }) {
  const subs = useChatSelect(() => chatStore.get(session)?.subs ?? null, Object.is);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));
  const list = subs ? Object.values(subs) : [];
  if (!list.length) return null;
  const running = list.filter((s) => s.status === "running").length;
  return (
    <div className="subagent-bar picker" ref={ref}>
      <button className={"text-btn small" + (open ? " on" : "")} onClick={() => setOpen(!open)} data-testid="subagents-btn">
        {running > 0 && <span className="spinner tiny" />} {t("chat.subagents", { count: list.length })}{running ? ` · ${t("chat.subagentsRunning", { n: running })}` : ""}
      </button>
      {open && <Floating className="status-pop subagent-pop" placement="top-start" testid="subagents-pop"><div className="pop-title">{t("chat.subagentsTitle")}</div><SubagentTree subs={subs!} /></Floating>}
    </div>
  );
}

function IQueueIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6" /></svg>;
}

/** Minimapa à direita do chat: um traço por mensagem (claro = sua, escuro = do agente); clique pula até ela. */
const Minimap = memo(function Minimap({ items, onJump }: { items: Item[]; onJump: (n: number) => void }) {
  const marks: { it: Item; n: number }[] = [];
  for (let n = items.length - 1; n >= 0 && marks.length < 40; n--) if (items[n].k === "user" || items[n].k === "assistant") marks.unshift({ it: items[n], n });
  if (marks.length < 2) return null;
  return (
    <div className="minimap" data-testid="minimap">
      {marks.map(({ it, n }) => (
        <button key={n} className={"mm " + it.k} title={(it as { text: string }).text.slice(0, 80)} onClick={() => onJump(n)} />
      ))}
    </div>
  );
}, (a, b) => {
  // Só os traços importam: o texto em streaming não muda o minimapa a cada delta.
  if (a.items.length !== b.items.length) return false;
  const last = a.items.length - 1;
  return last < 0 || a.items[last].k === b.items[last].k;
});

/** Rodapé do turno: tempo (popover com início→fim e tokens), copiar e "···" (fork, reset, citar, restaurar). */
function TurnMeta({ item, files, onOpenFile, isLast, onForkTab, onForkWorkspace, onReset }: {
  item: Extract<Item, { k: "turn" }>; files: { path: string; add: number; del: number }[]; onOpenFile: (p: string) => void; checkpoint?: string; isLast: boolean; onRestore: (c: string) => void; onQuote: (q: string) => void;
  onForkTab: () => void; onForkWorkspace: () => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));
  const tm = (ms?: number) => (ms ? fmtDate(ms, "timeSec") : "—");
  const f = (n: number | null | undefined) => (n == null ? "—" : fmtNum(n));
  const u = item.usage;
  return (
    <div className="turn-meta">
      <span className="picker turn-time" onMouseEnter={() => setTimeOpen(true)} onMouseLeave={() => setTimeOpen(false)} data-testid="turn-time">
        {item.meta}
        {timeOpen && (
          <Floating className="status-pop time-pop" placement="top-start" testid="time-pop">
            <div className="row"><span className="dim">{t("chat.time.range")}</span><span className="grow" />{tm(item.started)} → {tm(item.ended)}</div>
            <div className="row"><span className="dim">{t("chat.time.input")}</span><span className="grow" />{f(u?.input)}</div>
            <div className="row"><span className="dim">{t("chat.time.output")}</span><span className="grow" />{f(u?.output)}</div>
            <div className="row"><span className="dim">{t("chat.time.cacheRead")}</span><span className="grow" />{f(u?.cache_read)}</div>
            <div className="row"><span className="dim">{t("chat.time.cacheWrite")}</span><span className="grow" />{f(u?.cache_write)}</div>
          </Floating>
        )}
      </span>
      <button className="icon-btn" title={t("chat.copyFinal")} onClick={() => navigator.clipboard.writeText(item.copy)}><ICopy size={13} /></button>
      <ReadAloud text={item.copy} />

      <span className="picker" ref={ref}>
        <button className={"icon-btn" + (open ? " on" : "")} title={t("chat.msgActions")} onClick={() => setOpen(!open)} data-testid="turn-more"><IMoreDots /></button>
        {open && (
          <Floating className="status-pop turn-pop" placement="bottom-start">
            <div className="pop-row" onClick={() => (setOpen(false), onForkTab())} data-testid="fork-tab"><IForkTab size={16} /> {t("chat.fork.tab")}</div>
            <div className="pop-row" onClick={() => (setOpen(false), onForkWorkspace())} data-testid="fork-ws"><IFork size={16} /> {t("chat.fork.ws")}</div>
            {!isLast && <div className="pop-row" onClick={() => (setOpen(false), onReset())} data-testid="reset-chat"><IRestore size={16} /> {t("chat.reset.menu")}</div>}
          </Floating>
        )}
      </span>
      {files.length > 0 && (
        <span className="turn-files" data-testid="turn-files">
          {files.slice(0, 6).map((f) => <button key={f.path} className="file-chip" title={t("chat.openDiffOf", { path: f.path })} onClick={() => onOpenFile(f.path)} data-testid="file-chip"><FileIcon name={f.path} size={14} /> {f.path.split("/").pop()} <span className="add">+{f.add}</span> <span className="del">−{f.del}</span></button>)}
          {files.length > 6 && <span className="dim small">+{files.length - 6}</span>}
        </span>
      )}
    </div>
  );
}

function IMoreDots() {
  return <svg width="13" height="13" viewBox="0 0 16 16"><g fill="currentColor"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g></svg>;
}

/** "Ler em voz alta" a resposta final (síntese de voz do sistema pela Web Speech API; pt-BR). */
function ReadAloud({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const toggle = () => {
    if (on) return void (speechSynthesis.cancel(), setOn(false));
    const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/[*_#>\[\]()]/g, "").replace(/\s+/g, " ").trim();
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = locale();
    u.onend = u.onerror = () => setOn(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setOn(true);
  };
  return <button className={"icon-btn" + (on ? " on" : "")} title={on ? t("chat.readAloud.stop") : t("chat.readAloud.start")} onClick={toggle} data-testid="read-aloud"><IVolume size={13} /></button>;
}
