import { useEffect, useSyncExternalStore } from "react";
import { transport } from "../transport";
import type { Repo, Section, Workspace } from "../api";
import { isOwner, k, ws, type LiveSession } from "./kabuld";
import { t } from "../i18n";
import { trError } from "../i18n/errors";

/** Estado compartilhado pelas telas (lista, uso, novo workspace): sessões ao vivo, workspaces, repos, seções. */
export interface Snap { list: LiveSession[]; machine: string; os: string; err: string | null; workspaces: Workspace[]; repos: Repo[]; sections: Section[]; loaded: boolean }

let snap: Snap = { list: [], machine: "", os: "", err: null, workspaces: [], repos: [], sections: [], loaded: false };
const subs = new Set<() => void>();
const set = (p: Partial<Snap>) => ((snap = { ...snap, ...p }), subs.forEach((f) => f()));

export const loadLive = () => k.live().then((r) => set({ list: r.sessions, machine: r.machine, os: r.os, err: null, loaded: true }), (e) => set({ err: String(e), loaded: true }));
export const loadState = () =>
  Promise.all([
    k.workspaces().then((workspaces) => set({ workspaces }), () => {}),
    k.repos().then((repos) => set({ repos }), () => {}),
    isOwner() ? k.sections().then((sections) => set({ sections: sections ?? [] }), () => {}) : null,
  ]);
export const refresh = () => Promise.all([loadLive(), loadState()]);

/** Atualização otimista de um workspace (o kabuld confirma depois por `workspaces-changed`). */
export const patchWorkspace = (id: string, p: Partial<Workspace>) => set({ workspaces: snap.workspaces.map((w) => (w.id === id ? { ...w, ...p } : w)) });

/**
 * Arquivar/desarquivar. Arquivar some da lista na hora; o kabuld faz o resto em segundo plano e, se der
 * errado, avisa por `workspace-state` (com `error`): o workspace volta e o aparelho oferece tentar de novo.
 */
export function archiveWorkspace(id: string, archive: boolean) {
  const prev = snap.workspaces.find((w) => w.id === id);
  patchWorkspace(id, archive ? { archived: true, state: "archiving" } : { archived: false, state: "ready" });
  return k.workspaceArchive(id, archive).then(
    () => void loadState(),
    (e) => {
      if (prev) patchWorkspace(id, { archived: prev.archived, state: prev.state });
      alert(trError(e));
    },
  );
}

function archiveFailed(id: string, error: string) {
  void loadState();
  const w = snap.workspaces.find((x) => x.id === id);
  if (confirm(t("mobile.home.archiveFailed", { name: w ? w.title || w.name : id, error: trError(error) }))) void archiveWorkspace(id, true);
}

let users = 0;
let stop: (() => void) | null = null;
function start() {
  void refresh();
  const t = setInterval(loadLive, 4000);
  const t2 = setInterval(loadState, 20000);
  let pend: number | null = null;
  const soon = () => {
    if (pend) return;
    pend = window.setTimeout(() => ((pend = null), void loadLive()), 250);
  };
  const offs = ["sessions-changed", "session-status", "chat-state"].map((c) => transport.subscribe(c, soon));
  const offWs = transport.subscribe("workspaces-changed", () => void loadState());
  // Reconectou (kabuld reiniciado, volta do fundo): recarrega tudo na hora, sem esperar os intervalos.
  const offState = ws()?.onState((s) => s === "open" && void refresh());
  const offFail = transport.subscribe<{ id: string; error?: string; action?: string }>("workspace-state", (p) => void (p.error && p.action === "archive" && archiveFailed(p.id, p.error)));
  stop = () => (clearInterval(t), clearInterval(t2), offs.forEach((o) => o()), offWs(), offState?.(), offFail());
}

export function useKabul(): Snap {
  useEffect(() => {
    if (users++ === 0) start();
    return () => {
      if (--users === 0) (stop?.(), (stop = null));
    };
  }, []);
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => snap,
  );
}

/** Preferências da lista (ordenar e filtrar), guardadas no aparelho. */
export interface ListPrefs { sort: "sections" | "workspaces" | "recent"; workspaces: "active" | "archived" | "all"; section: string; repo: string; manual: boolean }
const LP = "kabul.m.list";
const DEFAULT: ListPrefs = { sort: "sections", workspaces: "active", section: "all", repo: "all", manual: false };
let prefs: ListPrefs = (() => {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(LP) ?? "{}") };
  } catch {
    return DEFAULT;
  }
})();
const psubs = new Set<() => void>();
export function setListPrefs(p: Partial<ListPrefs>) {
  prefs = { ...prefs, ...p };
  localStorage.setItem(LP, JSON.stringify(prefs));
  psubs.forEach((f) => f());
}
export const useListPrefs = (): ListPrefs =>
  useSyncExternalStore(
    (f) => (psubs.add(f), () => void psubs.delete(f)),
    () => prefs,
  );
