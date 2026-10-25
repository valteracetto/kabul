import { useCallback, useEffect, useState } from "react";
import { api, wsTitle, type Workspace } from "../api";
import { transport } from "../transport";
import { pairWith, parsePairLink } from "../transport/credentials";
import { k, type Device, type FoundMachine, type RemoteStatus, type Ticket } from "../mobile/kabuld";
import { TicketCard, useCountdown } from "../mobile/ui";
import { machines, normalizeUrl, saveMachines } from "./machines";
import { RemoteHttps } from "./RemoteHttps";
import "../mobile/mobile.css";
import { t } from "../i18n";
import { tNode } from "../i18n/react";
import { trError } from "../i18n/errors";
import { fmtDate } from "../i18n/format";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
interface Embedded { running: boolean; port: number; enabled: boolean; error: string | null }
const DISCOVERED = "kabul.discovered";

/** Máquinas da tailnet com kabuld achadas na última busca (o seletor do topo também lista). */
export const discovered = (): FoundMachine[] => {
  try {
    return JSON.parse(localStorage.getItem(DISCOVERED) ?? "[]");
  } catch {
    return [];
  }
};

/**
 * Configurações › Celular e remoto: liga o kabuld (no app desktop), pareia aparelhos por QR,
 * lista e revoga dispositivos, convida amigos para um workspace e acha outras máquinas da tailnet.
 */
