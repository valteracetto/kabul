import { useCallback, useEffect, useRef, useState } from "react";
import { RepoIcon } from "../components/RepoIcon";
import type { Model } from "../api";
import { useDictation } from "../components/useDictation";
import { k, type StartOpts } from "./kabuld";
import { refresh, useKabul } from "./data";
import { openSession } from "./nav";
import { ModelSheet, markOf, useMobileModels, type RunsWhere } from "./ModelSheet";
import { BackButton, Group, I, NavBar, PlanChip, Row, Sheet, haptic } from "./ui";
import { PLAN_NATIVE, planPrefix, defaultPlan, setPlan, type PlanMode } from "./plan";
import { t } from "../i18n";
import { trError } from "../i18n/errors";

const LAST_REPO = "kabul.m.lastRepo";

/** Novo workspace pelo celular: repositório + o que fazer + modelo + onde roda. Cria o worktree e já manda a 1ª mensagem. */
export function NewWorkspace({ onBack }: { onBack: () => void }) {
  const { repos } = useKabul();
  const visible = repos.filter((r) => !r.hidden);
  const [repoId, setRepoId] = useState<string | null>(() => localStorage.getItem(LAST_REPO));
  const repo = visible.find((r) => r.id === repoId) ?? visible[0] ?? null;
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState<null | "repo" | "model" | "options">(null);
  const [where, setWhere] = useState<RunsWhere>("local");
  const [plan, setPlanOn] = useState(false);
  useEffect(() => void defaultPlan().then((d) => d && setPlanOn(true)), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { selected, effort, prefs } = useMobileModels();
  const [model, setModel] = useState<Model | null>(null);
  const [opts, setOpts] = useState<StartOpts>({});
  const m = model ?? selected;
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => void setTimeout(() => ta.current?.focus(), 350), []);
  const dict = useDictation(useCallback((said: string) => setText((x) => (x ? x + " " : "") + said), []), useCallback((e: string) => setErr(e), []));
  const cloud = where === "cloud" && m?.harness === "claude";
  const planMode: PlanMode = plan ? (m && PLAN_NATIVE.has(m.harness) && !cloud ? "native" : "emulated") : null;
  const go = async () => {
    const prompt = text.trim();
    if (!repo || !m || !prompt) return;
    haptic(null, "success");
    setErr(null);
    try {
      setBusy(t("mobile.new.creating"));
      localStorage.setItem(LAST_REPO, repo.id);
      const w = await k.workspaceCreate(repo.id, prompt.split("\n")[0]);
      if (cloud) {
        setBusy(t("mobile.new.openingCloud"));
        const r = await k.cloudStart(w.id, planMode ? planPrefix() + prompt : prompt);
        await refresh();
        return openSession(`tmux:${r.tmux}`, true);
      }
      setBusy(t("mobile.new.startingAgent"));
      const c = await k.chatStart(w.id, m, undefined, { effort, fast: prefs.fast, ...opts, plan: planMode === "native" });
      setPlan(c.id, planMode);
      await k.chatSend(c.id, planMode === "emulated" ? planPrefix() + prompt : prompt);
      void refresh();
      openSession(`chat:${c.id}`, true);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setBusy(null);
    }
  };
  return (
    <div className="m-page" data-testid="m-new-ws">
      <NavBar title={t("mobile.new.title")} left={<BackButton onClick={onBack} />} />
      <main className="m-new-body">
        {busy ? (
          <div className="m-new-busy" data-testid="m-new-busy"><span className="m-spinner" /> {busy}</div>
        ) : (
          <div className="m-new-hint">
            <b>{t("mobile.new.hintTitle")}</b>
            <span>{t("mobile.new.hintSub")}</span>
          </div>
        )}
        {err && <div className="m-error" data-testid="m-new-error">{trError(err)}</div>}
      </main>
      <div className="m-dock">
        <div className={"m-composer big" + (planMode ? " plan" : "")}>
          <button className="m-composer-repo" onClick={(e) => (haptic(e.currentTarget), setSheet("repo"))} data-testid="m-new-repo">
            {repo ? <RepoIcon repo={repo} size={18} /> : null}
            <span className="m-ellipsis">{repo?.name ?? t("mobile.new.pickRepo")}</span>
            <I.updown size={12} />
          </button>
          <textarea ref={ta} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("mobile.new.promptPh")} data-testid="m-new-prompt" enterKeyHint="send" />
          <div className="m-composer-bar">
            <button className="m-composer-icon" onClick={(e) => (haptic(e.currentTarget), setSheet("options"))} aria-label={t("mobile.new.options")} data-testid="m-new-options"><I.plus size={22} /></button>
            {planMode && <PlanChip mode={planMode} onClick={() => setPlanOn(false)} />}
            <span className="grow" />
            <button className="m-model-chip" onClick={(e) => (haptic(e.currentTarget), setSheet("model"))} data-testid="m-new-model">
              {cloud && <I.cloud size={16} />}
              {m && markOf(m)}
              <span className="m-ellipsis">{m?.label ?? t("mobile.new.model")}</span>
            </button>
            <button className={"m-composer-round mic " + dict.state} onClick={dict.toggle} aria-label={t("mobile.session.dictation")} data-testid="m-mic">{dict.state === "listening" ? <I.stop /> : <I.mic />}</button>
            <button className="m-composer-round m-send" disabled={!text.trim() || !repo || !m || !!busy} onClick={go} aria-label={t("mobile.new.create")} data-testid="m-new-go"><I.up /></button>
          </div>
        </div>
      </div>
      {sheet === "repo" && (
        <Sheet title={t("mobile.new.selectRepo")} onClose={() => setSheet(null)} testid="m-repo-sheet">
          <Group footer={visible.length ? undefined : t("mobile.new.addRepos")}>
            {visible.map((r) => (
              <Row key={r.id} icon={<RepoIcon repo={r} size={22} />} title={r.name} sub={r.default_branch} check={r.id === repo?.id} onClick={() => (setRepoId(r.id), setSheet(null))} testid="m-repo" />
            ))}
          </Group>
        </Sheet>
      )}
      {sheet === "model" && <ModelSheet onClose={() => setSheet(null)} onPick={(mm, o) => (setModel(mm), setOpts({ account: o.account }))} current={m?.key} where={where} onWhere={setWhere} />}
      {sheet === "options" && (
        <Sheet title={t("mobile.new.options")} onClose={() => setSheet(null)} testid="m-new-options-sheet">
          <Group footer={m && !PLAN_NATIVE.has(m.harness) ? t("mobile.new.planEmulated", { model: m.label }) : t("mobile.new.planNative")}>
            <Row icon={<I.plan />} title={t("mobile.new.planMode")} toggle={plan} onClick={() => setPlanOn(!plan)} testid="m-new-plan" />
          </Group>
        </Sheet>
      )}
    </div>
  );
}
