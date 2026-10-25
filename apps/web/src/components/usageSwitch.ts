/**
 * Troca de conta/LLM sugerida pela aba Uso (ou pela barra do Kabul) para as conversas abertas.
 *
 * Só o workspace visível e a aba ativa ficam montados (docs/escala.md): uma conversa fora da tela não
 * ouve o evento na hora. Por isso o pedido fica guardado e cada aba o aplica ao montar, uma vez.
 */
export interface UsageSwitch {
  provider: string;
  account?: { id: string; nickname: string };
  toProvider?: string;
}

interface Pending extends UsageSwitch {
  at: number;
  /** Abas (sessionId) que já aplicaram. */
  done: Set<string>;
}

/** Pedido mais velho que isto não vale para abas que montarem depois. */
const TTL_MS = 30 * 60_000;
const pending: Pending[] = [];

/** Pede a troca: as abas montadas recebem o evento; as outras aplicam ao montar. */
export function requestUsageSwitch(s: UsageSwitch) {
  pending.push({ ...s, at: Date.now(), done: new Set() });
  window.dispatchEvent(new CustomEvent("kabul:usage-switch", { detail: s }));
}

/** Pedidos que esta aba ainda não aplicou (e já os marca como aplicados por ela). */
export function takeUsageSwitches(sessionId: string): UsageSwitch[] {
  const now = Date.now();
  for (let i = pending.length - 1; i >= 0; i--) if (now - pending[i].at > TTL_MS) pending.splice(i, 1);
  const out: UsageSwitch[] = [];
  for (const p of pending) {
    if (p.done.has(sessionId)) continue;
    p.done.add(sessionId);
    out.push({ provider: p.provider, account: p.account, toProvider: p.toProvider });
  }
  return out;
}

/** Marca o pedido recebido pelo evento como aplicado por esta aba (não reaplica ao remontar). */
export function markUsageSwitch(sessionId: string, s: UsageSwitch) {
  for (const p of pending) if (p.provider === s.provider && p.toProvider === s.toProvider && p.account?.id === s.account?.id) p.done.add(sessionId);
}
