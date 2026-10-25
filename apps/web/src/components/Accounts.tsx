import { useEffect, useRef, useState } from "react";
import { trLabel } from "./Usage";
import { api, type AccountRow } from "../api";
import { confirmDialog } from "./Confirm";
import { LoginFlow, reduceLogin, MAX_RESTARTS, type LoginState } from "./LoginFlow";
import { t } from "../i18n";

const PROVIDERS: [string, string][] = [["claude", "Claude"], ["codex", "ChatGPT / Codex"], ["agy", "Google / Gemini (Antigravity)"], ["gh", "GitHub"]];

/** Várias contas por provedor: cada uma com config isolada; uma é a padrão. */
export function AccountsPanel({ onError }: { onError: (e: string) => void }) {
  return <div className="acc-providers" data-testid="accounts-panel">{PROVIDERS.map(([p, label]) => <ProviderAccounts key={p} provider={p} label={label} onError={onError} />)}</div>;
}

function ProviderAccounts({ provider, label, onError }: { provider: string; label: string; onError: (e: string) => void }) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [flow, setFlow] = useState<Record<string, LoginState>>({});
  const load = () => api.accountsList(provider).then(setRows, (e) => onError(String(e)));
  const restarts = useRef<Record<string, number>>({});
  const start = (id: string) => api.accountLogin(id).catch((e) => setFlow((f) => ({ ...f, [id]: { ...f[id], done: String(e) } })));
  useEffect(() => {
    load();
    return api.onAccountAuth(({ id, event }) => {
      if (!id.startsWith(provider + ":")) return;
      setFlow((f) => ({ ...f, [id]: reduceLogin(f[id], event) }));
      // O CLI desistiu de esperar (agy: 60 s): link novo sozinho, sem perder o campo do código.
      if (event === "Expirou" && (restarts.current[id] = (restarts.current[id] ?? 0) + 1) <= MAX_RESTARTS) start(id);
      if (event === "Ok") load();
    });
  }, [provider]);
  const iso = rows[0];
  return (
    <div className="account acc-provider" data-testid={`accounts-${provider}`}>
      <div className="acc-head"><b>{label}</b><span className="dim small">{iso?.env_var ? t("settings.accounts.isolation", { env: iso.env_var }) + (iso.env_confirmed ? "" : t("settings.accounts.unconfirmed")) : ""}</span></div>
      {rows.map((r) => {
        const f = flow[r.id];
        return (
          <div key={r.id} className="acc-row" data-testid="account-row">
            {editing?.id === r.id ? (
              <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") api.accountUpdate(r.id, { nickname: editing.name }).then(() => (setEditing(null), load())); if (e.key === "Escape") setEditing(null); }} data-testid="account-rename-input" />
            ) : (
              <span className="acc-name">{trLabel(r.nickname)}{r.email && <span className="dim small"> · {r.email}</span>}</span>
            )}
            {r.default && <span className="badge ok">{t("settings.accounts.default")}</span>}
            <span className={"badge " + (r.logged_in ? "ok" : "")}>{r.logged_in == null ? "?" : r.logged_in ? t("settings.accounts.loggedIn") : t("settings.accounts.notLoggedIn")}</span>
            <span className="grow" />
            {r.dir && (
              <>
                {!r.default && <button className="text-btn small" onClick={() => api.accountUpdate(r.id, { makeDefault: true }).then(load)} data-testid="account-default">{t("settings.accounts.makeDefault")}</button>}
                <button className="text-btn small" onClick={() => setEditing({ id: r.id, name: r.nickname })} data-testid="account-rename">{t("common.rename")}</button>
                <button className="text-btn small" onClick={async () => (await confirmDialog(t("settings.accounts.removeConfirm", { name: r.nickname }), { ok: t("common.remove"), danger: true })) && api.accountUpdate(r.id, { remove: true }).then(load)} data-testid="account-remove">{t("common.remove")}</button>
                {!f && <button className="btn" onClick={() => ((restarts.current[r.id] = 0), setFlow({ ...flow, [r.id]: {} }), start(r.id))} data-testid="account-login">{t("settings.accounts.signIn")}</button>}
              </>
            )}
            {f && (
              <div className="acc-flow">
                <LoginFlow f={f} codeNow={provider === "agy"} timeout={provider === "agy" ? 60 : undefined} testid="account-flow"
                  onInput={(v) => setFlow((x) => ({ ...x, [r.id]: { ...x[r.id], input: v } }))}
                  onSend={() => (setFlow((x) => ({ ...x, [r.id]: { ...x[r.id], sent: true } })), api.accountCode(r.id, f.input ?? "").catch((e) => onError(String(e))))}
                  onRetry={() => ((restarts.current[r.id] = 0), setFlow((x) => ({ ...x, [r.id]: { input: x[r.id]?.input } })), start(r.id))}
                  onCancel={() => (api.accountCancel(r.id).catch(() => {}), setFlow((x) => { const n = { ...x }; delete n[r.id]; return n; }))} />
              </div>
            )}
          </div>
        );
      })}
      <div className="row acc-add">
        <input placeholder={t("settings.accounts.nickname", { provider: label })} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adding.trim() && api.accountAdd(provider, adding.trim()).then(() => (setAdding(""), load()), (x) => onError(String(x)))} data-testid={`account-add-${provider}`} />
        <button className="btn" disabled={!adding.trim()} onClick={() => api.accountAdd(provider, adding.trim()).then(() => (setAdding(""), load()), (x) => onError(String(x)))}>{t("settings.accounts.addAccount")}</button>
      </div>
    </div>
  );
}
