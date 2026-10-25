import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BrowserFrame, type BrowserInput, type BrowserStatus, type Workspace } from "../api";
import { IBack, IClose, IFwd, IGlobe, IMore, IPlus, IRestore } from "../icons";
import { Floating } from "../components/Floating";
import { useDismiss } from "../components/useDismiss";
import { confirmDialog } from "../components/Confirm";
import { AGENT_RECENT_MS, cdpModifiers, pendingBrowserUrl, visibleBrowser } from "../components/browser";
import { noSuggest } from "../noSuggest";
import { t } from "../i18n";
import { trError } from "../i18n/errors";
import { fmtDate } from "../i18n/format";

/** O backend não achou nenhum Chrome/Edge/Chromium: oferece baixar o navegador do Kabul. */
const NO_BROWSER = /Nenhum Chrome, Edge ou Chromium encontrado/;
// i18n-ignore-next: nome da variável de ambiente
const PORT_VAR = "$KABUL_PORT";

/**
 * Aba Browser: o Chromium do workspace (o mesmo que os agentes usam pelo MCP `kabul-browser`) ao vivo.
 * A página chega como quadros JPEG (screencast do DevTools no app; captura periódica no kabuld/web) e o
 * mouse/teclado vão de volta como eventos de entrada: humano e agentes veem e mexem na mesma página.
 */
