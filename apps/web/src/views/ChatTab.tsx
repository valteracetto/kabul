import { confirmDialog } from "../components/Confirm";
import { noSuggest } from "../noSuggest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, HARNESS_LABEL, type AgentEvent, type HarnessKind, type Model, type Workspace } from "../api";
import { ModelPicker } from "../components/ModelPicker";
import { useModelPrefs } from "../components/prefs";
import { useDictation } from "../components/useDictation";
import { Markdown } from "../components/Markdown";
import { McpPanel, repoDisabled, type McpLive } from "../components/McpPanel";
import { ContextPanel } from "../components/ContextPanel";
import { useDismiss } from "../components/useDismiss";
import type { LinearIssue } from "../api";
import { ToolCard, ThinkingCard, ApprovalCard, PlanCard, QuestionCard } from "../components/ToolCards";
import { chatPrefs, pendingFork, type PendingFork } from "../components/chatPrefs";
import { IApps, IArrowUp, ICopy, IMic, IPlan, IPlus, IRestore, IStop } from "../icons";

export type Item =
  | { k: "user"; text: string; checkpoint?: string; queued?: boolean }
  | { k: "assistant"; text: string; streaming: boolean }
  | { k: "reasoning"; text: string }
  | { k: "tool"; id: string; name: string; input: unknown; output?: string; error?: boolean }
  | { k: "approval"; id: string; tool: string; input: unknown; decided?: boolean; allow?: boolean; always?: boolean }
  | { k: "turn"; meta: string; copy: string; usage?: Usage; started?: number; ended?: number }
  | { k: "handoff"; text: string }
  | { k: "notice"; text: string }
  | { k: "error"; text: string };

const time = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function apply(items: Item[], ev: AgentEvent, started: number): Item[] {
  const last = items[items.length - 1];
  switch (ev.type) {
    case "text_delta":
      if (last?.k === "assistant" && last.streaming) return [...items.slice(0, -1), { ...last, text: last.text + ev.text }];
      return [...items, { k: "assistant", text: ev.text, streaming: true }];
    case "text":
      if (last?.k === "assistant" && last.streaming) return [...items.slice(0, -1), { k: "assistant", text: ev.text, streaming: false }];
      return [...items, { k: "assistant", text: ev.text, streaming: false }];
    case "reasoning":
      return ev.text.trim() ? [...items, { k: "reasoning", text: ev.text }] : items;
    case "tool_use":
      return items.some((i) => i.k === "tool" && i.id === ev.id) ? items : [...items, { k: "tool", id: ev.id, name: ev.name, input: ev.input }];
    case "tool_result":
      return items.map((i) => (i.k === "tool" && i.id === ev.id ? { ...i, output: ev.output, error: ev.is_error } : i));
    case "approval_request":
      return [...items, { k: "approval", id: ev.request_id, tool: ev.tool, input: ev.input }];
    case "turn_completed": {
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      const lastText = [...items].reverse().find((i) => i.k === "assistant") as { text: string } | undefined;
      const extra = [ev.output_tokens != null && `${ev.output_tokens} tokens`, ev.cost_usd ? `US$ ${ev.cost_usd.toFixed(4)}` : null].filter(Boolean).join(" · ");
      return [...items, { k: "turn", meta: `${secs}s · ${time()}${extra ? " · " + extra : ""}`, copy: lastText?.text ?? ev.result ?? "" }];
    }
    case "error":
      return [...items, { k: "error", text: ev.message }];
    case "exited":
      return ev.code ? [...items, { k: "error", text: `o agente encerrou (código ${ev.code})` }] : items;
    default:
      return items;
  }
}


interface Usage { input: number | null; output: number | null; cache_read: number | null; cache_write: number | null; duration_ms: number | null }

/** Texto de handoff (replay) para um agente novo continuar a conversa (espelha `transcript::handoff_prompt`). */
export function handoffText(items: Item[], changes: string[], branch: string, lastN = 12): string {
  const msgs = items.flatMap((i) => (i.k === "user" && !i.queued ? [`**Usuário:** ${i.text}`] : i.k === "assistant" ? [`**Agente:** ${i.text}`] : i.k === "tool" ? [`_(ferramenta ${i.name}${i.error ? ", falhou" : ""})_`] : []));
  const tail = msgs.slice(-lastN);
  return `Você está continuando uma conversa que começou com outro agente, no mesmo repositório e na mesma branch. Leia o contexto e continue de onde parou; não refaça o que já foi feito.\n\n## Últimas mensagens (${tail.length} de ${msgs.length})\n\n${tail.join("\n\n")}\n\n## Estado do código\n\nBranch \`${branch}\`. Arquivos alterados: ${changes.join(", ") || "nenhum"}. Arquivos de contexto em \`.context/\`.\n`;
}

