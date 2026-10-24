import { confirmDialog } from "../components/Confirm";
import { noSuggest } from "../noSuggest";
import { useEffect, useState } from "react";
import { api, HARNESS_LABEL, type AppSettings, type AuthStatus, type HarnessKind, type Layer, type Repo, type RepoSettingsT } from "../api";
import type { Route } from "../App";
import { AccountsPanel } from "../components/Accounts";
import { getThemePref, setThemePref, type ThemePref } from "../theme";
import { IMonitor, IMoon, ISun } from "../icons";

const TABS: [string, string][] = [["geral", "Geral"], ["aparencia", "Aparência"], ["contas", "Contas"], ["integracoes", "Integrações"], ["repo", "Repositório"], ["atalhos", "Atalhos"]];

export function SettingsView({ tab, repoId, repos, onError, onRoute }: { tab: string; repoId?: string; repos: Repo[]; onError: (e: string) => void; onRoute: (r: Route) => void }) {
  return (
    <section className="page" data-testid="settings-page">
      <header className="page-head" data-tauri-drag-region><h2>Configurações</h2></header>
      <div className="seg">
        {TABS.map(([k, v]) => <button key={k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => onRoute({ kind: "settings", tab: k, repoId })}>{v}</button>)}
      </div>
      {tab === "geral" && <General onError={onError} />}
      {tab === "aparencia" && <Appearance />}
      {tab === "contas" && <><GitHub onError={onError} /><Accounts onError={onError} /><h3>Várias contas por provedor</h3><AccountsPanel onError={onError} /></>}
      {tab === "integracoes" && <Integrations onError={onError} />}
      {tab === "repo" && <RepoSettings repos={repos} repoId={repoId ?? repos[0]?.id} onError={onError} onRoute={onRoute} />}
      {tab === "atalhos" && <Shortcuts />}
    </section>
  );
}

