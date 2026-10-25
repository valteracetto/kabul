import { useEffect, useMemo, useRef, useState } from "react";
import { api, wsTitle, type Repo, type Workspace } from "../api";
import { noSuggest } from "../noSuggest";
import { ISearch } from "../icons";
import { setThemePref } from "../theme";
import { cloudList } from "./RunsOn";
import type { Route } from "../App";

export type PaletteTab = "all" | "workspaces" | "projects" | "actions" | "settings";
const TABS: [PaletteTab, string][] = [["all", "Tudo"], ["workspaces", "Workspaces"], ["projects", "Projetos"], ["actions", "Ações"], ["settings", "Configurações"]];

type Item = { group: string; label: string; hint?: string; kbd?: string; run: () => void; tab: PaletteTab; words?: string };

/** Dispara uma ação no workspace atual (tratada pelo WorkspaceView). */
export const wsAction = (ws: string, action: string) => window.dispatchEvent(new CustomEvent("kabul:ws-action", { detail: { ws, action } }));
const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

const SETTINGS: [string, string][] = [["geral", "Geral"], ["contas", "Contas"], ["aparencia", "Aparência"], ["modelos", "Modelos"], ["git", "Git"], ["integracoes", "Integrações"], ["ambiente", "Ambiente"], ["repo", "Scripts do repositório"], ["acoes", "Ações (prompts)"], ["diversos", "Diversos do repositório"], ["remoto", "Máquinas"], ["avancado", "Avançado"], ["atalhos", "Atalhos de teclado"]];

