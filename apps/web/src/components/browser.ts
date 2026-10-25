/**
 * Ligações da aba Browser com o resto do app: abrir o navegador do workspace (com uma URL) a partir do
 * terminal, do deep link `kabul://browser?url=` ou da paleta, mesmo antes de a aba montar.
 */

/** URL pedida para a aba Browser de cada workspace (consumida quando a aba monta ou recebe o evento). */
export const pendingBrowserUrl: Record<string, string> = {};

/** Workspaces com a aba Browser na tela (o banner global de aprovação não repete o que ela já mostra). */
export const visibleBrowser = new Set<string>();

/** Abre (ou traz para a frente) a aba Browser do workspace; com `url`, navega até ela. */
export function openBrowser(ws: string, url?: string | null) {
  if (url) pendingBrowserUrl[ws] = url;
  window.dispatchEvent(new CustomEvent("kabul:browser-open", { detail: { ws, url: url ?? null } }));
}

/** Última URL local (localhost, 127.0.0.1, 0.0.0.0, [::1]) num texto, ex. a saída do `npm run dev`. */
export function lastLocalUrl(text: string): string | null {
  const re = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s"'<>`\x1b]*)?/g;
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[0].replace(/[),.;:]+$/, "");
  // 0.0.0.0 é endereço de escuta: o navegador abre pelo localhost.
  return last?.replace("//0.0.0.0", "//localhost") ?? null;
}

/** Modificadores no formato do CDP: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export const cdpModifiers = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

/** Agente agiu há pouco (indicador "controlando"). */
export const AGENT_RECENT_MS = 8000;
