import { useCallback, useEffect, useRef, useState } from "react";
import { api, wsTitle, type Repo, type Workspace } from "./api";
import { Sidebar } from "./views/Sidebar";
import { ConfirmHost, confirmDialog } from "./components/Confirm";
import { Resizer, usePanelSize } from "./components/Resizer";
import { WorkspaceView } from "./views/WorkspaceView";
import { SessionsView } from "./views/SessionsView";
import { SettingsView } from "./views/SettingsView";
import { LocalModelsView } from "./views/LocalModelsView";
import { LinearPicker } from "./components/LinearPicker";
import { CreateModal } from "./components/CreateModal";
import { IBranch } from "./icons";
import { cycleTheme } from "./theme";
import { CloneDialog, QuickStartDialog } from "./components/CloneDialog";
import { HelpMenu } from "./components/HelpMenu";
import { FeedbackDialog } from "./components/Feedback";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { touchWorkspace, workspaceLink } from "./views/Sidebar";
import { Palette } from "./components/Palette";

export type AgentState = "working" | "waiting";

export type Route =
  | { kind: "workspace"; id: string }
  | { kind: "sessions" }
  | { kind: "settings"; tab?: string; repoId?: string }
  | { kind: "local" }
  | { kind: "diagnostics" }
  | { kind: "home" };

/** Zoom do app: 50% a 300% em passos de 10% (⌘+, ⌘−, ⌘0). Guardado no aparelho. */
export function applyZoom(step: number) {
  const cur = Number(localStorage.getItem("kabul.zoom") ?? "100");
  const next = step === 0 ? 100 : Math.min(300, Math.max(50, cur + step * 10));
  localStorage.setItem("kabul.zoom", String(next));
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = `${next}%`;
  window.dispatchEvent(new CustomEvent("kabul:zoom-changed", { detail: next }));
}

