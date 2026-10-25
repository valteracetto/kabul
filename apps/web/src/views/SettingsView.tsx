import { confirmDialog } from "../components/Confirm";
import { RemotePanel } from "../components/RemotePanel";
import { LoginFlow, reduceLogin, MAX_RESTARTS, type LoginState } from "../components/LoginFlow";
import { noSuggest } from "../noSuggest";
import { useEffect, useRef, useState } from "react";
import { api, HARNESS_LABEL, type AuthStatus, type HarnessKind, type Layer, type Repo, type RepoSettingsT } from "../api";
import type { Route } from "../App";
import { AccountsPanel } from "../components/Accounts";
import { GitSettings } from "./SettingsGit";
import { CATEGORIES, lang, SHORTCUTS, t, type Key } from "../i18n";
import { ActionsPage, AdvancedPage, AppearancePage, EnvironmentPage, GeneralPage, MiscPage, ModelsPage } from "./SettingsPages";
import { activeMachine, machines, normalizeUrl, saveMachines, switchMachine, type Machine } from "../components/machines";

/** Navegação das configurações, por grupo (pessoal, ambiente, repositório, mais). */
const GROUPS: [string, [string, string][]][] = [
  [t("settings.group.personal"), [["geral", "Geral"], ["contas", "Contas"], ["aparencia", "Aparência"], ["modelos", "Modelos"], ["git", "Git"], ["integracoes", "Integrações"]]],
  [t("settings.group.env"), [["ambiente", "Ambiente"]]],
  [t("settings.group.repo"), [["repo", "Scripts"], ["acoes", "Ações"], ["diversos", "Diversos"]]],
  [t("settings.group.more"), [["remoto", "Máquinas"], ["celular", "Celular e remoto"], ["avancado", "Avançado"], ["atalhos", "Atalhos"]]],
];

export function SettingsView({ tab, repoId, repos, onError, onRoute }: { tab: string; repoId?: string; repos: Repo[]; onError: (e: string) => void; onRoute: (r: Route) => void }) {
  const title = GROUPS.flatMap(([, t]) => t).find(([k]) => k === tab)?.[1] ?? "Configurações";
  return (
    <section className="page settings-page" data-testid="settings-page">
      <header className="page-head" data-tauri-drag-region><h2>{t("settings.title")}</h2></header>
      <div className="settings-layout">
        <nav className="settings-nav" data-testid="settings-nav">
          {GROUPS.map(([g, tabs]) => (
            <div key={g} className="settings-nav-group">
              <div className="settings-nav-title">{g}</div>
              {tabs.map(([k, v]) => <button key={k} className={"settings-nav-item" + (tab === k ? " on" : "")} onClick={() => onRoute({ kind: "settings", tab: k, repoId })} data-testid={`set-tab-${k}`}>{v}</button>)}
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
          {tab === "contas" && <><GitHub onError={onError} /><Accounts onError={onError} /><h3>Várias contas por provedor</h3><AccountsPanel onError={onError} /></>}
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
      <p className="dim lead">O login usa o fluxo do próprio CLI. O Kabul só mostra a URL e repassa o código; tokens nunca são lidos.</p>
      <div className="accounts">
        {st.map((a) => {
          const f = flows[a.kind];
          return (
            <div key={a.kind} className="account" data-testid="account">
              <div className="acc-head">
                <b>{HARNESS_LABEL[a.kind]}</b>
                <span className={"badge " + (a.error ? "bad" : a.logged_in ? "ok" : "")}>{a.error ? "erro" : !a.installed ? "não instalado" : a.logged_in ? "logado" : "não logado"}</span>
              </div>
              <div className="dim small">{a.error ?? [a.method, a.source].filter(Boolean).join(" · ")}</div>
              {!a.installed ? <button className="btn" onClick={() => confirmDialog(`Instalar ${HARNESS_LABEL[a.kind]}? O comando roda numa sessão tmux visível no Painel.`).then((ok) => void (ok && api.installHarness(a.kind).then(() => onError(`Instalação de ${HARNESS_LABEL[a.kind]} iniciada (veja no Painel).`), (e) => onError(String(e)))))}>Instalar</button>
                : !f && <button className="btn" onClick={() => ((restarts.current[a.kind] = 0), setFlows((x) => ({ ...x, [a.kind]: {} })), start(a.kind))} data-testid={`auth-login-${a.kind}`}>{a.logged_in ? "Entrar de novo" : "Entrar"}</button>}
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
  if (!repos.length) return <p className="dim">Adicione um repositório primeiro.</p>;
  const repo = repos.find((r) => r.id === repoId);
  return (
    <div className="set-group" data-testid="repo-settings">
      <div className="set-row"><div>Repositório</div><select value={repoId} onChange={(e) => onRoute({ kind: "settings", tab: "repo", repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      {repo && <div className="dim small">{repo.path} · branch padrão {repo.default_branch}</div>}
      <h3>Camadas de configuração</h3>
      {layers.map((l) => <div key={l.path} className="layer"><span className={"dot " + (l.found ? "st-done" : "")} /> <b>{l.name}</b> <code>{l.path}</code> <span className="dim">{l.found ? "encontrado" : "—"}</span></div>)}
      {s && (
        <>
          <h3>Scripts (salvos em settings.local.toml)</h3>
          <label className="field">Setup <span className="dim small">roda ao criar o workspace, com as variáveis KABUL_* (KABUL_PORT, KABUL_WORKSPACE_PATH…)</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.scripts.setup ?? ""} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, setup: e.target.value || null } })} placeholder="ex.: npm install && cp ../.env ." /></label>
          <label className="field">Archive <span className="dim small">roda antes de arquivar</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.scripts.archive ?? ""} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, archive: e.target.value || null } })} placeholder="ex.: docker compose down" /></label>
          <label className="field">Modo dos run scripts<select value={s.scripts.run_mode ?? "concurrent"} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, run_mode: e.target.value } })}><option value="concurrent">concorrente</option><option value="nonconcurrent">um por vez</option></select></label>
          <div className="field">Run scripts</div>
          {Object.entries(s.scripts.run).map(([id, r]) => (
            <div key={id} className="row env-row">
              <code>{id}</code><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={r.command} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, run: { ...s.scripts.run, [id]: { ...r, command: e.target.value } } } })} />
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="radio" checked={r.default} onChange={() => setS({ ...s, scripts: { ...s.scripts, run: Object.fromEntries(Object.entries(s.scripts.run).map(([k, v]) => [k, { ...v, default: k === id }])) } })} /> padrão</label>
              <button className="btn" onClick={() => { const run = { ...s.scripts.run }; delete run[id]; setS({ ...s, scripts: { ...s.scripts, run } }); }}>Remover</button>
            </div>
          ))}
          <div className="row env-row">
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder="id (ex.: web)" value={newRun.id} onChange={(e) => setNewRun({ ...newRun, id: e.target.value })} />
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder="comando (ex.: npm run dev -- --port $KABUL_PORT)" value={newRun.command} onChange={(e) => setNewRun({ ...newRun, command: e.target.value })} />
            <button className="btn" disabled={!newRun.id || !newRun.command} onClick={() => { setS({ ...s, scripts: { ...s.scripts, run: { ...s.scripts.run, [newRun.id]: { command: newRun.command, default: !Object.keys(s.scripts.run).length, icon: null, available_in: null } } } }); setNewRun({ id: "", command: "" }); }}>Adicionar</button>
          </div>
          <label className="field">Arquivos ignorados a copiar para cada worktree <span className="dim small">além de .worktreeinclude e .env*</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.file_include_globs.join(", ")} onChange={(e) => setS({ ...s, file_include_globs: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="ex.: config/*.local.json" /></label>
          <label className="field">Branch alvo (PR e diff)<input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.target_branch ?? ""} onChange={(e) => setS({ ...s, target_branch: e.target.value || null })} placeholder={repo?.default_branch} /></label>
          <div className="row"><button className="btn primary" onClick={() => api.saveRepoSettings(repoId!, s).then(setSaved, (e) => onError(String(e)))} data-testid="save-repo-settings">Salvar</button>{saved && <span className="ok small">salvo em {saved}</span>}</div>
        </>
      )}
    </div>
  );
}

