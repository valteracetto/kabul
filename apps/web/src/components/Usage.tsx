/**
 * Peças de uso e limites compartilhadas pela aba Uso, pelo popover da barra do Kabul e pelo celular.
 * Cores (skill dataviz): uma série só, azul validado nas duas superfícies; limites com as cores de status
 * reservadas, sempre com ícone + rótulo + número (nunca só a cor).
 */
import { useEffect, useState } from "react";
import type { LimitsSnapshot, UsageAlert, UsageLimit, UsageRow, UsageSuggestion } from "../api";
import { lang, t, type Key } from "../i18n";
import { fmtDate, fmtMoney, fmtNum } from "../i18n/format";
import { trError } from "../i18n/errors";
import "./usage.css";

export const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity", antigravity: "Antigravity", gemini: "Gemini", openrouter: "OpenRouter", opencode: "OpenCode", qwen: "Qwen", cursor: "Cursor", copilot: "Copilot", local: "Local" };
export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p;

/** Dólares no idioma da interface: "US$ 1.234,50" / "$1,234.50" (espaço comum no lugar do não separável). */
export const fmtUsd = (n: number) => (n === 0 ? fmtMoney(0, 0) : n < 0.01 ? `< ${fmtMoney(0.01)}` : fmtMoney(n)).replace(/ /g, " ");

// Unidades curtas por idioma (tokens: "12,3 mil" / "12.3k"; tempo: "2 h 10 min" / "2h 10m").
const TOKEN_UNITS = { "pt-BR": [" bi", " mi", " mil"], en: ["B", "M", "k"] } as const;
const TIME_UNITS = { "pt-BR": { s: " s", m: " min", h: " h", d: " d" }, en: { s: "s", m: "m", h: "h", d: "d" } } as const;