export function RemotePanel({ onError }: { onError: (e: string) => void }) {
  const [emb, setEmb] = useState<Embedded | null>(null);
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const running = isTauri ? !!emb?.running : !!st;
  const refresh = useCallback(async () => {
    if (isTauri) setEmb(await transport.call<Embedded>("kabuld_status").catch(() => null));
    setSt(await k.status().catch(() => null));
  }, []);
  useEffect(() => void refresh(), [refresh]);
  const toggle = async () => {
    setBusy(true);
    try {
      setEmb(await transport.call<Embedded>(emb?.running ? "kabuld_stop" : "kabuld_start", {}));
      await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="set-group remote-panel" data-testid="remote-panel">
      <p className="dim small">{tNode("settings.remote.lead", { kabuld: <code>kabuld</code> })}</p>
      <div className="set-row">
        <div>
          <div>{t("settings.remote.server")}</div>
          <div className="dim small" data-testid="remote-address">{running && st ? st.base_url : t("settings.remote.off")}</div>
        </div>
        {isTauri ? (
          <button className={"btn" + (emb?.running ? "" : " primary")} disabled={busy} onClick={toggle} data-testid="remote-toggle">{emb?.running ? t("common.turnOff") : t("common.turnOn")}</button>
        ) : (
          <span className="badge ok" data-testid="remote-on">{t("settings.remote.onBadge")}</span>
        )}
      </div>
      {emb?.error && <div className="error">{trError(emb.error)}</div>}
      {running && st && <NetRow st={st} onChange={refresh} onError={onError} />}
      {running && (
        <>
          <h3>{t("settings.remote.pairPhone")}</h3>
          {/* Endereço novo (ex.: HTTPS ligado): QR novo já com ele. */}
          <PairQr key={st?.base_url ?? ""} />
          <h3>{t("settings.remote.devices")}</h3>
          <Devices onError={onError} />
          <h3>{t("settings.remote.invite")}</h3>
          <Invite onError={onError} />
        </>
      )}
      <h3>{t("settings.remote.otherMachines")}</h3>
      <OtherMachines running={running} onError={onError} />
    </div>
  );
}

function NetRow({ st, onChange }: { st: RemoteStatus; onChange: () => Promise<void> | void; onError: (e: string) => void }) {
  const ts = st.net;
  const tailnet = ts.kind === "tailscale" && ts.up;
  return (
    <>
      <div className="set-row" data-testid="remote-net">
        <div>
          <div>Tailscale</div>
          <div className="dim small">{tailnet ? `${ts.dns_name ?? ""} ${ts.ips.join(" ")}` : ts.kind === "localhost" ? t("settings.remote.netOff") : (ts.message && trError(ts.message)) ?? t("settings.remote.onlyThis")}</div>
        </div>
        <span className={"badge" + (tailnet ? " ok" : "")} data-testid="remote-net-badge">{tailnet ? t("settings.remote.connected") : t("settings.remote.localOnly")}</span>
      </div>
      {tailnet && <RemoteHttps net={ts} onChange={onChange} />}
      <div className="dim small">{t("settings.remote.secrets", { where: st.secrets === "keyring" ? t("settings.remote.keyring") : st.secrets, push: st.push })}</div>
    </>
  );
}

function PairQr() {
  const [tk, setT] = useState<Ticket | null>(null);
  const [big, setBig] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const left = useCountdown(tk?.expires_at ?? null);
  const make = useCallback(() => k.pairCreate().then(setT, (e) => setErr(String(e))), []);
  useEffect(() => void make(), [make]);
  return (
    <div className="remote-pair">
      <p className="dim small">{t("settings.remote.pairLead")}</p>
      {tk && <TicketCard svg={tk.qr_svg} url={tk.url} left={left} onRegen={make} onBig={() => setBig(true)} />}
      {tk && <button className="btn" onClick={() => setBig(true)} data-testid="pair-enlarge">{t("settings.remote.enlarge")}</button>}
      {err && <div className="error">{trError(err)}</div>}
      {big && tk && (
        <div className="m-sheet-bg remote-big" onClick={() => setBig(false)} data-testid="pair-big">
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-head"><b>{t("settings.remote.pairPhone")}</b><button className="m-btn ghost" onClick={() => setBig(false)}>{t("common.close")}</button></div>
            <TicketCard svg={tk.qr_svg} url={tk.url} left={left} onRegen={make} big />
          </div>
        </div>
      )}
    </div>
  );
}

function Devices({ onError }: { onError: (e: string) => void }) {
  const [list, setList] = useState<Device[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = useCallback(() => k.devices().then(setList, () => {}), []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);
  const when = (s: number | null) => (s ? fmtDate(s * 1000, "datetime") : "—");
  if (list.length === 0) return <div className="dim small" data-testid="devices-empty">{t("settings.remote.noDevices")}</div>;
  return (
    <div>
      {list.map((d) => (
        <div key={d.id} className="set-row" data-testid="device-row">
          <div>
            <div><span className="m-avatar" style={{ background: d.color, width: 18, height: 18, fontSize: 10, marginRight: 6 }}>{d.user.slice(0, 1).toUpperCase()}</span>{d.user} · {d.name}</div>
            <div className="dim small">{d.role === "owner" ? t("settings.remote.role.owner") : d.role === "editor" ? t("settings.remote.role.editor") : t("settings.remote.role.observer")}{d.scope.kind === "workspace" ? t("settings.remote.ofWorkspace") : ""}{t("settings.remote.seen", { when: when(d.last_seen) })}</div>
          </div>
          {confirm === d.id ? (
            <div className="row">
              <button className="btn" onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
              <button className="btn danger" onClick={() => k.revoke(d.id).then(() => (setConfirm(null), load()), (e) => onError(String(e)))} data-testid="device-revoke-confirm">{t("settings.remote.revokeNow")}</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirm(d.id)} data-testid="device-revoke">{t("settings.remote.revoke")}</button>
          )}
        </div>
      ))}
    </div>
  );
}

function Invite({ onError }: { onError: (e: string) => void }) {
  const [wss, setWss] = useState<Workspace[]>([]);
  const [ws, setWs] = useState("");
  const [role, setRole] = useState<"editor" | "observer">("editor");
  const [tk, setT] = useState<Ticket | null>(null);
  const left = useCountdown(tk?.expires_at ?? null);
  useEffect(() => void api.workspaces().then((l) => (setWss(l.filter((w) => !w.archived)), setWs((x) => x || l.find((w) => !w.archived)?.id || "")), () => {}), []);
  if (wss.length === 0) return <div className="dim small">{t("settings.remote.inviteNeedsWs")}</div>;
  return (
    <div>
      <p className="dim small">{t("settings.remote.inviteLead")}</p>
      <div className="row env-row">
        <select value={ws} onChange={(e) => (setWs(e.target.value), setT(null))} data-testid="invite-ws">{wss.map((w) => <option key={w.id} value={w.id}>{wsTitle(w)}</option>)}</select>
        <select value={role} onChange={(e) => (setRole(e.target.value as "editor" | "observer"), setT(null))} data-testid="invite-role"><option value="editor">{t("settings.remote.inviteEditor")}</option><option value="observer">{t("settings.remote.inviteObserver")}</option></select>
        <button className="btn primary" onClick={() => k.invite(ws, role).then(setT, (e) => onError(String(e)))} data-testid="invite-go">{t("settings.remote.inviteGo")}</button>
      </div>
      {tk && <TicketCard svg={tk.qr_svg} url={tk.url} left={left} />}
    </div>
  );
}

function OtherMachines({ running, onError }: { running: boolean; onError: (e: string) => void }) {
  const [found, setFound] = useState<FoundMachine[]>(discovered);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const scan = () => {
    setBusy(true);
    k.discover()
      .then((f) => (setFound(f), localStorage.setItem(DISCOVERED, JSON.stringify(f.filter((m) => m.kabuld)))), (e) => onError(String(e)))
      .finally(() => setBusy(false));
  };
  const parsed = parsePairLink(link);
  const pair = async () => {
    if (!parsed?.base) return;
    try {
      const info = await api.machineInfo().catch(() => null);
      const p = await pairWith(parsed.base, parsed.token, info?.user?.login ?? t("settings.remote.me"), info?.name ?? t("settings.remote.computer"));
      const label = name.trim() || p.machine;
      saveMachines([...machines(), { id: `m${Date.now().toString(36)}`, name: label, url: normalizeUrl(parsed.base), device: p.device.id, key: p.key }]);
      setOk(t("settings.remote.machineAdded", { name: label }));
      setLink("");
      setName("");
    } catch (e) {
      onError(String((e as Error).message ?? e));
    }
  };
  return (
    <div data-testid="other-machines">
      <p className="dim small">{t("settings.remote.otherLead")}</p>
      <div className="row env-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("settings.remote.nameOptional")} data-testid="machine-pair-name" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("settings.remote.pairLink")} data-testid="machine-pair-link" style={{ flex: 2 }} />
        <button className="btn primary" disabled={!parsed?.base} onClick={pair} data-testid="machine-pair-go">{t("common.add")}</button>
      </div>
      {ok && <div className="ok" data-testid="machine-pair-ok">{ok}</div>}
      {running && <button className="btn" disabled={busy} onClick={scan} data-testid="machines-scan">{busy ? t("settings.remote.searching") : t("settings.remote.scan")}</button>}
      {found.map((m) => (
        <div key={m.ip} className="set-row" data-testid="found-machine">
          <div>
            <div>{m.machine ?? m.name} <span className="dim small">{m.os}</span></div>
            <div className="dim small"><code>{m.dns_name ?? m.ip}</code></div>
          </div>
          <span className={"badge" + (m.kabuld ? " ok" : "")}>{m.kabuld ? "kabuld" : m.online ? t("settings.remote.noKabuld") : t("settings.remote.offline")}</span>
        </div>
      ))}
    </div>
  );
}
