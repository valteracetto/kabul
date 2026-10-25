import { useState } from "react";
import { k, type NetStatus } from "../mobile/kabuld";
import { t } from "../i18n";
import { tNode } from "../i18n/react";
import { trError } from "../i18n/errors";

/** Campos do `remote_status.net` sobre HTTPS (kabuld recente). */
export type HttpsInfo = NetStatus & { https_supported?: boolean | null; magic_dns?: boolean | null; https_help?: string | null; admin_url?: string | null; cli?: string | null };

const openUrl = (url: string) => window.dispatchEvent(new CustomEvent("kabul:open-url", { detail: url }));

/** Texto com URLs clicáveis (a saída do `tailscale serve` pode trazer o link do painel). */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s)]+)/g);
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} className="md-link" href={p} onClick={(e) => (e.preventDefault(), openUrl(p))}>{p}</a> : p))}</>;
}

/**
 * HTTPS pelo Tailscale (Configurações › Celular e remoto). Antes de rodar o `tailscale serve`, o
 * kabuld confere se a tailnet emite certificado; sem isso, mostra o que ligar no painel e "Tentar de
 * novo". Erros saem com a saída real do comando. Ligado, mostra a URL `https://…ts.net/m/` (o QR de
 * pareamento passa a usar ela).
 */
export function RemoteHttps({ net, onChange }: { net: HttpsInfo; onChange: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const on = !!net.https_url;
  const unsupported = !on && net.https_supported === false;
  const run = async (want: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await k.https(want);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      await onChange();
      setBusy(false);
      setConfirmOff(false);
    }
  };
  // "Tentar de novo": relê o estado da tailnet e, se o HTTPS já estiver habilitado, liga.
  const retry = () => run(true);
  const url = on ? `${net.https_url}/m/` : null;
  return (
    <div className="set-group remote-https" data-testid="remote-https-box">
      <div className="set-row">
        <div>
          <div>{t("settings.https.title")}</div>
          <div className="dim small">{tNode("settings.https.lead", { required: <b>{t("settings.https.required")}</b>, http: <code>http://100.x.y.z</code>, serve: <code>tailscale serve</code> })}</div>
        </div>
        {on ? (
          confirmOff ? (
            <div className="row">
              <button className="btn" onClick={() => setConfirmOff(false)}>{t("common.cancel")}</button>
              <button className="btn danger" disabled={busy} onClick={() => run(false)} data-testid="remote-https-off-confirm">{t("common.turnOff")}</button>
            </div>
          ) : (
            <button className="btn" disabled={busy} onClick={() => setConfirmOff(true)} data-testid="remote-https">{t("settings.https.off")}</button>
          )
        ) : unsupported ? (
          <button className="btn primary" disabled={busy} onClick={retry} data-testid="remote-https-retry">{busy ? t("settings.https.checking") : t("common.retry")}</button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={() => run(true)} data-testid="remote-https">{busy ? t("settings.https.turningOn") : t("settings.https.enable")}</button>
        )}
      </div>
      {on && url && (
        <div className="remote-https-on" data-testid="remote-https-url">
          <span className="badge ok">{t("settings.https.on")}</span> <code>{url}</code>{" "}
          <button className="btn" onClick={() => navigator.clipboard?.writeText(url).catch(() => {})}>{t("common.copy")}</button>
          <div className="dim small">{t("settings.https.qrUses")}{confirmOff ? t("settings.https.offNote") : ""}</div>
        </div>
      )}
      {unsupported && (
        <div className="remote-https-help" data-testid="remote-https-help">
          <b>{t("settings.https.missing")}</b>
          <ol>
            <li>{tNode("settings.https.step1", { link: <a className="md-link" href={net.admin_url ?? "https://login.tailscale.com/admin/dns"} onClick={(e) => (e.preventDefault(), openUrl(net.admin_url ?? "https://login.tailscale.com/admin/dns"))} data-testid="remote-https-admin">{"login.tailscale.com/admin/dns"}</a> })}</li> {/* i18n-ignore: URL do painel do Tailscale */}
            {net.magic_dns === false && <li>{tNode("settings.https.step2", { magic: <b>{"MagicDNS"}</b> })}</li>} {/* i18n-ignore: nome de recurso do Tailscale */}
            <li>{tNode("settings.https.step3", { certs: <b>{"HTTPS Certificates"}</b>, enable: <b>{"Enable HTTPS"}</b> })}</li> {/* i18n-ignore: rótulos do painel do Tailscale (em inglês) */}
            <li>{tNode("settings.https.step4", { retry: <b>{t("common.retry")}</b> })}</li>
          </ol>
          <div className="dim small">{t("settings.https.noChange")}</div>
        </div>
      )}
      {err && (unsupported && err === net.https_help ? (
        <div className="dim small" data-testid="remote-https-error">{t("settings.https.stillOff")}</div>
      ) : (
        <div className="error remote-https-err" data-testid="remote-https-error"><Linked text={trError(err)} /></div>
      ))}
      {err && !unsupported && <button className="btn" disabled={busy} onClick={retry} data-testid="remote-https-retry">{t("common.retry")}</button>}
      {net.cli && <div className="dim small">Tailscale: <code>{net.cli}</code></div>}
    </div>
  );
}
