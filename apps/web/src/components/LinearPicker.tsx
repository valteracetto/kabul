import { useEffect, useRef, useState } from "react";
import { api, type LinearIssue, type Repo, type Workspace } from "../api";
import { ISearch } from "../icons";
import { t } from "../i18n";

/** Escolher uma issue do Linear e criar o workspace a partir dela (branch e título da issue). */
export function LinearPicker({ repos, defaultRepo, onClose, onCreated, onError, onConnect }: {
  repos: Repo[]; defaultRepo?: string; onClose: () => void; onCreated: (w: Workspace, issue: LinearIssue) => void; onError: (e: string) => void; onConnect: () => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [list, setList] = useState<LinearIssue[]>([]);
  const [repo, setRepo] = useState(defaultRepo ?? repos[0]?.id ?? "");
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => void api.linearStatus().then((s) => setConnected(s.connected), () => setConnected(false)), []);
  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => api.linearIssues(q || null).then((l) => (setList(l), setSel(0)), (e) => onError(String(e))), 200);
    return () => clearTimeout(timer);
  }, [q, connected]);
  useEffect(() => void input.current?.focus(), [connected]);
  const create = async (i: LinearIssue) => {
    if (!repo) return onError(t("chat.linear.addRepoFirst"));
    setBusy(true);
    try {
      onCreated(await api.workspaceFromIssue(repo, i), i);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover palette" onMouseDown={(e) => e.stopPropagation()} data-testid="linear-picker">
        {connected === false ? (
          <div className="pad">
            <p>{t("chat.linear.connect")}</p>
            <button className="btn primary" onClick={onConnect}>{t("chat.linear.openIntegrations")}</button>
          </div>
        ) : (
          <>
            <label className="pop-search">
              <ISearch />
              <input ref={input} placeholder={t("chat.linear.search")} value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, list.length - 1)));
                  if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
                  if (e.key === "Enter" && list[sel]) create(list[sel]);
                }} />
              <select value={repo} onChange={(e) => setRepo(e.target.value)} title={t("chat.linear.repo")}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </label>
            <div className="pop-sep" />
            <div className="pop-list">
              {busy && <div className="pop-row dim"><span className="spinner" /> {t("chat.linear.creating")}</div>}
              {list.map((i, k) => (
                <div key={i.id} className={"pop-row" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => create(i)} data-testid="linear-issue">
                  <span className="issue-id">{i.identifier}</span><span className="label">{i.title}</span><span className="grow" /><span className="dim small">{i.state}</span>
                </div>
              ))}
              {connected && !busy && list.length === 0 && <div className="pop-row dim">{t("chat.linear.none")}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
