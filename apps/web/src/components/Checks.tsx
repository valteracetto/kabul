import { useEffect, useState } from "react";
import { api, type PrCheck } from "../api";

const ICON: Record<string, [string, string]> = { pass: ["✓", "ok"], fail: ["✕", "error"], pending: ["●", "pending"], skipping: ["–", "dim"], cancel: ["⊘", "dim"] };

/** Aba Checks: status de CI do PR da branch (`gh pr checks`), atualizado a cada 20 s. */
export function Checks({ workspaceId, onError }: { workspaceId: string; onError: (e: string) => void }) {
  const [data, setData] = useState<{ checks: PrCheck[]; message: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.prChecks(workspaceId).then((d) => alive && setData(d), (e) => onError(String(e)));
    load();
    const t = setInterval(load, 20000);
    return () => ((alive = false), clearInterval(t));
  }, [workspaceId, onError]);
  if (!data) return <div className="files-empty">Consultando o GitHub…</div>;
  if (!data.checks.length) return <div className="files-empty">{data.message}</div>;
  const count = (b: string) => data.checks.filter((c) => c.bucket === b).length;
  return (
    <div data-testid="checks">
      <div className="checks-sum dim small">{count("pass")} ok · {count("fail")} falhando · {count("pending")} rodando</div>
      {data.checks.map((c) => {
        const [g, cls] = ICON[c.bucket] ?? ["?", "dim"];
        return (
          <div key={c.workflow + c.name} className="file-row" title={c.description || c.state} onClick={() => c.link && api.openExternal(c.link)}>
            <span className={"check-glyph " + cls}>{g}</span>
            <span className="fpath">{c.workflow ? <span className="dim">{c.workflow} / </span> : null}{c.name}</span>
          </div>
        );
      })}
    </div>
  );
}
