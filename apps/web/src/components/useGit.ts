import { useCallback, useEffect, useRef, useState } from "react";
import { t, lazyRecord } from "../i18n";
import { api, type GitStatus, type Outcome, type PrCheck, type PrInfo, type Prompts, type Repo, type Workspace } from "../api";

/** Prompts padrão das ações que vão para o agente (Configurações › Actions acrescenta instruções), no idioma da interface.
 *  Getters: o texto é lido na hora (`{target}`, `{checks}` e `{files}` são trocados em buildPrompt). */
export const DEFAULT_PROMPTS: Record<keyof Prompts | "commit", string> = {
  general: "",
  get commit() { return t("code.prompt.commit"); },
  get review() { return t("code.prompt.review"); },
  get create_pr() { return t("code.prompt.create_pr"); },
  get fix_errors() { return t("code.prompt.fix_errors"); },
  get resolve_conflicts() { return t("code.prompt.resolve_conflicts"); },
  branch_rename: "",
};

/** Rótulo e dica de cada prompt (Configurações › Ações). */
export const promptLabels = (): [keyof Prompts, string, string][] => [
  ["review", t("code.promptLabel.review"), t("code.promptLabel.review.hint")],
  ["create_pr", t("code.promptLabel.create_pr"), t("code.promptLabel.create_pr.hint")],
  ["fix_errors", t("code.promptLabel.fix_errors"), t("code.promptLabel.fix_errors.hint")],
  ["resolve_conflicts", t("code.promptLabel.resolve_conflicts"), t("code.promptLabel.resolve_conflicts.hint")],
  ["branch_rename", t("code.promptLabel.branch_rename"), t("code.promptLabel.branch_rename.hint")],
  ["general", t("code.promptLabel.general"), t("code.promptLabel.general.hint")],
];

/** Monta o prompt: padrão + instruções extras do repo + preferências gerais, com {target}, {checks}, {files}. */
export function buildPrompt(kind: keyof typeof DEFAULT_PROMPTS, extra: Prompts | null, vars: Record<string, string>): string {
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const parts = [fill(DEFAULT_PROMPTS[kind])];
  const custom = kind !== "commit" && kind !== "general" ? extra?.[kind as keyof Prompts] : null;
  if (custom?.trim()) parts.push(`${t("code.prompt.repoInstructions")}\n${fill(custom.trim())}`);
  if (extra?.general?.trim()) parts.push(`${t("code.prompt.generalPrefs")}\n${extra.general.trim()}`);
  return parts.filter(Boolean).join("\n\n");
}

export type GitActionId = "commit" | "pull" | "push" | "create-pr" | "create-pr-agent" | "merge" | "ready" | "fix" | "conflicts" | "open-pr" | "review" | "archive" | "comments";

export interface GitState {
  status: GitStatus | null;
  pr: PrInfo | null;
  checks: PrCheck[];
  prompts: Prompts | null;
  busy: GitActionId | null;
  result: (Outcome & { label: string }) | null;
  refresh: () => void;
  setResult: (r: (Outcome & { label: string }) | null) => void;
  setBusy: (b: GitActionId | null) => void;
}

/** Estado de git/PR do workspace: status local a cada 8 s, PR e checks a cada 30 s (só com o workspace ativo). */
export function useGit(ws: Workspace, repo: Repo, active: boolean): GitState {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [pr, setPr] = useState<PrInfo | null>(null);
  const [checks, setChecks] = useState<PrCheck[]>([]);
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [busy, setBusy] = useState<GitActionId | null>(null);
  const [result, setResult] = useState<(Outcome & { label: string }) | null>(null);
  const alive = useRef(true);
  const loadLocal = useCallback(() => void api.gitStatus(ws.id).then((s) => alive.current && setStatus(s), () => {}), [ws.id]);
  const loadRemote = useCallback(() => {
    api.prView(ws.id).then((p) => {
      if (!alive.current) return;
      setPr(p);
      if (p) api.prChecks(ws.id).then((c) => alive.current && setChecks(c.checks), () => {});
      else setChecks([]);
    }, () => {});
  }, [ws.id]);
  const refresh = useCallback(() => (loadLocal(), loadRemote()), [loadLocal, loadRemote]);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  // Prompts do repo (Configurações › Ações): relidos ao voltar para o workspace.
  useEffect(() => void (active && api.repoSettings(repo.id).then((r) => setPrompts(r.settings.prompts ?? null), () => {})), [repo.id, active]);
  useEffect(() => {
    if (!active) return;
    loadLocal();
    loadRemote();
    const a = setInterval(loadLocal, 8000);
    const b = setInterval(loadRemote, 30000);
    const h = () => refresh();
    window.addEventListener("kabul:git-refresh", h);
    return () => (clearInterval(a), clearInterval(b), window.removeEventListener("kabul:git-refresh", h));
  }, [active, loadLocal, loadRemote, refresh]);
  return { status, pr, checks, prompts, busy, result, refresh, setResult, setBusy };
}

export const failing = (c: PrCheck[]) => c.filter((x) => x.bucket === "fail");

/** Ação principal do botão de git, pela ordem do que bloqueia o PR. */
export function primaryAction(g: Pick<GitState, "status" | "pr" | "checks">): GitActionId {
  const { status: s, pr } = g;
  if (pr?.state === "MERGED") return "archive";
  if (s?.conflicts.length || pr?.mergeable === "CONFLICTING") return "conflicts";
  if (!pr || pr.state === "CLOSED") return "create-pr";
  if ((s?.dirty ?? 0) > 0) return "commit";
  if (s?.behind) return "pull";
  if (s?.ahead) return "push";
  if (failing(g.checks).length) return "fix";
  if (pr.is_draft) return "ready";
  return "merge";
}

export const ACTION_LABEL: Record<GitActionId, [string, string]> = lazyRecord(() => ({
  commit: [t("code.action.commit"), "⌘⇧Y"],
  pull: [t("code.action.pull"), "⌘⇧L"],
  push: [t("code.action.push"), ""],
  "create-pr": [t("code.action.create-pr"), "⌘⇧P"],
  "create-pr-agent": [t("code.action.create-pr-agent"), ""],
  merge: [t("code.action.merge"), "⌘⇧M"],
  ready: [t("code.action.ready"), ""],
  fix: [t("code.action.fix"), "⌘⇧X"],
  conflicts: [t("code.action.conflicts"), ""],
  "open-pr": [t("code.action.open-pr"), "⌘⇧G"],
  review: [t("code.action.review"), "⌘⇧R"],
  archive: [t("code.action.archive"), "⌘⇧A"],
  comments: [t("code.action.comments"), ""],
}));
