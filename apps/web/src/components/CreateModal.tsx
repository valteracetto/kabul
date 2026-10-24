import { useEffect, useMemo, useRef, useState } from "react";
import { api, type LinearIssue, type Model, type Repo, type Workspace } from "../api";
import { ModelPicker } from "./ModelPicker";
import { useModelPrefs } from "./prefs";
import { useDismiss } from "./useDismiss";
import { RunsOnBadge, type RunsOn } from "./RunsOn";
import { IChevronDown, IMore, IPlus, ISearch, RepoMark } from "../icons";

const IFolderPlus = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1.8 4.2c0-.5.4-.9.9-.9h3.2l1.3 1.4h6.1c.5 0 .9.4.9.9v6.3c0 .5-.4.9-.9.9H2.7a.9.9 0 0 1-.9-.9Z" /><path d="M8 7v4M6 9h4" /></svg>;

type Source = { kind: "pr"; number: number; title: string; head: string } | { kind: "branch"; name: string } | { kind: "issue"; issue: LinearIssue };
type Where = "local" | "provider_cloud" | "remote" | "kabul_cloud";
const whereKey = (repo: string) => `kabul.create.where.${repo}`;

/** Pendente para o workspace recém-criado: primeira mensagem e onde rodar. */
export const pendingFirst: Record<string, { text: string; where: Where; send: boolean }> = {};

export function CreateModal({ repos, defaultRepo, fromTab, addMode, onClose, onCreated, onReposChanged, onError }: {
  repos: Repo[]; defaultRepo?: string; fromTab?: "prs" | "branches" | "issues"; addMode?: boolean; onClose: () => void;
  onCreated: (w: Workspace) => void; onReposChanged: () => void; onError: (e: string) => void;
}) {
  const [repoId, setRepoId] = useState(defaultRepo ?? repos[0]?.id ?? "");
  const [repoOpen, setRepoOpen] = useState(!!addMode);
  const [adding, setAdding] = useState(!!addMode);
  const [path, setPath] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addProject = async (p: string | null) => {
    if (!p) return;
    setAddBusy(true);
    try {
      const r = await (/^(https?:\/\/|git@)/.test(p) ? api.cloneRepo(p) : api.addRepo(p));
      onReposChanged();
      setRepoId(r.id);
      setAdding(false);
      setRepoOpen(false);
      setPath("");
      setTimeout(() => input.current?.focus(), 0);
    } catch (e) {
      onError(String(e));
    } finally {
      setAddBusy(false);
    }
  };
  const [repoQ, setRepoQ] = useState("");
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
  useDismiss(repoRef, repoOpen, () => (setRepoOpen(false), setAdding(false)));
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
      if (first) pendingFirst[w.id] = { text: first, where, send };
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

  return (
    <div className="overlay create-overlay" onMouseDown={onClose}>
      <div className="popover create-modal" onMouseDown={(e) => e.stopPropagation()} data-testid="create-modal"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !(more || repoOpen || whereOpen)) (e.preventDefault(), from ? setFrom(null) : onClose());
          if (e.key === "N" && e.metaKey && e.shiftKey) (e.preventDefault(), setFrom(from ? null : "prs"));
          if (e.key === "Tab" && from) (e.preventDefault(), setFrom(tabs[(tabs.indexOf(from) + (e.shiftKey ? 2 : 1)) % 3]));
        }}>
        <div className="create-top">
          <div className="picker" ref={repoRef}>
            <button className="create-repo" onClick={() => setRepoOpen(!repoOpen)} data-testid="create-repo">{repo && <RepoMark name={repo.name} />}{repo?.name ?? "Escolha um projeto"} <IChevronDown size={12} /></button>
            {repoOpen && (
              <div className="popover status-pop repo-pop" data-testid="repo-pop">
                {adding ? (
                  <div className="add-project">
                    <div className="pop-title">Adicionar projeto: pasta git local ou URL para clonar</div>
                    <input autoFocus placeholder="~/projetos/app ou https://github.com/org/repo" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") (e.preventDefault(), addProject(path.trim())); if (e.key === "Escape") (e.stopPropagation(), setAdding(false)); }} data-testid="repo-path" />
                    <div className="row">
                      <button className="btn" disabled={addBusy} onClick={async () => addProject(await api.pickFolder())}>Escolher pasta…</button>
                      <span className="grow" />
                      {repos.length > 0 && <button className="btn" onClick={() => setAdding(false)}>Voltar</button>}
                      <button className="btn primary" disabled={addBusy || !path.trim()} onClick={() => addProject(path.trim())}>{addBusy ? "Adicionando…" : /^(https?:\/\/|git@)/.test(path) ? "Clonar" : "Adicionar"}</button>
                    </div>
                  </div>
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
          <textarea ref={input} className="create-body" placeholder="No que você quer trabalhar?" value={text} onChange={(e) => setText(e.target.value)} data-testid="create-text"
            onKeyDown={(e) => {
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
          <span className="grow" />
          <span className="dim small">⌥↵ backlog</span>
          <button className="icon-btn" title="Criar a partir de… (⌘⇧N)" onClick={() => setFrom("prs")}><IPlus /></button>
          <button className="btn primary create-go" disabled={busy || !repo} onClick={() => create(true)} data-testid="create-go">{busy ? "Criando…" : "Criar ↵"}</button>
        </div>
      </div>
    </div>
  );
}
