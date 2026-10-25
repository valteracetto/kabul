import { useEffect, useState } from "react";
import { t } from "../i18n";
import { api, type Repo, type RepoSettingsT, type Workspace } from "../api";
import { TerminalTab } from "./TerminalLazy";
import { IPlay, IStop } from "../icons";

/** Aba Setup ou Run: botões dos scripts do settings.toml e o terminal da sessão do script. */
export function ScriptsPane({ ws, repo, which, onError, onConfigure }: { ws: Workspace; repo: Repo; which: "setup" | "run"; onError: (e: string) => void; onConfigure: () => void }) {
  const [settings, setSettings] = useState<RepoSettingsT | null>(null);
  const [session, setSession] = useState<string | null>(which === "setup" && ws.state !== "ready" ? `kabul-${ws.name}-setup` : null);

  useEffect(() => void api.repoSettings(repo.id).then((r) => setSettings(r.settings), (e) => onError(String(e))), [repo.id, onError]);

  if (!settings) return <div className="empty-state">{t("common.loading")}</div>;
  const runs = Object.entries(settings.scripts.run);
  const has = which === "setup" ? !!settings.scripts.setup : runs.length > 0;
  if (!has)
    return (
      <div className="empty-state">
        {t("code.scripts.none", { which, repo: repo.name })}
        <button className="btn" onClick={onConfigure}>{t("code.scripts.configure")}</button>
      </div>
    );

  const start = (runId: string | null) => api.runScript(ws.id, which, runId).then(setSession, (e) => onError(String(e)));
  return (
    <div className="scripts">
      <div className="script-bar">
        {which === "setup" ? (
          <>
            <code className="script-cmd">{settings.scripts.setup}</code>
            <span className={"badge " + (ws.state === "ready" ? "ok" : ws.state === "setup_failed" ? "bad" : "")}>{({ ready: t("code.scripts.state.ready"), setting_up: t("code.scripts.state.setting_up"), setup_failed: t("code.scripts.state.setup_failed"), initializing: t("code.scripts.state.initializing") } as Record<string, string>)[ws.state] ?? ws.state}</span>
            <button className="btn" onClick={() => start(null)}><IPlay size={12} /> {t("code.scripts.rerun")}</button>
          </>
        ) : (
          runs.map(([id, s]) => (
            <button key={id} className={"btn" + (session?.endsWith(`-run-${id}`) ? " on" : "")} title={s.command} onClick={() => start(id)}><IPlay size={12} /> {id}{s.default && <span className="dim small">{t("code.scripts.default")}</span>}</button>
          ))
        )}
        <span className="grow" />
        {session && <button className="btn" onClick={() => api.stopScript(session).then(() => setSession(null), (e) => onError(String(e)))}><IStop size={12} /> {t("common.stop")}</button>}
      </div>
      {session ? <TerminalTab key={session} ws={ws} session={session} visible onError={onError} /> : <div className="empty-state">{t("code.scripts.pick", { port: ws.port })}</div>}
    </div>
  );
}
