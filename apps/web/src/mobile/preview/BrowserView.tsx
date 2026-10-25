import { useEffect, useState } from "react";
import { files } from "./api";
import { Zoomable } from "./Zoomable";
import { t } from "../../i18n";
import { trError } from "../../i18n/errors";

/**
 * Navegador do Kabul no celular, só leitura: a captura da página que o humano e os agentes estão usando
 * no computador, atualizada a cada ~1,5 s enquanto esta aba está na tela.
 */
export function BrowserView({ ws }: { ws: string }) {
  const [shot, setShot] = useState<{ data: string; url: string } | null | undefined>(undefined);
  const [agent, setAgent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      files.browserShot(ws).then((s) => alive && (setShot(s), setErr(null)), (e) => alive && setErr(String(e?.message ?? e)));
      files.browserStatus(ws).then((s) => alive && setAgent(s.agent && Date.now() - s.agent.at < 8000 && !s.paused ? s.agent.agent : null), () => {});
    };
    load();
    const iv = setInterval(load, 1500);
    return () => ((alive = false), clearInterval(iv));
  }, [ws]);
  if (err && shot === undefined) return <div className="m-error">{trError(err)}</div>;
  if (shot === undefined) return <div className="pv-loading dim">{t("mobile.pv.loading")}</div>;
  if (!shot) return <div className="m-empty dim" data-testid="pv-browser-closed">{t("mobile.pv.browser.closed")}</div>;
  return (
    <div className="pv-browser" data-testid="pv-browser">
      <div className="dim small m-pad m-ellipsis" data-testid="pv-browser-url">{shot.url}</div>
      {agent && <div className="small m-pad" data-testid="pv-browser-agent">{t("code.browser.agentControlling", { agent })}</div>}
      <Zoomable>
        <img className="pv-browser-img" src={`data:image/jpeg;base64,${shot.data}`} alt={shot.url} data-testid="pv-browser-img" />
      </Zoomable>
      <p className="dim small m-pad">{t("mobile.pv.browser.readOnly")}</p>
    </div>
  );
}
