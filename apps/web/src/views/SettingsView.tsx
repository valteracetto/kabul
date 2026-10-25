import { comboFromEvent, conflict, editable, effectiveKeys, formatCombo, overrides, setOverride } from "../components/keymap";
import { confirmDialog } from "../components/Confirm";
import { RemotePanel } from "../components/RemotePanel";
import { LoginFlow, reduceLogin, MAX_RESTARTS, type LoginState } from "../components/LoginFlow";
import { noSuggest } from "../noSuggest";
import { useEffect, useRef, useState } from "react";
import { api, HARNESS_LABEL, type AuthStatus, type HarnessKind, type Layer, type Repo, type RepoSettingsT } from "../api";
import type { Route } from "../App";
import { AccountsPanel } from "../components/Accounts";
import { GitSettings } from "./SettingsGit";
import { CATEGORIES, shortcutLabel, SHORTCUTS, t, type Key } from "../i18n";
import { tNode } from "../i18n/react";
import { trError } from "../i18n/errors";
import { ActionsPage, AdvancedPage, AppearancePage, EnvironmentPage, GeneralPage, MiscPage, ModelsPage } from "./SettingsPages";
import { activeMachine, machines, normalizeUrl, saveMachines, switchMachine, type Machine } from "../components/machines";

/** Navegação das configurações, por grupo (pessoal, ambiente, repositório, mais). */
const GROUPS: [Key, string[]][] = [
  ["settings.group.personal", ["geral", "contas", "aparencia", "modelos", "git", "integracoes"]],
  ["settings.group.env", ["ambiente"]],
  ["settings.group.repo", ["repo", "acoes", "diversos"]],
  ["settings.group.more", ["remoto", "celular", "avancado", "atalhos"]],
];
const tabLabel = (k: string) => t(`settings.tab.${k}` as Key);

export function SettingsView({ tab, repoId, repos, onError, onRoute }: { tab: string; repoId?: string; repos: Repo[]; onError: (e: string) => void; onRoute: (r: Route) => void }) {
  const title = GROUPS.some(([, tabs]) => tabs.includes(tab)) ? tabLabel(tab) : t("settings.title");
  return (
    <section className="page settings-page" data-testid="settings-page">
      <header className="page-head" data-tauri-drag-region><h2>{t("settings.title")}</h2></header>
      <div className="settings-layout">
        <nav className="settings-nav" data-testid="settings-nav">
          {GROUPS.map(([g, tabs]) => (
            <div key={g} className="settings-nav-group">
              <div className="settings-nav-title">{t(g)}</div>
              {tabs.map((k) => <button key={k} className={"settings-nav-item" + (tab === k ? " on" : "")} onClick={() => onRoute({ kind: "settings", tab: k, repoId })} data-testid={`set-tab-${k}`}>{tabLabel(k)}</button>)}
            </div>
          ))}
        </nav>
        <div className="settings-body">
          <h3 className="settings-title">{title}</h3>
          {tab === "geral" && <GeneralPage onError={onError} />}
          {tab === "aparencia" && <AppearancePage />}
          {tab === "modelos" && <ModelsPage onError={onError} />}
          {tab === "ambiente" && <EnvironmentPage repos={repos} onError={onError} />}
          {tab === "acoes" && <ActionsPage repos={repos} repoId={repoId} onError={onError} onRoute={onRoute} />}
          {tab === "diversos" && <MiscPage repos={repos} repoId={repoId} onError={onError} onRoute={onRoute} onChange={() => window.dispatchEvent(new Event("kabul:reload"))} />}
          {tab === "avancado" && <AdvancedPage onError={onError} />}
          {tab === "contas" && <><GitHub onError={onError} /><Accounts onError={onError} /><h3>{t("settings.accounts.multi")}</h3><AccountsPanel onError={onError} /></>}
          {tab === "git" && <GitSettings repos={repos} onError={onError} />}
          {tab === "integracoes" && <Integrations onError={onError} />}
          {tab === "repo" && <RepoSettings repos={repos} repoId={repoId ?? repos[0]?.id} onError={onError} onRoute={onRoute} />}
          {tab === "remoto" && <Machines />}
          {tab === "celular" && <RemotePanel onError={onError} />}
          {tab === "atalhos" && <Shortcuts />}
        </div>
      </div>
    </section>
  );
}

