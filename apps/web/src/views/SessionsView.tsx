import { useEffect, useState } from "react";
import { api, type ExternalSessions, type Model, type Sessions, type Workspace } from "../api";
import { RunsOnBadge, cloudList, cloudRunsOn } from "../components/RunsOn";
import { ago, HARNESS_OF, modelFor, workspaceFor } from "../components/external";
import { mountedWs, pendingFork, pendingForkWs, type PendingFork } from "../components/chatPrefs";
import type { Route } from "../App";

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
    const t = setInterval(load, 3000);
    // Processos e históricos dos CLIs: leitura mais pesada, mais espaçada.
    const t2 = setInterval(loadExt, 10000);
    return () => (clearInterval(t), clearInterval(t2));
  }, []);
  const now = Date.now() / 1000;

  /** Nova aba no workspace da pasta, retomando a mesma conversa pelo id da sessão. */
  const cont = (agent: string, id: string | null, cwd: string | null, title: string) => {
    const w = workspaceFor(cwd, wss);
    const m = modelFor(agent, models);
    if (!w || !id || !m) return onError(!w ? `Nenhum workspace do Kabul em ${cwd ?? "?"}: abra a pasta como projeto ou crie o workspace nela.` : !id ? "Ainda não deu para saber o id dessa sessão." : `Sem modelo do ${agent} no seletor.`);
    const fork: PendingFork = { items: [{ k: "notice", text: `Continuando "${title}" (${agent}, de fora do Kabul)` }], resume: id, forkSession: false, replay: false, modelKey: m.key };
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
  const why = (agent: string, id: string | null, cwd: string | null) => (!HARNESS_OF[agent] ? "Agente sem harness no Kabul" : !id ? "Id da sessão ainda desconhecido" : !workspaceFor(cwd, wss) ? "Nenhum workspace do Kabul nesta pasta" : "Abre uma aba nova retomando a mesma conversa");

  const wsName = (id: string | null) => {
    const w = s?.imported_workspaces.find((w) => w.id === id);
    return w ? `${w.repo_name ?? "?"} / ${w.directory_name ?? "?"}` : "—";
  };

  return (
    <section className="page">
      <header className="page-head" data-tauri-drag-region><h2>Painel</h2><span className="dim">atualiza a cada 3 s</span></header>
      <h3>tmux <span className="count">{s?.tmux.length ?? 0}</span></h3>
      <table>
        <thead><tr><th>pane</th><th>agente</th><th>sessão</th><th>comando</th><th>pasta</th></tr></thead>
        <tbody>
          {s?.tmux.map((p) => (
            <tr key={p.pane_id}>
              <td><code>{p.pane_id}</code></td>
              <td><span className={"agent ag-" + p.agent}>{p.agent}</span></td>
              <td>{p.session}:{p.window_index}.{p.pane_index}</td>
              <td>{p.command}</td>
              <td className="path">{p.path}</td>
            </tr>
          ))}
          {s && s.tmux.length === 0 && <tr><td colSpan={5} className="dim">Nenhum servidor tmux rodando.</td></tr>}
        </tbody>
      </table>

      <h3>Fora do Kabul <span className="count">{ext?.running.length ?? 0}</span></h3>
      <table data-testid="external-running">
        <thead><tr><th>agente</th><th>pasta</th><th>rodando</th><th>terminal</th><th></th></tr></thead>
        <tbody>
          {ext?.running.map((r) => (
            <tr key={r.pid} data-testid="external-row">
              <td><span className={"agent ag-" + r.agent}>{r.agent}</span> <span className="badge" title="Rodando em outro terminal: só leitura, não dá para espelhar">Fora do Kabul</span></td>
              <td className="path" title={r.cwd ?? ""}>{r.repo ?? r.cwd ?? "—"}{r.branch && <span className="dim"> · {r.branch}</span>}</td>
              <td className="dim">{ago(r.running_secs)}</td>
              <td className="dim">{r.terminal ?? "—"}</td>
              <td><button className="text-btn small" disabled={!canCont(r.agent, r.session_id, r.cwd)} title={why(r.agent, r.session_id, r.cwd)} onClick={() => cont(r.agent, r.session_id, r.cwd, r.repo ?? r.agent)} data-testid="external-continue">Continuar no Kabul</button></td>
            </tr>
          ))}
          {ext && ext.running.length === 0 && <tr><td colSpan={5} className="dim">Nenhum agente rodando fora do Kabul.</td></tr>}
        </tbody>
      </table>

      <h3>Recentes fora do Kabul <span className="count">{ext?.recent.length ?? 0}</span></h3>
      <table data-testid="external-recent">
        <thead><tr><th>agente</th><th>título</th><th>pasta</th><th>quando</th><th></th></tr></thead>
        <tbody>
          {ext?.recent.map((r) => (
            <tr key={r.agent + r.id} data-testid="recent-row">
              <td><span className={"agent ag-" + r.agent}>{r.agent}</span></td>
              <td>{r.title}</td>
              <td className="path" title={r.cwd ?? ""}>{r.repo ?? "—"}{r.branch && <span className="dim"> · {r.branch}</span>}</td>
              <td className="dim">há {ago(now - r.updated)}</td>
              <td><button className="text-btn small" disabled={!canCont(r.agent, r.id, r.cwd)} title={why(r.agent, r.id, r.cwd)} onClick={() => cont(r.agent, r.id, r.cwd, r.title)} data-testid="recent-continue">Continuar no Kabul</button></td>
            </tr>
          ))}
          {ext && ext.recent.length === 0 && <tr><td colSpan={5} className="dim">Nenhuma sessão recente dos CLIs.</td></tr>}
        </tbody>
      </table>

      <h3>Nuvem <span className="count">{clouds.length}</span></h3>
      <table data-testid="cloud-sessions">
        <thead><tr><th>onde</th><th>sessão</th><th>título</th><th>workspace</th><th></th></tr></thead>
        <tbody>
          {clouds.map(({ w, c }) => (
            <tr key={c.tmux}>
              <td><RunsOnBadge r={cloudRunsOn(c)} /></td>
              <td><code>{c.info.id}</code></td>
              <td>{c.info.title}</td>
              <td className="path">{w.title || w.name}</td>
              <td>{c.info.url && <a onClick={() => api.openExternal(c.info.url!)}>claude.ai ↗</a>}</td>
            </tr>
          ))}
          {clouds.length === 0 && <tr><td colSpan={5} className="dim">Nenhuma sessão na nuvem criada pelo Kabul.</td></tr>}
        </tbody>
      </table>
      {/* Nuvem criada fora do Kabul: o CLI não lista sem terminal; colar o link ou o id traz para o Mac. */}
      <div className="cloud-paste" data-testid="cloud-paste">
        <div className="dim small">☁︎ {ext?.cloud_note ?? "Sessões de nuvem criadas fora do Kabul: cole o link ou o id."}</div>
        <div className="row">
          <input placeholder="Link do claude.ai/code ou id da sessão" value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="cloud-paste-input" />
          <select value={pasteWs} onChange={(e) => setPasteWs(e.target.value)} data-testid="cloud-paste-ws">
            <option value="">Workspace…</option>
            {wss.map((w) => <option key={w.id} value={w.id}>{w.title || w.name}</option>)}
          </select>
          <button className="btn" disabled={!cloudId(paste) || !pasteWs} onClick={() => api.teleport(pasteWs, cloudId(paste)!).then(() => (setPaste(""), onRoute?.({ kind: "workspace", id: pasteWs })), (e) => onError(String(e)))} data-testid="cloud-paste-go">Trazer para o Mac</button>
        </div>
      </div>

      <h3>Sessões importadas <span className="count">{s?.imported_sessions.length ?? 0}</span></h3>
      {s?.imported_error && <div className="dim">indisponível: {s.imported_error}</div>}
      <table>
        <thead><tr><th>status</th><th>agente</th><th>modelo</th><th>título</th><th>workspace</th></tr></thead>
        <tbody>
          {s?.imported_sessions.slice(0, 200).map((c) => (
            <tr key={c.id}>
              <td><span className={"status " + (c.status ?? "")}><i />{c.status ?? "—"}</span></td>
              <td><span className={"agent ag-" + (c.agent_type ?? "claude")}>{c.agent_type ?? "claude"}</span></td>
              <td>{c.model ?? "—"}</td>
              <td>{c.title ?? ""}</td>
              <td className="path">{wsName(c.workspace_id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Id da sessão de nuvem a partir do link do claude.ai/code ou do id colado (igual ao core `external::cloud_id`). */
export function cloudId(input: string): string | null {
  const t = input.trim().replace(/\/+$/, "");
  const id = t.startsWith("http") ? t.split(/[?#]/)[0].split("/").pop() ?? "" : t;
  return id.length >= 6 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}
