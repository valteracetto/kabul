import type { Transport } from "./types";

/**
 * Transporte para a PWA (fase seguinte): o kabuld fala o mesmo contrato por WebSocket.
 * Protocolo: {id, command, args} -> {id, ok, value|error}; eventos chegam como {channel, payload}.
 */
export function websocketTransport(url: string): Transport {
  const ws = new WebSocket(url);
  const pending = new Map<number, { ok: (v: unknown) => void; err: (e: unknown) => void }>();
  const subs = new Map<string, Set<(p: unknown) => void>>();
  const ready = new Promise<void>((r) => ws.addEventListener("open", () => r(), { once: true }));
  let seq = 0;
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data as string);
    if (msg.channel) subs.get(msg.channel)?.forEach((h) => h(msg.payload));
    else if (pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      msg.ok ? p.ok(msg.value) : p.err(msg.error);
    }
  });
  return {
    async call<T>(command: string, args?: Record<string, unknown>) {
      await ready;
      const id = ++seq;
      return new Promise<T>((ok, err) => {
        pending.set(id, { ok: ok as (v: unknown) => void, err });
        ws.send(JSON.stringify({ id, command, args }));
      });
    },
    subscribe<T>(channel: string, handler: (p: T) => void) {
      const set = subs.get(channel) ?? new Set();
      set.add(handler as (p: unknown) => void);
      subs.set(channel, set);
      return () => set.delete(handler as (p: unknown) => void);
    },
  };
}
