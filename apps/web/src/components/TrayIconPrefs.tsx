/**
 * "Na barra de menus": o que o ícone do Kabul mostra (aba Uso e Configurações › Geral). Automático (os dois
 * limites mais apertados) ou até 3 limites escolhidos; estilo (barras, porcentagem, barras + %, só o ícone)
 * e o gasto do dia. Grava em app-settings (`tray_icon`); o desktop redesenha o ícone na hora.
 */
import { useEffect, useState } from "react";
import { api, type AppSettings, type PinnedLimit, type TrayIconPrefs, type UsageLimit } from "../api";
import { t, type Key } from "../i18n";
import { MAX_PINNED, limitAccount, limitTitle, pinOf, providerLabel, samePin, trLabel, useNow } from "./Usage";

export const TRAY_DEFAULT: TrayIconPrefs = { mode: "auto", pinned: [], style: "bars_percent", show_spend: false };
export const trayPrefs = (s: AppSettings | null): TrayIconPrefs => ({ ...TRAY_DEFAULT, ...(s?.tray_icon ?? {}) });

const STYLES: [TrayIconPrefs["style"], Key][] = [["bars", "usage.tray.style.bars"], ["percent", "usage.tray.style.percent"], ["bars_percent", "usage.tray.style.barsPercent"], ["icon", "usage.tray.style.icon"]];
const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/**
 * Liga/desliga um limite no ícone. Alfinete: fixar passa para o modo manual (vindo do automático, começa só
 * com ele); tirar o último volta ao automático. Caixa da lista (`keepManual`): continua no manual.
 */
export function togglePin(p: TrayIconPrefs, pin: PinnedLimit, keepManual = false): TrayIconPrefs {
  const cur = p.mode === "manual" ? p.pinned : [];
  const on = cur.some((x) => samePin(x, pin));
  const pinned = on ? cur.filter((x) => !samePin(x, pin)) : [...cur, pin].slice(0, MAX_PINNED);
  return { ...p, pinned, mode: pinned.length || keepManual ? "manual" : "auto" };
}

/** Os limites que o ícone mostra no modo manual (no automático, nenhum alfinete fica marcado). */
export const pinnedNow = (p: TrayIconPrefs) => (p.mode === "manual" ? p.pinned : []);

const live = (l: UsageLimit, now: number) => (l.resets_at ? l.resets_at > now : now - l.updated_at < 86400);
const who = (l: UsageLimit) => (l.account_label ? trLabel(l.account_label) : l.account?.endsWith(":sistema") ? t("usage.defaultAccount") : limitAccount(l));

/**
 * Editor das preferências do ícone. `limits` = os limites conhecidos (para escolher); sem eles, o componente
 * busca a visão geral (Configurações).
 */
export function TrayIconSection({ s, save, limits }: { s: AppSettings; save: (s: AppSettings) => void; limits?: UsageLimit[] }) {
  const now = useNow();
  const [own, setOwn] = useState<UsageLimit[] | null>(null);
  useEffect(() => void (limits === undefined && api.usageOverview(30).then((o) => setOwn(o.limits.limits), () => setOwn([]))), [limits === undefined]);
  const all = (limits ?? own ?? []).filter((l) => live(l, now));
  const p = trayPrefs(s);
  const set = (n: Partial<TrayIconPrefs>) => save({ ...s, tray_icon: { ...p, ...n } });
  // Escolhidos que estão sem leitura agora continuam na lista (para poder tirar).
  const orphans = p.pinned.filter((x) => !all.some((l) => samePin(pinOf(l), x)));
  const manual = p.mode === "manual";
  return (
    <div className="tray-prefs" data-testid="tray-prefs">
      <div className="seg" role="radiogroup" aria-label={t("usage.tray.section")}>
        <button className={"btn" + (!manual ? " on" : "")} role="radio" aria-checked={!manual} onClick={() => set({ mode: "auto" })} data-testid="tray-mode-auto">{t("usage.tray.mode.auto")}</button>
        <button className={"btn" + (manual ? " on" : "")} role="radio" aria-checked={manual} onClick={() => set({ mode: "manual" })} data-testid="tray-mode-manual">{t("usage.tray.mode.manual", { max: MAX_PINNED })}</button>
      </div>
      {manual && (
        <div className="tray-pick" data-testid="tray-pick">
          <div className="dim small">{t("usage.tray.pickHint", { max: MAX_PINNED })} <span className="count" data-testid="tray-pinned-count">{p.pinned.length}/{MAX_PINNED}</span></div>
          {all.length === 0 && orphans.length === 0 && <div className="dim small">{t("usage.tray.noneAvailable")}</div>}
          {all.map((l) => {
            const pin = pinOf(l);
            const on = p.pinned.some((x) => samePin(x, pin));
            const full = !on && p.pinned.length >= MAX_PINNED;
            return (
              <label key={`${l.provider}|${limitAccount(l)}|${l.window}`} className={"tray-pick-row" + (full ? " dim" : "")} title={full ? t("usage.pin.full") : undefined}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => set(togglePin(p, pin, true))} data-testid="tray-pick-item" data-pin={`${pin.provider}|${pin.account}|${pin.window}`} />
                <span>{providerLabel(l.provider)} · {who(l)} · {limitTitle(l.title)}</span>
                <span className="grow" />
                <span className="dim small">{l.used_pct.toFixed(0)}%</span>
              </label>
            );
          })}
          {orphans.map((x) => (
            <label key={`${x.provider}|${x.account}|${x.window}`} className="tray-pick-row">
              <input type="checkbox" checked onChange={() => set(togglePin(p, x, true))} data-testid="tray-pick-item" data-pin={`${x.provider}|${x.account}|${x.window}`} />
              <span>{providerLabel(x.provider)} · {x.account.endsWith(":sistema") ? t("usage.defaultAccount") : trLabel(x.account)} · {x.window}</span>
              <span className="grow" />
              <span className="dim small">{t("usage.tray.noDataNow")}</span>
            </label>
          ))}
        </div>
      )}
      <div className="tray-prefs-row">
        <label htmlFor="tray-style">{t("usage.tray.style")}</label>
        <select id="tray-style" value={p.style} onChange={(e) => set({ style: e.target.value as TrayIconPrefs["style"] })} data-testid="tray-style">
          {STYLES.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
        </select>
        <label className="tray-spend-opt">
          <input type="checkbox" checked={p.show_spend} onChange={(e) => set({ show_spend: e.target.checked })} data-testid="tray-show-spend" />
          {t("usage.tray.showSpend")}
        </label>
      </div>
      {isWindows && <div className="dim small">{t("usage.tray.windowsNote")}</div>}
      {s.tray === false && <div className="dim small" data-testid="tray-off-note">{t("usage.tray.off")}</div>}
    </div>
  );
}
