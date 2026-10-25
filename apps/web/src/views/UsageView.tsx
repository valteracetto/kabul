import { useCallback, useEffect, useState } from "react";
import { api, type UsageOverview, type UsageRow, type UsageSuggestion, type Workspace } from "../api";
import { DayChart, LimitBlocks, alertText, fmtDur, fmtTokens, fmtUsd, providerLabel, sourceText, suggestionText, trLabel } from "../components/Usage";
import { t, type Key } from "../i18n";
import { fmtDate } from "../i18n/format";
import type { Route } from "../App";
import { requestUsageSwitch } from "../components/usageSwitch";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
type Group = "model" | "account" | "workspace" | "provider";
const GROUPS: [Group, Key][] = [["model", "usage.group.model"], ["account", "usage.group.account"], ["workspace", "usage.group.workspace"], ["provider", "usage.group.provider"]];

/** Aba Uso: custo/tokens por dia, modelo, conta, workspace e provedor; limites; sessões; CSV. */
export function UsageView({ onError, onRoute }: { onError: (e: string) => void; onRoute: (r: Route) => void }) {
  const [days, setDays] = useState(30);
  const [o, setO] = useState<UsageOverview | null>(null);
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");
  const [group, setGroup] = useState<Group>("model");
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [alertPct, setAlertPct] = useState(80);
  const [wss, setWss] = useState<Workspace[]>([]);
  const load = useCallback(() => api.usageOverview(days).then(setO, (e) => onError(String(e))), [days, onError]);
  useEffect(() => void load(), [load]);
  useEffect(() => api.onUsageChanged(() => void load()), [load]);
  useEffect(() => void api.appSettings().then((s) => setAlertPct(s.usage_alert_pct ?? 80), () => {}), []);
  useEffect(() => void api.workspaces().then(setWss, () => {}), []);
  // Sem custo nenhum no período (só Codex/Gemini, que não reportam custo): o gráfico mostra tokens.
  useEffect(() => void (o && o.by_day.every((r) => r.cost_usd === 0) && o.by_day.some((r) => r.tokens > 0) && setMetric("tokens")), [o?.days]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.usageRefresh();
      await load();
    } catch (e) {
      onError(String(e));
    } finally {
      setRefreshing(false);
    }
  };
  const exportCsv = async () => {
    try {
      if (isTauri) return setNote(t("usage.csvSaved", { path: await api.usageCsvSave(days) }));
      const csv = await api.usageCsv(days);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `kabul-uso-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setNote(t("usage.csvExported"));
    } catch (e) {
      onError(String(e));
    }
  };
  const apply = async (s: UsageSuggestion, makeDefault = false) => {
    requestUsageSwitch({ provider: s.provider, account: s.to_account ?? undefined, toProvider: s.to_provider ?? undefined });
    if (makeDefault && s.to_account) await api.accountUpdate(s.to_account.id, { makeDefault: true }).catch((e) => onError(String(e)));
    const provider = providerLabel(s.provider);
    setNote(s.to_account ? t(makeDefault ? "usage.switched.accountDefault" : "usage.switched.account", { provider, account: s.to_account.nickname }) : t("usage.switched.provider", { provider, to: providerLabel(s.to_provider ?? "") }));
  };

  const rows: UsageRow[] = o ? { model: o.by_model, account: o.by_account, workspace: o.by_workspace, provider: o.by_provider }[group] : [];
  const wsName = (id: string) => { const w = wss.find((x) => x.id === id); return w ? w.title || w.name : o?.by_workspace.find((r) => r.key === id)?.label ?? id; };
  const when = (n: number) => fmtDate(n * 1000, "dayMonthTime");

  return (
    <section className="page usage" data-testid="usage-view">
      <header className="page-head" data-tauri-drag-region>
        <h2>{t("usage.title")}</h2>
        <span className="grow" />
        <div className="seg" role="tablist" aria-label={t("usage.period")}>
          {[7, 30, 90].map((d) => <button key={d} className={"btn" + (days === d ? " on" : "")} onClick={() => setDays(d)} data-testid={`usage-days-${d}`}>{t("usage.days", { count: d })}</button>)}
        </div>
        <button className="btn" disabled={refreshing} onClick={refresh} data-testid="usage-refresh">{refreshing ? t("usage.refreshing") : t("usage.refreshLimits")}</button>
        <button className="btn" onClick={exportCsv} data-testid="usage-csv">{t("usage.exportCsv")}</button>
      </header>
      {note && <div className="usage-note" role="status" onClick={() => setNote(null)} data-testid="usage-note">{note}</div>}
      {!o && <div className="dim">{t("common.loading")}</div>}
      {o && (
        <>
          {(o.alerts.length > 0 || o.suggestions.length > 0) && (
            <div className="usage-alerts" data-testid="usage-alerts">
              {o.alerts.map((a) => <div key={a.key} className={"usage-alert lv-" + (a.level === "crit" ? "critical" : "serious")} data-testid="usage-alert">{a.level === "crit" ? "■" : "▲"} {alertText(a)}</div>)}
              {o.suggestions.map((s, i) => (
                <div key={i} className="usage-suggest" data-testid="usage-suggestion">
                  <span>{suggestionText(s)}</span><span className="grow" />
                  <button className="btn primary" onClick={() => apply(s)} data-testid="suggest-apply">{s.to_account ? t("usage.useAccount", { account: s.to_account.nickname }) : t("usage.switchTo", { provider: providerLabel(s.to_provider ?? "") })}</button>
                  {s.to_account && <button className="btn" onClick={() => apply(s, true)} data-testid="suggest-default">{t("usage.makeDefault")}</button>}
                </div>
              ))}
            </div>
          )}

          <div className="stat-tiles">
            <div className="stat"><div className="dim small">{t("usage.today")}</div><div className="stat-v" data-testid="usage-today">{fmtUsd(o.today_usd)}</div><div className="dim small">{fmtTokens(o.today_tokens)} tokens</div></div>
            <div className="stat"><div className="dim small">{t("usage.thisMonth")}</div><div className="stat-v" data-testid="usage-month">{fmtUsd(o.month_usd)}</div><div className="dim small">{fmtTokens(o.month_tokens)} tokens</div></div>
            <div className="stat"><div className="dim small">{t("usage.sessionsInPeriod")}</div><div className="stat-v">{o.sessions.length}</div><div className="dim small">{t("usage.agentTime", { time: fmtDur(o.sessions.reduce((a, s) => a + s.duration_ms, 0)) })}</div></div>
          </div>
          {o.unpriced_turns > 0 && <div className="dim small">{t("usage.unpricedTurns", { count: o.unpriced_turns })}</div>}

          <h3>{t("usage.limits")}</h3>
          <LimitBlocks snap={o.limits} alertPct={alertPct} />
          {o.limits.sources.length > 0 && <div className="dim small usage-sources">{o.limits.sources.map(sourceText).join(" · ")}</div>}

          <h3>
            {metric === "cost" ? t("usage.chart.costPerDay") : t("usage.chart.tokensPerDay")}
            <span className="seg inline">
              <button className={"btn" + (metric === "cost" ? " on" : "")} onClick={() => setMetric("cost")} data-testid="metric-cost">{t("usage.metric.cost")}</button>
              <button className={"btn" + (metric === "tokens" ? " on" : "")} onClick={() => setMetric("tokens")} data-testid="metric-tokens">{t("usage.metric.tokens")}</button>
            </span>
          </h3>
          <DayChart rows={o.by_day} metric={metric} />

          <h3>
            {t("usage.by")}
            <span className="seg inline" role="tablist">
              {GROUPS.map(([k, l]) => <button key={k} className={"btn" + (group === k ? " on" : "")} onClick={() => setGroup(k)} data-testid={`group-${k}`}>{t(l)}</button>)}
            </span>
          </h3>
          <table data-testid="usage-table">
            <thead><tr><th>{t(GROUPS.find((g) => g[0] === group)![1])}</th><th className="num">{t("usage.col.turns")}</th><th className="num">{t("usage.col.tokens")}</th><th className="num">{t("usage.col.cost")}</th><th className="num">{t("usage.col.agentTime")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="usage-row">
                  <td>{group === "workspace" ? wsName(r.key) : trLabel(r.label)}</td>
                  <td className="num">{r.turns}</td>
                  <td className="num">{fmtTokens(r.tokens)}</td>
                  <td className="num">{fmtUsd(r.cost_usd)}{r.unpriced > 0 && <span className="dim" title={t("usage.row.unpriced", { count: r.unpriced })}> +</span>}</td>
                  <td className="num">{fmtDur(r.duration_ms)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="dim">{t("usage.noTurns")}</td></tr>}
            </tbody>
          </table>

          <h3>{t("usage.sessions")} <span className="count">{o.sessions.length}</span></h3>
          <table data-testid="usage-sessions">
            <thead><tr><th>{t("usage.col.workspace")}</th><th>{t("usage.col.model")}</th><th>{t("usage.col.started")}</th><th className="num">{t("usage.col.turns")}</th><th className="num">{t("usage.col.duration")}</th><th className="num">{t("usage.col.tokens")}</th><th className="num">{t("usage.col.cost")}</th></tr></thead>
            <tbody>
              {o.sessions.map((s) => {
                const open = wss.some((w) => w.id === s.workspace_id && !w.archived);
                return (
                  <tr key={s.session} data-testid="usage-session" className={open ? "clickable" : ""} onClick={() => open && onRoute({ kind: "workspace", id: s.workspace_id })} title={open ? t("usage.openWorkspace") : undefined}>
                    <td>{wsName(s.workspace_id)}</td>
                    <td>{s.model} <span className="dim small">{providerLabel(s.provider)}</span></td>
                    <td>{when(s.started)}</td>
                    <td className="num">{s.turns}</td>
                    <td className="num">{fmtDur(s.duration_ms)}</td>
                    <td className="num">{fmtTokens(s.tokens)}</td>
                    <td className="num">{s.unpriced === s.turns ? "—" : fmtUsd(s.cost_usd)}</td>
                  </tr>
                );
              })}
              {o.sessions.length === 0 && <tr><td colSpan={7} className="dim">{t("usage.noSessions")}</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
