import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ToolFinding, type ToolItem, type ToolItemDetail, type ToolScope, type ToolsSnapshot } from "../api";
import { Markdown } from "../components/Markdown";
import { usePopover } from "../components/useDismiss";
import {
  byCategory, catLabel, findingTitle, findingWhy, fmtTokens, harnessLabel, howLabel, kindLabel, kindPlural, matches, placeState, riskLabel, sevLabel, sourceKindLabel, sourceLabel, STATE_GLYPH, stateLabel, tr, whatLabel, type PlaceState,
} from "../components/tools";
import { ICopy, IFolder, ISearch } from "../icons";
import { noSuggest } from "../noSuggest";
import { t } from "../i18n";
import { fmtDate } from "../i18n/format";
import "./ToolsView.css";

export type ToolsTab = "catalog" | "matrix" | "sources" | "health";
const TABS: ToolsTab[] = ["catalog", "matrix", "sources", "health"];
const SCOPES: ToolScope[] = ["global", "repo", "all"];
const SCOPE_KEY = "kabul.tools.scope";
const STATE_RANK: Record<PlaceState, number> = { broken: 6, drift: 5, copy: 4, link: 3, managed: 2, canonical: 1 };

/** Pior estado do item numa IA (para o selo do cartão e a célula da matriz). */
function worstState(it: ToolItem, harness: string, findings: ToolFinding[]): PlaceState | null {
  let best: PlaceState | null = null;
  for (const p of it.placements.filter((p) => p.harness === harness)) {
    const s = placeState(p, findings, it.id);
    if (!best || STATE_RANK[s] > STATE_RANK[best]) best = s;
  }
  return best;
}

