/**
 * Rotinas locais: um prompt que roda sozinho num workspace, por horário (cron de 5 campos, no mínimo a cada
 * 15 min) ou por evento do PR do workspace (checks falharam, PR com merge, comentário novo). Ficam no
 * aparelho e rodam enquanto o Kabul está aberto; cada execução abre uma conversa nova no workspace.
 */
import { t, lazyRecord } from "../i18n";

export type Trigger = { kind: "cron"; cron: string } | { kind: "pr"; event: "checks_failed" | "merged" | "comment" };
export interface RoutineRun { at: number; why: string }
export interface Routine { id: string; name: string; workspace: string; prompt: string; trigger: Trigger; enabled: boolean; runs: RoutineRun[]; seen?: { failing?: number; state?: string; comments?: number } }

const KEY = "kabul.routines";
export const loadRoutines = (): Routine[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};
export const saveRoutines = (r: Routine[]) => (localStorage.setItem(KEY, JSON.stringify(r)), window.dispatchEvent(new Event("kabul:routines")));

export const PR_EVENTS: Record<string, string> = lazyRecord(() => ({ checks_failed: t("app.routine.event.checks_failed"), merged: t("app.routine.event.merged"), comment: t("app.routine.event.comment") }));

// Um campo do cron: asterisco, asterisco/n, a-b, a-b/n e listas com vírgula.
function field(spec: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let [a, b] = m[1] === "*" ? [min, max] : m[1].includes("-") ? m[1].split("-").map(Number) : [Number(m[1]), Number(m[1])];
    if (m[1] !== "*" && !m[1].includes("-") && m[2]) b = max;
    if (a < min || b > max || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export interface Cron { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; anyDom: boolean; anyDow: boolean }
export function parseCron(s: string): Cron | null {
  const f = s.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = [field(f[0], 0, 59), field(f[1], 0, 23), field(f[2], 1, 31), field(f[3], 1, 12), field(f[4].replace(/\b7\b/g, "0"), 0, 6)];
  if (!min || !hour || !dom || !mon || !dow) return null;
  return { min, hour, dom, mon, dow, anyDom: f[2] === "*", anyDow: f[4] === "*" };
}

export function cronMatches(c: Cron, d: Date): boolean {
  if (!c.min.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false;
  // Como no cron clássico: com dia do mês e da semana restritos, vale qualquer um dos dois.
  const dm = c.dom.has(d.getDate()), dw = c.dow.has(d.getDay());
  return c.anyDom && c.anyDow ? true : c.anyDom ? dw : c.anyDow ? dm : dm || dw;
}

/** Próximas execuções (até `n`), procurando minuto a minuto por até 8 dias. */
export function nextRuns(c: Cron, from: Date, n = 3): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 8 * 24 * 60 && out.length < n; i++, d.setMinutes(d.getMinutes() + 1)) if (cronMatches(c, d)) out.push(new Date(d));
  return out;
}

/** Erro de validação do cron (formato ou intervalo menor que 15 min), ou null. */
export function cronError(s: string): string | null {
  const c = parseCron(s);
  if (!c) return t("app.routine.cronInvalid");
  const next = nextRuns(c, new Date(), 6);
  if (!next.length) return t("app.routine.cronNever");
  for (let i = 1; i < next.length; i++) if (next[i].getTime() - next[i - 1].getTime() < 15 * 60_000) return t("app.routine.cronMin");
  return null;
}

export const describe = (tr: Trigger) => (tr.kind === "cron" ? `cron ${tr.cron}` : PR_EVENTS[tr.event]);
