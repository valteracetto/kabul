import { cronMatches, loadRoutines, parseCron, PR_EVENTS, saveRoutines, type Routine } from "./components/routines";
import { trError } from "./i18n/errors";
import { t } from "./i18n";
import { lastNotify, parseKabulLink } from "./components/links";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, wsTitle, type Repo, type Workspace } from "./api";
import { Sidebar } from "./views/Sidebar";
import { ConfirmHost, confirmClosing, liveChats } from "./components/Confirm";
import { Resizer, usePanelSize } from "./components/Resizer";
import { WorkspaceView } from "./views/WorkspaceView";
import { LinearPicker } from "./components/LinearPicker";
import { CreateModal } from "./components/CreateModal";
import { IBranch } from "./icons";
import { cycleTheme } from "./theme";
import { CloneDialog, QuickStartDialog } from "./components/CloneDialog";
import { HelpMenu } from "./components/HelpMenu";
import { FeedbackDialog } from "./components/Feedback";
import { touchWorkspace, workspaceLink } from "./views/Sidebar";
import { Palette } from "./components/Palette";
import { chatStore, statusOf, useWorkspaceAgents, type WsAgent } from "./components/chatStore";
import { checkForUpdates, UpdateBanner, UpdateDialogHost } from "./components/Updates";

// Telas fora do caminho principal: carregadas sob demanda (o JS inicial fica só com barra lateral e workspace).
const SessionsView = lazy(() => import("./views/SessionsView").then((m) => ({ default: m.SessionsView })));
const SettingsView = lazy(() => import("./views/SettingsView").then((m) => ({ default: m.SettingsView })));
const LocalModelsView = lazy(() => import("./views/LocalModelsView").then((m) => ({ default: m.LocalModelsView })));
const DiagnosticsView = lazy(() => import("./views/DiagnosticsView").then((m) => ({ default: m.DiagnosticsView })));
const DashboardView = lazy(() => import("./views/DashboardView").then((m) => ({ default: m.DashboardView })));
const RoutinesView = lazy(() => import("./views/RoutinesView").then((m) => ({ default: m.RoutinesView })));
const AgentsView = lazy(() => import("./views/AgentsView").then((m) => ({ default: m.AgentsView })));
const UsageView = lazy(() => import("./views/UsageView").then((m) => ({ default: m.UsageView })));

export type AgentState = WsAgent;

/** Mesmo objeto quando nada mudou: listas novas do backend não re-renderizam linhas e workspaces iguais. */
function share<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const old = new Map(prev.map((x) => [x.id, x]));
  let same = prev.length === next.length;
  const out = next.map((n, i) => {
    const o = old.get(n.id);
    const keep = o && JSON.stringify(o) === JSON.stringify(n) ? o : n;
    if (keep !== prev[i]) same = false;
    return keep;
  });
  return same ? prev : out;
}

