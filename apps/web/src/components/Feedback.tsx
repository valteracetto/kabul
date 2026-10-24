import { useState } from "react";
import { createPortal } from "react-dom";
import { APP_VERSION } from "./HelpMenu";

/** Enviar feedback (⌘⌥F): monta o texto com a versão e copia; nada sai do computador sem você colar. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  const text = () => `${msg.trim()}\n\n---\nKabul v${APP_VERSION} · ${navigator.platform}`;
  return createPortal(
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()} data-testid="feedback">
        <div className="dialog-title">Enviar feedback</div>
        <div className="dim small">Conte o que aconteceu ou o que falta. O texto é copiado com a versão do app para você colar onde preferir (issue, e-mail, chat).</div>
        <textarea autoFocus rows={6} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="O que você gostaria de dizer?" data-testid="feedback-text" />
        <div className="row end">{done && <span className="ok small">copiado</span>}<button className="btn" onClick={onClose}>Fechar</button><button className="btn primary" disabled={!msg.trim()} onClick={() => navigator.clipboard.writeText(text()).then(() => setDone(true))} data-testid="feedback-copy">Copiar feedback</button></div>
      </div>
    </div>, document.body);
}
