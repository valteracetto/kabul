import { noSuggest } from "./noSuggest";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, wsTitle, type Repo, type Workspace } from "./api";
import { Sidebar } from "./views/Sidebar";
import { ConfirmHost } from "./components/Confirm";
import { Resizer, usePanelSize } from "./components/Resizer";
import { WorkspaceView } from "./views/WorkspaceView";
import { SessionsView } from "./views/SessionsView";
import { SettingsView } from "./views/SettingsView";
import { LocalModelsView } from "./views/LocalModelsView";
import { LinearPicker } from "./components/LinearPicker";
import { CreateModal } from "./components/CreateModal";
import { IBranch, ISearch } from "./icons";
import { cycleTheme, setThemePref } from "./theme";
import { cloudList } from "./components/RunsOn";

export type AgentState = "working" | "waiting";

export type Route =
  | { kind: "workspace"; id: string }
  | { kind: "sessions" }
  | { kind: "settings"; tab?: string; repoId?: string }
  | { kind: "local" }
  | { kind: "home" };

export function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [stats, setStats] = useState<Record<string, [number, number]>>({});
  const [route, setRoute] = useState<Route>({ kind: "home" });
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [linear, setLinear] = useState(false);
  const [creating, setCreating] = useState<null | { from?: "prs" | "branches" | "issues"; repo?: string; add?: boolean }>(null);
  const [sidebar, setSidebar] = useState(true);
  const side = usePanelSize("sidebar", Math.round(Math.min(420, Math.max(240, window.innerWidth * 0.22))), 200, 520);
  const [opened, setOpened] = useState<string[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentState | undefined>>({});
  const onAgent = useCallback((id: string, st: AgentState | undefined) => setAgents((a) => (a[id] === st ? a : { ...a, [id]: st })), []);
  // Histórico de navegação (voltar/avançar como no Conductor).
  const [hist, setHist] = useState<{ stack: Route[]; i: number }>({ stack: [{ kind: "home" }], i: 0 });
  const go = useCallback((r: Route) => {
    setRoute(r);
    setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), r].slice(-50), i: Math.min(h.i + 1, 49) }));
  }, []);
  const back = () => hist.i > 0 && (setRoute(hist.stack[hist.i - 1]), setHist({ ...hist, i: hist.i - 1 }));
  const fwd = () => hist.i < hist.stack.length - 1 && (setRoute(hist.stack[hist.i + 1]), setHist({ ...hist, i: hist.i + 1 }));

  const reload = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([api.repos(), api.workspaces()]);
      setRepos(r);
      setWorkspaces(w);
      api.stats().then(setStats, () => {});
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(() => api.stats().then(setStats, () => {}), 8000);
    const off = api.onWorkspaceState(() => reload());
    const openLinear = () => setLinear(true);
    const route = (e: Event) => go((e as CustomEvent).detail);
    const url = (e: Event) => void api.openExternal((e as CustomEvent).detail).catch(() => {});
    window.addEventListener("kabul:open-url", url);
    window.addEventListener("kabul:route", route);
    window.addEventListener("kabul:linear", openLinear);
    return () => (clearInterval(t), off(), window.removeEventListener("kabul:linear", openLinear), window.removeEventListener("kabul:route", route), window.removeEventListener("kabul:open-url", url));
  }, [reload]);
  useEffect(() => {
    if (route.kind === "workspace" && !opened.includes(route.id)) setOpened((o) => [...o, route.id]);
  }, [route, opened]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(t);
  }, [error]);

  const current = route.kind === "workspace" ? workspaces.find((w) => w.id === route.id) : undefined;

  // Atalhos globais: ⌘K busca, ⌘, configurações, ⌘B barra lateral, ⌘N workspace novo, ⌘1..9 workspaces.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyA") return (e.preventDefault(), setCreating({ add: true }));
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "n") return (e.preventDefault(), setCreating({ from: "prs" }));
      if (e.metaKey && e.altKey && e.code === "KeyT") return (e.preventDefault(), void cycleTheme());
      if (e.metaKey && !e.shiftKey && e.key === "[") return (e.preventDefault(), back());
      if (e.metaKey && !e.shiftKey && e.key === "]") return (e.preventDefault(), fwd());
      if (!e.metaKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") (e.preventDefault(), setPalette((p) => !p));
      else if (e.key === ",") (e.preventDefault(), go({ kind: "settings", tab: "geral" }));
      else if (e.code === "Slash" && e.altKey) (e.preventDefault(), go({ kind: "settings", tab: "atalhos" }));
      else if (k === "b") (e.preventDefault(), setSidebar((s) => !s));
      else if (k === "n") (e.preventDefault(), setCreating({})); else if (!e.ctrlKey && /^[1-9]$/.test(e.key)) {
        const w = workspaces.filter((w) => !w.archived)[Number(e.key) - 1];
        if (w) (e.preventDefault(), go({ kind: "workspace", id: w.id }));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [workspaces, repos, current, reload, hist]);

  const onError = useCallback((e: string) => setError(e), []);

  return (
    <div className={"shell" + (sidebar ? "" : " no-sidebar")} style={{ ["--sidebar-w" as string]: `${side.size}px` }}>
      {sidebar && <Sidebar repos={repos} workspaces={workspaces} stats={stats} agents={agents} route={route} onRoute={go} onBack={hist.i > 0 ? back : undefined} onFwd={hist.i < hist.stack.length - 1 ? fwd : undefined} onChange={reload} onError={onError} onSearch={() => setPalette(true)} onCollapse={() => setSidebar(false)} onLinear={() => setLinear(true)} onCreate={(repo, from) => setCreating({ repo, from: from ? "prs" : undefined })} onAddProject={() => setCreating({ add: true })} />}
      {sidebar && <Resizer axis="x" dir={1} {...side} onSize={side.setSize} onCollapse={() => setSidebar(false)} testid="resize-sidebar" />}
      <main className="main">
        {error && <div className="toast" role="alert" onClick={() => setError(null)}>{error}</div>}
        {opened.map((id) => {
          const w = workspaces.find((x) => x.id === id && !x.archived);
          const r = w && repos.find((x) => x.id === w.repo_id);
          const on = route.kind === "workspace" && route.id === id;
          return w && r ? <div key={id} className="ws-host" hidden={!on}><WorkspaceView ws={w} repo={r} active={on} sidebarHidden={!sidebar} onAgent={onAgent} onError={onError} onChange={reload} onOpenSettings={(repoId) => go({ kind: "settings", tab: "repo", repoId })} /></div> : null;
        })}
        {route.kind === "sessions" && <SessionsView onError={onError} />}
        {route.kind === "settings" && <SettingsView key={route.tab + (route.repoId ?? "")} tab={route.tab ?? "geral"} repoId={route.repoId} repos={repos} onError={onError} onRoute={go} />}
        {route.kind === "local" && <LocalModelsView onError={onError} />}
        {(route.kind === "home" || (route.kind === "workspace" && !current)) && <Home repos={repos} workspaces={workspaces} onRoute={go} />}
        {!sidebar && <button className="icon-btn sidebar-reopen" title="Mostrar barra lateral (⌘B)" onClick={() => setSidebar(true)}>☰</button>}
      </main>
      <ConfirmHost />
      {creating && (
        <CreateModal repos={repos} defaultRepo={creating.repo ?? current?.repo_id} fromTab={creating.from} addMode={creating.add || repos.length === 0} onReposChanged={reload} onError={onError} onClose={() => setCreating(null)}
          onCreated={(w) => (setCreating(null), reload(), go({ kind: "workspace", id: w.id }))} />
      )}
      {linear && (
        <LinearPicker repos={repos} defaultRepo={current?.repo_id} onError={onError} onClose={() => setLinear(false)} onConnect={() => (setLinear(false), go({ kind: "settings", tab: "integracoes" }))}
          onCreated={(w, i) => {
            setLinear(false);
            reload();
            go({ kind: "workspace", id: w.id });
            // Contexto da issue para o agente (o arquivo completo está em .context/).
            setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: w.id, text: `Trabalhe na issue ${i.identifier}: ${i.title} (${i.url}). Detalhes em .context/[LINEAR]-${i.identifier}.md` } })), 900);
          }} />
      )}
      {palette && <Palette repos={repos} workspaces={workspaces} onClose={() => setPalette(false)} onRoute={(r) => (go(r), setPalette(false))} />}
    </div>
  );
}

