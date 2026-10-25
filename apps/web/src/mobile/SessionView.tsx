import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { transport } from "../transport";
import { Markdown } from "../components/Markdown";
import { useDictation } from "../components/useDictation";
import { AGENT_LABEL, canWrite, k, kcall, me, type AuthorView, type ChatView as Chat, type Entry, type LiveSession, type Present, type Queued, type TermInfo } from "./kabuld";
import { AgentIcon, Avatar, BackButton, I, NavBar, PlanChip, StatusPill, haptic } from "./ui";
import { PLAN_PREFIX, getPlan, setPlan, type PlanMode } from "./plan";
import { ModelSheet } from "./ModelSheet";
import { ChangedChips, chatFileOpener, FilesButton, useFileTaps } from "./preview";

/** Sessão aberta: chat estruturado (sessão do Kabul) ou terminal ao vivo (qualquer tmux). */
export function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const [s, setS] = useState<LiveSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => k.live().then((r) => setS(r.sessions.find((x) => x.id === id) ?? null), (e) => setErr(String(e))), [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    const off = transport.subscribe("session-status", (p: { id: string }) => p.id === id && load());
    return () => (clearInterval(t), off());
  }, [load, id]);
  const isChat = id.startsWith("chat:");
  const name = id.slice(id.indexOf(":") + 1);
  const wsId = s?.group.workspace_id ?? null;
  // Presença: avisa o que este aparelho está vendo.
  useEffect(() => {
    if (!wsId) return;
    k.presence(wsId, id).catch(() => {});
    return () => void k.presence(null, null).catch(() => {});
  }, [wsId, id]);
  const [sheet, setSheet] = useState(false);
  const sub = s ? `${s.group.repo}${s.group.workspace ? ` › ${s.group.workspace}` : ""}` : "";
  return (
    <div className="m-page" data-testid="m-session-view">
      <NavBar
        left={<BackButton onClick={onBack} />}
        title={<span data-testid="m-title">{s?.name ?? name}</span>}
        sub={
          s ? (
            <span className="m-nav-status">
              <StatusPill status={s.status} detail={s.detail} compact />
              <span className="m-ellipsis">{sub}</span>
            </span>
          ) : undefined
        }
        right={
          wsId ? (
            <>
              <PresenceBar ws={wsId} target={id} />
              <FilesButton ws={wsId} from={id} />
            </>
          ) : s ? (
            <AgentIcon agent={s.agent} size={26} status={s.status} />
          ) : null
        }
      />
      {err && <div className="m-error">{err}</div>}
      {isChat ? <ChatPane chatId={name} ws={wsId} sheet={sheet} setSheet={setSheet} /> : <TermPane session={name} agent={s?.agent ?? "shell"} />}
    </div>
  );
}

/** Avatares de quem está no workspace e "fulano digitando". */
export function PresenceBar({ ws, target }: { ws: string; target: string }) {
  const [users, setUsers] = useState<Present[]>([]);
  useEffect(() => {
    kcallPresence(ws).then(setUsers, () => {});
    return transport.subscribe("presence", (p: { workspace_id: string; users: Present[] }) => p.workspace_id === ws && setUsers(p.users));
  }, [ws]);
  const mine = me()?.id;
  const seen = new Map<string, Present>();
  users.forEach((u) => seen.set(u.id, seen.get(u.id)?.target === target ? seen.get(u.id)! : u));
  const typing = users.filter((u) => u.typing && u.id !== mine && u.target === target);
  return (
    <div className="m-presence" data-testid="m-presence">
      {[...seen.values()].map((u) => (
        <span key={u.id} className={"m-presence-av" + (u.target === target ? " here" : "")} data-testid="m-presence-user" data-name={u.name}>
          <Avatar name={u.name} color={u.color} size={22} title={`${u.name} · ${u.device}${u.target === target ? " (aqui)" : ""}`} />
        </span>
      ))}
      {typing.length > 0 && <span className="m-typing" data-testid="m-typing">{typing.map((u) => u.name).join(", ")} digitando…</span>}
    </div>
  );
}

const kcallPresence = (ws: string) => kcall<Present[]>("presence_list", { workspaceId: ws });

// ---------------- terminal ----------------

