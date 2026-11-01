import { useEffect, useRef, useState } from "react";
import { api, type Board, type BoardColumn, type BoardConfig, type BoardPreviews, type Override, type Repo, type Workspace } from "../api";
import { COLORS, ICONS, boardFor, setBoardConfig } from "../board";
import { ColIcon } from "../components/BoardBits";
import { Floating } from "../components/Floating";
import { noSuggest } from "../noSuggest";
import { usePopover } from "../components/useDismiss";
import { t } from "../i18n";
import { IArrowUp, IDrag, IPlus, ITrash } from "../icons";

const AUTO: Override = { mode: "auto" };
const newId = () => `c-${Math.random().toString(36).slice(2, 8)}`;
const ovValue = (o: Override) => (o.mode === "state" ? `state:${o.value}` : o.mode);
const ovParse = (v: string): Override => (v.startsWith("state:") ? { mode: "state", value: v.slice(6) } : v === "off" ? { mode: "off" } : AUTO);

function Switch({ on, set, label, testid }: { on: boolean; set: (v: boolean) => void; label: string; testid: string }) {
  return (
    <span className={"toggle" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={label} tabIndex={0} data-testid={testid}
      onClick={() => set(!on)} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), set(!on))}><span /></span>
  );
}

/** Ícone e cor da coluna (fecha ao escolher a cor, com Esc ou clicando fora). */
function IconPicker({ c, set }: { c: BoardColumn; set: (p: Partial<BoardColumn>) => void }) {
  const pop = usePopover<HTMLSpanElement>();
  return (
    <span className="bc-ico-wrap" ref={pop.ref}>
      <button className={"icon-btn bc-ico" + (pop.open ? " on" : "")} onClick={pop.toggle} title={t("app.board.cfg.iconColor")} aria-label={t("app.board.cfg.iconColor")} data-testid="board-col-icon"><ColIcon icon={c.icon} color={c.color} /></button>
      {pop.open && (
        <Floating className="popover bc-picker" placement="bottom-start" testid="board-icon-picker">
          <div className="bc-grid">{ICONS.map((ic) => <button key={ic} className={"icon-btn" + (ic === c.icon ? " on" : "")} onClick={() => set({ icon: ic })} data-testid={`board-icon-${ic}`} title={t(`app.board.icon.${ic}` as never)} aria-label={t(`app.board.icon.${ic}` as never)}><ColIcon icon={ic} color={c.color} /></button>)}</div>
          <div className="bc-grid">{COLORS.map((co) => <button key={co} className={"bc-swatch" + (co === c.color ? " on" : "")} style={{ background: `var(--bc-${co})` }} onClick={() => (set({ color: co }), pop.close())} data-testid={`board-color-${co}`} title={t(`app.board.color.${co}` as never)} aria-label={t(`app.board.color.${co}` as never)} />)}</div>
        </Floating>
      )}
    </span>
  );
}

/**
 * Popover da engrenagem do Quadro: sincronia com a issue, status editáveis (ícone, cor, nome, ordem,
 * apagar) com a correspondência em cada rastreador e o "mover sozinho". Cada mudança grava na hora.
 * `repoId`: o quadro do repositório filtrado (com "Colunas próprias" desligado, herda o global). Quem
 * abre cuida de fechar (`usePopover` no botão: o portal conta como dentro).
 */