/** Tela Ferramentas: o que cada IA tem instalado (skills, comandos, plugins, hooks, MCPs...), de onde veio e a saúde do conjunto. Só leitura. */
export function ToolsView({ workspaceId, initialTab, initialItem, onError }: { workspaceId: string | null; initialTab?: ToolsTab; initialItem?: string; onError: (e: string) => void }) {
  const [scopePref, setScopePref] = useState<ToolScope>(() => (localStorage.getItem(SCOPE_KEY) as ToolScope) || "all");
  const scope: ToolScope = scopePref === "repo" && !workspaceId ? "all" : scopePref;
  const [snap, setSnap] = useState<ToolsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ToolsTab>(initialTab ?? "catalog");
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [open, setOpen] = useState<string | null>(initialItem ?? null);
  useEffect(() => void (initialItem && setOpen(initialItem)), [initialItem]);
  useEffect(() => void (initialTab && setTab(initialTab)), [initialTab]);

  const load = useCallback((refresh = false) => api.toolsSnapshot(scope, workspaceId, refresh).then((s) => (setSnap(s), setErr(null)), (e) => setErr(String(e))), [scope, workspaceId]);
  useEffect(() => void load(), [load]);
  useEffect(() => api.onToolsChanged(() => void load()), [load]);
  useEffect(() => {
    const focus = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", focus);
    return () => document.removeEventListener("visibilitychange", focus);
  }, [load]);
  const refresh = async () => {
    setBusy(true);
    await load(true).finally(() => setBusy(false));
  };
  const pickScope = (s: ToolScope) => (localStorage.setItem(SCOPE_KEY, s), setScopePref(s));

  const items = useMemo(() => (snap?.items ?? []).filter((i) => matches(i, q, snap) && (!harness || i.harnesses.includes(harness)) && (!kind || i.kind === kind)), [snap, q, harness, kind]);
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    (snap?.items ?? []).forEach((i) => m.set(i.kind, (m.get(i.kind) ?? 0) + 1));
    return [...m];
  }, [snap]);
  const errors = snap?.findings.filter((f) => f.severity === "error").length ?? 0;
  const warns = snap?.findings.filter((f) => f.severity === "warn").length ?? 0;

  return (
    <section className="page tools" data-testid="tools-view">
      <header className="page-head" data-tauri-drag-region>
        <h2>{t("tools.title")}</h2>
        {snap && <span className="dim small" data-testid="tools-summary">{t("tools.summary", { items: snap.items.length, ais: snap.harnesses.filter((h) => h.id !== "shared" && h.id !== "other").length })}</span>}
        <span className="grow" />
        <div className="seg-mini" role="tablist" aria-label={t("tools.scope.label")}>
          {SCOPES.map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} className={scope === s ? "on" : ""} disabled={s === "repo" && !workspaceId} title={s === "repo" && !workspaceId ? t("tools.scope.repoNeedsWs") : t(`tools.scope.${s}Hint`)} onClick={() => pickScope(s)} data-testid={`tools-scope-${s}`}>{t(`tools.scope.${s}`)}</button>
          ))}
        </div>
        {snap && <RootsButton snap={snap} />}
        <button className="btn" disabled={busy} onClick={refresh} data-testid="tools-refresh">{busy ? t("tools.refreshing") : t("common.refresh")}</button>
      </header>

      <div className="tools-bar">
        <label className="tools-search">
          <ISearch size={13} />
          <input {...noSuggest} autoComplete="off" spellCheck={false} placeholder={t("tools.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="tools-search" />
        </label>
        <div className="tools-chips" role="toolbar" aria-label={t("tools.filterAi")}>
          <button className={"tools-chip" + (!harness ? " on" : "")} onClick={() => setHarness(null)} data-testid="tools-chip-all">{t("tools.allAis")}</button>
          {snap?.harnesses.map((h) => (
            <button key={h.id} className={"tools-chip" + (harness === h.id ? " on" : "")} onClick={() => setHarness(harness === h.id ? null : h.id)} data-testid={`tools-chip-${h.id}`}>
              {harnessLabel(h.id, snap)} <span className="dim">{h.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="tools-bar">
        <div className="rtabs tools-tabs" role="tablist">
          {TABS.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)} data-testid={`tools-tab-${k}`}>
              {t(`tools.tab.${k}`)}
              {k === "health" && (errors > 0 || warns > 0) && <span className={"tools-count" + (errors ? " err" : " warn")} data-testid="tools-health-count">{errors || warns}</span>}
            </button>
          ))}
        </div>
        <span className="grow" />
        {(tab === "catalog" || tab === "matrix") && (
          <div className="tools-kinds">
            <button className={"tools-chip small" + (!kind ? " on" : "")} onClick={() => setKind(null)} data-testid="tools-kind-all">{t("tools.allKinds")}</button>
            {kinds.map(([k, n]) => <button key={k} className={"tools-chip small" + (kind === k ? " on" : "")} onClick={() => setKind(kind === k ? null : k)} data-testid={`tools-kind-${k}`}>{kindPlural(k)} <span className="dim">{n}</span></button>)}
          </div>
        )}
      </div>

      {err && <div className="tools-error" role="alert" data-testid="tools-error">{t("tools.loadError", { error: err })}</div>}
      {!snap && !err && <div className="dim" data-testid="tools-loading">{t("tools.loading")}</div>}
      {snap && snap.items.length === 0 && <div className="tools-empty dim" data-testid="tools-empty">{t("tools.empty")}</div>}
      {snap && snap.items.length > 0 && items.length === 0 && (tab === "catalog" || tab === "matrix") && <div className="tools-empty dim">{t("tools.noMatch")}</div>}

      {snap && tab === "catalog" && <Catalog snap={snap} items={items} onOpen={setOpen} />}
      {snap && tab === "matrix" && <Matrix snap={snap} items={items} only={onlyProblems} setOnly={setOnlyProblems} onOpen={setOpen} />}
      {snap && tab === "sources" && <Sources snap={snap} q={q} onOpen={setOpen} />}
      {snap && tab === "health" && <Health snap={snap} onOpen={setOpen} />}
      {snap && <div className="dim small tools-foot">{t("tools.generated", { when: fmtDate(snap.generatedAt, "dayMonthTime"), ms: snap.scanMs })}{snap.stale ? ` · ${t("tools.stale")}` : ""}</div>}

      {open && snap && <ItemDrawer id={open} snap={snap} workspaceId={workspaceId} onClose={() => setOpen(null)} onChanged={() => void load()} onError={onError} onOpen={setOpen} />}
    </section>
  );
}

/** Selos de IA do cartão: cheio = cópia, tracejado = link, âmbar = divergente, vermelho = quebrado. */
function Badges({ it, snap }: { it: ToolItem; snap: ToolsSnapshot }) {
  return (
    <span className="tools-badges">
      {it.harnesses.map((h) => {
        const s = worstState(it, h, snap.findings) ?? "copy";
        return <span key={h} className={`tools-badge st-${s}`} title={`${harnessLabel(h, snap)} · ${stateLabel(s)}`} data-testid="tools-badge" data-state={s}>{harnessLabel(h, snap)}</span>;
      })}
    </span>
  );
}

