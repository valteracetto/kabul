import type { HarnessKind, Model, Workspace } from "../api";

/** Nome do agente (processo/CLI) → harness do Kabul que retoma a sessão. */
export const HARNESS_OF: Record<string, HarnessKind> = { claude: "claude", codex: "codex", agy: "antigravity", opencode: "opencode", gemini: "gemini", qwen: "qwen", goose: "goose", "cursor-agent": "cursor" };

/** Workspace do Kabul na mesma pasta (o Claude só retoma a sessão na pasta onde ela nasceu). */
export function workspaceFor(cwd: string | null, wss: Workspace[]): Workspace | null {
  if (!cwd) return null;
  return wss.filter((w) => cwd === w.path || cwd.startsWith(w.path + "/")).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

export const modelFor = (agent: string, models: Model[]) => models.find((m) => m.harness === HARNESS_OF[agent] && !m.local) ?? null;

/** "há 3 min", "há 2 h", "há 4 d". */
export function ago(secs: number) {
  if (secs < 60) return `${Math.max(1, Math.round(secs))} s`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  if (secs < 86400) return `${Math.round(secs / 3600)} h`;
  return `${Math.round(secs / 86400)} d`;
}
