import { useState } from "react";
import { k, type NetStatus } from "../mobile/kabuld";

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
          <div>HTTPS pelo Tailscale</div>
          <div className="dim small">No iPhone, instalar o Kabul na Tela de Início (PWA), receber notificações e usar o microfone para ditado <b>exigem HTTPS</b>. Sem HTTPS, o celular abre <code>http://100.x.y.z</code>: lista, terminal e chat funcionam, o resto não. O Kabul usa o <code>tailscale serve</code>, que fica visível só na sua tailnet.</div>
        </div>
        {on ? (
          confirmOff ? (
            <div className="row">
              <button className="btn" onClick={() => setConfirmOff(false)}>Cancelar</button>
              <button className="btn danger" disabled={busy} onClick={() => run(false)} data-testid="remote-https-off-confirm">Desligar</button>
            </div>
          ) : (
            <button className="btn" disabled={busy} onClick={() => setConfirmOff(true)} data-testid="remote-https">Desligar HTTPS</button>
          )
        ) : unsupported ? (
          <button className="btn primary" disabled={busy} onClick={retry} data-testid="remote-https-retry">{busy ? "Conferindo…" : "Tentar de novo"}</button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={() => run(true)} data-testid="remote-https">{busy ? "Ligando…" : "Ativar HTTPS"}</button>
        )}
      </div>
      {on && url && (
        <div className="remote-https-on" data-testid="remote-https-url">
          <span className="badge ok">HTTPS ligado</span> <code>{url}</code>{" "}
          <button className="btn" onClick={() => navigator.clipboard?.writeText(url).catch(() => {})}>Copiar</button>
          <div className="dim small">O QR de pareamento abaixo já usa este endereço.{confirmOff ? " Desligar remove a regra da porta 443 do tailscale serve." : ""}</div>
        </div>
      )}
      {unsupported && (
        <div className="remote-https-help" data-testid="remote-https-help">
          <b>Falta habilitar o HTTPS na sua tailnet</b>
          <ol>
            <li>Abra o painel de DNS do Tailscale: <a className="md-link" href={net.admin_url ?? "https://login.tailscale.com/admin/dns"} onClick={(e) => (e.preventDefault(), openUrl(net.admin_url ?? "https://login.tailscale.com/admin/dns"))} data-testid="remote-https-admin">login.tailscale.com/admin/dns</a></li>
            {net.magic_dns === false && <li>Ligue o <b>MagicDNS</b>.</li>}
            <li>Em <b>HTTPS Certificates</b>, clique em <b>Enable HTTPS</b>.</li>
            <li>Volte aqui e toque em <b>Tentar de novo</b>.</li>
          </ol>
          <div className="dim small">O Kabul não muda a configuração da sua tailnet: isso é feito por você no painel.</div>
        </div>
      )}
      {err && (unsupported && err === net.https_help ? (
        <div className="dim small" data-testid="remote-https-error">Conferi de novo: a tailnet ainda não está habilitada para HTTPS.</div>
      ) : (
        <div className="error remote-https-err" data-testid="remote-https-error"><Linked text={err} /></div>
      ))}
      {err && !unsupported && <button className="btn" disabled={busy} onClick={retry} data-testid="remote-https-retry">Tentar de novo</button>}
      {net.cli && <div className="dim small">Tailscale: <code>{net.cli}</code></div>}
    </div>
  );
}
