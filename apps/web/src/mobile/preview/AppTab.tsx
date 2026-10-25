import { useCallback, useEffect, useState } from "react";
import { canWrite } from "../kabuld";
import { files, type PortState, type ProxyOpened } from "./api";

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
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
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
  if (err && !st) return <div className="m-error">{err}</div>;
  if (!st) return <div className="pv-loading dim">Carregando…</div>;
  if (!st.base) return <div className="m-empty dim" data-testid="pv-app-noport">Este workspace não tem portas reservadas.</div>;
  const up = st.ports.filter((p) => p.listening);
  return (
    <div className="pv-app" data-testid="pv-app">
      <p className="dim small m-pad">Portas do workspace: {st.base}–{st.base + st.ports.length - 1} (<code>$KABUL_PORT</code>). Rode o app pelo Run no computador e abra aqui. Ele abre em outro endereço, só para você.</p>
      {up.length === 0 && <div className="m-empty dim" data-testid="pv-app-none">Nada rodando nas portas do workspace agora.</div>}
      {st.ports.map((p) => (
        <div key={p.port} className={"pv-row" + (p.listening ? "" : " off")} data-testid="pv-port" data-port={p.port} data-listening={p.listening}>
          <span className={"pv-badge" + (p.listening ? " new" : "")}>{p.listening ? "no ar" : "livre"}</span>
          <span className="pv-row-main"><b>:{p.port}</b>{links[p.port] && <a className="dim small m-ellipsis" href={links[p.port]} target="_blank" rel="noreferrer" data-testid="pv-port-link">{links[p.port]}</a>}</span>
          {p.listening && write && <button className="m-btn small primary" disabled={busy === p.port} onClick={() => void open(p.port)} data-testid="pv-port-open">{busy === p.port ? "Abrindo…" : "Abrir"}</button>}
        </div>
      ))}
      {!write && <div className="dim small m-pad">Abrir o app é de quem edita: observadores só acompanham.</div>}
      {err && <div className="m-error">{err}</div>}
    </div>
  );
}
