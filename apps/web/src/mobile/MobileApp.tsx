import { useCallback, useEffect, useMemo, useState } from "react";
import { transport } from "../transport";
import type { ConnState } from "../transport/websocket";
import { clearCred, deviceName, pairWith, parsePairLink, saveCred } from "../transport/credentials";
import { RepoMark } from "../icons";
import type { Model } from "../api";
import { AGENT_LABEL, canWrite, isOwner, k, me, ws, type Device, type LiveSession, type Ticket } from "./kabuld";
import { AgentIcon, RunsOnLabel, Sheet, StatusPill, TicketCard, useCountdown } from "./ui";
import { SessionView } from "./SessionView";
import { enablePush, pushBlocker, pushEnabled, registerSW } from "./push";
import "./mobile.css";

const hashParams = () => new URLSearchParams(location.hash.slice(1));
const sessionFromHash = () => hashParams().get("s");

/** PWA do celular: pareamento, lista de sessões de todos os agentes e a sessão aberta. */
export function MobileApp() {
  const [conn, setConn] = useState<ConnState>(ws()?.state() ?? "open");
  const [connErr, setConnErr] = useState<string | null>(null);
  const [route, setRoute] = useState<string | null>(sessionFromHash);
  const [pair, setPair] = useState(() => parsePairLink(location.hash));
  useEffect(() => {
    void registerSW();
    const t = ws();
    const off = t?.onState((s, e) => (setConn(s), setConnErr(e ?? null)));
    // O hello pode ter respondido antes deste efeito.
    if (t) (setConn(t.state()), setConnErr(t.lastError()));
    const onHash = () => (setRoute(sessionFromHash()), setPair(parsePairLink(location.hash)));
    window.addEventListener("hashchange", onHash);
    return () => (off?.(), window.removeEventListener("hashchange", onHash));
  }, []);
  const open = useCallback((id: string | null) => {
    location.hash = id ? `s=${encodeURIComponent(id)}` : "";
  }, []);

  if (pair) return <PairScreen token={pair.token} invite={!!pair.workspace} />;
  if (conn === "unauthorized" || conn === "revoked") return <NeedPairing reason={connErr} revoked={conn === "revoked"} />;
  if (route) return <SessionView id={route} onBack={() => open(null)} />;
  return <SessionList conn={conn} onOpen={open} />;
}

function PairScreen({ token, invite }: { token: string; invite: boolean }) {
  const [user, setUser] = useState(localStorage.getItem("kabul.user") ?? "");
  const [device, setDevice] = useState(deviceName());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await pairWith(location.origin, token, user, device);
      saveCred({ device: p.device.id, key: p.key });
      localStorage.setItem("kabul.user", user);
      history.replaceState(null, "", "/m/");
      location.reload();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setBusy(false);
    }
  };
  return (
    <div className="m-app m-center" data-testid="m-pair">
      <div className="m-card">
        <h1>{invite ? "Convite para colaborar" : "Parear este aparelho"}</h1>
        <p className="dim">{invite ? "Você vai acompanhar um workspace do Kabul ao vivo com quem te convidou." : "Depois de parear, este aparelho vê e opera as sessões do computador pela sua tailnet."}</p>
        <label>Seu nome<input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Como os outros te veem" data-testid="m-pair-user" autoComplete="name" /></label>
        <label>Aparelho<input value={device} onChange={(e) => setDevice(e.target.value)} data-testid="m-pair-device" /></label>
        {err && <div className="m-error" data-testid="m-pair-error">{err}</div>}
        <button className="m-btn primary big" disabled={busy || !user.trim()} onClick={go} data-testid="m-pair-go">{busy ? "Pareando…" : invite ? "Entrar" : "Parear"}</button>
      </div>
    </div>
  );
}

