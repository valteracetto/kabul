/**
 * Versão do app e do protocolo kabuld <-> clientes (espelho de `kabul_core::schema`).
 * A versão vem do package.json no build (`scripts/version.mjs` mantém tudo igual).
 */
export const APP_VERSION: string = __KABUL_VERSION__;
/** Suba junto com `PROTOCOL` em crates/kabul-core/src/schema.rs. */
export const PROTOCOL = 1;
export const MIN_PEER_PROTOCOL = 1;

export interface PeerInfo { name?: string; version?: string; protocol?: number; min_protocol?: number }

export type Compat =
  | { kind: "ok" }
  /** O kabuld é antigo demais para este app. */
  | { kind: "peer_outdated"; peer_version: string; message: string }
  /** Este app é antigo demais para o kabuld. */
  | { kind: "self_outdated"; peer_version: string; message: string };

export const helloInfo = (name: string): PeerInfo => ({ name, version: APP_VERSION, protocol: PROTOCOL, min_protocol: MIN_PEER_PROTOCOL });

/** Mesma regra do core: campos ausentes valem o protocolo 1 (antes do handshake). */
export function compat(peer: PeerInfo | null | undefined, where = "O kabuld"): Compat {
  const v = peer?.version ?? "desconhecida";
  if ((peer?.protocol ?? 1) < MIN_PEER_PROTOCOL) return { kind: "peer_outdated", peer_version: v, message: `${where} está numa versão antiga do Kabul (${v}); este app é ${APP_VERSION}. Atualize o Kabul nessa máquina.` };
  if (PROTOCOL < (peer?.min_protocol ?? 1)) return { kind: "self_outdated", peer_version: v, message: `Este app (${APP_VERSION}) é antigo para ${where.toLowerCase()} (${v}). Atualize este aparelho.` };
  return { kind: "ok" };
}
