import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type LinearIssue, type Model, type Repo, type Workspace } from "../api";
import { ModelPicker } from "./ModelPicker";
import { useModelPrefs } from "./prefs";
import { popoverOpen, useDismiss } from "./useDismiss";
import { useSettings } from "./useSettings";
import { RunsOnBadge, type RunsOn } from "./RunsOn";
import { IChevronDown, IMore, IPlus, ISearch, RepoMark } from "../icons";
import { CloneDialog, QuickStartDialog } from "./CloneDialog";

const IFolder = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"><path d="M1.8 4.2c0-.5.4-.9.9-.9h3.2l1.3 1.4h6.1c.5 0 .9.4.9.9v6.3c0 .5-.4.9-.9.9H2.7a.9.9 0 0 1-.9-.9Z" /></svg>;
const IGlobe = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.8" /><path d="M2.2 8h11.6M8 2.2c1.6 1.7 2.4 3.6 2.4 5.8S9.6 12.1 8 13.8C6.4 12.1 5.6 10.2 5.6 8S6.4 3.9 8 2.2Z" /></svg>;

/** Submenu de "Adicionar projeto": 3 itens, o primeiro destacado; ↑↓ e ↵ escolhem, Esc volta à lista de repos. */
function AddMenu({ busy, canBack, onBack, onOpen, onGitHub, onQuick }: { busy: boolean; canBack: boolean; onBack: () => void; onOpen: () => void; onGitHub: () => void; onQuick: () => void }) {
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const items: [string, React.ReactNode, () => void, string][] = [["Abrir projeto", <IFolder />, onOpen, "add-open"], ["Abrir projeto do GitHub", <IGlobe />, onGitHub, "add-github"], ["Início rápido", <IFolderPlus />, onQuick, "add-quick"]];
  return (
    <div className="add-menu" ref={ref} tabIndex={-1} data-testid="add-menu"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") (e.preventDefault(), setSel((x) => (x + 1) % 3));
        else if (e.key === "ArrowUp") (e.preventDefault(), setSel((x) => (x + 2) % 3));
        else if (e.key === "Enter") (e.preventDefault(), items[sel][2]());
        else if (e.key === "Escape" && canBack) (e.preventDefault(), e.stopPropagation(), onBack());
      }}>
      {items.map(([label, icon, run, id], k) => (
        <div key={id} className={"pop-row" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => !busy && run()} data-testid={id}>{icon} {label}{busy && k === 0 && <span className="spinner tiny" />}</div>
      ))}
    </div>
  );
}

const IFolderPlus = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1.8 4.2c0-.5.4-.9.9-.9h3.2l1.3 1.4h6.1c.5 0 .9.4.9.9v6.3c0 .5-.4.9-.9.9H2.7a.9.9 0 0 1-.9-.9Z" /><path d="M8 7v4M6 9h4" /></svg>;

type Source = { kind: "pr"; number: number; title: string; head: string } | { kind: "branch"; name: string } | { kind: "issue"; issue: LinearIssue };
type Where = "local" | "provider_cloud" | "remote" | "kabul_cloud";
const whereKey = (repo: string) => `kabul.create.where.${repo}`;

/** Pendente para o workspace recém-criado: primeira mensagem e onde rodar. */
export const pendingFirst: Record<string, { text: string; where: Where; send: boolean; plan?: boolean }> = {};