function Accounts({ onError }: { onError: (e: string) => void }) {
  const [st, setSt] = useState<AuthStatus[]>([]);
  const [flows, setFlows] = useState<Partial<Record<HarnessKind, LoginState>>>({});
  const load = () => api.authStatus().then(setSt, (e) => onError(String(e)));
  const restarts = useRef<Partial<Record<HarnessKind, number>>>({});
  const start = (kind: HarnessKind) => api.authLogin(kind).catch((e) => setFlows((f) => ({ ...f, [kind]: { ...f[kind], done: String(e) } })));
  useEffect(() => {
    load();
    return api.onAuth(({ kind, event }) => {
      setFlows((f) => ({ ...f, [kind]: reduceLogin(f[kind], event) }));
      // O CLI desistiu de esperar (agy: 60 s): link novo sozinho, sem perder o campo do código.
      if (event === "Expirou" && (restarts.current[kind] = (restarts.current[kind] ?? 0) + 1) <= MAX_RESTARTS) start(kind);
      if (event === "Ok") load();
    });
  }, []);
  return (
    <>
      <p className="dim lead">{t("settings.accounts.lead")}</p>
      <div className="accounts">
        {st.map((a) => {
          const f = flows[a.kind];
          return (
            <div key={a.kind} className="account" data-testid="account">
              <div className="acc-head">
                <b>{HARNESS_LABEL[a.kind]}</b>
                <span className={"badge " + (a.error ? "bad" : a.logged_in ? "ok" : "")}>{a.error ? t("common.error") : !a.installed ? t("settings.accounts.notInstalled") : a.logged_in ? t("settings.accounts.loggedIn") : t("settings.accounts.notLoggedIn")}</span>
              </div>
              <div className="dim small">{(a.error && trError(a.error)) ?? [a.method, a.source].filter(Boolean).join(" · ")}</div>
              {!a.installed ? <button className="btn" onClick={() => confirmDialog(t("settings.accounts.installConfirm", { name: HARNESS_LABEL[a.kind] })).then((ok) => void (ok && api.installHarness(a.kind).then(() => onError(t("settings.accounts.installStarted", { name: HARNESS_LABEL[a.kind] })), (e) => onError(String(e)))))}>{t("settings.accounts.install")}</button>
                : !f && <button className="btn" onClick={() => ((restarts.current[a.kind] = 0), setFlows((x) => ({ ...x, [a.kind]: {} })), start(a.kind))} data-testid={`auth-login-${a.kind}`}>{a.logged_in ? t("settings.accounts.signInAgain") : t("settings.accounts.signIn")}</button>}
              {f && (
                <LoginFlow f={f} codeNow={a.kind === "antigravity"} timeout={a.kind === "antigravity" ? 60 : undefined}
                  onInput={(v) => setFlows((x) => ({ ...x, [a.kind]: { ...x[a.kind], input: v } }))}
                  onSend={() => (setFlows((x) => ({ ...x, [a.kind]: { ...x[a.kind], sent: true } })), api.authCode(a.kind, f.input ?? "").catch((e) => onError(String(e))))}
                  onRetry={() => ((restarts.current[a.kind] = 0), setFlows((x) => ({ ...x, [a.kind]: { input: x[a.kind]?.input } })), start(a.kind))}
                  onCancel={() => { api.authCancel(a.kind).catch(() => {}); setFlows((x) => ({ ...x, [a.kind]: undefined })); }} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function RepoSettings({ repos, repoId, onError, onRoute }: { repos: Repo[]; repoId?: string; onError: (e: string) => void; onRoute: (r: Route) => void }) {
  const [s, setS] = useState<RepoSettingsT | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [newRun, setNewRun] = useState({ id: "", command: "" });
  useEffect(() => {
    if (repoId) api.repoSettings(repoId).then((r) => (setS(r.settings), setLayers(r.layers)), (e) => onError(String(e)));
  }, [repoId, onError]);
  if (!repos.length) return <p className="dim">{t("settings.repo.addFirst")}</p>;
  const repo = repos.find((r) => r.id === repoId);
  return (
    <div className="set-group" data-testid="repo-settings">
      <div className="set-row"><div>{t("settings.repo.label")}</div><select value={repoId} onChange={(e) => onRoute({ kind: "settings", tab: "repo", repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      {repo && <div className="dim small">{t("settings.repo.defaultBranch", { path: repo.path, branch: repo.default_branch })}</div>}
      <h3>{t("settings.repo.layers")}</h3>
      {layers.map((l) => <div key={l.path} className="layer"><span className={"dot " + (l.found ? "st-done" : "")} /> <b>{l.name}</b> <code>{l.path}</code> <span className="dim">{l.found ? t("settings.repo.found") : "—"}</span></div>)}
      {s && (
        <>
          <h3>{t("settings.repo.scripts")}</h3>
          <label className="field">{t("settings.repo.setup")} <span className="dim small">{t("settings.repo.setup.hint")}</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.scripts.setup ?? ""} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, setup: e.target.value || null } })} placeholder={t("settings.repo.setup.placeholder")} /></label>
          <label className="field">{t("settings.repo.archive")} <span className="dim small">{t("settings.repo.archive.hint")}</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.scripts.archive ?? ""} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, archive: e.target.value || null } })} placeholder={t("settings.repo.archive.placeholder")} /></label>
          <label className="field">{t("settings.repo.runMode")}<select value={s.scripts.run_mode ?? "concurrent"} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, run_mode: e.target.value } })}><option value="concurrent">{t("settings.repo.runMode.concurrent")}</option><option value="nonconcurrent">{t("settings.repo.runMode.nonconcurrent")}</option></select></label>
          <div className="field">{t("settings.repo.runScripts")}</div>
          {Object.entries(s.scripts.run).map(([id, r]) => (
            <div key={id} className="row env-row">
              <code>{id}</code><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={r.command} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, run: { ...s.scripts.run, [id]: { ...r, command: e.target.value } } } })} />
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="radio" checked={r.default} onChange={() => setS({ ...s, scripts: { ...s.scripts, run: Object.fromEntries(Object.entries(s.scripts.run).map(([k, v]) => [k, { ...v, default: k === id }])) } })} /> {t("settings.repo.runDefault")}</label>
              <button className="btn" onClick={() => { const run = { ...s.scripts.run }; delete run[id]; setS({ ...s, scripts: { ...s.scripts, run } }); }}>{t("common.remove")}</button>
            </div>
          ))}
          <div className="row env-row">
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.repo.runId")} value={newRun.id} onChange={(e) => setNewRun({ ...newRun, id: e.target.value })} />
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.repo.runCommand")} value={newRun.command} onChange={(e) => setNewRun({ ...newRun, command: e.target.value })} />
            <button className="btn" disabled={!newRun.id || !newRun.command} onClick={() => { setS({ ...s, scripts: { ...s.scripts, run: { ...s.scripts.run, [newRun.id]: { command: newRun.command, default: !Object.keys(s.scripts.run).length, icon: null, available_in: null } } } }); setNewRun({ id: "", command: "" }); }}>{t("common.add")}</button>
          </div>
          <label className="field">{t("settings.repo.include")} <span className="dim small">{t("settings.repo.include.hint")}</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.file_include_globs.join(", ")} onChange={(e) => setS({ ...s, file_include_globs: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder={t("settings.repo.include.placeholder")} /></label>
          <label className="field">{t("settings.repo.target")}<input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.target_branch ?? ""} onChange={(e) => setS({ ...s, target_branch: e.target.value || null })} placeholder={repo?.default_branch} /></label>
          <div className="row"><button className="btn primary" onClick={() => api.saveRepoSettings(repoId!, s).then(setSaved, (e) => onError(String(e)))} data-testid="save-repo-settings">{t("common.save")}</button>{saved && <span className="ok small">{t("settings.repo.savedIn", { path: saved })}</span>}</div>
        </>
      )}
    </div>
  );
}

