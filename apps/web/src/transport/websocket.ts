import type { Transport } from "./types";

/** Credencial de um aparelho pareado com um kabuld. */
export interface Credential { device: string; key: string }

export type ConnState = "connecting" | "open" | "closed" | "unauthorized" | "revoked";

export interface WsTransport extends Transport {
  /** Quem o kabuld reconheceu nesta conexão (dono, editor, observador). */
  principal(): Principal | null;
  machine(): string | null;
  state(): ConnState;
  /** Último erro do hello (credencial inválida, revogada, pareamento necessário). */
  lastError(): string | null;
  onState(h: (s: ConnState, error?: string) => void): () => void;
  close(): void;
}

export interface Principal { id: string; user: string; device: string; role: "owner" | "editor" | "observer"; scope: { kind: "all" } | { kind: "workspace"; id: string }; color: string }

/**
 * Transporte do kabuld por WebSocket (PWA, outras máquinas, convidados).
 * Protocolo: primeiro `{hello: {device?, key?}}` → `{hello: {ok, principal}}`; depois
 * `{id, command, args}` → `{id, ok, value|error}`; eventos `{channel, payload}` só dos canais
 * assinados com `{sub}`. Reconecta sozinho (rede do celular cai) e reassina os canais.
 */
export function websocketTransport(url: string, cred?: Credential | (() => Credential | null) | null): WsTransport {
  const pending = new Map<number, { ok: (v: unknown) => void; err: (e: unknown) => void }>();
  const subs = new Map<string, Set<(p: unknown) => void>>();
  const stateHandlers = new Set<(s: ConnState, error?: string) => void>();
  let ws: WebSocket | null = null;
  let seq = 0;
  let st: ConnState = "connecting";
  let lastErr: string | null = null;
  let who: Principal | null = null;
  let machine: string | null = null;
  let closed = false;
  let retry = 0;
  let ready!: Promise<void>;
  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const resetReady = () => {
    ready = new Promise<void>((ok, err) => ((resolveReady = ok), (rejectReady = err)));
    ready.catch(() => {});
  };
  resetReady();
  const setState = (s: ConnState, e?: string) => {
    st = s;
    if (e) lastErr = e;
    stateHandlers.forEach((h) => h(s, e));
  };

  const connect = () => {
    setState("connecting");
    const sock = new WebSocket(url);
    ws = sock;
    let helloOk = false;
    sock.addEventListener("open", () => {
      const c = typeof cred === "function" ? cred() : cred;
      sock.send(JSON.stringify({ hello: c ? { device: c.device, key: c.key } : {} }));
    });
    sock.addEventListener("message", (m) => {
      const msg = JSON.parse(m.data as string);
      if (msg.hello) {
        if (msg.hello.ok) {
          helloOk = true;
          retry = 0;
          who = msg.hello.principal;
          machine = msg.hello.machine ?? null;
          for (const ch of subs.keys()) sock.send(JSON.stringify({ sub: ch }));
          setState("open");
          resolveReady();
        } else {
          closed = true;
          setState("unauthorized", msg.hello.error);
          rejectReady(msg.hello.error);
        }
        return;
      }
      if (msg.channel === "revoked") {
        closed = true;
        setState("revoked", "Acesso revogado pelo dono da máquina.");
        return;
      }
      if (msg.channel) subs.get(msg.channel)?.forEach((h) => h(msg.payload));
      else if (pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.ok ? p.ok(msg.value) : p.err(msg.error);
      }
    });
    sock.addEventListener("close", () => {
      pending.forEach((p) => p.err("conexão com o kabuld caiu"));
      pending.clear();
      if (closed) {
        if (st === "open" || st === "connecting") setState("closed");
        return;
      }
      if (helloOk) resetReady();
      setState("closed");
      retry = Math.min(retry + 1, 6);
      setTimeout(connect, 400 * 2 ** retry);
    });
  };
  connect();

  const send = (o: unknown): boolean => {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(o));
    return true;
  };

  return {
    async call<T>(command: string, args?: Record<string, unknown>) {
      await ready;
      const id = ++seq;
      return new Promise<T>((ok, err) => {
        pending.set(id, { ok: ok as (v: unknown) => void, err });
        if (!send({ id, command, args })) {
          pending.delete(id);
          err("sem conexão com o kabuld");
        }
      });
    },
    subscribe<T>(channel: string, handler: (p: T) => void) {
      let set = subs.get(channel);
      if (!set) {
        set = new Set();
        subs.set(channel, set);
        if (st === "open") send({ sub: channel });
      }
      set.add(handler as (p: unknown) => void);
      return () => {
        set!.delete(handler as (p: unknown) => void);
        if (set!.size === 0) {
          subs.delete(channel);
          send({ unsub: channel });
        }
      };
    },
    principal: () => who,
    machine: () => machine,
    state: () => st,
    lastError: () => lastErr,
    onState(h) {
      stateHandlers.add(h);
      return () => stateHandlers.delete(h);
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
