import { useEffect, useRef, useState } from "react";
import { api, type Leftover } from "../api";
import { t } from "../i18n";

/**
 * Diálogo de confirmação próprio. O WKWebView do Tauri (wry) não implementa `window.confirm`:
 * ele devolve `false` sem mostrar nada — foi por isso que "Arquivar" não fazia nada no app real.
 */
type Req = { message: string; ok: string; danger: boolean; checkbox?: { label: string; key: string }; procs?: Leftover[]; resolve: (v: boolean, kill?: Leftover[]) => void };
let push: ((r: Req) => void) | null = null;

export function confirmDialog(message: string, opts: { ok?: string; danger?: boolean; checkbox?: { label: string; key: string } } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) return resolve(false);
    push({ message, ok: opts.ok ?? t("common.confirm"), danger: opts.danger ?? false, checkbox: opts.checkbox, resolve });
  });
}

/** Conversas com agente vivo (sessionId → chat do agente e workspace), para listar o que elas deixaram rodando. */
export const liveChats = new Map<string, { chat: string; ws: string }>();

/**
 * Confirmação de fechar aba, arquivar ou sair: lista os processos que os agentes abriram e que continuariam
 * rodando. Manter é o padrão; os marcados são encerrados. Devolve `false` se cancelou.
 */
export async function confirmClosing(chatIds: string[], message: string, opts: { ok?: string; danger?: boolean; checkbox?: { label: string; key: string }; ask?: boolean; workspaceId?: string | null } = {}): Promise<boolean> {
  const procs = chatIds.length ? await api.chatProcesses(chatIds).catch(() => [] as Leftover[]) : [];
  if (!procs.length && !opts.ask) return true;
  const full = procs.length ? `${message}${message ? "\n\n" : ""}${t("app.confirm.leftProcs", { count: procs.length })}` : message;
  const r = await new Promise<{ ok: boolean; kill: Leftover[] }>((resolve) => {
    if (!push) return resolve({ ok: false, kill: [] });
    push({ message: full, ok: opts.ok ?? t("common.confirm"), danger: opts.danger ?? false, checkbox: opts.checkbox, procs, resolve: (ok, kill = []) => resolve({ ok, kill }) });
  });
  if (!r.ok) return false;
  const keep = procs.filter((p) => !r.kill.includes(p));
  if (keep.length) await api.processesKeep(keep, opts.workspaceId ?? null).catch(() => {});
  if (r.kill.length) await api.processKill(r.kill.map(({ pid, start }) => ({ pid, start }))).catch(() => {});
  return true;
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [kill, setKill] = useState<Set<number>>(new Set());
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    push = setReq;
    return () => void (push = null);
  }, []);
  useEffect(() => okRef.current?.focus(), [req]);
  if (!req) return null;
  const done = (v: boolean) => (req.resolve(v, req.procs?.filter((p) => kill.has(p.pid))), setReq(null), setKill(new Set()));
  return (
    <div className="overlay center" onMouseDown={() => done(false)}>
      <div className="popover confirm" role="alertdialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && done(false)} data-testid="confirm">
        <div className="confirm-msg">{req.message}</div>
        {req.procs && req.procs.length > 0 && (
          <div className="confirm-procs" data-testid="confirm-procs">
            {req.procs.map((p) => (
              <label key={p.pid} className="lo-row" data-testid="confirm-proc">
                <input type="checkbox" checked={kill.has(p.pid)} onChange={(e) => setKill((s) => { const x = new Set(s); e.target.checked ? x.add(p.pid) : x.delete(p.pid); return x; })} data-testid="confirm-proc-kill" />
                <span className="lo-name">{p.name}</span><code className="lo-cmd" title={p.cmd}>{p.cmd}</code>
                {p.ports.length > 0 && <span className="lo-port mono">:{p.ports.join(", :")}</span>}
              </label>
            ))}
            <div className="dim small">{t("app.confirm.killHint")}</div>
          </div>
        )}
        {req.checkbox && <label className="check-row"><input type="checkbox" defaultChecked={localStorage.getItem(req.checkbox.key) === "1"} onChange={(e) => localStorage.setItem(req.checkbox!.key, e.target.checked ? "1" : "0")} data-testid="confirm-check" /> {req.checkbox.label}</label>}
        <div className="row end">
          <button className="btn" onClick={() => done(false)}>{t("common.cancel")}</button>
          <button ref={okRef} className={"btn " + (req.danger ? "danger" : "primary")} onClick={() => done(true)} data-testid="confirm-ok">{req.ok}</button>
        </div>
      </div>
    </div>
  );
}
