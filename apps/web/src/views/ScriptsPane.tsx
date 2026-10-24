import { useEffect, useState } from "react";
import { api, type Repo, type RepoSettingsT, type Workspace } from "../api";
import { TerminalTab } from "./TerminalTab";
import { IPlay, IStop } from "../icons";

/** Aba Setup ou Run: botões dos scripts do settings.toml e o terminal da sessão do script. */
export function ScriptsPane({ ws, repo, which, onError, onConfigure }: { ws: Workspace; repo: Repo; which: "setup" | "run"; onError: (e: string) => void; onConfigure: () => void }) {
  const [settings, setSettings] = useState<RepoSettingsT | null>(null);
  const [session, setSession] = useState<string | null>(which === "setup" && ws.state !== "ready" ? `kabul-${ws.name}-setup` : null);

  useEffect(() => void api.repoSettings(repo.id).then((r) => setSettings(r.settings), (e) => onError(String(e))), [repo.id, onError]);

  if (!settings) return <div className="empty-state">Carregando…</div>;
  const runs = Object.entries(settings.scripts.run);
  const has = which === "setup" ? !!settings.scripts.setup : runs.length > 0;
  if (!has)
    return (
      <div className="empty-state">
        Nenhum script de {which} configurado para {repo.name}.
        <button className="btn" onClick={onConfigure}>Configurar scripts</button>
      </div>
    );

  const start = (runId: string | null) => api.runScript(ws.id, which, runId).then(setSession, (e) => onError(String(e)));
  return (
    <div className="scripts">
      <div className="script-bar">
        {which === "setup" ? (
          <>
            <code className="script-cmd">{settings.scripts.setup}</code>
            <span className={"badge " + (ws.state === "ready" ? "ok" : ws.state === "setup_failed" ? "bad" : "")}>{{ ready: "pronto", setting_up: "rodando", setup_failed: "falhou", initializing: "iniciando" }[ws.state] ?? ws.state}</span>
            <button className="btn" onClick={() => start(null)}><IPlay size={12} /> Rodar de novo</button>
          </>
        ) : (
          runs.map(([id, s]) => (
            <button key={id} className={"btn" + (session?.endsWith(`-run-${id}`) ? " on" : "")} title={s.command} onClick={() => start(id)}><IPlay size={12} /> {id}{s.default && <span className="dim small">padrão</span>}</button>
          ))
        )}
        <span className="grow" />
        {session && <button className="btn" onClick={() => api.stopScript(session).then(() => setSession(null), (e) => onError(String(e)))}><IStop size={12} /> Parar</button>}
      </div>
      {session ? <TerminalTab key={session} ws={ws} session={session} visible onError={onError} /> : <div className="empty-state">Escolha um script para rodar. Ele roda numa sessão tmux própria com KABUL_PORT={ws.port}.</div>}
    </div>
  );
}
