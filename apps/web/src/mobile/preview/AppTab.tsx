import { useCallback, useEffect, useState } from "react";
import { canWrite } from "../kabuld";
import { files, type PortState, type ProxyOpened } from "./api";
import { t } from "../../i18n";
import { tNode } from "../../i18n/react";
import { trError } from "../../i18n/errors";

/** Link do proxy com o host por onde este aparelho chegou (IP ou localhost); senão o IP da tailnet. */
export function proxyLink(o: ProxyOpened, loc: { hostname: string } = location): string {
  const h = loc.hostname;
  const literal = h === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("[");
  return literal ? `http://${h}:${o.port}${o.path}` : o.url;
}

/**
 * "App": o que o workspace está rodando (as 10 portas dele) aberto no celular pelo proxy do kabuld.
 * O app abre num endereço próprio (outra porta), nunca no origin do Kabul; o link de entrada vale 2
 * minutos e uma vez só, e vira um cookie daquele endereço.
 */
export function AppTab({ ws }: { ws: string }) {
  const [st, setSt] = useState<{ base: number; ports: PortState[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => files.ports(ws).then(setSt, (e) => setErr(String(e?.message ?? e))), [ws]);
  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);
  const open = async (port: number) => {
    setBusy(port);
    setErr(null);
    // A janela abre já no toque (o Safari bloqueia window.open depois de um await).
    const w = window.open("about:blank", "_blank");
    try {
      const url = proxyLink(await files.proxy(ws, port));
      // O link de entrada é de uso único; depois dele, a raiz do app vale (cookie daquele endereço).
      // Janela bloqueada: fica o link de entrada para tocar.
      setLinks((l) => ({ ...l, [port]: w ? new URL(url).origin + "/" : url }));
      if (w) w.location.href = url;
    } catch (e) {
      w?.close();
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };
  const write = canWrite();
  if (err && !st) return <div className="m-error">{trError(err)}</div>;
  if (!st) return <div className="pv-loading dim">{t("mobile.pv.loading")}</div>;
  if (!st.base) return <div className="m-empty dim" data-testid="pv-app-noport">{t("mobile.pv.app.noPorts")}</div>;
  const up = st.ports.filter((p) => p.listening);
  return (
    <div className="pv-app" data-testid="pv-app">
      <p className="dim small m-pad">{tNode("mobile.pv.app.lead", { from: st.base, to: st.base + st.ports.length - 1, var: <code>$KABUL_PORT</code> })}</p>
      {up.length === 0 && <div className="m-empty dim" data-testid="pv-app-none">{t("mobile.pv.app.none")}</div>}
      {st.ports.map((p) => (
        <div key={p.port} className={"pv-row" + (p.listening ? "" : " off")} data-testid="pv-port" data-port={p.port} data-listening={p.listening}>
          <span className={"pv-badge" + (p.listening ? " new" : "")}>{p.listening ? t("mobile.pv.app.up") : t("mobile.pv.app.free")}</span>
          <span className="pv-row-main"><b>:{p.port}</b>{links[p.port] && <a className="dim small m-ellipsis" href={links[p.port]} target="_blank" rel="noreferrer" data-testid="pv-port-link">{links[p.port]}</a>}</span>
          {p.listening && write && <button className="m-btn small primary" disabled={busy === p.port} onClick={() => void open(p.port)} data-testid="pv-port-open">{busy === p.port ? t("mobile.pv.app.opening") : t("common.open")}</button>}
        </div>
      ))}
      {!write && <div className="dim small m-pad">{t("mobile.pv.app.observer")}</div>}
      {err && <div className="m-error">{trError(err)}</div>}
    </div>
  );
}
