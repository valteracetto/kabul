import { useEffect, useMemo, useRef, useState } from "react";
import { api, wsTitle, type Repo, type Workspace } from "../api";
import { noSuggest } from "../noSuggest";
import { ISearch } from "../icons";
import { setThemePref } from "../theme";
import { cloudList } from "./RunsOn";
import { checkForUpdates } from "./Updates";
import type { Route } from "../App";
import { t } from "../i18n";

export type PaletteTab = "all" | "workspaces" | "projects" | "actions" | "settings";
const tabs = (): [PaletteTab, string][] => [["all", t("app.pal.tab.all")], ["workspaces", t("app.pal.tab.workspaces")], ["projects", t("app.pal.tab.projects")], ["actions", t("app.pal.tab.actions")], ["settings", t("app.pal.tab.settings")]];

/** `kind` separa os grupos sem depender do texto (que muda com o idioma). */
type Item = { group: string; label: string; hint?: string; kbd?: string; run: () => void; tab: PaletteTab; words?: string; kind?: "ws" | "archived" | "current" | "nav" };

/** Dispara uma ação no workspace atual (tratada pelo WorkspaceView). */
export const wsAction = (ws: string, action: string) => window.dispatchEvent(new CustomEvent("kabul:ws-action", { detail: { ws, action } }));
const fire = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

