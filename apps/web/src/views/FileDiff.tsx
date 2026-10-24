import { useEffect, useState } from "react";
import { api, type DiffComment, type Workspace } from "../api";
import { IComment } from "../icons";

/** Diff de um arquivo com comentários por linha (clique no número da linha). */
export function FileDiff({ ws, path, onError }: { ws: Workspace; path: string; onError: (e: string) => void }) {
  const [d, setD] = useState<string | null>(null);
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [composing, setComposing] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const load = () => api.comments(ws.id).then((c) => setComments(c.filter((x) => x.path === path)), () => {});
  useEffect(() => {
    api.fileDiff(ws.id, path).then(setD, (e) => onError(String(e)));
    load();
  }, [ws.id, path]);

  // Numera as linhas do lado novo.
  const lines = (d ?? "").split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  let n = 0;
  const rows = (d === null ? [] : start >= 0 ? lines.slice(start) : lines).map((l) => {
    if (l.startsWith("@@")) {
      n = Number(/\+(\d+)/.exec(l)?.[1] ?? 1) - 1;
      return { l, num: null as number | null };
    }
    if (l.startsWith("-")) return { l, num: null };
    n++;
    return { l, num: n };
  });

  const add = async () => {
    if (composing == null || !body.trim()) return;
    await api.addComment(ws.id, path, composing, null, body.trim()).catch((e) => onError(String(e)));
    setComposing(null);
    setBody("");
    load();
  };
  const open = comments.filter((c) => !c.resolved);
  const sendToAgent = () => {
    const text = "Revise estes comentários no diff:\n" + open.map((c) => `- ${c.path}:${c.line} — ${c.body}`).join("\n");
    window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: ws.id, text } }));
  };

  return (
    <div className="filediff">
      <div className="fd-head"><code>{path}</code><span className="grow" />{open.length > 0 && <button className="btn" onClick={sendToAgent}><IComment size={13} /> Enviar {open.length} comentário{open.length > 1 ? "s" : ""} ao agente</button>}</div>
      {d === null && <div className="empty-state">Carregando o diff…</div>}
      {d !== null && d.trim() === "" && <div className="empty-state">Sem diferenças neste arquivo.</div>}
      <div className="patch" hidden={!d}>
        {rows.map((r, i) => (
          <div key={i}>
            <div className={"pl " + (r.l.startsWith("+") ? "a" : r.l.startsWith("-") ? "d" : r.l.startsWith("@@") ? "h" : "")}>
              <span className={"ln" + (r.num ? " can" : "")} title={r.num ? "Comentar nesta linha" : undefined} onClick={() => r.num && (setComposing(r.num), setBody(""))}>{r.num ?? ""}</span>
              <span className="code">{r.l || " "}</span>
            </div>
            {comments.filter((c) => c.line === r.num).map((c) => (
              <div key={c.id} className={"comment" + (c.resolved ? " resolved" : "")} data-testid="diff-comment">
                <IComment size={12} /> <span>{c.body}</span><span className="grow" />
                <button className="text-btn small" onClick={() => api.updateComment(c.id, !c.resolved).then(load)}>{c.resolved ? "reabrir" : "resolver"}</button>
                <button className="text-btn small" onClick={() => api.updateComment(c.id, null, true).then(load)}>apagar</button>
              </div>
            ))}
            {composing === r.num && r.num != null && (
              <div className="comment-box">
                <textarea autoFocus rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Comentário na linha ${r.num}`} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || !e.shiftKey)) { e.preventDefault(); add(); } if (e.key === "Escape") setComposing(null); }} />
                <div className="row end"><button className="btn" onClick={() => setComposing(null)}>Cancelar</button><button className="btn primary" onClick={add}>Comentar</button></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FileView({ ws, path, onError }: { ws: Workspace; path: string; onError: (e: string) => void }) {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => void api.readFile(ws.id, path).then(setT, (e) => onError(String(e))), [ws.id, path, onError]);
  return (
    <div className="filediff">
      <div className="fd-head"><code>{path}</code></div>
      <div className="patch">{(t ?? "").split("\n").map((l, i) => <div key={i} className="pl"><span className="ln">{i + 1}</span><span className="code">{l || " "}</span></div>)}</div>
    </div>
  );
}