function NeedPairing({ reason, revoked }: { reason: string | null; revoked: boolean }) {
  const [link, setLink] = useState("");
  const parsed = parsePairLink(link);
  return (
    <div className="m-app m-center" data-testid="m-need-pairing">
      <div className="m-card">
        <h1>{revoked ? "Acesso revogado" : "Pareie este aparelho"}</h1>
        <p className="dim">{revoked ? "O dono da máquina removeu este aparelho. Peça um novo QR ou convite." : "No computador, abra Kabul › Configurações › Celular e remoto e aponte a câmera para o QR. Ou cole aqui o link de pareamento."}</p>
        {reason && !revoked && <div className="dim small">{reason}</div>}
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link de pareamento ou convite" data-testid="m-pair-link" />
        <button className="m-btn primary big" disabled={!parsed} onClick={() => (clearCred(), (location.hash = link.slice(link.indexOf("#") + 1)), location.reload())}>Continuar</button>
      </div>
    </div>
  );
}

type Filter = "all" | "waiting";

function SessionList({ conn, onOpen }: { conn: ConnState; onOpen: (id: string) => void }) {
  const [list, setList] = useState<LiveSession[]>([]);
  const [machine, setMachine] = useState<string>(ws()?.machine() ?? "");
  const [os, setOs] = useState<string>("");
  const [filter, setFilter] = useState<Filter>("all");
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { kind: "menu" } | { kind: "invite"; ws: string; name: string } | { kind: "devices" } | { kind: "chat"; ws: string; name: string }>(null);
  const [push, setPush] = useState(false);
  const load = useCallback(() => k.live().then((r) => (setList(r.sessions), setMachine(r.machine), setOs(r.os), setErr(null)), (e) => setErr(String(e))), []);
  useEffect(() => {
    load();
    void pushEnabled().then(setPush);
    const t = setInterval(load, 4000);
    let pend: number | null = null;
    const soon = () => {
      if (pend) return;
      pend = window.setTimeout(() => ((pend = null), load()), 250);
    };
    const offs = ["sessions-changed", "session-status", "chat-state"].map((c) => transport.subscribe(c, soon));
    return () => (clearInterval(t), offs.forEach((o) => o()));
  }, [load]);
  const waiting = list.filter((s) => s.status === "waiting").length;
  const groups = useMemo(() => {
    const shown = filter === "waiting" ? list.filter((s) => s.status === "waiting") : list;
    const m = new Map<string, { key: string; repo: string; workspace: string | null; wsId: string | null; items: LiveSession[] }>();
    for (const s of shown) {
      const g = m.get(s.group.key) ?? { key: s.group.key, repo: s.group.repo, workspace: s.group.workspace, wsId: s.group.workspace_id, items: [] };
      g.items.push(s);
      m.set(s.group.key, g);
    }
    const rank = (g: { items: LiveSession[] }) => (g.items.some((s) => s.status === "waiting") ? 0 : g.items.some((s) => s.status === "working") ? 1 : 2);
    return [...m.values()].sort((a, b) => rank(a) - rank(b) || a.repo.localeCompare(b.repo) || (a.workspace ?? "").localeCompare(b.workspace ?? ""));
  }, [list, filter]);
  const who = me();
  return (
    <div className="m-app" data-testid="m-list">
      <header className="m-top">
        <div className="m-top-title">
          <b>Kabul</b>
          <span className="dim small" data-testid="m-machine">{machine}</span>
        </div>
        <span className={`m-conn m-conn-${conn}`} title={conn === "open" ? "Conectado" : "Reconectando…"} data-testid="m-conn" />
        <button className="m-btn ghost" onClick={() => setSheet({ kind: "menu" })} data-testid="m-menu" aria-label="Menu">•••</button>
      </header>
      <div className="m-tabs">
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>Todas <span className="dim">{list.length}</span></button>
        <button className={filter === "waiting" ? "on" : ""} onClick={() => setFilter("waiting")} data-testid="m-filter-waiting">Esperando você {waiting > 0 && <span className="m-count">{waiting}</span>}</button>
      </div>
      {err && <div className="m-error">{err}</div>}
      <main className="m-scroll">
        {groups.length === 0 && <div className="m-empty dim" data-testid="m-empty">{filter === "waiting" ? "Nenhum agente esperando você." : "Nenhuma sessão rodando. Sessões novas aparecem aqui sozinhas."}</div>}
        {groups.map((g) => (
          <section key={g.key} className="m-group" data-testid="m-group" data-repo={g.repo}>
            <div className="m-group-head">
              <RepoMark name={g.repo || "?"} size={18} />
              <span className="m-group-name">{g.repo}{g.workspace && <span className="dim"> › {g.workspace}</span>}</span>
              <span className="grow" />
              {g.wsId && canWrite() && <button className="m-btn small" onClick={() => setSheet({ kind: "chat", ws: g.wsId!, name: g.workspace ?? g.repo })} data-testid="m-new-chat">+ Chat</button>}
              {g.wsId && isOwner() && <button className="m-btn small" onClick={() => setSheet({ kind: "invite", ws: g.wsId!, name: g.workspace ?? g.repo })} data-testid="m-invite">Convidar</button>}
            </div>
            {g.items.map((s) => (
              <button key={s.id} className={`m-session m-session-${s.status}`} onClick={() => onOpen(s.id)} data-testid="m-session" data-id={s.id}>
                <AgentIcon agent={s.agent} />
                <span className="m-session-main">
                  <b className="m-session-name">{s.name}</b>
                  <span className="m-session-line">
                    <RunsOnLabel r={s.runs_on} machine={s.machine ?? machine} os={os} />
                    <span className="m-session-sub dim">{s.status === "waiting" && s.detail ? s.detail : s.kind === "chat" ? s.preview : `${AGENT_LABEL[s.agent] ?? s.agent} · ${s.preview}`}</span>
                  </span>
                </span>
                <StatusPill status={s.status} detail={s.detail} />
              </button>
            ))}
          </section>
        ))}
      </main>
      {sheet?.kind === "menu" && (
        <Sheet title={who ? `${who.user} · ${who.device}` : "Este computador"} onClose={() => setSheet(null)} testid="m-menu-sheet">
          <div className="m-sheet-list">
            <PushRow on={push} onOn={() => setPush(true)} />
            {isOwner() && <button className="m-row" onClick={() => setSheet({ kind: "devices" })} data-testid="m-devices">Aparelhos pareados</button>}
            {who && who.id !== "local" && <button className="m-row danger" onClick={() => (clearCred(), location.reload())}>Sair deste aparelho</button>}
            {who && <div className="dim small m-pad">Papel: {who.role === "owner" ? "dono" : who.role === "editor" ? "editor" : "observador"}{who.scope.kind === "workspace" ? " · um workspace" : ""}</div>}
          </div>
        </Sheet>
      )}
      {sheet?.kind === "invite" && <InviteSheet ws={sheet.ws} name={sheet.name} onClose={() => setSheet(null)} />}
      {sheet?.kind === "devices" && <DevicesSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === "chat" && <NewChatSheet ws={sheet.ws} name={sheet.name} onClose={() => setSheet(null)} onOpen={onOpen} />}
    </div>
  );
}

