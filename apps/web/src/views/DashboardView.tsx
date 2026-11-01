import { useRef, useState } from "react";
import { OverviewTabs } from "./SideNav";
import { BoardSettings } from "./BoardSettings";
import { api, wsTitle, type Repo, type Workspace } from "../api";
import { boardFor, columnOf, isLegacyBoard, moveCard, useBoardConfig } from "../board";
import { ColIcon, trackerName } from "../components/BoardBits";
import { useLocalPref } from "./settingsUi";
import { usePopover } from "../components/useDismiss";
import { noSuggest } from "../noSuggest";
import { t } from "../i18n";
import { IGear, ILink } from "../icons";

/** Quadro: workspaces por coluna (configuráveis na engrenagem; globais ou por repositório). Arrastar um
 *  cartão para outra coluna muda o status e, com a sincronia ligada, o status da issue vinculada (por
 *  ponteiro: o arrastar nativo do HTML é interceptado pelo app). */
export function DashboardView({ workspaces, repos, stats, onOpen, onChange, onError }: {
  workspaces: Workspace[]; repos: Repo[]; stats: Record<string, [number, number]>; onOpen: (id: string) => void; onChange: () => void; onError: (e: string) => void;
}) {
  const cfg = useBoardConfig();
  const [scope, setScope] = useLocalPref<string>("kabul.board.repo", "");
  const repoId = scope && repos.some((r) => r.id === scope) ? scope : null;
  const board = boardFor(cfg, repoId);
  const gear = usePopover<HTMLSpanElement>();
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: string | null } | null>(null);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<{ id: string; text: string } | null>(null);
  const start = useRef<{ id: string; x: number; y: number } | null>(null);
  const live = workspaces.filter((w) => !w.archived && (!repoId || w.repo_id === repoId));
  // Status mostrado: o otimista (arrastou agora) até a lista recarregar.
  const statusOf = (w: Workspace) => moved[w.id] ?? w.status ?? "in-progress";
  const colAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-col]") as HTMLElement | null)?.dataset.col ?? null;
  const reload = () => (setMoved({}), onChange());
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
      const didMove = Math.hypot(ev.clientX - s.x, ev.clientY - s.y) >= 5;
      if (!didMove) return onOpen(s.id);
      const col = colAt(ev.clientX, ev.clientY);
      const w = live.find((x) => x.id === s.id);
      if (!col || !w) return;
      // Card de repo com quadro próprio solto no quadro global: vai para a coluna dele com o mesmo id/nome.
      const own = boardFor(cfg, w.repo_id);
      const target = own === board || own.columns.some((c) => c.id === col) ? col : columnOf(own, board.columns.find((c) => c.id === col)?.name ?? col).id;
      if (target === columnOf(boardFor(cfg, w.repo_id), statusOf(w)).id) return;
      setMoved((m) => ({ ...m, [w.id]: target }));
      void moveCard(w, target, reload);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const link = (w: Workspace, text: string) =>
    api.workspaceLinkIssue(w.id, text).then(() => (setLinking(null), onChange()), (e) => onError(String(e)));
  // Card no quadro global vindo de um repo com colunas próprias: cai na coluna de mesmo id ou nome.
  const colIdOf = (w: Workspace) => {
    const own = boardFor(cfg, w.repo_id);
    const c = columnOf(own, statusOf(w));
    return own === board ? c.id : (board.columns.find((x) => x.id === c.id) ?? columnOf(board, c.name)).id;
  };
  return (
    <section className="page dashboard" data-testid="dashboard">
      <header className="page-head" data-tauri-drag-region>
        <OverviewTabs on="dashboard" />
        <span className="dim">{t("app.board.hint")}</span>
        <span className="grow" />
        <select className="board-repo" value={repoId ?? ""} onChange={(e) => setScope(e.target.value)} aria-label={t("app.board.repoFilter")} data-testid="board-repo">
          <option value="">{t("app.board.allRepos")}</option>
          {repos.filter((r) => !r.hidden).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {!isLegacyBoard() && cfg && (
          <span className="board-gear" ref={gear.ref}>
            <button className={"icon-btn" + (gear.open ? " on" : "")} onClick={gear.toggle} title={t("app.board.settings")} aria-label={t("app.board.settings")} data-testid="board-settings"><IGear size={15} /></button>
            {gear.open && <BoardSettings cfg={cfg} repoId={repoId} repos={repos} workspaces={workspaces} onError={onError} onChange={onChange} />}
          </span>
        )}
      </header>
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${board.columns.length}, minmax(200px, 1fr))` }}>
        {board.columns.map((c) => {
          const cards = live.filter((w) => colIdOf(w) === c.id);
          return (
            <div key={c.id} className={"kb-col" + (drag?.over === c.id ? " over" : "")} data-col={c.id} data-testid={`col-${c.id}`} style={{ ["--col" as string]: `var(--bc-${c.color})` }}>
              <div className="kb-head"><ColIcon icon={c.icon} color={c.color} /> <span className="kb-name">{c.name}</span> <span className="dim">{cards.length}</span></div>
              {cards.map((w) => {
                const r = repos.find((x) => x.id === w.repo_id);
                const st = stats[w.id];
                const issue = w.issue ?? (w.linear ? { tracker: "linear" as const, identifier: w.linear.identifier, url: w.linear.url, state: null } : null);
                return (
                  <div key={w.id} className={"kb-card" + (drag?.id === w.id ? " dragging" : "")} onPointerDown={(e) => down(e, w.id)} data-testid="kb-card" data-ws={w.id}>
                    <div className="kb-title">{wsTitle(w)}</div>
                    <div className="dim small">{r?.name} · <span className="mono">{w.branch}</span>{st && (st[0] || st[1]) ? <> · <span className="add">+{st[0]}</span> <span className="del">−{st[1]}</span></> : null}</div>
                    <div className="kb-foot">
                      {issue && (
                        <button className="kb-issue" onPointerDown={(e) => e.stopPropagation()} onClick={() => issue.url && api.openExternal(issue.url)} title={trackerName(issue.tracker)} data-testid="kb-issue">
                          {issue.identifier}{issue.state ? <span className="dim"> · {issue.state.name}</span> : null}
                        </button>
                      )}
                      <span className="grow" />
                      {!isLegacyBoard() && (
                        <button className="icon-btn kb-link" onPointerDown={(e) => e.stopPropagation()} onClick={() => setLinking({ id: w.id, text: "" })} title={issue ? t("app.board.link.change") : t("app.board.link.title")} aria-label={issue ? t("app.board.link.change") : t("app.board.link.title")} data-testid="kb-link"><ILink size={12} /></button>
                      )}
                    </div>
                    {linking?.id === w.id && (
                      <div className="kb-link-edit" onPointerDown={(e) => e.stopPropagation()}>
                        <input autoFocus value={linking.text} {...noSuggest} placeholder={t("app.board.link.placeholder")} onChange={(e) => setLinking({ id: w.id, text: e.target.value })}
                          onKeyDown={(e) => (e.key === "Enter" && linking.text.trim() ? void link(w, linking.text) : e.key === "Escape" && setLinking(null))} data-testid="kb-link-input" />
                        <div className="row">
                          <button className="btn small primary" disabled={!linking.text.trim()} onClick={() => void link(w, linking.text)} data-testid="kb-link-ok">{t("app.board.link.ok")}</button>
                          {issue && <button className="btn small" onClick={() => void link(w, "")} data-testid="kb-unlink">{t("app.board.link.unlink")}</button>}
                          <button className="btn small" onClick={() => setLinking(null)}>{t("common.cancel")}</button>
                        </div>
                      </div>
                    )}
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
