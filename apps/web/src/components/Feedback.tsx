import { useState } from "react";
import { createPortal } from "react-dom";
import { APP_VERSION } from "./HelpMenu";
import { t } from "../i18n";

/** Enviar feedback (⌘⌥F): monta o texto com a versão e copia; nada sai do computador sem você colar. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  const text = () => `${msg.trim()}\n\n---\nKabul v${APP_VERSION} · ${navigator.platform}`;
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()} data-testid="feedback">
        <div className="dialog-title">{t("app.feedback.title")}</div>
        <div className="dim small">{t("app.feedback.lead")}</div>
        <textarea autoFocus rows={6} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("app.feedback.placeholder")} data-testid="feedback-text" />
        <div className="row end">{done && <span className="ok small">{t("app.feedback.copied")}</span>}<button className="btn" onClick={onClose}>{t("common.close")}</button><button className="btn primary" disabled={!msg.trim()} onClick={() => navigator.clipboard.writeText(text()).then(() => setDone(true))} data-testid="feedback-copy">{t("app.feedback.copy")}</button></div>
      </div>
    </div>, document.body);
}