interface Live { id: string; harness: HarnessKind; key: string; effort: string | null; fast: boolean; plan: boolean; approvals: boolean; mcpOff: string; account: string | null }
const PROVIDER_OF: Partial<Record<HarnessKind, string>> = { claude: "claude", codex: "codex", antigravity: "agy" };
interface Props { ws: Workspace; sessionId: string; active: boolean; onTitle: (t: string) => void; onUnread: () => void; onBusy: (b: boolean) => void; onWaiting: (w: boolean) => void; onError: (e: string) => void; onWorkspaceChange: () => void }

/** Anel de uso de contexto (tokens de entrada do último turno ÷ janela do modelo). */
function ContextRing({ used, total, onClick, on }: { used: number; total: number | null; onClick: () => void; on: boolean }) {
  const pct = total ? Math.min(1, used / total) : 0;
  const r = 7, c = 2 * Math.PI * r;
  return (
    <button className={"ctx-ring icon-btn" + (on ? " on" : "")} onClick={onClick} title={total ? `Contexto: ${used.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} tokens (${Math.round(pct * 100)}%)` : "Contexto: janela desconhecida"} data-testid="context-ring">
      <svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r={r} stroke="var(--track)" strokeWidth="2" fill="none" /><circle cx="9" cy="9" r={r} stroke={pct > 0.85 ? "var(--del)" : "var(--muted)"} strokeWidth="2" fill="none" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 9 9)" strokeLinecap="round" /></svg>
    </button>
  );
}

