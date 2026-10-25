/**
 * Peças de uso e limites compartilhadas pela aba Uso, pelo popover da barra do Kabul e pelo celular.
 * Cores (skill dataviz): uma série só, azul validado nas duas superfícies; limites com as cores de status
 * reservadas, sempre com ícone + rótulo + número (nunca só a cor).
 */
import { useEffect, useState } from "react";
import type { LimitsSnapshot, UsageLimit, UsageRow } from "../api";
import "./usage.css";

export const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity", antigravity: "Antigravity", gemini: "Gemini", openrouter: "OpenRouter", opencode: "OpenCode", qwen: "Qwen", cursor: "Cursor", copilot: "Copilot", local: "Local" };
export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p;

export const fmtUsd = (n: number) => (n === 0 ? "US$ 0" : n < 0.01 ? "< US$ 0,01" : `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const fmtTokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} bi` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(n)).replace(".", ",");
export function fmtDur(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function countdown(secs: number) {
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
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
const LEVEL_TEXT: Record<Level, string> = { good: "", warning: "atenção", serious: "perto do limite", critical: "no limite" };
const LEVEL_ICON: Record<Level, string> = { good: "", warning: "▲", serious: "▲", critical: "■" };

const live = (l: UsageLimit, now: number) => (l.resets_at ? l.resets_at > now : now - l.updated_at < 86400);

/** Um bloco por provedor/conta. A conta aparece pelo rótulo da fonte (e-mail/apelido) ou pelo perfil. */
export function groupLimits(lims: UsageLimit[], now: number) {
  const m = new Map<string, { provider: string; who: string; plan: string | null; sources: Set<string>; windows: UsageLimit[] }>();
  for (const l of lims.filter((x) => live(x, now))) {
    const who = l.account_label ?? (l.account?.endsWith(":sistema") ? "Conta padrão" : l.account ?? "");
    const k = `${l.provider}|${l.account ?? l.account_label ?? ""}`;
    const g = m.get(k) ?? { provider: l.provider, who, plan: l.plan, sources: new Set<string>(), windows: [] };
    g.windows.push(l);
    g.sources.add(l.source);
    g.plan ??= l.plan;
    m.set(k, g);
  }
  return [...m.entries()].map(([key, g]) => ({ key, ...g, worst: Math.max(...g.windows.map((w) => w.used_pct)) }));
}

const SOURCE_LABEL: Record<string, string> = { "claude-stream": "stream do Claude", "codex-stream": "stream do Codex", "codex-app-server": "app-server do Codex", codexbar: "CodexBar" };

export function LimitBar({ l, now, alertPct }: { l: UsageLimit; now: number; alertPct: number }) {
  const lv = level(l.used_pct, alertPct);
  const pct = Math.max(0, Math.min(100, l.used_pct));
  return (
    <div className={"lim-row lv-" + lv} data-testid="limit-row" title={`${l.title}: ${l.used_pct.toFixed(0)}% usado${LEVEL_TEXT[lv] ? ` (${LEVEL_TEXT[lv]})` : ""} · fonte: ${SOURCE_LABEL[l.source] ?? l.source}`}>
      <div className="lim-top">
        <span className="lim-title">{l.title}</span>
        <span className="grow" />
        {LEVEL_ICON[lv] && <span className="lim-flag" aria-label={LEVEL_TEXT[lv]}>{LEVEL_ICON[lv]} {LEVEL_TEXT[lv]}</span>}
        <span className="lim-pct">{l.used_pct.toFixed(0)}%</span>
      </div>
      <div className="lim-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={l.title}><div className="lim-fill" style={{ width: `${pct}%` }} /></div>
      {l.resets_at && <div className="lim-reset dim small">reinicia em {countdown(Math.max(0, l.resets_at - now))}</div>}
    </div>
  );
}

export function LimitBlocks({ snap, alertPct = 80, empty }: { snap: LimitsSnapshot; alertPct?: number; empty?: React.ReactNode }) {
  const now = useNow();
  const groups = groupLimits(snap.limits, now);
  if (!groups.length) return <>{empty ?? <div className="dim small">Nenhum limite conhecido ainda: aparecem depois do primeiro turno do Claude ou do Codex, ou com o CodexBar instalado.</div>}</>;
  return (
    <div className="lim-blocks">
      {groups.map((g) => {
        const st = snap.status.find((s) => s.provider === g.provider && s.indicator && s.indicator !== "none");
        const cr = snap.credits.find((c) => c.provider === g.provider && (c.account_label ?? "") === (g.windows[0].account_label ?? ""));
        return (
          <div key={g.key} className="lim-block" data-testid="limit-block" data-provider={g.provider}>
            <div className="lim-head">
              <b>{providerLabel(g.provider)}</b>
              {g.who && <span className="dim">{g.who}</span>}
              {g.plan && <span className="lim-plan">{g.plan}</span>}
              <span className="grow" />
              {cr && <span className="dim small">créditos {cr.remaining.toLocaleString("pt-BR")}</span>}
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
  const day = (k: string) => { const [, m, d] = k.split("-"); return `${d}/${m}`; };
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="day-chart" data-testid="usage-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H + pad}`} preserveAspectRatio="none" role="img" aria-label={metric === "cost" ? "Custo por dia" : "Tokens por dia"}>
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
        <text x={W} y={H + 15} textAnchor="end" className="dc-tick">{rows.length > 0 && "hoje"}</text>
      </svg>
      <div className="dc-max dim small">{fmt(max)}</div>
      {h && (
        <div className="dc-tip" style={{ left: `${Math.min(85, Math.max(5, ((hover! + 0.5) / rows.length) * 100))}%` }} data-testid="chart-tip">
          <b>{day(h.key)}</b> {fmt(val(h))}
          <div className="dim">{h.turns} turno{h.turns === 1 ? "" : "s"} · {fmtTokens(h.tokens)} tokens{h.unpriced ? ` · ${h.unpriced} sem custo` : ""}</div>
        </div>
      )}
    </div>
  );
}
