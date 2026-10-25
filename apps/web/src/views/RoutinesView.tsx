import { useEffect, useState } from "react";
import { wsTitle, type Workspace } from "../api";
import { t } from "../i18n";
import { fmtDate } from "../i18n/format";
import { cronError, describe, loadRoutines, nextRuns, parseCron, PR_EVENTS, saveRoutines, type Routine, type Trigger } from "../components/routines";

const newId = () => `rt-${Date.now().toString(36)}`;
const fmt = (d: Date | number) => fmtDate(d, "dayMonthTime");

/** Rotinas locais: lista à esquerda; editor (65%) e execuções (35%) à direita. ⌘S salva. */
export function RoutinesView({ workspaces, onRun }: { workspaces: Workspace[]; onRun: (r: Routine, why: string) => void }) {
  const [list, setList] = useState<Routine[]>(loadRoutines);
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const live = workspaces.filter((w) => !w.archived);
  const cur = list.find((r) => r.id === sel) ?? null;
  const [draft, setDraft] = useState<Routine | null>(cur);
  useEffect(() => setDraft(cur), [sel]);
  useEffect(() => {
    const h = () => setList(loadRoutines());
    window.addEventListener("kabul:routines", h);
    return () => window.removeEventListener("kabul:routines", h);
  }, []);
  const err = draft ? (!draft.name.trim() ? t("app.routine.needName") : !draft.workspace ? t("app.routine.needWorkspace") : !draft.prompt.trim() ? t("app.routine.needPrompt") : draft.trigger.kind === "cron" ? cronError(draft.trigger.cron) : null) : null;
  const save = () => {
    if (!draft || err) return;
    const next = list.some((r) => r.id === draft.id) ? list.map((r) => (r.id === draft.id ? { ...draft, runs: r.runs } : r)) : [...list, draft];
    saveRoutines(next);
    setList(next);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.metaKey && e.key.toLowerCase() === "s" && (e.preventDefault(), save());
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const create = () => {
    const r: Routine = { id: newId(), name: t("app.routine.new"), workspace: live[0]?.id ?? "", prompt: "", trigger: { kind: "cron", cron: "0 9 * * 1-5" }, enabled: true, runs: [] };
    setList((l) => [...l, r]);
    setSel(r.id);
    setDraft(r);
  };
  const remove = () => {
    if (!draft) return;
    const next = list.filter((r) => r.id !== draft.id);
    saveRoutines(next);
    setList(next);
    setSel(next[0]?.id ?? null);
  };
  const set = (p: Partial<Routine>) => draft && setDraft({ ...draft, ...p });
  const setTrigger = (tr: Trigger) => set({ trigger: tr });
  const cron = draft?.trigger.kind === "cron" ? parseCron(draft.trigger.cron) : null;
  const saved = list.find((r) => r.id === draft?.id);
  return (
    <section className="page routines" data-testid="routines">
      <header className="page-head" data-tauri-drag-region><h2>{t("app.routine.title")}</h2><span className="dim">{t("app.routine.lead")}</span><span className="grow" /><button className="btn primary" onClick={create} data-testid="routine-new">{t("app.routine.new")}</button></header>
      <div className="rt-layout">
        <div className="rt-list">
          {list.length === 0 && <div className="dim small">{t("app.routine.empty")}</div>}
          {list.map((r) => (
            <div key={r.id} className={"pop-row" + (r.id === sel ? " on" : "")} onClick={() => setSel(r.id)} data-testid="routine-row">
              <span className={"dot " + (r.enabled ? "st-in-review" : "st-canceled")} />
              <span className="grow">{r.name}<div className="dim small">{describe(r.trigger)}</div></span>
            </div>
          ))}
        </div>
        {draft && (
          <div className="rt-edit">
            <div className="set-group">
              <label className="set-row"><span>{t("app.routine.name")}</span><input value={draft.name} onChange={(e) => set({ name: e.target.value })} data-testid="routine-name" /></label>
              <label className="set-row"><span>{t("app.routine.workspace")}</span>
                <select value={draft.workspace} onChange={(e) => set({ workspace: e.target.value })} data-testid="routine-ws">
                  <option value="">—</option>
                  {live.map((w) => <option key={w.id} value={w.id}>{wsTitle(w)}</option>)}
                </select>
              </label>
              <label className="set-col"><span>{t("app.routine.prompt")}</span><textarea rows={5} value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder={t("app.routine.promptPlaceholder")} data-testid="routine-prompt" /></label>
              <div className="set-row"><span>{t("app.routine.trigger")}</span>
                <select value={draft.trigger.kind === "cron" ? "cron" : draft.trigger.event} onChange={(e) => setTrigger(e.target.value === "cron" ? { kind: "cron", cron: "0 9 * * 1-5" } : { kind: "pr", event: e.target.value as "checks_failed" })} data-testid="routine-trigger">
                  <option value="cron">{t("app.routine.triggerCron")}</option>
                  {Object.entries(PR_EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {draft.trigger.kind === "cron" && (
                <label className="set-col"><span>{"Cron" /* i18n-ignore */} <span className="dim small">{t("app.routine.cronHint")}</span></span>
                  <input className="mono" value={draft.trigger.cron} onChange={(e) => setTrigger({ kind: "cron", cron: e.target.value })} data-testid="routine-cron" />
                  {cron && !err && <span className="dim small" data-testid="routine-next">{t("app.routine.next", { list: nextRuns(cron, new Date()).map(fmt).join(" · ") })}</span>}
                </label>
              )}
              <label className="check-row"><input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="routine-enabled" /> {t("app.routine.enabled")}</label>
              {err && <div className="error small" data-testid="routine-error">{err}</div>}
              <div className="row">
                <button className="btn primary" disabled={!!err} onClick={save} data-testid="routine-save">{t("common.save")} <kbd>⌘S</kbd></button>
                <button className="btn" disabled={!saved || !!err} onClick={() => saved && onRun(saved, t("app.routine.why.manual"))} data-testid="routine-run">{t("app.routine.runNow")}</button>
                <span className="grow" />
                <button className="btn danger" onClick={remove}>{t("common.delete")}</button>
              </div>
            </div>
            <div className="rt-runs">
              <div className="pop-title">{t("app.routine.runs")}</div>
              {(saved?.runs ?? []).length === 0 && <div className="dim small">{t("app.routine.neverRan")}</div>}
              {[...(saved?.runs ?? [])].reverse().slice(0, 30).map((r, i) => <div key={i} className="small" data-testid="routine-runrow">{fmt(r.at)} · {r.why}</div>)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
