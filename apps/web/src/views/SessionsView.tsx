import { KeptProcesses } from "../components/KeptProcesses";
import { OverviewTabs } from "./SideNav";
import { useEffect, useState } from "react";
import { api, type ExternalSessions, type Model, type Sessions, type Workspace } from "../api";
import { RunsOnBadge, cloudList, cloudRunsOn } from "../components/RunsOn";
import { ago, HARNESS_OF, modelFor, workspaceFor } from "../components/external";
import { LazyChunks } from "../components/LazyChunks";
import { mountedWs, pendingFork, pendingForkWs, type PendingFork } from "../components/chatPrefs";
import type { Route } from "../App";
import { t } from "../i18n";

export function SessionsView({ onError, onRoute }: { onError: (e: string) => void; onRoute?: (r: Route) => void }) {
  const [s, setS] = useState<Sessions | null>(null);
  const [ext, setExt] = useState<ExternalSessions | null>(null);
  const [wss, setWss] = useState<Workspace[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [paste, setPaste] = useState("");
  const [pasteWs, setPasteWs] = useState("");
  useEffect(() => void api.workspaces().then(setWss, () => {}), []);
  useEffect(() => void api.models().then(setModels, () => {}), []);
  const clouds = wss.flatMap((w) => cloudList(w.id).map((c) => ({ w, c })));
  const load = () => api.sessions().then(setS, (e) => onError(String(e)));
  const loadExt = () => api.externalSessions().then(setExt, () => {});
  useEffect(() => {
    load();
    loadExt();
    const timer = setInterval(load, 3000);
    // Processos e históricos dos CLIs: leitura mais pesada, mais espaçada.
    const t2 = setInterval(loadExt, 10000);
    return () => (clearInterval(timer), clearInterval(t2));
  }, []);
  const now = Date.now() / 1000;

  /** Nova aba no workspace da pasta, retomando a mesma conversa pelo id da sessão. */
  const cont = (agent: string, id: string | null, cwd: string | null, title: string) => {
    const w = workspaceFor(cwd, wss);
    const m = modelFor(agent, models);
    if (!w || !id || !m) return onError(!w ? t("app.sessions.noWorkspaceAt", { path: cwd ?? "?" }) : !id ? t("app.sessions.noIdYet") : t("app.sessions.noModel", { agent }));
    const fork: PendingFork = { items: [{ k: "notice", text: t("app.sessions.continuing", { title, agent }) }], resume: id, forkSession: false, replay: false, modelKey: m.key };
    // Tela do workspace já montada: aba nova na hora; senão a aba nasce quando ela montar.
    if (mountedWs.has(w.id)) window.dispatchEvent(new CustomEvent("kabul:fork-tab", { detail: { ws: w.id, fork } }));
    else {
      const cid = `chat-${Date.now().toString(36)}`;
      pendingFork[cid] = fork;
      pendingForkWs[w.id] = { chatId: cid };
    }
    onRoute?.({ kind: "workspace", id: w.id });
  };
  const canCont = (agent: string, id: string | null, cwd: string | null) => !!(id && workspaceFor(cwd, wss) && HARNESS_OF[agent]);
  const why = (agent: string, id: string | null, cwd: string | null) => (!HARNESS_OF[agent] ? t("app.sessions.why.noHarness") : !id ? t("app.sessions.why.noId") : !workspaceFor(cwd, wss) ? t("app.sessions.why.noWorkspace") : t("app.sessions.why.ok"));

  const wsName = (id: string | null) => {
    const w = s?.imported_workspaces.find((w) => w.id === id);
    return w ? `${w.repo_name ?? "?"} / ${w.directory_name ?? "?"}` : "—";
  };

  return (
    <section className="page">
      <header className="page-head" data-tauri-drag-region><OverviewTabs on="sessions" /><span className="dim">{t("app.sessions.refresh")}</span></header>
      <KeptProcesses wsName={Object.fromEntries(wss.map((w) => [w.id, w.title || w.name]))} onError={onError} />
      <h3>tmux <span className="count">{s?.tmux.length ?? 0}</span></h3>
      <table>
        <thead><tr><th>{t("app.sessions.col.pane")}</th><th>{t("app.sessions.col.agent")}</th><th>{t("app.sessions.col.session")}</th><th>{t("app.sessions.col.command")}</th><th>{t("app.sessions.col.folder")}</th></tr></thead>
        {/* Centenas de panes com muitos workspaces: blocos de linhas desenhados perto da área visível. */}
        <LazyChunks table={5} count={s?.tmux.length ?? 0} chunk={100} rowPx={34} render={(a, b) => s!.tmux.slice(a, b).map((p) => (
            <tr key={p.pane_id}>
              <td><code>{p.pane_id}</code></td>
              <td><span className={"agent ag-" + p.agent}>{p.agent}</span></td>
              <td>{p.session}:{p.window_index}.{p.pane_index}</td>
              <td>{p.command}</td>
              <td className="path">{p.path}</td>
            </tr>
          ))} />
        {s && s.tmux.length === 0 && <tbody><tr><td colSpan={5} className="dim">{t("app.sessions.noTmux")}</td></tr></tbody>}
      </table>

      <h3>{t("app.sessions.outside")} <span className="count">{ext?.running.length ?? 0}</span></h3>
      <table data-testid="external-running">
        <thead><tr><th>{t("app.sessions.col.agent")}</th><th>{t("app.sessions.col.folder")}</th><th>{t("app.sessions.col.running")}</th><th>{t("app.sessions.col.terminal")}</th><th></th></tr></thead>
        <tbody>
          {ext?.running.map((r) => (
            <tr key={r.pid} data-testid="external-row">
              <td><span className={"agent ag-" + r.agent}>{r.agent}</span> <span className="badge" title={t("app.sessions.outsideTitle")}>{t("app.sessions.outside")}</span></td>
              <td className="path" title={r.cwd ?? ""}>{r.repo ?? r.cwd ?? "—"}{r.branch && <span className="dim"> · {r.branch}</span>}</td>
              <td className="dim">{ago(r.running_secs)}</td>
              <td className="dim">{r.terminal ?? "—"}</td>
              <td><button className="text-btn small" disabled={!canCont(r.agent, r.session_id, r.cwd)} title={why(r.agent, r.session_id, r.cwd)} onClick={() => cont(r.agent, r.session_id, r.cwd, r.repo ?? r.agent)} data-testid="external-continue">{t("app.sessions.continue")}</button></td>
            </tr>
          ))}
          {ext && ext.running.length === 0 && <tr><td colSpan={5} className="dim">{t("app.sessions.noOutside")}</td></tr>}
        </tbody>
      </table>

      <h3>{t("app.sessions.recent")} <span className="count">{ext?.recent.length ?? 0}</span></h3>
      <table data-testid="external-recent">
        <thead><tr><th>{t("app.sessions.col.agent")}</th><th>{t("app.sessions.col.title")}</th><th>{t("app.sessions.col.folder")}</th><th>{t("app.sessions.col.when")}</th><th></th></tr></thead>
        <tbody>
          {ext?.recent.map((r) => (
            <tr key={r.agent + r.id} data-testid="recent-row">
              <td><span className={"agent ag-" + r.agent}>{r.agent}</span></td>
              <td>{r.title}</td>
              <td className="path" title={r.cwd ?? ""}>{r.repo ?? "—"}{r.branch && <span className="dim"> · {r.branch}</span>}</td>
              <td className="dim">{t("app.sessions.ago", { time: ago(now - r.updated) })}</td>
              <td><button className="text-btn small" disabled={!canCont(r.agent, r.id, r.cwd)} title={why(r.agent, r.id, r.cwd)} onClick={() => cont(r.agent, r.id, r.cwd, r.title)} data-testid="recent-continue">{t("app.sessions.continue")}</button></td>
            </tr>
          ))}
          {ext && ext.recent.length === 0 && <tr><td colSpan={5} className="dim">{t("app.sessions.noRecent")}</td></tr>}
        </tbody>
      </table>

      <h3>{t("app.sessions.cloud")} <span className="count">{clouds.length}</span></h3>
      <table data-testid="cloud-sessions">
        <thead><tr><th>{t("app.sessions.col.where")}</th><th>{t("app.sessions.col.session")}</th><th>{t("app.sessions.col.title")}</th><th>{t("app.sessions.col.workspace")}</th><th></th></tr></thead>
        <tbody>
          {clouds.map(({ w, c }) => (
            <tr key={c.tmux}>
              <td><RunsOnBadge r={cloudRunsOn(c)} /></td>
              <td><code>{c.info.id}</code></td>
              <td>{c.info.title}</td>
              <td className="path">{w.title || w.name}</td>
              <td>{c.info.url && <a onClick={() => api.openExternal(c.info.url!)}>{"claude.ai ↗" /* i18n-ignore */}</a>}</td>
            </tr>
          ))}
          {clouds.length === 0 && <tr><td colSpan={5} className="dim">{t("app.sessions.noCloud")}</td></tr>}
        </tbody>
      </table>
      {/* Nuvem criada fora do Kabul: o CLI não lista sem terminal; colar o link ou o id traz para o Mac. */}
      <div className="cloud-paste" data-testid="cloud-paste">
        <div className="dim small">☁︎ {ext?.cloud_note ?? t("app.sessions.cloudNote")}</div>
        <div className="row">
          <input placeholder={t("app.sessions.pastePlaceholder")} value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="cloud-paste-input" />
          <select value={pasteWs} onChange={(e) => setPasteWs(e.target.value)} data-testid="cloud-paste-ws">
            <option value="">{t("app.sessions.pickWorkspace")}</option>
            {wss.map((w) => <option key={w.id} value={w.id}>{w.title || w.name}</option>)}
          </select>
          <button className="btn" disabled={!cloudId(paste) || !pasteWs} onClick={() => api.teleport(pasteWs, cloudId(paste)!).then(() => (setPaste(""), onRoute?.({ kind: "workspace", id: pasteWs })), (e) => onError(String(e)))} data-testid="cloud-paste-go">{t("app.sessions.bringToMac")}</button>
        </div>
      </div>

      <h3>{t("app.sessions.imported")} <span className="count">{s?.imported_sessions.length ?? 0}</span></h3>
      {s?.imported_error && <div className="dim">{t("app.sessions.unavailable", { error: s.imported_error })}</div>}
      <table>
        <thead><tr><th>{t("app.sessions.col.status")}</th><th>{t("app.sessions.col.agent")}</th><th>{t("app.sessions.col.model")}</th><th>{t("app.sessions.col.title")}</th><th>{t("app.sessions.col.workspace")}</th></tr></thead>
        <LazyChunks table={5} count={s?.imported_sessions.length ?? 0} chunk={100} rowPx={34} render={(a, b) => s!.imported_sessions.slice(a, b).map((c) => (
            <tr key={c.id}>
              <td><span className={"status " + (c.status ?? "")}><i />{c.status ?? "—"}</span></td>
              {/* i18n-ignore: nome do agente (dado) */}
              <td><span className={"agent ag-" + (c.agent_type ?? "claude")}>{c.agent_type ?? "claude"}</span></td>
              <td>{c.model ?? "—"}</td>
              <td>{c.title ?? ""}</td>
              <td className="path">{wsName(c.workspace_id)}</td>
            </tr>
          ))} />
      </table>
    </section>
  );
}

/** Id da sessão de nuvem a partir do link do claude.ai/code ou do id colado (igual ao core `external::cloud_id`). */
export function cloudId(input: string): string | null {
  const s = input.trim().replace(/\/+$/, "");
  const id = s.startsWith("http") ? s.split(/[?#]/)[0].split("/").pop() ?? "" : s;
  return id.length >= 6 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