function Home({ repos, workspaces, onRoute }: { repos: Repo[]; workspaces: Workspace[]; onRoute: (r: Route) => void }) {
  const recent = workspaces.filter((w) => !w.archived).sort((a, b) => b.created_at - a.created_at).slice(0, 6);
  return (
    <div className="home" data-tauri-drag-region>
      <div className="home-inner">
        <div className="home-mark">◆</div>
        <h1>Kabul</h1>
        <p className="dim">{repos.length ? "Agentes em paralelo, cada um no seu worktree." : "Adicione um repositório git em Criar para começar."}</p>
        {recent.length > 0 && (
          <div className="home-list">
            {recent.map((w) => (
              <button key={w.id} className="home-item" onClick={() => onRoute({ kind: "workspace", id: w.id })}>
                <IBranch size={14} /> <span>{wsTitle(w)}</span>
                <span className="dim">{repos.find((r) => r.id === w.repo_id)?.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="home-keys"><span><kbd>⌘K</kbd> buscar</span><span><kbd>⌘N</kbd> workspace</span><span><kbd>⌘1</kbd>–<kbd>9</kbd> trocar</span><span><kbd>⌘/</kbd> atalhos</span></div>
      </div>
    </div>
  );
}

function Palette({ repos, workspaces, onClose, onRoute }: { repos: Repo[]; workspaces: Workspace[]; onClose: () => void; onRoute: (r: Route) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<[string, string, string, string][]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => api.historySearch(q).then(setHits, () => setHits([])), 150);
    return () => clearTimeout(t);
  }, [q]);
  const items = useMemo(() => {
    const all: { label: string; hint: string; route: Route; action?: () => void }[] = [
      ...workspaces.filter((w) => !w.archived).flatMap((w) => cloudList(w.id).map((c) => ({ label: `☁︎ ${c.info.title ?? c.info.id}`, hint: `nuvem da Anthropic · ${wsTitle(w)}`, route: { kind: "workspace", id: w.id } as Route }))),
      ...workspaces.filter((w) => !w.archived).slice(0, 8).map((w) => ({ label: `Nova sessão na nuvem (Claude) · ${wsTitle(w)}`, hint: "☁︎ claude --cloud", route: { kind: "workspace", id: w.id } as Route, action: () => (onRoute({ kind: "workspace", id: w.id }), setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:cloud", { detail: w.id })), 300)) })),
      { label: "Novo workspace a partir de issue do Linear", hint: "Linear", route: { kind: "home" }, action: () => window.dispatchEvent(new Event("kabul:linear")) },
      { label: "Tema: Escuro", hint: "aparência", route: { kind: "home" }, action: () => setThemePref("dark") },
      { label: "Tema: Claro", hint: "aparência", route: { kind: "home" }, action: () => setThemePref("light") },
      { label: "Tema: Sistema", hint: "segue o macOS · ⌥⌘T alterna", route: { kind: "home" }, action: () => setThemePref("system") },
      ...workspaces.filter((w) => !w.archived).map((w) => ({ label: wsTitle(w), hint: `${repos.find((r) => r.id === w.repo_id)?.name ?? ""} · ${w.branch}`, route: { kind: "workspace", id: w.id } as Route })),
      { label: "Painel de sessões", hint: "tmux + Conductor", route: { kind: "sessions" } },
      { label: "Modelos locais", hint: "runtimes, downloads, registro", route: { kind: "local" } },
      { label: "Configurações", hint: "geral, contas, repositório", route: { kind: "settings", tab: "geral" } },
      { label: "Contas", hint: "login dos agentes", route: { kind: "settings", tab: "contas" } },
      { label: "Atalhos de teclado", hint: "⌘/", route: { kind: "settings", tab: "atalhos" } },
    ];
    const n = q.toLowerCase();
    const base = all.filter((i) => (n ? `${i.label} ${i.hint}`.toLowerCase().includes(n) : !i.action));
    const conv = hits.map(([wsId, , title, snip]) => ({ label: `💬 ${title}`, hint: snip.replace(/[{}"\[\]]/g, " ").slice(0, 60), route: { kind: "workspace", id: wsId } as Route }));
    return [...base, ...conv];
  }, [q, repos, workspaces, hits]);
  useEffect(() => void input.current?.focus(), []);
  const pick = (i: { route: Route; action?: () => void }) => (i.action ? (i.action(), onClose()) : onRoute(i.route));
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover palette" onMouseDown={(e) => e.stopPropagation()} data-testid="palette">
        <label className="pop-search">
          <ISearch />
          <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} ref={input} placeholder="Buscar workspaces, páginas e conversas" value={q} onChange={(e) => (setQ(e.target.value), setSel(0))}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, items.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter" && items[sel]) pick(items[sel]);
            }} />
        </label>
        <div className="pop-sep" />
        <div className="pop-list">
          {items.map((i, k) => (
            <div key={k} className={"pop-row" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => pick(i)}>
              <span className="label">{i.label}</span><span className="grow" /><span className="dim">{i.hint}</span>
            </div>
          ))}
          {items.length === 0 && <div className="pop-row dim">Nada encontrado para “{q}”</div>}
        </div>
      </div>
    </div>
  );
}