export function CreateModal({ repos, defaultRepo, fromTab, addMode, onClose, onCreated, onReposChanged, onError }: {
  repos: Repo[]; defaultRepo?: string; fromTab?: "prs" | "branches" | "issues"; addMode?: boolean; onClose: () => void;
  onCreated: (w: Workspace) => void; onReposChanged: () => void; onError: (e: string) => void;
}) {
  const [repoId, setRepoId] = useState(defaultRepo ?? repos[0]?.id ?? "");
  // Os repos podem chegar depois de o modal abrir (app recém-aberto): escolhe o padrão quando chegarem.
  useEffect(() => void (!repoId && repos.length && setRepoId(defaultRepo ?? repos[0].id)), [repos, repoId, defaultRepo]);
  const [repoOpen, setRepoOpen] = useState(!!addMode);
  const [adding, setAdding] = useState(!!addMode);
  const [addBusy, setAddBusy] = useState(false);
  const [dialog, setDialog] = useState<"clone" | "quick" | null>(null);
  const added = (r: Repo) => {
    onReposChanged();
    setRepoId(r.id);
    setDialog(null);
    setAdding(false);
    setRepoOpen(false);
    setTimeout(() => input.current?.focus(), 0);
  };
  const addProject = async (p: string | null) => {
    if (!p) return;
    setAddBusy(true);
    try {
      const r = await (/^(https?:\/\/|git@)/.test(p) ? api.cloneRepo(p) : api.addRepo(p));
      onReposChanged();
      setRepoId(r.id);
      setAdding(false);
      setRepoOpen(false);
      setTimeout(() => input.current?.focus(), 0);
    } catch (e) {
      onError(String(e));
    } finally {
      setAddBusy(false);
    }
  };
  const [repoQ, setRepoQ] = useState("");
  // Plan mode na primeira mensagem: ⇧⇥ no campo; o estado inicial vem de "Conversas novas em plan mode".
  const appSet = useSettings();
  const [plan, setPlan] = useState(false);
  const planInit = useRef(false);
  useEffect(() => void (appSet && !planInit.current && ((planInit.current = true), appSet.default_plan && setPlan(true))), [appSet]);
  const [more, setMore] = useState(false);
  const [from, setFrom] = useState<"prs" | "branches" | "issues" | null>(fromTab ?? null);
  const [text, setText] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [prs, setPrs] = useState<Awaited<ReturnType<typeof api.repoPrs>>>([]);
  const [issues, setIssues] = useState<LinearIssue[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [fromQ, setFromQ] = useState("");
  const [where, setWhere] = useState<Where>(() => (localStorage.getItem(whereKey(defaultRepo ?? repos[0]?.id ?? "")) as Where) || "local");
  const [whereOpen, setWhereOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const { prefs, setPrefs, selected, effort } = useModelPrefs(models);
  const repo = repos.find((r) => r.id === repoId);
  const input = useRef<HTMLTextAreaElement>(null);
  const repoRef = useRef<HTMLDivElement>(null), moreRef = useRef<HTMLDivElement>(null), whereRef = useRef<HTMLDivElement>(null);
  // Esc no submenu "Adicionar projeto" volta à lista; clique fora fecha tudo.
  useDismiss(repoRef, repoOpen, (why) => (why === "esc" && adding && repos.length > 0 ? setAdding(false) : (setRepoOpen(false), setAdding(false))));
  useDismiss(moreRef, more, () => setMore(false));
  useDismiss(whereRef, whereOpen, () => setWhereOpen(false));

  useEffect(() => void api.models().then(setModels, () => {}), []);
  // Esc fecha mesmo sem foco dentro do modal (ex.: depois de adicionar um projeto).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.activeElement?.closest(".create-modal")) return;
      if (more || repoOpen || whereOpen) return;
      from ? setFrom(null) : onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [more, repoOpen, whereOpen, from, onClose]);
  useEffect(() => void (!adding && input.current?.focus()), [from]);
  useEffect(() => {
    if (!repoId) return;
    setWhere((localStorage.getItem(whereKey(repoId)) as Where) || "local");
    api.repoBranches(repoId).then(setBranches, () => setBranches([]));
  }, [repoId]);
  useEffect(() => {
    if (from === "prs" && repoId) api.repoPrs(repoId).then(setPrs, (e) => (setPrs([]), onError(String(e))));
    if (from === "issues" && issues === null) api.linearStatus().then((s) => (s.connected ? api.linearIssues(null).then(setIssues, () => setIssues([])) : setIssues([])), () => setIssues([]));
  }, [from, repoId]);

  const cloudOk = selected?.harness === "claude" && !selected.local;
  useEffect(() => void (models.length > 0 && where === "provider_cloud" && !cloudOk && setWhere("local")), [cloudOk, models.length]);
  const pickWhere = (w: Where) => (setWhere(w), localStorage.setItem(whereKey(repoId), w), setWhereOpen(false));

  const create = async (send: boolean) => {
    if (!repo) return onError("Escolha um repositório.");
    setBusy(true);
    try {
      let w: Workspace;
      if (source?.kind === "issue") w = await api.workspaceFromIssue(repo.id, source.issue);
      else if (source?.kind === "pr") w = await api.createWorkspaceEx(repo.id, { pr: source.number, prHead: source.head });
      else if (source?.kind === "branch") w = await api.createWorkspaceEx(repo.id, { branch: source.name });
      else w = await api.createWorkspaceEx(repo.id, { base });
      const issueCtx = source?.kind === "issue" ? `Issue ${source.issue.identifier}: ${source.issue.title} (${source.issue.url}). Detalhes em .context/[LINEAR]-${source.issue.identifier}.md\n\n` : "";
      const first = (issueCtx + text).trim();
      if (first) pendingFirst[w.id] = { text: first, where, send, plan };
      onCreated(w);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const fromItems = useMemo(() => {
    const q = fromQ.toLowerCase();
    if (from === "prs") return prs.filter((p) => `#${p.number} ${p.title} ${p.headRefName}`.toLowerCase().includes(q)).map((p) => ({ key: `pr${p.number}`, label: `#${p.number} ${p.title}`, hint: p.headRefName, pick: { kind: "pr", number: p.number, title: p.title, head: p.headRefName } as Source }));
    if (from === "branches") return branches.filter((b) => b.toLowerCase().includes(q)).map((b) => ({ key: b, label: b, hint: "", pick: { kind: "branch", name: b } as Source }));
    if (from === "issues") return (issues ?? []).filter((i) => `${i.identifier} ${i.title}`.toLowerCase().includes(q)).map((i) => ({ key: i.id, label: `${i.identifier} ${i.title}`, hint: i.state ?? "", pick: { kind: "issue", issue: i } as Source }));
    return [];
  }, [from, fromQ, prs, branches, issues]);
  const tabs: ("prs" | "branches" | "issues")[] = ["prs", "branches", "issues"];
  const whereOpts: [Where, string, RunsOn, boolean, string][] = [
    ["local", "Este Mac", { kind: "local" }, true, ""],
    ["provider_cloud", "Nuvem do provedor", { kind: "provider_cloud", provider: "claude" }, cloudOk, cloudOk ? "claude --cloud" : "o agente escolhido não tem nuvem"],
    ["remote", "Outra máquina (Tailscale)", { kind: "remote", host: "—" }, false, "em breve"],
    ["kabul_cloud", "Nuvem Kabul", { kind: "kabul_cloud", host: "—" }, false, "em breve"],
  ];
  const whereLabel = whereOpts.find((o) => o[0] === where)!;
  // Esc fecha o modal (ou o painel "Criar a partir de") mesmo sem foco dentro dele; popovers abertos fecham antes.
  const escRef = useRef(() => {});
  escRef.current = () => (from ? setFrom(null) : onClose());
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && !popoverOpen() && !dialog && (e.preventDefault(), escRef.current());
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [dialog]);

  return (
    <div className="overlay create-overlay" onMouseDown={onClose}>
      <div className="popover create-modal" onMouseDown={(e) => e.stopPropagation()} data-testid="create-modal"
        onKeyDown={(e) => {
          if (e.key === "N" && e.metaKey && e.shiftKey) (e.preventDefault(), setFrom(from ? null : "prs"));
          if (e.key === "Tab" && from) (e.preventDefault(), setFrom(tabs[(tabs.indexOf(from) + (e.shiftKey ? 2 : 1)) % 3]));
        }}>
        <div className="create-top">
          <div className="picker" ref={repoRef}>
            <button className="create-repo" onClick={() => setRepoOpen(!repoOpen)} data-testid="create-repo">{repo && <RepoMark name={repo.name} />}{repo?.name ?? "Escolha um projeto"} <IChevronDown size={12} /></button>
            {repoOpen && (
              <div className="popover status-pop repo-pop" data-testid="repo-pop">
                {adding ? (
                  <AddMenu busy={addBusy} canBack={repos.length > 0} onBack={() => setAdding(false)}
                    onOpen={async () => addProject(await api.pickFolder())} onGitHub={() => setDialog("clone")} onQuick={() => setDialog("quick")} />
                ) : (
                  <>
                    <div className="repo-search"><input autoFocus placeholder="Buscar…" value={repoQ} onChange={(e) => setRepoQ(e.target.value)} /></div>
                    <div className="repo-list">
                      {repos.filter((r) => r.name.toLowerCase().includes(repoQ.toLowerCase())).map((r) => (
                        <div key={r.id} className={"pop-row" + (r.id === repoId ? " on" : "")} onClick={() => (setRepoId(r.id), setRepoOpen(false), setBase(null), setSource(null))}><RepoMark name={r.name} size={18} /> {r.name}</div>
                      ))}
                    </div>
                    <div className="repo-foot pop-row" onClick={() => setAdding(true)} data-testid="add-project"><IFolderPlus /> Adicionar projeto</div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="picker" ref={moreRef}>
            <button className={"icon-btn" + (more ? " on" : "")} title="Opções" onClick={() => setMore(!more)} data-testid="create-more"><IMore /></button>
            {more && (
              <div className="popover status-pop more-pop">
                <div className="pop-title">Branch de destino (base)</div>
                <select value={base ?? repo?.default_branch ?? ""} onChange={(e) => setBase(e.target.value === repo?.default_branch ? null : e.target.value)} data-testid="create-base">
                  {[repo?.default_branch, ...branches.filter((b) => b !== repo?.default_branch)].filter(Boolean).map((b) => <option key={b} value={b!}>{b}</option>)}
                </select>
              </div>
            )}
          </div>
          {source && <span className="source-chip" data-testid="create-source">{source.kind === "pr" ? `PR #${source.number}` : source.kind === "branch" ? source.name : source.issue.identifier}<button className="text-btn" onClick={() => setSource(null)}>×</button></span>}
          {base && !source && <span className="source-chip dim">base: {base}</span>}
          <span className="grow" />
          <button className={"create-from-btn" + (from ? " on" : "")} title="Criar a partir de PR, branch ou issue (⌘⇧N)" onClick={() => setFrom(from ? null : "prs")} data-testid="create-from">
            <span className="from-icons"><span className="fi linear">L</span><span className="fi gh">GH</span></span><IChevronDown size={12} />
          </button>
        </div>
        {from ? (
          <div className="create-from" data-testid="create-from-panel">
            <div className="row">
              {tabs.map((t) => <button key={t} className={"rtab" + (from === t ? " on" : "")} onClick={() => setFrom(t)}>{{ prs: "PRs", branches: "Branches", issues: "Issues" }[t]}</button>)}
              <span className="grow" /><span className="dim small">Tab / ⇧Tab</span>
            </div>
            <label className="pop-search"><ISearch /><input autoFocus placeholder="Filtrar" value={fromQ} onChange={(e) => setFromQ(e.target.value)} /></label>
            <div className="pop-list">
              {fromItems.map((i) => <div key={i.key} className="pop-row" onClick={() => (setSource(i.pick), setFrom(null))} data-testid="create-from-item"><span className="label">{i.label}</span><span className="grow" /><span className="dim small">{i.hint}</span></div>)}
              {from === "issues" && issues?.length === 0 && <div className="pop-row dim">Conecte o Linear em Configurações › Integrações.</div>}
              {from !== "issues" && fromItems.length === 0 && <div className="pop-row dim">Nada encontrado.</div>}
            </div>
          </div>
        ) : (
          <textarea ref={input} className={"create-body" + (plan ? " plan" : "")} placeholder={plan ? "Descreva o que planejar…" : "No que você quer trabalhar?"} value={text} onChange={(e) => setText(e.target.value)} data-testid="create-text"
            onKeyDown={(e) => {
              if (e.key === "Tab" && e.shiftKey) return (e.preventDefault(), setPlan((p) => !p));
              if (e.key === "Enter" && e.altKey) (e.preventDefault(), create(false));
              else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), create(true));
            }} />
        )}
        <div className="create-foot">
          <ModelPicker models={models} prefs={prefs} setPrefs={setPrefs} selected={selected} effort={effort} activeHarness={null} />
          <div className="picker" ref={whereRef}>
            <button className="where-btn" onClick={() => setWhereOpen(!whereOpen)} title="Onde roda" data-testid="create-where">{where === "local" ? "💻" : <RunsOnBadge r={whereLabel[2]} />} {whereLabel[1]} <IChevronDown size={11} /></button>
            {whereOpen && (
              <div className="popover status-pop where-pop">
                {whereOpts.map(([k, label, r, enabled, hint]) => (
                  <div key={k} className={"pop-row" + (k === where ? " on" : "") + (enabled ? "" : " disabled")} onClick={() => enabled && pickWhere(k)} data-testid={`where-${k}`}>
                    <span className="where-ico">{k === "local" ? "💻" : <RunsOnBadge r={r} />}</span>{label}<span className="grow" /><span className="dim small">{hint}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {plan && <button className="plan-chip" onClick={() => setPlan(false)} title="Sair do plan mode (⇧⇥)" data-testid="create-plan-chip">Plan mode ×</button>}
          <span className="grow" />
          <span className="dim small">⌥↵ backlog</span>
          <button className="icon-btn" title="Criar a partir de… (⌘⇧N)" onClick={() => setFrom("prs")}><IPlus /></button>
          <button className="btn primary create-go" disabled={busy || !repo} onClick={() => create(true)} data-testid="create-go">{busy ? "Criando…" : "Criar ↵"}</button>
        </div>
        {/* No portal: no DOM ficam no body; na árvore do React, dentro do modal (o clique não fecha o modal). */}
        {dialog === "clone" && createPortal(<CloneDialog onClose={() => setDialog(null)} onDone={added} />, document.body)}
        {dialog === "quick" && createPortal(<QuickStartDialog onClose={() => setDialog(null)} onDone={added} />, document.body)}
      </div>
    </div>
  );
}