/** Cores do terminal pelo tema (fundo um pouco mais fundo que a tela). */
const termTheme = () => {
  const v = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
  return { background: v("--m-term-bg", "#0e0c0b"), foreground: v("--m-term-fg", "#e9e8e6"), cursor: v("--m-term-fg", "#e9e8e6"), selectionBackground: "rgba(120,140,255,.3)" };
};

const APPROVE: Record<string, string[]> = { claude: ["Enter"], codex: ["y"], shell: ["y", "Enter"] };
const DENY: Record<string, string[]> = { claude: ["Escape"], codex: ["n"], shell: ["n", "Enter"] };

function TermPane({ session, agent }: { session: string; agent: string }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const [info, setInfo] = useState<TermInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const write = canWrite();
  useEffect(() => {
    let alive = true;
    k.termAttach(session).then((t) => alive && setInfo(t), (e) => setErr(String(e)));
    return () => void (alive = false);
  }, [session]);
  useEffect(() => {
    if (!info || !host.current) return;
    const el = host.current;
    // Mantém o tamanho do pane (não encolhe a janela do Mac); a fonte se ajusta à largura do celular.
    const fit = () => Math.max(5, Math.min(13, Math.floor(((el.clientWidth - 8) / info.cols / 0.6) * 10) / 10));
    const t = new Terminal({ cols: info.cols, rows: info.rows, fontSize: fit(), fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', scrollback: 3000, disableStdin: !write, cursorBlink: write, theme: termTheme() });
    t.open(el);
    t.write(info.snapshot);
    term.current = t;
    const off = transport.subscribe("term-output", (p: { session: string; data: number[] }) => p.session === info.session && t.write(new Uint8Array(p.data)));
    const offClosed = transport.subscribe("term-closed", (p: { session: string }) => p.session === info.session && setErr("A sessão terminou."));
    const sub = t.onData((d) => write && k.termInput(info.session, info.pane, d).catch((e) => setErr(String(e))));
    const ro = new ResizeObserver(() => (t.options.fontSize = fit()));
    ro.observe(el);
    return () => {
      off();
      offClosed();
      sub.dispose();
      ro.disconnect();
      t.dispose();
      term.current = null;
    };
  }, [info, write]);
  const keys = (ks: string[]) => info && k.termKeys(info.session, info.pane, ks).catch((e) => setErr(String(e)));
  const send = () => {
    if (!info || !text) return;
    k.termInput(info.session, info.pane, text + "\r").then(() => setText(""), (e) => setErr(String(e)));
  };
  const dict = useDictation(useCallback((t: string) => setText((x) => (x ? x + " " : "") + t), []), useCallback((e: string) => setErr(e), []));
  const fitWindow = () => {
    if (!info || !host.current) return;
    const cols = Math.max(30, Math.floor((host.current.clientWidth - 8) / (9 * 0.6)));
    const rows = Math.max(10, Math.floor(host.current.clientHeight / (9 * 1.2)));
    k.termFit(info.session, cols, rows).then(() => k.termAttach(session).then(setInfo), (e) => setErr(String(e)));
  };
  const key = (label: React.ReactNode, ks: string[], extra: Partial<{ cls: string; testid: string; aria: string; title: string }> = {}) => (
    <button className={extra.cls} onClick={(e) => (haptic(e.currentTarget), keys(ks))} data-testid={extra.testid} aria-label={extra.aria} title={extra.title}>{label}</button>
  );
  return (
    <>
      <div className="m-term-wrap">
        <div className="m-term" ref={host} data-testid="m-terminal" />
        {err && <div className="m-error m-float">{err}</div>}
      </div>
      {write ? (
        <div className="m-dock">
          <div className="m-keys" data-testid="m-keybar">
            {key("esc", ["Escape"])}
            {key("⌃C", ["C-c"], { testid: "m-key-ctrlc" })}
            {key("tab", ["Tab"])}
            {key("↑", ["Up"], { aria: "Seta para cima" })}
            {key("↓", ["Down"], { aria: "Seta para baixo" })}
            {key("←", ["Left"], { aria: "Seta para a esquerda" })}
            {key("→", ["Right"], { aria: "Seta para a direita" })}
            {key("⏎", ["Enter"])}
            <span className="m-keys-sep" />
            {key("Aprovar", APPROVE[agent] ?? ["y", "Enter"], { cls: "ok", testid: "m-key-approve" })}
            {key("Negar", DENY[agent] ?? ["n", "Enter"], { cls: "no", testid: "m-key-deny" })}
            <button onClick={(e) => (haptic(e.currentTarget), fitWindow())} title="Redimensiona a janela do tmux para a tela do celular (muda para todos)">Ajustar</button>
          </div>
          <div className="m-composer inline">
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Digitar para ${AGENT_LABEL[agent] ?? agent}`} data-testid="m-term-input" enterKeyHint="send" autoCapitalize="off" autoCorrect="off" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} />
            <button className={"m-composer-round mic " + dict.state} onClick={dict.toggle} aria-label="Ditado" data-testid="m-mic">{dict.state === "listening" ? <I.stop /> : <I.mic />}</button>
            <button className="m-composer-round m-send" onClick={(e) => (haptic(e.currentTarget), send())} disabled={!text} aria-label="Enviar" data-testid="m-term-send"><I.up /></button>
          </div>
        </div>
      ) : (
        <div className="m-readonly" data-testid="m-readonly">Você está acompanhando como observador.</div>
      )}
    </>
  );
}

// ---------------- chat ----------------

type Item =
  | { t: "user"; key: string; text: string; author: { name: string; device: string; color?: string } }
  | { t: "agent"; key: string; text: string }
  | { t: "tool"; key: string; id: string; name: string; input: unknown; output: string | null; error: boolean }
  | { t: "approval"; key: string; id: string; tool: string; input: unknown; decision: string | null }
  | { t: "note"; key: string; text: string; kind: "handoff" | "error" | "info" };

function fromEntries(entries: Entry[]): Item[] {
  const out: Item[] = [];
  for (const e of entries) {
    const kk = e.kind as Record<string, any>;
    const key = `e${e.seq}`;
    switch (kk.type) {
      case "user_message":
        out.push({ t: "user", key, text: kk.text, author: e.author.kind === "user" ? { name: e.author.name, device: e.author.device } : { name: "?", device: "" } });
        break;
      case "assistant_text":
        out.push({ t: "agent", key, text: kk.text });
        break;
      case "tool_call":
        out.push({ t: "tool", key, id: kk.call_id, name: kk.name, input: kk.input, output: kk.output ?? null, error: !!kk.is_error });
        break;
      case "approval":
        out.push({ t: "approval", key, id: kk.request_id, tool: kk.tool, input: kk.input, decision: kk.decision ?? null });
        break;
      case "handoff":
        out.push({ t: "note", key, text: `Trocou para ${kk.to}`, kind: "handoff" });
        break;
      case "notice":
        out.push({ t: "note", key, text: kk.text, kind: "info" });
        break;
      case "error":
        out.push({ t: "note", key, text: kk.text, kind: "error" });
        break;
    }
  }
  return out;
}

const summary = (input: unknown): string => {
  const i = (input ?? {}) as Record<string, unknown>;
  return String(i.command ?? i.file_path ?? i.path ?? i.url ?? i.pattern ?? JSON.stringify(input ?? "")).slice(0, 160);
};

function ChatPane({ chatId, ws, sheet, setSheet }: { chatId: string; ws: string | null; sheet: boolean; setSheet: (b: boolean) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const write = canWrite();
  useFileTaps(scroller, ws, `chat:${chatId}`);
  useEffect(() => {
    let n = 0;
    k.chatTranscript(chatId).then((r) => (setItems(fromEntries(r.transcript.entries)), setChat(r.chat), setQueue(r.chat.queue)), (e) => setErr(String(e)));
    const offEv = transport.subscribe("chat-event", (p: { chat_id: string; event: Record<string, any> }) => {
      if (p.chat_id !== chatId) return;
      const ev = p.event;
      const key = `l${++n}`;
      setItems((xs) => {
        switch (ev.type) {
          case "user_message": {
            const a = ev.author as AuthorView;
            setColors((c) => ({ ...c, [a.name]: a.color }));
            return [...xs, { t: "user", key, text: ev.text, author: { name: a.name, device: a.device, color: a.color } }];
          }
          case "text":
            return [...xs, { t: "agent", key, text: ev.text }];
          case "text_delta": {
            const last = xs[xs.length - 1];
            return last?.t === "agent" ? [...xs.slice(0, -1), { ...last, text: last.text + ev.text }] : [...xs, { t: "agent", key, text: ev.text }];
          }
          case "tool_use":
            return [...xs, { t: "tool", key, id: ev.id, name: ev.name, input: ev.input, output: null, error: false }];
          case "tool_result":
            return xs.map((x) => (x.t === "tool" && x.id === ev.id ? { ...x, output: ev.output, error: ev.is_error } : x));
          case "approval_request":
            return [...xs, { t: "approval", key, id: ev.request_id, tool: ev.tool, input: ev.input, decision: null }];
          case "approval_decided":
            return xs.map((x) => (x.t === "approval" && x.id === ev.request_id ? { ...x, decision: `${ev.allow ? "aprovado" : "negado"} por ${ev.by.name}` } : x));
          case "handoff":
            return [...xs, { t: "note", key, text: `Trocou para ${ev.to}`, kind: "handoff" }];
          case "error":
            return [...xs, { t: "note", key, text: ev.message, kind: "error" }];
          case "exited":
            return [...xs, { t: "note", key, text: "O agente encerrou.", kind: "info" }];
          default:
            return xs;
        }
      });
    });
    const offState = transport.subscribe("chat-state", (c: Chat) => c.id === chatId && (setChat(c), setQueue(c.queue)));
    const offQ = transport.subscribe("chat-queue", (p: { chat_id: string; queue: Queued[] }) => p.chat_id === chatId && setQueue(p.queue));
    return () => (offEv(), offState(), offQ());
  }, [chatId]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, items[items.length - 1]]);
  const typing = (v: string) => {
    setText(v);
    const now = Date.now();
    if (ws && v && now - lastTyping.current > 2000) {
      lastTyping.current = now;
      k.presence(ws, `chat:${chatId}`, true).catch(() => {});
    }
  };
  const send = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t) return;
    if (raw === undefined) setText("");
    k.chatSend(chatId, getPlan(chatId) === "emulated" ? PLAN_PREFIX + t : t).then(
      () => void (ws && k.presence(ws, `chat:${chatId}`, false).catch(() => {})),
      (e) => setErr(String(e)),
    );
  };
  const decide = (rid: string, allow: boolean) => k.chatApprove(chatId, rid, allow).catch((e) => setErr(String(e)));
  const dict = useDictation(useCallback((t: string) => setText((x) => (x ? x + " " : "") + t), []), useCallback((e: string) => setErr(e), []));
  const myName = me()?.user;
  const [planMode, setPlanMode] = useState<PlanMode>(() => getPlan(chatId));
  const setMode = (m: PlanMode) => (setPlan(chatId, m), setPlanMode(m));
  const [adjusting, setAdjusting] = useState<string | null>(null);
  // Plano aprovado (aqui ou por outro aparelho): o agente sai do plan mode.
  const planApproved = items.some((x) => x.t === "approval" && x.tool === "ExitPlanMode" && x.decision?.startsWith("aprovado"));
  useEffect(() => void (planApproved && planMode === "native" && setMode(null)), [planApproved]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = items.filter((x): x is Extract<Item, { t: "approval" }> => x.t === "approval" && !x.decision);
  const [okFlash, setOkFlash] = useState(false);
  const decideAndFlash = (rid: string, allow: boolean, el: HTMLElement) => {
    haptic(el, allow ? "success" : "warn");
    if (allow) (setOkFlash(true), setTimeout(() => setOkFlash(false), 700));
    void decide(rid, allow);
  };
  const harness = AGENT_LABEL[chat?.harness ?? ""] ?? chat?.harness ?? "O agente";
  return (
    <>
      <div className="m-chat" ref={scroller} data-testid="m-chat">
        {chat && (
          <button className="m-chat-model" onClick={(e) => write && (haptic(e.currentTarget), setSheet(true))} disabled={!write} data-testid="m-chat-model">
            <AgentIcon agent={chat.harness} size={18} /> {chat.model}{write && <I.updown size={11} />}
          </button>
        )}
        {items.map((it) => {
          switch (it.t) {
            case "user":
              return (
                <div key={it.key} className={"m-msg user" + (it.author.name === myName ? " mine" : "")} data-testid="m-msg-user" data-author={it.author.name}>
                  {it.author.name !== myName && <div className="m-msg-author"><Avatar name={it.author.name} color={it.author.color ?? colors[it.author.name] ?? "#7c8cff"} size={16} /> <b>{it.author.name}</b> <span className="dim">· {it.author.device}</span></div>}
                  <div className="m-msg-body">{it.text.startsWith(PLAN_PREFIX) ? <><span className="m-msg-plan">plano</span>{it.text.slice(PLAN_PREFIX.length)}</> : it.text}</div>
                </div>
              );
            case "agent":
              return <div key={it.key} className="m-msg m-msg-ai" data-testid="m-msg-agent"><Markdown text={it.text} onFile={chatFileOpener(ws, `chat:${chatId}`)} /></div>;
            case "tool":
              return (
                <details key={it.key} className={"m-tool" + (it.error ? " err" : "") + (it.output === null ? " running" : "")} data-testid="m-tool">
                  <summary><span className="m-tool-dot" /><b>{it.name}</b> <span className="m-tool-arg">{summary(it.input)}</span></summary>
                  {it.output && <pre>{it.output.slice(0, 4000)}</pre>}
                </details>
              );
            case "approval":
              if (it.tool === "ExitPlanMode")
                return (
                  <div key={it.key} className={"m-plan-card" + (it.decision ? " done" : "")} data-testid="m-plan-card">
                    <div className="m-plan-head"><I.plan size={16} /> <b>Plano</b><span className="grow" />{!it.decision && <span className="m-approval-wait">Esperando você</span>}</div>
                    <div className="m-plan-body"><Markdown text={String((it.input as { plan?: string })?.plan ?? "")} /></div>
                    {it.decision && <div className="m-decision" data-testid="m-decision">{it.decision[0].toUpperCase() + it.decision.slice(1)}</div>}
                  </div>
                );
              return (
                <div key={it.key} className={"m-approval" + (it.decision ? " done" : "")} data-testid="m-approval">
                  <div className="m-approval-title"><b>{it.tool}</b> {it.decision ? "pediu aprovação" : "pede aprovação"}</div>
                  <code>{summary(it.input)}</code>
                  {it.decision ? <div className="m-decision" data-testid="m-decision">{it.decision[0].toUpperCase() + it.decision.slice(1)}</div> : <div className="m-approval-wait">Esperando decisão…</div>}
                </div>
              );
            case "note":
              return <div key={it.key} className={`m-note ${it.kind}`} data-testid="m-note">{it.text}</div>;
          }
        })}
        {chat?.status === "working" && <div className="m-working" data-testid="m-working"><span className="m-dots"><i /><i /><i /></span> Trabalhando…</div>}
      </div>
      {err && <div className="m-error" onClick={() => setErr(null)}>{err}</div>}
      {okFlash && <div className="m-flash-ok" aria-hidden="true"><I.check size={34} /></div>}
      {pending.length > 0 && pending[0].tool === "ExitPlanMode" && (
        <div className="m-approve-sheet plan" data-testid="m-approve-sheet" role="dialog" aria-label="Plano">
          <span className="m-sheet-grab-bar" />
          <div className="m-approve-head">
            <span className="m-approve-badge plan"><I.plan size={15} /></span>
            <span className="grow"><b>Plano pronto</b> · revise acima</span>
          </div>
          {write && adjusting !== null && (
            <textarea className="m-plan-adjust" rows={2} value={adjusting} onChange={(e) => setAdjusting(e.target.value)} placeholder="O que mudar no plano?" data-testid="m-plan-adjust-text" autoFocus />
          )}
          {write ? (
            adjusting === null ? (
              <div className="m-approve-actions">
                <button className="m-cta secondary" onClick={(e) => (haptic(e.currentTarget), setAdjusting(""))} data-testid="m-plan-adjust">Ajustar</button>
                <button className="m-cta" onClick={(e) => (decideAndFlash(pending[0].id, true, e.currentTarget), setMode(null))} data-testid="m-plan-approve">Aprovar e executar</button>
              </div>
            ) : (
              <div className="m-approve-actions">
                <button className="m-cta secondary" onClick={() => setAdjusting(null)}>Cancelar</button>
                <button
                  className="m-cta"
                  disabled={!adjusting.trim()}
                  onClick={(e) => {
                    const t = adjusting.trim();
                    decideAndFlash(pending[0].id, false, e.currentTarget);
                    setAdjusting(null);
                    setTimeout(() => send(t), 300);
                  }}
                  data-testid="m-plan-adjust-send"
                >
                  Enviar ajustes
                </button>
              </div>
            )
          ) : (
            <div className="m-approve-wait">Aguardando um editor decidir.</div>
          )}
        </div>
      )}
      {pending.length > 0 && pending[0].tool !== "ExitPlanMode" && (
        <div className="m-approve-sheet" data-testid="m-approve-sheet" role="dialog" aria-label="Aprovação">
          <span className="m-sheet-grab-bar" />
          <div className="m-approve-head">
            <span className="m-approve-badge">!</span>
            <span className="grow"><b>{harness}</b> quer usar <b>{pending[0].tool}</b>{pending.length > 1 && <span className="dim"> · 1 de {pending.length}</span>}</span>
          </div>
          <code className="m-approve-code">{summary(pending[0].input)}</code>
          {write ? (
            <div className="m-approve-actions">
              <button className="m-cta secondary" onClick={(e) => decideAndFlash(pending[0].id, false, e.currentTarget)} data-testid="m-deny">Negar</button>
              <button className="m-cta" onClick={(e) => decideAndFlash(pending[0].id, true, e.currentTarget)} data-testid="m-approve">Aprovar</button>
            </div>
          ) : (
            <div className="m-approve-wait">Aguardando um editor decidir.</div>
          )}
        </div>
      )}
      {queue.length > 0 && (
        <div className="m-queue" data-testid="m-queue">
          <div className="m-queue-head">Na fila ({queue.length}) · sai na ordem de chegada quando o turno acabar</div>
          {queue.map((q) => (
            <div key={q.id} className="m-queue-item" data-testid="m-queue-item">
              <Avatar name={q.author.name} color={q.author.color} size={18} />
              <span className="grow m-ellipsis">{q.text}</span>
              <span className="dim small">{q.author.name}</span>
              {write && <button className="m-queue-x" onClick={() => k.queueRemove(chatId, q.id)} aria-label="Tirar da fila"><I.close size={14} /></button>}
            </div>
          ))}
        </div>
      )}
      <ChangedChips ws={ws} from={`chat:${chatId}`} />
      {write ? (
        <div className="m-dock">
          <div className={"m-composer" + (planMode ? " plan" : "")}>
            <textarea rows={1} value={text} onChange={(e) => typing(e.target.value)} placeholder={chat?.status === "working" ? "Mensagem (entra na fila)" : "Mensagem"} data-testid="m-chat-input" enterKeyHint="send" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} />
            <div className="m-composer-bar">
              {chat && (
                <button className="m-model-chip" onClick={(e) => (haptic(e.currentTarget), setSheet(true))} data-testid="m-chat-model-chip">
                  <AgentIcon agent={chat.harness} size={18} />
                  <span className="m-ellipsis">{chat.model}</span>
                </button>
              )}
              {planMode ? (
                <PlanChip mode={planMode} onClick={planMode === "emulated" ? () => setMode(null) : undefined} />
              ) : (
                <button className="m-composer-icon" onClick={(e) => (haptic(e.currentTarget), setMode("emulated"))} aria-label="Ligar plan mode" title="Plan mode" data-testid="m-plan-toggle"><I.plan /></button>
              )}
              <span className="grow" />
              <button className={"m-composer-round mic " + dict.state} onClick={dict.toggle} aria-label="Ditado" data-testid="m-mic">{dict.state === "listening" ? <I.stop /> : <I.mic />}</button>
              {chat?.status === "working" && !text.trim() ? (
                <button className="m-composer-round stop" onClick={(e) => (haptic(e.currentTarget, "warn"), k.chatStop(chatId))} aria-label="Parar" data-testid="m-chat-stop"><I.stop /></button>
              ) : (
                <button className="m-composer-round m-send" onClick={(e) => (haptic(e.currentTarget), send())} disabled={!text.trim()} aria-label="Enviar" data-testid="m-chat-send"><I.up /></button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="m-readonly" data-testid="m-readonly">Você está acompanhando como observador.</div>
      )}
      {sheet && chat && (
        <ModelSheet
          current={chat.model}
          onClose={() => setSheet(false)}
          onPick={(m, o) => (m.label !== chat.model ? k.chatSwitch(chatId, m, o).then(setChat, (e) => setErr(String(e))) : undefined)}
        />
      )}
    </>
  );
}