function PushRow({ on, onOn }: { on: boolean; onOn: () => void }) {
  const [msg, setMsg] = useState<string | null>(pushBlocker());
  const [busy, setBusy] = useState(false);
  if (on) return <div className="m-row" data-testid="m-push-on">Notificações ligadas <button className="m-btn small" onClick={() => k.pushTest().catch(() => {})}>Testar</button></div>;
  return (
    <div className="m-row-col">
      <button className="m-row" disabled={busy || !!pushBlocker()} onClick={() => (setBusy(true), enablePush().then(onOn, (e) => setMsg(String(e.message ?? e))).finally(() => setBusy(false)))} data-testid="m-push">Avisar quando um agente esperar por mim</button>
      {msg && <div className="dim small m-pad" data-testid="m-push-why">{msg}</div>}
    </div>
  );
}

function InviteSheet({ ws: wsId, name, onClose }: { ws: string; name: string; onClose: () => void }) {
  const [role, setRole] = useState<"editor" | "observer">("editor");
  const [t, setT] = useState<Ticket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const left = useCountdown(t?.expires_at ?? null);
  const make = () => k.invite(wsId, role).then(setT, (e) => setErr(String(e)));
  return (
    <Sheet title={`Convidar para ${name}`} onClose={onClose} testid="m-invite-sheet">
      <p className="dim small m-pad">Quem abrir o link (pela sua tailnet) entra só neste workspace: vê o stream, a conversa e o terminal. Editor também manda mensagens, aprova e digita.</p>
      <div className="m-seg">
        <button className={role === "editor" ? "on" : ""} onClick={() => (setRole("editor"), setT(null))} data-testid="m-role-editor">Editor</button>
        <button className={role === "observer" ? "on" : ""} onClick={() => (setRole("observer"), setT(null))} data-testid="m-role-observer">Observador</button>
      </div>
      {!t && <button className="m-btn primary big" onClick={make} data-testid="m-invite-go">Gerar convite</button>}
      {t && <TicketCard svg={t.qr_svg} url={t.url} left={left} onRegen={make} />}
      {err && <div className="m-error">{err}</div>}
    </Sheet>
  );
}

