/**
 * Quadro no frontend: a configuração das colunas (global e por repositório), carregada uma vez e
 * compartilhada (Quadro, barra lateral, cabeçalho do workspace, celular), e o "mover card" com o
 * resultado da sincronia (Desfazer, Tentar de novo) para o aviso em `BoardFeedback`.
 *
 * Backend antigo (sem `board_get`: kabuld de outra versão, `kabul serve`): cai nos cinco status de antes
 * e o mover vira um `workspace_update` (sem sincronia).
 */
import { useSyncExternalStore } from "react";
import { api, type Board, type BoardColumn, type BoardConfig, type MoveResult, type Snapshot, type SyncResult, type Workspace } from "./api";
import { t } from "./i18n";

const LEGACY: [string, string, string, string][] = [
  ["backlog", "app.status.backlog", "backlog", "gray"],
  ["in-progress", "app.status.inProgress", "progress", "yellow"],
  ["in-review", "app.status.inReview", "review", "green"],
  ["done", "app.status.done", "done", "brown"],
  ["canceled", "app.status.canceled", "canceled", "gray"],
];
const AUTO = { mode: "auto" } as const;
const map = () => ({ linear: AUTO, github: AUTO, project: AUTO, github_label: null });

/** Os cinco status de antes (backend sem quadro configurável). */
export function legacyBoard(): Board {
  return {
    sync: false, reverse_sync: false, github_projects: false,
    auto: { enabled: true, agent_started: "in-progress", pr_opened: "in-review", pr_merged: "done" },
    columns: LEGACY.map(([id, key, icon, color]) => ({ id, name: t(key as never), icon, color, map: map() })),
  };
}

export const ICONS = ["backlog", "todo", "progress", "review", "done", "canceled", "blocked", "star"];
export const COLORS = ["gray", "blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "brown"];

let cfg: BoardConfig | null = null;
let legacy = false;
let loading: Promise<BoardConfig> | null = null;
const subs = new Set<() => void>();
const publish = () => subs.forEach((f) => f());

export function setBoardConfig(c: BoardConfig) {
  cfg = c;
  publish();
}

/** Carrega (uma vez; `force` relê). */
export function loadBoard(force = false): Promise<BoardConfig> {
  if (cfg && !force) return Promise.resolve(cfg);
  if (loading && !force) return loading;
  loading = api.boardGet().then(
    (c) => (legacy = false, setBoardConfig(c), c),
    () => {
      legacy = true;
      const c: BoardConfig = { global: legacyBoard(), repos: {}, icons: ICONS, colors: COLORS };
      setBoardConfig(c);
      return c;
    },
  ).finally(() => (loading = null));
  return loading;
}

/** Configuração atual (carrega na primeira vez; `null` até chegar). */
export function useBoardConfig(): BoardConfig | null {
  const c = useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => cfg);
  if (!c && !loading) void loadBoard();
  return c;
}

export const isLegacyBoard = () => legacy;
/** Configuração já carregada, fora de componentes (linhas memorizadas, títulos). */
export const currentBoardConfig = () => cfg;
/** Nome da coluna do workspace com a configuração já carregada. */
export const statusLabel = (w: Pick<Workspace, "status" | "repo_id">) => statusColumn(cfg, w).name;

export function boardFor(c: BoardConfig | null, repoId?: string | null): Board {
  if (!c) return legacyBoard();
  return (repoId && c.repos[repoId]) || c.global;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Coluna do status: o id; senão o nome; senão a primeira (como o core). */
export function columnOf(b: Board, status: string): BoardColumn {
  return b.columns.find((c) => c.id === status) ?? b.columns.find((c) => norm(c.name) === norm(status)) ?? b.columns[0];
}

/** Nome do status do workspace (coluna do quadro do repo dele). */
export function statusColumn(c: BoardConfig | null, w: Pick<Workspace, "status" | "repo_id">): BoardColumn {
  return columnOf(boardFor(c, w.repo_id), w.status || "in-progress");
}

/**
 * Colunas para agrupar na barra lateral: as do global e as dos repos com quadro próprio (sem repetir id),
 * na ordem de trás para a frente (o mais adiantado primeiro, como antes), canceladas no fim.
 */
export function sidebarColumns(c: BoardConfig | null): BoardColumn[] {
  const all = [...boardFor(c).columns];
  for (const b of Object.values(c?.repos ?? {})) for (const col of b.columns) if (!all.some((x) => x.id === col.id)) all.push(col);
  const rev = all.reverse();
  return [...rev.filter((x) => x.icon !== "canceled"), ...rev.filter((x) => x.icon === "canceled")];
}

// ---------------- mover card e aviso ----------------

export interface Feedback {
  id: number;
  title: string;
  /** Ainda falando com o rastreador. */
  pending: boolean;
  result?: MoveResult;
  error?: string;
  /** Desfazer: coluna e estado de antes. */
  undo?: { workspaceId: string; column: string; restore: Snapshot | null };
  retry?: string;
  /** Aviso vindo do polling (a issue mudou lá). */
  note?: string;
}

let feedback: Feedback | null = null;
let fseq = 0;
const fsubs = new Set<() => void>();
const fpublish = () => fsubs.forEach((f) => f());
let hide: ReturnType<typeof setTimeout> | undefined;

export function showFeedback(f: Omit<Feedback, "id"> | null, ms = 12000) {
  clearTimeout(hide);
  feedback = f && { ...f, id: ++fseq };
  fpublish();
  if (f && !f.pending) hide = setTimeout(() => ((feedback = null), fpublish()), ms);
}

export function useBoardFeedback(): Feedback | null {
  return useSyncExternalStore((f) => (fsubs.add(f), () => void fsubs.delete(f)), () => feedback);
}

const label = (w: Workspace) => w.title || w.name;

/**
 * Move o card (otimista do lado de quem chama) e mostra o resultado: issue atualizada, sem
 * correspondência, erro. `onDone` recarrega a lista.
 */
export async function moveCard(w: Workspace, column: string, onDone: () => void, restore: Snapshot | null = null): Promise<MoveResult | null> {
  if (legacy) {
    await api.updateWorkspace(w.id, { status: column }).finally(onDone);
    return null;
  }
  const linked = !!(w.issue || w.linear);
  const sync = boardFor(cfg, w.repo_id).sync;
  if (linked && sync) showFeedback({ title: label(w), pending: true });
  try {
    const r = await api.boardMove(w.id, column, restore);
    onDone();
    const s = r.sync;
    const undo = restore ? undefined : { workspaceId: w.id, column: r.from_column, restore: s.before };
    if (s.status === "off" || s.status === "no_link") {
      // Sem issue (ou sincronia desligada): só um Desfazer discreto quando veio de um arrastar.
      if (!restore) showFeedback({ title: label(w), pending: false, result: r, undo }, 6000);
      else showFeedback(null);
    } else {
      showFeedback({ title: label(w), pending: false, result: r, undo, retry: s.status === "error" ? w.id : undefined }, s.status === "error" ? 30000 : 12000);
    }
    return r;
  } catch (e) {
    onDone();
    showFeedback({ title: label(w), pending: false, error: String(e) }, 15000);
    return null;
  }
}

export async function retrySync(workspaceId: string, title: string) {
  showFeedback({ title, pending: true });
  try {
    const s: SyncResult = await api.boardSync(workspaceId);
    showFeedback({ title, pending: false, result: { workspace: null as never, from_column: "", sync: s }, retry: s.status === "error" ? workspaceId : undefined });
  } catch (e) {
    showFeedback({ title, pending: false, error: String(e) });
  }
}