export function BoardSettings({ cfg, repoId, repos, workspaces, onError, onChange }: {
  cfg: BoardConfig; repoId: string | null; repos: Repo[]; workspaces: Workspace[]; onError: (e: string) => void; onChange: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const own = !repoId || !!cfg.repos[repoId];
  const board = boardFor(cfg, repoId);
  const [names, setNames] = useState<Record<string, string>>({});
  const [mapOpen, setMapOpen] = useState<string | null>(null);
  const [del, setDel] = useState<{ id: string; to: string } | null>(null);
  const [preview, setPreview] = useState<BoardPreviews | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const focusNew = useRef<string | null>(null);
  const repo = repos.find((r) => r.id === repoId);

  const previewKey = JSON.stringify(board.columns.map((c) => [c.id, c.name, c.icon, c.map]));
  useEffect(() => {
    let live = true;
    api.boardPreview(repoId).then((p) => live && setPreview(p), () => live && setPreview(null));
    return () => void (live = false);
  }, [repoId, previewKey]);

  const save = (b: Board | null, reassign: Record<string, string> = {}) =>
    api.boardSave(repoId, b, reassign).then((c) => (setBoardConfig(c), onChange()), (e) => onError(String(e)));
  const patch = (p: Partial<Board>) => void save({ ...board, ...p });
  const setCols = (columns: BoardColumn[], reassign?: Record<string, string>) => void save({ ...board, columns }, reassign);
  const setCol = (id: string, p: Partial<BoardColumn>) => setCols(board.columns.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= board.columns.length || from === to) return;
    const cols = [...board.columns];
    const [c] = cols.splice(from, 1);
    cols.splice(to, 0, c);
    setCols(cols);
  };
  const scope = workspaces.filter((w) => !w.archived && (repoId ? w.repo_id === repoId : !cfg.repos[w.repo_id]));
  const count = (id: string) => scope.filter((w) => w.status === id).length;
  const remove = (id: string) => {
    const n = count(id);
    const other = board.columns.find((c) => c.id !== id)!;
    if (n === 0) return setCols(board.columns.filter((c) => c.id !== id));
    setDel({ id, to: other.id });
  };
  const commitName = (c: BoardColumn) => {
    const v = names[c.id];
    if (v === undefined) return;
    setNames(({ [c.id]: _, ...rest }) => rest);
    if (v.trim() && v.trim() !== c.name) setCol(c.id, { name: v.trim() });
  };
  const add = () => {
    const id = newId();
    focusNew.current = id;
    setCols([...board.columns, { id, name: t("app.board.cfg.newStatus"), icon: "todo", color: "blue", map: { linear: AUTO, github: AUTO, project: AUTO, github_label: null } }]);
  };

  // Arrastar pela alça: a linha sob o ponteiro vira o destino.
  const rowAt = (y: number) => {
    const rows = [...(ref.current?.querySelectorAll<HTMLElement>("[data-col-row]") ?? [])];
    const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.bottom; });
    return i < 0 ? rows.length - 1 : i;
  };
  const grab = (e: React.PointerEvent, from: number) => {
    e.preventDefault();
    setDrag({ from, over: from });
    const mv = (ev: PointerEvent) => setDrag({ from, over: rowAt(ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      move(from, rowAt(ev.clientY));
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  const linear = preview?.previews.find((p) => p.tracker === "linear");
  const linearStates = [...new Set(preview?.previews.filter((p) => p.tracker === "linear").flatMap((p) => p.states.map((s) => s.name)) ?? [])];
  const github = preview?.previews.find((p) => p.tracker === "github");
  const matchOf = (i: number) => {
    if (!board.sync || !preview) return null;
    const lin = linear?.columns[i];
    if (linear) return lin ? { text: `Linear: ${lin.name}`, none: false } : { text: t("app.board.cfg.noMatch", { tracker: "Linear" }), none: true };
    const gh = github?.columns[i];
    if (github) return gh ? { text: `GitHub: ${gh.name}`, none: false } : { text: t("app.board.cfg.noMatch", { tracker: "GitHub" }), none: true };
    return null;
  };

  return (
    <Floating className="popover board-cfg" placement="bottom-end" testid="board-cfg">
      <div ref={ref} onKeyDown={(e) => e.stopPropagation()}>
        <div className="bc-scope dim small" data-testid="board-cfg-scope">{repo ? t("app.board.cfg.scopeRepo", { repo: repo.name }) : t("app.board.cfg.scopeAll")}</div>
        {repo && (
          <div className="bc-switch">
            <div><div className="bc-label">{t("app.board.cfg.own")}</div><div className="dim small">{t("app.board.cfg.ownHint")}</div></div>
            <Switch on={own} set={(v) => void (v ? save(boardFor(cfg, null)) : save(null))} label={t("app.board.cfg.own")} testid="board-own" />
          </div>
        )}
        <fieldset disabled={!own} className="bc-body">
          <div className="bc-switch">
            <div><div className="bc-label">{t("app.board.cfg.sync")}</div><div className="dim small">{t("app.board.cfg.syncHint")}</div></div>
            <Switch on={board.sync} set={(v) => patch({ sync: v })} label={t("app.board.cfg.sync")} testid="board-sync" />
          </div>
          {board.sync && (
            <>
              <div className="bc-switch sub">
                <div><div className="bc-label">{t("app.board.cfg.reverse")}</div><div className="dim small">{t("app.board.cfg.reverseHint")}</div></div>
                <Switch on={board.reverse_sync} set={(v) => patch({ reverse_sync: v })} label={t("app.board.cfg.reverse")} testid="board-reverse" />
              </div>
              <div className="bc-switch sub">
                <div><div className="bc-label">{"GitHub Projects" /* i18n-ignore: produto */}</div><div className="dim small">{t("app.board.cfg.projectsHint")}</div></div>
                <Switch on={board.github_projects} set={(v) => patch({ github_projects: v })} label={"GitHub Projects" /* i18n-ignore: produto */} testid="board-projects" />
              </div>
              {preview && !preview.linear_connected && !preview.github_connected && <div className="dim small bc-warn">{t("app.board.cfg.noTracker")}</div>}
              {preview?.errors.map((er) => <div key={er} className="small bc-err">{er}</div>)}
            </>
          )}

          <div className="bc-title">{t("app.board.cfg.statuses")}</div>
          <div className="bc-cols">
            {board.columns.map((c, i) => {
              const m = matchOf(i);
              return (
                <div key={c.id} className={"bc-row" + (drag && drag.over === i && drag.from !== i ? " drop" : "") + (drag?.from === i ? " dragging" : "")} data-col-row={c.id} data-testid="board-col-row">
                  <div className="bc-line">
                    <span className="bc-handle" onPointerDown={(e) => grab(e, i)} title={t("app.board.cfg.drag")} data-testid="board-col-drag"><IDrag size={12} /></span>
                    <IconPicker c={c} set={(p) => setCol(c.id, p)} />
                    <input className="bc-name" value={names[c.id] ?? c.name} maxLength={40} {...noSuggest} autoFocus={focusNew.current === c.id} onFocus={(e) => focusNew.current === c.id && ((focusNew.current = null), e.currentTarget.select())}
                      onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))} onBlur={() => commitName(c)} onKeyDown={(e) => e.key === "Enter" && commitName(c)} aria-label={t("app.board.cfg.name")} data-testid="board-col-name" />
                    <button className="icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0} title={t("app.board.cfg.up")} aria-label={t("app.board.cfg.up")} data-testid="board-col-up"><IArrowUp size={13} /></button>
                    <button className="icon-btn bc-down" onClick={() => move(i, i + 1)} disabled={i === board.columns.length - 1} title={t("app.board.cfg.down")} aria-label={t("app.board.cfg.down")} data-testid="board-col-down"><IArrowUp size={13} /></button>
                    <button className="icon-btn" onClick={() => remove(c.id)} disabled={board.columns.length <= 1} title={t("app.board.cfg.delete")} aria-label={t("app.board.cfg.delete")} data-testid="board-col-delete"><ITrash size={13} /></button>
                  </div>
                  <div className="bc-meta">
                    <button className={"text-btn small bc-map" + (m?.none ? " none" : "")} onClick={() => setMapOpen(mapOpen === c.id ? null : c.id)} data-testid="board-col-map">{m ? m.text : t("app.board.cfg.mapping")}</button>
                  </div>
                  {mapOpen === c.id && (
                    <div className="bc-mapping" data-testid="board-col-mapping">
                      <label>Linear
                        <select value={ovValue(c.map.linear)} onChange={(e) => setCol(c.id, { map: { ...c.map, linear: ovParse(e.target.value) } })} data-testid="board-map-linear">
                          <option value="auto">{t("app.board.cfg.automatic")}{linear ? ` (${linear.columns[i]?.name ?? t("app.board.cfg.none")})` : ""}</option>
                          <option value="off">{t("app.board.cfg.never")}</option>
                          {[...new Set([...linearStates, ...(c.map.linear.mode === "state" ? [c.map.linear.value] : [])])].map((n) => <option key={n} value={`state:${n}`}>{n}</option>)}
                        </select>
                      </label>
                      <label>{"GitHub Issues" /* i18n-ignore: produto */}
                        <select value={ovValue(c.map.github)} onChange={(e) => setCol(c.id, { map: { ...c.map, github: ovParse(e.target.value) } })} data-testid="board-map-github">
                          <option value="auto">{t("app.board.cfg.automatic")}{github?.columns[i] ? ` (${github.columns[i]!.name})` : ""}</option>
                          <option value="off">{t("app.board.cfg.never")}</option>
                          <option value="state:open">{t("app.board.gh.open")}</option>
                          <option value="state:closed">{t("app.board.gh.closed")}</option>
                          <option value="state:not_planned">{t("app.board.gh.notPlanned")}</option>
                        </select>
                      </label>
                      <label>{t("app.board.cfg.label")}
                        <input defaultValue={c.map.github_label ?? ""} placeholder={t("app.board.cfg.labelPlaceholder")} {...noSuggest} maxLength={50}
                          onBlur={(e) => e.target.value.trim() !== (c.map.github_label ?? "") && setCol(c.id, { map: { ...c.map, github_label: e.target.value.trim() || null } })} data-testid="board-map-label" />
                      </label>
                      {board.github_projects && (
                        <label>{"GitHub Projects" /* i18n-ignore: produto */}
                          <input defaultValue={c.map.project.mode === "state" ? c.map.project.value : ""} placeholder={c.map.project.mode === "off" ? t("app.board.cfg.never") : t("app.board.cfg.projectPlaceholder")} {...noSuggest} maxLength={80}
                            onBlur={(e) => { const v = e.target.value.trim(); const next: Override = v ? { mode: "state", value: v } : AUTO; if (ovValue(next) !== ovValue(c.map.project)) setCol(c.id, { map: { ...c.map, project: next } }); }} data-testid="board-map-project" />
                        </label>
                      )}
                    </div>
                  )}
                  {del?.id === c.id && (
                    <div className="bc-delete" data-testid="board-delete-confirm">
                      <span>{t("app.board.cfg.deleteMove", { count: count(c.id), column: c.name })}</span>
                      <select value={del.to} onChange={(e) => setDel({ ...del, to: e.target.value })} data-testid="board-delete-target">
                        {board.columns.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <button className="btn danger small" onClick={() => (setDel(null), setCols(board.columns.filter((x) => x.id !== c.id), { [c.id]: del.to }))} data-testid="board-delete-ok">{t("app.board.cfg.deleteOk")}</button>
                      <button className="btn small" onClick={() => setDel(null)}>{t("common.cancel")}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button className="text-btn bc-add" onClick={add} disabled={board.columns.length >= 16} data-testid="board-add"><IPlus size={13} /> {t("app.board.cfg.add")}</button>

          <div className="bc-switch">
            <div><div className="bc-label">{t("app.board.cfg.auto.title")}</div><div className="dim small">{t("app.board.cfg.auto.hint")}</div></div>
            <Switch on={board.auto.enabled} set={(v) => patch({ auto: { ...board.auto, enabled: v } })} label={t("app.board.cfg.auto.title")} testid="board-auto" />
          </div>
          {board.auto.enabled && (
            <div className="bc-auto">
              {(["agent_started", "pr_opened", "pr_merged"] as const).map((k) => (
                <label key={k}>{t(`app.board.cfg.auto.${k}` as never)}
                  <select value={board.auto[k] ?? ""} onChange={(e) => patch({ auto: { ...board.auto, [k]: e.target.value || null } })} data-testid={`board-auto-${k}`}>
                    <option value="">{t("app.board.cfg.auto.none")}</option>
                    {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>
    </Floating>
  );
}
