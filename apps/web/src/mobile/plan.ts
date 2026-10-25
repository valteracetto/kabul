import { isOwner, kcall } from "./kabuld";
import { t } from "../i18n";

/**
 * Plan mode no celular. Claude e Antigravity têm plano nativo (`--permission-mode plan`, escolhido ao
 * iniciar a conversa). Nos outros agentes, ou ao ligar o plano no meio de uma conversa, o Kabul emula:
 * a mensagem vai com uma instrução para só planejar e esperar aprovação.
 */
export type PlanMode = "native" | "emulated" | null;
export const PLAN_NATIVE = new Set(["claude", "antigravity"]);
/** Instrução enviada ao agente, no idioma da tela. */
export const planPrefix = () => t("mobile.plan.prefix");
// Mensagens de plano gravadas em qualquer idioma: "[Modo plano] …\n\n" ou "[Plan mode] …\n\n".
const PLAN_RE = /^\[(?:Modo plano|Plan mode)\][^\n]*\n\n/; // i18n-ignore
/** Texto da mensagem sem a instrução de plano (em qualquer idioma), ou null se não for mensagem de plano. */
export function planBody(text: string): string | null {
  const m = PLAN_RE.exec(text);
  return m ? text.slice(m[0].length) : null;
}

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

export const planLabel = (m: PlanMode) => (m === "emulated" ? t("mobile.plan.emulated") : t("mobile.plan.label"));
