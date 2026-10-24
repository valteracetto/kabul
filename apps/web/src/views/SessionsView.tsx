import { useEffect, useState } from "react";
import { api, type Sessions, type Workspace } from "../api";
import { RunsOnBadge, cloudList, cloudRunsOn } from "../components/RunsOn";

export function SessionsView({ onError }: { onError: (e: string) => void }) {
  const [s, setS] = useState<Sessions | null>(null);
  const [wss, setWss] = useState<Workspace[]>([]);
  useEffect(() => void api.workspaces().then(setWss, () => {}), []);
  const clouds = wss.flatMap((w) => cloudList(w.id).map((c) => ({ w, c })));
  const load = () => api.sessions().then(setS, (e) => onError(String(e)));
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const wsName = (id: string | null) => {
    const w = s?.conductor_workspaces.find((w) => w.id === id);
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

      <h3>Conductor <span className="count">{s?.conductor_sessions.length ?? 0}</span></h3>
      {s?.conductor_error && <div className="dim">indisponível: {s.conductor_error}</div>}
      <table>
        <thead><tr><th>status</th><th>agente</th><th>modelo</th><th>título</th><th>workspace</th></tr></thead>
        <tbody>
          {s?.conductor_sessions.slice(0, 200).map((c) => (
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
