import { isOwner, kcall } from "./kabuld";

/**
 * Plan mode no celular. Claude e Antigravity têm plano nativo (`--permission-mode plan`, escolhido ao
 * iniciar a conversa). Nos outros agentes, ou ao ligar o plano no meio de uma conversa, o Kabul emula:
 * a mensagem vai com uma instrução para só planejar e esperar aprovação.
 */
export type PlanMode = "native" | "emulated" | null;
export const PLAN_NATIVE = new Set(["claude", "antigravity"]);
export const PLAN_PREFIX = "[Modo plano] Antes de mexer em qualquer arquivo, apresente só um plano passo a passo e espere a minha aprovação.\n\n";

const KEY = "kabul.m.plan";
const all = (): Record<string, PlanMode> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
export const getPlan = (chatId: string): PlanMode => all()[chatId] ?? null;
export function setPlan(chatId: string, m: PlanMode) {
  const a = all();
  if (m) a[chatId] = m;
  else delete a[chatId];
  localStorage.setItem(KEY, JSON.stringify(a));
}

/** "Conversas novas em plan mode" (Configurações › Modelos do desktop). Convidados não leem: começa desligado. */
export const defaultPlan = (): Promise<boolean> =>
  isOwner() ? kcall<{ default_plan?: boolean }>("app_settings_get").then((s) => !!s?.default_plan, () => false) : Promise.resolve(false);

export const planLabel = (m: PlanMode) => (m === "emulated" ? "Plano (emulado)" : "Plano");
