import { useEffect, useState } from "react";
import { wsTitle, type Workspace } from "../api";
import { cronError, describe, loadRoutines, nextRuns, parseCron, PR_EVENTS, saveRoutines, type Routine, type Trigger } from "../components/routines";

const newId = () => `rt-${Date.now().toString(36)}`;
const fmt = (d: Date | number) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
  const err = draft ? (!draft.name.trim() ? "Dê um nome" : !draft.workspace ? "Escolha o workspace" : !draft.prompt.trim() ? "Escreva o prompt" : draft.trigger.kind === "cron" ? cronError(draft.trigger.cron) : null) : null;
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
    const r: Routine = { id: newId(), name: "Nova rotina", workspace: live[0]?.id ?? "", prompt: "", trigger: { kind: "cron", cron: "0 9 * * 1-5" }, enabled: true, runs: [] };
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
  const setTrigger = (t: Trigger) => set({ trigger: t });
  const cron = draft?.trigger.kind === "cron" ? parseCron(draft.trigger.cron) : null;
  const saved = list.find((r) => r.id === draft?.id);
  return (
    <section className="page routines" data-testid="routines">
      <header className="page-head" data-tauri-drag-region><h2>Rotinas</h2><span className="dim">rodam neste computador enquanto o Kabul está aberto</span><span className="grow" /><button className="btn primary" onClick={create} data-testid="routine-new">Nova rotina</button></header>
      <div className="rt-layout">
        <div className="rt-list">
          {list.length === 0 && <div className="dim small">Nenhuma rotina. Ex.: "todo dia útil às 9h, revise os PRs abertos" ou "quando os checks falharem, corrija".</div>}
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
              <label className="set-row"><span>Nome</span><input value={draft.name} onChange={(e) => set({ name: e.target.value })} data-testid="routine-name" /></label>
              <label className="set-row"><span>Workspace</span>
                <select value={draft.workspace} onChange={(e) => set({ workspace: e.target.value })} data-testid="routine-ws">
                  <option value="">—</option>
                  {live.map((w) => <option key={w.id} value={w.id}>{wsTitle(w)}</option>)}
                </select>
              </label>
              <label className="set-col"><span>Prompt</span><textarea rows={5} value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder="O que o agente deve fazer" data-testid="routine-prompt" /></label>
              <div className="set-row"><span>Gatilho</span>
                <select value={draft.trigger.kind === "cron" ? "cron" : draft.trigger.event} onChange={(e) => setTrigger(e.target.value === "cron" ? { kind: "cron", cron: "0 9 * * 1-5" } : { kind: "pr", event: e.target.value as "checks_failed" })} data-testid="routine-trigger">
                  <option value="cron">Horário (cron)</option>
                  {Object.entries(PR_EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {draft.trigger.kind === "cron" && (
                <label className="set-col"><span>Cron <span className="dim small">minuto hora dia mês dia-da-semana · mínimo 15 min</span></span>
                  <input className="mono" value={draft.trigger.cron} onChange={(e) => setTrigger({ kind: "cron", cron: e.target.value })} data-testid="routine-cron" />
                  {cron && !err && <span className="dim small" data-testid="routine-next">Próximas: {nextRuns(cron, new Date()).map(fmt).join(" · ")}</span>}
                </label>
              )}
              <label className="check-row"><input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="routine-enabled" /> Ativa</label>
              {err && <div className="error small" data-testid="routine-error">{err}</div>}
              <div className="row">
                <button className="btn primary" disabled={!!err} onClick={save} data-testid="routine-save">Salvar <kbd>⌘S</kbd></button>
                <button className="btn" disabled={!saved || !!err} onClick={() => saved && onRun(saved, "manual")} data-testid="routine-run">Rodar agora</button>
                <span className="grow" />
                <button className="btn danger" onClick={remove}>Apagar</button>
              </div>
            </div>
            <div className="rt-runs">
              <div className="pop-title">Execuções</div>
              {(saved?.runs ?? []).length === 0 && <div className="dim small">Ainda não rodou.</div>}
              {[...(saved?.runs ?? [])].reverse().slice(0, 30).map((r, i) => <div key={i} className="small" data-testid="routine-runrow">{fmt(r.at)} · {r.why}</div>)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
