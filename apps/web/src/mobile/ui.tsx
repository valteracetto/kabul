import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProviderMark } from "../icons";
import type { RunsOn } from "../components/RunsOn";
import { runsOnTooltip } from "../components/RunsOn";
import { AGENT_LABEL, STATUS_LABEL, type Status } from "./kabuld";
import { sheetHistory } from "./nav";
import { t } from "../i18n";
import { planLabel } from "./plan";

// ---------------- plataforma ----------------

export type Platform = "ios" | "android";
/**
 * iOS ou Android pelo user agent (`?plat=android|ios` força, para testar). Outros aparelhos usam o
 * visual do iOS. O CSS varia por `:root[data-platform]`; os componentes, por `PLATFORM`.
 */
export const PLATFORM: Platform = (() => {
  if (typeof navigator === "undefined") return "ios";
  const q = new URLSearchParams(location.search).get("plat");
  if (q === "android" || q === "ios") return q;
  return /Android/i.test(navigator.userAgent) ? "android" : "ios";
})();

// ---------------- ícones (traço fino, 24×24, cor do texto) ----------------

type IP = { size?: number };
const svg = (size: number, d: ReactNode, sw = 1.8) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const I = {
  back: ({ size = 22 }: IP) => (PLATFORM === "android" ? svg(size, <path d="M20 12H5M11 5l-7 7 7 7" />, 2) : svg(size, <path d="M15 5l-7 7 7 7" />, 2.2)),
  chevron: ({ size = 16 }: IP) => svg(size, <path d="M9 5l7 7-7 7" />, 2.2),
  close: ({ size = 20 }: IP) => svg(size, <path d="M6 6l12 12M18 6 6 18" />, 2.2),
  filter: ({ size = 22 }: IP) => svg(size, <path d="M4 7h16M7 12h10M10 17h4" />, 2),
  updown: ({ size = 14 }: IP) => svg(size, <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />, 2.2),
  plus: ({ size = 20 }: IP) => svg(size, <path d="M12 5v14M5 12h14" />, 2.2),
  mic: ({ size = 20 }: IP) => svg(size, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>),
  up: ({ size = 20 }: IP) => svg(size, <path d="M12 19V5M6 11l6-6 6 6" />, 2.4),
  stop: ({ size = 14 }: IP) => <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" /></svg>,
  check: ({ size = 18 }: IP) => svg(size, <path d="M5 12.5l4.5 4.5L19 7" />, 2.2),
  laptop: ({ size = 22 }: IP) => svg(size, <><rect x="4.5" y="5" width="15" height="10.5" rx="1.5" /><path d="M2.5 19h19" /></>, 1.6),
  arrows: ({ size = 22 }: IP) => svg(size, <path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5" />, 1.6),
  key: ({ size = 22 }: IP) => svg(size, <><circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H21M17.5 12v3M20 12v2" /></>, 1.6),
  moon: ({ size = 22 }: IP) => svg(size, <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />, 1.6),
  bell: ({ size = 22 }: IP) => svg(size, <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2.2 2.2 0 0 0 4 0" />, 1.6),
  globe: ({ size = 22 }: IP) => svg(size, <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z" /></>, 1.6),
  info: ({ size = 22 }: IP) => svg(size, <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.6v.2" /></>, 1.6),
  stack: ({ size = 24 }: IP) => svg(size, <><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /></>, 1.7),
  chart: ({ size = 24 }: IP) => svg(size, <path d="M5 20V12M10 20V5M15 20v-9M20 20v-5" />, 1.9),
  gear: ({ size = 24 }: IP) => svg(size, <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>, 1.7),
  branch: ({ size = 18 }: IP) => svg(size, <><circle cx="7" cy="5.5" r="2" /><circle cx="7" cy="18.5" r="2" /><circle cx="17" cy="8" r="2" /><path d="M7 7.5v9M17 10c0 4-10 2.5-10 6.5" /></>, 1.6),
  personPlus: ({ size = 19 }: IP) => svg(size, <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 19.5a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" /></>, 1.7),
  more: ({ size = 20 }: IP) => (PLATFORM === "android" ? svg(size, <><circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" /></>) : svg(size, <><circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" /></>)),
  folder: ({ size = 19 }: IP) => svg(size, <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />, 1.7),
  chatPlus: ({ size = 19 }: IP) => svg(size, <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.1A8 8 0 1 1 20 12zM12 8.5v7M8.5 12h7" />, 1.7),
  bolt: ({ size = 20 }: IP) => svg(size, <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z" />, 1.6),
  grip: ({ size = 18 }: IP) => svg(size, <path d="M5 9h14M5 15h14" />, 2),
  cloud: ({ size = 20 }: IP) => svg(size, <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18.5H7z" />, 1.6),
  plan: ({ size = 20 }: IP) => svg(size, <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />, 2),
  ctrl: ({ size = 20 }: IP) => svg(size, <path d="m6 14 6-6 6 6" />, 2),
};

/** Toque com resposta: vibração curta onde existe (Android) e marca visual no alvo. */
export function haptic(el?: Element | null, kind: "light" | "success" | "warn" = "light") {
  try {
    navigator.vibrate?.(kind === "light" ? 8 : kind === "success" ? [10, 40, 10] : 20);
  } catch {}
  if (el instanceof HTMLElement) {
    el.classList.remove("m-haptic", "m-haptic-success");
    void el.offsetWidth;
    el.classList.add(kind === "success" ? "m-haptic-success" : "m-haptic");
  }
}

// ---------------- agente, status, selos ----------------

const PROVIDER: Record<string, string> = { claude: "anthropic", codex: "openai", antigravity: "google", agy: "google", gemini: "google" };

/** Ícone do agente: marca do provedor quando há, terminal para shell. Anel animado quando trabalha. */
export function AgentIcon({ agent, size = 22, status }: { agent: string; size?: number; status?: Status }) {
  const p = PROVIDER[agent];
  return (
    <span className={`m-agent m-agent-${agent}` + (status ? ` m-ring-${status}` : "")} style={{ width: size, height: size }} title={AGENT_LABEL[agent] ?? agent} data-testid="m-agent" data-agent={agent}>
      {p ? (
        <ProviderMark provider={p} size={size - 4} />
      ) : agent === "shell" ? (
        <svg width={size - 6} height={size - 6} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 5 3 3-3 3M8.5 11.5h4" /></svg>
      ) : (
        <span className="m-agent-letter">{(AGENT_LABEL[agent] ?? agent).slice(0, 2)}</span>
      )}
    </span>
  );
}

export function StatusPill({ status, detail, compact }: { status: Status; detail?: string | null; compact?: boolean }) {
  return (
    <span className={`m-status m-status-${status}` + (compact ? " compact" : "")} data-testid="m-status" data-status={status} title={detail ?? undefined}>
      <span className="m-dot" />
      <span className="m-status-label">{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** Onde roda: Mac, nuvem do provedor, outra máquina. */
export function RunsOnLabel({ r, machine, os }: { r: RunsOn; machine?: string; os?: string }) {
  const provider: Record<string, string> = { claude: "Anthropic", codex: "OpenAI", gemini: "Google" };
  let text: string;
  let cls = "local";
  switch (r.kind) {
    case "provider_cloud":
      text = t("mobile.runsOn.cloud", { provider: provider[r.provider] ?? r.provider });
      cls = "cloud";
      break;
    case "kabul_cloud":
      text = t("mobile.runsOn.kabulCloud");
      cls = "cloud";
      break;
    case "remote":
      text = r.host;
      cls = "remote";
      break;
    default:
      text = os === "windows" ? "PC" : os && os !== "macos" ? "Local" : "Mac";
      if (r.mirrored) text += t("mobile.runsOn.mirrored");
  }
  const title = r.kind === "local" && machine ? t(r.mirrored ? "mobile.runsOn.runningOnMirrored" : "mobile.runsOn.runningOn", { machine }) : runsOnTooltip(r);
  return <span className={`m-runs m-runs-${cls}`} title={title} data-testid="m-runs-on" data-kind={r.kind}>{text}</span>;
}

export function Avatar({ name, color, size = 26, title }: { name: string; color: string; size?: number; title?: string }) {
  return <span className="m-avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.45 }} title={title ?? name}>{name.slice(0, 1).toUpperCase()}</span>;
}

// ---------------- navegação ----------------

/** Barra de navegação. Com `large`, o título grande fica no conteúdo e o pequeno só aparece ao rolar. */
export function NavBar({ title, collapsed = true, left, right, sub }: { title?: ReactNode; collapsed?: boolean; left?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className={"m-nav" + (collapsed ? " collapsed" : "")}>
      <div className="m-nav-side m-nav-l">{left}</div>
      <div className="m-nav-title">
        {title && <b className="m-ellipsis">{title}</b>}
        {sub && <span className="m-nav-sub m-ellipsis">{sub}</span>}
      </div>
      <div className="m-nav-side m-nav-r">{right}</div>
    </header>
  );
}

export function RoundButton({ children, onClick, label, testid, className = "" }: { children: ReactNode; onClick: () => void; label: string; testid?: string; className?: string }) {
  return (
    <button className={"m-round " + className} onClick={(e) => (haptic(e.currentTarget), onClick())} aria-label={label} title={label} data-testid={testid}>
      {children}
    </button>
  );
}

export const BackButton = ({ onClick, testid = "m-back" }: { onClick: () => void; testid?: string }) => (
  <RoundButton onClick={onClick} label={t("common.back")} testid={testid}>
    <I.back />
  </RoundButton>
);

/** Título grande que encolhe para a barra ao rolar: devolve o estado e o handler de scroll. */
export function useCollapse(threshold = 34): [boolean, (e: React.UIEvent<HTMLElement>) => void] {
  const [c, setC] = useState(false);
  return [c, (e) => setC(e.currentTarget.scrollTop > threshold)];
}

// ---------------- listas agrupadas (inset grouped) ----------------

export function Group({ header, footer, children, testid, className = "" }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; testid?: string; className?: string }) {
  return (
    <div className={"m-grp " + className} data-testid={testid}>
      {header && <div className="m-grp-head">{header}</div>}
      <div className="m-grp-body">{children}</div>
      {footer && <div className="m-grp-foot">{footer}</div>}
    </div>
  );
}

/** Linha de lista: ícone, texto, valor/acessório (chevron, ✓, toggle). */
export function Row({ icon, title, sub, value, chevron, check, toggle, onClick, testid, danger, disabled, children }: {
  icon?: ReactNode; title: ReactNode; sub?: ReactNode; value?: ReactNode; chevron?: boolean; check?: boolean; toggle?: boolean; onClick?: () => void; testid?: string; danger?: boolean; disabled?: boolean; children?: ReactNode;
}) {
  const body = (
    <>
      {icon && <span className="m-row-icon">{icon}</span>}
      <span className="m-row-text">
        <span className="m-row-title">{title}</span>
        {sub && <span className="m-row-sub">{sub}</span>}
      </span>
      {value !== undefined && <span className="m-row-value">{value}</span>}
      {children}
      {toggle !== undefined && <Toggle on={toggle} />}
      {check && <span className="m-row-check"><I.check /></span>}
      {chevron && <span className="m-row-chev"><I.chevron /></span>}
    </>
  );
  const cls = "m-row" + (danger ? " danger" : "") + (onClick ? " tappable" : "");
  return onClick ? (
    <button className={cls} onClick={(e) => (haptic(e.currentTarget), onClick())} data-testid={testid} disabled={disabled} role={toggle !== undefined ? "switch" : undefined} aria-checked={toggle}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={testid}>{body}</div>
  );
}

export const Toggle = ({ on }: { on: boolean }) => <span className={"m-toggle" + (on ? " on" : "")} aria-hidden="true"><span /></span>;

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: ReactNode; testid?: string }[]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.v === value));
  return (
    <div className="m-segmented" style={{ ["--n" as string]: options.length, ["--i" as string]: i }}>
      <span className="m-segmented-thumb" />
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? "on" : ""} onClick={(e) => (haptic(e.currentTarget), onChange(o.v))} data-testid={o.testid}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------- ações por deslize ----------------

export interface SwipeAction { label: string; icon?: ReactNode; tone: "red" | "orange" | "gray" | "blue"; onClick: () => void; testid?: string }

/** Linha com ações escondidas à direita (deslizar para a esquerda), como no Mail do iPhone. */
export function Swipe({ actions, children, className = "" }: { actions: SwipeAction[]; children: ReactNode; className?: string }) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number; base: number; lock: "h" | "v" | null } | null>(null);
  const moved = useRef(false);
  const width = actions.length * 78;
  if (!actions.length) return <div className={"m-swipe " + className}>{children}</div>;
  const end = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.lock !== "h") return;
    const shouldOpen = -dx > width / 2;
    setOpen(shouldOpen);
    setDx(shouldOpen ? -width : 0);
    if (shouldOpen) haptic(null);
  };
  return (
    <div className={"m-swipe " + className + (open ? " open" : "")}>
      <div className="m-swipe-actions" style={{ width }} aria-hidden={!open}>
        {actions.map((a) => (
          <button key={a.label} className={`m-swipe-btn ${a.tone}`} tabIndex={open ? 0 : -1} onClick={(e) => (haptic(e.currentTarget, "warn"), setOpen(false), setDx(0), a.onClick())} data-testid={a.testid}>
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <div
        className={"m-swipe-content" + (start.current ? "" : " settle")}
        style={{ transform: `translateX(${dx}px)` }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          start.current = { x: t.clientX, y: t.clientY, base: open ? -width : 0, lock: null };
          moved.current = false;
        }}
        onTouchMove={(e) => {
          const s = start.current;
          if (!s) return;
          const t = e.touches[0];
          const mx = t.clientX - s.x;
          const my = t.clientY - s.y;
          if (!s.lock && Math.hypot(mx, my) > 8) s.lock = Math.abs(mx) > Math.abs(my) ? "h" : "v";
          if (s.lock !== "h") return;
          moved.current = true;
          const v = Math.min(0, s.base + mx);
          setDx(v < -width ? -width + (v + width) / 3 : v);
        }}
        onTouchEnd={end}
        onTouchCancel={end}
        onClickCapture={(e) => {
          if (moved.current || open) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
            if (open) (setOpen(false), setDx(0));
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------- puxar para atualizar ----------------

/** Puxar para atualizar no topo de uma lista com rolagem. */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const handlers = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      start.current = e.currentTarget.scrollTop <= 0 && !busy ? e.touches[0].clientY : null;
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      if (start.current === null) return;
      const d = e.touches[0].clientY - start.current;
      setPull(d > 0 ? Math.min(90, d * 0.5) : 0);
    },
    onTouchEnd: () => {
      if (start.current === null) return;
      start.current = null;
      if (pull > 58) {
        haptic(null);
        setBusy(true);
        setPull(52);
        onRefresh().finally(() => (setBusy(false), setPull(0)));
      } else setPull(0);
    },
  };
  const indicator = (
    <div className={"m-ptr" + (busy ? " busy" : "")} style={{ height: pull, opacity: Math.min(1, pull / 50) }} aria-hidden="true">
      <span className="m-spinner" style={{ transform: busy ? undefined : `rotate(${pull * 4}deg)` }} />
    </div>
  );
  return { handlers, indicator };
}

// ---------------- folhas (bottom sheets) ----------------

/** Folha que sobe da base, com puxador, ✕ redondo à esquerda e título centralizado. Arrastar para baixo fecha. */
export function Sheet({ title, onClose, children, testid, full, onBack }: { title: string; onClose: () => void; children: ReactNode; testid?: string; full?: boolean; onBack?: () => void }) {
  const [dy, setDy] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const start = useRef<number | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const hist = useRef<{ dismiss: () => void; cleanup: () => void } | null>(null);
  useEffect(() => {
    // O voltar do sistema (Android) fecha a folha; fechar pela folha também tira a entrada do histórico.
    const h = sheetHistory(() => closeRef.current());
    hist.current = h;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && h.dismiss();
    window.addEventListener("keydown", esc);
    return () => (window.removeEventListener("keydown", esc), h.cleanup());
  }, []);
  const close = () => {
    setLeaving(true);
    setTimeout(() => hist.current?.dismiss(), 200);
  };
  const drag = {
    onTouchStart: (e: React.TouchEvent) => void (start.current = e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => start.current !== null && setDy(Math.max(0, e.touches[0].clientY - start.current)),
    onTouchEnd: () => {
      start.current = null;
      if (dy > 110) close();
      else setDy(0);
    },
  };
  return (
    <div className={"m-sheet-bg" + (leaving ? " leaving" : "")} onClick={close}>
      <div className={"m-sheet" + (full ? " full" : "") + (leaving ? " leaving" : "")} style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined} onClick={(e) => e.stopPropagation()} data-testid={testid} role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-sheet-grab" {...drag}><span /></div>
        <div className="m-sheet-head" {...drag}>
          {onBack ? (
            <RoundButton onClick={onBack} label={t("common.back")} className="small"><I.back size={18} /></RoundButton>
          ) : (
            <RoundButton onClick={close} label={t("common.close")} className="small"><I.close size={18} /></RoundButton>
          )}
          <b className="m-ellipsis">{title}</b>
          <span className="m-round-spacer" />
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Contagem regressiva até `expiresAt` (segundos Unix). */
export function useCountdown(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.round(expiresAt - now)) : 0;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** QR (SVG gerado pelo kabuld) + link + copiar/compartilhar. Usado também no painel do desktop. */
export function TicketCard({ svg, url, left, onRegen, big, onBig }: { svg: string; url: string; left: number; onRegen?: () => void; big?: boolean; onBig?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)), () => {});
  return (
    <div className={"m-ticket" + (big ? " big" : "")} data-testid="ticket">
      <div className={"m-qr" + (left === 0 ? " expired" : "")} dangerouslySetInnerHTML={{ __html: svg }} onClick={onBig} data-testid="ticket-qr" />
      <div className="m-ticket-info">
        <div className="m-ticket-left" data-testid="ticket-left">{left > 0 ? t("mobile.ticket.expiresIn", { time: mmss(left) }) : t("mobile.ticket.expired")}</div>
        <code className="m-ticket-url" data-testid="ticket-url">{url}</code>
        <div className="row">
          <button className="m-btn" onClick={copy}>{copied ? t("common.copied") : t("mobile.ticket.copyLink")}</button>
          {"share" in navigator && <button className="m-btn" onClick={() => navigator.share({ title: "Kabul", url }).catch(() => {})}>{t("mobile.ticket.share")}</button>}
          {onRegen && <button className="m-btn" onClick={onRegen} data-testid="ticket-regen">{t("mobile.ticket.regen")}</button>}
        </div>
      </div>
    </div>
  );
}

/** Indicador do plan mode (borda bege, listrado), "Plano" ou "Plano (emulado)". */
export const PlanChip = ({ mode, onClick }: { mode: "native" | "emulated"; onClick?: () => void }) => (
  <button className="m-plan-chip" onClick={(e) => (haptic(e.currentTarget), onClick?.())} disabled={!onClick} data-testid="m-plan-chip" data-mode={mode} title={mode === "emulated" ? t("mobile.plan.emulatedTitle") : t("mobile.plan.nativeTitle")}>
    <I.plan size={15} /> {planLabel(mode)}
  </button>
);

/** Estado vazio centralizado: título + subtítulo. */
export const Empty = ({ title, sub, testid }: { title: string; sub: string; testid?: string }) => (
  <div className="m-empty" data-testid={testid}>
    <b>{title}</b>
    <span>{sub}</span>
  </div>
);