export function ChatTab({ ws, sessionId, active, onTitle, onUnread, onBusy, onWaiting, onError, onWorkspaceChange }: Props) {
  const [models, setModels] = useState<Model[]>([]);
  const { prefs, setPrefs, selected, effort } = useModelPrefs(models);
  const [live, setLive] = useState<Live | null>(null);
  const [agentSession, setAgentSession] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusyState] = useState(false);
  const [text, setText] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [plan, setPlan] = useState(false);
  const [ctxUsed, setCtxUsed] = useState(0);
  const [appsOpen, setAppsOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
  const appsRef = useRef<HTMLDivElement>(null), ctxRef = useRef<HTMLDivElement>(null);
  useDismiss(appsRef, appsOpen, useCallback(() => setAppsOpen(false), []));
  useDismiss(ctxRef, ctxOpen, useCallback(() => setCtxOpen(false), []));
  const [mcpLive, setMcpLive] = useState<McpLive | null>(null);
  const [sessionOff, setSessionOff] = useState<string[]>([]);
  const [ctxBase, setCtxBase] = useState(0);
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [suggest, setSuggest] = useState<{ kind: "@" | "/"; q: string; sel: number } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [commands, setCommands] = useState<[string, string][]>([]);
  const [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<{ id: string; nickname: string } | null>(null);
  const [accounts, setAccounts] = useState<import("../api").AccountRow[]>([]);
  const [accOpen, setAccOpen] = useState(false);
  const accRef = useRef<HTMLDivElement>(null);
  useDismiss(accRef, accOpen, useCallback(() => setAccOpen(false), []));
  const waiting = items.some((i) => i.k === "approval" && !i.decided);
  const replayRef = useRef(false);
  const forkRef = useRef(false);
  const harnessRef = useRef<HarnessKind | null>(null);
  const usageRef = useRef<Usage | null>(null);
  const [noCollapse, setNoCollapse] = useState(chatPrefs.noCollapse());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const liveRef = useRef<Live | null>(null);
  const started = useRef(Date.now());
  const itemsRef = useRef<Item[]>([]);
  liveRef.current = live;
  itemsRef.current = items;
  const activeRef = useRef(active);
  activeRef.current = active;

  const setBusy = useCallback((b: boolean) => (setBusyState(b), onBusy(b)), [onBusy]);

  useEffect(() => void api.models().then(setModels, (e) => onError(String(e))), [onError]);
  useEffect(() => {
    const pf = pendingFork[sessionId];
    if (pf) {
      delete pendingFork[sessionId];
      setItems([...(pf.items as Item[]), { k: "notice", text: "Fork desta conversa" }]);
      setAgentSession(pf.resume);
      forkRef.current = pf.forkSession;
      replayRef.current = pf.replay;
      if (pf.modelKey) setPrefs((p) => ({ ...p, selected: pf.modelKey }));
      setLoaded(true);
    } else api.historyLoad(ws.id, sessionId).then(
      (r) => {
        setItems((r?.items as Item[]) ?? []);
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
      const title = firstUser ? firstUser.text.slice(0, 40) : "Nova conversa";
      onTitle(title);
      api.historySave({ id: sessionId, workspace_id: ws.id, title, model_key: prefs.selected, agent_session: agent, updated_at: Math.floor(Date.now() / 1000), items: its.map((i) => (i.k === "assistant" ? { ...i, streaming: false } : i)) }).catch(() => {});
    },
    [sessionId, ws.id, prefs.selected, onTitle],
  );

  useEffect(
    () =>
      api.onChat(({ chat_id, event }) => {
        if (chat_id !== liveRef.current?.id) return;
        if (event.type === "log" || event.type === "raw") return;
        if (event.type === "session_started") setAgentSession(event.session_id);
        if (event.type === "usage") usageRef.current = event;
        if (event.type === "session_info") {
          const tools: Record<string, number> = {};
          for (const t of event.tools) if (t.startsWith("mcp__")) tools[t.split("__")[1]] = (tools[t.split("__")[1]] ?? 0) + 1;
          setMcpLive({ status: Object.fromEntries(event.mcp_servers.map((m) => [m.name, m.status])), tools, total: event.tools.length });
        }
        if (event.type === "turn_completed") {
          if (event.input_tokens) (setCtxUsed(event.input_tokens), setCtxBase((b) => b || event.input_tokens!));
          if (!activeRef.current || !document.hasFocus()) {
            onUnread();
            api.notify(`Kabul · ${ws.name}`, "O agente terminou o turno").catch(() => {});
          }
        }
        if (event.type === "approval_request" && (!activeRef.current || !document.hasFocus())) api.notify(`Kabul · ${ws.name}`, `Pedido de permissão: ${event.tool}`).catch(() => {});
        if (event.type === "turn_completed" || event.type === "exited" || event.type === "approval_request") setBusy(false);
        if (event.type === "exited") setLive(null);
        setItems((it) => {
          const next = apply(it, event, started.current);
          if (event.type === "turn_completed") {
            const last = next[next.length - 1];
            if (last?.k === "turn") next[next.length - 1] = { ...last, usage: usageRef.current ?? undefined, started: started.current, ended: Date.now() };
            usageRef.current = null;
          }
          return next;
        });
      }),
    [setBusy, onUnread, ws.name],
  );
  // Salva com o id do agente quando ele aparece.
  useEffect(() => {
    if (!loaded || !items.length) return;
    const t = setTimeout(() => persist(items, agentSession), 400);
    return () => clearTimeout(t);
  }, [agentSession, items, loaded]);
  // Tarefas em segundo plano do agente (Bash com run_in_background ainda não encerradas).
  const bgTasks = (() => {
    const started = items.filter((i) => i.k === "tool" && i.name === "Bash" && (i.input as { run_in_background?: boolean })?.run_in_background).length;
    const killed = items.filter((i) => i.k === "tool" && /^Kill(Shell|Bash)$/.test(i.name)).length;
    return Math.max(0, started - killed);
  })();
  useEffect(() => onWaiting(waiting), [waiting, onWaiting]);
  useEffect(() => void scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), [items]);

  // Texto vindo de fora (comentários de diff, etc.).
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { chat: string; text: string };
      if (d.chat === sessionId) (setText((t) => (t ? t + "\n\n" : "") + d.text), setTimeout(() => input.current?.focus(), 50));
    };
    const send = (e: Event) => {
      const d = (e as CustomEvent).detail as { chat: string; text: string };
      if (d.chat === sessionId) sendRef.current(d.text);
    };
    const forkLast = (e: Event) => {
      if ((e as CustomEvent).detail.chat !== sessionId) return;
      const lastTurn = [...itemsRef.current.keys()].filter((k) => itemsRef.current[k].k === "turn").pop();
      if (lastTurn !== undefined) forkTabRef.current(lastTurn);
    };
    window.addEventListener("kabul:fork-last", forkLast);
    window.addEventListener("kabul:compose-chat", h);
    window.addEventListener("kabul:send-chat", send);
    return () => (window.removeEventListener("kabul:compose-chat", h), window.removeEventListener("kabul:send-chat", send), window.removeEventListener("kabul:fork-last", forkLast));
  }, [sessionId]);

  const dictation = useDictation(useCallback((t: string) => setText((x) => (x && !x.endsWith(" ") ? x + " " : x) + t), []), onError);

  const ensure = async (): Promise<Live | null> => {
    if (!selected) return null;
    const cur = liveRef.current;
    const mcpOff = [...new Set([...sessionOff, ...repoDisabled(ws.repo_id)])].sort();
    const acc = account?.id ?? null;
    if (cur && cur.key === selected.key && cur.effort === effort && cur.fast === prefs.fast && cur.plan === plan && cur.mcpOff === mcpOff.join() && cur.account === acc) return cur;
    if (cur && cur.account !== acc && cur.harness === selected.harness) {
      // Outra conta do mesmo provedor: config isolada, então a conversa continua por handoff.
      await api.chatStop(cur.id).catch(() => {});
      liveRef.current = null;
      replayRef.current = true;
      setAgentSession(null);
      setItems((it) => [...it, { k: "handoff", text: `Trocou para a conta ${account?.nickname ?? "padrão"}` }]);
      try {
        const r = await api.chatStart(ws.id, selected, effort, prefs.fast, null, plan, mcpOff, false, acc);
        const l = { id: r.chat_id, harness: r.harness, key: selected.key, effort, fast: prefs.fast, plan, approvals: r.approvals, mcpOff: mcpOff.join(), account: acc };
        liveRef.current = l;
        setLive(l);
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
        setItems((it) => [...it, { k: "handoff", text: `Trocou para ${selected.label} · ${HARNESS_LABEL[selected.harness]}` }]);
      } else {
        setItems((it) => [...it, { k: "notice", text: `Continuando com ${selected.label}${effort ? " · " + effort : ""}${plan ? " · plan mode" : ""}` }]);
      }
    } else if (resume && items.length) {
      setItems((it) => [...it, { k: "notice", text: `Retomando a conversa com ${selected.label}` }]);
    }
    try {
      const r = await api.chatStart(ws.id, selected, effort, prefs.fast, resume, plan, mcpOff, forkRef.current, account?.id ?? null);
      forkRef.current = false;
      harnessRef.current = r.harness;
      if (r.note) setNote(r.note);
      const l = { id: r.chat_id, harness: r.harness, key: selected.key, effort, fast: prefs.fast, plan, approvals: r.approvals, mcpOff: mcpOff.join(), account: account?.id ?? null };
      liveRef.current = l;
      setLive(l);
      return l;
    } catch (e) {
      onError(String(e));
      return null;
    }
  };

  const dispatch = async (t: string) => {
    setBusy(true);
    started.current = Date.now();
    const ck = await api.createCheckpoint(ws.id, `antes: ${t.slice(0, 60)}`).catch(() => null);
    const firstMessage = !itemsRef.current.some((i) => i.k === "user" && !i.queued);
    setItems((it) => {
      const qi = it.findIndex((i) => i.k === "user" && i.queued && i.text === t);
      const u: Item = { k: "user", text: t, checkpoint: ck?.id };
      return qi >= 0 ? [...it.slice(0, qi), ...it.slice(qi + 1), u] : [...it, u];
    });
    if (firstMessage) api.autoBranch(ws.id, t).then((w) => w && onWorkspaceChange(), () => {});
    const l = await ensure();
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
  const steer = (t: string) => {
    if (!live) return dispatch(t);
    setItems((it) => [...it.filter((i) => !(i.k === "user" && i.queued && i.text === t)), { k: "user", text: t }, { k: "notice", text: "Redirecionando o agente" }]);
    setQueue((q) => q.filter((x) => x !== t));
    api.chatSend(live.id, t).catch((e) => onError(String(e)));
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

  const stop = async () => {
    if (live) await api.chatStop(live.id).catch(() => {});
    setLive(null);
    setBusy(false);
    setItems((it) => [...it, { k: "notice", text: "Interrompido" }]);
  };

  const decide = (rid: string, allow: boolean, always = false, updatedInput?: unknown) => {
    if (!live) return;
    const tool = (items.find((i) => i.k === "approval" && i.id === rid) as { tool?: string } | undefined)?.tool;
    setItems((it) => it.map((i) => (i.k === "approval" && i.id === rid ? { ...i, decided: true, allow, always } : i)));
    setBusy(true);
    api.chatApprove(live.id, rid, allow, { tool, always, updatedInput }).catch((e) => onError(String(e)));
  };

  // Fork e reset a partir de um turno.
  const turnBounds = (n: number) => {
    const userIdx = items.map((x, k) => (x.k === "user" && !x.queued ? k : -1)).filter((k) => k >= 0);
    const nextUser = userIdx.find((k) => k > n);
    const nextCk = nextUser !== undefined ? (items[nextUser] as { checkpoint?: string }).checkpoint ?? null : null;
    return { isLast: nextUser === undefined, nextCk };
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
    if (!(await confirmDialog("Reset chat? As mensagens depois deste turno serão apagadas.", { ok: "Resetar", danger: true, checkbox: { label: "Também restaurar os arquivos", key: "kabul.resetFiles" } }))) return;
    if (live) await api.chatStop(live.id).catch(() => {});
    setLive(null);
    setBusy(false);
    if (localStorage.getItem("kabul.resetFiles") === "1" && nextCk) await api.restoreCheckpoint(ws.id, nextCk).then(onWorkspaceChange, (e) => onError(String(e)));
    setItems((it) => [...it.slice(0, n + 1), { k: "notice", text: "Conversa resetada a partir daqui" }]);
    setAgentSession(null);
    replayRef.current = true;
  };

  const restore = async (ck: string) => {
    if (!(await confirmDialog("Restaurar os arquivos do workspace para antes desta mensagem? Mudanças posteriores serão descartadas.", { ok: "Restaurar", danger: true }))) return;
    try {
      await api.restoreCheckpoint(ws.id, ck);
      setItems((it) => [...it, { k: "notice", text: "Checkpoint restaurado" }]);
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
    else setSuggest(null);
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

  const harnessNow = live?.harness ?? selected?.harness;
  return (
    <div className="chat">
      <Minimap items={items} scroller={scroller} />
      <div className="messages" ref={scroller}>
        <div className="thread">
          {items.length === 0 && (
            <div className="chat-empty">
              <div className="ce-title">{ws.title || ws.name}</div>
              <div className="dim">Branch <code>{ws.branch}</code> · portas {ws.port}–{ws.port + 9}</div>
              <div className="ce-hints dim">Use <kbd>@</kbd> para mencionar arquivos, <kbd>/</kbd> para comandos, <kbd>⇧⇥</kbd> para plan mode e <kbd>⌘U</kbd> para anexar.</div>
            </div>
          )}
          {(() => {
            // Recolhe os passos intermediários de turnos concluídos (⌃O desliga).
            const hidden = new Set<number>();
            const toggles = new Map<number, { user: number; tools: number; msgs: number }>();
            if (!noCollapse) {
              let u = -1;
              items.forEach((it, k) => {
                if (it.k === "user" && !it.queued) u = k;
                if (it.k === "turn" && u >= 0) {
                  const finalA = [...items.keys()].filter((j) => j > u && j < k && items[j].k === "assistant").pop();
                  const mid = [...items.keys()].filter((j) => j > u && j < (finalA ?? k) && ["tool", "reasoning", "assistant"].includes(items[j].k));
                  if (mid.length >= 2 && !expanded.has(u)) {
                    mid.forEach((j) => hidden.add(j));
                    toggles.set(mid[0], { user: u, tools: mid.filter((j) => items[j].k === "tool").length, msgs: mid.filter((j) => items[j].k !== "tool").length });
                  }
                }
              });
            }
            const openFile = (p: string) => window.dispatchEvent(new CustomEvent("kabul:open-file", { detail: { ws: ws.id, path: p.startsWith(ws.path) ? p.slice(ws.path.length + 1) : p } }));
            return items.map((i, n) => {
              const tg = toggles.get(n);
              const toggle = tg ? <button key={`t${n}`} className="steps-toggle" onClick={() => setExpanded((e) => new Set(e).add(tg.user))} data-testid="expand-steps">▸ Expandir {tg.tools} chamada{tg.tools === 1 ? "" : "s"} de ferramenta{tg.msgs ? `, ${tg.msgs} mensage${tg.msgs === 1 ? "m" : "ns"}` : ""}</button> : null;
              if (hidden.has(n)) return toggle;
              switch (i.k) {
                case "user": return (
                  <div key={n} data-msg={n} className={"msg-user" + (i.queued ? " queued" : "")} data-testid={i.queued ? "queued-msg" : undefined}>
                    {i.text}
                    {i.queued && <span className="badge">na fila</span>}
                    {i.queued && (
                      <span className="q-actions">
                        <button className="text-btn small" onClick={() => editQueued(i.text)} data-testid="queue-edit">Editar <kbd>e</kbd></button>
                        <button className="text-btn small" onClick={() => deleteQueued(i.text)} data-testid="queue-delete">Apagar <kbd>⌫</kbd></button>
                        <button className="text-btn small" onClick={() => steer(i.text)} data-testid="queue-steer">Enviar agora <kbd>↵</kbd></button>
                      </span>
                    )}
                    {i.checkpoint && !busy && <button className="icon-btn restore" title="Restaurar checkpoint (arquivos como antes desta mensagem)" onClick={() => restore(i.checkpoint!)}><IRestore size={13} /></button>}
                  </div>
                );
                case "assistant": return <div key={n} data-msg={n} className="msg-assistant"><Markdown text={i.text} onFile={openFile} />{i.streaming && <span className="caret" />}</div>;
                case "reasoning": return <ThinkingCard key={n} text={i.text} />;
                case "tool": return <ToolCard key={n} name={i.name} input={i.input} output={i.output} error={i.error} onOpenFile={openFile} />;
                case "approval":
                  if (i.tool === "ExitPlanMode") return <PlanCard key={n} plan={String((i.input as { plan?: string })?.plan ?? "")} decided={i.decided} allow={i.allow}
                    onApprove={() => (decide(i.id, true), setPlan(false))}
                    onAdjust={(t) => (decide(i.id, false), setTimeout(() => sendRef.current(t), 300))}
                    onHandOff={() => (decide(i.id, false), window.dispatchEvent(new CustomEvent("kabul:new-chat-with", { detail: { ws: ws.id, text: `Implemente este plano:\n\n${(i.input as { plan?: string })?.plan ?? ""}` } })))} />;
                  if (i.tool === "AskUserQuestion") return <QuestionCard key={n} input={i.input} decided={i.decided}
                    onSubmit={(answers) => decide(i.id, true, false, { ...(i.input as object), answers })} onSkip={() => decide(i.id, false)} />;
                  return <ApprovalCard key={n} tool={i.tool} input={i.input} decided={i.decided} allow={i.allow} always={i.always} onDecide={(a, al) => decide(i.id, a, al)} />;
                case "turn": return <TurnMeta key={n} item={i} checkpoint={([...items.slice(0, n)].reverse().find((x) => x.k === "user") as { checkpoint?: string } | undefined)?.checkpoint}
                  isLast={turnBounds(n).isLast} onRestore={restore} onQuote={(t) => setText((x) => `${x}${x ? "\n" : ""}> ${t.split("\n").join("\n> ")}\n\n`)}
                  onForkTab={() => forkTab(n)} onForkWorkspace={() => forkWorkspace(n)} onReset={() => resetChat(n)} />;
                case "handoff": return <div key={n} className="handoff-divider" data-testid="handoff"><span>{i.text}</span></div>;
                case "notice": return <div key={n} className="notice">{i.text}</div>;
                case "error": return <div key={n} className="msg-error">{i.text}</div>;
              }
            });
          })()}
          {!busy && bgTasks > 0 && <div className="working" data-testid="bg-tasks"><span className="spinner" /> Aguardando {bgTasks} tarefa{bgTasks === 1 ? "" : "s"} em segundo plano</div>}
          {busy && <div className="working"><span className="spinner" /> Trabalhando… <span className="dim">⌘⇧⌫ ou Esc interrompe</span></div>}
        </div>
      </div>

      <div className="composer-wrap">
        {(queue.length > 0 || note || (live && !live.approvals)) && (
          <div className="composer-notes">
            {queue.length > 0 && <span><IQueueIcon /> {queue.length} na fila <button className="text-btn" onClick={() => setQueuePaused((p) => !p)}>{queuePaused ? "retomar" : "pausar"}</button> <button className="text-btn" onClick={() => { setQueue([]); setItems((it) => it.filter((i) => !(i.k === "user" && i.queued))); }}>limpar</button></span>}
            {note && <span title="Registro de harness por família">{note}</span>}
            {live && !live.approvals && <span>{HARNESS_LABEL[live.harness]} aplica as permissões dele; aprovações pelo app não estão disponíveis neste harness.</span>}
          </div>
        )}
        <div className={"composer" + (plan ? " plan" : "")}>
          {suggest && options.length > 0 && (
            <div className="popover suggest" data-testid="suggest">
              {options.map(([o, d], k) => (
                <div key={o} className={"pop-row" + (k === suggest.sel ? " on" : "")} onMouseDown={(e) => (e.preventDefault(), pickOption(o))}>
                  <span className="label">{o}</span><span className="grow" /><span className="dim">{d}</span>
                </div>
              ))}
            </div>
          )}
          {!text && <span className="focus-hint">⌘L para focar</span>}
          {plan && <div className="plan-chip"><IPlan size={13} /> Plan mode <span className="dim">· o agente planeja sem editar (⇧⇥)</span></div>}
          <textarea ref={input} rows={3} autoCorrect="off" {...noSuggest} placeholder="Peça mudanças, @mencione arquivos, rode /comandos" value={text} data-testid="composer"
            onChange={(e) => onChangeText(e.target.value, e.target.selectionStart)} onPaste={onPaste}
            onKeyDown={(e) => {
              if (suggest && options.length) {
                if (e.key === "ArrowDown") return (e.preventDefault(), setSuggest({ ...suggest, sel: (suggest.sel + 1) % options.length }));
                if (e.key === "ArrowUp") return (e.preventDefault(), setSuggest({ ...suggest, sel: (suggest.sel - 1 + options.length) % options.length }));
                if (e.key === "Enter" || e.key === "Tab") return (e.preventDefault(), pickOption(options[suggest.sel][0]));
                if (e.key === "Escape") return (e.preventDefault(), setSuggest(null));
              }
              const pending = items.find((i) => i.k === "approval" && !i.decided) as { id: string; tool: string } | undefined;
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
                <button className="account-chip" title="Conta usada nesta conversa" onClick={() => (setAccOpen(!accOpen), api.accountsList(PROVIDER_OF[selected.harness]!).then(setAccounts, () => {}))} data-testid="account-chip">
                  {account?.nickname ?? "Conta padrão"} <span className="dim">˅</span>
                </button>
                {accOpen && (
                  <div className="popover status-pop account-pop" data-testid="account-menu">
                    <div className="pop-title">Conta desta conversa</div>
                    {accounts.map((a) => (
                      <div key={a.id} className={"pop-row" + ((account?.id ?? accounts.find((x) => x.default)?.id) === a.id ? " on" : "")} onClick={() => (setAccount({ id: a.id, nickname: a.nickname }), setAccOpen(false))} data-testid="account-option">
                        {a.nickname}{a.default && <span className="dim small"> · padrão</span>}<span className="grow" /><span className={"badge " + (a.logged_in ? "ok" : "")}>{a.logged_in ? "logado" : "sem login"}</span>
                      </div>
                    ))}
                    <div className="pop-sep" />
                    <div className="pop-row" onClick={() => (setAccOpen(false), window.dispatchEvent(new CustomEvent("kabul:route", { detail: { kind: "settings", tab: "contas" } })))}>Gerenciar contas…</div>
                  </div>
                )}
              </div>
            )}
            {plan && <span className="dim small">plan</span>}
            <div className="grow" />
            <div className="picker" ref={appsRef}>
              <button className={"icon-btn" + (appsOpen ? " on" : "")} title="MCP e integrações da sessão" onClick={() => (setAppsOpen(!appsOpen), setCtxOpen(false))} data-testid="apps"><IApps /></button>
              {appsOpen && harnessNow && <McpPanel workspaceId={ws.id} repoId={ws.repo_id} harness={harnessNow} live={mcpLive} sessionOff={sessionOff} setSessionOff={setSessionOff} onError={onError} />}
            </div>
            <div className="picker" ref={ctxRef}>
              <ContextRing used={ctxUsed} total={selected?.context ?? null} on={ctxOpen} onClick={() => (setCtxOpen(!ctxOpen), setAppsOpen(false))} />
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
            <button className="icon-btn" title="Anexar arquivo (⌘U)" onClick={attach} data-testid="attach"><IPlus /></button>
            <button className={"icon-btn mic " + dictation.state} title="Ditado em português (⌃⇧D)" onClick={dictation.toggle} data-testid="mic">
              {dictation.state === "transcribing" ? <span className="spinner" /> : <IMic />}
            </button>
            {busy && !text.trim() ? (
              <button className="send stop" title="Parar (⌘⇧⌫)" onClick={stop} data-testid="stop"><IStop size={14} /></button>
            ) : (
              <button className="send" title={busy ? (chatPrefs.followUp() === "steer" ? "Redirecionar agora" : "Enfileirar") : "Enviar"} disabled={!text.trim()} onClick={send} data-testid="send"><IArrowUp size={15} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IQueueIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M3 4.5h10M3 8h10M3 11.5h6" /></svg>;
}

/** Minimapa à direita do chat: um traço por mensagem (claro = sua, escuro = do agente); clique pula até ela. */
function Minimap({ items, scroller }: { items: Item[]; scroller: React.RefObject<HTMLDivElement | null> }) {
  const marks = items.map((it, n) => ({ it, n })).filter(({ it }) => it.k === "user" || it.k === "assistant");
  if (marks.length < 2) return null;
  const jump = (n: number) => scroller.current?.querySelector(`[data-msg="${n}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  return (
    <div className="minimap" data-testid="minimap">
      {marks.slice(-40).map(({ it, n }) => (
        <button key={n} className={"mm " + it.k} title={(it as { text: string }).text.slice(0, 80)} onClick={() => jump(n)} />
      ))}
    </div>
  );
}

/** Rodapé do turno: tempo (popover com início→fim e tokens), copiar e "···" (fork, reset, citar, restaurar). */
function TurnMeta({ item, checkpoint, isLast, onRestore, onQuote, onForkTab, onForkWorkspace, onReset }: {
  item: Extract<Item, { k: "turn" }>; checkpoint?: string; isLast: boolean; onRestore: (c: string) => void; onQuote: (t: string) => void;
  onForkTab: () => void; onForkWorkspace: () => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));
  const t = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
  const f = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR"));
  const u = item.usage;
  return (
    <div className="turn-meta">
      <span className="picker turn-time" onMouseEnter={() => setTimeOpen(true)} onMouseLeave={() => setTimeOpen(false)} data-testid="turn-time">
        {item.meta}
        {timeOpen && (
          <div className="popover status-pop time-pop" data-testid="time-pop">
            <div className="row"><span className="dim">Início → fim</span><span className="grow" />{t(item.started)} → {t(item.ended)}</div>
            <div className="row"><span className="dim">Entrada</span><span className="grow" />{f(u?.input)}</div>
            <div className="row"><span className="dim">Saída</span><span className="grow" />{f(u?.output)}</div>
            <div className="row"><span className="dim">Cache lido</span><span className="grow" />{f(u?.cache_read)}</div>
            <div className="row"><span className="dim">Cache gravado</span><span className="grow" />{f(u?.cache_write)}</div>
          </div>
        )}
      </span>
      <button className="icon-btn" title="Copiar resposta final" onClick={() => navigator.clipboard.writeText(item.copy)}><ICopy size={13} /></button>
      <span className="picker" ref={ref}>
        <button className={"icon-btn" + (open ? " on" : "")} title="Ações da mensagem" onClick={() => setOpen(!open)} data-testid="turn-more"><IMoreDots /></button>
        {open && (
          <div className="popover status-pop turn-pop">
            <div className="pop-row" onClick={() => (setOpen(false), onForkTab())} data-testid="fork-tab">Fork para nova aba <span className="grow" /><span className="kbd-hint">⌘⌥↵</span></div>
            <div className="pop-row" onClick={() => (setOpen(false), onForkWorkspace())} data-testid="fork-ws">Fork para novo workspace</div>
            {!isLast && <div className="pop-row" onClick={() => (setOpen(false), onReset())} data-testid="reset-chat">Reset chat a partir daqui…</div>}
            <div className="pop-sep" />
            <div className="pop-row" onClick={() => (navigator.clipboard.writeText(item.copy), setOpen(false))}>Copiar como Markdown</div>
            <div className="pop-row" onClick={() => (onQuote(item.copy), setOpen(false))}>Citar na próxima mensagem</div>
            {checkpoint && <div className="pop-row" onClick={() => (onRestore(checkpoint), setOpen(false))}>Restaurar arquivos de antes deste turno</div>}
          </div>
        )}
      </span>
    </div>
  );
}

function IMoreDots() {
  return <svg width="13" height="13" viewBox="0 0 16 16"><g fill="currentColor"><circle cx="3.5" cy="8" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="12.5" cy="8" r="1.1" /></g></svg>;
}
