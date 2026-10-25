import { useCallback, useEffect, useState } from "react";
import { api, HARNESS_LABEL, type HarnessKind, type RunningAgent, type UsageOverview } from "../api";
import { LimitBlocks, fmtTokens, fmtUsd } from "./Usage";

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
    const t = setInterval(() => document.visibilityState === "visible" && api.agentsRunning().then(setAgents, () => {}), 5000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && void api.trayHide().catch(() => {});
    window.addEventListener("keydown", esc);
    return () => (off(), clearInterval(t), window.removeEventListener("keydown", esc));
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
        <button className="btn ghost small" onClick={refresh} disabled={busy} title="Reler os limites" data-testid="tray-refresh">{busy ? "…" : "↻"}</button>
      </header>
      <div className="tray-spend" data-testid="tray-spend">
        <div><div className="dim small">Hoje</div><b>{o ? fmtUsd(o.today_usd) : "—"}</b><div className="dim small">{o ? `${fmtTokens(o.today_tokens)} tokens` : ""}</div></div>
        <div><div className="dim small">Mês</div><b>{o ? fmtUsd(o.month_usd) : "—"}</b><div className="dim small">{o ? `${fmtTokens(o.month_tokens)} tokens` : ""}</div></div>
      </div>
      {o && o.alerts.length > 0 && <div className="tray-alert" data-testid="tray-alert" onClick={() => act("usage")}>▲ {o.alerts[0].text}{o.suggestions[0] ? ` · ${o.suggestions[0].to_account ? `usar ${o.suggestions[0].to_account.nickname}` : "trocar de modelo"}` : ""}</div>}
      <div className="tray-scroll">
        {o && <LimitBlocks snap={o.limits} empty={<div className="dim small">Sem limites conhecidos ainda.</div>} />}
        <div className="tray-sec">
          <span>Agentes rodando</span><span className="count">{working}/{agents.length}</span>
        </div>
        {agents.length === 0 && <div className="dim small">Nenhuma conversa aberta.</div>}
        {agents.map((a) => (
          <button key={a.chat_id} className="tray-agent" onClick={() => act("open-workspace", a.workspace_id)} data-testid="tray-agent">
            <span className={"dot" + (a.working ? " on" : "")} aria-label={a.working ? "trabalhando" : "ocioso"} />
            <span className="ta-ws">{a.workspace}</span>
            <span className="dim small">{a.model} · {HARNESS_LABEL[a.harness as HarnessKind] ?? a.harness}{a.working ? " · trabalhando" : ""}</span>
          </button>
        ))}
      </div>
      <footer className="tray-actions">
        <button className="btn" onClick={() => act("new-workspace")} data-testid="tray-new">Novo workspace</button>
        <button className="btn" onClick={() => act("open")} data-testid="tray-open">Abrir Kabul</button>
        <button className="btn" onClick={() => act("pause-all")} disabled={!working} data-testid="tray-pause">Pausar todos</button>
        <button className="btn ghost" onClick={() => act("usage")} data-testid="tray-usage">Uso</button>
      </footer>
    </div>
  );
}