/** Paleta de comandos (⌘K): abas Tudo / Workspaces (ativos e arquivados) / Projetos / Ações / Configurações; Tab e ⇧Tab trocam. */
export function Palette({ repos, workspaces, current, archived, onClose, onRoute, onCreate, onChange }: { repos: Repo[]; workspaces: Workspace[]; current?: Workspace; archived?: boolean; onClose: () => void; onRoute: (r: Route) => void; onCreate: (o: { repo?: string; add?: boolean; from?: "prs" }) => void; onChange: () => void }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<PaletteTab>(archived ? "workspaces" : "all");
  const [archivedTab, setArchivedTab] = useState(!!archived);
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<[string, string, string, string][]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const t = setTimeout(() => api.historySearch(q).then(setHits, () => setHits([])), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => void input.current?.focus(), []);
  const go = (r: Route) => () => onRoute(r);
  const items = useMemo<Item[]>(() => {
    const live = workspaces.filter((w) => !w.archived);
    const repoName = (w: Workspace) => repos.find((r) => r.id === w.repo_id)?.name ?? "";
    const v: Item[] = [];
    // Workspaces
    live.forEach((w) => v.push({ group: "Workspaces", tab: "workspaces", label: wsTitle(w), hint: `${repoName(w)} · ${w.branch}`, run: go({ kind: "workspace", id: w.id }), words: w.name }));
    workspaces.filter((w) => w.archived).forEach((w) => v.push({ group: "Arquivados", tab: "workspaces", label: wsTitle(w), hint: `${repoName(w)} · arquivado`, run: () => api.unarchiveWorkspace(w.id).then(() => (onChange(), onRoute({ kind: "workspace", id: w.id })), () => {}), words: "arquivado desarquivar" }));
    live.flatMap((w) => cloudList(w.id).map((c) => ({ w, c }))).forEach(({ w, c }) => v.push({ group: "Workspaces", tab: "workspaces", label: `☁︎ ${c.info.title ?? c.info.id}`, hint: `nuvem · ${wsTitle(w)}`, run: go({ kind: "workspace", id: w.id }) }));
    // Ações do workspace atual
    if (current) {
      const a = (label: string, action: string, kbd?: string, words?: string) => v.push({ group: `Workspace: ${wsTitle(current)}`, tab: "actions", label, kbd, run: () => wsAction(current.id, action), words });
      a("Abrir arquivo…", "quick-open", "⌘P", "file picker");
      a("Buscar nos arquivos…", "search-files", "⌘⇧F", "grep");
      a("Mostrar alterações", "show-changes", "", "diff changes");
      a("Mostrar checks", "show-checks", "", "ci");
      a("Criar PR", "create-pr", "⌘⇧P", "pull request");
      a("Commit e push", "commit", "⌘⇧Y");
      a("Pull", "pull", "⌘⇧L");
      a("Abrir PR", "open-pr", "⌘⇧G");
      a("Merge do PR", "merge", "⌘⇧M");
      a("Pronto para revisão", "ready", "", "ready for review draft");
      a("Corrigir erros", "fix", "⌘⇧X", "fix errors checks");
      a("Resolver conflitos", "conflicts", "", "merge conflicts");
      a("Revisar as mudanças", "review", "⌘⇧R", "code review");
      a("Nova conversa", "new-chat", "⌘T");
      a("Novo terminal", "new-terminal", "⌘⇧T");
      v.push({ group: `Workspace: ${wsTitle(current)}`, tab: "actions", label: "Copiar link do workspace", kbd: "⌘⇧C", run: () => navigator.clipboard.writeText(`kabul://workspace?id=${current.id}`) });
      v.push({ group: `Workspace: ${wsTitle(current)}`, tab: "actions", label: "Arquivar workspace", kbd: "⌘⇧A", run: () => fire("kabul:archive", current.id) });
    }
    // Ações gerais
    const g = (label: string, run: () => void, kbd?: string, words?: string) => v.push({ group: "Ações", tab: "actions", label, kbd, run, words });
    g("Criar workspace", () => onCreate({ repo: current?.repo_id }), "⌘N", "new");
    g("Criar a partir de PR, branch ou issue", () => onCreate({ from: "prs" }), "⌘⇧N");
    g("Adicionar projeto", () => onCreate({ add: true }), "⌘⌥A", "repo clone github");
    g("Nova seção", () => fire("kabul:new-section"), "", "section");
    g("Novo workspace a partir de issue do Linear", () => fire("kabul:linear"), "", "linear issue");
    g("Alternar tema", () => fire("kabul:cycle-theme"), "⌘⌥T", "theme dark light");
    g("Tema: Escuro", () => setThemePref("dark"), "", "theme");
    g("Tema: Claro", () => setThemePref("light"), "", "theme");
    g("Tema: Sistema", () => setThemePref("system"), "", "theme");
    g("Alternar barra lateral", () => fire("kabul:toggle-sidebar"), "⌘B", "sidebar");
    g("Alternar painel direito", () => current && wsAction(current.id, "toggle-right"), "⌘⌥B", "right panel");
    g("Modo zen", () => fire("kabul:zen"), "⌘.", "zen focus");
    g("Aumentar zoom", () => fire("kabul:zoom", 1), "⌘+");
    g("Diminuir zoom", () => fire("kabul:zoom", -1), "⌘−");
    g("Zoom padrão", () => fire("kabul:zoom", 0), "⌘0");
    g("Enviar feedback", () => fire("kabul:feedback"), "⌘⌥F");
    g("Diagnóstico", go({ kind: "diagnostics" }), "", "diagnostics doctor");
    live.slice(0, 12).forEach((w) => g(`Nova sessão na nuvem (Claude) · ${wsTitle(w)}`, () => (onRoute({ kind: "workspace", id: w.id }), setTimeout(() => fire("kabul:cloud", w.id), 300)), "", "cloud claude --cloud"));
    // Navegação
    const n = (label: string, run: () => void, kbd?: string) => v.push({ group: "Navegação", tab: "all", label, kbd, run });
    n("Ir para o próximo não lido", () => fire("kabul:next-unread"), "⌘⌥L");
    n("Início", go({ kind: "home" }), "⌘⇧H");
    n("Painel de sessões", go({ kind: "sessions" }));
    n("Modelos locais", go({ kind: "local" }));
    n("Ver workspaces arquivados", () => (setTab("workspaces"), setArchivedTab(true)));
    n("Atalhos de teclado", go({ kind: "settings", tab: "atalhos" }), "⌘⌥/");
    // Configurações
    SETTINGS.forEach(([k, label]) => v.push({ group: "Configurações", tab: "settings", label, hint: "configurações", run: go({ kind: "settings", tab: k }), kbd: k === "geral" ? "⌘," : undefined }));
    // Projetos
    repos.forEach((r) => {
      v.push({ group: "Projetos", tab: "projects", label: r.name, hint: "criar workspace", run: () => onCreate({ repo: r.id }), words: r.path });
      v.push({ group: "Projetos", tab: "projects", label: `${r.name}: configurações`, hint: "scripts, git, ambiente", run: go({ kind: "settings", tab: "repo", repoId: r.id }) });
    });
    return v;
  }, [workspaces, repos, current]);

  const n = q.trim().toLowerCase();
  const shown = useMemo(() => {
    let v = items.filter((i) => tab === "all" || i.tab === tab);
    if (tab === "workspaces") v = v.filter((i) => (archivedTab ? i.group === "Arquivados" : i.group !== "Arquivados"));
    else v = v.filter((i) => i.group !== "Arquivados" || n);
    if (tab === "all" && !n) v = v.filter((i) => i.group === "Workspaces" || i.group.startsWith("Workspace:") || i.group === "Navegação").slice(0, 30);
    if (n) v = v.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group} ${i.words ?? ""}`.toLowerCase().includes(n));
    const conv: Item[] = tab === "all" || tab === "workspaces" ? hits.map(([wsId, , title, snip]) => ({ group: "Conversas", tab: "all", label: `💬 ${title}`, hint: snip.replace(/[{}"[\]]/g, " ").slice(0, 60), run: () => onRoute({ kind: "workspace", id: wsId }) })) : [];
    return [...v, ...conv];
  }, [items, tab, archivedTab, n, hits]);
  useEffect(() => setSel(0), [tab, archivedTab, q]);
  useEffect(() => void list.current?.querySelector(".pop-row.on")?.scrollIntoView({ block: "nearest" }), [sel]);
  const pick = (i: Item) => (onClose(), i.run());
  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover palette" onMouseDown={(e) => e.stopPropagation()} data-testid="palette">
        <div className="palette-tabs">
          {TABS.map(([k, label]) => <button key={k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => (setTab(k), input.current?.focus())} data-testid={`pal-tab-${k}`}>{label}</button>)}
          {tab === "workspaces" && <span className="pal-sub"><button className={"text-btn small" + (!archivedTab ? " on" : "")} onClick={() => (setArchivedTab(false), input.current?.focus())}>Ativos</button><button className={"text-btn small" + (archivedTab ? " on" : "")} onClick={() => (setArchivedTab(true), input.current?.focus())} data-testid="pal-archived">Arquivados</button></span>}
        </div>
        <label className="pop-search">
          <ISearch />
          <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} ref={input} placeholder={tab === "all" ? "Digite um comando ou busque…" : `Buscar em ${TABS.find((t) => t[0] === tab)![1].toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Tab") (e.preventDefault(), setTab(TABS[(TABS.findIndex((t) => t[0] === tab) + (e.shiftKey ? TABS.length - 1 : 1)) % TABS.length][0]));
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, shown.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter" && shown[sel]) pick(shown[sel]);
            }} data-testid="palette-input" />
        </label>
        <div className="pop-sep" />
        <div className="pop-list" ref={list}>
          {n && shown.length > 0 && <div className="pop-title pal-results">Resultados para “{q}”</div>}
          {shown.map((i, k) => {
            const head = i.group !== lastGroup ? (lastGroup = i.group) : null;
            return (
              <div key={k}>
                {head && <div className="pop-title pal-group">{head}</div>}
                <div className={"pop-row" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => pick(i)} data-testid="pal-row">
                  <span className="label">{i.label}</span><span className="grow" />{i.hint && <span className="dim">{i.hint}</span>}{i.kbd && <span className="kbd-hint">{i.kbd}</span>}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div className="pop-row dim">{n ? `Nada encontrado para “${q}”` : tab === "workspaces" && archivedTab ? "Nenhum workspace arquivado" : "Nada aqui"}</div>}
        </div>
      </div>
    </div>
  );
}
