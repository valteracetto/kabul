import { useEffect, useState } from "react";
import { api, type AppSettings, type AppVersion, type UpdateInfo } from "../api";
import { transport } from "../transport";
import type { WsTransport } from "../transport/websocket";
import { APP_VERSION, type Compat } from "../version";
import { Row } from "../views/settingsUi";

const wsT = (): WsTransport | null => ("compat" in transport ? (transport as WsTransport) : null);

/** Compatibilidade com o kabuld (só quando o app fala com um por WebSocket). */
export function useCompat(): Compat {
  const [c, setC] = useState<Compat>(() => wsT()?.compat() ?? { kind: "ok" });
  useEffect(() => {
    const t = wsT();
    if (!t) return;
    setC(t.compat());
    return t.onState(() => setC(t.compat()));
  }, []);
  return c;
}

/** Aviso fixo no topo: kabuld de outra versão, ou atualização do app pronta para instalar. */
export function UpdateBanner() {
  const compat = useCompat();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => api.onUpdateAvailable((u) => (setUpdate(u), setHidden(false))), []);
  if (hidden) return null;
  if (compat.kind !== "ok") {
    return (
      <div className="update-banner warn" role="status" data-testid="version-mismatch">
        <span>{compat.message}</span>
        <button className="btn" onClick={() => setHidden(true)}>Entendi</button>
      </div>
    );
  }
  if (!update) return null;
  const install = () => {
    setBusy(true);
    setErr(null);
    api.updateInstall().catch((e) => (setErr(String(e)), setBusy(false)));
  };
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span>Kabul {update.version} disponível{update.channel === "beta" ? " (beta)" : ""}. {err ?? ""}</span>
      <button className="btn primary" disabled={busy} onClick={install} data-testid="update-install">{busy ? "Instalando…" : "Instalar e reiniciar"}</button>
      <button className="btn" onClick={() => setHidden(true)}>Depois</button>
    </div>
  );
}

/** Configurações › Avançado › Atualizações. */
export function UpdatesSection({ s, save }: { s: AppSettings; save: (s: AppSettings) => void }) {
  const [ver, setVer] = useState<AppVersion | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "checking" | "none" | "error" | "found" | "installing"; text?: string; update?: UpdateInfo }>({ kind: "idle" });
  // Sem o comando (kabuld ou `kabul serve` no navegador) o updater não existe: mostra só a versão.
  useEffect(() => void api.appVersion().then(setVer, () => setVer({ version: APP_VERSION, protocol: 1, channel: "stable", updater: false })), []);
  const channel = s.update_channel ?? "stable";
  const on = s.auto_update ?? true;
  const check = (ch = channel) => {
    setState({ kind: "checking" });
    api.updateCheck(ch).then((u) => setState(u ? { kind: "found", update: u } : { kind: "none" }), (e) => setState({ kind: "error", text: String(e) }));
  };
  const install = () => {
    setState((x) => ({ ...x, kind: "installing" }));
    api.updateInstall().catch((e) => setState({ kind: "error", text: String(e) }));
  };
  const status =
    state.kind === "checking" ? "Procurando…"
    : state.kind === "none" ? `Você já está na versão mais nova (${ver?.version ?? APP_VERSION}).`
    : state.kind === "error" ? state.text
    : state.kind === "found" || state.kind === "installing" ? `Kabul ${state.update?.version} disponível.`
    : null;
  return (
    <>
      <Row label="Versão do Kabul" hint={ver ? `Protocolo do kabuld v${ver.protocol}` : undefined}><code className="small" data-testid="app-version">{ver?.version ?? APP_VERSION}</code></Row>
      {ver?.updater !== false && (
        <>
          <Row label="Atualizações automáticas" hint="Procura uma versão nova ao abrir o app e avisa no topo; a instalação só acontece quando você confirmar">
            <span className={"toggle" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label="Atualizações automáticas" tabIndex={0}
              onClick={() => save({ ...s, auto_update: !on })} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), save({ ...s, auto_update: !on }))} data-testid="toggle-auto_update"><span /></span>
          </Row>
          <Row label="Canal de atualização" hint="Beta recebe as versões de teste antes (e também as estáveis)">
            <select value={channel} onChange={(e) => save({ ...s, update_channel: e.target.value })} data-testid="update-channel">
              <option value="stable">Estável</option>
              <option value="beta">Beta</option>
            </select>
          </Row>
          <Row label="Procurar atualizações" hint={status ? <span data-testid="update-status">{status}</span> : undefined}>
            <div className="row">
              {(state.kind === "found" || state.kind === "installing") && <button className="btn primary" disabled={state.kind === "installing"} onClick={install} data-testid="update-install-now">{state.kind === "installing" ? "Instalando…" : "Instalar e reiniciar"}</button>}
              <button className="btn" disabled={state.kind === "checking" || state.kind === "installing"} onClick={() => check()} data-testid="update-check">Procurar agora</button>
            </div>
          </Row>
        </>
      )}
    </>
  );
}
