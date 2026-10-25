/**
 * Datas, números, moeda e durações no idioma da interface (Intl). Use estes em vez de
 * `toLocaleString("pt-BR")` ou de montar "US$ 1,23" à mão.
 */
import { lang, locale } from "./lang";

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.ListFormat>();
function memo<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.ListFormat>(id: string, make: () => T): T {
  const k = locale() + "|" + id;
  let f = cache.get(k) as T | undefined;
  if (!f) cache.set(k, (f = make()));
  return f;
}

/** 1234.5 → "1,234.5" (en) / "1.234,5" (pt-BR). */
export function fmtNum(n: number, opts: Intl.NumberFormatOptions = {}): string {
  return memo("n" + JSON.stringify(opts), () => new Intl.NumberFormat(locale(), opts)).format(n);
}

/** 0.42 → "42%"; `digits` casas decimais. Recebe fração (0–1). */
export function fmtPct(frac: number, digits = 0): string {
  return fmtNum(frac, { style: "percent", maximumFractionDigits: digits });
}

/** Dólares: "$1.23" (en) / "US$ 1,23" (pt-BR). `digits` fixa as casas (padrão 2). */
export function fmtMoney(usd: number, digits = 2): string {
  return fmtNum(usd, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Tokens e afins: 12345 → "12.3k" / "12,3 mil". */
export function fmtCompact(n: number): string {
  return fmtNum(n, { notation: "compact", maximumFractionDigits: 1 });
}

type DatePreset = "time" | "timeSec" | "date" | "dateShort" | "dayMonth" | "dayMonthTime" | "datetime" | "weekday";
const PRESETS: Record<DatePreset, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit" },
  timeSec: { hour: "2-digit", minute: "2-digit", second: "2-digit" },
  date: { day: "2-digit", month: "2-digit", year: "numeric" },
  dateShort: { day: "numeric", month: "short" },
  dayMonth: { day: "2-digit", month: "2-digit" },
  dayMonthTime: { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
  datetime: { dateStyle: "short", timeStyle: "short" },
  weekday: { weekday: "short" },
};

/** Data/hora: aceita Date, ms desde 1970 ou string ISO. `preset` ou opções do Intl. */
export function fmtDate(d: Date | number | string, preset: DatePreset | Intl.DateTimeFormatOptions = "datetime"): string {
  const opts = typeof preset === "string" ? PRESETS[preset] : preset;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return memo("d" + JSON.stringify(opts), () => new Intl.DateTimeFormat(locale(), opts)).format(date);
}

const UNITS: Record<"en" | "pt-BR", { d: string; h: string; m: string; s: string; sep: string }> = {
  en: { d: "d", h: "h", m: "m", s: "s", sep: " " },
  "pt-BR": { d: " d", h: " h", m: " min", s: " s", sep: " " },
};

/**
 * Duração em segundos, com as duas maiores unidades: "2m 21s", "1h 5m" (en) / "2 min 21 s", "1 h 5 min" (pt-BR).
 * `sep` troca o separador (ex.: ", " → "2m, 21s").
 */
export function fmtDuration(secs: number, sep?: string): string {
  const u = UNITS[lang()];
  const s = Math.max(0, Math.round(secs));
  const parts: [number, string][] = [
    [Math.floor(s / 86_400), u.d],
    [Math.floor((s % 86_400) / 3600), u.h],
    [Math.floor((s % 3600) / 60), u.m],
    [s % 60, u.s],
  ];
  const first = parts.findIndex(([n]) => n > 0);
  if (first < 0) return `0${u.s}`;
  const out = [parts[first], parts[first + 1]].filter((p): p is [number, string] => !!p && p[0] > 0);
  return out.map(([n, unit]) => `${n}${unit}`).join(sep ?? u.sep);
}

/**
 * Duração compacta, igual em pt-BR e en (pedido do Val): rodapé do turno "2m, 21s · 23:36", "45s" abaixo de
 * 1 min, "1h, 3m". Árvore de subagentes e painel Agentes usam `sep = " "` ("2m 21s"), como antes do i18n.
 */
export function fmtDurationShort(secs: number, sep = ", "): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${sep}${s % 60}s`;
  return `${Math.floor(s / 3600)}h${sep}${Math.floor((s % 3600) / 60)}m`;
}

/** "há 3 min" / "3 min ago"; `secs` no passado (positivo). Estilo curto, como na interface. */
export function fmtAgo(secs: number, style: Intl.RelativeTimeFormatStyle = "narrow"): string {
  const rtf = memo("r" + style, () => new Intl.RelativeTimeFormat(locale(), { numeric: "auto", style }));
  const s = Math.max(0, secs);
  if (s < 60) return rtf.format(-Math.max(1, Math.round(s)), "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86_400) return rtf.format(-Math.floor(s / 3600), "hour");
  if (s < 30 * 86_400) return rtf.format(-Math.floor(s / 86_400), "day");
  if (s < 365 * 86_400) return rtf.format(-Math.floor(s / (30 * 86_400)), "month");
  return rtf.format(-Math.floor(s / (365 * 86_400)), "year");
}

/** "em 3 h" / "in 3 h"; `secs` no futuro. */
export function fmtIn(secs: number, style: Intl.RelativeTimeFormatStyle = "narrow"): string {
  const rtf = memo("r" + style, () => new Intl.RelativeTimeFormat(locale(), { numeric: "auto", style }));
  const s = Math.max(0, secs);
  if (s < 3600) return rtf.format(Math.max(1, Math.round(s / 60)), "minute");
  if (s < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86_400), "day");
}

/** ["a", "b", "c"] → "a, b and c" / "a, b e c". */
export function fmtList(items: string[], type: Intl.ListFormatType = "conjunction"): string {
  return memo("l" + type, () => new Intl.ListFormat(locale(), { style: "long", type })).format(items);
}
