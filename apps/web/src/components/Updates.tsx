import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type AppSettings, type AppVersion, type UpdateInfo, type UpdateProgress } from "../api";
import { transport } from "../transport";
import type { WsTransport } from "../transport/websocket";
import { APP_VERSION, type Compat } from "../version";
import { Row } from "../views/settingsUi";
import { t } from "../i18n";
import { fmtDate, fmtNum, fmtPct } from "../i18n/format";
import { trError } from "../i18n/errors";
import { chatStore, statusOf } from "./chatStore";
import { confirmClosing, liveChats } from "./Confirm";

const wsT = (): WsTransport | null => ("compat" in transport ? (transport as WsTransport) : null);

/** Página dos Releases quando o app não diz a dele (kabuld, navegador). */
export const RELEASES_URL = "https://github.com/valteracetto/kabul/releases";

/** Compatibilidade com o kabuld (só quando o app fala com um por WebSocket). */
export function useCompat(): Compat {
  const [c, setC] = useState<Compat>(() => wsT()?.compat() ?? { kind: "ok" });
  useEffect(() => {
    const ws = wsT();
    if (!ws) return;
    setC(ws.compat());
    return ws.onState(() => setC(ws.compat()));
  }, []);
  return c;
}

// ---------------------------------------------------------------- versão nova conhecida
// A checagem automática (evento `update-available`) e a manual guardam aqui a versão achada: o botão do
// rodapé da barra lateral ganha o ponto. O aviso do topo é só da automática (na manual, o diálogo já mostra).

let known: UpdateInfo | null = null;
let announced: string | null = null;
const listeners = new Set<() => void>();
const setKnown = (u: UpdateInfo | null, announce = false) => {
  if (announce && u) announced = u.version;
  else if (known?.version === u?.version && !!known === !!u) return;
  known = u;
  listeners.forEach((l) => l());
};
let listening = false;
const subscribe = (l: () => void) => {
  // Ouve a checagem automática a partir do primeiro uso (não na importação do módulo).
  if (!listening) (listening = true), api.onUpdateAvailable((u) => setKnown(u, true));
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Versão nova achada e ainda não instalada (ou `null`). */
export const useUpdateAvailable = (): UpdateInfo | null => useSyncExternalStore(subscribe, () => known, () => known);

/**
 * "Procurar atualizações…" (menu Kabul, Ajuda no Windows, barra do Kabul, rodapé da barra lateral, ⌘K,
 * Configurações). Com `update`, abre direto o diálogo dessa versão; com `install`, já começa a instalar.
 */
export const checkForUpdates = (detail?: { update?: UpdateInfo; install?: boolean }) => window.dispatchEvent(new CustomEvent("kabul:check-updates", { detail }));

const running = () => chatStore.all().filter((c) => statusOf(c) !== "idle").length;
const mb = (n: number) => `${fmtNum(n / 1e6, { maximumFractionDigits: n >= 1e8 ? 0 : 1 })} MB`;
const openUrl = (url: string) => void api.openExternal(url).catch(() => window.open(url, "_blank", "noopener"));

type Phase =
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "found"; update: UpdateInfo }
  | { kind: "confirm"; update: UpdateInfo }
  | { kind: "waiting"; update: UpdateInfo; count: number }
  | { kind: "downloading"; update: UpdateInfo; progress: UpdateProgress | null }
  | { kind: "error"; text: string; update?: UpdateInfo };

/**
 * Diálogo de atualização: procura no canal das Configurações (estável por padrão), mostra "você está na
 * versão mais recente" ou a versão nova com notas, tamanho e "Atualizar e reiniciar" / "Depois"; baixa com
 * barra de progresso. Com agentes rodando, pergunta como ao sair: esperar terminarem ou reiniciar mesmo
 * assim. Fora do app empacotado (dev, navegador), abre a página de releases.
 */
