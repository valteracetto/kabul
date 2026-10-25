import { useCallback, useRef } from "react";
import { useDismiss } from "./useDismiss";
import type { Route } from "../App";
import { t } from "../i18n";

export const APP_VERSION = "0.1.0";

/** Menu de ajuda do rodapé (também no menu nativo Ajuda). */
export function HelpMenu({ onClose, onRoute, onFeedback }: { onClose: () => void; onRoute: (r: Route) => void; onFeedback: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, true, useCallback(() => onClose(), [onClose]));
  const go = (f: () => void) => () => (onClose(), f());
  return (
    <div ref={ref} className="popover status-pop help-pop" data-testid="help-menu">
      <div className="pop-row" onClick={go(() => onRoute({ kind: "settings", tab: "atalhos" }))} data-testid="help-shortcuts">{t("app.help.shortcuts")} <span className="grow" /><span className="kbd-hint">⌘⌥/</span></div>
      <div className="pop-row" onClick={go(() => onRoute({ kind: "diagnostics" }))} data-testid="help-diagnostics">{t("app.help.diagnostics")}</div>
      <div className="pop-row" onClick={go(onFeedback)} data-testid="help-feedback">{t("app.help.feedback")} <span className="grow" /><span className="kbd-hint">⌘⌥F</span></div>
      <div className="pop-row" onClick={go(() => window.dispatchEvent(new Event("kabul:devtools")))}>{t("app.help.devtools")} <span className="grow" /><span className="kbd-hint">⌘⌥I</span></div>
      <div className="pop-sep" />
      <div className="pop-title help-version">Kabul v{APP_VERSION}</div>
    </div>
  );
}
