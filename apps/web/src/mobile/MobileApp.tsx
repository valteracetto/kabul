import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ConnState } from "../transport/websocket";
import { clearCred, deviceName, pairWith, parsePairLink, saveCred } from "../transport/credentials";
import { isOwner, ws } from "./kabuld";
import { I, PLATFORM, haptic } from "./ui";
import { SessionView } from "./SessionView";
import { MobileUsage } from "./MobileUsage";
import { FilesScreen, filesRoute } from "./preview";
import { Home } from "./Home";
import { NewWorkspace } from "./NewWorkspace";
import { Settings, SettingsPage } from "./Settings";
import { Usage } from "./Usage";
import { useKabul } from "./data";
import { back, navDir, onRoute, parseRoute, setNavDir, type Route } from "./nav";
import { registerSW } from "./push";
import { UpdateBanner } from "../components/Updates";
import "./mobile.css";
import { t } from "../i18n";
import { trError } from "../i18n/errors";

export type Tab = "home" | "usage" | "settings";
const TAB_KEY = "kabul.m.tab";

/** Instalada na Tela de Início (sem barra do navegador). */
const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;

/**
 * A web view da PWA instalada não chega à borda de baixo da tela? No iOS 26 (barra de status
 * `black-translucent`) ela fica curta pela área segura de cima (956 − 62 = 894 pt no 16 Pro Max): os 62 pt de
 * baixo são do sistema e o web não pinta ali. O indicador de gestos fica fora da web view, mas o
 * `env(safe-area-inset-bottom)` continua 34: sem zerar, a barra de abas ganha um vão morto embaixo.
 *
 * Com a barra de status opaca (`black`/`default`, o padrão agora) a web view começa abaixo dela:
 * também tem tela − 62 de altura, mas encosta na base e não tem área segura em cima. Por isso só conta como
 * curta quando a página ainda desenha atrás da barra de status (área segura de cima > 0).
 */
function shortWebView(h: number) {
  if (PLATFORM !== "ios" || !standalone() || !screen.width || !screen.height) return false;
  const land = window.innerWidth > Math.min(screen.width, screen.height) + 1;
  const sw = land ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const sh = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  return Math.abs(window.innerWidth - sw) <= 1 && sh - h > 20 && safeTop() > 0;
}

/** Área segura de cima em uso (a mesma `--m-sat` do CSS). */
function safeTop() {
  const p = document.createElement("div");
  p.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;height:var(--m-sat)";
  document.body.appendChild(p);
  const h = p.getBoundingClientRect().height;
  p.remove();
  return h;
}

/**
 * Altura visível de verdade (o teclado do iPhone encolhe o visualViewport, não o layout). Nunca maior que a
 * web view: a altura da tela (0.9.0) passava da web view curta do iOS 26 e cortava os rótulos das abas.
 */
function useVisualViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    root.dataset.mobile = "1";
    root.dataset.platform = PLATFORM;
    if (!vv) return;
    const upd = () => {
      const kb = window.innerHeight - vv.height > 120;
      root.style.setProperty("--m-vvh", `${Math.round(vv.height)}px`);
      root.classList.toggle("m-kb", kb);
      root.classList.toggle("m-short-webview", !kb && shortWebView(Math.max(vv.height, window.innerHeight)));
      // O Safari rola a página para mostrar o campo; a tela é fixa, então volta para o topo.
      if (window.scrollY) window.scrollTo(0, 0);
    };
    upd();
    vv.addEventListener("resize", upd);
    vv.addEventListener("scroll", upd);
    window.addEventListener("resize", upd);
    return () => (vv.removeEventListener("resize", upd), vv.removeEventListener("scroll", upd), window.removeEventListener("resize", upd));
  }, []);
}

/** Android: ondulação (ripple) no ponto do toque, como nos componentes Material. */
const RIPPLE = ".m-row.tappable, .m-round, .m-cta, .m-fab, .m-pill, .m-chip-btn, .m-icon-btn, .m-composer-round, .m-composer-icon, .m-keys button, .m-segmented button, .m-swipe-btn, .m-model-chip, .m-plan-chip";
function useRipple() {
  useEffect(() => {
    if (PLATFORM !== "android") return;
    const h = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(RIPPLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const d = Math.max(r.width, r.height) * 2.2;
      const s = document.createElement("span");
      s.className = "m-ripple";
      s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 600);
    };
    document.addEventListener("pointerdown", h, { passive: true });
    return () => document.removeEventListener("pointerdown", h);
  }, []);
}

/** Cor da barra de status/tema do navegador acompanha o tema. */
function useThemeColor() {
  useEffect(() => {
    const upd = () => {
      const c = getComputedStyle(document.documentElement).getPropertyValue("--m-bg").trim() || "#0c0a09";
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", c));
      // Barra de status opaca da cor do tema (o iOS lê ao abrir o app instalado): preta no escuro, clara no claro.
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute("content", document.documentElement.dataset.theme === "light" ? "default" : "black");
    };
    upd();
    window.addEventListener("kabul:theme", upd);
    return () => window.removeEventListener("kabul:theme", upd);
  }, []);
}

