import { useEffect, useState } from "react";
import { api, type AccountRow } from "../api";
import { confirmDialog } from "./Confirm";

const PROVIDERS: [string, string][] = [["claude", "Claude"], ["codex", "ChatGPT / Codex"], ["agy", "Google / Gemini (Antigravity)"], ["gh", "GitHub"]];

/** Várias contas por provedor: cada uma com config isolada; uma é a padrão. */
export function AccountsPanel({ onError }: { onError: (e: string) => void }) {
  return <div className="acc-providers" data-testid="accounts-panel">{PROVIDERS.map(([p, label]) => <ProviderAccounts key={p} provider={p} label={label} onError={onError} />)}</div>;
}

function ProviderAccounts({ provider, label, onError }: { provider: string; label: string; onError: (e: string) => void }) {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [flow, setFlow] = useState<Record<string, { url?: string; code?: string; ask?: boolean; done?: string; input?: string }>>({});
  const load = () => api.accountsList(provider).then(setRows, (e) => onError(String(e)));
  useEffect(() => {
    load();
    return api.onAccountAuth(({ id, event }) => {
      if (!id.startsWith(provider + ":")) return;
      setFlow((f) => {
        const c = { ...(f[id] ?? {}) };
        if (event === "Ok") c.done = "ok";
        else if (event === "PedeCodigo") c.ask = true;
        else if ("Url" in event) c.url = event.Url;
        else if ("Codigo" in event) c.code = event.Codigo;
        else if ("Erro" in event) c.done = event.Erro;
        return { ...f, [id]: c };
      });
      if (event === "Ok") load();
    });
  }, [provider]);
  const iso = rows[0];
  return (
    <div className="account acc-provider" data-testid={`accounts-${provider}`}>
      <div className="acc-head"><b>{label}</b><span className="dim small">{iso?.env_var ? `isolamento: ${iso.env_var}${iso.env_confirmed ? "" : " (a confirmar)"}` : ""}</span></div>
      {rows.map((r) => {
        const f = flow[r.id];
        return (
          <div key={r.id} className="acc-row" data-testid="account-row">
            {editing?.id === r.id ? (
              <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") api.accountUpdate(r.id, { nickname: editing.name }).then(() => (setEditing(null), load())); if (e.key === "Escape") setEditing(null); }} data-testid="account-rename-input" />
            ) : (
              <span className="acc-name">{r.nickname}{r.email && <span className="dim small"> · {r.email}</span>}</span>
            )}
            {r.default && <span className="badge ok">padrão</span>}
            <span className={"badge " + (r.logged_in ? "ok" : "")}>{r.logged_in == null ? "?" : r.logged_in ? "logado" : "não logado"}</span>
            <span className="grow" />
            {r.dir && (
              <>
                {!r.default && <button className="text-btn small" onClick={() => api.accountUpdate(r.id, { makeDefault: true }).then(load)} data-testid="account-default">Tornar padrão</button>}
                <button className="text-btn small" onClick={() => setEditing({ id: r.id, name: r.nickname })} data-testid="account-rename">Renomear</button>
                <button className="text-btn small" onClick={async () => (await confirmDialog(`Remover a conta "${r.nickname}"? As credenciais dela no Kabul são apagadas.`, { ok: "Remover", danger: true })) && api.accountUpdate(r.id, { remove: true }).then(load)} data-testid="account-remove">Remover</button>
                {!f && <button className="btn" onClick={() => (setFlow({ ...flow, [r.id]: {} }), api.accountLogin(r.id).catch((e) => onError(String(e))))} data-testid="account-login">Entrar</button>}
              </>
            )}
            {f && (
              <div className="flow acc-flow">
                {f.code && <div>Código: <code className="big-code">{f.code}</code></div>}
                {f.url && <div className="small">Abra: <a className="url" onClick={() => api.openExternal(f.url!)}>{f.url}</a></div>}
                {f.ask && !f.done && (
                  <div className="row"><input placeholder="Cole o código" value={f.input ?? ""} onChange={(e) => setFlow({ ...flow, [r.id]: { ...f, input: e.target.value } })} data-testid="account-code" />
                    <button className="btn primary" onClick={() => api.accountCode(r.id, f.input ?? "").catch((e) => onError(String(e)))}>Enviar</button></div>
                )}
                {f.done && <div className={f.done === "ok" ? "ok" : "error"}>{f.done === "ok" ? "Conta conectada." : f.done}</div>}
                <button className="text-btn small" onClick={() => (api.accountCancel(r.id).catch(() => {}), setFlow((x) => { const n = { ...x }; delete n[r.id]; return n; }))}>{f.done ? "Fechar" : "Cancelar"}</button>
              </div>
            )}
          </div>
        );
      })}
      <div className="row acc-add">
        <input placeholder={`Apelido da nova conta ${label} (ex.: Trabalho)`} value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && adding.trim() && api.accountAdd(provider, adding.trim()).then(() => (setAdding(""), load()), (x) => onError(String(x)))} data-testid={`account-add-${provider}`} />
        <button className="btn" disabled={!adding.trim()} onClick={() => api.accountAdd(provider, adding.trim()).then(() => (setAdding(""), load()), (x) => onError(String(x)))}>Adicionar conta</button>
      </div>
    </div>
  );
}
