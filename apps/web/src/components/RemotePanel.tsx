import { useCallback, useEffect, useState } from "react";
import { api, wsTitle, type Workspace } from "../api";
import { transport } from "../transport";
import { pairWith, parsePairLink } from "../transport/credentials";
import { k, type Device, type FoundMachine, type RemoteStatus, type Ticket } from "../mobile/kabuld";
import { TicketCard, useCountdown } from "../mobile/ui";
import { machines, normalizeUrl, saveMachines } from "./machines";
import { RemoteHttps } from "./RemoteHttps";
import "../mobile/mobile.css";

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
      <p className="dim small">O <code>kabuld</code> deixa o celular (e outras máquinas suas) ver e operar ao vivo todas as sessões deste computador. Ele só escuta neste computador e na sua rede Tailscale; nada fica aberto na internet.</p>
      <div className="set-row">
        <div>
          <div>Servidor</div>
          <div className="dim small" data-testid="remote-address">{running && st ? st.base_url : "Desligado"}</div>
        </div>
        {isTauri ? (
          <button className={"btn" + (emb?.running ? "" : " primary")} disabled={busy} onClick={toggle} data-testid="remote-toggle">{emb?.running ? "Desligar" : "Ligar"}</button>
        ) : (
          <span className="badge ok" data-testid="remote-on">ligado</span>
        )}
      </div>
      {emb?.error && <div className="error">{emb.error}</div>}
      {running && st && <NetRow st={st} onChange={refresh} onError={onError} />}
      {running && (
        <>
          <h3>Parear um celular</h3>
          {/* Endereço novo (ex.: HTTPS ligado): QR novo já com ele. */}
          <PairQr key={st?.base_url ?? ""} />
          <h3>Dispositivos pareados</h3>
          <Devices onError={onError} />
          <h3>Convidar alguém para um workspace</h3>
          <Invite onError={onError} />
        </>
      )}
      <h3>Outras máquinas</h3>
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
          <div className="dim small">{tailnet ? `${ts.dns_name ?? ""} ${ts.ips.join(" ")}` : ts.kind === "localhost" ? "Desligado neste kabuld: só este computador acessa." : ts.message ?? "Só este computador."}</div>
        </div>
        <span className={"badge" + (tailnet ? " ok" : "")} data-testid="remote-net-badge">{tailnet ? "conectado" : "só local"}</span>
      </div>
      {tailnet && <RemoteHttps net={ts} onChange={onChange} />}
      <div className="dim small">Credenciais guardadas em: {st.secrets === "keyring" ? "cofre do sistema" : st.secrets}. Notificações ativas: {st.push}.</div>
    </>
  );
}