function General({ onError }: { onError: (e: string) => void }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => void api.appSettings().then(setS, (e) => onError(String(e))), [onError]);
  if (!s) return null;
  const save = (n: AppSettings) => {
    setS(n);
    api.saveAppSettings(n).then(() => (setSaved(true), setTimeout(() => setSaved(false), 1200)), (e) => onError(String(e)));
  };
  const Toggle = ({ k, label, hint }: { k: keyof AppSettings; label: string; hint: string }) => (
    <div className="set-row"><div><div>{label}</div><div className="dim small">{hint}</div></div><span className={"toggle" + (s[k] ? " on" : "")} onClick={() => save({ ...s, [k]: !s[k] })}><span /></span></div>
  );
  return (
    <div className="set-group">
      <div className="set-row">
        <div><div>Prefixo da branch</div><div className="dim small">Workspaces nascem em &lt;prefixo&gt;/&lt;cidade&gt;</div></div>
        <div className="row">
          <select value={s.branch_prefix_type} onChange={(e) => save({ ...s, branch_prefix_type: e.target.value })}>
            <option value="github">usuário do GitHub (padrão)</option><option value="user">usuário do Mac</option><option value="custom">personalizado</option>
          </select>
          {s.branch_prefix_type === "custom" && <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.branch_prefix_custom} onChange={(e) => setS({ ...s, branch_prefix_custom: e.target.value })} onBlur={() => save(s)} placeholder="ex.: feat" />}
        </div>
      </div>
      <div className="set-row"><div><div>Enviar mensagem com</div><div className="dim small">⇧↵ sempre quebra a linha</div></div>
        <select defaultValue={localStorage.getItem("kabul.sendKey") ?? "enter"} onChange={(e) => localStorage.setItem("kabul.sendKey", e.target.value)} data-testid="send-key"><option value="enter">↵</option><option value="cmdEnter">⌘↵</option></select></div>
      <div className="set-row"><div><div>Mensagem enviada com o agente trabalhando</div><div className="dim small">Fila: espera o turno acabar. Redirecionar: entra no turno em andamento.</div></div>
        <select defaultValue={localStorage.getItem("kabul.followUp") ?? "queue"} onChange={(e) => localStorage.setItem("kabul.followUp", e.target.value)} data-testid="follow-up"><option value="queue">Fila</option><option value="steer">Redirecionar</option></select></div>
      <div className="set-row"><div><div>Não recolher os passos do agente (⌃O)</div><div className="dim small">Mostra todas as ferramentas e mensagens intermediárias</div></div>
        <select defaultValue={localStorage.getItem("kabul.noCollapse") ?? "0"} onChange={(e) => localStorage.setItem("kabul.noCollapse", e.target.value)}><option value="0">recolher</option><option value="1">mostrar tudo</option></select></div>
      <div className="set-row"><div><div>Abrir workspace em (⌘O)</div><div className="dim small">⌘⇧O abre a lista de apps</div></div>
        <select defaultValue={localStorage.getItem("kabul.openIn.default") ?? ""} onChange={(e) => localStorage.setItem("kabul.openIn.default", e.target.value)} data-testid="open-default"><option value="">o último usado</option><option value="finder">Finder</option><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="zed">Zed</option><option value="terminal">Terminal</option><option value="iterm">iTerm</option><option value="warp">Warp</option><option value="ghostty">Ghostty</option></select></div>
      <Toggle k="auto_rename_branch" label="Renomear a branch pela primeira mensagem" hint="Só enquanto ela tiver o nome da cidade e você não tiver renomeado" />
      <Toggle k="notifications" label="Notificações" hint="Quando um agente termina ou pede permissão com o app em segundo plano" />
      <Toggle k="sound" label="Som nas notificações" hint="" />
      <Toggle k="caffeinate" label="Manter o Mac acordado com agentes rodando" hint="Usa caffeinate enquanto houver uma sessão ativa" />
      <h3>Variáveis de ambiente</h3>
      <p className="dim small">Passadas aos agentes. Escopo “all” ou um agente (claude, codex, opencode, qwen, gemini, agy). Ex.: ANTHROPIC_BASE_URL, CLAUDE_CODE_USE_BEDROCK.</p>
      {s.env.map((v, i) => (
        <div key={i} className="row env-row">
          <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={v.key} placeholder="CHAVE" onChange={(e) => setS({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} onBlur={() => save(s)} />
          <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={v.value} placeholder="valor" type="password" onChange={(e) => setS({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} onBlur={() => save(s)} />
          <select value={v.scope} onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)) })}>
            {["all", "claude", "codex", "opencode", "qwen", "gemini", "agy"].map((o) => <option key={o}>{o}</option>)}
          </select>
          <button className="btn" onClick={() => save({ ...s, env: s.env.filter((_, j) => j !== i) })}>Remover</button>
        </div>
      ))}
      <button className="btn" onClick={() => setS({ ...s, env: [...s.env, { key: "", value: "", scope: "all" }] })}>Adicionar variável</button>
      {saved && <span className="ok small"> salvo</span>}
    </div>
  );
}

type Flow = { url?: string; askCode?: boolean; done?: "ok" | string };

