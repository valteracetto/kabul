import { useEffect, useState } from "react";
import { api, type BrowserBinary, type BrowserPolicy } from "../api";
import { confirmDialog } from "../components/Confirm";
import { noSuggest } from "../noSuggest";
import { Row, Toggle, useAppSettings } from "./settingsUi";
import { t } from "../i18n";
import { trError } from "../i18n/errors";

/**
 * Navegador do Kabul: um Chromium por workspace (perfil isolado), compartilhado entre o humano (aba
 * Browser) e todas as IAs pelo MCP `kabul-browser`. Política de aprovação, executável, download do
 * navegador quando não há nenhum e a alternativa só do Claude (Chrome do próprio usuário).
 */
export function BrowserSettings({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  const [info, setInfo] = useState<{ claudeChrome: boolean; binary: BrowserBinary | null } | null>(null);
  const [installing, setInstalling] = useState(false);
  const load = () => api.browserInfo().then(setInfo, () => setInfo({ claudeChrome: false, binary: null }));
  useEffect(() => void load(), []);
  if (!s) return null;
  const install = async () => {
    if (!(await confirmDialog(t("code.browser.installConfirm"), { ok: t("code.browser.install") }))) return;
    setInstalling(true);
    try {
      await api.browserInstall();
      await load();
    } catch (e) {
      onError(trError(e));
    } finally {
      setInstalling(false);
    }
  };
  const policy = s.browser_policy ?? "localhost";
  return (
    <div className="set-group" data-testid="browser-settings">
      <p className="dim small">{t("settings.browser.lead")}</p>
      <Toggle s={{ ...s, browser_mcp: s.browser_mcp ?? true }} save={save} k="browser_mcp" label={t("settings.browser.mcp")} hint={t("settings.browser.mcp.hint")} />
      <Row label={t("settings.browser.policy")} hint={t("settings.browser.policy.hint")} id="browser_policy">
        <select value={policy} onChange={(e) => save({ ...s, browser_policy: e.target.value as BrowserPolicy })} data-testid="browser-policy">
          <option value="ask">{t("settings.browser.policy.ask")}</option>
          <option value="localhost">{t("settings.browser.policy.localhost")}</option>
          <option value="all">{t("settings.browser.policy.all")}</option>
        </select>
      </Row>
      <Row label={t("settings.browser.detected")} hint={info?.binary ? info.binary.path : t("settings.browser.none")} id="browser_detected">
        {info && !info.binary ? (
          <button className="btn" disabled={installing} onClick={install} data-testid="browser-install-settings">{installing ? t("code.browser.installing") : t("code.browser.install")}</button>
        ) : (
          <span className="dim small" data-testid="browser-binary">{info?.binary?.kind ?? "…"}</span>
        )}
      </Row>
      <Row label={t("settings.browser.path")} hint={t("settings.browser.path.hint")} id="browser_path">
        <input {...noSuggest} autoComplete="off" defaultValue={s.browser_path ?? ""} placeholder={t("settings.browser.path.ph")} onBlur={(e) => (save({ ...s, browser_path: e.target.value.trim() || null }), setTimeout(load, 300))} data-testid="browser-path" />
      </Row>
      <Row label={t("settings.browser.profile")} hint={t("settings.browser.profile.hint")} id="browser_profile"><span /></Row>
      <h3>{t("settings.browser.claude")}</h3>
      <Toggle s={s} save={save} k="claude_chrome" label={t("settings.browser.claudeChrome")} hint={t("settings.browser.claudeChrome.hint")} />
      <p className="dim small" data-testid="claude-chrome-status">{info?.claudeChrome ? t("settings.browser.claudeChrome.found") : t("settings.browser.claudeChrome.missing")}</p>
    </div>
  );
}
