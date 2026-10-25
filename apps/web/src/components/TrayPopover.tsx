import { useCallback, useEffect, useState } from "react";
import { api, HARNESS_LABEL, type HarnessKind, type RunningAgent, type UsageOverview } from "../api";
import { LimitBlocks, alertText, fmtTokens, fmtUsd } from "./Usage";
import { t } from "../i18n";

/**
 * Popover da barra do Kabul (janela `tray` do desktop; no navegador, `?mock&view=tray`): limites por
 * provedor/conta, gasto do dia/mês, agentes rodando agora e ações rápidas.
 */
export function TrayPopover() {
  const [o, setO] = useState<UsageOverview | null>(null);
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.usageOverview(30).then(setO, () => {});
    api.agentsRunning().then(setAgents, () => {});
  }, []);
  useEffect(() => {
    load();
    const off = api.onUsageChanged(load);
    // Sem evento de "conversa começou": relê os agentes a cada 5 s enquanto o popover está aberto.
    const timer = setInterval(() => document.visibilityState === "visible" && api.agentsRunning().then(setAgents, () => {}), 5000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && void api.trayHide().catch(() => {});
    window.addEventListener("keydown", esc);
    return () => (off(), clearInterval(timer), window.removeEventListener("keydown", esc));
  }, [load]);
  const act = (a: Parameters<typeof api.trayAction>[0], ws: string | null = null) => void api.trayAction(a, ws).catch(() => {});
  const refresh = async () => {
    setBusy(true);
    await api.usageRefresh().catch(() => {});
    setBusy(false);
    load();
  };
  const working = agents.filter((a) => a.working).length;
  return (
    <div className="tray-pop" data-testid="tray-popover">
      <header className="tray-head">
        <b>Kabul</b>
        <span className="grow" />
        <button className="btn ghost small" onClick={refresh} disabled={busy} title={t("usage.tray.reload")} data-testid="tray-refresh">{busy ? "…" : "↻"}</button>
      </header>
      <div className="tray-spend" data-testid="tray-spend">
        <div><div className="dim small">{t("usage.today")}</div><b>{o ? fmtUsd(o.today_usd) : "—"}</b><div className="dim small">{o ? `${fmtTokens(o.today_tokens)} tokens` : ""}</div></div>
        <div><div className="dim small">{t("usage.month")}</div><b>{o ? fmtUsd(o.month_usd) : "—"}</b><div className="dim small">{o ? `${fmtTokens(o.month_tokens)} tokens` : ""}</div></div>
      </div>
      {o && o.alerts.length > 0 && <div className="tray-alert" data-testid="tray-alert" onClick={() => act("usage")}>▲ {alertText(o.alerts[0])}{o.suggestions[0] ? ` · ${o.suggestions[0].to_account ? t("usage.tray.useAccount", { account: o.suggestions[0].to_account.nickname }) : t("usage.tray.switchModel")}` : ""}</div>}
      <div className="tray-scroll">
        {o && <LimitBlocks snap={o.limits} expected={o.expected} empty={<div className="dim small">{t("usage.tray.noLimits")}</div>} />}
        <div className="tray-sec">
          <span>{t("usage.tray.running")}</span><span className="count">{working}/{agents.length}</span>
        </div>
        {agents.length === 0 && <div className="dim small">{t("usage.tray.noChats")}</div>}
        {agents.map((a) => (
          <button key={a.chat_id} className="tray-agent" onClick={() => act("open-workspace", a.workspace_id)} data-testid="tray-agent">
            <span className={"dot" + (a.working ? " on" : "")} aria-label={a.working ? t("usage.tray.working") : t("usage.tray.idle")} />
            <span className="ta-ws">{a.workspace}</span>
            <span className="dim small">{a.model} · {HARNESS_LABEL[a.harness as HarnessKind] ?? a.harness}{a.working ? ` · ${t("usage.tray.working")}` : ""}</span>
          </button>
        ))}
      </div>
      <footer className="tray-actions">
        <button className="btn" onClick={() => act("new-workspace")} data-testid="tray-new">{t("usage.tray.newWorkspace")}</button>
        <button className="btn" onClick={() => act("open")} data-testid="tray-open">{t("usage.tray.openKabul")}</button>
        <button className="btn" onClick={() => act("pause-all")} disabled={!working} data-testid="tray-pause">{t("usage.tray.pauseAll")}</button>
        <button className="btn ghost" onClick={() => act("usage")} data-testid="tray-usage">{t("usage.title")}</button>
      </footer>
    </div>
  );
}