export const fmtTokens = (n: number) => {
  const [b, m, k] = TOKEN_UNITS[lang()];
  const s = n >= 1e9 ? `${(n / 1e9).toFixed(1)}${b}` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}${m}` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}${k}` : String(n);
  return lang() === "pt-BR" ? s.replace(".", ",") : s;
};
export function fmtDur(ms: number) {
  const u = TIME_UNITS[lang()];
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}${u.s}`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}${u.m}` : `${Math.floor(m / 60)}${u.h} ${m % 60}${u.m}`;
}
export function countdown(secs: number) {
  const u = TIME_UNITS[lang()];
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}${u.d} ${h}${u.h}` : h > 0 ? `${h}${u.h} ${m}${u.m}` : `${Math.max(1, m)}${u.m}`;
}

// ---- textos que vêm do backend em português (títulos das janelas, alertas, sugestões, fontes) ----
// Em pt-BR passam como vieram; em inglês, os formatos conhecidos são traduzidos e o resto fica como veio.
const en = () => lang() === "en";

/** Contagem do backend ("3 h 20 min", "2 d 4 h") nas unidades do idioma. */
const trCountdown = (s: string) => (en() ? s.replace(/(\d+) d\b/g, "$1d").replace(/(\d+) h\b/g, "$1h").replace(/(\d+) min\b/g, "$1m") : s);

/** Título da janela de limite ("Sessão (5 h)", "Semana (Opus)", "Mês", "7 dias"…). */
export function limitTitle(title: string): string {
  if (!en()) return title;
  let m: RegExpMatchArray | null;
  if (/^Sessão \(5 h\)$/.test(title)) return t("usage.window.session5h");
  if (title === "Semana") return t("usage.window.week");
  if ((m = title.match(/^Semana \((.+)\)$/))) return t("usage.window.weekOf", { model: m[1] });
  if (title === "Mês") return t("usage.window.month"); // i18n-ignore: valor do backend
  if ((m = title.match(/^(\d+) dias$/))) return t("usage.window.days", { count: Number(m[1]) });
  if ((m = title.match(/^(\d+) h$/))) return t("usage.window.hours", { n: m[1] });
  if ((m = title.match(/^(\d+) min$/))) return t("usage.window.mins", { n: m[1] });
  return title;
}

/** Rótulos de conta/fonte que trazem "Padrão do sistema". */
export const trLabel = (s: string) => (en() ? s.replace(/Padrão do sistema/g, t("usage.systemDefault")) : s);

/** Fonte dos limites (nome e detalhe vêm do backend). */
export function sourceText(s: { name: string; ok: boolean; detail: string }): string {
  let name = trLabel(s.name), detail = s.detail;
  if (en()) {
    if (name === "Stream dos agentes") name = t("usage.src.agentStreams"); // i18n-ignore: valor do backend
    const m = detail.match(/^(\d+) janela\(s\)$/);
    if (m) detail = t("usage.src.windows", { count: Number(m[1]) });
    else if (detail === "Claude e Codex mandam os limites a cada turno") detail = t("usage.src.agentStreamsDetail");
    else if (!s.ok) detail = trError(detail);
  }
  return `${s.ok ? "✓" : "✕"} ${name}: ${detail}`;
}

/** Alerta com os campos estruturados (quando o backend os manda) para montar o texto no idioma da interface. */
type AlertX = UsageAlert & { pct?: number | null; resets_in_secs?: number | null; title?: string | null; provider_label?: string | null; spent_usd?: number | null; budget_usd?: number | null };

/** Texto do alerta de uso no idioma da interface (fallback: o texto do backend). */
export function alertText(a: AlertX): string {
  if (!en()) return a.text;
  if (a.kind === "limit") {
    const m = a.text.match(/^(?<who>.+?): (?<title>.+) em (?<pct>\d+)%(?:, reinicia em (?<reset>.+))?$/);
    if (!m?.groups) return a.text;
    const g = m.groups;
    const title = limitTitle(a.title ?? g.title);
    const pct = a.pct != null ? Math.round(a.pct) : g.pct;
    const time = a.resets_in_secs != null ? countdown(a.resets_in_secs) : g.reset ? trCountdown(g.reset) : null;
    return time ? t("usage.alert.limitReset", { who: g.who, title, pct, time }) : t("usage.alert.limit", { who: g.who, title, pct });
  }
  if (a.kind === "daily_budget" || a.kind === "monthly_budget") {
    const m = a.text.match(/: US\$ (?<spent>[\d.,]+) de US\$ (?<budget>[\d.,]+)(?: \((?<pct>\d+)%\))?$/);
    if (!m?.groups) return a.text;
    const g = m.groups;
    const spent = fmtUsd(a.spent_usd ?? Number(g.spent.replace(",", ".")));
    const budget = fmtUsd(a.budget_usd ?? Number(g.budget.replace(",", ".")));
    const pct = a.pct != null ? Math.round(a.pct) : g.pct;
    const base = a.kind === "daily_budget" ? "usage.alert.dailyBudget" : "usage.alert.monthlyBudget";
    return t((pct != null ? `${base}Pct` : base) as Key, { spent, budget, pct });
  }
  return a.text;
}

/** Texto da sugestão de troca de conta/LLM no idioma da interface (fallback: o texto do backend). */
export function suggestionText(s: UsageSuggestion): string {
  if (!en()) return s.text;
  const m = s.text.match(/^(?<provider>.+?) perto do limite \((?<title>.+): (?<pct>\d+)%\)\. (?:Usar a conta (?<account>.+) nas conversas|Trocar para um modelo do (?<to>.+) na mesma conversa)\.$/);
  if (!m?.groups) return s.text;
  const g = m.groups;
  const vars = { provider: g.provider, title: limitTitle(g.title), pct: g.pct };
  return g.account != null ? t("usage.suggest.account", { ...vars, account: g.account }) : t("usage.suggest.provider", { ...vars, to: g.to });
}

/** Re-render a cada 30 s (contagens até o reset). */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type Level = "good" | "warning" | "serious" | "critical";
export function level(pct: number, alertPct = 80): Level {
  return pct >= 100 ? "critical" : pct >= alertPct ? "serious" : pct >= alertPct - 20 ? "warning" : "good";
}
const LEVEL_KEY: Record<Level, Key | null> = { good: null, warning: "usage.level.warning", serious: "usage.level.serious", critical: "usage.level.critical" };
const levelText = (lv: Level) => { const k = LEVEL_KEY[lv]; return k ? t(k) : ""; };
const LEVEL_ICON: Record<Level, string> = { good: "", warning: "▲", serious: "▲", critical: "■" };

const live = (l: UsageLimit, now: number) => (l.resets_at ? l.resets_at > now : now - l.updated_at < 86400);

/** Um bloco por provedor/conta. A conta aparece pelo rótulo da fonte (e-mail/apelido) ou pelo perfil. */
export function groupLimits(lims: UsageLimit[], now: number) {
  const m = new Map<string, { provider: string; who: string; plan: string | null; sources: Set<string>; windows: UsageLimit[] }>();
  for (const l of lims.filter((x) => live(x, now))) {
    const who = l.account_label ?? (l.account?.endsWith(":sistema") ? t("usage.defaultAccount") : l.account ?? "");
    const k = `${l.provider}|${l.account ?? l.account_label ?? ""}`;
    const g = m.get(k) ?? { provider: l.provider, who, plan: l.plan, sources: new Set<string>(), windows: [] };
    g.windows.push(l);
    g.sources.add(l.source);
    g.plan ??= l.plan;
    m.set(k, g);
  }
  return [...m.entries()].map(([key, g]) => ({ key, ...g, worst: Math.max(...g.windows.map((w) => w.used_pct)) }));
}

const SOURCE_KEY: Record<string, Key> = { "claude-stream": "usage.source.claudeStream", "codex-stream": "usage.source.codexStream", "codex-app-server": "usage.source.codexAppServer" };
const sourceLabel = (src: string) => (SOURCE_KEY[src] ? t(SOURCE_KEY[src]) : src === "codexbar" ? "CodexBar" : src);

export function LimitBar({ l, now, alertPct }: { l: UsageLimit; now: number; alertPct: number }) {
  const lv = level(l.used_pct, alertPct);
  const pct = Math.max(0, Math.min(100, l.used_pct));
  const title = limitTitle(l.title), lvText = levelText(lv);
  const tip = { title, pct: l.used_pct.toFixed(0), level: lvText, source: sourceLabel(l.source) };
  return (
    <div className={"lim-row lv-" + lv} data-testid="limit-row" title={lvText ? t("usage.limit.tipLevel", tip) : t("usage.limit.tip", tip)}>
      <div className="lim-top">
        <span className="lim-title">{title}</span>
        <span className="grow" />
        {LEVEL_ICON[lv] && <span className="lim-flag" aria-label={lvText}>{LEVEL_ICON[lv]} {lvText}</span>}
        <span className="lim-pct">{l.used_pct.toFixed(0)}%</span>
      </div>
      <div className="lim-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={title}><div className="lim-fill" style={{ width: `${pct}%` }} /></div>
      {l.resets_at && <div className="lim-reset dim small">{t("usage.limit.resetsIn", { time: countdown(Math.max(0, l.resets_at - now)) })}</div>}
    </div>
  );
}

export function LimitBlocks({ snap, alertPct = 80, empty }: { snap: LimitsSnapshot; alertPct?: number; empty?: React.ReactNode }) {
  const now = useNow();
  const groups = groupLimits(snap.limits, now);
  if (!groups.length) return <>{empty ?? <div className="dim small">{t("usage.limits.none")}</div>}</>;
  return (
    <div className="lim-blocks">
      {groups.map((g) => {
        const st = snap.status.find((s) => s.provider === g.provider && s.indicator && s.indicator !== "none");
        const cr = snap.credits.find((c) => c.provider === g.provider && (c.account_label ?? "") === (g.windows[0].account_label ?? ""));
        return (
          <div key={g.key} className="lim-block" data-testid="limit-block" data-provider={g.provider}>
            <div className="lim-head">
              <b>{providerLabel(g.provider)}</b>
              {g.who && <span className="dim">{trLabel(g.who)}</span>}
              {g.plan && <span className="lim-plan">{g.plan}</span>}
              <span className="grow" />
              {cr && <span className="dim small">{t("usage.credits", { n: fmtNum(cr.remaining) })}</span>}
            </div>
            {st && <a className="lim-status small" href={st.url ?? undefined} onClick={(e) => (e.preventDefault(), st.url && window.dispatchEvent(new CustomEvent("kabul:open-url", { detail: st.url })))}>▲ {st.description}</a>}
            {g.windows.map((w) => <LimitBar key={w.window} l={w} now={now} alertPct={alertPct} />)}
          </div>
        );
      })}
    </div>
  );
}

/** Barras por dia (uma série). Hover mostra o dia, o valor e os tokens. */
export function DayChart({ rows, metric, height = 140 }: { rows: UsageRow[]; metric: "cost" | "tokens"; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = (r: UsageRow) => (metric === "cost" ? r.cost_usd : r.tokens);
  const max = Math.max(...rows.map(val), metric === "cost" ? 0.01 : 1);
  const W = 640, H = height, pad = 22, gap = 2;
  const bw = Math.max(2, (W - gap * (rows.length - 1)) / rows.length);
  const fmt = (n: number) => (metric === "cost" ? fmtUsd(n) : `${fmtTokens(n)} tokens`);
  const day = (k: string) => { const [y, m, d] = k.split("-").map(Number); return fmtDate(new Date(y, m - 1, d), "dayMonth"); };
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="day-chart" data-testid="usage-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H + pad}`} preserveAspectRatio="none" role="img" aria-label={metric === "cost" ? t("usage.chart.costPerDay") : t("usage.chart.tokensPerDay")}>
        <line x1="0" x2={W} y1={H} y2={H} className="dc-base" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="dc-grid" />
        {rows.map((r, i) => {
          const v = val(r);
          const bh = v > 0 ? Math.max(2, (v / max) * (H - 6)) : 0;
          const x = i * (bw + gap);
          const rad = Math.min(4, bw / 2, bh);
          return (
            <g key={r.key} onMouseEnter={() => setHover(i)} data-testid="chart-bar">
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              {bh > 0 && <path className={"dc-bar" + (hover === i ? " on" : "")} d={`M${x},${H} V${H - bh + rad} Q${x},${H - bh} ${x + rad},${H - bh} H${x + bw - rad} Q${x + bw},${H - bh} ${x + bw},${H - bh + rad} V${H} Z`} />}
            </g>
          );
        })}
        <text x="0" y={H + 15} className="dc-tick">{rows[0] && day(rows[0].key)}</text>
        <text x={W} y={H + 15} textAnchor="end" className="dc-tick">{rows.length > 0 && t("usage.chart.today")}</text>
      </svg>
      <div className="dc-max dim small">{fmt(max)}</div>
      {h && (
        <div className="dc-tip" style={{ left: `${Math.min(85, Math.max(5, ((hover! + 0.5) / rows.length) * 100))}%` }} data-testid="chart-tip">
          <b>{day(h.key)}</b> {fmt(val(h))}
          <div className="dim">{t("usage.chart.turns", { count: h.turns })} · {fmtTokens(h.tokens)} tokens{h.unpriced ? ` · ${t("usage.chart.unpriced", { count: h.unpriced })}` : ""}</div>
        </div>
      )}
    </div>
  );
}
