import type { Transport } from "./types";
import { compat as compatOf, helloInfo, type Compat, type PeerInfo } from "../version";
import { t } from "../i18n";

/** Credencial de um aparelho pareado com um kabuld. */
export interface Credential { device: string; key: string }

/** `incompatible`: o kabuld recusou este app por ser antigo demais (ver `version.ts`). */
export type ConnState = "connecting" | "open" | "closed" | "unauthorized" | "revoked" | "incompatible";

export interface WsTransport extends Transport {
  /** Quem o kabuld reconheceu nesta conexão (dono, editor, observador). */
  principal(): Principal | null;
  machine(): string | null;
  /** Versão e protocolo do kabuld (do `hello`); `null` antes de conectar. */
  server(): PeerInfo | null;
  /** Compatibilidade de versão com o kabuld; `ok` enquanto não se sabe. */
  compat(): Compat;
  state(): ConnState;
  /** Último erro do hello (credencial inválida, revogada, pareamento necessário). */
  lastError(): string | null;
  onState(h: (s: ConnState, error?: string) => void): () => void;
  /** Tenta conectar agora, sem esperar o intervalo entre tentativas. */
  reconnect(): void;
  close(): void;
}

export interface Principal { id: string; user: string; device: string; role: "owner" | "editor" | "observer"; scope: { kind: "all" } | { kind: "workspace"; id: string }; color: string }

/**
 * Transporte do kabuld por WebSocket (PWA, outras máquinas, convidados).
 * Protocolo: primeiro `{hello: {device?, key?}}` → `{hello: {ok, principal}}`; depois
 * `{id, command, args}` → `{id, ok, value|error}`; eventos `{channel, payload}` só dos canais
 * assinados com `{sub}`. Reconecta sozinho (rede do celular cai) e reassina os canais.
 */
/** Sem `hello` em 8 s, desiste do socket e tenta outro. */
const HELLO_TIMEOUT = 8000;
/** Ao voltar ao app, o socket "aberto" tem 4 s para responder um whoami. */
const PING_TIMEOUT = 4000;
/** Maior espera entre tentativas (antes chegava a 25,6 s: o app parecia desconectado depois de reiniciar o kabuld). */
const MAX_BACKOFF = 8000;

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
  let server: PeerInfo | null = null;
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

  let timer: ReturnType<typeof setTimeout> | null = null;
  const connect = () => {
    if (timer) (clearTimeout(timer), (timer = null));
    setState("connecting");
    const sock = new WebSocket(url);
    ws = sock;
    let helloOk = false;
    // Sem resposta do hello em 8 s (rede do celular trocando, kabuld reiniciando, socket que o iOS deixou
    // pendurado ao voltar do fundo): fecha e tenta de novo, em vez de ficar "conectando" por minutos.
    const stall = setTimeout(() => !helloOk && sock.readyState !== WebSocket.CLOSED && sock.close(), HELLO_TIMEOUT);
    sock.addEventListener("open", () => {
      const c = typeof cred === "function" ? cred() : cred;
      const client = helloInfo("web");
      sock.send(JSON.stringify({ hello: c ? { device: c.device, key: c.key, client } : { client } }));
    });
    sock.addEventListener("message", (m) => {
      if (ws !== sock) return;
      const msg = JSON.parse(m.data as string);
      if (msg.hello) {
        server = msg.hello.server ?? null;
        if (msg.hello.incompatible) {
          closed = true;
          setState("incompatible", msg.hello.error);
          rejectReady(msg.hello.error);
        } else if (msg.hello.ok) {
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
        setState("revoked", t("app.ws.revoked"));
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
      clearTimeout(stall);
      if (ws !== sock) return; // já trocado por uma reconexão forçada
      pending.forEach((p) => p.err(t("app.ws.dropped")));
      pending.clear();
      if (closed) {
        if (st === "open" || st === "connecting") setState("closed");
        return;
      }
      if (helloOk) resetReady();
      setState("closed");
      retry = Math.min(retry + 1, 5);
      timer = setTimeout(connect, Math.min(400 * 2 ** retry, MAX_BACKOFF));
    });
  };
  connect();

  /** Reconecta já (sem esperar o recuo), trocando um socket que pode estar morto sem ter fechado. */
  const reconnectNow = () => {
    if (closed) return;
    retry = 0;
    const old = ws;
    ws = null;
    if (old && old.readyState !== WebSocket.CLOSED) {
      pending.forEach((p) => p.err(t("app.ws.dropped")));
      pending.clear();
      if (st === "open") resetReady();
      try {
        old.close();
      } catch {}
    }
    connect();
  };
  // De volta ao app (iOS congela a PWA no fundo) ou à rede: sem conexão aberta, reconecta na hora; com ela
  // "aberta", confere com um whoami (o socket pode ter morrido calado) e reconecta se não responder.
  if (typeof window !== "undefined") {
    const wake = () => {
      if (closed || document.visibilityState === "hidden") return;
      if (st !== "open") return reconnectNow();
      const sock = ws;
      const id = ++seq;
      const t0 = setTimeout(() => (pending.delete(id), ws === sock && reconnectNow()), PING_TIMEOUT);
      pending.set(id, { ok: () => clearTimeout(t0), err: () => clearTimeout(t0) });
      if (!send({ id, command: "whoami", args: {} })) (clearTimeout(t0), pending.delete(id), reconnectNow());
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", (e) => (e as PageTransitionEvent).persisted && wake());
  }

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
          err(t("app.ws.offline"));
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
    server: () => server,
    compat: () => (server ? compatOf(server, machine ? t("app.compat.kabuldOf", { machine }) : t("app.compat.kabuld")) : { kind: "ok" }),
    state: () => st,
    lastError: () => lastErr,
    onState(h) {
      stateHandlers.add(h);
      return () => stateHandlers.delete(h);
    },
    reconnect: () => void (st !== "open" && reconnectNow()),
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}