export type Route =
  | { kind: "workspace"; id: string }
  | { kind: "sessions" }
  | { kind: "settings"; tab?: string; repoId?: string }
  | { kind: "local" }
  | { kind: "diagnostics" }
  | { kind: "dashboard" }
  | { kind: "routines" }
  | { kind: "usage" }
  | { kind: "agents" }
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
  // Uma inscrição só nos eventos dos agentes, antes de qualquer conversa começar.
  useState(() => chatStore.init());
  const [repos, setRepos] = useState<Repo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [stats, setStats] = useState<Record<string, [number, number]>>({});
  const [route, setRoute] = useState<Route>({ kind: "home" });
  // Toasts empilhados (um erro novo não esconde o anterior); somem sozinhos em 10 s.
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const setError = useCallback((e: string | null) => {
    if (!e) return setToasts([]);
    // Erros do backend chegam em português: traduz os conhecidos (i18n/errors.ts).
    e = trError(e);
    const id = Date.now() + Math.random();
    setToasts((t) => (t.some((x) => x.text === e) ? t : [...t, { id, text: e }].slice(-4)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 10000);
  }, []);
  const [palette, setPalette] = useState<boolean | "archived">(false);
  const [linear, setLinear] = useState(false);
  const [creating, setCreating] = useState<null | { from?: "prs" | "branches" | "issues"; repo?: string; add?: boolean; text?: string }>(null);
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
  // Workspaces montados além do visível: só enquanto uma rotina começa a conversa em segundo plano.
  const [bg, setBg] = useState<string[]>([]);
  // Estado dos agentes por workspace vem do registro de conversas (vale com o workspace desmontado).
  const agents = useWorkspaceAgents();
  const routeRef = useRef<Route>({ kind: "home" });
  sidebarRef.current = sidebar;
  // Fim de turno num workspace que não está na tela: fica "não lido" (negrito na barra lateral).
  const prevAgents = useRef(agents);
  useEffect(() => {
    const prev = prevAgents.current;
    prevAgents.current = agents;
    const r = routeRef.current;
    for (const id of Object.keys(agents)) if (prev[id] !== agents[id]) touchWorkspace(id);
    for (const id of Object.keys(prev)) if (!agents[id] && !(r.kind === "workspace" && r.id === id)) api.updateWorkspace(id, { unread: true }).then(() => api.workspaces().then((w) => setWorkspaces((o) => share(o, w))), () => {});
  }, [agents]);
  // Histórico de navegação (voltar/avançar).
  const [hist, setHist] = useState<{ stack: Route[]; i: number }>({ stack: [{ kind: "home" }], i: 0 });
  const go = useCallback((r: Route) => {
    setRoute(r);
    setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), r].slice(-50), i: Math.min(h.i + 1, 49) }));
  }, []);
  const back = () => hist.i > 0 && (setRoute(hist.stack[hist.i - 1]), setHist({ ...hist, i: hist.i - 1 }));
  const fwd = () => hist.i < hist.stack.length - 1 && (setRoute(hist.stack[hist.i + 1]), setHist({ ...hist, i: hist.i + 1 }));

  const setStatsShared = useCallback((n: Record<string, [number, number]>) => setStats((o) => (JSON.stringify(o) === JSON.stringify(n) ? o : n)), []);
  const reload = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([api.repos(), api.workspaces()]);
      setRepos((o) => share(o, r));
      setWorkspaces((o) => share(o, w));
      api.stats().then(setStatsShared, () => {});
    } catch (e) {
      setError(String(e));
    }
  }, []);
  // Com o app ocioso, já baixa o terminal (xterm), para o primeiro workspace abrir sem espera.
  useEffect(() => void setTimeout(() => void import("./views/TerminalLazy").then((m) => m.loadTerminal()), 1500), []);
  useEffect(() => {
    reload();
    const t = setInterval(() => api.stats().then(setStatsShared, () => {}), 8000);
    // Rajada de mudanças de estado (vários workspaces terminando o setup juntos): uma recarga só.
    let soon: ReturnType<typeof setTimeout> | null = null;
    const off = api.onWorkspaceState(() => void (soon ??= setTimeout(() => ((soon = null), void reload()), 60)));
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
        "check-updates": () => checkForUpdates(),
      };
      map[id]?.();
    });
    // ⌘Q: com agentes rodando, pergunta antes de sair.
    const offQuit = api.onQuitRequested(() => void quitRef.current());
    // Barra do Kabul (popover e menu do ícone): mesmas ações dos atalhos; "pausar" = Parar em cada conversa.
    const offTray = api.onTrayAction(({ action, workspace_id }) => {
      if (action === "open-workspace" && workspace_id) go({ kind: "workspace", id: workspace_id });
      else if (action === "new-workspace") setCreating({});
      else if (action === "usage") go({ kind: "usage" });
      else if (action === "pause-all") window.dispatchEvent(new CustomEvent("kabul:stop-all", { detail: "*" }));
      else if (action === "check-updates") checkForUpdates();
    });
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
    return () => (clearInterval(t), off(), window.removeEventListener("kabul:linear", openLinear), window.removeEventListener("kabul:route", route), window.removeEventListener("kabul:open-url", url), window.removeEventListener("kabul:devtools", devtools), misc.forEach(([n, h]) => window.removeEventListener(n, h)), offMenu(), offQuit(), offTray());
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
    if (route.kind === "workspace" && workspaces.find((w) => w.id === route.id)?.unread) api.updateWorkspace(route.id, { unread: false }).then(reload, () => {});
  }, [route, workspaces]);
  // Workspace em foco ganha prioridade na fila de agentes (backend com limite; sem o comando, ignora).
  const focusOk = useRef(true);
  useEffect(() => void (route.kind === "workspace" && focusOk.current && api.agentsFocus(route.id).catch(() => (focusOk.current = false))), [route]);


  const current = route.kind === "workspace" ? workspaces.find((w) => w.id === route.id && !w.archived) : undefined;

  // Links kabul:// (do sistema ou colados): abrir workspace/conversa, criar workspace, configurações.
  const openLink = useRef((_: string) => {});
  openLink.current = (url: string) => {
    const l = parseKabulLink(url);
    if (!l) return setError(t("app.link.invalid", { url }));
    if (l.kind === "workspace") {
      if (!workspaces.some((w) => w.id === l.id && !w.archived)) return setError(t("app.link.wsNotFound"));
      go({ kind: "workspace", id: l.id });
      if (l.session) setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:activate-tab", { detail: l.session })), 150);
    } else if (l.kind === "settings") go({ kind: "settings", tab: l.tab ?? "geral" });
    else {
      const r = repos.find((x) => (l.repo && (x.id === l.repo || x.name === l.repo)) || (l.path && x.path === l.path));
      setCreating({ repo: r?.id, text: [l.prompt, l.branch && t("app.link.baseBranch", { branch: l.branch }), l.linear && t("app.link.issue", { id: l.linear })].filter(Boolean).join("\n") || undefined });
    }
  };
  useEffect(() => {
    const off = api.onDeepLink((u) => openLink.current(u));
    const paste = (e: Event) => openLink.current((e as CustomEvent).detail);
    window.addEventListener("kabul:open-link", paste);
    const pal = (e: Event) => setPalette((e as CustomEvent).detail === "archived" ? "archived" : true);
    window.addEventListener("kabul:palette", pal);
    // Clique na notificação: o app volta para a frente e abre a conversa que avisou (até 10 min depois).
    const focus = () => {
      if (!lastNotify.at || Date.now() - lastNotify.at > 600_000) return;
      const { ws, session } = lastNotify;
      lastNotify.at = 0;
      openLink.current(`kabul://workspace?id=${ws}&session=${session}`);
    };
    window.addEventListener("focus", focus);
    return () => (off(), window.removeEventListener("kabul:open-link", paste), window.removeEventListener("focus", focus), window.removeEventListener("kabul:palette", pal));
  }, []);
  // Rotinas locais: cada execução abre uma conversa nova no workspace (montado em segundo plano, sem trocar de tela).
  const runRoutine = useRef((_r: Routine, _why: string) => {});
  runRoutine.current = (r, why) => {
    if (!workspaces.some((w) => w.id === r.workspace && !w.archived)) return setError(t("app.routine.wsGone", { name: r.name }));
    // Monta o workspace por alguns segundos (se não estiver na tela) só para abrir a conversa; depois ela segue no registro.
    setBg((o) => (o.includes(r.workspace) ? o : [...o, r.workspace]));
    setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:new-chat-with", { detail: { ws: r.workspace, text: r.prompt, title: r.name } })), 500);
    setTimeout(() => setBg((o) => o.filter((x) => x !== r.workspace)), 8000);
    saveRoutines(loadRoutines().map((x) => (x.id === r.id ? { ...x, runs: [...x.runs, { at: Date.now(), why }].slice(-50) } : x)));
  };
  useEffect(() => {
    let last = "";
    const cron = () => {
      const now = new Date();
      const key = `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
      if (key === last) return;
      last = key;
      for (const r of loadRoutines()) if (r.enabled && r.trigger.kind === "cron") { const c = parseCron(r.trigger.cron); if (c && cronMatches(c, now)) runRoutine.current(r, t("app.routine.why.cron")); }
    };
    // Eventos do PR: compara com o que já viu (a primeira leitura só guarda o estado).
    const pr = async () => {
      for (const r of loadRoutines().filter((x) => x.enabled && x.trigger.kind === "pr")) {
        const tr = r.trigger as Extract<Routine["trigger"], { kind: "pr" }>;
        const info = await api.prView(r.workspace).catch(() => null);
        if (!info) continue;
        const checks = tr.event === "checks_failed" ? await api.prChecks(r.workspace).catch(() => null) : null;
        const now = { failing: checks?.checks.filter((c) => c.bucket === "fail").length, state: info.state, comments: info.comments.length };
        const seen = r.seen;
        const fire = !!seen && (tr.event === "checks_failed" ? (now.failing ?? 0) > 0 && !(seen.failing ?? 0) : tr.event === "merged" ? now.state === "MERGED" && seen.state !== "MERGED" : now.comments > (seen.comments ?? 0));
        saveRoutines(loadRoutines().map((x) => (x.id === r.id ? { ...x, seen: { ...x.seen, ...now } } : x)));
        if (fire) runRoutine.current(r, PR_EVENTS[tr.event]);
      }
    };
    const every = (window as unknown as { __routinePoll?: number }).__routinePoll ?? 60_000;
    const a = setInterval(cron, 15_000), b = setInterval(pr, every);
    void pr();
    return () => (clearInterval(a), clearInterval(b));
  }, []);
  // Badge no ícone do app: workspaces com novidade não lida.
  const unreadCount = workspaces.filter((w) => w.unread && !w.archived).length;
  useEffect(() => void api.badgeSet(unreadCount).catch(() => {}), [unreadCount]);

  /** Arquivar com confirmação: avisa de agentes rodando ("parar e arquivar") e oferece fechar o PR. */
  const archive = useCallback(async (id: string) => {
    const w = workspaces.find((x) => x.id === id);
    if (!w || w.archived) return;
    const running = agents[id];
    const msg = t("app.archive.confirm", { name: wsTitle(w) }) + (running ? "\n\n" + t("app.archive.running") : "");
    const chats = [...liveChats.values()].filter((c) => c.ws === id).map((c) => c.chat);
    const ok = await confirmClosing(chats, msg, { ok: running ? t("app.archive.stopAndArchive") : t("app.side.archive"), danger: true, ask: true, workspaceId: id, checkbox: w.pr_url ? { key: "kabul.archive.closePr", label: t("app.archive.closePr") } : undefined });
    if (!ok) return;
    if (running) await chatStore.stopWorkspace(id);
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
  const openRepoSettings = useCallback((repoId: string) => go({ kind: "settings", tab: "repo", repoId }), [go]);
  const quitRef = useRef(async () => {});
  quitRef.current = async () => {
    const running = chatStore.all().filter((c) => statusOf(c) !== "idle").length;
    const chats = [...liveChats.values()].map((c) => c.chat);
    if (!(await confirmClosing(chats, running ? `${t("app.quit.confirm")} ${t("app.quit.running", { count: running })}.` : t("app.quit.confirm"), { ok: running ? t("app.quit.stopAndQuit") : t("app.quit.quit"), danger: true, ask: !!running }))) return;
    api.appQuit().catch(() => {});
  };

  return (
    <div className={"shell" + (sidebar ? "" : " no-sidebar") + (zen ? " zen" : "")} style={{ ["--sidebar-w" as string]: `${side.size}px` }}>
      {sidebar && <Sidebar repos={repos} workspaces={workspaces} stats={stats} agents={agents} route={route} onRoute={go} onBack={hist.i > 0 ? back : undefined} onFwd={hist.i < hist.stack.length - 1 ? fwd : undefined} onChange={reload} onError={onError} onSearch={() => setPalette(true)} onCollapse={() => setSidebar(false)} onLinear={() => setLinear(true)} onCreate={(repo, from) => setCreating({ repo, from: from ? "prs" : undefined })} onAddProject={() => setCreating({ add: true })} onHelp={() => setHelp(true)} />}
      {sidebar && <Resizer axis="x" dir={1} {...side} onSize={side.setSize} onCollapse={() => setSidebar(false)} testid="resize-sidebar" />}
      <main className="main">
        <UpdateBanner />
        {toasts.length > 0 && <div className="toasts">{toasts.map((toast) => <div key={toast.id} className="toast" role="alert" onClick={() => setToasts((x) => x.filter((y) => y.id !== toast.id))}>{toast.text}</div>)}</div>}
        {/* Só o workspace visível fica montado; os outros guardam o estado (abas, rascunho, rolagem, terminal) e remontam iguais. */}
        {[...new Set([...(route.kind === "workspace" ? [route.id] : []), ...bg])].map((id) => {
          const w = workspaces.find((x) => x.id === id && !x.archived);
          const r = w && repos.find((x) => x.id === w.repo_id);
          const on = route.kind === "workspace" && route.id === id;
          return w && r ? <div key={id} className="ws-host" hidden={!on} data-host={id}><WorkspaceView ws={w} repo={r} active={on} sidebarHidden={!sidebar} onError={onError} onChange={reload} onOpenSettings={openRepoSettings} /></div> : null;
        })}
        <Suspense fallback={null}>
        {route.kind === "sessions" && <SessionsView onError={onError} onRoute={go} />}
        {route.kind === "agents" && <AgentsView workspaces={workspaces} repos={repos} onRoute={go} />}
        {route.kind === "dashboard" && <DashboardView workspaces={workspaces} repos={repos} stats={stats} onOpen={(id) => go({ kind: "workspace", id })} onChange={reload} onError={onError} />}
        {route.kind === "routines" && <RoutinesView workspaces={workspaces} onRun={(r, why) => runRoutine.current(r, why)} />}
        {route.kind === "settings" && <SettingsView key={route.tab + (route.repoId ?? "")} tab={route.tab ?? "geral"} repoId={route.repoId} repos={repos} onError={onError} onRoute={go} />}
        {route.kind === "local" && <LocalModelsView onError={onError} />}
        {route.kind === "diagnostics" && <DiagnosticsView onError={onError} />}
        {route.kind === "usage" && <UsageView onError={onError} onRoute={go} />}
        </Suspense>
        {(route.kind === "home" || (route.kind === "workspace" && !current)) && <Home repos={repos} workspaces={workspaces} onRoute={go} onOpen={openProject} onClone={() => setAddDialog("clone")} onQuick={() => setAddDialog("quick")} />}
        {!sidebar && <button className="icon-btn sidebar-reopen" title={t("app.side.showSidebar")} onClick={() => setSidebar(true)}>☰</button>}
      </main>
      <UpdateDialogHost />
      <ConfirmHost />
      {help && <HelpMenu onClose={() => setHelp(false)} onRoute={go} onFeedback={() => setFeedback(true)} />}
      {feedback && <FeedbackDialog onClose={() => setFeedback(false)} />}
      {addDialog === "clone" && <CloneDialog onClose={() => setAddDialog(null)} onDone={(r) => (setAddDialog(null), void reload().then(() => setCreating({ repo: r.id })))} />}
      {addDialog === "quick" && <QuickStartDialog onClose={() => setAddDialog(null)} onDone={(r) => (setAddDialog(null), void reload().then(() => setCreating({ repo: r.id })))} />}
      {creating && (
        <CreateModal repos={repos} defaultRepo={creating.repo ?? current?.repo_id} fromTab={creating.from} addMode={creating.add || repos.length === 0} initialText={creating.text} onReposChanged={reload} onError={onError} onClose={() => setCreating(null)}
          onCreated={(w) => (setCreating(null), reload(), go({ kind: "workspace", id: w.id }))} />
      )}
      {linear && (
        <LinearPicker repos={repos} defaultRepo={current?.repo_id} onError={onError} onClose={() => setLinear(false)} onConnect={() => (setLinear(false), go({ kind: "settings", tab: "integracoes" }))}
          onCreated={(w, i) => {
            setLinear(false);
            reload();
            go({ kind: "workspace", id: w.id });
            // Contexto da issue para o agente (o arquivo completo está em .context/).
            setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: w.id, text: t("app.link.workOnIssue", { id: i.identifier, title: i.title, url: i.url }) } })), 900);
          }} />
      )}
      {palette && <Palette repos={repos} workspaces={workspaces} current={current} archived={palette === "archived"} onClose={() => setPalette(false)} onRoute={(r) => (go(r), setPalette(false))} onCreate={(o) => setCreating(o)} onChange={reload} />}
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
        <p className="dim">{repos.length ? t("app.home.tagline") : t("app.home.empty")}</p>
        <div className="home-cards">
          <button className="home-card" onClick={onOpen} data-testid="home-open"><span className="hc-ico">📁</span>{t("app.create.openProject")}</button>
          <button className="home-card" onClick={onClone} data-testid="home-github"><span className="hc-ico">⎇</span>{t("app.create.openGitHub")}</button>
          <button className="home-card" onClick={onQuick} data-testid="home-quick"><span className="hc-ico">⚡</span>{t("app.quick.title")}</button>
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
        <div className="home-keys"><span><kbd>⌘K</kbd> {t("app.home.keySearch")}</span><span><kbd>⌘N</kbd> {t("app.home.keyWorkspace")}</span><span><kbd>⌘1</kbd>–<kbd>9</kbd> {t("app.home.keySwitch")}</span><span><kbd>⌘⌥/</kbd> {t("app.home.keyShortcuts")}</span></div>
      </div>
    </div>
  );
}