export function UpdateDialogHost() {
  const [phase, setPhase] = useState<Phase | null>(null);
  const [ver, setVer] = useState<AppVersion | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const releases = ver?.releases_url ?? RELEASES_URL;
  const version = () => api.appVersion().then((v) => (setVer(v), v), () => ({ version: APP_VERSION, protocol: 1, channel: "stable", updater: false, releases_url: RELEASES_URL }) as AppVersion);

  const install = async (update: UpdateInfo, force = false) => {
    const n = running();
    if (n && !force) {
      setPhase({ kind: "confirm", update });
      const chats = [...liveChats.values()].map((c) => c.chat);
      const now = await confirmClosing(chats, `${t("settings.updates.agentsRunning", { count: n })}\n${t("settings.updates.agentsStop")}`, { ok: t("settings.updates.restartAnyway"), cancel: t("settings.updates.waitAgents"), danger: true, ask: true });
      // Fechou o aviso (ou escolheu esperar): instala sozinho quando os agentes terminarem.
      if (!now) return setPhase({ kind: "waiting", update, count: running() });
    }
    setPhase({ kind: "downloading", update, progress: null });
    try {
      await api.updateInstall();
    } catch (e) {
      setPhase({ kind: "error", text: String(e), update });
    }
  };
  const installRef = useRef(install);
  installRef.current = install;

  const check = async () => {
    const v = await version();
    if (!v.updater) {
      // Dev ou navegador: não há updater; a página de releases tem as versões.
      setPhase(null);
      return openUrl(v.releases_url ?? RELEASES_URL);
    }
    setPhase({ kind: "checking" });
    // Fechou o diálogo enquanto procurava: guarda o resultado (ponto no rodapé), sem reabrir.
    const show = (p: Phase) => setPhase((x) => (x?.kind === "checking" ? p : x));
    try {
      const u = await api.updateCheck();
      setKnown(u);
      show(u ? { kind: "found", update: u } : { kind: "none" });
    } catch (e) {
      show({ kind: "error", text: String(e) });
    }
  };
  const checkRef = useRef(check);
  checkRef.current = check;

  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ update?: UpdateInfo; install?: boolean } | undefined>).detail;
      const busy = phaseRef.current?.kind;
      if (busy === "downloading" || busy === "confirm") return;
      if (d?.update) {
        void version();
        setPhase({ kind: "found", update: d.update });
        if (d.install) void installRef.current(d.update);
      } else void checkRef.current();
    };
    window.addEventListener("kabul:check-updates", open);
    const offProgress = api.onUpdateProgress((p) => setPhase((x) => (x?.kind === "downloading" ? { ...x, progress: p } : x)));
    return () => (window.removeEventListener("kabul:check-updates", open), offProgress());
  }, []);

  // Esperando os agentes: confere a cada segundo e meio; zerou, instala e reinicia.
  useEffect(() => {
    if (phase?.kind !== "waiting") return;
    const timer = setInterval(() => {
      const n = running();
      if (!n) return void installRef.current(phase.update, true);
      setPhase((x) => (x?.kind === "waiting" && x.count !== n ? { ...x, count: n } : x));
    }, 1500);
    return () => clearInterval(timer);
  }, [phase?.kind]);

  // Foco no botão principal (Enter confirma, Esc fecha), ou no próprio diálogo.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => void (box.current && (box.current.querySelector<HTMLButtonElement>(".btn.primary") ?? box.current).focus()), [phase?.kind]);

  if (!phase || phase.kind === "confirm") return null;
  const close = () => phase.kind !== "downloading" && setPhase(null);
  const channel = (u?: UpdateInfo) => ((u?.channel ?? ver?.channel) === "beta" ? t("settings.updates.channelBeta") : t("settings.updates.channelStable"));
  const current = ver?.version ?? APP_VERSION;

  let body: React.ReactNode;
  let buttons: React.ReactNode;
  if (phase.kind === "checking") {
    body = <div className="dim" data-testid="upd-checking">{t("settings.updates.checkingIn", { channel: channel() })}</div>;
    buttons = <button className="btn" onClick={close}>{t("common.cancel")}</button>;
  } else if (phase.kind === "none") {
    body = (
      <>
        <div data-testid="upd-none">{t("settings.updates.latest", { version: current })}</div>
        <div className="dim small">{channel()}</div>
      </>
    );
    buttons = <button className="btn primary" onClick={close} data-testid="upd-ok">{t("settings.updates.ok")}</button>;
  } else if (phase.kind === "error") {
    body = (
      <>
        <div data-testid="upd-error">{trError(phase.text)}</div>
        <div className="dim small">{t("settings.updates.errorHint")} <a href={releases} onClick={(e) => (e.preventDefault(), openUrl(releases))} data-testid="upd-releases">{t("settings.updates.releasesPage")}</a></div>
      </>
    );
    buttons = (
      <>
        <button className="btn" onClick={close}>{t("common.close")}</button>
        <button className="btn primary" onClick={() => void check()} data-testid="upd-retry">{t("settings.updates.retry")}</button>
      </>
    );
  } else {
    const u = phase.update;
    const meta = [t("settings.updates.youHave", { version: u.current || current }), channel(u), u.published_at ? fmtDate(u.published_at * 1000, "date") : null, u.size ? mb(u.size) : null].filter(Boolean).join(" · ");
    body = (
      <>
        <div className="upd-head"><b data-testid="upd-version">{t("settings.updates.newVersion", { version: u.version })}</b></div>
        <div className="dim small" data-testid="upd-meta">{meta}</div>
        <div className="upd-notes" data-testid="upd-notes">{u.notes?.trim() || <span className="dim">{t("settings.updates.noNotes")}</span>}</div>
        {u.release_url && <a className="small" href={u.release_url} onClick={(e) => (e.preventDefault(), openUrl(u.release_url!))} data-testid="upd-changelog">{t("settings.updates.fullNotes")}</a>}
      </>
    );
    if (phase.kind === "found") {
      buttons = (
        <>
          <button className="btn" onClick={close} data-testid="upd-later">{t("settings.updates.later")}</button>
          <button className="btn primary" onClick={() => void install(u)} data-testid="upd-install">{t("settings.updates.updateRestart")}</button>
        </>
      );
    } else if (phase.kind === "waiting") {
      body = (
        <>
          {body}
          <div className="upd-wait" data-testid="upd-waiting">{t("settings.updates.waiting", { count: phase.count })}</div>
        </>
      );
      buttons = (
        <>
          <button className="btn" onClick={() => setPhase({ kind: "found", update: u })} data-testid="upd-wait-cancel">{t("settings.updates.cancelWait")}</button>
          <button className="btn danger" onClick={() => void install(u, true)} data-testid="upd-restart-now">{t("settings.updates.restartNow")}</button>
        </>
      );
    } else {
      const p = phase.progress;
      const frac = p?.total ? Math.min(1, p.downloaded / p.total) : null;
      body = (
        <>
          {body}
          <div className="clone-progress" data-testid="upd-progress">
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={frac == null ? undefined : Math.round(frac * 100)}><span style={{ width: `${(frac ?? 0) * 100}%` }} /></div>
            <span className="small dim mono" data-testid="upd-progress-text">
              {frac === 1 ? t("settings.updates.restarting") : frac != null ? `${fmtPct(frac)} · ${t("settings.updates.ofSize", { done: mb(p!.downloaded), total: mb(p!.total!) })}` : p ? mb(p.downloaded) : t("settings.updates.downloading")}
            </span>
          </div>
        </>
      );
      buttons = null;
    }
  }
  return (
    <div className="overlay center" onMouseDown={close}>
      <div ref={box} className="popover dialog upd-dialog" role="dialog" aria-label={t("settings.updates.title")} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && close()} tabIndex={-1} data-testid="update-dialog">
        <div className="dialog-title">{t("settings.updates.title")}</div>
        {body}
        {buttons && <div className="row end">{buttons}</div>}
      </div>
    </div>
  );
}

