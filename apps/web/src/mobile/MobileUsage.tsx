import { useCallback, useEffect, useState } from "react";
import type { UsageOverview } from "../api";
import { DayChart, LimitBlocks, alertText, fmtDur, fmtTokens, fmtUsd, providerLabel, suggestionText } from "../components/Usage";
import { t } from "../i18n";
import { trError } from "../i18n/errors";
import { kcall } from "./kabuld";
import { BackButton, NavBar } from "./ui";
import { transport } from "../transport";

/** Uso no celular (só o dono): gasto, limites por provedor/conta, gráfico por dia, modelos e sessões. */
export function MobileUsage({ onBack }: { onBack: () => void }) {
  const [o, setO] = useState<UsageOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => kcall<UsageOverview>("usage_overview", { days: 30 }).then((v) => (setO(v), setErr(null)), (e) => setErr(String((e as Error).message ?? e))), []);
  useEffect(() => {
    load();
    return transport.subscribe("usage-changed", () => void load());
  }, [load]);
  const refresh = async () => {
    setBusy(true);
    await kcall("usage_refresh").catch(() => {});
    setBusy(false);
    load();
  };
  const csv = async () => {
    const text = await kcall<string>("usage_csv", { days: 30 });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = `kabul-uso-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <div className="m-page" data-testid="m-usage-detail">
      <NavBar
        title={t("usage.title")}
        sub={t("usage.m.last30")}
        left={<BackButton onClick={onBack} testid="m-usage-back" />}
      />
      {err && <div className="m-error">{trError(err)}</div>}
      <main className="m-scroll m-pad usage m-usage">
        {!o && !err && <div className="m-empty dim">{t("common.loading")}</div>}
        {o && (
          <>
            <div className="m-usage-actions">
              <button className="m-pill small" onClick={refresh} disabled={busy}>{busy ? "…" : t("common.refresh")}</button>
              <button className="m-pill small" onClick={() => void csv()} data-testid="m-usage-csv">CSV</button>
            </div>
            {o.alerts.map((a) => <div key={a.key} className={"usage-alert lv-" + (a.level === "crit" ? "critical" : "serious")} data-testid="m-usage-alert">{a.level === "crit" ? "■" : "▲"} {alertText(a)}</div>)}
            {o.suggestions.map((s, i) => <div key={i} className="usage-suggest dim small">{suggestionText(s)} {t("usage.m.suggestHint")}</div>)}
            <div className="stat-tiles">
              <div className="stat"><div className="dim small">{t("usage.today")}</div><div className="stat-v" data-testid="m-usage-today">{fmtUsd(o.today_usd)}</div><div className="dim small">{fmtTokens(o.today_tokens)} tokens</div></div>
              <div className="stat"><div className="dim small">{t("usage.month")}</div><div className="stat-v">{fmtUsd(o.month_usd)}</div><div className="dim small">{fmtTokens(o.month_tokens)} tokens</div></div>
            </div>
            <h3>{t("usage.limits")}</h3>
            <LimitBlocks snap={o.limits} />
            <h3 className="row">
              {metric === "cost" ? t("usage.chart.costPerDay") : t("usage.chart.tokensPerDay")}<span className="grow" />
              <button className={"m-btn small" + (metric === "cost" ? " on" : "")} onClick={() => setMetric("cost")}>{t("usage.metric.cost")}</button>
              <button className={"m-btn small" + (metric === "tokens" ? " on" : "")} onClick={() => setMetric("tokens")}>{t("usage.metric.tokens")}</button>
            </h3>
            <DayChart rows={o.by_day} metric={metric} height={110} />
            <h3>{t("usage.m.byModel")}</h3>
            {o.by_model.map((r) => <div key={r.key} className="m-usage-row"><span>{r.label}</span><span className="grow" /><span className="dim small">{fmtTokens(r.tokens)}</span><b>{fmtUsd(r.cost_usd)}</b></div>)}
            <h3>{t("usage.sessions")}</h3>
            {o.sessions.slice(0, 30).map((s) => (
              <div key={s.session} className="m-usage-row" data-testid="m-usage-session">
                <span className="m-ellipsis">{o.by_workspace.find((w) => w.key === s.workspace_id)?.label ?? s.workspace_id}<span className="dim small"> · {s.model} · {providerLabel(s.provider)}</span></span>
                <span className="grow" /><span className="dim small">{fmtDur(s.duration_ms)}</span><b>{s.unpriced === s.turns ? "—" : fmtUsd(s.cost_usd)}</b>
              </div>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
