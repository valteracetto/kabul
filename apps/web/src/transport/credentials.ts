import type { Credential } from "./websocket";

/** Credencial deste aparelho para o kabuld que serve a página (PWA). Fica só neste navegador. */
const KEY = "kabul.cred";

export interface Paired { device: { id: string; user: string; name: string; role: string; scope: unknown; color: string }; key: string; machine: string }

export const localCred = (): Credential | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
export const saveCred = (c: Credential) => localStorage.setItem(KEY, JSON.stringify(c));
export const clearCred = () => localStorage.removeItem(KEY);

/** `#pair=<token>&w=<workspace>` do link do QR ou do convite. */
export function parsePairLink(input: string): { token: string; workspace: string | null; base: string | null } | null {
  const t = input.trim();
  const hash = t.includes("#") ? t.slice(t.indexOf("#") + 1) : t;
  const q = new URLSearchParams(hash);
  const token = q.get("pair");
  if (!token) return null;
  let base: string | null = null;
  try {
    if (/^https?:\/\//.test(t)) base = new URL(t).origin;
  } catch {}
  return { token, workspace: q.get("w"), base };
}

/** Troca o ingresso por uma credencial (`POST <base>/api/pair`). */
export async function pairWith(base: string, token: string, user: string, device: string): Promise<Paired> {
  const r = await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, user, device }) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(j.error ?? "falha no pareamento");
  return j.value as Paired;
}

/** Nome sugerido para este aparelho. */
export function deviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Navegador";
}