function DevicesSheet({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Device[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = () => k.devices().then(setList, () => {});
  useEffect(() => void load(), []);
  const mine = me()?.id;
  return (
    <Sheet title="Aparelhos pareados" onClose={onClose} testid="m-devices-sheet">
      {list.length === 0 && <div className="dim m-pad">Nenhum aparelho.</div>}
      {list.map((d) => (
        <div key={d.id} className="m-row" data-testid="m-device">
          <span className="m-avatar" style={{ background: d.color, width: 24, height: 24 }}>{d.user.slice(0, 1).toUpperCase()}</span>
          <span className="grow">{d.user} · {d.name}<span className="dim small"> {d.role === "owner" ? "dono" : d.role}{d.id === mine ? " (este)" : ""}</span></span>
          {confirm === d.id ? (
            <button className="m-btn small danger" onClick={() => k.revoke(d.id).then(() => (setConfirm(null), load()))} data-testid="m-revoke-confirm">Confirmar</button>
          ) : (
            <button className="m-btn small" onClick={() => setConfirm(d.id)} data-testid="m-revoke">Revogar</button>
          )}
        </div>
      ))}
    </Sheet>
  );
}

function NewChatSheet({ ws: wsId, name, onClose, onOpen }: { ws: string; name: string; onClose: () => void; onOpen: (id: string) => void }) {
  const [models, setModels] = useState<Model[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void k.models().then((m) => setModels(m.filter((x) => !x.local)), (e) => setErr(String(e))), []);
  const start = (m: Model) => {
    setBusy(true);
    k.chatStart(wsId, m).then((c) => (onClose(), onOpen(`chat:${c.id}`)), (e) => (setErr(String(e)), setBusy(false)));
  };
  return (
    <Sheet title={`Nova conversa em ${name}`} onClose={onClose} testid="m-chat-sheet">
      {!models && !err && <div className="dim m-pad">Carregando modelos…</div>}
      <div className="m-sheet-list">
        {models?.slice(0, 12).map((m) => (
          <button key={m.key} className="m-row" disabled={busy} onClick={() => start(m)} data-testid="m-model">
            <AgentIcon agent={m.harness} size={20} /> <span className="grow">{m.label}</span><span className="dim small">{AGENT_LABEL[m.harness] ?? m.harness}</span>
          </button>
        ))}
      </div>
      {err && <div className="m-error">{err}</div>}
    </Sheet>
  );
}
