import { useEffect, useRef, useState } from "react";

/**
 * Diálogo de confirmação próprio. O WKWebView do Tauri (wry) não implementa `window.confirm`:
 * ele devolve `false` sem mostrar nada — foi por isso que "Arquivar" não fazia nada no app real.
 */
type Req = { message: string; ok: string; danger: boolean; checkbox?: { label: string; key: string }; resolve: (v: boolean) => void };
let push: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, opts: { ok?: string; danger?: boolean; checkbox?: { label: string; key: string } } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(false);
    push({ message, ok: opts.ok ?? "Confirmar", danger: opts.danger ?? false, checkbox: opts.checkbox, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    push = setReq;
    return () => void (push = null);
  }, []);
  useEffect(() => okRef.current?.focus(), [req]);
  if (!req) return null;
  const done = (v: boolean) => (req.resolve(v), setReq(null));
  return (
    <div className="overlay center" onMouseDown={() => done(false)}>
      <div className="popover confirm" role="alertdialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && done(false)} data-testid="confirm">
        <div className="confirm-msg">{req.message}</div>
        {req.checkbox && <label className="check-row"><input type="checkbox" defaultChecked={localStorage.getItem(req.checkbox.key) === "1"} onChange={(e) => localStorage.setItem(req.checkbox!.key, e.target.checked ? "1" : "0")} data-testid="confirm-check" /> {req.checkbox.label}</label>}
        <div className="row end">
          <button className="btn" onClick={() => done(false)}>Cancelar</button>
          <button ref={okRef} className={"btn " + (req.danger ? "danger" : "primary")} onClick={() => done(true)} data-testid="confirm-ok">{req.ok}</button>
        </div>
      </div>
    </div>
  );
}
