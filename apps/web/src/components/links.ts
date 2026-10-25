/** Links `kabul://` (copiados no app, abertos pelo sistema ou por outro programa). */
export type KabulLink =
  | { kind: "workspace"; id: string; session: string | null }
  | { kind: "create"; repo: string | null; path: string | null; branch: string | null; prompt: string | null; linear: string | null }
  | { kind: "settings"; tab: string | null }
  | { kind: "browser"; url: string | null; workspace: string | null };

export function parseKabulLink(url: string): KabulLink | null {
  const m = /^kabul:\/\/([a-z-]+)\/?(?:\?(.*))?$/i.exec(url.trim());
  if (!m) return null;
  const q = new URLSearchParams(m[2] ?? "");
  const g = (k: string) => q.get(k) || null;
  switch (m[1].toLowerCase()) {
    case "workspace": return g("id") ? { kind: "workspace", id: g("id")!, session: g("session") } : null;
    case "create": case "new": return { kind: "create", repo: g("repo"), path: g("path"), branch: g("branch"), prompt: g("prompt"), linear: g("linear_id") };
    case "settings": return { kind: "settings", tab: g("tab") };
    // kabul://browser?url=<url>[&workspace=<id>]: aba Browser do workspace (o aberto, se não disser qual).
    case "browser": return { kind: "browser", url: g("url"), workspace: g("workspace") ?? g("ws") ?? g("id") };
    default: return null;
  }
}

/** Última notificação do sistema: o clique traz o app para a frente e abre esta conversa. */
export const lastNotify: { ws: string; session: string; at: number } = { ws: "", session: "", at: 0 };
