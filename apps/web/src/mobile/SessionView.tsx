import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { transport } from "../transport";
import { Markdown } from "../components/Markdown";
import { useDictation } from "../components/useDictation";
import { AGENT_LABEL, canWrite, k, kcall, me, type AuthorView, type ChatView as Chat, type Entry, type LiveSession, type Present, type Queued, type TermInfo } from "./kabuld";
import { AgentIcon, Avatar, StatusPill } from "./ui";

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
  return (
    <div className="m-app" data-testid="m-session-view">
      <header className="m-top">
        <button className="m-btn ghost" onClick={onBack} data-testid="m-back" aria-label="Voltar">‹</button>
        {s && <AgentIcon agent={s.agent} size={20} />}
        <div className="m-top-title">
          <b className="m-ellipsis" data-testid="m-title">{s?.name ?? name}</b>
          <span className="dim small m-ellipsis">{s ? `${s.group.repo}${s.group.workspace ? ` › ${s.group.workspace}` : ""}` : ""}</span>
        </div>
        {wsId && <PresenceBar ws={wsId} target={id} />}
        {s && <StatusPill status={s.status} detail={s.detail} />}
      </header>
      {err && <div className="m-error">{err}</div>}
      {isChat ? <ChatPane chatId={name} ws={wsId} /> : <TermPane session={name} agent={s?.agent ?? "shell"} />}
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
    const t = new Terminal({ cols: info.cols, rows: info.rows, fontSize: fit(), fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', scrollback: 3000, disableStdin: !write, cursorBlink: write, theme: { background: "#131110", foreground: "#e9e8e6" } });
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
  return (
    <>
      <div className="m-term-wrap">
        <div className="m-term" ref={host} data-testid="m-terminal" />
        {err && <div className="m-error m-float">{err}</div>}
      </div>
      {write ? (
        <div className="m-dock">
          <div className="m-keys" data-testid="m-keybar">
            <button onClick={() => keys(["Escape"])}>Esc</button>
            <button onClick={() => keys(["C-c"])} data-testid="m-key-ctrlc">⌃C</button>
            <button onClick={() => keys(["Tab"])}>Tab</button>
            <button onClick={() => keys(["Up"])} aria-label="Seta para cima">↑</button>
            <button onClick={() => keys(["Down"])} aria-label="Seta para baixo">↓</button>
            <button onClick={() => keys(["Left"])} aria-label="Seta para a esquerda">←</button>
            <button onClick={() => keys(["Right"])} aria-label="Seta para a direita">→</button>
            <button onClick={() => keys(["Enter"])}>⏎</button>
            <button className="ok" onClick={() => keys(APPROVE[agent] ?? ["y", "Enter"])} data-testid="m-key-approve">Aprovar</button>
            <button className="no" onClick={() => keys(DENY[agent] ?? ["n", "Enter"])} data-testid="m-key-deny">Negar</button>
            <button onClick={fitWindow} title="Redimensiona a janela do tmux para a tela do celular (muda para todos)">Ajustar</button>
          </div>
          <div className="m-compose">
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Digitar para ${AGENT_LABEL[agent] ?? agent}`} data-testid="m-term-input" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} />
            <button className={"m-mic " + dict.state} onClick={dict.toggle} aria-label="Ditado" data-testid="m-mic">{dict.state === "listening" ? "■" : "🎤"}</button>
            <button className="m-btn primary" onClick={send} disabled={!text} data-testid="m-term-send">Enviar</button>
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

function ChatPane({ chatId, ws }: { chatId: string; ws: string | null }) {
  const [items, setItems] = useState<Item[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  const write = canWrite();
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
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    k.chatSend(chatId, t).then(
      () => void (ws && k.presence(ws, `chat:${chatId}`, false).catch(() => {})),
      (e) => setErr(String(e)),
    );
  };
  const decide = (rid: string, allow: boolean) => k.chatApprove(chatId, rid, allow).catch((e) => setErr(String(e)));
  const dict = useDictation(useCallback((t: string) => setText((x) => (x ? x + " " : "") + t), []), useCallback((e: string) => setErr(e), []));
  const myName = me()?.user;
  return (
    <>
      <div className="m-chat" ref={scroller} data-testid="m-chat">
        {chat && <div className="m-chat-model dim small">{chat.model} · {AGENT_LABEL[chat.harness] ?? chat.harness}</div>}
        {items.map((it) => {
          switch (it.t) {
            case "user":
              return (
                <div key={it.key} className={"m-msg user" + (it.author.name === myName ? " mine" : "")} data-testid="m-msg-user" data-author={it.author.name}>
                  <div className="m-msg-author"><Avatar name={it.author.name} color={it.author.color ?? colors[it.author.name] ?? "#7c8cff"} size={18} /> <b>{it.author.name}</b> <span className="dim">· {it.author.device}</span></div>
                  <div className="m-msg-body">{it.text}</div>
                </div>
              );
            case "agent":
              return <div key={it.key} className="m-msg agent" data-testid="m-msg-agent"><Markdown text={it.text} /></div>;
            case "tool":
              return (
                <details key={it.key} className={"m-tool" + (it.error ? " err" : "")} data-testid="m-tool">
                  <summary><b>{it.name}</b> <span className="dim">{summary(it.input)}</span></summary>
                  {it.output && <pre>{it.output.slice(0, 4000)}</pre>}
                </details>
              );
            case "approval":
              return (
                <div key={it.key} className={"m-approval" + (it.decision ? " done" : "")} data-testid="m-approval">
                  <div><b>{it.tool}</b> pede aprovação</div>
                  <code>{summary(it.input)}</code>
                  {it.decision ? (
                    <div className="m-decision" data-testid="m-decision">{it.decision[0].toUpperCase() + it.decision.slice(1)}</div>
                  ) : write ? (
                    <div className="row">
                      <button className="m-btn primary" onClick={() => decide(it.id, true)} data-testid="m-approve">Aprovar</button>
                      <button className="m-btn" onClick={() => decide(it.id, false)} data-testid="m-deny">Negar</button>
                    </div>
                  ) : (
                    <div className="dim small">Aguardando um editor decidir.</div>
                  )}
                </div>
              );
            case "note":
              return <div key={it.key} className={`m-note ${it.kind}`} data-testid="m-note">{it.text}</div>;
          }
        })}
        {chat?.status === "working" && <div className="m-working dim small" data-testid="m-working">Trabalhando…</div>}
      </div>
      {err && <div className="m-error" onClick={() => setErr(null)}>{err}</div>}
      {queue.length > 0 && (
        <div className="m-queue" data-testid="m-queue">
          <div className="dim small">Na fila ({queue.length}) — sai na ordem de chegada quando o turno acabar</div>
          {queue.map((q) => (
            <div key={q.id} className="m-queue-item" data-testid="m-queue-item">
              <Avatar name={q.author.name} color={q.author.color} size={16} />
              <span className="grow m-ellipsis">{q.text}</span>
              <span className="dim small">{q.author.name}</span>
              {write && <button className="m-btn small ghost" onClick={() => k.queueRemove(chatId, q.id)} aria-label="Tirar da fila">×</button>}
            </div>
          ))}
        </div>
      )}
      {write ? (
        <div className="m-dock">
          <div className="m-compose">
            <textarea rows={1} value={text} onChange={(e) => typing(e.target.value)} placeholder={chat?.status === "working" ? "Mensagem (entra na fila)" : "Mensagem"} data-testid="m-chat-input" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())} />
            <button className={"m-mic " + dict.state} onClick={dict.toggle} aria-label="Ditado" data-testid="m-mic">{dict.state === "listening" ? "■" : "🎤"}</button>
            {chat?.status === "working" && <button className="m-btn" onClick={() => k.chatStop(chatId)} aria-label="Parar">■</button>}
            <button className="m-btn primary" onClick={send} disabled={!text.trim()} data-testid="m-chat-send">Enviar</button>
          </div>
        </div>
      ) : (
        <div className="m-readonly" data-testid="m-readonly">Você está acompanhando como observador.</div>
      )}
    </>
  );
}