/** PWA do celular: pareamento, abas (Workspaces, Uso, Configurações) e a pilha de telas por cima. */
export function MobileApp() {
  const [conn, setConn] = useState<ConnState>(ws()?.state() ?? "open");
  const [connErr, setConnErr] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [pair, setPair] = useState(() => parsePairLink(location.hash));
  // Arquivos do workspace e o app rodando (`#f=<ws>`): tela própria, com a navegação dela (preview/).
  const [files, setFiles] = useState(() => filesRoute());
  useVisualViewport();
  useThemeColor();
  useRipple();
  useEffect(() => {
    void registerSW();
    const t = ws();
    const off = t?.onState((s, e) => (setConn(s), setConnErr(e ?? null)));
    // O hello pode ter respondido antes deste efeito.
    if (t) (setConn(t.state()), setConnErr(t.lastError()));
    const offRoute = onRoute(() => (setRoute(parseRoute()), setPair(parsePairLink(location.hash)), setFiles(filesRoute())));
    return () => (off?.(), offRoute());
  }, []);

  if (pair) return <PairScreen token={pair.token} invite={!!pair.workspace} />;
  if (conn === "incompatible") return <Incompatible reason={connErr} />;
  if (conn === "unauthorized" || conn === "revoked") return <NeedPairing reason={connErr} revoked={conn === "revoked"} />;
  if (files) return <FilesScreen route={files} />;
  return <Shell conn={conn} route={route} />;
}

/** O kabuld recusou este app por ser antigo demais (handshake de versão). */
function Incompatible({ reason }: { reason: string | null }) {
  return (
    <div className="m-app m-onboard" data-testid="m-incompatible">
      <div className="m-onboard-body">
        <h1>{t("mobile.app.updateTitle")}</h1>
        <p className="dim">{reason ? trError(reason) : t("mobile.app.incompatible")}</p>
        <button className="m-cta" onClick={() => location.reload()}>{t("common.retry")}</button>
      </div>
    </div>
  );
}

/** Script do app no HTML (o Vite põe o hash do build no nome): muda quando o kabuld passa a servir outro build. */
const entryOf = (html: string) => html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1] ?? null;

/**
 * Nova versão do app no kabuld (atualizou o Kabul no computador): a PWA aberta continua com o JS antigo até
 * recarregar. Confere o HTML ao reconectar e ao voltar ao app; se o build mudou, oferece recarregar.
 */