function Accounts({ onError }: { onError: (e: string) => void }) {
  const [st, setSt] = useState<AuthStatus[]>([]);
  const [flows, setFlows] = useState<Partial<Record<HarnessKind, Flow>>>({});
  const [codes, setCodes] = useState<Partial<Record<HarnessKind, string>>>({});
  const load = () => api.authStatus().then(setSt, (e) => onError(String(e)));
  useEffect(() => {
    load();
    return api.onAuth(({ kind, event }) => {
      setFlows((f) => {
        const cur = { ...(f[kind] ?? {}) };
        if (event === "PedeCodigo") cur.askCode = true;
        else if (event === "Ok") cur.done = "ok";
        else if ("Url" in event) cur.url = event.Url;
        else if ("Erro" in event) cur.done = event.Erro;
        return { ...f, [kind]: cur };
      });
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
                : !f && <button className="btn" onClick={() => (setFlows((x) => ({ ...x, [a.kind]: {} })), api.authLogin(a.kind).catch((e) => onError(String(e))))}>{a.logged_in ? "Entrar de novo" : "Entrar"}</button>}
              {f && (
                <div className="flow">
                  {!f.url && !f.done && <div className="dim">iniciando o CLI…</div>}
                  {f.url && <div>1. Abra: <a className="url" onClick={() => api.openExternal(f.url!)}>{f.url}</a></div>}
                  {f.askCode && !f.done && (
                    <div className="row">
                      <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder="2. Cole o código" value={codes[a.kind] ?? ""} onChange={(e) => setCodes({ ...codes, [a.kind]: e.target.value })} />
                      <button className="btn primary" onClick={() => api.authCode(a.kind, codes[a.kind] ?? "").catch((e) => onError(String(e)))}>Enviar</button>
                    </div>
                  )}
                  {f.done && <div className={f.done === "ok" ? "ok" : "error"}>{f.done === "ok" ? "Login concluído." : f.done}</div>}
                  <button className="btn" onClick={() => { api.authCancel(a.kind).catch(() => {}); setFlows((x) => ({ ...x, [a.kind]: undefined })); }}>{f.done ? "Fechar" : "Cancelar"}</button>
                </div>
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
          <label className="field">Setup <span className="dim small">roda ao criar o workspace, com KABUL_*/CONDUCTOR_* e KABUL_PORT</span><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={s.scripts.setup ?? ""} onChange={(e) => setS({ ...s, scripts: { ...s.scripts, setup: e.target.value || null } })} placeholder="ex.: npm install && cp ../.env ." /></label>
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

const SHORTCUTS: [string, string][] = [
  ["⌘K", "Buscar workspaces, páginas e conversas"], ["⌘N", "Novo workspace no repositório atual"], ["⌘1 … ⌘9", "Ir para o workspace"], ["⌘B", "Mostrar/ocultar barra lateral"],
  ["⌘,", "Configurações"], ["⌘/", "Abrir o seletor de modelo"], ["⌘⌥/", "Atalhos de teclado"], ["⌃⇧D", "Ditado"], ["⌘⇧⌫", "Parar o agente"], ["⌃O", "Recolher/mostrar passos do agente"], ["⌘⌥↵", "Fork da conversa para nova aba"], ["⌘⌥C", "Copiar transcript"], ["⌘⇧↵", "Aprovar o plano"], ["⌫ (campo vazio)", "Negar pedido de permissão"], ["⌥⌘T", "Alternar tema (escuro, claro, sistema)"], ["⌘[ / ⌘]", "Voltar / avançar"], ["⌥⌘B", "Mostrar/ocultar painel direito"], ["⌘O", "Abrir o workspace no Finder"], ["⌘T", "Nova conversa no workspace"], ["⌘W", "Fechar aba"], ["⌘⇧[ / ⌘⇧]", "Aba anterior / próxima"],
  ["⌘J", "Mostrar/ocultar terminal"], ["⌘⇧P", "Criar PR"], ["↵", "Enviar (com o agente ocupado, enfileira)"], ["⇧↵", "Nova linha"], ["⌘↵", "Aprovar pedido pendente (campo vazio)"],
  ["Esc", "Interromper o agente"], ["⇧⇥", "Plan mode"], ["⌘L", "Focar o campo de mensagem"], ["⌘U", "Anexar arquivo"], 
  ["⌃⌘1 … 9", "Modelo favorito"], ["⌘⇧E", "Modo rápido"], ["⌘⇧/", "Alternar esforço"], ["@", "Mencionar arquivo"], ["/", "Comandos"],
];

function Shortcuts() {
  return <table className="shortcuts"><tbody>{SHORTCUTS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>;
}

function Appearance() {
  const [p, setP] = useState<ThemePref>(getThemePref());
  const opts: [ThemePref, string, React.ReactNode][] = [["light", "Claro", <ISun size={18} />], ["dark", "Escuro", <IMoon size={18} />], ["system", "Sistema", <IMonitor size={18} />]];
  return (
    <div className="set-group">
      <div className="dim small">Tema da interface. “Sistema” segue a aparência do macOS. Atalho: ⌥⌘T alterna; também em ⌘K.</div>
      <div className="theme-cards" data-testid="theme-cards">
        {opts.map(([k, label, icon]) => (
          <button key={k} className={"theme-card t-" + k + (p === k ? " on" : "")} onClick={() => (setThemePref(k), setP(k))}>
            <span className="theme-preview"><span /><span /><span /></span>
            <span className="row">{icon} {label}</span>
          </button>
        ))}
      </div>
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

/** GitHub como no Conductor: status do `gh`, entrar pelo navegador com código, trocar conta e token pessoal. */
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
