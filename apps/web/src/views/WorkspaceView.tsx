import { createPortal } from "react-dom";
import { trError } from "../i18n/errors";
import { fmtDate } from "../i18n/format";
import { tNode } from "../i18n/react";
import { t } from "../i18n";
import { confirmClosing, confirmDialog, liveChats } from "../components/Confirm";
import { Floating } from "../components/Floating";
import { noSuggest } from "../noSuggest";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDismiss, usePopover } from "../components/useDismiss";
import { api, STATUS_LABEL, wsTitle, type Checkpoint, type FileChange, type PrOptions, type PrResult, type Repo, type Workspace } from "../api";
import { ChatTab } from "./ChatTab";
import { TerminalTab } from "./TerminalLazy";
import { BrowserTab } from "./BrowserLazy";
import { pendingBrowserUrl } from "../components/browser";
import { FileDiff, FileView, viewedMap } from "./FileDiff";
import type { DiffScope } from "../api";
import { ScriptsPane } from "./ScriptsPane";
import { IChevronDown, IClose, IEye, IFile, IFolder, IGlobe, IHistory, IMore, IPanel, IPin, IPlus, IRestore } from "../icons";
import { RepoIcon } from "../components/RepoIcon";
import { OpenIn } from "../components/OpenIn";
import { FileTree } from "../components/FileTree";
import { LazyChunks } from "../components/LazyChunks";
import { QuickOpen, SearchFiles } from "../components/FileSearch";
import { ChecksPanel, GitButton, PrPill, availability, commentText } from "../components/GitPanel";
import { buildPrompt, failing, useGit, type GitActionId } from "../components/useGit";
import { Resizer, usePanelSize } from "../components/Resizer";
import { chatStore, statusOf, useChatStatus } from "../components/chatStore";
import { CloudDialog, CloudTab } from "../components/Cloud";
import { pendingFirst } from "../components/CreateModal";
import { mountedWs, pendingActivate, pendingFork, pendingForkWs, pendingModel, termPreset } from "../components/chatPrefs";
import { useSettings } from "../components/useSettings";
import { RunsOnBadge, cloudAdd, cloudList, cloudRemove, cloudRunsOn } from "../components/RunsOn";
import type { CloudInfo, RepoAccess } from "../api";

type CenterTab = { kind: "chat"; id: string; title: string } | { kind: "cloud"; tmux: string; info: CloudInfo } | { kind: "term"; session: string; title: string; preset?: string } | { kind: "diff"; path: string } | { kind: "file"; path: string; line?: number } | { kind: "browser" };
type Bottom = "setup" | "run" | "terminal" | `t${number}`;
type RightTab = "all" | "changes" | "checks" | "checkpoints";

const newChatId = () => `chat-${Date.now().toString(36)}`;

interface Props { ws: Workspace; repo: Repo; active: boolean; sidebarHidden: boolean; onError: (e: string) => void; onChange: () => void; onOpenSettings: (repoId: string) => void }

/**
 * Estado da tela de cada workspace guardado ao desmontar (só o workspace visível fica montado):
 * abas, aba ativa, divisão, painéis e terminais extras voltam iguais ao reabrir.
 */
interface WsMemory { tabs: CenterTab[]; activeTab: number; split: { key: string; pct: number } | null; right: RightTab; bottom: Bottom; bottomOpen: boolean; extraTerms: number[]; filter: string; rightOpen: boolean }
const wsMemory = new Map<string, WsMemory>();

/** Spinner, aguardando vaga e não lido da aba, lidos do registro de conversas (vale com a conversa fora da tela). */
function TabStatus({ id }: { id: string }) {
  const s = useChatStatus(id);
  return s.status === "working" ? <span className="spinner tiny" /> : s.status === "queued" ? <span className="agent-dot queued" title={t("code.ws.queued", { n: s.queue ?? "?" })} data-testid="tab-queued" /> : s.status === "waiting" ? <span className="agent-dot waiting" title={t("code.ws.waitingYou")} /> : s.unread ? <span className="unread-dot" /> : null;
}

