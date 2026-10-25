import { createPortal } from "react-dom";
import { confirmClosing, confirmDialog, liveChats } from "../components/Confirm";
import { Floating } from "../components/Floating";
import { noSuggest } from "../noSuggest";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDismiss, usePopover } from "../components/useDismiss";
import { api, STATUS_LABEL, wsTitle, type Checkpoint, type FileChange, type PrOptions, type PrResult, type Repo, type Workspace } from "../api";
import { ChatTab } from "./ChatTab";
import { TerminalTab } from "./TerminalLazy";
import { FileDiff, FileView, viewedMap } from "./FileDiff";
import type { DiffScope } from "../api";
import { ScriptsPane } from "./ScriptsPane";
import { IChevronDown, IClose, IEye, IFile, IFolder, IHistory, IMore, IPanel, IPin, IPlus, IRestore, RepoMark } from "../icons";
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

type CenterTab = { kind: "chat"; id: string; title: string } | { kind: "cloud"; tmux: string; info: CloudInfo } | { kind: "term"; session: string; title: string; preset?: string } | { kind: "diff"; path: string } | { kind: "file"; path: string; line?: number };
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
  return s.status === "working" ? <span className="spinner tiny" /> : s.status === "queued" ? <span className="agent-dot queued" title={`Aguardando vaga (${s.queue ?? "?"}º)`} data-testid="tab-queued" /> : s.status === "waiting" ? <span className="agent-dot waiting" title="Esperando você" /> : s.unread ? <span className="unread-dot" /> : null;
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
        const last = tabs.find((t) => t.kind === "chat") as { id: string } | undefined;
        const rec = last ? await api.historyLoad(ws.id, last.id).catch(() => null) : null;
        setMirror(await api.mirrorStart(ws.id, rec?.agent_session ?? null));
      }
    } catch (e) {
      onError(String(e));
    }
  };
  const newTerminalTab = async () => {
    const n = tabs.filter((t) => t.kind === "term").length + 1;
    const session = `kabul-${ws.name}-tab${n}`;
    const preset = termPreset();
    open({ kind: "term", session, title: preset ? `${preset.split(" ")[0]} ${n}` : `Terminal ${n}`, preset });
  };

  useEffect(() => (mountedWs.add(ws.id), () => void mountedWs.delete(ws.id)), [ws.id]);
  // Sessões salvas viram abas; se não houver, uma conversa nova.
  useEffect(() => {
    // Remontando com a tela guardada: só acrescenta a aba de um "continuar"/fork pedido enquanto estava fora.
    if (mem) {
      const pfw = pendingForkWs[ws.id];
      if (pfw) (delete pendingForkWs[ws.id], setTabs((t) => [...t, { kind: "chat", id: pfw.chatId, title: "Fork" }]), setActiveTab(mem.tabs.length));
      return;
    }
    api.historyList(ws.id).then((h) => {
      const pfw = pendingForkWs[ws.id];
      if (pfw) delete pendingForkWs[ws.id];
      const chats: CenterTab[] = pfw ? [{ kind: "chat", id: pfw.chatId, title: "Fork" }] : h.length ? h.slice(0, 6).reverse().map((s) => ({ kind: "chat", id: s.id, title: s.title })) : [{ kind: "chat", id: newChatId(), title: "Nova conversa" }];
      // Sessões de nuvem reabertas como abas ☁︎.
      setTabs([...chats, ...cloudList(ws.id).slice(0, 4).map((c) => ({ kind: "cloud" as const, tmux: c.tmux, info: c.info }))]);
      setActiveTab(0);
    }, () => setTabs([{ kind: "chat", id: newChatId(), title: "Nova conversa" }]));
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
    const t = setInterval(loadRight, 4000);
    return () => clearInterval(t);
  }, [loadRight, active]);

  const open = (t: CenterTab) => {
    const key = (x: CenterTab) => (x.kind === "chat" ? x.id : x.kind === "cloud" ? x.tmux : x.kind === "term" ? x.session : x.path);
    const i = tabs.findIndex((x) => x.kind === t.kind && key(x) === key(t));
    if (i >= 0) return (setActiveTab(i), t.kind === "file" && setTabs((ts) => ts.map((x, k) => (k === i ? t : x))));
    // Um diff por vez: abrir outro arquivo troca o caminho da aba de diff existente.
    const di = t.kind === "diff" ? tabs.findIndex((x) => x.kind === "diff") : -1;
    if (di >= 0) return (setTabs((ts) => ts.map((x, k) => (k === di ? t : x))), setActiveTab(di));
    setTabs([...tabs, t]);
    setActiveTab(tabs.length);
  };
  // Abas divididas: a aba ativa à esquerda e `split.key` à direita, cada lado de 20% a 80%.
  const [split, setSplit] = useState<{ key: string; pct: number } | null>(mem?.split ?? null);
  // Guarda a tela ao desmontar (lido na hora: os valores mais recentes).
  const saveRef = useRef<() => WsMemory>(() => null as never);
  saveRef.current = () => ({ tabs, activeTab, split, right, bottom, bottomOpen, extraTerms, filter, rightOpen });
  useLayoutEffect(() => () => void wsMemory.set(ws.id, saveRef.current()), [ws.id]);
  const tabKey = (x: CenterTab) => (x.kind === "chat" ? x.id : x.kind === "cloud" ? x.tmux : x.kind === "term" ? x.session : x.kind + x.path);
  const splitIdx = split ? tabs.findIndex((x) => tabKey(x) === split.key) : -1;
  const splitWith = (i: number) => {
    const t = tabs[i];
    if (!t) return;
    if (i === activeTab) {
      const other = tabs.findIndex((_, j) => j !== i);
      if (other < 0) return;
      setActiveTab(other);
    }
    setSplit({ key: tabKey(t), pct: 50 });
  };
  const paneClass = (i: number) => "center-body" + (splitIdx >= 0 && i === activeTab ? " pane-left" : splitIdx >= 0 && i === splitIdx ? " pane-right" : "");
  const closedRef = useRef<CenterTab[]>([]);
  const closeTab = async (i: number) => {
    const t = tabs[i];
    // Fechar uma conversa com o agente trabalhando pede confirmação e para o agente.
    // Também lista os processos que o agente abriu (servidores etc.): continuam rodando, salvo os marcados.
    if (t?.kind === "chat") {
      const live = liveChats.get(t.id);
      const st = chatStore.get(t.id);
      const busy = !!st && statusOf(st) !== "idle";
      if (!(await confirmClosing(live ? [live.chat] : [], busy ? `Fechar “${t.title}”? O agente está trabalhando nesta conversa.` : `Fechar “${t.title}”?`, { ok: "Fechar mesmo assim", danger: true, ask: busy, workspaceId: ws.id }))) return;
      if (busy) window.dispatchEvent(new CustomEvent("kabul:stop-chat", { detail: t.id }));
    }
    if (t) closedRef.current = [...closedRef.current.slice(-9), t];
    if (t?.kind === "chat") setTimeout(() => chatStore.forget(t.id), 0);
    const next = tabs.filter((_, k) => k !== i);
    setTabs(next.length ? next : [{ kind: "chat", id: newChatId(), title: "Nova conversa" }]);
    setActiveTab(Math.max(0, activeTab >= i ? activeTab - 1 : activeTab));
  };
  // Sem mudança, devolve o mesmo array: a aba avisa busy/waiting/título a cada efeito, e um array novo re-renderizaria o workspace à toa.
  const patchTab = (id: string, p: Partial<CenterTab>) =>
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.kind === "chat" && t.id === id);
      if (i < 0 || Object.entries(p).every(([k, v]) => (ts[i] as Record<string, unknown>)[k] === v)) return ts;
      return ts.map((t, j) => (j === i ? ({ ...t, ...p } as CenterTab) : t));
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
      if (k === "t" && !e.shiftKey) (e.preventDefault(), open({ kind: "chat", id: newChatId(), title: "Nova conversa" }));
      else if (k === "t" && e.shiftKey) {
        // ⌘⇧T reabre a última aba fechada (sem nenhuma, abre um terminal).
        e.preventDefault();
        const last = closedRef.current.pop();
        if (last) open(last);
        else newTerminalTab();
      }
      else if (k === "w" && !e.shiftKey) (e.preventDefault(), closeTab(activeTab));
      else if (k === "j" && !e.shiftKey) (e.preventDefault(), setBottomOpen((b) => !b));
      else if (k === "p" && e.shiftKey) (e.preventDefault(), openPr());
      else if (k === "p" && !e.shiftKey && !e.altKey) (e.preventDefault(), setFinder("open"));
      else if (k === "f" && e.shiftKey && !e.altKey) (e.preventDefault(), setFinder("grep"));
      else if (e.shiftKey && (e.key === "]" || e.key === "}")) (e.preventDefault(), setActiveTab((a) => (a + 1) % tabs.length));
      else if (e.shiftKey && (e.key === "[" || e.key === "{")) (e.preventDefault(), setActiveTab((a) => (a - 1 + tabs.length) % tabs.length));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, tabs, activeTab, split]);

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
      open({ kind: "chat", id, title: "Fork" });
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
      open({ kind: "chat", id, title: d.title ?? "Plano" });
      setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:send-chat", { detail: { chat: id, text: d.text } })), 600);
    };
    const openFile = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.ws !== ws.id) return;
      open(changes.some((c) => c.path === d.path) ? { kind: "diff", path: d.path } : { kind: "file", path: d.path });
    };
    const ev: [string, (e: Event) => void][] = [["kabul:fork-tab", forkTab], ["kabul:fork-ws", forkWs], ["kabul:new-chat-with", newWith], ["kabul:open-file", openFile]];
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
    const text = items.map((i) => (i.k === "user" ? `## Usuário\n\n${i.text}` : i.k === "assistant" ? `## Agente\n\n${i.text}` : i.k === "tool" ? `_(ferramenta ${i.name})_` : "")).filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
  };
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey && e.altKey && e.code === "KeyC") {
        const t = tabs[activeTab];
        if (t?.kind === "chat") (e.preventDefault(), copyTranscript(t.id));
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
      const chat = tabs.find((t) => t.kind === "chat") as { id: string } | undefined;
      if (chat) setTimeout(() => window.dispatchEvent(new CustomEvent(p.send ? "kabul:send-chat" : "kabul:compose-chat", { detail: { chat: chat.id, text: p.text, plan: p.plan } })), 400);
    }
  }, [tabs.length, ws.id]);

  // Texto para o agente vindo de outra aba (comentários do diff): volta para a última conversa.
  const [lastChat, setLastChat] = useState<string | null>(null);
  useEffect(() => {
    const t = tabs[activeTab];
    if (t?.kind === "chat") setLastChat(t.id);
  }, [tabs, activeTab]);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { ws: string; text: string };
      if (d.ws !== ws.id) return;
      const i = Math.max(0, tabs.findIndex((t) => t.kind === "chat" && t.id === lastChat));
      const target = tabs[i];
      if (target?.kind !== "chat") return;
      setActiveTab(i);
      setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:compose-chat", { detail: { chat: target.id, text: d.text } })), 0);
    };
    const send = (e: Event) => {
      const d = (e as CustomEvent).detail as { ws: string; text: string };
      if (d.ws !== ws.id) return;
      const i = Math.max(0, tabs.findIndex((t) => t.kind === "chat" && t.id === lastChat));
      const target = tabs[i];
      if (target?.kind !== "chat") return;
      setActiveTab(i);
      setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:send-chat", { detail: { chat: target.id, text: d.text } })), 0);
    };
    window.addEventListener("kabul:compose", h);
    window.addEventListener("kabul:agent", send);
    return () => (window.removeEventListener("kabul:compose", h), window.removeEventListener("kabul:agent", send));
  }, [tabs, lastChat, ws.id]);

  // Conversa pedida de fora (painel Agentes) antes de o workspace montar.
  useEffect(() => {
    const want = pendingActivate[ws.id];
    if (!want || !tabs.length) return;
    const i = tabs.findIndex((t) => t.kind === "chat" && t.id === want);
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
    else if (a === "new-chat") open({ kind: "chat", id: newChatId(), title: "Nova conversa" });
    else if (a === "new-terminal") newTerminalTab();
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
    const activate = (e: Event) => { const i = tabs.findIndex((t) => "id" in t && t.id === (e as CustomEvent).detail); if (i >= 0) setActiveTab(i); };
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
    if (appSet?.review_model) window.dispatchEvent(new CustomEvent("kabul:new-chat-with", { detail: { ws: ws.id, text, model: appSet.review_model, title: "Revisão" } }));
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
      case "pull": return direct("Pull", () => api.gitPull(ws.id), a);
      case "push": return direct("Push", () => api.gitPush(ws.id), a);
      case "create-pr": return openPr();
      case "create-pr-agent": return toAgent(buildPrompt("create_pr", await prompts(), { target }));
      case "ready": return direct("Pronto para revisão", () => api.prReady(ws.id), a);
      case "merge":
        if (!(await confirmDialog(`Fazer merge do PR #${git.pr?.number} em ${git.pr?.base}?`, { ok: "Merge" }))) return;
        return direct("Merge", () => api.prMerge(ws.id), a);
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
      case "conflicts": return toAgent(buildPrompt("resolve_conflicts", await prompts(), { target, files: (git.status?.conflicts ?? []).map((f) => `- ${f}`).join("\n") || "(veja git status)" }));
      case "open-pr": return git.pr && api.prOpenUrl(ws.id, git.pr.url).then((u) => api.openExternal(u), (e) => onError(String(e)));
      case "review": return review();
      case "comments": return toAgent("Responda a estes comentários do PR (corrija o que fizer sentido):\n" + (git.pr?.comments ?? []).map(commentText).join("\n"), false);
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
          <RepoMark name={repo.name} />
          <span className="crumb-repo">{repo.name}</span>
          <span className="crumb-sep">›</span>
          {editing === "branch" ? (
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} className="inline-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" && setEditing(null))} />
          ) : (
            <span className="crumb-branch" title="Clique duplo para renomear a branch" onDoubleClick={() => (setEditing("branch"), setDraft(ws.branch))}>{ws.branch}</span>
          )}
          <div className="picker" ref={menuRef}>
            <button className={"icon-btn" + (menu ? " on" : "")} title="Mais ações" onClick={() => setMenu(!menu)} data-testid="ws-menu"><IMore size={14} /></button>
            {menu && (
              <Floating className="status-pop ws-menu" placement="bottom-end">
                <div className="pop-row" onClick={() => (setMenu(false), setEditing("title"), setDraft(wsTitle(ws)))}>Renomear workspace</div>
                <div className="pop-row" onClick={() => (setMenu(false), setEditing("branch"), setDraft(ws.branch))}>Renomear branch</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(ws.branch))}>Copiar nome da branch</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(ws.path))}>Copiar caminho</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(`kabul://workspace?id=${ws.id}`))} data-testid="ws-copy-link">Copiar link <span className="grow" /><span className="kbd-hint">⌘⇧C</span></div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(`${wsTitle(ws)}\nbranch: ${ws.branch}\nalvo: ${ws.target_branch || repo.default_branch}\npasta: ${ws.path}\nporta: ${ws.port}${ws.pr_url ? `\nPR: ${ws.pr_url}` : ""}`))}>Copiar informações do workspace</div>
                <div className="pop-row" onClick={() => (setMenu(false), api.updateWorkspace(ws.id, { unread: true }).then(onChange, (e) => onError(String(e))))}>Marcar como não lido</div>
                <div className="pop-row" onClick={() => (setMenu(false), onOpenSettings(repo.id))}>Scripts e configurações do repo</div>
                <div className="pop-row" onClick={() => (setMenu(false), toggleMirror())} data-testid="mirror-toggle">{mirror?.running ? "Parar espelhamento no celular/claude.ai" : "Espelhar no celular/claude.ai"}</div>
                <div className="pop-row" onClick={() => (setMenu(false), setCloudDialog(true))}>Nova sessão na nuvem (Claude)…</div>
                {access?.slug && <div className="pop-row" onClick={() => (setMenu(false), api.openExternal(`https://github.com/${access.slug}`))}>Abrir no GitHub ↗</div>}
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={() => (setMenu(false), window.dispatchEvent(new CustomEvent("kabul:archive", { detail: ws.id })))}>Arquivar workspace <span className="grow" /><span className="kbd-hint">⌘⇧A</span></div>
              </Floating>
            )}
          </div>
          <span className="picker hdr-extra" ref={targetPop.ref}>
            <button className="crumb-target" title="Branch alvo (PR e diff)" onClick={() => (targetPop.toggle(), api.repoBranches(repo.id).then(setBranches, () => {}))} data-testid="target-branch">→ {ws.target_branch || repo.default_branch} <IChevronDown size={10} /></button>
            {targetPop.open && (
              <Floating className="status-pop target-pop" placement="bottom-start" testid="target-pop">
                <div className="pop-title">Branch alvo (PR e diff)</div>
                {[repo.default_branch, ...branches.map((b) => b.replace(/^origin\//, "")).filter((b, i, a) => b !== repo.default_branch && a.indexOf(b) === i && b !== ws.branch)].map((b) => (
                  <div key={b} className={"pop-row" + ((ws.target_branch || repo.default_branch) === b ? " on" : "")} onClick={() => (targetPop.close(), api.updateWorkspace(ws.id, { target_branch: b === repo.default_branch ? "" : b }).then(() => (onChange(), git.refresh(), loadRight()), (e) => onError(String(e))))} data-testid="target-row">{b}{b === repo.default_branch && <span className="dim small">padrão</span>}</div>
                ))}
              </Floating>
            )}
          </span>
          <span className="crumb-sep hdr-extra">·</span>
          {mirror?.running && <button className="issue-chip mirror-chip" title={`Rodando neste Mac, espelhada. A sessão aparece como "kabul-${ws.name}" no claude.ai/code e no app Claude do celular`} onClick={() => api.openExternal(mirror.link ?? "https://claude.ai/code")} data-testid="mirror-chip"><RunsOnBadge r={{ kind: "local", mirrored: true }} /> espelhado ↗</button>}
          {editing === "title" ? (
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} className="inline-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" && setEditing(null))} />
          ) : (
            <span className="crumb-title hdr-extra" title="Clique duplo para renomear" onDoubleClick={() => (setEditing("title"), setDraft(wsTitle(ws)))}>{wsTitle(ws)}</span>
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
          <button className={"icon-btn hdr-extra" + (ws.pinned ? " on" : "")} title={ws.pinned ? "Desafixar" : "Fixar no topo"} onClick={() => api.updateWorkspace(ws.id, { pinned: !ws.pinned }).then(onChange, (e) => onError(String(e)))}><IPin size={14} /></button>

          <PrPill git={git} onOpen={() => runGit("open-pr")} />
          <span className="grow" data-tauri-drag-region />
          {!rightOpen && <GitButton git={git} onAction={runGit} compact />}
          <OpenIn path={ws.path} onError={onError} />
          <button className={"icon-btn" + (rightOpen ? " on" : "")} title="Mostrar/ocultar painel (⌥⌘B)" onClick={toggleRight} data-testid="toggle-right"><IPanel /></button>
        </header>
        <div className="tabstrip">
          {tabs.map((t, i) => (
            <div key={t.kind === "chat" ? t.id : t.kind === "cloud" ? t.tmux : t.kind === "term" ? t.session : t.kind + t.path} onContextMenu={(e) => t.kind === "chat" && (e.preventDefault(), setTabMenu({ i, x: e.clientX, y: e.clientY }))} data-testid="ctab" className={"ctab" + (i === activeTab ? " on" : "")} onClick={() => (setActiveTab(i), t.kind === "chat" && chatStore.markUnread(t.id, false))}>
              {t.kind === "chat" ? (
                <>
                  <TabStatus id={t.id} />
                  {renamingTab === t.id ? (
                    <input className="inline-edit ctab-edit" autoFocus defaultValue={t.title} onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === "Enter") (patchTab(t.id, { title: (e.target as HTMLInputElement).value || t.title }), setRenamingTab(null)); if (e.key === "Escape") setRenamingTab(null); }}
                      onBlur={(e) => (patchTab(t.id, { title: e.target.value || t.title }), setRenamingTab(null))} data-testid="tab-rename-input" />
                  ) : <span className="ctab-title" onDoubleClick={() => setRenamingTab(t.id)}>{t.title}</span>}
                </>
              ) : t.kind === "cloud" ? (
                <><RunsOnBadge r={cloudRunsOn({ tmux: t.tmux, info: t.info, created: 0 })} /><span className="ctab-title">{t.info.title ?? "Nuvem"}</span></>
              ) : t.kind === "term" ? (
                <><span className="ctab-title">{t.title}</span></>
              ) : (
                <><IFile size={13} /><span className="ctab-title">{t.path.split("/").pop()}{t.kind === "diff" ? "" : " (leitura)"}</span></>
              )}
              <button className="icon-btn" title="Fechar (⌘W)" onClick={(e) => { e.stopPropagation(); if (t.kind === "cloud") cloudRemove(ws.id, t.tmux); closeTab(i); }}><IClose size={12} /></button>
            </div>
          ))}
          <div className="picker ctab-add" ref={plusRef}>
            <button className={"icon-btn" + (plusMenu ? " on" : "")} title="Nova aba" onClick={() => setPlusMenu(!plusMenu)} data-testid="new-tab"><IPlus size={14} /></button>
            {plusMenu && (
              <Floating className="status-pop plus-pop" placement="bottom-start">
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "chat", id: newChatId(), title: "Nova conversa" }))} data-testid="new-chat">Nova conversa <span className="grow" /><span className="kbd-hint">⌘T</span></div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), newTerminalTab())} data-testid="new-term-tab">Terminal <span className="grow" /><span className="kbd-hint">⌘⇧T</span></div>
                <div className="pop-sep" />
                <div className="pop-title">Onde roda</div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "chat", id: newChatId(), title: "Nova conversa" }))}>💻 Este Mac</div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), setCloudDialog(true))} data-testid="new-cloud"><RunsOnBadge r={{ kind: "provider_cloud", provider: "claude" }} /> Nuvem do provedor (Claude)</div>
                <div className="pop-row disabled" title="em breve"><RunsOnBadge r={{ kind: "remote", host: "—" }} /> Outra máquina (Tailscale) <span className="grow" /><span className="dim small">em breve</span></div>
                <div className="pop-row disabled" title="em breve"><RunsOnBadge r={{ kind: "kabul_cloud", host: "—" }} /> Nuvem Kabul <span className="grow" /><span className="dim small">em breve</span></div>
              </Floating>
            )}
          </div>
        </div>
        <div className={"center-panes" + (splitIdx >= 0 ? " split" : "")} style={{ ["--split" as string]: `${split?.pct ?? 50}%` }}>
        {/* Só as abas na tela ficam montadas: as outras conversas seguem no registro (status e contadores) e
            remontam com o estado guardado; os terminais guardam a instância do xterm. */}
        {tabs.map((t, i) =>
          t.kind === "chat" && (i === activeTab || i === splitIdx) ? (
            <div key={t.id} className={paneClass(i)}>
              <ChatTab ws={ws} sessionId={t.id} active={active && i === activeTab} onError={onError} onWorkspaceChange={onChange}
                onTitle={(title) => patchTab(t.id, { title })} />
            </div>
          ) : null,
        )}
        {tabs.map((t, i) => (i !== activeTab && i !== splitIdx) ? null : t.kind === "cloud" ? (
          <div key={t.tmux} className={paneClass(i)}><CloudTab ws={ws} tmux={t.tmux} initial={t.info} onError={onError} onTeleport={(session) => open({ kind: "term", session, title: `Teleport ${t.info.id?.slice(-6)}` })} /></div>
        ) : t.kind === "term" ? (
          <div key={t.session} className={paneClass(i)}><TerminalTab ws={ws} session={t.session} visible initialCommand={t.preset} gpu onError={onError} /></div>
        ) : null)}
        {tab?.kind === "diff" && <div className="center-body"><FileDiff ws={ws} path={tab.path} scope={scope} files={changes.map((c) => c.path)} active={active} onNavigate={(p) => open({ kind: "diff", path: p })} onError={onError} /></div>}
        {tab?.kind === "file" && <div className="center-body"><FileView key={tab.path + (tab.line ?? "")} ws={ws} path={tab.path} line={tab.line} onError={onError} /></div>}
          {splitIdx >= 0 && (
            <div className="split-divider" role="separator" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={split!.pct} tabIndex={0} title="Arraste ou use ←/→ (2%) · duplo clique desfaz"
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") (e.preventDefault(), setSplit((sp) => sp && { ...sp, pct: Math.min(80, Math.max(20, sp.pct + (e.key === "ArrowLeft" ? -2 : 2))) })); }}
              onDoubleClick={() => setSplit(null)}
              onPointerDown={(e) => {
                const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                const move = (ev: PointerEvent) => setSplit((sp) => sp && { ...sp, pct: Math.min(80, Math.max(20, Math.round(((ev.clientX - box.left) / box.width) * 100))) });
                const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }} data-testid="split-divider">
              <button className="icon-btn split-close" title="Desfazer divisão (⌘D)" onClick={() => setSplit(null)} data-testid="split-close">×</button>
            </div>
          )}
        </div>
      </section>
      {tabMenu && tabs[tabMenu.i]?.kind === "chat" && (() => {
        const t = tabs[tabMenu.i] as Extract<CenterTab, { kind: "chat" }>;
        return (
          createPortal(<div ref={tabMenuRef} className="popover status-pop tab-ctx" style={{ position: "fixed", left: tabMenu.x, top: tabMenu.y }} data-testid="tab-menu">
            <div className="pop-row" onClick={() => (setRenamingTab(t.id), setTabMenu(null))} data-testid="tab-rename">Renomear</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), window.dispatchEvent(new CustomEvent("kabul:fork-last", { detail: { chat: t.id } })))} data-testid="tab-fork">Fork para nova aba <span className="grow" /><span className="kbd-hint">⌘⌥↵</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), copyTranscript(t.id))} data-testid="tab-copy">Copiar transcript <span className="grow" /><span className="kbd-hint">⌘⌥C</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), chatStore.markUnread(t.id, !chatStore.get(t.id)?.unread))}>{chatStore.get(t.id)?.unread ? "Marcar como lida" : "Marcar como não lida"}</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), navigator.clipboard.writeText(`kabul://workspace?id=${ws.id}&session=${t.id}`))} data-testid="tab-copy-link">Copiar link</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), api.historyLoad(ws.id, t.id).then((r) => navigator.clipboard.writeText(`${r.title}\nconversa: ${t.id}\nmodelo: ${r.model_key ?? "-"}\nsessão do agente: ${r.agent_session ?? "-"}`), () => {}))}>Copiar informações da conversa</div>
            <div className="pop-sep" />
            <div className="pop-row" onClick={() => (setTabMenu(null), closeTab(tabMenu.i))}>Fechar <span className="grow" /><span className="kbd-hint">⌘W</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), split && split.key === t.id ? setSplit(null) : splitWith(tabMenu.i))} data-testid="tab-split">{split && split.key === t.id ? "Desfazer divisão" : "Dividir à direita"} <span className="grow" /><span className="kbd-hint">⌘D</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), setTabs([t]), setActiveTab(0))} data-testid="tab-close-others">Fechar as outras</div>
          </div>, document.body)
        );
      })()}
      {finder === "open" && <QuickOpen ws={ws} onClose={() => setFinder(null)} onOpen={(p) => open(changes.some((c) => c.path === p) ? { kind: "diff", path: p } : { kind: "file", path: p })} />}
      {finder === "grep" && <SearchFiles ws={ws} onClose={() => setFinder(null)} onOpen={(p, line) => open({ kind: "file", path: p, line })} />}
      {fileCtx && (
        createPortal(<div ref={fileCtxRef} className="popover status-pop file-ctx" style={{ left: fileCtx.x, top: fileCtx.y }} data-testid="file-menu">
          <div className="pop-row" onClick={() => (setFileCtx(null), open(fileCtx.changed ? { kind: "diff", path: fileCtx.path } : { kind: "file", path: fileCtx.path }))}>Ver</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), api.openIn(localStorage.getItem("kabul.openIn.default") || "finder", `${ws.path}/${fileCtx.path}`).catch((e) => onError(String(e))))} data-testid="file-open-in">Abrir no app padrão</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), api.openIn("finder", `${ws.path}/${fileCtx.path.includes("/") ? fileCtx.path.slice(0, fileCtx.path.lastIndexOf("/")) : ""}`).catch((e) => onError(String(e))))}>Mostrar no Finder</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), toAgent(`@${fileCtx.path} `, false))} data-testid="file-attach">Anexar no chat</div>
          <div className="pop-sep" />
          <div className="pop-row" onClick={() => (setFileCtx(null), navigator.clipboard.writeText(`${ws.path}/${fileCtx.path}`))} data-testid="file-copy-path">Copiar caminho</div>
          <div className="pop-row" onClick={() => (setFileCtx(null), navigator.clipboard.writeText(fileCtx.path))} data-testid="file-copy-rel">Copiar caminho relativo</div>
          {fileCtx.changed && <><div className="pop-sep" /><div className="pop-row danger" onClick={async () => { const p = fileCtx.path; setFileCtx(null); if (await confirmDialog(`Descartar as mudanças de ${p}? Não dá para desfazer (a não ser por um checkpoint).`, { ok: "Descartar", danger: true })) api.discard(ws.id, p).then(loadRight, (e) => onError(String(e))); }} data-testid="file-discard">Descartar mudanças…</div></>}
        </div>, document.body)
      )}
      {cloudDialog && <CloudDialog ws={ws} onError={onError} onClose={() => setCloudDialog(false)} onCreated={(tmux, info) => (setCloudDialog(false), cloudAdd(ws.id, { tmux, info, created: Date.now() }), open({ kind: "cloud", tmux, info }))} />}

      {rightOpen && <Resizer axis="x" dir={-1} {...rightSize} onSize={rightSize.setSize} onCollapse={toggleRight} testid="resize-right" />}
      <aside className="right" hidden={!rightOpen}>
        <header className="topbar right-top" data-tauri-drag-region>
          {ws.pr_url && <button className="text-btn small" onClick={() => api.openExternal(ws.pr_url!)}>PR aberto ↗</button>}
          <div className="grow" />
          <div ref={prRef}>{rightOpen && <GitButton git={git} onAction={runGit} />}</div>
          {pr && (
            <Floating className="pr-pop" placement="bottom-end" testid="pr-form" onKeyDown={(e) => e.key === "Escape" && setPr(null)}>
              <div className="pop-title">Pull request para <code>{pr.stack_on ? `PR #${pr.stack_on}` : ws.target_branch || repo.default_branch}</code></div>
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} placeholder="Título" autoFocus />
              <textarea rows={4} value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} placeholder="Descrição (opcional)" />
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.labels.join(", ")} onChange={(e) => setPr({ ...pr, labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Labels (separadas por vírgula)" />
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.stack_on ?? ""} onChange={(e) => setPr({ ...pr, stack_on: e.target.value ? Number(e.target.value) || null : null })} placeholder="Empilhar sobre o PR nº (opcional)" />
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={pr.draft} onChange={(e) => setPr({ ...pr, draft: e.target.checked })} /> Rascunho (draft)</label>
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={pr.dry_run} onChange={(e) => setPr({ ...pr, dry_run: e.target.checked })} /> Só mostrar os comandos (sem push)</label>
              <div className="row end"><button className="btn" onClick={() => setPr(null)}>Cancelar</button><button className="btn primary" disabled={prBusy || !pr.title.trim()} onClick={submitPr}>{prBusy ? "Enviando…" : pr.dry_run ? "Simular" : "Push e criar"}</button></div>
            </Floating>
          )}
        </header>
        <div className="rtabs">
          <button className={"rtab" + (right === "all" ? " on" : "")} onClick={() => setRight("all")}>Arquivos</button>
          <button className={"rtab" + (right === "changes" ? " on" : "")} onClick={() => setRight("changes")}>Alterações <span className="count">{changes.length}</span></button>
          <button className={"rtab" + (right === "checks" ? " on" : "")} onClick={() => setRight("checks")} data-testid="tab-checks">Checks{failing(git.checks).length ? <span className="count error">{failing(git.checks).length}</span> : null}</button>
          <span className="grow" />
          <button className="text-btn small review-btn" title="Pedir ao agente uma revisão das mudanças" onClick={review} data-testid="review"><IEye size={13} /> <span className="txt">Revisar</span></button>
          <button className={"icon-btn" + (right === "checkpoints" ? " on" : "")} title="Checkpoints" onClick={() => setRight("checkpoints")} data-testid="tab-checkpoints"><IHistory size={14} /></button>
        </div>
        {access && !access.ok && access.message && <div className="gh-warn" data-testid="gh-warn">{access.message} <a onClick={() => window.dispatchEvent(new CustomEvent("kabul:route", { detail: { kind: "settings", tab: "contas" } }))}>Contas › GitHub</a></div>}
        {prResult && (
          <div className="pr-done" data-testid="pr-result">
            {prResult.url ? <>PR criado · <a onClick={() => api.openExternal(prResult.url!)}>{prResult.url.replace("https://github.com/", "")}</a></> : <>Simulação: <pre>{prResult.commands.join("\n")}</pre></>}
            <button className="icon-btn" onClick={() => setPrResult(null)}><IClose size={11} /></button>
          </div>
        )}
        <div className="files">
          {right === "changes" && (
            <div className="changes-head">
              <select value={scope} onChange={(e) => (setScope(e.target.value as DiffScope), localStorage.setItem("kabul.diff.scope", e.target.value))} title="Escopo do diff" data-testid="diff-scope">
                <option value="all">Todas as mudanças</option><option value="branch">Commits da branch</option><option value="uncommitted">Não commitadas</option>
              </select>
              <input {...noSuggest} autoComplete="off" placeholder="Filtrar arquivos" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="changes-filter" />
              <button className="icon-btn" title={changesView === "list" ? "Ver em árvore" : "Ver em lista"} onClick={() => setChangesView((v) => { const n = v === "list" ? "tree" : "list"; localStorage.setItem("kabul.changes.view", n); return n; })} data-testid="changes-view">{changesView === "list" ? <IFolder size={14} /> : <IFile size={13} />}</button>
            </div>
          )}
          {right === "changes" && changesView === "tree" && <FileTree files={changes.map((c) => c.path).filter((p) => p.toLowerCase().includes(filter.toLowerCase()))} expanded onOpen={(f) => open({ kind: "diff", path: f })} onContext={(f, e) => setFileCtx({ path: f, x: e.clientX, y: e.clientY, changed: true })} />}
          {right === "changes" && changesView === "list" && (changes.length === 0 ? <div className="files-empty">Nenhuma alteração ({scope === "uncommitted" ? "não commitada" : scope === "branch" ? "commitada na branch" : <>em relação a <code>{ws.target_branch || repo.default_branch}</code></>}).</div> : <LazyChunks count={shownChanges.length} chunk={150} rowPx={30} render={(a, b) => shownChanges.slice(a, b).map((c) => {
            const dir = c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/") + 1) : "";
            return (
              <div key={c.path} className={"file-row" + (viewedMap(ws.id)[c.path] ? " viewed" : "")} onClick={() => open({ kind: "diff", path: c.path })} onContextMenu={(e) => (e.preventDefault(), setFileCtx({ path: c.path, x: e.clientX, y: e.clientY, changed: true }))} data-testid="change-row">
                <span className="fpath"><span className="dim">{dir}</span>{c.path.slice(dir.length)}</span>
                <span className="grow" />
                {c.added ? <span className="add">+{c.added}</span> : null}
                {c.removed ? <span className="del">-{c.removed}</span> : null}
                {c.untracked && <span className="badge-new">novo</span>}
              </div>
            );
          })} />)}
          {right === "all" && <FileTree files={allFiles} onOpen={(f) => open({ kind: "file", path: f })} onContext={(f, e) => setFileCtx({ path: f, x: e.clientX, y: e.clientY, changed: changes.some((c) => c.path === f) })} />}
          {right === "checks" && <ChecksPanel ws={ws} git={git} onAction={runGit} onToChat={(t) => toAgent(t, false)} onError={onError} />}
          {right === "checkpoints" && (checkpoints.length === 0 ? <div className="files-empty">Um checkpoint é gravado antes de cada mensagem enviada.</div> : checkpoints.map((c) => (
            <div key={c.id} className="file-row">
              <span className="fpath">{c.message}</span><span className="grow" />
              <span className="dim small">{new Date(c.created_at * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              <button className="icon-btn" title="Restaurar" onClick={() => confirmDialog(`Restaurar "${c.message}"? Mudanças posteriores serão descartadas.`).then((ok) => void (ok && api.restoreCheckpoint(ws.id, c.id).then(loadRight, (e) => onError(String(e)))))}><IRestore size={13} /></button>
            </div>
          )))}
        </div>
        {bottomOpen && <Resizer axis="y" dir={-1} {...bottomSize} onSize={bottomSize.setSize} onCollapse={() => setBottomOpen(false)} testid="resize-bottom" />}
        <div className={"bottom" + (bottomOpen ? "" : " closed")}>
          <div className="btabs">
            <button className="icon-btn" title="Mostrar/ocultar (⌘J)" onClick={() => setBottomOpen(!bottomOpen)}><IChevronDown size={13} /></button>
            {(["setup", "run", "terminal"] as Bottom[]).map((b) => (
              <button key={b} className={"btab" + (bottom === b ? " on" : "")} onClick={() => (setBottom(b), setBottomOpen(true))}>{{ setup: "Setup", run: "Run", terminal: "Terminal" }[b as "setup"]}</button>
            ))}
            {extraTerms.map((n) => (
              <button key={n} className={"btab" + (bottom === `t${n}` ? " on" : "")} onClick={() => (setBottom(`t${n}`), setBottomOpen(true))}>
                Terminal {n}<span className="btab-x" title="Fechar" onClick={(e) => { e.stopPropagation(); api.stopScript(`kabul-${ws.name}-t${n}`).catch(() => {}); setExtraTerms((x) => x.filter((y) => y !== n)); setBottom("terminal"); }}>×</span>
              </button>
            ))}
            <button className="icon-btn" title="Novo terminal" data-testid="new-terminal" onClick={() => { const n = Math.max(1, ...extraTerms) + 1; setExtraTerms((x) => [...x, n]); setBottom(`t${n}`); setBottomOpen(true); }}><IPlus size={13} /></button>
            <span className="grow" />
            <span className="dim small" title="Portas reservadas para este workspace">:{ws.port}</span>
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
