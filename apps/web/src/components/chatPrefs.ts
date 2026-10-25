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
/** Workspaces com a tela montada (recebem eventos como kabul:fork-tab na hora). */
export const mountedWs = new Set<string>();
/** Conversa a trazer para a frente quando o workspace montar (painel Agentes, notificação). */
export const pendingActivate: Record<string, string> = {};
/** Modelo pedido para uma aba nova (ex.: "Modelo da revisão"). */
export const pendingModel: Record<string, string> = {};

/** Preset do terminal grande (Configurações › Aparência): o comando que roda ao abrir a aba. */
export const TERM_PRESETS: Record<string, string> = { none: "", claude: "claude", codex: "codex", agy: "agy", opencode: "opencode" };
export const termPreset = () => {
  const k = localStorage.getItem("kabul.bigTerminal.preset") ?? "none";
  return k === "custom" ? localStorage.getItem("kabul.bigTerminal.command") ?? "" : TERM_PRESETS[k] ?? "";
};