export const WorkspaceView = memo(function WorkspaceView({ ws, repo, active, sidebarHidden, onError, onChange, onOpenSettings }: Props) {
  const [mem] = useState(() => wsMemory.get(ws.id) ?? null);
  const [rightOpen, setRightOpen] = useState(() => mem?.rightOpen ?? (localStorage.getItem("kabul.rightPanel") !== "0" && window.innerWidth >= 1000));
  const [menu, setMenu] = useState(false);
  const [plusMenu, setPlusMenu] = useState(false);
  const [cloudDialog, setCloudDialog] = useState(false);
  const [mirror, setMirror] = useState<{ running: boolean; link: string | null } | null>(null);
  const [access, setAccess] = useState<RepoAccess | null>(null);
  const git = useGit(ws, repo, active);
  const rightSize = usePanelSize("right", Math.round(Math.min(480, Math.max(320, window.innerWidth * 0.3))), 260, 900);
  const bottomSize = usePanelSize("bottom", Math.round(window.innerHeight * 0.42), 120, 900);
  const toggleRight = () => setRightOpen((o) => (localStorage.setItem("kabul.rightPanel", o ? "0" : "1"), !o));
  const [tabs, setTabs] = useState<CenterTab[]>(mem?.tabs ?? []);
  const [activeTab, setActiveTab] = useState(mem?.activeTab ?? 0);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [right, setRight] = useState<RightTab>(mem?.right ?? "all");
  const [bottom, setBottom] = useState<Bottom>(mem?.bottom ?? "terminal");
  const [extraTerms, setExtraTerms] = useState<number[]>(mem?.extraTerms ?? []);
  const [bottomOpen, setBottomOpen] = useState(mem?.bottomOpen ?? true);
  const [pr, setPr] = useState<PrOptions | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prResult, setPrResult] = useState<PrResult | null>(null);
  const [editing, setEditing] = useState<"title" | "branch" | null>(null);
  const [draft, setDraft] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null), menuRef = useRef<HTMLDivElement>(null), prRef = useRef<HTMLDivElement>(null);
  useDismiss(statusRef, statusOpen, useCallback(() => setStatusOpen(false), []));
  useDismiss(menuRef, menu, useCallback(() => setMenu(false), []));
  const plusRef = useRef<HTMLDivElement>(null);
  useDismiss(plusRef, plusMenu, useCallback(() => setPlusMenu(false), []));
  useEffect(() => void api.mirrorStatus(ws.id).then(setMirror, () => {}), [ws.id]);
  useEffect(() => void api.githubRepoAccess(repo.id).then(setAccess, () => {}), [repo.id]);
  useEffect(() => {
    const h = (e: Event) => (e as CustomEvent).detail === ws.id && setCloudDialog(true);
    window.addEventListener("kabul:cloud", h);
    return () => window.removeEventListener("kabul:cloud", h);
  }, [ws.id]);
  const toggleMirror = async () => {
    try {
      if (mirror?.running) {
        await api.mirrorStop(ws.id);
        setMirror({ running: false, link: null });
      } else {
        const last = tabs.find((tb) => tb.kind === "chat") as { id: string } | undefined;
        const rec = last ? await api.historyLoad(ws.id, last.id).catch(() => null) : null;
        setMirror(await api.mirrorStart(ws.id, rec?.agent_session ?? null));
      }
    } catch (e) {
      onError(String(e));
    }
  };
  const newTerminalTab = async () => {
    const n = tabs.filter((tb) => tb.kind === "term").length + 1;
    const session = `kabul-${ws.name}-tab${n}`;
    const preset = termPreset();
    open({ kind: "term", session, title: preset ? `${preset.split(" ")[0]} ${n}` : t("code.ws.terminalN", { n }), preset });
  };

  useEffect(() => (mountedWs.add(ws.id), () => void mountedWs.delete(ws.id)), [ws.id]);
  // Sessões salvas viram abas; se não houver, uma conversa nova.
  useEffect(() => {
    // Remontando com a tela guardada: só acrescenta a aba de um "continuar"/fork pedido enquanto estava fora.
    if (mem) {
      const pfw = pendingForkWs[ws.id];
      if (pfw) (delete pendingForkWs[ws.id], setTabs((tb) => [...tb, { kind: "chat", id: pfw.chatId, title: t("code.ws.fork") }]), setActiveTab(mem.tabs.length));
      return;
    }
    api.historyList(ws.id).then((h) => {
      const pfw = pendingForkWs[ws.id];
      if (pfw) delete pendingForkWs[ws.id];
      const chats: CenterTab[] = pfw ? [{ kind: "chat", id: pfw.chatId, title: t("code.ws.fork") }] : h.length ? h.slice(0, 6).reverse().map((s) => ({ kind: "chat", id: s.id, title: s.title })) : [{ kind: "chat", id: newChatId(), title: t("common.newChat") }];
      // Sessões de nuvem reabertas como abas ☁︎.
      setTabs([...chats, ...cloudList(ws.id).slice(0, 4).map((c) => ({ kind: "cloud" as const, tmux: c.tmux, info: c.info }))]);
      setActiveTab(0);
    }, () => setTabs([{ kind: "chat", id: newChatId(), title: t("common.newChat") }]));
  }, [ws.id]);

  const [scope, setScope] = useState<DiffScope>(() => (localStorage.getItem("kabul.diff.scope") as DiffScope) || "all");
  const [changesView, setChangesView] = useState(() => localStorage.getItem("kabul.changes.view") ?? "list");
  const [filter, setFilter] = useState(mem?.filter ?? "");
  const [, bumpViewed] = useState(0);
  useEffect(() => {
    const h = () => bumpViewed((x) => x + 1);
    window.addEventListener("kabul:viewed", h);
    return () => window.removeEventListener("kabul:viewed", h);
  }, []);
  const [finder, setFinder] = useState<"open" | "grep" | null>(null);
  const [fileCtx, setFileCtx] = useState<{ path: string; x: number; y: number; changed: boolean } | null>(null);
  const fileCtxRef = useRef<HTMLDivElement>(null);
  useDismiss(fileCtxRef, !!fileCtx, useCallback(() => setFileCtx(null), []));
  const targetPop = usePopover<HTMLSpanElement>();
  const [branches, setBranches] = useState<string[]>([]);
  const loadRight = useCallback(() => {
    // A cada 4 s: lista igual mantém a mesma referência (árvore e linhas não se refazem à toa).
    const same = <T,>(a: T[], b: T[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
    api.changes(ws.id, scope).then((n) => setChanges((o) => (same(o, n) ? o : n)), () => {});
    if (right === "all") api.files(ws.id).then((n) => setAllFiles((o) => (same(o, n) ? o : n)), () => {});
    if (right === "checkpoints") api.checkpoints(ws.id).then((n) => setCheckpoints((o) => (same(o, n) ? o : n)), () => {});
  }, [ws.id, right, scope]);
  useEffect(() => {
    loadRight();
    if (!active) return;
    const tb = setInterval(loadRight, 4000);
    return () => clearInterval(tb);
  }, [loadRight, active]);

  const open = (tb: CenterTab) => {
    const key = (x: CenterTab) => (x.kind === "chat" ? x.id : x.kind === "cloud" ? x.tmux : x.kind === "term" ? x.session : x.kind === "browser" ? "browser" : x.path);
    const i = tabs.findIndex((x) => x.kind === tb.kind && key(x) === key(tb));
    if (i >= 0) return (setActiveTab(i), tb.kind === "file" && setTabs((ts) => ts.map((x, k) => (k === i ? tb : x))));
    // Um diff por vez: abrir outro arquivo troca o caminho da aba de diff existente.
    const di = tb.kind === "diff" ? tabs.findIndex((x) => x.kind === "diff") : -1;
    if (di >= 0) return (setTabs((ts) => ts.map((x, k) => (k === di ? tb : x))), setActiveTab(di));
    setTabs([...tabs, tb]);
    setActiveTab(tabs.length);
  };
  // Abas divididas: a aba ativa à esquerda e `split.key` à direita, cada lado de 20% a 80%.
  const [split, setSplit] = useState<{ key: string; pct: number } | null>(mem?.split ?? null);
  // Guarda a tela ao desmontar (lido na hora: os valores mais recentes).
  const saveRef = useRef<() => WsMemory>(() => null as never);
  saveRef.current = () => ({ tabs, activeTab, split, right, bottom, bottomOpen, extraTerms, filter, rightOpen });
  useLayoutEffect(() => () => void wsMemory.set(ws.id, saveRef.current()), [ws.id]);
  const tabKey = (x: CenterTab) => (x.kind === "chat" ? x.id : x.kind === "cloud" ? x.tmux : x.kind === "term" ? x.session : x.kind === "browser" ? "browser" : x.kind + x.path);
  const splitIdx = split ? tabs.findIndex((x) => tabKey(x) === split.key) : -1;
  const splitWith = (i: number) => {
    const tb = tabs[i];
    if (!tb) return;
    if (i === activeTab) {
      const other = tabs.findIndex((_, j) => j !== i);
      if (other < 0) return;
      setActiveTab(other);
    }
    setSplit({ key: tabKey(tb), pct: 50 });
  };
  const paneClass = (i: number) => "center-body" + (splitIdx >= 0 && i === activeTab ? " pane-left" : splitIdx >= 0 && i === splitIdx ? " pane-right" : "");
  const closedRef = useRef<CenterTab[]>([]);
  const closeTab = async (i: number) => {
    const tb = tabs[i];
    // Fechar uma conversa com o agente trabalhando pede confirmação e para o agente.
    // Também lista os processos que o agente abriu (servidores etc.): continuam rodando, salvo os marcados.
    if (tb?.kind === "chat") {
      const live = liveChats.get(tb.id);
      const st = chatStore.get(tb.id);
      const busy = !!st && statusOf(st) !== "idle";
      if (!(await confirmClosing(live ? [live.chat] : [], busy ? t("code.ws.closeBusy", { title: tb.title }) : t("code.ws.closeAsk", { title: tb.title }), { ok: t("code.ws.closeAnyway"), danger: true, ask: busy, workspaceId: ws.id }))) return;
      if (busy) window.dispatchEvent(new CustomEvent("kabul:stop-chat", { detail: tb.id }));
    }
    if (tb) closedRef.current = [...closedRef.current.slice(-9), tb];
    if (tb?.kind === "chat") setTimeout(() => chatStore.forget(tb.id), 0);
    const next = tabs.filter((_, k) => k !== i);
    setTabs(next.length ? next : [{ kind: "chat", id: newChatId(), title: t("common.newChat") }]);
    setActiveTab(Math.max(0, activeTab >= i ? activeTab - 1 : activeTab));
  };
  // Sem mudança, devolve o mesmo array: a aba avisa busy/waiting/título a cada efeito, e um array novo re-renderizaria o workspace à toa.
  const patchTab = (id: string, p: Partial<CenterTab>) =>
    setTabs((ts) => {
      const i = ts.findIndex((tb) => tb.kind === "chat" && tb.id === id);
      if (i < 0 || Object.entries(p).every(([k, v]) => (ts[i] as Record<string, unknown>)[k] === v)) return ts;
      return ts.map((tb, j) => (j === i ? ({ ...tb, ...p } as CenterTab) : tb));
    });

  // Atalhos do workspace: ⌘T conversa nova, ⌘W fecha aba, ⌘J terminal, ⌘⇧P PR, ⌘⇧[ ⌘⇧] trocam aba.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      // ⌃Tab / ⌃⇧Tab: próxima / anterior aba.
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") return (e.preventDefault(), setActiveTab((a) => (a + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length));
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "d" && !e.shiftKey && !e.altKey) {
        // ⌘D: divide com a próxima aba (ou desfaz a divisão).
        e.preventDefault();
        if (split) return setSplit(null);
        if (tabs.length > 1) return splitWith((activeTab + 1) % tabs.length);
        return;
      }
      if (k === "t" && !e.shiftKey) (e.preventDefault(), open({ kind: "chat", id: newChatId(), title: t("common.newChat") }));
      else if (k === "t" && e.shiftKey) {
        // ⌘⇧T reabre a última aba fechada (sem nenhuma, abre um terminal).
        e.preventDefault();
        const last = closedRef.current.pop();
        if (last) open(last);
        else newTerminalTab();
      }
      else if (k === "w" && !e.shiftKey) (e.preventDefault(), closeTab(activeTab));
      else if (k === "j" && !e.shiftKey) (e.preventDefault(), setBottomOpen((b) => !b));
      else if (e.code === "KeyB" && e.shiftKey && !e.altKey) (e.preventDefault(), open({ kind: "browser" }));
      else if (k === "p" && e.shiftKey) (e.preventDefault(), openPr());
      else if (k === "p" && !e.shiftKey && !e.altKey) (e.preventDefault(), setFinder("open"));
      else if (k === "f" && e.shiftKey && !e.altKey) (e.preventDefault(), setFinder("grep"));
      else if (e.shiftKey && (e.key === "]" || e.key === "}")) (e.preventDefault(), setActiveTab((a) => (a + 1) % tabs.length));
      else if (e.shiftKey && (e.key === "[" || e.key === "{")) (e.preventDefault(), setActiveTab((a) => (a - 1 + tabs.length) % tabs.length));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, tabs, activeTab, split]);

  // i18n-ignore: "Closes" é a palavra-chave do GitHub para fechar a issue
  const openPr = () => setPr((p) => (p ? null : { title: (ws.title || ws.branch.split("/").pop() || ws.name).replace(/-/g, " "), body: ws.linear ? `Closes ${ws.linear.identifier} (${ws.linear.url})` : "", draft: false, labels: [], stack_on: null, dry_run: false }));
  const submitPr = async () => {
    if (!pr) return;
    setPrBusy(true);
    try {
      setPrResult(await api.createPr(ws.id, pr));
      setPr(null);
      onChange();
    } catch (e) {
      onError(String(e));
    } finally {
      setPrBusy(false);
    }
  };

  const saveEdit = async () => {
    try {
      if (editing === "title") await api.updateWorkspace(ws.id, { title: draft });
      if (editing === "branch" && draft !== ws.branch) await api.renameBranch(ws.id, draft);
      onChange();
    } catch (e) {
      onError(String(e));
    }
    setEditing(null);
  };

  // Fork para nova aba, plano passado para conversa nova, arquivo aberto por link do chat.
  useEffect(() => {
    const forkTab = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.ws !== ws.id) return;
      const id = newChatId();
      pendingFork[id] = d.fork;
      open({ kind: "chat", id, title: t("code.ws.fork") });
    };
    const forkWs = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const id = newChatId();
      pendingFork[id] = d.fork;
      pendingForkWs[d.ws] = { chatId: id };
    };
    const newWith = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.ws !== ws.id) return;
      const id = newChatId();
      if (d.model) pendingModel[id] = d.model;
      open({ kind: "chat", id, title: d.title ?? t("code.ws.plan") });
      setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:send-chat", { detail: { chat: id, text: d.text } })), 600);
    };
    const openFile = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.ws !== ws.id) return;
      open(changes.some((c) => c.path === d.path) ? { kind: "diff", path: d.path } : { kind: "file", path: d.path });
    };
    // Terminal (⌘⇧B), deep link kabul://browser e paleta: traz a aba Browser (a URL vai pelo pendingBrowserUrl).
    const openB = (e: Event) => (e as CustomEvent).detail.ws === ws.id && open({ kind: "browser" });
    const ev: [string, (e: Event) => void][] = [["kabul:fork-tab", forkTab], ["kabul:fork-ws", forkWs], ["kabul:new-chat-with", newWith], ["kabul:open-file", openFile], ["kabul:browser-open", openB]];
    ev.forEach(([n, h]) => window.addEventListener(n, h));
    return () => ev.forEach(([n, h]) => window.removeEventListener(n, h));
  }, [ws.id, tabs, changes]);

  // Clique direito na aba de conversa.
  const [tabMenu, setTabMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  useDismiss(tabMenuRef, !!tabMenu, useCallback(() => setTabMenu(null), []));
  const copyTranscript = async (chatId: string) => {
    const rec = await api.historyLoad(ws.id, chatId).catch(() => null);
    const items = (rec?.items as { k: string; text?: string; name?: string }[]) ?? [];
    const text = items.map((i) => (i.k === "user" ? `## ${t("code.ws.transcript.user")}\n\n${i.text}` : i.k === "assistant" ? `## ${t("code.ws.transcript.agent")}\n\n${i.text}` : i.k === "tool" ? `_(${t("code.ws.transcript.tool", { name: i.name ?? "" })})_` : "")).filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
  };
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyC") {
        const tb = tabs[activeTab];
        if (tb?.kind === "chat") (e.preventDefault(), copyTranscript(tb.id));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, tabs, activeTab]);

  // Primeira mensagem do modal de criação: envia na conversa ou cria a sessão de nuvem.
  useEffect(() => {
    const p = pendingFirst[ws.id];
    if (!p || !tabs.length) return;
    delete pendingFirst[ws.id];
    if (p.where === "provider_cloud") {
      api.cloudStart(ws.id, p.text, null).then((r) => (cloudAdd(ws.id, { tmux: r.tmux, info: r.info, created: Date.now() }), open({ kind: "cloud", tmux: r.tmux, info: r.info })), (e) => onError(String(e)));
    } else {
      const chat = tabs.find((tb) => tb.kind === "chat") as { id: string } | undefined;
      if (chat) setTimeout(() => window.dispatchEvent(new CustomEvent(p.send ? "kabul:send-chat" : "kabul:compose-chat", { detail: { chat: chat.id, text: p.text, plan: p.plan } })), 400);
    }
  }, [tabs.length, ws.id]);

  // Texto para o agente vindo de outra aba (comentários do diff): volta para a última conversa.
  const [lastChat, setLastChat] = useState<string | null>(null);
  useEffect(() => {
    const tb = tabs[activeTab];
    if (tb?.kind === "chat") setLastChat(tb.id);
  }, [tabs, activeTab]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { ws: string; text: string };
      if (d.ws !== ws.id) return;
      const i = Math.max(0, tabs.findIndex((tb) => tb.kind === "chat" && tb.id === lastChat));
      const target = tabs[i];
      if (target?.kind !== "chat") return;
      setActiveTab(i);
      setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:compose-chat", { detail: { chat: target.id, text: d.text } })), 0);
    };
    const send = (e: Event) => {
      const d = (e as CustomEvent).detail as { ws: string; text: string };
      if (d.ws !== ws.id) return;
      const i = Math.max(0, tabs.findIndex((tb) => tb.kind === "chat" && tb.id === lastChat));
      const target = tabs[i];
      if (target?.kind !== "chat") return;
      setActiveTab(i);
      setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:send-chat", { detail: { chat: target.id, text: d.text } })), 0);
    };
    window.addEventListener("kabul:compose", h);
    window.addEventListener("kabul:agent", send);
    return () => (window.removeEventListener("kabul:compose", h), window.removeEventListener("kabul:agent", send));
  }, [tabs, lastChat, ws.id]);

  // Aba Browser pedida (deep link, terminal) antes de o workspace montar: abre quando as abas chegarem.
  useEffect(() => void (tabs.length && pendingBrowserUrl[ws.id] && open({ kind: "browser" })), [tabs.length, ws.id]);
  // Conversa pedida de fora (painel Agentes) antes de o workspace montar.
  useEffect(() => {
    const want = pendingActivate[ws.id];
    if (!want || !tabs.length) return;
    const i = tabs.findIndex((tb) => tb.kind === "chat" && tb.id === want);
    if (i >= 0) (delete pendingActivate[ws.id], setActiveTab(i));
  }, [tabs, ws.id]);
  // Aba que entra na frente deixa de ser "não lida".
  const front = tabs[activeTab];
  useEffect(() => void (active && front?.kind === "chat" && chatStore.markUnread(front.id, false)), [active, front]);
  // Ações vindas da paleta (⌘K) e o modo zen.
  const actRef = useRef<(a: string) => void>(() => {});
  actRef.current = (a: string) => {
    if (a === "quick-open") setFinder("open");
    else if (a === "search-files") setFinder("grep");
    else if (a === "show-changes") (setRight("changes"), setRightOpen(true));
    else if (a === "show-checks") (setRight("checks"), setRightOpen(true));
    else if (a === "toggle-right") toggleRight();
    else if (a === "new-chat") open({ kind: "chat", id: newChatId(), title: t("common.newChat") });
    else if (a === "new-terminal") newTerminalTab();
    else if (a === "open-browser") open({ kind: "browser" });
    else runGit(a as GitActionId);
  };
  useEffect(() => {
    const h = (e: Event) => (e as CustomEvent).detail.ws === ws.id && actRef.current((e as CustomEvent).detail.action);
    const zen = (e: Event) => setRightOpen((e as CustomEvent).detail ? false : localStorage.getItem("kabul.rightPanel") !== "0");
    window.addEventListener("kabul:ws-action", h);
    window.addEventListener("kabul:zen-state", zen);
    return () => (window.removeEventListener("kabul:ws-action", h), window.removeEventListener("kabul:zen-state", zen));
  }, [ws.id]);
  // Painel de recursos: a aba da conversa clicada vem para a frente.
  useEffect(() => {
    const activate = (e: Event) => { const i = tabs.findIndex((tb) => "id" in tb && tb.id === (e as CustomEvent).detail); if (i >= 0) setActiveTab(i); };
    window.addEventListener("kabul:activate-tab", activate);
    return () => window.removeEventListener("kabul:activate-tab", activate);
  }, [tabs]);
  // ⌥⌘B alterna o painel direito.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.metaKey && e.altKey && e.code === "KeyB" && (e.preventDefault(), toggleRight());
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active]);
  const target = git.status?.target || ws.target_branch || repo.default_branch;
  /** Manda um prompt ao agente (na última conversa); `compose` só preenche o campo. */
  const toAgent = (text: string, send = true) => window.dispatchEvent(new CustomEvent(send ? "kabul:agent" : "kabul:compose", { detail: { ws: ws.id, text } }));
  const appSet = useSettings();
  // Revisar (⌘⇧R): com "Modelo da revisão" escolhido, abre uma conversa nova com ele.
  // Prompts do repo lidos na hora (acabaram de ser editados em Configurações › Ações?).
  const prompts = () => api.repoSettings(repo.id).then((r) => r.settings.prompts ?? null, () => git.prompts);
  const review = async () => {
    const text = buildPrompt("review", await prompts(), { target });
    if (appSet?.review_model) window.dispatchEvent(new CustomEvent("kabul:new-chat-with", { detail: { ws: ws.id, text, model: appSet.review_model, title: t("code.ws.reviewTab") } }));
    else toAgent(text);
  };
  const direct = async (label: string, f: () => Promise<import("../api").Outcome>, id: GitActionId) => {
    git.setBusy(id);
    try {
      git.setResult({ ...(await f()), label });
      git.refresh();
      onChange();
    } catch (e) {
      onError(String(e));
    } finally {
      git.setBusy(null);
    }
  };
  const runGit = async (a: GitActionId) => {
    const why = availability(git)[a];
    if (why && a !== "create-pr" && a !== "review" && a !== "archive") return onError(`${a}: ${why}`);
    switch (a) {
      case "commit": return toAgent(buildPrompt("commit", await prompts(), { target }));
      case "pull": return direct(t("code.action.pull"), () => api.gitPull(ws.id), a);
      case "push": return direct(t("code.action.push"), () => api.gitPush(ws.id), a);
      case "create-pr": return openPr();
      case "create-pr-agent": return toAgent(buildPrompt("create_pr", await prompts(), { target }));
      case "ready": return direct(t("code.action.ready"), () => api.prReady(ws.id), a);
      case "merge":
        if (!(await confirmDialog(t("code.ws.mergeAsk", { number: git.pr?.number ?? "", base: git.pr?.base ?? "" }), { ok: t("code.action.merge") }))) return;
        return direct(t("code.action.merge"), () => api.prMerge(ws.id), a);
      case "fix": {
        git.setBusy(a);
        const bad = failing(git.checks).slice(0, 3);
        const logs = await Promise.all(bad.map((c) => api.checkLog(ws.id, c.link).then((l) => `### ${c.workflow ? c.workflow + " / " : ""}${c.name}
\`\`\`
${l.slice(-2500)}
\`\`\``, () => `### ${c.name}\n(${c.link})`)));
        git.setBusy(null);
        return toAgent(buildPrompt("fix_errors", await prompts(), { target, checks: logs.join("\n\n") }));
      }
      case "conflicts": return toAgent(buildPrompt("resolve_conflicts", await prompts(), { target, files: (git.status?.conflicts ?? []).map((f) => `- ${f}`).join("\n") || t("code.ws.seeGitStatus") }));
      case "open-pr": return git.pr && api.prOpenUrl(ws.id, git.pr.url).then((u) => api.openExternal(u), (e) => onError(String(e)));
      case "review": return review();
      case "comments": return toAgent(t("code.comment.replyAll") + "\n" + (git.pr?.comments ?? []).map(commentText).join("\n"), false);
      case "archive": return window.dispatchEvent(new CustomEvent("kabul:archive", { detail: ws.id }));
    }
  };
  // Atalhos do git: ⌘⇧Y commit e push, ⌘⇧L pull, ⌘⇧M merge, ⌘⇧X corrigir, ⌘⇧G abrir PR, ⌘⇧R revisar.
  useEffect(() => {
    if (!active) return;
    const map: Record<string, GitActionId> = { KeyY: "commit", KeyL: "pull", KeyM: "merge", KeyX: "fix", KeyG: "open-pr", KeyR: "review" };
    const h = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey || e.altKey || e.ctrlKey || !map[e.code]) return;
      e.preventDefault();
      runGit(map[e.code]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const tab = tabs[activeTab] ?? tabs[0];
  const shownChanges = changes.filter((c) => c.path.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className={"ws-layout" + (rightOpen ? "" : " no-right")} style={{ ["--right-w" as string]: `${rightSize.size}px`, ["--bottom-h" as string]: `${bottomSize.size}px` }}>
      <section className="center">
        <header className={"topbar center-top" + (sidebarHidden ? " lights" : "")} data-tauri-drag-region>
          <RepoIcon repo={repo} />
          <span className="crumb-repo">{repo.name}</span>
          <span className="crumb-sep">›</span>
          {editing === "branch" ? (
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} className="inline-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" && setEditing(null))} />
          ) : (
            <span className="crumb-branch" title={t("code.ws.dblRenameBranch")} onDoubleClick={() => (setEditing("branch"), setDraft(ws.branch))}>{ws.branch}</span>
          )}
          <div className="picker" ref={menuRef}>
            <button className={"icon-btn" + (menu ? " on" : "")} title={t("code.ws.moreActions")} onClick={() => setMenu(!menu)} data-testid="ws-menu"><IMore size={14} /></button>
            {menu && (
              <Floating className="status-pop ws-menu" placement="bottom-end">
                <div className="pop-row" onClick={() => (setMenu(false), setEditing("title"), setDraft(wsTitle(ws)))}>{t("code.ws.renameWs")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), setEditing("branch"), setDraft(ws.branch))}>{t("code.promptLabel.branch_rename")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(ws.branch))}>{t("code.ws.copyBranch")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(ws.path))}>{t("code.ws.copyPath")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(`kabul://workspace?id=${ws.id}`))} data-testid="ws-copy-link">{t("code.ws.copyLink")} <span className="grow" /><span className="kbd-hint">⌘⇧C</span></div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(`${wsTitle(ws)}\n${t("code.ws.info", { branch: ws.branch, target: ws.target_branch || repo.default_branch, path: ws.path, port: ws.port })}${ws.pr_url ? `\nPR: ${ws.pr_url}` : ""}`))}>{t("code.ws.copyInfo")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), api.updateWorkspace(ws.id, { unread: true }).then(onChange, (e) => onError(String(e))))}>{t("code.ws.markUnread")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), onOpenSettings(repo.id))}>{t("code.ws.repoSettings")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), toggleMirror())} data-testid="mirror-toggle">{mirror?.running ? t("code.ws.mirrorStop") : t("code.ws.mirrorStart")}</div>
                <div className="pop-row" onClick={() => (setMenu(false), setCloudDialog(true))}>{t("code.ws.newCloud")}</div>
                {access?.slug && <div className="pop-row" onClick={() => (setMenu(false), api.openExternal(`https://github.com/${access.slug}` /* i18n-ignore */))}>{t("code.openGithub")}</div>}
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={() => (setMenu(false), window.dispatchEvent(new CustomEvent("kabul:archive", { detail: ws.id })))}>{t("code.ws.archive")} <span className="grow" /><span className="kbd-hint">⌘⇧A</span></div>
              </Floating>
            )}
          </div>
          <span className="picker hdr-extra" ref={targetPop.ref}>
            <button className="crumb-target" title={t("code.gs.target")} onClick={() => (targetPop.toggle(), api.repoBranches(repo.id).then(setBranches, () => {}))} data-testid="target-branch">→ {ws.target_branch || repo.default_branch} <IChevronDown size={10} /></button>
            {targetPop.open && (
              <Floating className="status-pop target-pop" placement="bottom-start" testid="target-pop">
                <div className="pop-title">{t("code.gs.target")}</div>
                {[repo.default_branch, ...branches.map((b) => b.replace(/^origin\//, "")).filter((b, i, a) => b !== repo.default_branch && a.indexOf(b) === i && b !== ws.branch)].map((b) => (
                  <div key={b} className={"pop-row" + ((ws.target_branch || repo.default_branch) === b ? " on" : "")} onClick={() => (targetPop.close(), api.updateWorkspace(ws.id, { target_branch: b === repo.default_branch ? "" : b }).then(() => (onChange(), git.refresh(), loadRight()), (e) => onError(String(e))))} data-testid="target-row">{b}{b === repo.default_branch && <span className="dim small">{t("code.scripts.default")}</span>}</div>
                ))}
              </Floating>
            )}
          </span>
          <span className="crumb-sep hdr-extra">·</span>
          {mirror?.running && <button className="issue-chip mirror-chip" title={t("code.ws.mirrorTitle", { name: `kabul-${ws.name}` })} onClick={() => api.openExternal(mirror.link ?? "https://claude.ai/code")} data-testid="mirror-chip"><RunsOnBadge r={{ kind: "local", mirrored: true }} /> {t("code.ws.mirrored")}</button>}
          {editing === "title" ? (
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} className="inline-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" && setEditing(null))} />
          ) : (
            <span className="crumb-title hdr-extra" title={t("code.ws.dblRename")} onDoubleClick={() => (setEditing("title"), setDraft(wsTitle(ws)))}>{wsTitle(ws)}</span>
          )}
          {ws.linear && <button className="issue-chip" title={ws.linear.title} onClick={() => api.openExternal(ws.linear!.url)}>{ws.linear.identifier} ↗</button>}
          <div className="picker hdr-extra" ref={statusRef}>
            <button className={"status-pill st-" + ws.status} onClick={() => setStatusOpen(!statusOpen)} data-testid="status-pill">{STATUS_LABEL[ws.status] ?? ws.status} <IChevronDown size={10} /></button>
            {statusOpen && (
              <Floating className="status-pop" placement="bottom-start">
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <div key={k} className={"pop-row" + (k === ws.status ? " on" : "")} onClick={() => api.updateWorkspace(ws.id, { status: k }).then(() => (setStatusOpen(false), onChange()), (e) => onError(String(e)))}><span className={"dot st-" + k} /> {v}</div>
                ))}
              </Floating>
            )}
          </div>
          <button className={"icon-btn hdr-extra" + (ws.pinned ? " on" : "")} title={ws.pinned ? t("code.ws.unpin") : t("code.ws.pin")} onClick={() => api.updateWorkspace(ws.id, { pinned: !ws.pinned }).then(onChange, (e) => onError(String(e)))}><IPin size={14} /></button>

          <PrPill git={git} onOpen={() => runGit("open-pr")} />
          <span className="grow" data-tauri-drag-region />
          {!rightOpen && <GitButton git={git} onAction={runGit} compact />}
          <OpenIn path={ws.path} onError={onError} />
          <button className={"icon-btn" + (rightOpen ? " on" : "")} title={t("code.ws.togglePanel")} onClick={toggleRight} data-testid="toggle-right"><IPanel /></button>
        </header>
        <div className="tabstrip">
          {tabs.map((tb, i) => (
            <div key={tabKey(tb)} onContextMenu={(e) => tb.kind === "chat" && (e.preventDefault(), setTabMenu({ i, x: e.clientX, y: e.clientY }))} data-testid="ctab" className={"ctab" + (i === activeTab ? " on" : "")} onClick={() => (setActiveTab(i), tb.kind === "chat" && chatStore.markUnread(tb.id, false))}>
              {tb.kind === "chat" ? (
                <>
                  <TabStatus id={tb.id} />
                  {renamingTab === tb.id ? (
                    <input className="inline-edit ctab-edit" autoFocus defaultValue={tb.title} onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === "Enter") (patchTab(tb.id, { title: (e.target as HTMLInputElement).value || tb.title }), setRenamingTab(null)); if (e.key === "Escape") setRenamingTab(null); }}
                      onBlur={(e) => (patchTab(tb.id, { title: e.target.value || tb.title }), setRenamingTab(null))} data-testid="tab-rename-input" />
                  ) : <span className="ctab-title" onDoubleClick={() => setRenamingTab(tb.id)}>{tb.title}</span>}
                </>
              ) : tb.kind === "cloud" ? (
                <><RunsOnBadge r={cloudRunsOn({ tmux: tb.tmux, info: tb.info, created: 0 })} /><span className="ctab-title">{tb.info.title ?? t("code.ws.cloud")}</span></>
              ) : tb.kind === "term" ? (
                <><span className="ctab-title">{tb.title}</span></>
              ) : tb.kind === "browser" ? (
                <><IGlobe size={13} /><span className="ctab-title" data-testid="ctab-browser">{t("code.browser.tab")}</span></>
              ) : (
                <><IFile size={13} /><span className="ctab-title">{tb.path.split("/").pop()}{tb.kind === "diff" ? "" : t("code.ws.readOnly")}</span></>
              )}
              <button className="icon-btn" title={t("code.ws.closeTab")} onClick={(e) => { e.stopPropagation(); if (tb.kind === "cloud") cloudRemove(ws.id, tb.tmux); closeTab(i); }}><IClose size={12} /></button>
            </div>
          ))}
          <div className="picker ctab-add" ref={plusRef}>
            <button className={"icon-btn" + (plusMenu ? " on" : "")} title={t("code.ws.newTab")} onClick={() => setPlusMenu(!plusMenu)} data-testid="new-tab"><IPlus size={14} /></button>
            {plusMenu && (
              <Floating className="status-pop plus-pop" placement="bottom-start">
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "chat", id: newChatId(), title: t("common.newChat") }))} data-testid="new-chat">{t("common.newChat")} <span className="grow" /><span className="kbd-hint">⌘T</span></div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), newTerminalTab())} data-testid="new-term-tab">{t("code.ws.terminal")} <span className="grow" /><span className="kbd-hint">⌘⇧T</span></div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "browser" }))} data-testid="new-browser-tab">{t("code.browser.tab")} <span className="grow" /><span className="kbd-hint">⌘⇧B</span></div>
                <div className="pop-sep" />
                <div className="pop-title">{t("code.ws.runsWhere")}</div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "chat", id: newChatId(), title: t("common.newChat") }))}>{t("code.ws.thisMac")}</div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), setCloudDialog(true))} data-testid="new-cloud"><RunsOnBadge r={{ kind: "provider_cloud", provider: "claude" }} /> {t("code.ws.providerCloud")}</div>
                <div className="pop-row disabled" title={t("code.ws.soon")}><RunsOnBadge r={{ kind: "remote", host: "—" }} /> {t("code.ws.otherMachine")} <span className="grow" /><span className="dim small">{t("code.ws.soon")}</span></div>
                <div className="pop-row disabled" title={t("code.ws.soon")}><RunsOnBadge r={{ kind: "kabul_cloud", host: "—" }} /> {t("code.ws.kabulCloud")} <span className="grow" /><span className="dim small">{t("code.ws.soon")}</span></div>
              </Floating>
            )}
          </div>
        </div>
        <div className={"center-panes" + (splitIdx >= 0 ? " split" : "")} style={{ ["--split" as string]: `${split?.pct ?? 50}%` }}>
        {/* Só as abas na tela ficam montadas: as outras conversas seguem no registro (status e contadores) e
            remontam com o estado guardado; os terminais guardam a instância do xterm. */}
        {tabs.map((tb, i) =>
          tb.kind === "chat" && (i === activeTab || i === splitIdx) ? (
            <div key={tb.id} className={paneClass(i)}>
              <ChatTab ws={ws} sessionId={tb.id} active={active && i === activeTab} onError={onError} onWorkspaceChange={onChange}
                onTitle={(title) => patchTab(tb.id, { title })} />
            </div>
          ) : null,
        )}
        {tabs.map((tb, i) => (i !== activeTab && i !== splitIdx) ? null : tb.kind === "cloud" ? (
          <div key={tb.tmux} className={paneClass(i)}><CloudTab ws={ws} tmux={tb.tmux} initial={tb.info} onError={onError} onTeleport={(session) => open({ kind: "term", session, title: t("code.ws.teleport", { id: tb.info.id?.slice(-6) ?? "" }) })} /></div>
        ) : tb.kind === "term" ? (
          <div key={tb.session} className={paneClass(i)}><TerminalTab ws={ws} session={tb.session} visible initialCommand={tb.preset} gpu onError={onError} /></div>
        ) : tb.kind === "browser" ? (
          <div key="browser" className={paneClass(i)}><BrowserTab ws={ws} active={active && (i === activeTab || i === splitIdx)} onError={onError} /></div>
        ) : null)}
        {tab?.kind === "diff" && <div className="center-body"><FileDiff ws={ws} path={tab.path} scope={scope} files={changes.map((c) => c.path)} active={active} onNavigate={(p) => open({ kind: "diff", path: p })} onError={onError} /></div>}
        {tab?.kind === "file" && <div className="center-body"><FileView key={tab.path + (tab.line ?? "")} ws={ws} path={tab.path} line={tab.line} onError={onError} /></div>}
          {splitIdx >= 0 && (
            <div className="split-divider" role="separator" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={split!.pct} tabIndex={0} title={t("code.ws.splitHint")}
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") (e.preventDefault(), setSplit((sp) => sp && { ...sp, pct: Math.min(80, Math.max(20, sp.pct + (e.key === "ArrowLeft" ? -2 : 2))) })); }}
              onDoubleClick={() => setSplit(null)}
              onPointerDown={(e) => {
                const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const move = (ev: PointerEvent) => setSplit((sp) => sp && { ...sp, pct: Math.min(80, Math.max(20, Math.round(((ev.clientX - box.left) / box.width) * 100))) });
                const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }} data-testid="split-divider">
              <button className="icon-btn split-close" title={t("code.ws.unsplitTitle")} onClick={() => setSplit(null)} data-testid="split-close">×</button>
            </div>
          )}
        </div>
      </section>
      {tabMenu && tabs[tabMenu.i]?.kind === "chat" && (() => {
        const tb = tabs[tabMenu.i] as Extract<CenterTab, { kind: "chat" }>;
        return (
          createPortal(<div ref={tabMenuRef} className="popover status-pop tab-ctx" style={{ position: "fixed", left: tabMenu.x, top: tabMenu.y }} data-testid="tab-menu">
            <div className="pop-row" onClick={() => (setRenamingTab(tb.id), setTabMenu(null))} data-testid="tab-rename">{t("common.rename")}</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), window.dispatchEvent(new CustomEvent("kabul:fork-last", { detail: { chat: tb.id } })))} data-testid="tab-fork">{t("code.ws.forkTab")} <span className="grow" /><span className="kbd-hint">⌘⌥↵</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), copyTranscript(tb.id))} data-testid="tab-copy">{t("code.ws.copyTranscript")} <span className="grow" /><span className="kbd-hint">⌘⌥C</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), chatStore.markUnread(tb.id, !chatStore.get(tb.id)?.unread))}>{chatStore.get(tb.id)?.unread ? t("code.ws.markRead") : t("code.ws.markUnreadChat")}</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), navigator.clipboard.writeText(`kabul://workspace?id=${ws.id}&session=${tb.id}`))} data-testid="tab-copy-link">{t("code.ws.copyLink")}</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), api.historyLoad(ws.id, tb.id).then((r) => navigator.clipboard.writeText(`${r.title}\n${t("code.ws.chatInfo", { id: tb.id, model: r.model_key ?? "-", session: r.agent_session ?? "-" })}`), () => {}))}>{t("code.ws.copyChatInfo")}</div>
            <div className="pop-sep" />
            <div className="pop-row" onClick={() => (setTabMenu(null), closeTab(tabMenu.i))}>{t("common.close")} <span className="grow" /><span className="kbd-hint">⌘W</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), split && split.key === tb.id ? setSplit(null) : splitWith(tabMenu.i))} data-testid="tab-split">{split && split.key === tb.id ? t("code.ws.unsplit") : t("code.ws.splitRight")} <span className="grow" /><span className="kbd-hint">⌘D</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), setTabs([tb]), setActiveTab(0))} data-testid="tab-close-others">{t("code.ws.closeOthers")}</div>
          </div>, document.body)
        );
      })()}
      {finder === "open" && <QuickOpen ws={ws} onClose={() => setFinder(null)} onOpen={(p) => open(changes.some((c) => c.path === p) ? { kind: "diff", path: p } : { kind: "file", path: p })} />}
      {finder === "grep" && <SearchFiles ws={ws} onClose={() => setFinder(null)} onOpen={(p, line) => open({ kind: "file", path: p, line })} />}
      {fileCtx && (
        createPortal(<div ref={fileCtxRef} className="popover status-pop file-ctx" style={{ left: fileCtx.x, top: fileCtx.y }} data-testid="file-menu">
          <div className="pop-row" onClick={() => (setFileCtx(null), open(fileCtx.changed ? { kind: "diff", path: fileCtx.path } : { kind: "file", path: fileCtx.path }))}>{t("code.ws.view")}</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), api.openIn(localStorage.getItem("kabul.openIn.default") || "finder", `${ws.path}/${fileCtx.path}`).catch((e) => onError(String(e))))} data-testid="file-open-in">{t("code.ws.openDefault")}</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), api.openIn("finder", `${ws.path}/${fileCtx.path.includes("/") ? fileCtx.path.slice(0, fileCtx.path.lastIndexOf("/")) : ""}`).catch((e) => onError(String(e))))}>{t("code.ws.showFinder")}</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), toAgent(`@${fileCtx.path} `, false))} data-testid="file-attach">{t("code.ws.attach")}</div>
          <div className="pop-sep" />
          <div className="pop-row" onClick={() => (setFileCtx(null), navigator.clipboard.writeText(`${ws.path}/${fileCtx.path}`))} data-testid="file-copy-path">{t("code.ws.copyPath")}</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), navigator.clipboard.writeText(fileCtx.path))} data-testid="file-copy-rel">{t("code.ws.copyRelPath")}</div>
          {fileCtx.changed && <><div className="pop-sep" /><div className="pop-row danger" onClick={async () => { const p = fileCtx.path; setFileCtx(null); if (await confirmDialog(t("code.ws.discardAsk", { path: p }), { ok: t("code.ws.discard"), danger: true })) api.discard(ws.id, p).then(loadRight, (e) => onError(String(e))); }} data-testid="file-discard">{t("code.ws.discardMenu")}</div></>}
        </div>, document.body)
      )}
      {cloudDialog && <CloudDialog ws={ws} onError={onError} onClose={() => setCloudDialog(false)} onCreated={(tmux, info) => (setCloudDialog(false), cloudAdd(ws.id, { tmux, info, created: Date.now() }), open({ kind: "cloud", tmux, info }))} />}

      {rightOpen && <Resizer axis="x" dir={-1} {...rightSize} onSize={rightSize.setSize} onCollapse={toggleRight} testid="resize-right" />}
      <aside className="right" hidden={!rightOpen}>
        <header className="topbar right-top" data-tauri-drag-region>
          {ws.pr_url && <button className="text-btn small" onClick={() => api.openExternal(ws.pr_url!)}>{t("code.ws.prOpen")}</button>}
          <div className="grow" />
          <div ref={prRef}>{rightOpen && <GitButton git={git} onAction={runGit} />}</div>
          {pr && (
            <Floating className="pr-pop" placement="bottom-end" testid="pr-form" onKeyDown={(e) => e.key === "Escape" && setPr(null)}>
              <div className="pop-title">{tNode("code.ws.prTo", { target: <code>{pr.stack_on ? `PR #${pr.stack_on}` : ws.target_branch || repo.default_branch}</code> })}</div>
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} placeholder={t("code.ws.prTitle")} autoFocus />
              <textarea rows={4} value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} placeholder={t("code.ws.prBody")} />
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.labels.join(", ")} onChange={(e) => setPr({ ...pr, labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={t("code.ws.prLabels")} />
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.stack_on ?? ""} onChange={(e) => setPr({ ...pr, stack_on: e.target.value ? Number(e.target.value) || null : null })} placeholder={t("code.ws.prStack")} />
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={pr.draft} onChange={(e) => setPr({ ...pr, draft: e.target.checked })} /> {t("code.ws.prDraft")}</label>
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={pr.dry_run} onChange={(e) => setPr({ ...pr, dry_run: e.target.checked })} /> {t("code.ws.prDryRun")}</label>
              <div className="row end"><button className="btn" onClick={() => setPr(null)}>{t("common.cancel")}</button><button className="btn primary" disabled={prBusy || !pr.title.trim()} onClick={submitPr}>{prBusy ? t("code.ws.prSending") : pr.dry_run ? t("code.ws.prSimulate") : t("code.ws.prPushCreate")}</button></div>
            </Floating>
          )}
        </header>
        <div className="rtabs">
          <button className={"rtab" + (right === "all" ? " on" : "")} onClick={() => setRight("all")}>{t("code.ws.files")}</button>
          <button className={"rtab" + (right === "changes" ? " on" : "")} onClick={() => setRight("changes")}>{t("code.ws.changes")} <span className="count">{changes.length}</span></button>
          <button className={"rtab" + (right === "checks" ? " on" : "")} onClick={() => setRight("checks")} data-testid="tab-checks">{t("code.checks.title")}{failing(git.checks).length ? <span className="count error">{failing(git.checks).length}</span> : null}</button>
          <span className="grow" />
          <button className="text-btn small review-btn" title={t("code.ws.reviewTitle")} onClick={review} data-testid="review"><IEye size={13} /> <span className="txt">{t("code.action.review")}</span></button>
          <button className={"icon-btn" + (right === "checkpoints" ? " on" : "")} title={t("code.ws.checkpoints")} onClick={() => setRight("checkpoints")} data-testid="tab-checkpoints"><IHistory size={14} /></button>
        </div>
        {access && !access.ok && access.message && <div className="gh-warn" data-testid="gh-warn">{trError(access.message)} <a onClick={() => window.dispatchEvent(new CustomEvent("kabul:route", { detail: { kind: "settings", tab: "contas" } }))}>{t("code.ws.accountsGithub")}</a></div>}
        {prResult && (
          <div className="pr-done" data-testid="pr-result">
            {prResult.url ? <>{t("code.ws.prCreated")} <a onClick={() => api.openExternal(prResult.url!)}>{prResult.url.replace("https://github.com/" /* i18n-ignore */, "")}</a></> : <>{t("code.ws.simulation")} <pre>{prResult.commands.join("\n")}</pre></>}
            <button className="icon-btn" onClick={() => setPrResult(null)}><IClose size={11} /></button>
          </div>
        )}
        <div className="files">
          {right === "changes" && (
            <div className="changes-head">
              <select value={scope} onChange={(e) => (setScope(e.target.value as DiffScope), localStorage.setItem("kabul.diff.scope", e.target.value))} title={t("code.ws.diffScope")} data-testid="diff-scope">
                <option value="all">{t("code.ws.scope.all")}</option><option value="branch">{t("code.ws.scope.branch")}</option><option value="uncommitted">{t("code.ws.scope.uncommitted")}</option>
              </select>
              <input {...noSuggest} autoComplete="off" placeholder={t("code.ws.filterFiles")} value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="changes-filter" />
              <button className="icon-btn" title={changesView === "list" ? t("code.ws.viewTree") : t("code.ws.viewList")} onClick={() => setChangesView((v) => { const n = v === "list" ? "tree" : "list"; localStorage.setItem("kabul.changes.view", n); return n; })} data-testid="changes-view">{changesView === "list" ? <IFolder size={14} /> : <IFile size={13} />}</button>
            </div>
          )}
          {right === "changes" && changesView === "tree" && <FileTree files={changes.map((c) => c.path).filter((p) => p.toLowerCase().includes(filter.toLowerCase()))} expanded onOpen={(f) => open({ kind: "diff", path: f })} onContext={(f, e) => setFileCtx({ path: f, x: e.clientX, y: e.clientY, changed: true })} />}
          {right === "changes" && changesView === "list" && (changes.length === 0 ? <div className="files-empty">{scope === "uncommitted" ? t("code.ws.noChanges.uncommitted") : scope === "branch" ? t("code.ws.noChanges.branch") : tNode("code.ws.noChanges.all", { target: <code>{ws.target_branch || repo.default_branch}</code> })}</div> : <LazyChunks count={shownChanges.length} chunk={150} rowPx={30} render={(a, b) => shownChanges.slice(a, b).map((c) => {
            const dir = c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/") + 1) : "";
            return (
              <div key={c.path} className={"file-row" + (viewedMap(ws.id)[c.path] ? " viewed" : "")} onClick={() => open({ kind: "diff", path: c.path })} onContextMenu={(e) => (e.preventDefault(), setFileCtx({ path: c.path, x: e.clientX, y: e.clientY, changed: true }))} data-testid="change-row">
                <span className="fpath"><span className="dim">{dir}</span>{c.path.slice(dir.length)}</span>
                <span className="grow" />
                {c.added ? <span className="add">+{c.added}</span> : null}
                {c.removed ? <span className="del">-{c.removed}</span> : null}
                {c.untracked && <span className="badge-new">{t("code.ws.new")}</span>}
              </div>
            );
          })} />)}
          {right === "all" && <FileTree files={allFiles} onOpen={(f) => open({ kind: "file", path: f })} onContext={(f, e) => setFileCtx({ path: f, x: e.clientX, y: e.clientY, changed: changes.some((c) => c.path === f) })} />}
          {right === "checks" && <ChecksPanel ws={ws} git={git} onAction={runGit} onToChat={(text) => toAgent(text, false)} onError={onError} />}
          {right === "checkpoints" && (checkpoints.length === 0 ? <div className="files-empty">{t("code.ws.checkpointsEmpty")}</div> : checkpoints.map((c) => (
            <div key={c.id} className="file-row">
              <span className="fpath">{c.message}</span><span className="grow" />
              <span className="dim small">{fmtDate(c.created_at * 1000, "time")}</span>
              <button className="icon-btn" title={t("code.ws.restore")} onClick={() => confirmDialog(t("code.ws.restoreAsk", { message: c.message })).then((ok) => void (ok && api.restoreCheckpoint(ws.id, c.id).then(loadRight, (e) => onError(String(e)))))}><IRestore size={13} /></button>
            </div>
          )))}
        </div>
        {bottomOpen && <Resizer axis="y" dir={-1} {...bottomSize} onSize={bottomSize.setSize} onCollapse={() => setBottomOpen(false)} testid="resize-bottom" />}
        <div className={"bottom" + (bottomOpen ? "" : " closed")}>
          <div className="btabs">
            <button className="icon-btn" title={t("code.ws.toggleBottom")} onClick={() => setBottomOpen(!bottomOpen)}><IChevronDown size={13} /></button>
            {(["setup", "run", "terminal"] as Bottom[]).map((b) => (
              <button key={b} className={"btab" + (bottom === b ? " on" : "")} onClick={() => (setBottom(b), setBottomOpen(true))}>{{ setup: t("code.ws.btab.setup"), run: t("code.ws.btab.run"), terminal: t("code.ws.terminal") }[b as "setup"]}</button>
            ))}
            {extraTerms.map((n) => (
              <button key={n} className={"btab" + (bottom === `t${n}` ? " on" : "")} onClick={() => (setBottom(`t${n}`), setBottomOpen(true))}>
                {t("code.ws.terminalN", { n })}<span className="btab-x" title={t("common.close")} onClick={(e) => { e.stopPropagation(); api.stopScript(`kabul-${ws.name}-t${n}`).catch(() => {}); setExtraTerms((x) => x.filter((y) => y !== n)); setBottom("terminal"); }}>×</span>
              </button>
            ))}
            <button className="icon-btn" title={t("code.ws.newTerminal")} data-testid="new-terminal" onClick={() => { const n = Math.max(1, ...extraTerms) + 1; setExtraTerms((x) => [...x, n]); setBottom(`t${n}`); setBottomOpen(true); }}><IPlus size={13} /></button>
            <span className="grow" />
            <span className="dim small" title={t("code.ws.ports")}>:{ws.port}</span>
          </div>
          {bottomOpen && (
            <>
              {bottom === "terminal" && <div className="bottom-body"><TerminalTab ws={ws} visible onError={onError} /></div>}
              {extraTerms.map((n) => bottom === `t${n}` && <div key={n} className="bottom-body"><TerminalTab ws={ws} session={`kabul-${ws.name}-t${n}`} visible onError={onError} /></div>)}
              {bottom === "setup" && <div className="bottom-body"><ScriptsPane ws={ws} repo={repo} which="setup" onError={onError} onConfigure={() => onOpenSettings(repo.id)} /></div>}
              {bottom === "run" && <div className="bottom-body"><ScriptsPane ws={ws} repo={repo} which="run" onError={onError} onConfigure={() => onOpenSettings(repo.id)} /></div>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
});
