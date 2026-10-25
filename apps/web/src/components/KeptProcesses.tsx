import { useEffect, useState } from "react";
import { api, type Leftover } from "../api";
import { t } from "../i18n";

/** Processos que os agentes deixaram e o usuário manteve rodando, com "Encerrar" (Recursos e Painel). */
export function KeptProcesses({ every = 3000, wsName = {}, onError }: { every?: number; wsName?: Record<string, string>; onError?: (e: string) => void }) {
  const [list, setList] = useState<Leftover[]>([]);
  useEffect(() => {
    const load = () => api.processesKept().then(setList, () => {});
    load();
    const timer = setInterval(load, every);
    return () => clearInterval(timer);
  }, [every]);
  if (!list.length) return null;
  const kill = (p: Leftover) => api.processKill([{ pid: p.pid, start: p.start }]).then(() => setList((l) => l.filter((x) => x.pid !== p.pid)), (e) => onError?.(String(e)));
  return (
    <div className="kept" data-testid="kept">
      <div className="kept-title">{t("app.kept.title")}</div>
      {list.map((p) => (
        <div key={p.pid} className="kept-row" data-testid="kept-row">
          <span className="lo-name">{p.name}</span>
          <code className="lo-cmd" title={p.cmd}>{p.cmd}</code>
          {p.ports.length > 0 && <span className="lo-port mono">:{p.ports.join(", :")}</span>}
          {p.workspace_id && wsName[p.workspace_id] && <span className="dim small">{wsName[p.workspace_id]}</span>}
          <button className="btn small" onClick={() => kill(p)} data-testid="kept-kill">{t("app.kept.kill")}</button>
        </div>
      ))}
    </div>
  );
}
