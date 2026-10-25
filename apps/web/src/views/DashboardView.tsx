import { useRef, useState } from "react";
import { OverviewTabs } from "./SideNav";
import { api, STATUS_LABEL, wsTitle, type Repo, type Workspace } from "../api";
import { t } from "../i18n";

/** Quadro: workspaces por status (Backlog, Em andamento, Em revisão, Concluído, Cancelado). Arrastar um cartão
 *  para outra coluna muda o status (por ponteiro: o arrastar nativo do HTML é interceptado pelo app). */
export function DashboardView({ workspaces, repos, stats, onOpen, onChange, onError }: {
  workspaces: Workspace[]; repos: Repo[]; stats: Record<string, [number, number]>; onOpen: (id: string) => void; onChange: () => void; onError: (e: string) => void;
}) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const start = useRef<{ id: string; x: number; y: number } | null>(null);
  const live = workspaces.filter((w) => !w.archived);
  const colAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-col]") as HTMLElement | null)?.dataset.col ?? null;
  const down = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    start.current = { id, x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => {
      const s = start.current;
      if (!s) return;
      if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 5 && !drag) return;
      setDrag({ id: s.id, x: ev.clientX, y: ev.clientY, over: colAt(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const s = start.current;
      start.current = null;
      setDrag(null);
      if (!s) return;
      const moved = Math.hypot(ev.clientX - s.x, ev.clientY - s.y) >= 5;
      if (!moved) return onOpen(s.id);
      const col = colAt(ev.clientX, ev.clientY);
      const w = live.find((x) => x.id === s.id);
      if (col && w && w.status !== col) api.updateWorkspace(s.id, { status: col }).then(onChange, (err) => onError(String(err)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <section className="page dashboard" data-testid="dashboard">
      <header className="page-head" data-tauri-drag-region><OverviewTabs on="dashboard" /><span className="dim">{t("app.board.hint")}</span></header>
      <div className="kanban">
        {Object.entries(STATUS_LABEL).map(([k, label]) => {
          const cards = live.filter((w) => (w.status || "in-progress") === k);
          return (
            <div key={k} className={"kb-col" + (drag?.over === k ? " over" : "")} data-col={k} data-testid={`col-${k}`}>
              <div className="kb-head"><span className={"st-icon st-" + k} /> {label} <span className="dim">{cards.length}</span></div>
              {cards.map((w) => {
                const r = repos.find((x) => x.id === w.repo_id);
                const st = stats[w.id];
                return (
                  <div key={w.id} className={"kb-card" + (drag?.id === w.id ? " dragging" : "")} onPointerDown={(e) => down(e, w.id)} data-testid="kb-card">
                    <div className="kb-title">{wsTitle(w)}</div>
                    <div className="dim small">{r?.name} · <span className="mono">{w.branch}</span>{st && (st[0] || st[1]) ? <> · <span className="add">+{st[0]}</span> <span className="del">−{st[1]}</span></> : null}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {drag && <div className="drag-ghost" style={{ left: drag.x + 10, top: drag.y + 6 }}>{wsTitle(live.find((w) => w.id === drag.id)!)}</div>}
    </section>
  );
}