export function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [stats, setStats] = useState<Record<string, [number, number]>>({});
  const [route, setRoute] = useState<Route>({ kind: "home" });
  // Toasts empilhados (um erro novo não esconde o anterior); somem sozinhos em 10 s.
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const setError = useCallback((e: string | null) => {
    if (!e) return setToasts([]);
    const id = Date.now() + Math.random();
    setToasts((t) => (t.some((x) => x.text === e) ? t : [...t, { id, text: e }].slice(-4)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 10000);
  }, []);
  const [palette, setPalette] = useState(false);
  const [linear, setLinear] = useState(false);
  const [creating, setCreating] = useState<null | { from?: "prs" | "branches" | "issues"; repo?: string; add?: boolean }>(null);
  const [sidebar, setSidebar] = useState(true);
  const [help, setHelp] = useState(false);
  const [zen, setZen] = useState(false);
  const zenPrev = useRef(true);
  const toggleZen = useCallback(() => setZen((z) => {
    if (!z) (zenPrev.current = sidebarRef.current, setSidebar(false));
    else setSidebar(zenPrev.current);
    window.dispatchEvent(new CustomEvent("kabul:zen-state", { detail: !z }));
    return !z;
  }), []);
  const sidebarRef = useRef(true);
  const [feedback, setFeedback] = useState(false);
  const [addDialog, setAddDialog] = useState<"clone" | "quick" | null>(null);
  const openProject = async () => {
    const p = await api.pickFolder().catch(() => null);
    if (!p) return;
    try {
      const r = await api.addRepo(p);
      await reload();
      setCreating({ repo: r.id });
    } catch (e) {
      setError(String(e));
    }
  };
  const side = usePanelSize("sidebar", Math.round(Math.min(420, Math.max(240, window.innerWidth * 0.22))), 200, 520);
  const [opened, setOpened] = useState<string[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentState | undefined>>({});
  const routeRef = useRef<Route>({ kind: "home" });
  sidebarRef.current = sidebar;
  // Fim de turno num workspace que não está na tela: fica "não lido" (negrito na barra lateral).
  const onAgent = useCallback((id: string, st: AgentState | undefined) => setAgents((a) => {
    if (a[id] === st) return a;
    if (st) touchWorkspace(id);
    const r = routeRef.current;
    if (a[id] && !st && !(r.kind === "workspace" && r.id === id)) api.updateWorkspace(id, { unread: true }).then(() => api.workspaces().then(setWorkspaces), () => {});
    return { ...a, [id]: st };
  }), []);
  // Histórico de navegação (voltar/avançar).
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
    const devtools = () => void api.openDevtools().catch(() => {});
    // Menu nativo: os mesmos comandos dos atalhos.
    const offMenu = api.onMenu((id) => {
      const map: Record<string, () => void> = {
        settings: () => go({ kind: "settings", tab: "geral" }),
        "new-workspace": () => setCreating({}),
        "add-project": () => setCreating({ add: true }),
        "toggle-sidebar": () => setSidebar((s) => !s),
        "toggle-right": () => routeRef.current.kind === "workspace" && window.dispatchEvent(new CustomEvent("kabul:ws-action", { detail: { ws: (routeRef.current as { id: string }).id, action: "toggle-right" } })),
        zen: () => toggleZen(),
        "zoom-in": () => applyZoom(1),
        "zoom-out": () => applyZoom(-1),
        "zoom-reset": () => applyZoom(0),
        shortcuts: () => go({ kind: "settings", tab: "atalhos" }),
        diagnostics: () => go({ kind: "diagnostics" }),
        feedback: () => setFeedback(true),
        devtools: () => void api.openDevtools().catch(() => {}),
      };
      map[id]?.();
    });
    // ⌘Q: com agentes rodando, pergunta antes de sair.
    const offQuit = api.onQuitRequested(() => void quitRef.current());
    const misc: [string, (e: Event) => void][] = [
      ["kabul:cycle-theme", () => void cycleTheme()],
      ["kabul:toggle-sidebar", () => setSidebar((s) => !s)],
      ["kabul:zen", () => toggleZen()],
      ["kabul:zoom", (e) => applyZoom((e as CustomEvent).detail)],
      ["kabul:feedback", () => setFeedback(true)],
      ["kabul:reload", () => void reload()],
      ["kabul:next-unread", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", metaKey: true, altKey: true }))],
    ];
    misc.forEach(([n, h]) => window.addEventListener(n, h));
    window.addEventListener("kabul:devtools", devtools);
    window.addEventListener("kabul:open-url", url);
    window.addEventListener("kabul:route", route);
    window.addEventListener("kabul:linear", openLinear);
    return () => (clearInterval(t), off(), window.removeEventListener("kabul:linear", openLinear), window.removeEventListener("kabul:route", route), window.removeEventListener("kabul:open-url", url), window.removeEventListener("kabul:devtools", devtools), misc.forEach(([n, h]) => window.removeEventListener(n, h)), offMenu(), offQuit());
  }, [reload]);
  // Ao abrir, volta à última rota (se o workspace ainda existir e não estiver arquivado).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !workspaces.length && !repos.length) return;
    restored.current = true;
    try {
      const last = JSON.parse(localStorage.getItem("kabul.lastRoute") ?? "null") as Route | null;
      if (last && route.kind === "home" && (last.kind !== "workspace" || workspaces.some((w) => w.id === last.id && !w.archived))) go(last);
    } catch {
      /* rota inválida */
    }
  }, [workspaces, repos]);
  useEffect(() => {
    if (restored.current) localStorage.setItem("kabul.lastRoute", JSON.stringify(route));
    routeRef.current = route;
    if (route.kind === "workspace" && !opened.includes(route.id)) setOpened((o) => [...o, route.id]);
    if (route.kind === "workspace" && workspaces.find((w) => w.id === route.id)?.unread) api.updateWorkspace(route.id, { unread: false }).then(reload, () => {});
  }, [route, opened, workspaces]);


  const current = route.kind === "workspace" ? workspaces.find((w) => w.id === route.id && !w.archived) : undefined;

  /** Arquivar com confirmação: avisa de agentes rodando ("parar e arquivar") e oferece fechar o PR. */
  const archive = useCallback(async (id: string) => {
    const w = workspaces.find((x) => x.id === id);
    if (!w || w.archived) return;
    const running = agents[id];
    const msg = `Arquivar ${wsTitle(w)}? As mudanças ficam num checkpoint e dá para desarquivar.${running ? "\n\nHá um agente rodando neste workspace: ele será parado." : ""}`;
    const ok = await confirmDialog(msg, { ok: running ? "Parar agentes e arquivar" : "Arquivar", danger: true, checkbox: w.pr_url ? { key: "kabul.archive.closePr", label: "Fechar o PR também" } : undefined });
    if (!ok) return;
    if (running) window.dispatchEvent(new CustomEvent("kabul:stop-all", { detail: id }));
    try {
      await api.archiveWorkspace(id, !!w.pr_url && localStorage.getItem("kabul.archive.closePr") === "1");
      reload();
    } catch (e) {
      setError(String(e));
    }
  }, [workspaces, agents, reload]);
  useEffect(() => {
    const h = (e: Event) => archive((e as CustomEvent).detail);
    window.addEventListener("kabul:archive", h);
    return () => window.removeEventListener("kabul:archive", h);
  }, [archive]);

  // Atalhos globais: ⌘K busca, ⌘, configurações, ⌘B barra lateral, ⌘N workspace novo, ⌘1..9 workspaces.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyA") return (e.preventDefault(), setCreating({ add: true }));
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "n") return (e.preventDefault(), setCreating({ from: "prs" }));
      if (e.metaKey && e.shiftKey && e.code === "KeyA" && current) return (e.preventDefault(), void archive(current.id));
      if (e.metaKey && e.shiftKey && e.code === "KeyH") return (e.preventDefault(), go({ kind: "home" }));
      if (e.metaKey && e.shiftKey && e.code === "KeyC" && current) return (e.preventDefault(), void navigator.clipboard.writeText(workspaceLink(current)));
      if (e.metaKey && e.altKey && e.code === "KeyF") return (e.preventDefault(), setFeedback(true));
      if (e.metaKey && !e.shiftKey && !e.altKey && (e.key === "=" || e.key === "+")) return (e.preventDefault(), applyZoom(1));
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key === "-") return (e.preventDefault(), applyZoom(-1));
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key === "0") return (e.preventDefault(), applyZoom(0));
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key === ".") return (e.preventDefault(), toggleZen());
      if (e.metaKey && e.altKey && e.code === "KeyI") return (e.preventDefault(), void api.openDevtools().catch(() => {}));
      if (e.metaKey && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // ⌘⌥↑/↓: workspace anterior/próximo na ordem da barra lateral.
        const rows = [...document.querySelectorAll<HTMLElement>("[data-testid=ws-row][data-ws]")].map((el) => el.dataset.ws!);
        const i = current ? rows.indexOf(current.id) : -1;
        const next = rows[(i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
        if (next) (e.preventDefault(), go({ kind: "workspace", id: next }));
        return;
      }
      if (e.metaKey && e.altKey && e.code === "KeyL") {
        // ⌘⌥L: próximo workspace que pede atenção (esperando você ou não lido).
        const live = workspaces.filter((w) => !w.archived && w.id !== current?.id);
        const next = live.find((w) => agents[w.id] === "waiting") ?? live.find((w) => w.unread);
        if (next) (e.preventDefault(), go({ kind: "workspace", id: next.id }));
        return;
      }
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
  }, [workspaces, repos, current, reload, hist, archive, agents]);

  const onError = useCallback((e: string) => setError(e), []);
  const quitRef = useRef(async () => {});
  quitRef.current = async () => {
    const running = Object.values(agents).filter(Boolean).length;
    if (running && !(await confirmDialog(`Sair do Kabul? ${running === 1 ? "Há 1 agente rodando; ele será parado" : `Há ${running} agentes rodando; eles serão parados`}.`, { ok: "Parar agentes e sair", danger: true }))) return;
    api.appQuit().catch(() => {});
  };

  return (
    <div className={"shell" + (sidebar ? "" : " no-sidebar") + (zen ? " zen" : "")} style={{ ["--sidebar-w" as string]: `${side.size}px` }}>
      {sidebar && <Sidebar repos={repos} workspaces={workspaces} stats={stats} agents={agents} route={route} onRoute={go} onBack={hist.i > 0 ? back : undefined} onFwd={hist.i < hist.stack.length - 1 ? fwd : undefined} onChange={reload} onError={onError} onSearch={() => setPalette(true)} onCollapse={() => setSidebar(false)} onLinear={() => setLinear(true)} onCreate={(repo, from) => setCreating({ repo, from: from ? "prs" : undefined })} onAddProject={() => setCreating({ add: true })} onHelp={() => setHelp(true)} />}
      {sidebar && <Resizer axis="x" dir={1} {...side} onSize={side.setSize} onCollapse={() => setSidebar(false)} testid="resize-sidebar" />}
      <main className="main">
        {toasts.length > 0 && <div className="toasts">{toasts.map((t) => <div key={t.id} className="toast" role="alert" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>{t.text}</div>)}</div>}
        {opened.map((id) => {
          const w = workspaces.find((x) => x.id === id && !x.archived);
          const r = w && repos.find((x) => x.id === w.repo_id);
          const on = route.kind === "workspace" && route.id === id;
          return w && r ? <div key={id} className="ws-host" hidden={!on}><WorkspaceView ws={w} repo={r} active={on} sidebarHidden={!sidebar} onAgent={onAgent} onError={onError} onChange={reload} onOpenSettings={(repoId) => go({ kind: "settings", tab: "repo", repoId })} /></div> : null;
        })}
        {route.kind === "sessions" && <SessionsView onError={onError} onRoute={go} />}
        {route.kind === "settings" && <SettingsView key={route.tab + (route.repoId ?? "")} tab={route.tab ?? "geral"} repoId={route.repoId} repos={repos} onError={onError} onRoute={go} />}
        {route.kind === "local" && <LocalModelsView onError={onError} />}
        {route.kind === "diagnostics" && <DiagnosticsView onError={onError} />}
        {(route.kind === "home" || (route.kind === "workspace" && !current)) && <Home repos={repos} workspaces={workspaces} onRoute={go} onOpen={openProject} onClone={() => setAddDialog("clone")} onQuick={() => setAddDialog("quick")} />}
        {!sidebar && <button className="icon-btn sidebar-reopen" title="Mostrar barra lateral (⌘B)" onClick={() => setSidebar(true)}>☰</button>}
      </main>
      <ConfirmHost />
      {help && <HelpMenu onClose={() => setHelp(false)} onRoute={go} onFeedback={() => setFeedback(true)} />}
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
      {addDialog === "clone" && <CloneDialog onClose={() => setAddDialog(null)} onDone={(r) => (setAddDialog(null), void reload().then(() => setCreating({ repo: r.id })))} />}
      {addDialog === "quick" && <QuickStartDialog onClose={() => setAddDialog(null)} onDone={(r) => (setAddDialog(null), void reload().then(() => setCreating({ repo: r.id })))} />}
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
      {palette && <Palette repos={repos} workspaces={workspaces} current={current} onClose={() => setPalette(false)} onRoute={(r) => (go(r), setPalette(false))} onCreate={(o) => setCreating(o)} onChange={reload} />}
    </div>
  );
}

