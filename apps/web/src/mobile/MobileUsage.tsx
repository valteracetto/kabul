import { useCallback, useEffect, useState } from "react";
import type { UsageOverview } from "../api";
import { DayChart, LimitBlocks, fmtDur, fmtTokens, fmtUsd, providerLabel } from "../components/Usage";
import { kcall } from "./kabuld";
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
      <header className="m-top">
        <button className="m-btn ghost" onClick={onBack} aria-label="Voltar" data-testid="m-usage-back">‹</button>
        <div className="m-top-title"><b>Uso</b><span className="dim small">últimos 30 dias</span></div>
        <button className="m-btn small" onClick={refresh} disabled={busy}>{busy ? "…" : "Atualizar"}</button>
        <button className="m-btn small" onClick={() => void csv()} data-testid="m-usage-csv">CSV</button>
      </header>
      {err && <div className="m-error">{err}</div>}
      <main className="m-scroll m-pad usage m-usage">
        {!o && !err && <div className="m-empty dim">Carregando…</div>}
        {o && (
          <>
            {o.alerts.map((a) => <div key={a.key} className={"usage-alert lv-" + (a.level === "crit" ? "critical" : "serious")} data-testid="m-usage-alert">{a.level === "crit" ? "■" : "▲"} {a.text}</div>)}
            {o.suggestions.map((s, i) => <div key={i} className="usage-suggest dim small">{s.text} Troque no chat da conversa (conta/modelo).</div>)}
            <div className="stat-tiles">
              <div className="stat"><div className="dim small">Hoje</div><div className="stat-v" data-testid="m-usage-today">{fmtUsd(o.today_usd)}</div><div className="dim small">{fmtTokens(o.today_tokens)} tokens</div></div>
              <div className="stat"><div className="dim small">Mês</div><div className="stat-v">{fmtUsd(o.month_usd)}</div><div className="dim small">{fmtTokens(o.month_tokens)} tokens</div></div>
            </div>
            <h3>Limites</h3>
            <LimitBlocks snap={o.limits} />
            <h3 className="row">
              {metric === "cost" ? "Custo por dia" : "Tokens por dia"}<span className="grow" />
              <button className={"m-btn small" + (metric === "cost" ? " on" : "")} onClick={() => setMetric("cost")}>US$</button>
              <button className={"m-btn small" + (metric === "tokens" ? " on" : "")} onClick={() => setMetric("tokens")}>Tokens</button>
            </h3>
            <DayChart rows={o.by_day} metric={metric} height={110} />
            <h3>Por modelo</h3>
            {o.by_model.map((r) => <div key={r.key} className="m-usage-row"><span>{r.label}</span><span className="grow" /><span className="dim small">{fmtTokens(r.tokens)}</span><b>{fmtUsd(r.cost_usd)}</b></div>)}
            <h3>Sessões</h3>
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
