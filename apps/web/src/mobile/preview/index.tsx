import { useEffect, useState } from "react";
import { canWrite, k } from "../kabuld";
import { base, dir, files, type Scope } from "./api";
import { AppTab } from "./AppTab";
import { AskSheet } from "./Ask";
import { ChangesList, DiffView } from "./Diff";
import { fileList, useFileSet } from "./hooks";
import { back, filesHash, go, type FilesRoute, type Tab } from "./route";
import { Tree } from "./Tree";
import { Viewer, type AskTarget } from "./Viewer";
import "./preview.css";

export { filesRoute, openFile, openFiles } from "./route";
export { ChangedChips, chatFileOpener, FilesButton, useFileTaps } from "./ChatLinks";

const TABS: [Tab, string][] = [["files", "Arquivos"], ["changes", "Alterações"], ["app", "App"]];

/**
 * Arquivos de um workspace no celular: árvore com busca, alterações com diff, preview de cada tipo,
 * o app rodando (proxy do Run) e "perguntar no chat" sobre um trecho. Tudo pelo kabuld, com as
 * regras de `file_url`/`file_list` (só dentro do workspace, convidado sem segredos).
 */
export function FilesScreen({ route }: { route: FilesRoute }) {
  const { ws, tab, path, diff, line, from } = route;
  const [title, setTitle] = useState("");
  const [list, setList] = useState<string[] | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(() => (sessionStorage.getItem("kabul.pv.scope") as Scope) || "all");
  const [ask, setAsk] = useState<AskTarget | null>(null);
  const known = useFileSet(ws);
  useEffect(() => {
    k.workspaces().then((l) => {
      const w = l.find((x) => x.id === ws);
      setTitle(w ? w.title || w.name : "Workspace");
    }, () => {});
  }, [ws]);
  useEffect(() => {
    if (path || diff) return;
    fileList(ws, true).then(setList, (e) => setErr(String(e?.message ?? e)));
    files.changes(ws, "all").then((c) => setChanged(new Set(c.map((x) => x.path))), () => {});
  }, [ws, path, diff]);
  // Links http(s) do Markdown abrem fora (na PWA, numa aba do navegador).
  useEffect(() => {
    const h = (e: Event) => {
      const u = String((e as CustomEvent).detail ?? "");
      if (/^https?:\/\//.test(u)) window.open(u, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("kabul:open-url", h);
    return () => window.removeEventListener("kabul:open-url", h);
  }, []);
  const onAsk = canWrite() ? setAsk : undefined;
  const parent = path || diff ? filesHash({ ws, tab: diff ? "changes" : tab, from }) : from ? `s=${encodeURIComponent(from)}` : "";
  const open = (p: string, l?: number | null) => go({ ws, path: p, line: l ?? null, from });
  const sub = path ?? diff;
  return (
    <div className="m-app pv-app" data-testid="pv-screen">
      <header className="m-top">
        <button className="m-btn ghost" onClick={() => back(parent)} data-testid="pv-back" aria-label="Voltar">‹</button>
        <div className="m-top-title">
          <b className="m-ellipsis" data-testid="pv-title">{sub ? base(sub) : title || "Arquivos"}</b>
          <span className="dim small m-ellipsis">{sub ? `${diff ? "Diff · " : ""}${dir(sub) || title}` : "Arquivos do workspace"}</span>
        </div>
      </header>
      {!sub && (
        <div className="m-tabs" role="tablist">
          {TABS.map(([t, l]) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => go({ ws, tab: t, from }, true)} data-testid={`pv-tab-${t}`} role="tab" aria-selected={tab === t}>
              {l}{t === "changes" && changed.size > 0 && <span className="m-count">{changed.size}</span>}
            </button>
          ))}
        </div>
      )}
      <main className="m-scroll pv-main">
        {err && <div className="m-error">{err}</div>}
        {path ? (
          <Viewer key={path} ws={ws} path={path} line={line} known={known} onOpen={open} onAsk={onAsk} />
        ) : diff ? (
          <DiffView key={diff} ws={ws} path={diff} scope={scope} onAsk={onAsk} onOpenFile={(l) => open(diff, l)} />
        ) : tab === "changes" ? (
          <ChangesList ws={ws} scope={scope} onScope={(s) => (setScope(s), sessionStorage.setItem("kabul.pv.scope", s))} onOpen={(c) => go({ ws, diff: c.path, from })} />
        ) : tab === "app" ? (
          <AppTab ws={ws} />
        ) : list ? (
          <Tree ws={ws} list={list} changed={changed} onOpen={(p) => open(p)} />
        ) : (
          !err && <div className="pv-loading dim">Carregando…</div>
        )}
      </main>
      {ask && <AskSheet ws={ws} target={ask} from={from} onClose={() => setAsk(null)} />}
    </div>
  );
}