function useNewVersion(conn: ConnState) {
  const [fresh, setFresh] = useState(false);
  const check = useRef<() => void>(() => {});
  useEffect(() => {
    const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute("src") ?? null;
    if (!mine) return;
    check.current = () =>
      void fetch("/m/", { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .then((html) => {
          const now = entryOf(html);
          if (now && now !== mine) setFresh(true);
        })
        .catch(() => {});
    const vis = () => document.visibilityState === "visible" && check.current();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  const dropped = useRef(false);
  useEffect(() => {
    // Reconectou depois de cair (o kabuld reiniciou, talvez atualizado): confere.
    if (conn === "closed") dropped.current = true;
    if (conn === "open" && dropped.current) ((dropped.current = false), check.current());
  }, [conn]);
  return fresh;
}

function Shell({ conn, route }: { conn: ConnState; route: Route }) {
  const fresh = useNewVersion(conn);
  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) as Tab) || "home");
  const setTab = (t: Tab) => {
    setNavDir("tab");
    localStorage.setItem(TAB_KEY, t);
    setTabState(t);
  };
  const snap = useKabul();
  const waiting = snap.list.filter((s) => s.status === "waiting").length;
  let top: ReactNode = null;
  if (route.kind === "session") top = <SessionView id={route.id} onBack={back} />;
  else if (route.kind === "new") top = <NewWorkspace onBack={back} />;
  else if (route.kind === "settings") top = <SettingsPage sub={route.sub} conn={conn} onBack={back} />;
  // Custos e limites (uso.jsonl, limites por conta): só o dono, como no kabuld.
  else if (route.kind === "usage" && isOwner()) top = <MobileUsage onBack={back} />;
  const topKey = route.kind === "session" ? `s:${route.id}` : route.kind === "settings" ? `v:${route.sub}` : route.kind;
  // Ao voltar, a tela de cima sai deslizando para a direita (mesma instância, só ganha a classe de saída).
  const last = useRef<{ key: string; node: ReactNode } | null>(null);
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  useEffect(() => {
    if (top) {
      last.current = { key: topKey, node: top };
      setLeaving(null);
      return;
    }
    if (!last.current) return;
    setLeaving(last.current);
    last.current = null;
    const t = setTimeout(() => setLeaving(null), 320);
    return () => clearTimeout(t);
  }, [topKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = top ? { key: topKey, node: top } : leaving;
  return (
    <div className="m-app">
      <UpdateBanner />
      {fresh && (
        <div className="m-newver" role="status" data-testid="m-new-version">
          <span>{t("mobile.app.newVersion")}</span>
          <button onClick={() => location.reload()} data-testid="m-new-version-reload">{t("mobile.app.reload")}</button>
        </div>
      )}
      <div className={"m-stack" + (top ? " covered" : "")} aria-hidden={!!top}>
        <Screen key={tab} anim={navDir() === "tab" ? "fade" : "none"}>
          {tab === "home" && <Home conn={conn} onSettings={() => setTab("settings")} />}
          {tab === "usage" && <Usage />}
          {tab === "settings" && <Settings conn={conn} />}
        </Screen>
        <TabBar tab={tab} onTab={setTab} waiting={waiting} />
      </div>
      {shown && (
        <Screen key={shown.key} anim={navDir() === "pop" ? "none" : "push"} top leaving={!top}>
          {shown.node}
        </Screen>
      )}
    </div>
  );
}

/** Tela com transição de entrada (empurrar da direita, voltar, troca de aba). */
function Screen({ children, anim, top, leaving }: { children: ReactNode; anim: "push" | "pop" | "fade" | "none"; top?: boolean; leaving?: boolean }) {
  const [cls] = useState(() => (anim === "none" ? "" : ` m-anim-${anim}`));
  return <div className={"m-screen" + (top ? " top" : "") + (leaving ? " leaving" : cls)}>{children}</div>;
}

function TabBar({ tab, onTab, waiting }: { tab: Tab; onTab: (t: Tab) => void; waiting: number }) {
  const items: { t: Tab; label: string; icon: ReactNode }[] = [
    { t: "home", label: t("mobile.app.tabWorkspaces"), icon: <I.stack /> },
    { t: "usage", label: t("mobile.app.tabUsage"), icon: <I.chart /> },
    { t: "settings", label: t("mobile.app.tabSettings"), icon: <I.gear /> },
  ];
  return (
    <nav className="m-tabbar" data-testid="m-tabbar">
      {items.map((i) => (
        <button key={i.t} className={tab === i.t ? "on" : ""} onClick={(e) => (haptic(e.currentTarget), onTab(i.t))} data-testid={`m-tab-${i.t}`} aria-current={tab === i.t ? "page" : undefined}>
          <span className="m-tab-icon">
            {i.icon}
            {i.t === "home" && waiting > 0 && <span className="m-tab-badge">{waiting}</span>}
          </span>
          <span className="m-tab-label">{i.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ---------------- pareamento ----------------

function Brand() {
  return (
    <div className="m-brand" aria-hidden="true">
      <img src="/icon-192.png" alt="" width={72} height={72} />
    </div>
  );
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
    <div className="m-app m-onboard" data-testid="m-pair">
      <div className="m-onboard-body">
        <Brand />
        <h1>{invite ? t("mobile.app.inviteTitle") : t("mobile.app.pairTitle")}</h1>
        <p>{invite ? t("mobile.app.inviteLead") : t("mobile.app.pairLead")}</p>
        <div className="m-grp">
          <div className="m-grp-body">
            <label className="m-field"><span>{t("mobile.app.yourName")}</span><input value={user} onChange={(e) => setUser(e.target.value)} placeholder={t("mobile.app.yourNamePh")} data-testid="m-pair-user" autoComplete="name" /></label>
            <label className="m-field"><span>{t("mobile.app.device")}</span><input value={device} onChange={(e) => setDevice(e.target.value)} data-testid="m-pair-device" /></label>
          </div>
        </div>
        {err && <div className="m-error" data-testid="m-pair-error">{trError(err)}</div>}
      </div>
      <div className="m-onboard-foot">
        <button className="m-cta" disabled={busy || !user.trim()} onClick={go} data-testid="m-pair-go">{busy ? t("mobile.app.pairing") : invite ? t("mobile.app.join") : t("mobile.app.pair")}</button>
      </div>
    </div>
  );
}

function NeedPairing({ reason, revoked }: { reason: string | null; revoked: boolean }) {
  const [link, setLink] = useState("");
  const parsed = parsePairLink(link);
  return (
    <div className="m-app m-onboard" data-testid="m-need-pairing">
      <div className="m-onboard-body">
        <Brand />
        <h1>{revoked ? t("mobile.app.revoked") : t("mobile.app.needPair")}</h1>
        <p>{revoked ? t("mobile.app.revokedLead") : t("mobile.app.needPairLead")}</p>
        {reason && !revoked && <p className="m-onboard-why">{trError(reason)}</p>}
        <div className="m-grp">
          <div className="m-grp-body">
            <label className="m-field"><input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("mobile.app.pairLinkPh")} data-testid="m-pair-link" autoCapitalize="off" autoCorrect="off" /></label>
          </div>
        </div>
      </div>
      <div className="m-onboard-foot">
        <button className="m-cta" disabled={!parsed} onClick={() => (clearCred(), (location.hash = link.slice(link.indexOf("#") + 1)), location.reload())}>{t("common.continue")}</button>
      </div>
    </div>
  );
}
