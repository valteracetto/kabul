import type { Transport } from "./types";

/** RPC HTTP (POST /rpc) contra `kabul serve`: E2E com o backend real. Sem eventos push. */
export function httpTransport(base: string): Transport {
  return {
    async call<T>(command: string, args?: Record<string, unknown>) {
      const r = await fetch(`${base}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command, args }) });
      const j = await r.json();
      if (!j.ok) throw j.error;
      return j.value as T;
    },
    subscribe: () => () => {},
  };
}
