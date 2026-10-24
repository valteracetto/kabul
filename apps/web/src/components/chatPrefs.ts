/** Preferências do chat no aparelho: tecla de envio, comportamento do follow-up e "não recolher" (⌃O). */
export const chatPrefs = {
  sendKey: () => (localStorage.getItem("kabul.sendKey") as "enter" | "cmdEnter") || "enter",
  followUp: () => (localStorage.getItem("kabul.followUp") as "queue" | "steer") || "queue",
  noCollapse: () => localStorage.getItem("kabul.noCollapse") === "1",
  set: (k: "sendKey" | "followUp" | "noCollapse", v: string) => (localStorage.setItem(`kabul.${k}`, v), window.dispatchEvent(new Event("kabul:chat-prefs"))),
};

/** Fork pendente: a aba/workspace novo começa com estes itens e retoma a sessão (ou faz replay). */
export interface PendingFork { items: unknown[]; resume: string | null; forkSession: boolean; replay: boolean; modelKey: string | null }
export const pendingFork: Record<string, PendingFork> = {};
export const pendingForkWs: Record<string, { chatId: string }> = {};
