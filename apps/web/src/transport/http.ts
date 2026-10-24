import type { Transport } from "./types";

/**
 * RPC HTTP (POST /rpc) contra `kabul serve`: E2E com o backend real. Sem push: com algum canal
 * assinado, faz polling de `events_poll` e entrega os eventos por canal.
 */
export function httpTransport(base: string): Transport {
  const call = async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const r = await fetch(`${base}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, args }) });
    const j = await r.json();
    if (!j.ok) throw j.error;
    return j.value as T;
  };
  const subs = new Map<string, Set<(p: unknown) => void>>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const poll = async () => {
    try {
      for (const e of await call<{ channel: string; payload: unknown }[]>("events_poll")) subs.get(e.channel)?.forEach((h) => h(e.payload));
    } catch {
      /* servidor sem eventos */
    }
  };
  return {
    call,
    subscribe(channel, handler) {
      const s = subs.get(channel) ?? new Set();
      s.add(handler as (p: unknown) => void);
      subs.set(channel, s);
      timer ??= setInterval(poll, 250);
      return () => {
        s.delete(handler as (p: unknown) => void);
        if ([...subs.values()].every((x) => x.size === 0) && timer) (clearInterval(timer), (timer = null));
      };
    },
  };
}