/** Atalhos: tabela gerada do registro único (`i18n/shortcuts.json`), com busca. Os atalhos com modificador
 *  podem ser gravados de novo (aviso de conflito, "Restaurar"); os de contexto (↵, ⌫, setas, 1–9) são fixos. */
function Shortcuts() {
  const [q, setQ] = useState("");
  const [rec, setRec] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string } | null>(null);
  const [, bump] = useState(0);
  const n = q.toLowerCase();
  const rows = SHORTCUTS.filter((x) => !n || `${effectiveKeys(x)} ${shortcutLabel(x)}`.toLowerCase().includes(n));
  const ov = overrides();
  useEffect(() => {
    if (!rec) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) return setRec(null);
      const c = comboFromEvent(e);
      if (!c) return;
      if (!c.meta && !c.ctrl && !c.alt) return setMsg({ id: rec, text: t("settings.shortcuts.needModifier") });
      const other = conflict(c, rec);
      if (other) return setMsg({ id: rec, text: t("settings.shortcuts.usedBy", { name: shortcutLabel(other) }) });
      const s = SHORTCUTS.find((x) => x.id === rec)!;
      setOverride(rec, formatCombo(c) === s.keys ? null : formatCombo(c));
      setMsg(null);
      setRec(null);
      bump((x) => x + 1);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [rec]);
  return (
    <div data-testid="shortcuts">
      <input {...noSuggest} autoComplete="off" autoFocus placeholder={t("settings.shortcuts.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="shortcuts-search" style={{ width: "100%", marginBottom: 10 }} />
      {CATEGORIES.map((c) => {
        const list = rows.filter((x) => x.cat === c);
        return list.length ? (
          <div key={c}>
            <h3>{t(`settings.cat.${c}` as Key)}</h3>
            <table className="shortcuts"><tbody>{list.map((x) => (
              <tr key={x.id} data-testid={`sc-${x.id}`}>
                <td>
                  {editable(x) ? (
                    <button className={"kbd-btn" + (rec === x.id ? " rec" : "")} title={t("settings.shortcuts.recordTitle")} onClick={() => (setRec(rec === x.id ? null : x.id), setMsg(null))} data-testid="sc-record">
                      <kbd>{rec === x.id ? t("settings.shortcuts.recording") : effectiveKeys(x)}</kbd>
                    </button>
                  ) : <kbd title={t("settings.shortcuts.fixedTitle")}>{x.keys}</kbd>}
                </td>
                <td>{shortcutLabel(x)}{msg?.id === x.id && <div className="error small" data-testid="sc-conflict">{msg.text}</div>}</td>
                <td className="sc-actions">{ov[x.id] && <button className="text-btn small" onClick={() => (setOverride(x.id, null), bump((v) => v + 1))} data-testid="sc-reset">{t("settings.shortcuts.reset", { keys: x.keys })}</button>}{!editable(x) && <span className="dim small">{t("settings.shortcuts.fixed")}</span>}</td>
              </tr>
            ))}</tbody></table>
          </div>
        ) : null;
      })}
      {rows.length === 0 && <div className="dim">{t("settings.shortcuts.none", { q })}</div>}
    </div>
  );
}

function Integrations({ onError }: { onError: (e: string) => void }) {
  const [st, setSt] = useState<{ connected: boolean; who: string | null; error: string | null } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.linearStatus().then(setSt, (e) => onError(String(e)));
  useEffect(() => void load(), []);
  const connect = async () => {
    setBusy(true);
    try {
      await api.linearConnect(key);
      setKey("");
      load();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="set-group" data-testid="integrations">
      <div className="account">
        <div className="acc-head"><b>Linear</b><span className={"badge " + (st?.connected && !st.error ? "ok" : "")}>{st?.connected ? (st.error ? t("common.error") : t("settings.linear.connected")) : t("settings.linear.notConnected")}</span></div>
        <div className="dim small">{st?.who ?? (st?.error && trError(st.error)) ?? t("settings.linear.lead")}</div>
        {st?.connected ? (
          <button className="btn" onClick={() => api.linearDisconnect().then(load)}>{t("settings.linear.disconnect")}</button>
        ) : (
          <div className="row" style={{ width: "100%" }}>
            <input type="password" placeholder={t("settings.linear.keyPlaceholder")} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} style={{ flex: 1 }} />
            <button className="btn primary" disabled={!key.trim() || busy} onClick={connect}>{busy ? t("settings.linear.connecting") : t("settings.linear.connect")}</button>
          </div>
        )}
        {!st?.connected && <a className="small" onClick={() => api.openExternal("https://linear.app/settings/account/security")}>{t("settings.linear.generate")}</a>}
      </div>
      <div className="dim small">{t("settings.linear.oauth")}</div>
    </div>
  );
}

/** GitHub: status do `gh`, entrar pelo navegador com código, trocar conta e token pessoal. */
function GitHub({ onError }: { onError: (e: string) => void }) {
  const [acc, setAcc] = useState<import("../api").GhAccount[] | null>(null);
  const [flow, setFlow] = useState<{ code?: string; url?: string; done?: string } | null>(null);
  const [tokenSet, setTokenSet] = useState(false);
  const [token, setToken] = useState("");
  const load = () => (api.githubStatus().then(setAcc, (e) => onError(String(e))), api.githubTokenSet().then(setTokenSet, () => {}));
  useEffect(() => {
    load();
    return api.onGithubAuth((ev) => {
      setFlow((f) => {
        const n = { ...(f ?? {}) };
        if (ev === "Ok") n.done = "ok";
        else if (ev === "PedeCodigo") return n;
        else if ("Codigo" in ev) n.code = ev.Codigo;
        else if ("Url" in ev) n.url = ev.Url;
        else if ("Erro" in ev) n.done = ev.Erro; // i18n-ignore: nome do evento do backend
        return n;
      });
      if (ev === "Ok") load();
    });
  }, []);
  const active = acc?.find((a) => a.active);
  return (
    <div className="account gh-card" data-testid="github">
      <div className="acc-head"><b>GitHub</b><span className={"badge " + (active?.ok ? "ok" : "")}>{acc === null ? "…" : active ? (active.ok ? `@${active.login}` : t("settings.github.invalidToken")) : t("settings.linear.notConnected")}</span></div>
      {active && <div className="dim small">{t("settings.github.scopes", { scopes: active.scopes.join(", ") || "—", source: active.source })}{tokenSet ? t("settings.github.patActive") : ""}</div>}
      {acc && acc.length > 1 && (
        <div className="gh-accounts">
          {acc.map((a) => (
            <div key={a.login} className="row"><span className={a.active ? "" : "dim"}>@{a.login}</span><span className="grow" />{a.active ? <span className="badge ok">{t("settings.github.active")}</span> : <button className="btn" onClick={() => api.githubSwitch(a.login).then(load, (e) => onError(String(e)))} data-testid="gh-switch">{t("settings.github.useAccount")}</button>}</div>
          ))}
        </div>
      )}
      {!flow && (
        <div className="row">
          <button className="btn" onClick={() => (setFlow({}), api.githubLogin().catch((e) => onError(String(e))))} data-testid="gh-login">{active ? t("settings.github.switch") : t("settings.github.login")}</button>
        </div>
      )}
      {flow && (
        <div className="flow">
          {!flow.code && !flow.done && <div className="dim">{t("settings.github.starting")}</div>}
          {flow.code && !flow.done && (
            <div className="gh-code">
              <div className="dim small">{t("settings.github.step1")}</div>
              <div className="row"><code className="big-code" data-testid="gh-code">{flow.code}</code><button className="btn" onClick={() => navigator.clipboard.writeText(flow.code!)}>{t("common.copy")}</button></div>
              {flow.url && <div className="dim small">{tNode("settings.github.step2", { url: <a onClick={() => api.openExternal(flow.url!)}>{flow.url}</a> })}</div>}
            </div>
          )}
          {flow.done && <div className={flow.done === "ok" ? "ok" : "error"}>{flow.done === "ok" ? t("settings.github.connected") : trError(flow.done)}</div>}
          <button className="btn" onClick={() => (api.githubCancel().catch(() => {}), setFlow(null))}>{flow.done ? t("common.close") : t("common.cancel")}</button>
        </div>
      )}
      <div className="row" style={{ width: "100%" }}>
        <input type="password" placeholder={tokenSet ? t("settings.github.tokenSaved") : t("settings.github.tokenPlaceholder")} value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }} />
        {token ? <button className="btn primary" onClick={() => api.githubToken(token).then(() => (setToken(""), load()), (e) => onError(String(e)))} data-testid="gh-token-save">{t("settings.github.saveToken")}</button> : tokenSet && <button className="btn" onClick={() => api.githubToken(null).then(load)}>{t("settings.github.removeToken")}</button>}
      </div>
    </div>
  );
}