export function BrowserTab({ ws, active, onError }: { ws: Workspace; active: boolean; onError: (e: string) => void }) {
  const [st, setSt] = useState<BrowserStatus | null>(null);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [ports, setPorts] = useState(false);
  const [log, setLog] = useState(false);
  const [, tick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null), portsRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, menu, useCallback(() => setMenu(false), []));
  useDismiss(portsRef, ports, useCallback(() => setPorts(false), []));
  const img = useRef<HTMLImageElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const id = ws.id;

  const refresh = useCallback(() => api.browserStatus(id).then((s) => (setSt(s), s), (e) => (setErr(String(e)), null)), [id]);
  const fail = (e: unknown) => {
    const m = String((e as Error)?.message ?? e);
    setErr(m);
    if (!NO_BROWSER.test(m)) onError(m);
  };

  /** Abre o navegador (e a URL pedida, se houver). */
  const openUrl = useCallback(async (url: string | null) => {
    setBusy("open");
    setErr(null);
    try {
      setSt(await api.browserOpen(id, url));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [id]);

  // Montou (ou voltou a ficar visível): estado + URL pedida pelo terminal/deep link.
  useEffect(() => {
    if (!active) return;
    visibleBrowser.add(id);
    const want = pendingBrowserUrl[id];
    delete pendingBrowserUrl[id];
    if (want) void openUrl(want);
    else void refresh();
    const iv = setInterval(() => (document.hidden ? null : void refresh().then(() => tick((n) => n + 1))), 1500);
    const goto = (e: Event) => {
      const d = (e as CustomEvent).detail as { ws: string; url: string | null };
      if (d.ws !== id || !d.url) return;
      delete pendingBrowserUrl[id];
      void openUrl(d.url);
    };
    window.addEventListener("kabul:browser-open", goto);
    return () => (visibleBrowser.delete(id), clearInterval(iv), window.removeEventListener("kabul:browser-open", goto));
  }, [active, id]);

  // Quadros: screencast (app) ou captura periódica (kabuld/web, onde o comando não existe).
  const running = !!st?.running;
  useEffect(() => {
    if (!active || !running) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    const off = api.onBrowserFrame((f) => {
      if (f.workspace !== id) return;
      if (f.data) setFrame(f);
      else void refresh();
    });
    const shoot = () => !document.hidden && api.browserScreenshot(id, 60).then((f) => alive && (f ? setFrame(f) : void refresh()), () => {});
    api.browserScreencast(id, true).catch(() => {
      if (!alive) return;
      void shoot();
      poll = setInterval(shoot, 700);
    });
    return () => {
      alive = false;
      off();
      if (poll) clearInterval(poll);
      api.browserScreencast(id, false).catch(() => {});
    };
  }, [active, running, id]);

  useEffect(() => void (!editing && setAddr(st?.url && st.url !== "about:blank" ? st.url : "")), [st?.url, editing]);

  const nav = async (action: "goto" | "back" | "forward" | "reload", url: string | null = null) => {
    setBusy(action);
    try {
      if (!running) await api.browserOpen(id, null);
      await api.browserNav(id, action, url);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  // Em fila: cada comando roda numa thread do backend e um "up" não pode passar na frente do "down".
  const inputQueue = useRef<Promise<unknown>>(Promise.resolve());
  const send = (ev: BrowserInput) => void (inputQueue.current = inputQueue.current.then(() => api.browserInput(id, ev)).catch(() => {}));

  // ---------- mouse: coordenadas da imagem → pixels CSS da página ----------
  const vw = frame?.width || st?.viewport.width || 1280;
  const vh = frame?.height || st?.viewport.height || 800;
  const point = (e: { clientX: number; clientY: number }) => {
    const r = img.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: Math.round(((e.clientX - r.left) * vw) / r.width), y: Math.round(((e.clientY - r.top) * vh) / r.height) };
  };
  const BUTTONS = ["left", "middle", "right"] as const;
  const lastMove = useRef(0);
  const onMouse = (kind: "down" | "up" | "move") => (e: React.MouseEvent) => {
    const p = point(e);
    if (!p) return;
    if (kind === "move") {
      const now = performance.now();
      if (now - lastMove.current < 30) return;
      lastMove.current = now;
    }
    if (kind === "down") area.current?.focus();
    send({ type: "mouse", kind, x: p.x, y: p.y, button: kind === "move" ? undefined : BUTTONS[e.button] ?? "left", clicks: kind === "move" ? undefined : Math.max(1, e.detail), modifiers: cdpModifiers(e) });
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = point(e);
    if (p) send({ type: "mouse", kind: "wheel", x: p.x, y: p.y, dx: e.deltaX, dy: e.deltaY, modifiers: cdpModifiers(e) });
  };
  // ---------- teclado (com a página focada); ⌘+tecla fica com o app (atalhos) ----------
  const onKey = (kind: "down" | "up") => (e: React.KeyboardEvent) => {
    if (e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const text = kind === "down" ? (e.key.length === 1 && !e.ctrlKey && !e.altKey ? e.key : e.key === "Enter" ? "\r" : undefined) : undefined;
    send({ type: "key", kind, key: e.key, code: e.code, text, modifiers: cdpModifiers(e), keyCode: e.keyCode });
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (text) (e.preventDefault(), send({ type: "text", text }));
  };

  const control = (paused: boolean) => api.browserControl(id, paused).then(refresh, fail);
  const approve = (rid: string, allow: boolean, always = false) => api.browserApprove(id, rid, allow, always).then(refresh, fail);
  const install = async () => {
    if (!(await confirmDialog(t("code.browser.installConfirm"), { ok: t("code.browser.install") }))) return;
    setBusy("install");
    try {
      await api.browserInstall();
      setErr(null);
      await openUrl(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const clear = async () => {
    setMenu(false);
    if (!(await confirmDialog(t("code.browser.clearConfirm"), { ok: t("code.browser.clear"), danger: true }))) return;
    try {
      await api.browserClear(id);
      setFrame(null);
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const stop = async () => {
    setMenu(false);
    try {
      await api.browserStop(id);
      setFrame(null);
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const resize = async (preset: "desktop" | "mobile") => {
    setMenu(false);
    try {
      await api.browserResize(id, preset);
      await refresh();
    } catch (e) {
      fail(e);
    }
  };

  const agent = st?.agent && Date.now() - st.agent.at < AGENT_RECENT_MS ? st.agent : null;
  const mobile = !!st?.viewport.mobile;
  const ok = (s: string) => s.replace(/^https?:\/\//, "");
  return (
    <div className="browser-tab" data-testid="browser-tab">
      <div className="browser-bar">
        <button className="icon-btn" title={t("code.browser.back")} disabled={!running || !!busy} onClick={() => nav("back")} data-testid="browser-back"><IBack size={14} /></button>
        <button className="icon-btn" title={t("code.browser.forward")} disabled={!running || !!busy} onClick={() => nav("forward")} data-testid="browser-forward"><IFwd size={14} /></button>
        <button className="icon-btn" title={t("code.browser.reload")} disabled={!running || !!busy} onClick={() => nav("reload")} data-testid="browser-reload"><IRestore size={14} /></button>
        <form className="browser-addr" onSubmit={(e) => (e.preventDefault(), addr.trim() && (setEditing(false), void nav("goto", addr.trim())))}>
          <IGlobe size={13} />
          <input {...noSuggest} value={addr} placeholder={t("code.browser.addressPh")} onFocus={(e) => (setEditing(true), e.currentTarget.select())} onBlur={() => setEditing(false)} onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setEditing(false), setAddr(st?.url ?? ""), e.currentTarget.blur())} aria-label={t("code.browser.address")} data-testid="browser-address" />
          {busy && <span className="spinner tiny" />}
        </form>
        <div className="picker" ref={portsRef}>
          <button className="btn small" title={t("code.browser.portsTitle")} onClick={() => setPorts(!ports)} data-testid="browser-ports">localhost:{ws.port}</button>
          {ports && (
            <Floating className="status-pop" placement="bottom-end">
              <div className="pop-title">{t("code.browser.ports")}</div>
              {Array.from({ length: 10 }, (_, i) => ws.port + i).map((p) => (
                <div key={p} className="pop-row" onClick={() => (setPorts(false), void nav("goto", `http://localhost:${p}`))} data-testid="browser-port">localhost:{p}{p === ws.port && <span className="grow" />}{p === ws.port && <span className="dim small">{PORT_VAR}</span>}</div>
              ))}
            </Floating>
          )}
        </div>
        {/* Com um agente no controle, "Assumir controle" fica só na faixa do agente (um botão só). */}
        {(st?.paused || !agent) && <button className={"btn small" + (st?.paused ? " primary" : "")} disabled={!running} title={st?.paused ? t("code.browser.giveBackTitle") : t("code.browser.takeOverTitle")} onClick={() => control(!st?.paused)} data-testid="browser-control">{st?.paused ? t("code.browser.giveBack") : t("code.browser.takeOver")}</button>}
        <div className="picker" ref={menuRef}>
          <button className={"icon-btn" + (menu ? " on" : "")} title={t("code.browser.more")} onClick={() => setMenu(!menu)} data-testid="browser-menu"><IMore size={14} /></button>
          {menu && (
            <Floating className="status-pop" placement="bottom-end">
              <div className="pop-title">{t("code.browser.viewport")}</div>
              <div className={"pop-row" + (!mobile ? " on" : "")} onClick={() => resize("desktop")} data-testid="browser-vp-desktop">{t("code.browser.desktop")} <span className="grow" /><span className="dim small">1280×800</span></div>
              <div className={"pop-row" + (mobile ? " on" : "")} onClick={() => resize("mobile")} data-testid="browser-vp-mobile">{t("code.browser.mobile")} <span className="grow" /><span className="dim small">390×844</span></div>
              <div className="pop-sep" />
              <div className="pop-row" onClick={() => (setMenu(false), setLog(!log))} data-testid="browser-log-toggle">{t("code.browser.actions")}</div>
              <div className="pop-row" onClick={stop} data-testid="browser-stop">{t("code.browser.stop")}</div>
              <div className="pop-row danger" onClick={clear} data-testid="browser-clear">{t("code.browser.clear")}</div>
              <div className="pop-sep" />
              <div className="dim small browser-profile" title={st?.profile}>{t("code.browser.profileNote")}</div>
            </Floating>
          )}
        </div>
      </div>
      {st && st.tabs.length > 1 && (
        <div className="browser-tabs" data-testid="browser-tabs">
          {st.tabs.map((tb) => (
            <div key={tb.id} className={"browser-chip" + (tb.active ? " on" : "")} title={tb.url} onClick={() => api.browserTab(id, "select", tb.id).then(setSt, fail)} data-testid="browser-chip">
              <span className="ctab-title">{tb.title || ok(tb.url) || t("code.browser.blank")}</span>
              <button className="icon-btn" title={t("code.browser.closeTab")} onClick={(e) => (e.stopPropagation(), void api.browserTab(id, "close", tb.id).then(setSt, fail))}><IClose size={10} /></button>
            </div>
          ))}
          <button className="icon-btn" title={t("code.browser.newTab")} onClick={() => api.browserTab(id, "new").then(setSt, fail)} data-testid="browser-new-tab"><IPlus size={12} /></button>
        </div>
      )}
      {st?.approvals.map((a) => (
        <div key={a.id} className="browser-approval" role="alert" data-testid="browser-approval">
          <span>{a.kind === "navigate" ? t("code.browser.askNavigate", { agent: a.agent, url: a.detail }) : t("code.browser.askEvaluate", { agent: a.agent })}</span>
          {a.kind === "evaluate" && <code className="browser-code">{a.detail}</code>}
          <span className="grow" />
          <button className="btn small primary" onClick={() => approve(a.id, true)} data-testid="browser-allow">{t("code.browser.allow")}</button>
          {a.kind === "navigate" && <button className="btn small" onClick={() => approve(a.id, true, true)} data-testid="browser-always">{t("code.browser.always")}</button>}
          <button className="btn small" onClick={() => approve(a.id, false)} data-testid="browser-deny">{t("code.browser.deny")}</button>
        </div>
      ))}
      {st?.paused ? (
        <div className="browser-agent paused" data-testid="browser-paused">{t("code.browser.pausedNote")}</div>
      ) : agent ? (
        <div className="browser-agent" data-testid="browser-agent">
          <span className="spinner tiny" /> {t("code.browser.agentControlling", { agent: agent.agent })}
          <span className="dim small browser-agent-last">{agent.tool} {agent.detail}</span>
          <span className="grow" />
          <button className="btn small" onClick={() => control(true)} data-testid="browser-take-over">{t("code.browser.takeOver")}</button>
        </div>
      ) : null}
      <div className="browser-body">
        {running && frame?.data ? (
          <div ref={area} className={"browser-view" + (mobile ? " mobile" : "")} tabIndex={0} onKeyDown={onKey("down")} onKeyUp={onKey("up")} onPaste={onPaste} data-testid="browser-view">
            <img ref={img} src={`data:image/jpeg;base64,${frame.data}`} alt={st?.title ?? ""} draggable={false} onMouseDown={onMouse("down")} onMouseUp={onMouse("up")} onMouseMove={onMouse("move")} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} data-testid="browser-frame" />
          </div>
        ) : running ? (
          <div className="browser-empty dim">{t("code.browser.loading")}</div>
        ) : (
          <div className="browser-empty" data-testid="browser-closed">
            <IGlobe size={28} />
            <div>{t("code.browser.closed")}</div>
            <div className="dim small">{t("code.browser.closedHint")}</div>
            <button className="btn primary" disabled={!!busy} onClick={() => openUrl(null)} data-testid="browser-open">{busy === "open" ? t("code.browser.opening") : t("code.browser.open")}</button>
            {err && NO_BROWSER.test(err) ? (
              <div className="browser-install" data-testid="browser-no-binary">
                <div className="small">{t("code.browser.noBinary")}</div>
                <button className="btn" disabled={busy === "install"} onClick={install} data-testid="browser-install">{busy === "install" ? t("code.browser.installing") : t("code.browser.install")}</button>
              </div>
            ) : err ? <div className="error small">{trError(err)}</div> : null}
          </div>
        )}
        {log && (
          <div className="browser-log" data-testid="browser-log">
            <div className="row"><b>{t("code.browser.actions")}</b><span className="grow" /><button className="icon-btn" onClick={() => setLog(false)}><IClose size={12} /></button></div>
            {!st?.actions.length && <div className="dim small">{t("code.browser.noActions")}</div>}
            {st?.actions.slice().reverse().map((a, i) => (
              <div key={a.at + ":" + i} className={"browser-log-row small" + (a.ok ? "" : " error")}>
                <span className="dim">{fmtDate(a.at, "timeSec")}</span> <b>{a.agent}</b> {a.tool} <span className="dim">{a.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