function Home({ repos, workspaces, onRoute, onOpen, onClone, onQuick }: { repos: Repo[]; workspaces: Workspace[]; onRoute: (r: Route) => void; onOpen: () => void; onClone: () => void; onQuick: () => void }) {
  const recent = workspaces.filter((w) => !w.archived).sort((a, b) => b.created_at - a.created_at).slice(0, 6);
  return (
    <div className="home" data-tauri-drag-region>
      <div className="home-inner">
        <div className="home-mark">◆</div>
        <h1>Kabul</h1>
        <p className="dim">{repos.length ? "Agentes em paralelo, cada um no seu worktree." : "Adicione um repositório git em Criar para começar."}</p>
        <div className="home-cards">
          <button className="home-card" onClick={onOpen} data-testid="home-open"><span className="hc-ico">📁</span>Abrir projeto</button>
          <button className="home-card" onClick={onClone} data-testid="home-github"><span className="hc-ico">⎇</span>Abrir projeto do GitHub</button>
          <button className="home-card" onClick={onQuick} data-testid="home-quick"><span className="hc-ico">⚡</span>Início rápido</button>
        </div>
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
        <div className="home-keys"><span><kbd>⌘K</kbd> buscar</span><span><kbd>⌘N</kbd> workspace</span><span><kbd>⌘1</kbd>–<kbd>9</kbd> trocar</span><span><kbd>⌘⌥/</kbd> atalhos</span></div>
      </div>
    </div>
  );
}
