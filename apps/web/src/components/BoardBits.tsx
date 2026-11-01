import { api, type BoardMoved, type TrackerKind } from "../api";
import { boardFor, columnOf, loadBoard, retrySync, showFeedback, useBoardConfig, useBoardFeedback } from "../board";
import { t } from "../i18n";
import { useEffect } from "react";
import "./Board.css";

const PIE_HALF = "M8 8 L8 4.6 A3.4 3.4 0 0 1 8 11.4 Z";
const PIE_3Q = "M8 8 L8 4.6 A3.4 3.4 0 1 1 4.6 8 Z";

/** Ícone da coluna (o desenho diz o tipo) na cor escolhida; as cores mudam com o tema (`--bc-*`). */
export function ColIcon({ icon, color, size = 14 }: { icon: string; color: string; size?: number }) {
  const filled = icon === "done" || icon === "canceled";
  return (
    <svg className="col-icon" width={size} height={size} viewBox="0 0 16 16" style={{ color: `var(--bc-${color}, var(--bc-gray))` }} aria-hidden data-icon={icon}>
      {icon === "star" ? (
        <path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" fill="currentColor" />
      ) : (
        <>
          <circle cx="8" cy="8" r="6.2" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeDasharray={icon === "backlog" ? "2.4 2" : undefined} />
          {icon === "progress" && <path d={PIE_HALF} fill="currentColor" />}
          {icon === "review" && <path d={PIE_3Q} fill="currentColor" />}
          {icon === "done" && <path d="M5.2 8.2l1.9 1.9 3.7-3.9" fill="none" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
          {icon === "canceled" && <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />}
          {icon === "blocked" && <path d="M8 4.8v3.8M8 10.9v.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

export const trackerName = (k: TrackerKind | null | undefined) => (k === "github" ? "GitHub" : k === "linear" ? "Linear" : "");

/**
 * Aviso do Quadro (embaixo, no centro): resultado de mover um card (issue atualizada, sem
 * correspondência, erro), com Desfazer e Tentar de novo; e cards movidos porque a issue mudou lá.
 */
export function BoardFeedback({ onChange }: { onChange: () => void }) {
  const f = useBoardFeedback();
  const cfg = useBoardConfig();
  // Outro processo gravou o estado (kabuld, CLI, outro aparelho): relê as colunas.
  useEffect(() => api.onWorkspaceState((p) => void (p.state === "changed" && loadBoard(true))), []);
  // Eventos do Kabul e polling: o card andou sozinho.
  useEffect(
    () =>
      api.onBoardMoved((p) => {
        onChange();
        if (p.source === "poll" && p.moved?.length) {
          const m: BoardMoved = p.moved[0];
          const extra = p.moved.length > 1 ? ` ${t("app.board.fb.more", { count: p.moved.length - 1 })}` : "";
          showFeedback({ title: m.issue, pending: false, note: t("app.board.fb.remote", { issue: m.issue, state: m.state, tracker: trackerName(m.tracker) }) + extra });
        } else if (p.source === "event" && p.result && !["off", "no_link", "unchanged"].includes(p.result.sync.status)) {
          showFeedback({ title: p.result.workspace.title || p.result.workspace.name, pending: false, result: p.result, retry: p.result.sync.status === "error" ? p.result.workspace.id : undefined });
        }
      }),
    [onChange],
  );
  if (!f) return null;
  const r = f.result;
  const s = r?.sync;
  const tracker = trackerName(s?.tracker);
  let text: string;
  let tone = "";
  if (f.pending) text = t("app.board.fb.pending", { title: f.title });
  else if (f.note) text = f.note;
  else if (f.error) (text = t("app.board.fb.failed", { error: f.error })), (tone = " err");
  else if (!s) text = f.title;
  else {
    const col = r?.workspace ? columnOf(boardFor(cfg, r.workspace.repo_id), r.workspace.status).name : "";
    switch (s.status) {
      case "ok": text = t("app.board.fb.ok", { issue: s.issue ?? "", state: s.to?.name ?? "", tracker }) + (s.project ? ` · ${s.project}` : ""); break;
      case "unchanged": text = t("app.board.fb.unchanged", { issue: s.issue ?? "", state: s.to?.name ?? "", tracker }); break;
      case "no_match": (text = t("app.board.fb.noMatch", { issue: s.issue ?? "", column: col, tracker })), (tone = " warn"); break;
      case "not_connected": (text = t("app.board.fb.notConnected", { issue: s.issue ?? "", tracker })), (tone = " warn"); break;
      case "error": (text = t("app.board.fb.error", { issue: s.issue ?? "", tracker, error: s.error ?? "" })), (tone = " err"); break;
      default: text = t("app.board.fb.moved", { title: f.title, column: col });
    }
  }
  const undo = f.undo;
  return (
    <div className={"board-fb" + tone} role={tone === " err" ? "alert" : "status"} data-testid="board-feedback" data-status={f.pending ? "pending" : (s?.status ?? (f.error ? "error" : "note"))}>
      {f.pending && <span className="spinner tiny" />}
      <span className="board-fb-text">{text}</span>
      {f.retry && <button className="text-btn" onClick={() => void retrySync(f.retry!, f.title)} data-testid="board-retry">{t("common.retry")}</button>}
      {undo && (
        <button className="text-btn" data-testid="board-undo" onClick={() => {
          showFeedback(null);
          void api.boardMove(undo.workspaceId, undo.column, undo.restore).then(
            (u) => (onChange(), (u.sync.status === "error" || u.sync.status === "not_connected") && showFeedback({ title: f.title, pending: false, result: u })),
            (e) => (onChange(), showFeedback({ title: f.title, pending: false, error: String(e) })),
          );
        }}>{t("common.undo")}</button>
      )}
      {!f.pending && <button className="icon-btn board-fb-x" onClick={() => showFeedback(null)} aria-label={t("common.close")}>×</button>}
    </div>
  );
}
