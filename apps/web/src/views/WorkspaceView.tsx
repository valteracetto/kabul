import { confirmDialog } from "../components/Confirm";
import { noSuggest } from "../noSuggest";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "../components/useDismiss";
import { api, STATUS_LABEL, wsTitle, type Checkpoint, type FileChange, type PrOptions, type PrResult, type Repo, type Workspace } from "../api";
import { ChatTab } from "./ChatTab";
import { TerminalTab } from "./TerminalTab";
import { FileDiff, FileView } from "./FileDiff";
import { ScriptsPane } from "./ScriptsPane";
import { IChevronDown, IClose, IEye, IFile, IHistory, IMore, IPR, IPanel, IPin, IPlus, IRestore, RepoMark } from "../icons";
import { OpenIn } from "../components/OpenIn";
import { FileTree } from "../components/FileTree";
import { Checks } from "../components/Checks";
import { Resizer, usePanelSize } from "../components/Resizer";
import type { AgentState } from "../App";
import { CloudDialog, CloudTab } from "../components/Cloud";
import { pendingFirst } from "../components/CreateModal";
import { pendingFork, pendingForkWs } from "../components/chatPrefs";
import { RunsOnBadge, cloudAdd, cloudList, cloudRemove, cloudRunsOn } from "../components/RunsOn";
import type { CloudInfo, RepoAccess } from "../api";

type CenterTab = { kind: "chat"; id: string; title: string; busy?: boolean; unread?: boolean; waiting?: boolean } | { kind: "cloud"; tmux: string; info: CloudInfo } | { kind: "term"; session: string; title: string } | { kind: "diff"; path: string } | { kind: "file"; path: string };
type Bottom = "setup" | "run" | "terminal" | `t${number}`;
type RightTab = "all" | "changes" | "checks" | "checkpoints";

const newChatId = () => `chat-${Date.now().toString(36)}`;

interface Props { ws: Workspace; repo: Repo; active: boolean; sidebarHidden: boolean; onAgent: (id: string, s: AgentState | undefined) => void; onError: (e: string) => void; onChange: () => void; onOpenSettings: (repoId: string) => void }