function StatusDot({ s }: { s: ToolItem["status"] }) {
  return s === "ok" ? null : <span className={`tools-dot sev-${s}`} title={sevLabel(s)} aria-label={sevLabel(s)} />;
}

function Catalog({ snap, items, onOpen }: { snap: ToolsSnapshot; items: ToolItem[]; onOpen: (id: string) => void }) {
  return (
    <div className="tools-catalog" data-testid="tools-catalog">
      {byCategory(items).map(([cat, list]) => (
        <div key={cat} className="tools-group" data-testid="tools-group" data-cat={cat}>
          <h3>{cat === "__fav" ? t("tools.favorites") : catLabel(cat)} <span className="dim">{list.length}</span></h3>
          <div className="tools-cards">
            {list.map((it) => (
              <button key={it.id} className="tools-card" onClick={() => onOpen(it.id)} data-testid="tools-card" data-id={it.id}>
                <div className="tools-card-head">
                  <StatusDot s={it.status} />
                  <b className="tools-name">{it.name}</b>
                  {it.favorite && <span className="tools-fav-mark" aria-label={t("tools.favorite")}>★</span>}
                  <span className="grow" />
                  <span className="chip">{kindLabel(it.kind)}</span>
                </div>
                <div className="tools-purpose">{it.purpose ?? it.description ?? <span className="dim">{t("tools.noDescription")}</span>}</div>
                <div className="tools-card-foot">
                  <Badges it={it} snap={snap} />
                  <span className="grow" />
                  <span className="chip tools-src" title={t("tools.source.title")}>{sourceLabel(it.sourceId, snap)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Matrix({ snap, items, only, setOnly, onOpen }: { snap: ToolsSnapshot; items: ToolItem[]; only: boolean; setOnly: (v: boolean) => void; onOpen: (id: string) => void }) {
  const rows = only ? items.filter((i) => i.status === "warn" || i.status === "error") : items;
  const cols = snap.harnesses.filter((h) => h.id !== "other");
  return (
    <div className="tools-matrix-wrap">
      <label className="tools-only"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} data-testid="tools-only-problems" /> {t("tools.matrix.onlyProblems")}</label>
      <div className="tools-legend dim small">
        {(["copy", "link", "drift", "broken", "managed"] as PlaceState[]).map((s) => <span key={s}><span className={`tools-glyph st-${s}`}>{STATE_GLYPH[s]}</span> {stateLabel(s)}</span>)}
      </div>
      <div className="tools-matrix-scroll">
        <table className="tools-matrix" data-testid="tools-matrix">
          <thead>
            <tr><th>{t("tools.matrix.item")}</th>{cols.map((h) => <th key={h.id} className="tools-col" title={harnessLabel(h.id, snap)}><span>{harnessLabel(h.id, snap)}</span></th>)}</tr>
          </thead>
          <tbody>
            {rows.map((it) => (
              <tr key={it.id} onClick={() => onOpen(it.id)} data-testid="tools-matrix-row" data-id={it.id}>
                <td className="tools-mname"><StatusDot s={it.status} /> {it.name} <span className="dim small">{kindLabel(it.kind)}</span></td>
                {cols.map((h) => {
                  const s = worstState(it, h.id, snap.findings);
                  return <td key={h.id} className="tools-cell">{s && <span className={`tools-glyph st-${s}`} title={`${harnessLabel(h.id, snap)} · ${stateLabel(s)}`}>{STATE_GLYPH[s]}</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Sources({ snap, q, onOpen }: { snap: ToolsSnapshot; q: string; onOpen: (id: string) => void }) {
  const list = snap.sources.filter((s) => !q || `${s.label} ${s.repo ?? ""} ${s.url ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const name = (id: string) => snap.items.find((i) => i.id === id)?.name ?? id;
  return (
    <div className="tools-sources" data-testid="tools-sources">
      {list.map((s) => (
        <div key={s.id} className="tools-source" data-testid="tools-source" data-id={s.id}>
          <div className="tools-card-head">
            <b>{sourceLabel(s.id, snap)}</b>
            <span className="chip">{sourceKindLabel(s.kind)}</span>
            {!s.exists && <span className="chip warn">{t("tools.source.missing")}</span>}
            <span className="grow" />
            {s.version && <span className="dim small">{t("tools.source.version", { v: s.version })}</span>}
            {s.commit && <span className="dim small mono">{s.commit}</span>}
          </div>
          {s.url && <a className="tools-url" href={s.url} onClick={(e) => (e.preventDefault(), void api.openExternal(s.url!).catch(() => window.open(s.url, "_blank")))}>{s.url}</a>}
          {(s.installedAt || s.updatedAt) && <div className="dim small">{s.installedAt && t("tools.source.installed", { when: fmtDate(s.installedAt, "date") })}{s.installedAt && s.updatedAt ? " · " : ""}{s.updatedAt && t("tools.source.updated", { when: fmtDate(s.updatedAt, "date") })}</div>}
          {s.itemIds.length > 0 && (
            <div className="tools-src-items">
              <span className="dim small">{t("tools.source.items", { count: s.itemIds.length })}</span>
              {s.itemIds.slice(0, 24).map((id) => <button key={id} className="tools-chip small" onClick={() => onOpen(id)}>{name(id)}</button>)}
              {s.itemIds.length > 24 && <span className="dim small">+{s.itemIds.length - 24}</span>}
            </div>
          )}
          {s.footprint.length > 0 && (
            <div className="tools-footprint" data-testid="tools-footprint">
              <div className="dim small">{t("tools.source.footprint")}</div>
              {s.footprint.map((f, i) => <div key={i} className="tools-fp"><span className="chip">{tr(`tools.fp.${f.kind}`, {}, f.kind)}</span> {f.label}{f.path && <span className="dim mono small"> {f.path}</span>}</div>)}
            </div>
          )}
        </div>
      ))}
      {list.length === 0 && <div className="dim">{t("tools.source.none")}</div>}
    </div>
  );
}

function Health({ snap, onOpen }: { snap: ToolsSnapshot; onOpen: (id: string) => void }) {
  const groups = (["error", "warn", "info"] as const).map((s) => [s, snap.findings.filter((f) => f.severity === s)] as const).filter(([, l]) => l.length);
  return (
    <div className="tools-health" data-testid="tools-health">
      {groups.length === 0 && <div className="tools-empty ok" data-testid="tools-healthy">{t("tools.health.allGood")}</div>}
      {groups.map(([sev, list]) => (
        <div key={sev} className="tools-group">
          <h3><span className={`tools-dot sev-${sev}`} /> {sevLabel(sev)} <span className="dim">{list.length}</span></h3>
          {list.map((f) => (
            <div key={f.id} className={`tools-finding sev-${sev}`} data-testid="tools-finding" data-kind={f.kind}>
              <div className="tools-finding-title">{findingTitle(f, snap.items)}</div>
              {findingWhy(f) && <div className="dim small">{t("tools.health.why")} {findingWhy(f)}</div>}
              {f.paths.length > 0 && <div className="tools-paths mono small">{f.paths.slice(0, 6).map((p) => <div key={p}>{p}</div>)}{f.paths.length > 6 && <div className="dim">+{f.paths.length - 6}</div>}</div>}
              {f.itemIds.length > 0 && <div className="tools-src-items">{f.itemIds.map((id) => <button key={id} className="tools-chip small" onClick={() => onOpen(id)}>{snap.items.find((i) => i.id === id)?.name ?? id}</button>)}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** "N pastas lidas": cada raiz com a IA, a conta, a variável que a moveu e quantos itens deu. */
function RootsButton({ snap }: { snap: ToolsSnapshot }) {
  const pop = usePopover<HTMLSpanElement>();
  const ok = snap.roots.filter((r) => r.status === "ok").length;
  const byAi = useMemo(() => {
    const m = new Map<string, typeof snap.roots>();
    snap.roots.forEach((r) => m.set(r.harness, [...(m.get(r.harness) ?? []), r]));
    return [...m];
  }, [snap]);
  return (
    <span className="picker" ref={pop.ref}>
      <button className="btn" onClick={pop.toggle} aria-expanded={pop.open} data-testid="tools-roots">{t("tools.roots.button", { count: ok })}</button>
      {pop.open && (
        <div className="tools-roots-pop popover" data-testid="tools-roots-pop">
          <div className="pop-title">{t("tools.roots.title")}</div>
          {byAi.map(([h, list]) => (
            <div key={h} className="tools-roots-ai">
              <b>{harnessLabel(h, snap)}</b>
              {list.map((r, i) => (
                <div key={i} className={"tools-root" + (r.status !== "ok" ? " dim" : "")} data-testid="tools-root" data-status={r.status}>
                  <span className="chip">{whatLabel(r.what)}</span>
                  <span className="mono small tools-root-path">{r.path}</span>
                  <span className="grow" />
                  {r.account && <span className="chip">{t("tools.roots.account", { name: r.account })}</span>}
                  {r.repo && <span className="chip">{r.repo}</span>}
                  {r.env && <span className="chip mono" title={t("tools.roots.envHint")}>{r.env}</span>}
                  <span className="small">{r.status === "ok" ? r.count : t(`tools.roots.${r.status}`)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function ItemDrawer({ id, snap, workspaceId, onClose, onChanged, onError, onOpen }: { id: string; snap: ToolsSnapshot; workspaceId: string | null; onClose: () => void; onChanged: () => void; onError: (e: string) => void; onOpen: (id: string) => void }) {
  const [d, setD] = useState<ToolItemDetail | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [fav, setFav] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setD(undefined);
    api.toolsItem(id, workspaceId).then((x) => (setD(x), setNote(x?.item.note ?? ""), setFav(!!x?.item.favorite)), (e) => (setD(null), onError(String(e))));
  }, [id, workspaceId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const it = d?.item ?? snap.items.find((i) => i.id === id);
  const toggleFav = () => {
    const v = !fav;
    setFav(v);
    api.toolsPrefsSet({ id, favorite: v }).then(onChanged, (e) => onError(String(e)));
  };
  const saveNote = () => api.toolsPrefsSet({ id, note }).then(() => (setSaved(true), onChanged()), (e) => onError(String(e)));
  const reveal = (p: string) => api.openIn("finder", p).catch((e) => onError(String(e)));
  return (
    <div className="tools-drawer-bg" onMouseDown={onClose}>
      <aside className="tools-drawer" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={it?.name ?? id} data-testid="tools-drawer">
        <header className="tools-drawer-head">
          <div>
            <div className="dim small">{it ? kindLabel(it.kind) : ""}</div>
            <h3 className="tools-drawer-title">{it?.name ?? id}</h3>
          </div>
          <span className="grow" />
          <button className={"btn" + (fav ? " on" : "")} onClick={toggleFav} aria-pressed={fav} data-testid="tools-fav">{fav ? "★" : "☆"} {t("tools.favorite")}</button>
          <button className="btn" onClick={onClose} aria-label={t("common.close")} data-testid="tools-drawer-close">✕</button>
        </header>
        {d === undefined && <div className="dim">{t("tools.loading")}</div>}
        {d === null && <div className="dim">{t("tools.detail.gone")}</div>}
        {d && it && (
          <div className="tools-drawer-body">
            {(it.purpose || it.description) && <p className="tools-desc">{it.description ?? it.purpose}</p>}
            <div className="tools-meta">
              {it.categories.map((c) => <span key={c} className="chip">{catLabel(c)}</span>)}
              <span className="chip" title={t("tools.source.title")}>{sourceLabel(it.sourceId, snap)}</span>
              {it.weightTokens != null && <span className="chip" title={t("tools.weightHint")}>{t("tools.weight", { n: fmtTokens(it.weightTokens) })}</span>}
              {it.risks.map((r) => <span key={r} className="chip warn" data-testid="tools-risk">{riskLabel(r)}</span>)}
            </div>
            {d.absPath && (
              <div className="tools-actions">
                <button className="btn" onClick={() => reveal(d.absPath!)} data-testid="tools-reveal"><IFolder size={13} /> {t("tools.reveal")}</button>
                <button className="btn" onClick={() => void navigator.clipboard.writeText(d.absPath!)} data-testid="tools-copy-path"><ICopy size={13} /> {t("tools.copyPath")}</button>
              </div>
            )}

            {d.findings.length > 0 && (
              <section>
                <h4>{t("tools.detail.findings")}</h4>
                {d.findings.map((f) => <div key={f.id} className={`tools-finding sev-${f.severity}`} data-testid="tools-drawer-finding"><div>{findingTitle(f, snap.items)}</div>{findingWhy(f) && <div className="dim small">{findingWhy(f)}</div>}</div>)}
              </section>
            )}

            {it.invoke.length > 0 && (
              <section data-testid="tools-invoke">
                <h4>{t("tools.detail.invoke")}</h4>
                {it.invoke.map((iv, i) => <div key={i} className="tools-inv"><span className="tools-inv-ai">{harnessLabel(iv.harness, snap)}</span><code>{iv.text}</code><span className="dim small">{howLabel(iv.how)}</span></div>)}
              </section>
            )}

            <section>
              <h4>{t("tools.detail.where", { count: it.placements.length })}</h4>
              {it.placements.map((p, i) => {
                const s = placeState(p, snap.findings, it.id);
                return (
                  <div key={i} className="tools-place" data-testid="tools-place" data-state={s}>
                    <span className={`tools-glyph st-${s}`} title={stateLabel(s)}>{STATE_GLYPH[s]}</span>
                    <span className="tools-inv-ai">{harnessLabel(p.harness, snap)}</span>
                    <span className="mono small tools-root-path" title={p.path}>{p.path}</span>
                    <span className="grow" />
                    {p.account && <span className="chip">{t("tools.roots.account", { name: p.account })}</span>}
                    {p.repo && <span className="chip">{p.repo}</span>}
                    {p.version && <span className="chip mono">{p.version}</span>}
                    {p.enabled === false && <span className="chip warn">{t("tools.disabled")}</span>}
                    <span className="dim small">{stateLabel(s)}{p.link.kind !== "real" ? ` → ${p.link.target}` : ""}</span>
                  </div>
                );
              })}
            </section>

            {d.source && (d.source.url || d.source.footprint.length > 0) && (
              <section>
                <h4>{t("tools.detail.source")}</h4>
                <div>{sourceLabel(d.source.id, snap)} <span className="chip">{sourceKindLabel(d.source.kind)}</span></div>
                {d.source.url && <div className="mono small dim">{d.source.url}</div>}
              </section>
            )}

            <section>
              <h4>{t("tools.detail.note")}</h4>
              <textarea className="tools-note" value={note} onChange={(e) => (setNote(e.target.value), setSaved(false))} placeholder={t("tools.detail.notePh")} rows={3} data-testid="tools-note" />
              <div className="tools-actions"><button className="btn" onClick={() => void saveNote()} data-testid="tools-note-save">{t("tools.detail.saveNote")}</button>{saved && <span className="ok small" data-testid="tools-note-saved">{t("tools.detail.saved")}</span>}</div>
            </section>

            {Object.keys(d.frontmatter).length > 0 && (
              <section>
                <h4>{t("tools.detail.frontmatter")}</h4>
                <table className="tools-fm"><tbody>{Object.entries(d.frontmatter).filter(([k]) => k !== "description").map(([k, v]) => <tr key={k}><td className="dim mono small">{k}</td><td className="small">{v}</td></tr>)}</tbody></table>
              </section>
            )}
            {Object.keys(d.frontmatter).length === 0 && Object.keys(it.extras).length > 0 && (
              <section>
                <h4>{t("tools.detail.config")}</h4>
                <table className="tools-fm"><tbody>{Object.entries(it.extras).map(([k, v]) => <tr key={k}><td className="dim mono small">{k}</td><td className="small mono">{v}</td></tr>)}</tbody></table>
              </section>
            )}
            {d.files.length > 0 && (
              <section>
                <h4>{t("tools.detail.files", { count: d.files.length })}</h4>
                <div className="mono small dim">{d.files.map((f) => <div key={f}>{f}</div>)}</div>
              </section>
            )}
            {d.body && (
              <section className="tools-body" data-testid="tools-body">
                <h4>{t("tools.detail.content")}{d.truncated ? ` · ${t("tools.detail.truncated")}` : ""}</h4>
                <div className="md"><Markdown text={d.body} /></div>
              </section>
            )}
            {it.kind === "plugin" && <PluginContents it={it} snap={snap} onOpen={onOpen} />}
          </div>
        )}
      </aside>
    </div>
  );
}

/** O que um plugin traz (skills, comandos, hooks, MCP) — itens geridos por ele. */
function PluginContents({ it, snap, onOpen }: { it: ToolItem; snap: ToolsSnapshot; onOpen: (id: string) => void }) {
  const key = it.id.replace(/^plugin:/, "");
  const inside = snap.items.filter((x) => x.placements.some((p) => p.plugin === key));
  if (!inside.length) return null;
  return (
    <section>
      <h4>{t("tools.detail.pluginContents", { count: inside.length })}</h4>
      <div className="tools-src-items">{inside.map((x) => <button key={x.id} className="tools-chip small" onClick={() => onOpen(x.id)}>{kindLabel(x.kind)}: {x.name}</button>)}</div>
    </section>
  );
}

