import { useEffect, useState } from "react";
import { api, type UsageLimit } from "../api";
import type { Route } from "../App";
import { Floating } from "../components/Floating";
import { chatStore, statusOf, useChatSelect } from "../components/chatStore";
import { usePopover } from "../components/useDismiss";
import { t, type Key } from "../i18n";
import "./SideNav.css";
import { IBrain, ICube, IGauge, IGrid, IHistory, IHome, IList, IMore, IPlus, ISearch } from "../icons";

/**
 * Navegação do topo e do rodapé da barra lateral. O centro da barra é a lista de workspaces; aqui ficam só
 * "Novo workspace" (⌘N) e Buscar (⌘K) numa linha, e uma entrada "Visão geral" (Agentes · Quadro · Painel,
 * com o seletor dentro da tela). Início, Rotinas e Modelos locais vão para o menu "Mais" do rodapé, ao lado
 * do medidor de uso; tudo continua na paleta ⌘K.
 *
 * Alternativa B (flag de dev `localStorage["kabul.dev.sidebarNav"] = "icons"`): uma faixa de ícones, um
 * clique para cada tela, sem o menu "Mais".
 */

export const OVERVIEW = ["agents", "dashboard", "sessions"] as const;
export type OverviewKind = (typeof OVERVIEW)[number];
const LAST = "kabul.overview.last";
const isOverview = (k: string): k is OverviewKind => (OVERVIEW as readonly string[]).includes(k);
/** Última aba da Visão geral (o clique na entrada volta para ela). */
export const lastOverview = (): OverviewKind => {
  const v = localStorage.getItem(LAST) ?? "";
  return isOverview(v) ? v : "agents";
};
export const sideNavVariant = (): "overview" | "icons" => (localStorage.getItem("kabul.dev.sidebarNav") === "icons" ? "icons" : "overview");

const OV_LABEL: Record<OverviewKind, Key> = { agents: "app.agents.title", dashboard: "app.board.title", sessions: "app.sessions.title" };

/** Agentes ativos (não ociosos) e quantos esperam você, em todas as conversas de todos os workspaces. */
function useAgentCounts() {
  const active = useChatSelect(() => chatStore.all().filter((c) => statusOf(c) !== "idle").length, Object.is);
  const waiting = useChatSelect(() => chatStore.all().filter((c) => statusOf(c) === "waiting").length, Object.is);
  return { active, waiting };
}

function AgentsBadge({ testid }: { testid: string }) {
  const { active, waiting } = useAgentCounts();
  if (!active) return null;
  return <span className={"nav-count" + (waiting ? " waiting" : "")} title={t("app.side.agentsBadge", { active, waiting })} data-testid={testid}>{active}</span>;
}

const go = (r: Route) => window.dispatchEvent(new CustomEvent("kabul:route", { detail: r }));

/** Seletor dentro da tela (no lugar do título): Agentes · Quadro · Painel. */
export function OverviewTabs({ on }: { on: OverviewKind }) {
  useEffect(() => localStorage.setItem(LAST, on), [on]);
  return (
    <div className="ov-tabs" role="tablist" aria-label={t("app.side.overview")} data-testid="overview-tabs">
      {OVERVIEW.map((k) => (
        <button key={k} role="tab" aria-selected={k === on} className={k === on ? "on" : ""} onClick={() => k !== on && go({ kind: k })} data-testid={`ov-${k}`}>
          {t(OV_LABEL[k])}
          {k === "agents" && <AgentsBadge testid="ov-agents-count" />}
        </button>
      ))}
    </div>
  );
}