/** Atalhos: tabela gerada do registro único (`i18n/shortcuts.json`), com busca. */
function Shortcuts() {
  const [q, setQ] = useState("");
  const n = q.toLowerCase();
  const rows = SHORTCUTS.filter((x) => !n || `${x.keys} ${x[lang()]}`.toLowerCase().includes(n));
  return (
    <div data-testid="shortcuts">
      <input {...noSuggest} autoComplete="off" autoFocus placeholder={t("shortcuts.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="shortcuts-search" style={{ width: "100%", marginBottom: 10 }} />
      {CATEGORIES.map((c) => {
        const list = rows.filter((x) => x.cat === c);
        return list.length ? (
          <div key={c}>
            <h3>{t(`cat.${c}` as Key)}</h3>
            <table className="shortcuts"><tbody>{list.map((x) => <tr key={x.id}><td><kbd>{x.keys}</kbd></td><td>{x[lang()]}</td></tr>)}</tbody></table>
          </div>
        ) : null;
      })}
      {rows.length === 0 && <div className="dim">Nenhum atalho para “{q}”.</div>}
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
        <div className="acc-head"><b>Linear</b><span className={"badge " + (st?.connected && !st.error ? "ok" : "")}>{st?.connected ? (st.error ? "erro" : "conectado") : "não conectado"}</span></div>
        <div className="dim small">{st?.who ?? st?.error ?? "Crie workspaces a partir de issues, @mencione issues no chat e ligue o PR à issue. A chave fica no Keychain do macOS."}</div>
        {st?.connected ? (
          <button className="btn" onClick={() => api.linearDisconnect().then(load)}>Desconectar</button>
        ) : (
          <div className="row" style={{ width: "100%" }}>
            <input type="password" placeholder="Chave de API pessoal (lin_api_…)" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()} style={{ flex: 1 }} />
            <button className="btn primary" disabled={!key.trim() || busy} onClick={connect}>{busy ? "Conectando…" : "Conectar"}</button>
          </div>
        )}
        {!st?.connected && <a className="small" onClick={() => api.openExternal("https://linear.app/settings/account/security")}>Gerar uma chave em Linear › Configurações › Segurança ↗</a>}
      </div>
      <div className="dim small">OAuth do Linear: pendente (exige registrar o app Kabul no Linear); a chave pessoal dá o mesmo acesso de leitura de issues.</div>
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
        else if ("Erro" in ev) n.done = ev.Erro;
        return n;
      });
      if (ev === "Ok") load();
    });
  }, []);
  const active = acc?.find((a) => a.active);
  return (
    <div className="account gh-card" data-testid="github">
      <div className="acc-head"><b>GitHub</b><span className={"badge " + (active?.ok ? "ok" : "")}>{acc === null ? "…" : active ? (active.ok ? `@${active.login}` : "token inválido") : "não conectado"}</span></div>
      {active && <div className="dim small">Escopos: {active.scopes.join(", ") || "—"} · origem: {active.source}{tokenSet ? " · token pessoal ativo (GH_TOKEN)" : ""}</div>}
      {acc && acc.length > 1 && (
        <div className="gh-accounts">
          {acc.map((a) => (
            <div key={a.login} className="row"><span className={a.active ? "" : "dim"}>@{a.login}</span><span className="grow" />{a.active ? <span className="badge ok">ativa</span> : <button className="btn" onClick={() => api.githubSwitch(a.login).then(load, (e) => onError(String(e)))} data-testid="gh-switch">Usar esta conta</button>}</div>
          ))}
        </div>
      )}
      {!flow && (
        <div className="row">
          <button className="btn" onClick={() => (setFlow({}), api.githubLogin().catch((e) => onError(String(e))))} data-testid="gh-login">{active ? "Trocar conta / adicionar conta" : "Entrar com gh"}</button>
        </div>
      )}
      {flow && (
        <div className="flow">
          {!flow.code && !flow.done && <div className="dim">iniciando gh auth login…</div>}
          {flow.code && !flow.done && (
            <div className="gh-code">
              <div className="dim small">1. Copie o código</div>
              <div className="row"><code className="big-code" data-testid="gh-code">{flow.code}</code><button className="btn" onClick={() => navigator.clipboard.writeText(flow.code!)}>Copiar</button></div>
              {flow.url && <div className="dim small">2. Abra <a onClick={() => api.openExternal(flow.url!)}>{flow.url}</a> e cole o código</div>}
            </div>
          )}
          {flow.done && <div className={flow.done === "ok" ? "ok" : "error"}>{flow.done === "ok" ? "Conta conectada." : flow.done}</div>}
          <button className="btn" onClick={() => (api.githubCancel().catch(() => {}), setFlow(null))}>{flow.done ? "Fechar" : "Cancelar"}</button>
        </div>
      )}
      <div className="row" style={{ width: "100%" }}>
        <input type="password" placeholder={tokenSet ? "Token pessoal salvo no Keychain" : "Personal access token (opcional)"} value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1 }} />
        {token ? <button className="btn primary" onClick={() => api.githubToken(token).then(() => (setToken(""), load()), (e) => onError(String(e)))} data-testid="gh-token-save">Salvar token</button> : tokenSet && <button className="btn" onClick={() => api.githubToken(null).then(load)}>Remover token</button>}
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
      <p className="dim small">Cada máquina roda o <code>kabuld</code> e aparece no seletor do topo da barra lateral (⌃1…⌃9). Use o endereço do Tailscale, por exemplo <code>mac-de-dev.tailnet.ts.net:7777</code>. Trocar de máquina troca a fonte de repositórios e workspaces.</p>
      <div className="set-row"><div><div>Este Mac</div><div className="dim small">backend local</div></div>{activeMachine() === "local" ? <span className="badge ok">ativa</span> : <button className="btn" onClick={() => switchMachine("local")}>Usar</button>}</div>
      {list.map((m) => (
        <div key={m.id} className="set-row" data-testid="machine-item">
          <div><div>{m.name}</div><div className="dim small"><code>{m.url}</code></div></div>
          <div className="row">{activeMachine() === m.id ? <span className="badge ok">ativa</span> : <button className="btn" onClick={() => switchMachine(m.id)}>Usar</button>}<button className="btn" onClick={() => save(list.filter((x) => x.id !== m.id))}>Remover</button></div>
        </div>
      ))}
      {list.length === 0 && <div className="dim small" data-testid="machines-empty">Nenhuma outra máquina ainda.</div>}
      <h3>Adicionar máquina</h3>
      <div className="row env-row">
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder="Nome (ex.: Mac do escritório)" value={name} onChange={(e) => setName(e.target.value)} data-testid="machine-name" />
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder="Endereço (host:porta ou ws://…)" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="machine-url" />
        <button className="btn primary" disabled={!name.trim() || !url.trim()} onClick={() => (save([...list, { id: `m${Date.now().toString(36)}`, name: name.trim(), url: normalizeUrl(url) }]), setName(""), setUrl(""))} data-testid="machine-save">Adicionar</button>
      </div>
    </div>
  );
}
