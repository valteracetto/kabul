import { useCallback, useEffect, useState } from "react";
import { api, type UsageOverview, type UsageRow, type UsageSuggestion, type Workspace } from "../api";
import { DayChart, LimitBlocks, fmtDur, fmtTokens, fmtUsd, providerLabel } from "../components/Usage";
import type { Route } from "../App";
import { requestUsageSwitch } from "../components/usageSwitch";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
type Group = "model" | "account" | "workspace" | "provider";
const GROUPS: [Group, string][] = [["model", "Modelo"], ["account", "Conta"], ["workspace", "Workspace"], ["provider", "Provedor"]];

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
      if (isTauri) return setNote(`CSV salvo em ${await api.usageCsvSave(days)}`);
      const csv = await api.usageCsv(days);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `kabul-uso-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setNote("CSV exportado");
    } catch (e) {
      onError(String(e));
    }
  };
  const apply = async (s: UsageSuggestion, makeDefault = false) => {
    requestUsageSwitch({ provider: s.provider, account: s.to_account ?? undefined, toProvider: s.to_provider ?? undefined });
    if (makeDefault && s.to_account) await api.accountUpdate(s.to_account.id, { makeDefault: true }).catch((e) => onError(String(e)));
    setNote(s.to_account ? `Conversas abertas do ${providerLabel(s.provider)} usam ${s.to_account.nickname} a partir do próximo envio${makeDefault ? " (e ela virou a padrão)" : ""}.` : `Conversas abertas do ${providerLabel(s.provider)} trocam para o ${providerLabel(s.to_provider ?? "")} no próximo envio, na mesma conversa e branch.`);
  };

  const rows: UsageRow[] = o ? { model: o.by_model, account: o.by_account, workspace: o.by_workspace, provider: o.by_provider }[group] : [];
  const wsName = (id: string) => { const w = wss.find((x) => x.id === id); return w ? w.title || w.name : o?.by_workspace.find((r) => r.key === id)?.label ?? id; };
  const t = (n: number) => new Date(n * 1000).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="page usage" data-testid="usage-view">
      <header className="page-head" data-tauri-drag-region>
        <h2>Uso</h2>
        <span className="grow" />
        <div className="seg" role="tablist" aria-label="Período">
          {[7, 30, 90].map((d) => <button key={d} className={"btn" + (days === d ? " on" : "")} onClick={() => setDays(d)} data-testid={`usage-days-${d}`}>{d} dias</button>)}
        </div>
        <button className="btn" disabled={refreshing} onClick={refresh} data-testid="usage-refresh">{refreshing ? "Lendo limites…" : "Atualizar limites"}</button>
        <button className="btn" onClick={exportCsv} data-testid="usage-csv">Exportar CSV</button>
      </header>
      {note && <div className="usage-note" role="status" onClick={() => setNote(null)} data-testid="usage-note">{note}</div>}
      {!o && <div className="dim">Carregando…</div>}
      {o && (
        <>
          {(o.alerts.length > 0 || o.suggestions.length > 0) && (
            <div className="usage-alerts" data-testid="usage-alerts">
              {o.alerts.map((a) => <div key={a.key} className={"usage-alert lv-" + (a.level === "crit" ? "critical" : "serious")} data-testid="usage-alert">{a.level === "crit" ? "■" : "▲"} {a.text}</div>)}
              {o.suggestions.map((s, i) => (
                <div key={i} className="usage-suggest" data-testid="usage-suggestion">
                  <span>{s.text}</span><span className="grow" />
                  <button className="btn primary" onClick={() => apply(s)} data-testid="suggest-apply">{s.to_account ? `Usar ${s.to_account.nickname}` : `Trocar para ${providerLabel(s.to_provider ?? "")}`}</button>
                  {s.to_account && <button className="btn" onClick={() => apply(s, true)} data-testid="suggest-default">Tornar padrão</button>}
                </div>
              ))}
            </div>
          )}

          <div className="stat-tiles">
            <div className="stat"><div className="dim small">Hoje</div><div className="stat-v" data-testid="usage-today">{fmtUsd(o.today_usd)}</div><div className="dim small">{fmtTokens(o.today_tokens)} tokens</div></div>
            <div className="stat"><div className="dim small">Este mês</div><div className="stat-v" data-testid="usage-month">{fmtUsd(o.month_usd)}</div><div className="dim small">{fmtTokens(o.month_tokens)} tokens</div></div>
            <div className="stat"><div className="dim small">Sessões no período</div><div className="stat-v">{o.sessions.length}</div><div className="dim small">{fmtDur(o.sessions.reduce((a, s) => a + s.duration_ms, 0))} de agente</div></div>
          </div>
          {o.unpriced_turns > 0 && <div className="dim small">{o.unpriced_turns} turno{o.unpriced_turns === 1 ? "" : "s"} sem custo reportado pelo agente (Codex e Gemini não informam preço): os totais em US$ são um mínimo; tokens contam tudo.</div>}

          <h3>Limites</h3>
          <LimitBlocks snap={o.limits} alertPct={alertPct} />
          {o.limits.sources.length > 0 && <div className="dim small usage-sources">{o.limits.sources.map((s) => `${s.ok ? "✓" : "✕"} ${s.name}: ${s.detail}`).join(" · ")}</div>}

          <h3>
            {metric === "cost" ? "Custo por dia" : "Tokens por dia"}
            <span className="seg inline">
              <button className={"btn" + (metric === "cost" ? " on" : "")} onClick={() => setMetric("cost")} data-testid="metric-cost">US$</button>
              <button className={"btn" + (metric === "tokens" ? " on" : "")} onClick={() => setMetric("tokens")} data-testid="metric-tokens">Tokens</button>
            </span>
          </h3>
          <DayChart rows={o.by_day} metric={metric} />

          <h3>
            Por
            <span className="seg inline" role="tablist">
              {GROUPS.map(([k, l]) => <button key={k} className={"btn" + (group === k ? " on" : "")} onClick={() => setGroup(k)} data-testid={`group-${k}`}>{l}</button>)}
            </span>
          </h3>
          <table data-testid="usage-table">
            <thead><tr><th>{GROUPS.find((g) => g[0] === group)![1]}</th><th className="num">Turnos</th><th className="num">Tokens</th><th className="num">Custo</th><th className="num">Tempo do agente</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid="usage-row">
                  <td>{group === "workspace" ? wsName(r.key) : r.label}</td>
                  <td className="num">{r.turns}</td>
                  <td className="num">{fmtTokens(r.tokens)}</td>
                  <td className="num">{fmtUsd(r.cost_usd)}{r.unpriced > 0 && <span className="dim" title={`${r.unpriced} turno(s) sem custo reportado`}> +</span>}</td>
                  <td className="num">{fmtDur(r.duration_ms)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="dim">Nenhum turno no período.</td></tr>}
            </tbody>
          </table>

          <h3>Sessões <span className="count">{o.sessions.length}</span></h3>
          <table data-testid="usage-sessions">
            <thead><tr><th>Workspace</th><th>Modelo</th><th>Início</th><th className="num">Turnos</th><th className="num">Duração</th><th className="num">Tokens</th><th className="num">Custo</th></tr></thead>
            <tbody>
              {o.sessions.map((s) => {
                const open = wss.some((w) => w.id === s.workspace_id && !w.archived);
                return (
                  <tr key={s.session} data-testid="usage-session" className={open ? "clickable" : ""} onClick={() => open && onRoute({ kind: "workspace", id: s.workspace_id })} title={open ? "Abrir o workspace" : undefined}>
                    <td>{wsName(s.workspace_id)}</td>
                    <td>{s.model} <span className="dim small">{providerLabel(s.provider)}</span></td>
                    <td>{t(s.started)}</td>
                    <td className="num">{s.turns}</td>
                    <td className="num">{fmtDur(s.duration_ms)}</td>
                    <td className="num">{fmtTokens(s.tokens)}</td>
                    <td className="num">{s.unpriced === s.turns ? "—" : fmtUsd(s.cost_usd)}</td>
                  </tr>
                );
              })}
              {o.sessions.length === 0 && <tr><td colSpan={7} className="dim">Sem sessões no período.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
