import { useCallback, useEffect, useRef, useState } from "react";
import { api, type GitStatus, type Outcome, type PrCheck, type PrInfo, type Prompts, type Repo, type Workspace } from "../api";

/** Prompts padrão das ações que vão para o agente (Configurações › Actions acrescenta instruções). */
export const DEFAULT_PROMPTS: Record<keyof Prompts | "commit", string> = {
  general: "",
  commit: "Faça commit de todas as mudanças (mensagem curta e clara) e dê push da branch: git push -u origin HEAD.",
  review: "Revise as mudanças deste workspace contra {target} (git diff origin/{target}...). Aponte bugs, riscos e o que falta testar, por arquivo.",
  create_pr: "Crie um pull request para {target}: faça commit do que faltar, git push -u origin HEAD, revise o diff e rode gh pr create com título curto (até 80 caracteres) e descrição do que mudou e de como testar.",
  fix_errors: "Os checks do PR falharam. Descubra a causa, corrija, rode os testes localmente e dê push.\n\nChecks falhando:\n{checks}",
  resolve_conflicts: "A branch tem conflitos com {target}. Faça git fetch, junte origin/{target} na branch (merge), resolva os conflitos preservando as duas intenções, rode os testes e dê push.\n\nArquivos em conflito:\n{files}",
  branch_rename: "",
};

export const PROMPT_LABEL: [keyof Prompts, string, string][] = [
  ["review", "Revisão de código", "Botão Revisar (⌘⇧R)"],
  ["create_pr", "Criar PR", "Criar PR pelo agente"],
  ["fix_errors", "Corrigir erros", "Corrigir erros (⌘⇧X), com os checks que falharam"],
  ["resolve_conflicts", "Resolver conflitos", "Resolver conflitos com a branch alvo"],
  ["branch_rename", "Renomear branch", "Instruções ao nomear a branch a partir da primeira mensagem"],
  ["general", "Preferências gerais", "Acrescentadas a todas as ações acima"],
];

/** Monta o prompt: padrão + instruções extras do repo + preferências gerais, com {target}, {checks}, {files}. */
export function buildPrompt(kind: keyof typeof DEFAULT_PROMPTS, extra: Prompts | null, vars: Record<string, string>): string {
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const parts = [fill(DEFAULT_PROMPTS[kind])];
  const custom = kind !== "commit" && kind !== "general" ? extra?.[kind as keyof Prompts] : null;
  if (custom?.trim()) parts.push(`Instruções do repositório:\n${fill(custom.trim())}`);
  if (extra?.general?.trim()) parts.push(`Preferências gerais:\n${extra.general.trim()}`);
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

export const ACTION_LABEL: Record<GitActionId, [string, string]> = {
  commit: ["Commit e push", "⌘⇧Y"],
  pull: ["Pull", "⌘⇧L"],
  push: ["Push", ""],
  "create-pr": ["Criar PR", "⌘⇧P"],
  "create-pr-agent": ["Criar PR pelo agente", ""],
  merge: ["Merge", "⌘⇧M"],
  ready: ["Pronto para revisão", ""],
  fix: ["Corrigir erros", "⌘⇧X"],
  conflicts: ["Resolver conflitos", ""],
  "open-pr": ["Abrir PR", "⌘⇧G"],
  review: ["Revisar", "⌘⇧R"],
  archive: ["Arquivar", "⌘⇧A"],
  comments: ["Adicionar comentários ao chat", ""],
};