function PairQr() {
  const [t, setT] = useState<Ticket | null>(null);
  const [big, setBig] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const left = useCountdown(t?.expires_at ?? null);
  const make = useCallback(() => k.pairCreate().then(setT, (e) => setErr(String(e))), []);
  useEffect(() => void make(), [make]);
  return (
    <div className="remote-pair">
      <p className="dim small">No celular (conectado ao mesmo Tailscale), aponte a câmera para o QR. O código vale 5 minutos e uma vez só; o aparelho ganha uma credencial própria, que você pode revogar abaixo.</p>
      {t && <TicketCard svg={t.qr_svg} url={t.url} left={left} onRegen={make} onBig={() => setBig(true)} />}
      {t && <button className="btn" onClick={() => setBig(true)} data-testid="pair-enlarge">Ampliar</button>}
      {err && <div className="error">{err}</div>}
      {big && t && (
        <div className="m-sheet-bg remote-big" onClick={() => setBig(false)} data-testid="pair-big">
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-head"><b>Parear um celular</b><button className="m-btn ghost" onClick={() => setBig(false)}>Fechar</button></div>
            <TicketCard svg={t.qr_svg} url={t.url} left={left} onRegen={make} big />
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
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  const when = (s: number | null) => (s ? new Date(s * 1000).toLocaleString() : "—");
  if (list.length === 0) return <div className="dim small" data-testid="devices-empty">Nenhum aparelho pareado.</div>;
  return (
    <div>
      {list.map((d) => (
        <div key={d.id} className="set-row" data-testid="device-row">
          <div>
            <div><span className="m-avatar" style={{ background: d.color, width: 18, height: 18, fontSize: 10, marginRight: 6 }}>{d.user.slice(0, 1).toUpperCase()}</span>{d.user} · {d.name}</div>
            <div className="dim small">{d.role === "owner" ? "dono" : d.role === "editor" ? "editor" : "observador"}{d.scope.kind === "workspace" ? " de um workspace" : ""} · visto {when(d.last_seen)}</div>
          </div>
          {confirm === d.id ? (
            <div className="row">
              <button className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
              <button className="btn danger" onClick={() => k.revoke(d.id).then(() => (setConfirm(null), load()), (e) => onError(String(e)))} data-testid="device-revoke-confirm">Revogar agora</button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirm(d.id)} data-testid="device-revoke">Revogar</button>
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
  const [t, setT] = useState<Ticket | null>(null);
  const left = useCountdown(t?.expires_at ?? null);
  useEffect(() => void api.workspaces().then((l) => (setWss(l.filter((w) => !w.archived)), setWs((x) => x || l.find((w) => !w.archived)?.id || "")), () => {}), []);
  if (wss.length === 0) return <div className="dim small">Crie um workspace para convidar alguém.</div>;
  return (
    <div>
      <p className="dim small">A pessoa precisa estar na sua tailnet (compartilhe a máquina pelo Tailscale). Ela vê o stream, a conversa e o terminal do workspace; como editor, também manda mensagens, aprova e digita. Tudo passa pela fila única do servidor, com o nome de quem escreveu.</p>
      <div className="row env-row">
        <select value={ws} onChange={(e) => (setWs(e.target.value), setT(null))} data-testid="invite-ws">{wss.map((w) => <option key={w.id} value={w.id}>{wsTitle(w)}</option>)}</select>
        <select value={role} onChange={(e) => (setRole(e.target.value as "editor" | "observer"), setT(null))} data-testid="invite-role"><option value="editor">Editor</option><option value="observer">Observador</option></select>
        <button className="btn primary" onClick={() => k.invite(ws, role).then(setT, (e) => onError(String(e)))} data-testid="invite-go">Gerar convite</button>
      </div>
      {t && <TicketCard svg={t.qr_svg} url={t.url} left={left} />}
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
      const p = await pairWith(parsed.base, parsed.token, info?.user?.login ?? "Eu", info?.name ?? "Computador");
      const label = name.trim() || p.machine;
      saveMachines([...machines(), { id: `m${Date.now().toString(36)}`, name: label, url: normalizeUrl(parsed.base), device: p.device.id, key: p.key }]);
      setOk(`${label} adicionada: escolha no seletor do topo da barra lateral.`);
      setLink("");
      setName("");
    } catch (e) {
      onError(String((e as Error).message ?? e));
    }
  };
  return (
    <div data-testid="other-machines">
      <p className="dim small">Cada máquina com o kabuld ligado aparece no seletor do topo da barra lateral e você opera nela pelo mesmo app. Para adicionar: naquela máquina, abra esta tela e copie o link do QR; cole aqui.</p>
      <div className="row env-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (opcional)" data-testid="machine-pair-name" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link de pareamento da outra máquina" data-testid="machine-pair-link" style={{ flex: 2 }} />
        <button className="btn primary" disabled={!parsed?.base} onClick={pair} data-testid="machine-pair-go">Adicionar</button>
      </div>
      {ok && <div className="ok" data-testid="machine-pair-ok">{ok}</div>}
      {running && <button className="btn" disabled={busy} onClick={scan} data-testid="machines-scan">{busy ? "Procurando…" : "Procurar na tailnet"}</button>}
      {found.map((m) => (
        <div key={m.ip} className="set-row" data-testid="found-machine">
          <div>
            <div>{m.machine ?? m.name} <span className="dim small">{m.os}</span></div>
            <div className="dim small"><code>{m.dns_name ?? m.ip}</code></div>
          </div>
          <span className={"badge" + (m.kabuld ? " ok" : "")}>{m.kabuld ? "kabuld" : m.online ? "sem kabuld" : "offline"}</span>
        </div>
      ))}
    </div>
  );
}