export function WorkspaceView({ ws, repo, active, sidebarHidden, onAgent, onError, onChange, onOpenSettings }: Props) {
  const [rightOpen, setRightOpen] = useState(() => localStorage.getItem("kabul.rightPanel") !== "0" && window.innerWidth >= 1000);
  const [menu, setMenu] = useState(false);
  const [plusMenu, setPlusMenu] = useState(false);
  const [cloudDialog, setCloudDialog] = useState(false);
  const [mirror, setMirror] = useState<{ running: boolean; link: string | null } | null>(null);
  const [access, setAccess] = useState<RepoAccess | null>(null);
  const rightSize = usePanelSize("right", Math.round(Math.min(480, Math.max(320, window.innerWidth * 0.3))), 260, 900);
  const bottomSize = usePanelSize("bottom", Math.round(window.innerHeight * 0.42), 120, 900);
  const toggleRight = () => setRightOpen((o) => (localStorage.setItem("kabul.rightPanel", o ? "0" : "1"), !o));
  const [tabs, setTabs] = useState<CenterTab[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [right, setRight] = useState<RightTab>("all");
  const [bottom, setBottom] = useState<Bottom>("terminal");
  const [extraTerms, setExtraTerms] = useState<number[]>([]);
  const [bottomOpen, setBottomOpen] = useState(true);
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
    open({ kind: "term", session, title: `Terminal ${n}` });
  };

  // Sessões salvas viram abas; se não houver, uma conversa nova.
  useEffect(() => {
    api.historyList(ws.id).then((h) => {
      const pfw = pendingForkWs[ws.id];
      if (pfw) delete pendingForkWs[ws.id];
      const chats: CenterTab[] = pfw ? [{ kind: "chat", id: pfw.chatId, title: "Fork" }] : h.length ? h.slice(0, 6).reverse().map((s) => ({ kind: "chat", id: s.id, title: s.title })) : [{ kind: "chat", id: newChatId(), title: "Nova conversa" }];
      // Sessões de nuvem reabertas como abas ☁︎.
      setTabs([...chats, ...cloudList(ws.id).slice(0, 4).map((c) => ({ kind: "cloud" as const, tmux: c.tmux, info: c.info }))]);
      setActiveTab(0);
    }, () => setTabs([{ kind: "chat", id: newChatId(), title: "Nova conversa" }]));
  }, [ws.id]);

  const loadRight = useCallback(() => {
    api.changes(ws.id).then(setChanges, () => {});
    if (right === "all") api.files(ws.id).then(setAllFiles, () => {});
    if (right === "checkpoints") api.checkpoints(ws.id).then(setCheckpoints, () => {});
  }, [ws.id, right]);
  useEffect(() => {
    loadRight();
    const t = setInterval(loadRight, 4000);
    return () => clearInterval(t);
  }, [loadRight]);

  const open = (t: CenterTab) => {
    const key = (x: CenterTab) => (x.kind === "chat" ? x.id : x.kind === "cloud" ? x.tmux : x.kind === "term" ? x.session : x.path);
    const i = tabs.findIndex((x) => x.kind === t.kind && key(x) === key(t));
    if (i >= 0) return setActiveTab(i);
    setTabs([...tabs, t]);
    setActiveTab(tabs.length);
  };
  const closeTab = (i: number) => {
    const next = tabs.filter((_, k) => k !== i);
    setTabs(next.length ? next : [{ kind: "chat", id: newChatId(), title: "Nova conversa" }]);
    setActiveTab(Math.max(0, activeTab >= i ? activeTab - 1 : activeTab));
  };
  const patchTab = (id: string, p: Partial<CenterTab>) => setTabs((ts) => ts.map((t) => (t.kind === "chat" && t.id === id ? ({ ...t, ...p } as CenterTab) : t)));

  // Atalhos do workspace: ⌘T conversa nova, ⌘W fecha aba, ⌘J terminal, ⌘⇧P PR, ⌘⇧[ ⌘⇧] trocam aba.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "t" && !e.shiftKey) (e.preventDefault(), open({ kind: "chat", id: newChatId(), title: "Nova conversa" }));
      else if (k === "t" && e.shiftKey) (e.preventDefault(), newTerminalTab());
      else if (k === "w" && !e.shiftKey) (e.preventDefault(), closeTab(activeTab));
      else if (k === "j" && !e.shiftKey) (e.preventDefault(), setBottomOpen((b) => !b));
      else if (k === "p" && e.shiftKey) (e.preventDefault(), openPr());
      else if (e.shiftKey && (e.key === "]" || e.key === "}")) (e.preventDefault(), setActiveTab((a) => (a + 1) % tabs.length));
      else if (e.shiftKey && (e.key === "[" || e.key === "{")) (e.preventDefault(), setActiveTab((a) => (a - 1 + tabs.length) % tabs.length));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, tabs, activeTab]);

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
      open({ kind: "chat", id, title: "Plano" });
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
      if (chat) setTimeout(() => window.dispatchEvent(new CustomEvent(p.send ? "kabul:send-chat" : "kabul:compose-chat", { detail: { chat: chat.id, text: p.text } })), 400);
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
    window.addEventListener("kabul:compose", h);
    return () => window.removeEventListener("kabul:compose", h);
  }, [tabs, lastChat, ws.id]);

  useEffect(() => {
    const chats = tabs.filter((t) => t.kind === "chat") as Extract<CenterTab, { kind: "chat" }>[];
    onAgent(ws.id, chats.some((t) => t.waiting) ? "waiting" : chats.some((t) => t.busy) ? "working" : undefined);
  }, [tabs, ws.id, onAgent]);
  useEffect(() => () => onAgent(ws.id, undefined), [ws.id, onAgent]);
  // ⌥⌘B alterna o painel direito.
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.metaKey && e.altKey && e.code === "KeyB" && (e.preventDefault(), toggleRight());
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active]);
  const review = () => window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: ws.id, text: `Revise as mudanças deste workspace contra ${ws.target_branch || repo.default_branch} (git diff origin/${ws.target_branch || repo.default_branch}...). Aponte bugs, riscos e o que falta testar, por arquivo.` } }));

  const tab = tabs[activeTab] ?? tabs[0];
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
          <span className="crumb-sep">·</span>
          {mirror?.running && <button className="issue-chip mirror-chip" title={`Rodando neste Mac, espelhada. A sessão aparece como "kabul-${ws.name}" no claude.ai/code e no app Claude do celular`} onClick={() => api.openExternal(mirror.link ?? "https://claude.ai/code")} data-testid="mirror-chip"><RunsOnBadge r={{ kind: "local", mirrored: true }} /> espelhado ↗</button>}
          {editing === "title" ? (
            <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} className="inline-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={saveEdit} onKeyDown={(e) => (e.key === "Enter" ? saveEdit() : e.key === "Escape" && setEditing(null))} />
          ) : (
            <span className="crumb-title" title="Clique duplo para renomear" onDoubleClick={() => (setEditing("title"), setDraft(wsTitle(ws)))}>{wsTitle(ws)}</span>
          )}
          {ws.linear && <button className="issue-chip" title={ws.linear.title} onClick={() => api.openExternal(ws.linear!.url)}>{ws.linear.identifier} ↗</button>}
          <div className="picker" ref={statusRef}>
            <button className={"status-pill st-" + ws.status} onClick={() => setStatusOpen(!statusOpen)}>{STATUS_LABEL[ws.status] ?? ws.status} <IChevronDown size={10} /></button>
            {statusOpen && (
              <div className="popover status-pop">
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <div key={k} className={"pop-row" + (k === ws.status ? " on" : "")} onClick={() => api.updateWorkspace(ws.id, { status: k }).then(() => (setStatusOpen(false), onChange()), (e) => onError(String(e)))}><span className={"dot st-" + k} /> {v}</div>
                ))}
              </div>
            )}
          </div>
          <button className={"icon-btn" + (ws.pinned ? " on" : "")} title={ws.pinned ? "Desafixar" : "Fixar no topo"} onClick={() => api.updateWorkspace(ws.id, { pinned: !ws.pinned }).then(onChange, (e) => onError(String(e)))}><IPin size={14} /></button>
          <div className="picker" ref={menuRef}>
            <button className={"icon-btn" + (menu ? " on" : "")} title="Mais ações" onClick={() => setMenu(!menu)} data-testid="ws-menu"><IMore size={14} /></button>
            {menu && (
              <div className="popover status-pop ws-menu">
                <div className="pop-row" onClick={() => (setMenu(false), setEditing("title"), setDraft(wsTitle(ws)))}>Renomear workspace</div>
                <div className="pop-row" onClick={() => (setMenu(false), setEditing("branch"), setDraft(ws.branch))}>Renomear branch</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(ws.branch))}>Copiar nome da branch</div>
                <div className="pop-row" onClick={() => (setMenu(false), navigator.clipboard.writeText(ws.path))}>Copiar caminho</div>
                <div className="pop-row" onClick={() => (setMenu(false), onOpenSettings(repo.id))}>Scripts e configurações do repo</div>
                <div className="pop-row" onClick={() => (setMenu(false), toggleMirror())} data-testid="mirror-toggle">{mirror?.running ? "Parar espelhamento no celular/claude.ai" : "Espelhar no celular/claude.ai"}</div>
                <div className="pop-row" onClick={() => (setMenu(false), setCloudDialog(true))}>Nova sessão na nuvem (Claude)…</div>
                {access?.slug && <div className="pop-row" onClick={() => (setMenu(false), api.openExternal(`https://github.com/${access.slug}`))}>Abrir no GitHub ↗</div>}
                <div className="pop-sep" />
                <div className="pop-row danger" onClick={async () => { setMenu(false); if (await confirmDialog(`Arquivar ${wsTitle(ws)}? As mudanças ficam num checkpoint e dá para desarquivar.`, { ok: "Arquivar", danger: true })) api.archiveWorkspace(ws.id).then(onChange, (e) => onError(String(e))); }}>Arquivar workspace</div>
              </div>
            )}
          </div>
          <span className="grow" data-tauri-drag-region />
          <OpenIn path={ws.path} onError={onError} />
          <button className={"icon-btn" + (rightOpen ? " on" : "")} title="Mostrar/ocultar painel (⌥⌘B)" onClick={toggleRight} data-testid="toggle-right"><IPanel /></button>
        </header>
        <div className="tabstrip">
          {tabs.map((t, i) => (
            <div key={t.kind === "chat" ? t.id : t.kind === "cloud" ? t.tmux : t.kind === "term" ? t.session : t.kind + t.path} onContextMenu={(e) => t.kind === "chat" && (e.preventDefault(), setTabMenu({ i, x: e.clientX, y: e.clientY }))} data-testid="ctab" className={"ctab" + (i === activeTab ? " on" : "")} onClick={() => (setActiveTab(i), t.kind === "chat" && patchTab(t.id, { unread: false }))}>
              {t.kind === "chat" ? (
                <>
                  {t.busy ? <span className="spinner tiny" /> : t.unread ? <span className="unread-dot" /> : null}
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
              <div className="popover status-pop plus-pop">
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "chat", id: newChatId(), title: "Nova conversa" }))} data-testid="new-chat">Nova conversa <span className="grow" /><span className="kbd-hint">⌘T</span></div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), newTerminalTab())} data-testid="new-term-tab">Terminal <span className="grow" /><span className="kbd-hint">⌘⇧T</span></div>
                <div className="pop-sep" />
                <div className="pop-title">Onde roda</div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), open({ kind: "chat", id: newChatId(), title: "Nova conversa" }))}>💻 Este Mac</div>
                <div className="pop-row" onClick={() => (setPlusMenu(false), setCloudDialog(true))} data-testid="new-cloud"><RunsOnBadge r={{ kind: "provider_cloud", provider: "claude" }} /> Nuvem do provedor (Claude)</div>
                <div className="pop-row disabled" title="em breve"><RunsOnBadge r={{ kind: "remote", host: "—" }} /> Outra máquina (Tailscale) <span className="grow" /><span className="dim small">em breve</span></div>
                <div className="pop-row disabled" title="em breve"><RunsOnBadge r={{ kind: "kabul_cloud", host: "—" }} /> Nuvem Kabul <span className="grow" /><span className="dim small">em breve</span></div>
              </div>
            )}
          </div>
        </div>
        {tabs.map((t, i) =>
          t.kind === "chat" ? (
            <div key={t.id} className="center-body" hidden={i !== activeTab}>
              <ChatTab ws={ws} sessionId={t.id} active={active && i === activeTab} onError={onError} onWorkspaceChange={onChange}
                onTitle={(title) => patchTab(t.id, { title })} onUnread={() => i !== activeTab && patchTab(t.id, { unread: true })} onBusy={(busy) => patchTab(t.id, { busy })} onWaiting={(waiting) => patchTab(t.id, { waiting })} />
            </div>
          ) : null,
        )}
        {tabs.map((t, i) => t.kind === "cloud" ? (
          <div key={t.tmux} className="center-body" hidden={i !== activeTab}><CloudTab ws={ws} tmux={t.tmux} initial={t.info} onError={onError} onTeleport={(session) => open({ kind: "term", session, title: `Teleport ${t.info.id?.slice(-6)}` })} /></div>
        ) : t.kind === "term" ? (
          <div key={t.session} className="center-body" hidden={i !== activeTab}><TerminalTab ws={ws} session={t.session} visible={i === activeTab} onError={onError} /></div>
        ) : null)}
        {tab?.kind === "diff" && <div className="center-body"><FileDiff ws={ws} path={tab.path} onError={onError} /></div>}
        {tab?.kind === "file" && <div className="center-body"><FileView ws={ws} path={tab.path} onError={onError} /></div>}
      </section>
      {tabMenu && tabs[tabMenu.i]?.kind === "chat" && (() => {
        const t = tabs[tabMenu.i] as Extract<CenterTab, { kind: "chat" }>;
        return (
          <div ref={tabMenuRef} className="popover status-pop tab-ctx" style={{ position: "fixed", left: tabMenu.x, top: tabMenu.y }} data-testid="tab-menu">
            <div className="pop-row" onClick={() => (setRenamingTab(t.id), setTabMenu(null))} data-testid="tab-rename">Renomear</div>
            <div className="pop-row" onClick={() => (setTabMenu(null), window.dispatchEvent(new CustomEvent("kabul:fork-last", { detail: { chat: t.id } })))} data-testid="tab-fork">Fork para nova aba <span className="grow" /><span className="kbd-hint">⌘⌥↵</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), copyTranscript(t.id))} data-testid="tab-copy">Copiar transcript <span className="grow" /><span className="kbd-hint">⌘⌥C</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), patchTab(t.id, { unread: !t.unread }))}>{t.unread ? "Marcar como lida" : "Marcar como não lida"}</div>
            <div className="pop-sep" />
            <div className="pop-row" onClick={() => (setTabMenu(null), closeTab(tabMenu.i))}>Fechar <span className="grow" /><span className="kbd-hint">⌘W</span></div>
            <div className="pop-row" onClick={() => (setTabMenu(null), setTabs([t]), setActiveTab(0))} data-testid="tab-close-others">Fechar as outras</div>
          </div>
        );
      })()}
      {cloudDialog && <CloudDialog ws={ws} onError={onError} onClose={() => setCloudDialog(false)} onCreated={(tmux, info) => (setCloudDialog(false), cloudAdd(ws.id, { tmux, info, created: Date.now() }), open({ kind: "cloud", tmux, info }))} />}

      {rightOpen && <Resizer axis="x" dir={-1} {...rightSize} onSize={rightSize.setSize} onCollapse={toggleRight} testid="resize-right" />}
      <aside className="right" hidden={!rightOpen}>
        <header className="topbar right-top" data-tauri-drag-region>
          {ws.pr_url && <button className="text-btn small" onClick={() => api.openExternal(ws.pr_url!)}>PR aberto ↗</button>}
          <div className="grow" />
          <div className="split-btn" ref={prRef}>
            <button className="btn" onClick={openPr} data-testid="create-pr"><IPR size={14} /> Criar PR</button>
            <button className="btn caret-btn" title="Opções" onClick={openPr}><IChevronDown size={12} /></button>
          </div>
          {pr && (
            <div className="popover pr-pop" data-testid="pr-form" onKeyDown={(e) => e.key === "Escape" && setPr(null)}>
              <div className="pop-title">Pull request para <code>{pr.stack_on ? `PR #${pr.stack_on}` : ws.target_branch || repo.default_branch}</code></div>
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.title} onChange={(e) => setPr({ ...pr, title: e.target.value })} placeholder="Título" autoFocus />
              <textarea rows={4} value={pr.body} onChange={(e) => setPr({ ...pr, body: e.target.value })} placeholder="Descrição (opcional)" />
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.labels.join(", ")} onChange={(e) => setPr({ ...pr, labels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Labels (separadas por vírgula)" />
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} value={pr.stack_on ?? ""} onChange={(e) => setPr({ ...pr, stack_on: e.target.value ? Number(e.target.value) || null : null })} placeholder="Empilhar sobre o PR nº (opcional)" />
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={pr.draft} onChange={(e) => setPr({ ...pr, draft: e.target.checked })} /> Rascunho (draft)</label>
              <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={pr.dry_run} onChange={(e) => setPr({ ...pr, dry_run: e.target.checked })} /> Só mostrar os comandos (sem push)</label>
              <div className="row end"><button className="btn" onClick={() => setPr(null)}>Cancelar</button><button className="btn primary" disabled={prBusy || !pr.title.trim()} onClick={submitPr}>{prBusy ? "Enviando…" : pr.dry_run ? "Simular" : "Push e criar"}</button></div>
            </div>
          )}
        </header>
        <div className="rtabs">
          <button className={"rtab" + (right === "all" ? " on" : "")} onClick={() => setRight("all")}>Arquivos</button>
          <button className={"rtab" + (right === "changes" ? " on" : "")} onClick={() => setRight("changes")}>Alterações <span className="count">{changes.length}</span></button>
          <button className={"rtab" + (right === "checks" ? " on" : "")} onClick={() => setRight("checks")} data-testid="tab-checks">Checks</button>
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
          {right === "changes" && (changes.length === 0 ? <div className="files-empty">Nenhuma alteração em relação a <code>{ws.target_branch || repo.default_branch}</code>.</div> : changes.map((c) => {
            const dir = c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/") + 1) : "";
            return (
              <div key={c.path} className="file-row" onClick={() => open({ kind: "diff", path: c.path })}>
                <span className="fpath"><span className="dim">{dir}</span>{c.path.slice(dir.length)}</span>
                <span className="grow" />
                {c.added ? <span className="add">+{c.added}</span> : null}
                {c.removed ? <span className="del">-{c.removed}</span> : null}
                {c.untracked && <span className="badge-new">novo</span>}
              </div>
            );
          }))}
          {right === "all" && <FileTree files={allFiles} onOpen={(f) => open({ kind: "file", path: f })} />}
          {right === "checks" && <Checks workspaceId={ws.id} onError={onError} />}
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
              <div className="bottom-body" hidden={bottom !== "terminal"}><TerminalTab ws={ws} visible={bottom === "terminal"} onError={onError} /></div>
              {extraTerms.map((n) => <div key={n} className="bottom-body" hidden={bottom !== `t${n}`}><TerminalTab ws={ws} session={`kabul-${ws.name}-t${n}`} visible={bottom === `t${n}`} onError={onError} /></div>)}
              {bottom === "setup" && <div className="bottom-body"><ScriptsPane ws={ws} repo={repo} which="setup" onError={onError} onConfigure={() => onOpenSettings(repo.id)} /></div>}
              {bottom === "run" && <div className="bottom-body"><ScriptsPane ws={ws} repo={repo} which="run" onError={onError} onConfigure={() => onOpenSettings(repo.id)} /></div>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