/** Aviso fixo no topo: kabuld de outra versão, ou atualização do app pronta para instalar. */
export function UpdateBanner() {
  const compat = useCompat();
  const update = useUpdateAvailable();
  const [hidden, setHidden] = useState<string | null>(null);
  if (compat.kind !== "ok") {
    if (hidden === "compat") return null;
    return (
      <div className="update-banner warn" role="status" data-testid="version-mismatch">
        <span>{compat.message}</span>
        <button className="btn" onClick={() => setHidden("compat")}>{t("settings.updates.gotIt")}</button>
      </div>
    );
  }
  if (!update || announced !== update.version || hidden === update.version) return null;
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <span>{t("settings.updates.available", { version: update.version })}{update.channel === "beta" ? t("settings.updates.beta") : ""}.</span>
      <button className="btn" onClick={() => checkForUpdates({ update })} data-testid="update-details">{t("settings.updates.whatsNew")}</button>
      <button className="btn primary" onClick={() => (setHidden(update.version), checkForUpdates({ update, install: true }))} data-testid="update-install">{t("settings.updates.updateRestart")}</button>
      <button className="btn" onClick={() => setHidden(update.version)}>{t("settings.updates.later")}</button>
    </div>
  );
}

/** Configurações › Avançado › Atualizações. */
export function UpdatesSection({ s, save }: { s: AppSettings; save: (s: AppSettings) => void }) {
  const [ver, setVer] = useState<AppVersion | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "checking" | "none" | "error" | "found"; text?: string; update?: UpdateInfo }>({ kind: "idle" });
  // Sem o comando (kabuld ou `kabul serve` no navegador) o updater não existe: mostra só a versão.
  useEffect(() => void api.appVersion().then(setVer, () => setVer({ version: APP_VERSION, protocol: 1, channel: "stable", updater: false })), []);
  const channel = s.update_channel ?? "stable";
  const on = s.auto_update ?? true;
  const check = (ch = channel) => {
    setState({ kind: "checking" });
    api.updateCheck(ch).then((u) => (setKnown(u), setState(u ? { kind: "found", update: u } : { kind: "none" })), (e) => setState({ kind: "error", text: String(e) }));
  };
  const releases = ver?.releases_url ?? RELEASES_URL;
  const status =
    state.kind === "checking" ? t("settings.updates.searching")
    : state.kind === "none" ? t("settings.updates.upToDate", { version: ver?.version ?? APP_VERSION })
    : state.kind === "error" ? <>{trError(state.text ?? "")} <a href={releases} onClick={(e) => (e.preventDefault(), openUrl(releases))}>{t("settings.updates.releasesPage")}</a></>
    : state.kind === "found" ? t("settings.updates.available", { version: state.update?.version }) + "."
    : null;
  return (
    <>
      <Row label={t("settings.updates.version")} hint={ver ? t("settings.updates.protocol", { n: ver.protocol }) : undefined}><code className="small" data-testid="app-version">{ver?.version ?? APP_VERSION}</code></Row>
      {ver?.updater !== false && (
        <>
          <Row label={t("settings.updates.auto")} hint={t("settings.updates.auto.hint")}>
            <span className={"toggle" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={t("settings.updates.auto")} tabIndex={0}
              onClick={() => save({ ...s, auto_update: !on })} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), save({ ...s, auto_update: !on }))} data-testid="toggle-auto_update"><span /></span>
          </Row>
          <Row label={t("settings.updates.channel")} hint={t("settings.updates.channel.hint")}>
            <select value={channel} onChange={(e) => save({ ...s, update_channel: e.target.value })} data-testid="update-channel">
              <option value="stable">{t("settings.updates.stable")}</option>
              <option value="beta">{t("settings.updates.betaOpt")}</option>
            </select>
          </Row>
          <Row label={t("settings.updates.check")} hint={status ? <span data-testid="update-status">{status}</span> : undefined}>
            <div className="row">
              {state.kind === "found" && state.update && <button className="btn primary" onClick={() => checkForUpdates({ update: state.update, install: true })} data-testid="update-install-now">{t("settings.updates.updateRestart")}</button>}
              <button className="btn" disabled={state.kind === "checking"} onClick={() => check()} data-testid="update-check">{t("settings.updates.checkNow")}</button>
            </div>
          </Row>
        </>
      )}
    </>
  );
}
