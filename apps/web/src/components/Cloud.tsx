import { useEffect, useState } from "react";
import { trError } from "../i18n/errors";
import { t } from "../i18n";
import { api, type CloudInfo, type Workspace } from "../api";
import { TerminalTab } from "../views/TerminalLazy";

/** Diálogo "Nova sessão na nuvem (Claude)": prompt e ambiente opcional (`--environment`). */
export function CloudDialog({ ws, onClose, onCreated, onError }: { ws: Workspace; onClose: () => void; onCreated: (tmux: string, info: CloudInfo) => void; onError: (e: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.cloudStart(ws.id, prompt.trim(), env.trim() || null);
      if (!r.info.id) throw new Error(r.info.warning ?? t("code.cloud.noSession"));
      onCreated(r.tmux, r.info);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay center" onMouseDown={onClose}>
      <div className="popover confirm" onMouseDown={(e) => e.stopPropagation()} data-testid="cloud-dialog" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="confirm-msg"><b>{t("code.cloud.title")}</b><div className="dim small">{t("code.cloud.lead", { branch: ws.branch })}</div></div>
        <textarea autoFocus rows={4} placeholder={t("code.cloud.prompt")} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.metaKey && prompt.trim() && go()} />
        <input placeholder={t("code.cloud.env")} value={env} onChange={(e) => setEnv(e.target.value)} />
        <div className="row end"><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" disabled={!prompt.trim() || busy} onClick={go} data-testid="cloud-go">{busy ? t("code.cloud.creating") : t("code.cloud.create")}</button></div>
      </div>
    </div>
  );
}

/** Aba ☁︎: status da sessão de nuvem, links e "Trazer para o Mac" (`claude --teleport`). */
export function CloudTab({ ws, tmux, initial, onTeleport, onError }: { ws: Workspace; tmux: string; initial: CloudInfo; onTeleport: (session: string) => void; onError: (e: string) => void }) {
  const [info, setInfo] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => api.cloudPoll(tmux).then((i) => setInfo((o) => ({ ...o, ...Object.fromEntries(Object.entries(i).filter(([, v]) => v != null)) })), () => {}), 3000);
    return () => clearInterval(timer);
  }, [tmux]);
  return (
    <div className="cloud-tab" data-testid="cloud-tab">
      <div className="cloud-head">
        <span className="cloud-badge">{t("code.cloud.badge")}</span>
        <b className="cloud-title">{info.title ?? t("code.cloud.session")}</b>
        <code className="dim small">{info.id}</code>
        <span className="grow" />
        {info.url && <button className="btn" onClick={() => api.openExternal(info.url!)} data-testid="cloud-open">{t("code.cloud.openWeb")}</button>}
        {info.id && <button className="btn primary" onClick={() => api.teleport(ws.id, info.id!).then(onTeleport, (e) => onError(String(e)))} data-testid="cloud-teleport">{t("code.cloud.teleport")}</button>}
      </div>
      {info.warning && <div className="cloud-warn">{trError(info.warning)}</div>}
      <div className="cloud-term"><TerminalTab ws={ws} session={tmux} visible onError={onError} /></div>
    </div>
  );
}