const settingsTabs = (): [string, string][] => [["geral", t("app.pal.set.geral")], ["contas", t("app.pal.set.contas")], ["aparencia", t("app.pal.set.aparencia")], ["modelos", t("app.pal.set.modelos")], ["git", t("app.pal.set.git")], ["integracoes", t("app.pal.set.integracoes")], ["ambiente", t("app.pal.set.ambiente")], ["repo", t("app.pal.set.repo")], ["acoes", t("app.pal.set.acoes")], ["diversos", t("app.pal.set.diversos")], ["remoto", t("app.pal.set.remoto")], ["avancado", t("app.pal.set.avancado")], ["atalhos", t("app.help.shortcuts")]];

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
    const timer = setTimeout(() => api.historySearch(q).then(setHits, () => setHits([])), 150);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => void input.current?.focus(), []);
  const go = (r: Route) => () => onRoute(r);
  const items = useMemo<Item[]>(() => {
    const live = workspaces.filter((w) => !w.archived);
    const repoName = (w: Workspace) => repos.find((r) => r.id === w.repo_id)?.name ?? "";
    const v: Item[] = [];
    // Workspaces
    live.forEach((w) => v.push({ group: t("app.pal.group.workspaces"), kind: "ws", tab: "workspaces", label: wsTitle(w), hint: `${repoName(w)} · ${w.branch}`, run: go({ kind: "workspace", id: w.id }), words: w.name }));
    workspaces.filter((w) => w.archived).forEach((w) => v.push({ group: t("app.pal.group.archived"), kind: "archived", tab: "workspaces", label: wsTitle(w), hint: `${repoName(w)} · ${t("app.pal.archivedHint")}`, run: () => api.unarchiveWorkspace(w.id).then(() => (onChange(), onRoute({ kind: "workspace", id: w.id })), () => {}), words: t("app.pal.archivedWords") }));
    live.flatMap((w) => cloudList(w.id).map((c) => ({ w, c }))).forEach(({ w, c }) => v.push({ group: t("app.pal.group.workspaces"), kind: "ws", tab: "workspaces", label: `☁︎ ${c.info.title ?? c.info.id}`, hint: t("app.pal.cloudHint", { ws: wsTitle(w) }), run: go({ kind: "workspace", id: w.id }) }));
    // Ações do workspace atual
    if (current) {
      const a = (label: string, action: string, kbd?: string, words?: string) => v.push({ group: t("app.pal.group.current", { ws: wsTitle(current) }), kind: "current", tab: "actions", label, kbd, run: () => wsAction(current.id, action), words });
      a(t("app.pal.a.quickOpen"), "quick-open", "⌘P", "file picker");
      a(t("app.pal.a.searchFiles"), "search-files", "⌘⇧F", "grep");
      a(t("app.pal.a.showChanges"), "show-changes", "", "diff changes");
      a(t("app.pal.a.showChecks"), "show-checks", "", "ci");
      a(t("app.pal.a.createPr"), "create-pr", "⌘⇧P", "pull request");
      a(t("app.pal.a.commit"), "commit", "⌘⇧Y");
      a(t("app.pal.a.pull"), "pull", "⌘⇧L");
      a(t("app.pal.a.openPr"), "open-pr", "⌘⇧G");
      a(t("app.pal.a.merge"), "merge", "⌘⇧M");
      a(t("app.pal.a.ready"), "ready", "", "ready for review draft");
      a(t("app.pal.a.fix"), "fix", "⌘⇧X", "fix errors checks");
      a(t("app.pal.a.conflicts"), "conflicts", "", "merge conflicts");
      a(t("app.pal.a.review"), "review", "⌘⇧R", "code review");
      a(t("common.newChat"), "new-chat", "⌘T");
      a(t("app.pal.a.newTerminal"), "new-terminal", "⌘⇧T");
      v.push({ group: t("app.pal.group.current", { ws: wsTitle(current) }), kind: "current", tab: "actions", label: t("app.pal.a.copyLink"), kbd: "⌘⇧C", run: () => navigator.clipboard.writeText(`kabul://workspace?id=${current.id}`) });
      v.push({ group: t("app.pal.group.current", { ws: wsTitle(current) }), kind: "current", tab: "actions", label: t("app.pal.a.archive"), kbd: "⌘⇧A", run: () => fire("kabul:archive", current.id) });
    }
    // Ações gerais
    const g = (label: string, run: () => void, kbd?: string, words?: string) => v.push({ group: t("app.pal.group.actions"), tab: "actions", label, kbd, run, words });
    g(t("app.pal.g.createWorkspace"), () => onCreate({ repo: current?.repo_id }), "⌘N", "new");
    g(t("app.pal.g.createFrom"), () => onCreate({ from: "prs" }), "⌘⇧N");
    g(t("app.create.addProject"), () => onCreate({ add: true }), "⌘⌥A", "repo clone github");
    g(t("app.pal.g.newSection"), () => fire("kabul:new-section"), "", "section");
    g(t("app.pal.g.fromLinear"), () => fire("kabul:linear"), "", "linear issue");
    g(t("app.pal.g.cycleTheme"), () => fire("kabul:cycle-theme"), "⌘⌥T", "theme dark light");
    g(t("app.pal.g.themeDark"), () => setThemePref("dark"), "", "theme");
    g(t("app.pal.g.themeLight"), () => setThemePref("light"), "", "theme");
    g(t("app.pal.g.themeSystem"), () => setThemePref("system"), "", "theme");
    g(t("app.pal.g.toggleSidebar"), () => fire("kabul:toggle-sidebar"), "⌘B", "sidebar");
    g(t("app.pal.g.toggleRight"), () => current && wsAction(current.id, "toggle-right"), "⌘⌥B", "right panel");
    g(t("app.pal.g.zen"), () => fire("kabul:zen"), "⌘.", "zen focus");
    g(t("app.pal.g.zoomIn"), () => fire("kabul:zoom", 1), "⌘+");
    g(t("app.pal.g.zoomOut"), () => fire("kabul:zoom", -1), "⌘−");
    g(t("app.pal.g.zoomReset"), () => fire("kabul:zoom", 0), "⌘0");
    g(t("app.feedback.title"), () => fire("kabul:feedback"), "⌘⌥F");
    g(t("app.pal.g.diagnostics"), go({ kind: "diagnostics" }), "", "diagnostics doctor");
    g(t("settings.updates.check"), () => checkForUpdates(), "", "update upgrade version release");
    live.slice(0, 12).forEach((w) => g(t("app.pal.g.cloudSession", { ws: wsTitle(w) }), () => (onRoute({ kind: "workspace", id: w.id }), setTimeout(() => fire("kabul:cloud", w.id), 300)), "", "cloud claude --cloud"));
    // Navegação
    const n = (label: string, run: () => void, kbd?: string) => v.push({ group: t("app.pal.group.nav"), kind: "nav", tab: "all", label, kbd, run });
    n(t("app.pal.n.nextUnread"), () => fire("kabul:next-unread"), "⌘⌥L");
    n(t("app.pal.n.home"), go({ kind: "home" }), "⌘⇧H");
    n(t("app.pal.n.sessions"), go({ kind: "sessions" }));
    n(t("app.pal.n.local"), go({ kind: "local" }));
    n(t("app.pal.n.archived"), () => (setTab("workspaces"), setArchivedTab(true)));
    n(t("app.help.shortcuts"), go({ kind: "settings", tab: "atalhos" }), "⌘⌥/");
    // Configurações
    settingsTabs().forEach(([k, label]) => v.push({ group: t("app.pal.group.settings"), tab: "settings", label, hint: t("app.pal.settingsHint"), run: go({ kind: "settings", tab: k }), kbd: k === "geral" ? "⌘," : undefined }));
    // Projetos
    repos.forEach((r) => {
      v.push({ group: t("app.pal.group.projects"), tab: "projects", label: r.name, hint: t("app.pal.createWsHint"), run: () => onCreate({ repo: r.id }), words: r.path });
      v.push({ group: t("app.pal.group.projects"), tab: "projects", label: t("app.pal.repoSettings", { repo: r.name }), hint: t("app.pal.repoSettingsHint"), run: go({ kind: "settings", tab: "repo", repoId: r.id }) });
    });
    return v;
  }, [workspaces, repos, current]);

  const n = q.trim().toLowerCase();
  const shown = useMemo(() => {
    let v = items.filter((i) => tab === "all" || i.tab === tab);
    if (tab === "workspaces") v = v.filter((i) => (archivedTab ? i.kind === "archived" : i.kind !== "archived"));
    else v = v.filter((i) => i.kind !== "archived" || n);
    if (tab === "all" && !n) v = v.filter((i) => i.kind === "ws" || i.kind === "current" || i.kind === "nav").slice(0, 30);
    if (n) v = v.filter((i) => `${i.label} ${i.hint ?? ""} ${i.group} ${i.words ?? ""}`.toLowerCase().includes(n));
    const conv: Item[] = tab === "all" || tab === "workspaces" ? hits.map(([wsId, , title, snip]) => ({ group: t("app.pal.group.chats"), tab: "all", label: `💬 ${title}`, hint: snip.replace(/[{}"[\]]/g, " ").slice(0, 60), run: () => onRoute({ kind: "workspace", id: wsId }) })) : [];
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
          {tabs().map(([k, label]) => <button key={k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => (setTab(k), input.current?.focus())} data-testid={`pal-tab-${k}`}>{label}</button>)}
          {tab === "workspaces" && <span className="pal-sub"><button className={"text-btn small" + (!archivedTab ? " on" : "")} onClick={() => (setArchivedTab(false), input.current?.focus())}>{t("app.pal.active")}</button><button className={"text-btn small" + (archivedTab ? " on" : "")} onClick={() => (setArchivedTab(true), input.current?.focus())} data-testid="pal-archived">{t("app.pal.group.archived")}</button></span>}
        </div>
        <label className="pop-search">
          <ISearch />
          <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} ref={input} placeholder={tab === "all" ? t("app.pal.placeholder") : t("app.pal.searchIn", { where: tabs().find((x) => x[0] === tab)![1].toLowerCase() })} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Tab") (e.preventDefault(), setTab(tabs()[(tabs().findIndex((x) => x[0] === tab) + (e.shiftKey ? tabs().length - 1 : 1)) % tabs().length][0]));
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, shown.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter" && shown[sel]) pick(shown[sel]);
            }} data-testid="palette-input" />
        </label>
        <div className="pop-sep" />
        <div className="pop-list" ref={list}>
          {n && shown.length > 0 && <div className="pop-title pal-results">{t("app.pal.results", { q })}</div>}
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
          {shown.length === 0 && <div className="pop-row dim">{n ? t("app.pal.nothingFor", { q }) : tab === "workspaces" && archivedTab ? t("app.pal.noArchived") : t("app.pal.nothingHere")}</div>}
        </div>
      </div>
    </div>
  );
}