/** Outras máquinas com kabuld (via Tailscale). O servidor remoto vem no bloco do celular; aqui fica a lista. */
function Machines() {
  const [list, setList] = useState<Machine[]>(machines);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const save = (l: Machine[]) => (saveMachines(l), setList(l));
  return (
    <div className="set-group" data-testid="machines">
      <p className="dim small">{tNode("settings.machines.lead", { kabuld: <code>kabuld</code>, example: <code>mac-de-dev.tailnet.ts.net:7777</code> })}</p>
      <div className="set-row"><div><div>{t("settings.machines.thisMac")}</div><div className="dim small">{t("settings.machines.local")}</div></div>{activeMachine() === "local" ? <span className="badge ok">{t("settings.github.active")}</span> : <button className="btn" onClick={() => switchMachine("local")}>{t("common.use")}</button>}</div>
      {list.map((m) => (
        <div key={m.id} className="set-row" data-testid="machine-item">
          <div><div>{m.name}</div><div className="dim small"><code>{m.url}</code></div></div>
          <div className="row">{activeMachine() === m.id ? <span className="badge ok">{t("settings.github.active")}</span> : <button className="btn" onClick={() => switchMachine(m.id)}>{t("common.use")}</button>}<button className="btn" onClick={() => save(list.filter((x) => x.id !== m.id))}>{t("common.remove")}</button></div>
        </div>
      ))}
      {list.length === 0 && <div className="dim small" data-testid="machines-empty">{t("settings.machines.empty")}</div>}
      <h3>{t("settings.machines.add")}</h3>
      <div className="row env-row">
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.machines.name")} value={name} onChange={(e) => setName(e.target.value)} data-testid="machine-name" />
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.machines.url")} value={url} onChange={(e) => setUrl(e.target.value)} data-testid="machine-url" />
        <button className="btn primary" disabled={!name.trim() || !url.trim()} onClick={() => (save([...list, { id: `m${Date.now().toString(36)}`, name: name.trim(), url: normalizeUrl(url) }]), setName(""), setUrl(""))} data-testid="machine-save">{t("common.add")}</button>
      </div>
    </div>
  );
}