/** Topo: "Novo workspace" + Buscar, e a Visão geral (A) ou a faixa de ícones (B). */
export function SideNav({ route, onRoute, onCreate, onSearch }: { route: Route; onRoute: (r: Route) => void; onCreate: () => void; onSearch: () => void }) {
  const variant = sideNavVariant();
  return (
    <div className="side-nav2" data-variant={variant}>
      <div className="side-actions">
        <button className="side-new" onClick={onCreate} title={t("app.side.newWorkspace")} data-testid="create-ws"><IPlus size={14} /><span className="side-new-label">{t("app.side.newWs")}</span><span className="side-new-short">{t("app.side.newWsShort")}</span><span className="grow" /><kbd>⌘N</kbd></button>
        <button className="side-find" onClick={onSearch} title={t("app.side.searchTitle")} aria-label={t("common.search")} data-testid="nav-search"><ISearch size={14} /></button>
      </div>
      {variant === "overview" ? (
        <button className={"side-entry" + (isOverview(route.kind) ? " on" : "")} onClick={() => onRoute({ kind: lastOverview() })} title={t("app.side.overviewTitle")} data-testid="nav-overview">
          <IGrid /> <span className="side-entry-label">{t("app.side.overview")}</span><span className="grow" /><AgentsBadge testid="agents-count" />
        </button>
      ) : (
        <div className="side-icons" role="toolbar" aria-label={t("app.side.overview")}>
          {([["home", IHome, "app.pal.n.home"], ["agents", ICube, "app.agents.title"], ["dashboard", IList, "app.board.title"], ["sessions", IGrid, "app.sessions.title"], ["routines", IHistory, "app.routine.title"], ["local", IBrain, "app.pal.n.local"]] as const).map(([k, Icon, label]) => (
            <button key={k} className={"icon-btn" + (route.kind === k ? " on" : "")} title={t(label) + (k === "home" ? " (⌘⇧H)" : "")} aria-label={t(label)} onClick={() => onRoute({ kind: k })} data-testid={`nav-${k}`}>
              <Icon size={15} />
              {k === "agents" && <AgentsBadge testid="agents-count" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rodapé: medidor de uso (clicável) e, na alternativa A, o menu "Mais" (Início, Rotinas, Modelos locais). */
export function SideFootNav({ route, onRoute }: { route: Route; onRoute: (r: Route) => void }) {
  const more = usePopover<HTMLSpanElement>();
  const pick = (r: Route) => (more.close(), onRoute(r));
  return (
    <>
      <UsageMeter on={route.kind === "usage"} onOpen={() => onRoute({ kind: "usage" })} />
      <span className="grow" />
      {sideNavVariant() === "overview" && (
        <span className="picker" ref={more.ref}>
          <button className={"icon-btn" + (more.open || ["routines", "local"].includes(route.kind) ? " on" : "")} title={t("app.side.more")} aria-label={t("app.side.more")} aria-expanded={more.open} onClick={more.toggle} data-testid="nav-more"><IMore /></button>
          {more.open && (
            <Floating className="status-pop more-pop" placement="top-end" gap={6} testid="more-pop">
              <div className={"pop-row" + (route.kind === "home" ? " on" : "")} onClick={() => pick({ kind: "home" })} data-testid="nav-home"><IHome size={14} /> {t("app.pal.n.home")}<span className="grow" /><span className="kbd-hint">⌘⇧H</span></div>
              <div className={"pop-row" + (route.kind === "routines" ? " on" : "")} onClick={() => pick({ kind: "routines" })} data-testid="nav-routines"><IHistory size={14} /> {t("app.routine.title")}</div>
              <div className={"pop-row" + (route.kind === "local" ? " on" : "")} onClick={() => pick({ kind: "local" })} data-testid="nav-local"><IBrain size={14} /> {t("app.pal.n.local")}</div>
              <div className="pop-sep" />
              <div className={"pop-row" + (route.kind === "usage" ? " on" : "")} onClick={() => pick({ kind: "usage" })} data-testid="nav-more-usage"><IGauge size={14} /> {t("app.side.usageTitle")}</div>
            </Floating>
          )}
        </span>
      )}
    </>
  );
}

/** Limite mais apertado (o mesmo da barra de menus), em barrinha + %; sem limites conhecidos, só "Uso". */
function UsageMeter({ on, onOpen }: { on: boolean; onOpen: () => void }) {
  const [lim, setLim] = useState<UsageLimit | null>(null);
  useEffect(() => {
    const load = () => void api.usageOverview(1).then((o) => setLim(o.tightest ?? null), () => setLim(null));
    load();
    const off = api.onUsageChanged(load);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 120_000);
    return () => (off(), clearInterval(timer));
  }, []);
  const pct = lim ? Math.max(0, Math.round(lim.used_pct)) : null;
  // Mesmas faixas da aba Uso (alerta padrão em 80%).
  const lv = pct === null ? "" : pct >= 100 ? " lv-critical" : pct >= 80 ? " lv-serious" : pct >= 60 ? " lv-warning" : "";
  const title = pct === null ? t("app.side.usageTitle") : t("app.side.usageMeter", { pct });
  return (
    <button className={"usage-meter" + lv + (on ? " on" : "")} onClick={onOpen} title={title} aria-label={title} data-testid="nav-usage">
      <IGauge size={14} />
      {pct === null ? <span className="um-label">{t("app.side.usage")}</span> : <><span className="um-bar"><span className="um-fill" style={{ width: `${Math.min(100, pct)}%` }} /></span><span className="um-pct">{pct}%</span></>}
    </button>
  );
}
