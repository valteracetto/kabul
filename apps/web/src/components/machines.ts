/**
 * Máquinas do seletor do topo: "Este Mac" (o backend local) e outras máquinas com kabuld (via
 * Tailscale, por WebSocket). A escolhida fica no aparelho e decide o transporte ao abrir o app.
 */
/** `device`/`key`: credencial pareada com o kabuld daquela máquina (Configurações › Celular e remoto). */
export interface Machine { id: string; name: string; url: string; device?: string; key?: string }
const LIST = "kabul.machines";
const ACTIVE = "kabul.machine";

export const machines = (): Machine[] => {
  try {
    return JSON.parse(localStorage.getItem(LIST) ?? "[]");
  } catch {
    return [];
  }
};
export const saveMachines = (m: Machine[]) => localStorage.setItem(LIST, JSON.stringify(m));
export const activeMachine = (): string => localStorage.getItem(ACTIVE) || "local";
/** Remota ativa (ou null para este Mac). */
export const remoteMachine = (): Machine | null => machines().find((m) => m.id === activeMachine()) ?? null;

/** Troca a fonte de repos/workspaces: grava a escolha e recarrega com o transporte novo. */
export function switchMachine(id: string) {
  if (id === activeMachine()) return;
  localStorage.setItem(ACTIVE, id);
  window.dispatchEvent(new CustomEvent("kabul:machine", { detail: id }));
  if (!(window as unknown as { __noReload?: boolean }).__noReload) location.reload();
}

/** `ws://host:porta/ws` a partir do que o usuário digitar (host, host:porta ou URL). */
export function normalizeUrl(u: string): string {
  const t = u.trim();
  if (/^wss?:\/\//.test(t)) return t;
  if (/^https?:\/\//.test(t)) return t.replace(/^http/, "ws").replace(/\/?$/, "/ws");
  return `ws://${t.includes(":") ? t : `${t}:7777`}/ws`;
}
