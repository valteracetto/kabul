import { useCallback, useEffect, useMemo, useState } from "react";
import type { ToolItemDetail, ToolsSnapshot } from "../api";
import { Markdown } from "../components/Markdown";
import { byCategory, catLabel, findingTitle, findingWhy, harnessLabel, howLabel, kindLabel, matches, placeState, riskLabel, sevLabel, sourceKindLabel, sourceLabel, STATE_GLYPH, stateLabel } from "../components/tools";
import { t } from "../i18n";
import { trError } from "../i18n/errors";
import { transport } from "../transport";
import { kcall } from "./kabuld";
import { BackButton, Empty, Group, NavBar, Row, Segmented, Sheet } from "./ui";
import "./tools-mobile.css";

type Seg = "catalog" | "sources" | "health";

/** Ferramentas no celular (só leitura): catálogo por categoria, fontes, saúde e o detalhe de cada item. */
export function MobileTools({ onBack }: { onBack: () => void }) {
  const [snap, setSnap] = useState<ToolsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seg, setSeg] = useState<Seg>("catalog");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback((refresh = false) => kcall<ToolsSnapshot>("tools_snapshot", { scope: "all", workspaceId: null, refresh }).then((s) => (setSnap(s), setErr(null)), (e) => setErr(String((e as Error).message ?? e))), []);
  useEffect(() => {
    void load();
    return transport.subscribe("tools-changed", () => void load());
  }, [load]);
  const refresh = async () => {
    setBusy(true);
    await load(true).finally(() => setBusy(false));
  };
  const items = useMemo(() => (snap?.items ?? []).filter((i) => matches(i, q, snap)), [snap, q]);
  const errors = snap?.findings.filter((f) => f.severity !== "info").length ?? 0;
  return (
    <div className="m-page" data-testid="m-tools">
      <NavBar
        title={t("tools.title")}
        sub={snap ? t("tools.summary", { items: snap.items.length, ais: snap.harnesses.filter((h) => h.id !== "shared" && h.id !== "other").length }) : undefined}
        left={<BackButton onClick={onBack} testid="m-tools-back" />}
        right={<button className="m-pill small" onClick={() => void refresh()} disabled={busy} data-testid="m-tools-refresh">{busy ? "…" : t("common.refresh")}</button>}
      />
      {err && <div className="m-error">{trError(err)}</div>}
      <main className="m-scroll m-pad m-tools">
        <Segmented<Seg>
          value={seg}
          onChange={setSeg}
          options={[
            { v: "catalog", label: t("tools.tab.catalog"), testid: "m-tools-seg-catalog" },
            { v: "sources", label: t("tools.tab.sources"), testid: "m-tools-seg-sources" },
            { v: "health", label: errors ? `${t("tools.tab.health")} · ${errors}` : t("tools.tab.health"), testid: "m-tools-seg-health" },
          ]}
        />
        {seg !== "health" && <input className="m-tools-search" type="search" placeholder={t("tools.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="m-tools-search" />}
        {!snap && !err && <div className="m-empty dim">{t("tools.loading")}</div>}
        {snap && snap.items.length === 0 && <Empty title={t("tools.title")} sub={t("tools.empty")} testid="m-tools-empty" />}
        {snap && seg === "catalog" &&
          byCategory(items).map(([cat, list]) => (
            <Group key={cat} header={`${cat === "__fav" ? t("tools.favorites") : catLabel(cat)} · ${list.length}`} testid="m-tools-group">
              {list.map((it) => (
                <Row key={it.id} title={<>{it.status !== "ok" && <span className={`m-tools-dot sev-${it.status}`} />}{it.name}</>} sub={it.purpose ?? kindLabel(it.kind)} chevron onClick={() => setOpen(it.id)} testid="m-tools-row">
                  <span className="m-tools-ais">{it.harnesses.slice(0, 3).map((h) => harnessLabel(h, snap)).join(" · ")}{it.harnesses.length > 3 ? ` +${it.harnesses.length - 3}` : ""}</span>
                </Row>
              ))}
            </Group>
          ))}
        {snap && seg === "sources" && (
          <Group testid="m-tools-sources">
            {snap.sources.filter((s) => !q || s.label.toLowerCase().includes(q.toLowerCase())).map((s) => (
              <Row key={s.id} title={sourceLabel(s.id, snap)} sub={[sourceKindLabel(s.kind), s.version, s.url].filter(Boolean).join(" · ")} value={String(s.itemIds.length)} testid="m-tools-source" />
            ))}
          </Group>
        )}
        {snap && seg === "health" && (
          <>
            {snap.findings.length === 0 && <div className="m-empty">{t("tools.health.allGood")}</div>}
            {(["error", "warn", "info"] as const).map((sev) => {
              const list = snap.findings.filter((f) => f.severity === sev);
              return list.length ? (
                <Group key={sev} header={`${sevLabel(sev)} · ${list.length}`} testid="m-tools-health">
                  {list.map((f) => <Row key={f.id} title={findingTitle(f, snap.items)} sub={findingWhy(f) || f.paths[0]} onClick={f.itemIds[0] ? () => setOpen(f.itemIds[0]) : undefined} testid="m-tools-finding" />)}
                </Group>
              ) : null;
            })}
          </>
        )}
      </main>
      {open && snap && <DetailSheet id={open} snap={snap} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DetailSheet({ id, snap, onClose }: { id: string; snap: ToolsSnapshot; onClose: () => void }) {
  const [d, setD] = useState<ToolItemDetail | null | undefined>(undefined);
  useEffect(() => void kcall<ToolItemDetail | null>("tools_item", { id, workspaceId: null }).then(setD, () => setD(null)), [id]);
  const it = d?.item ?? snap.items.find((i) => i.id === id);
  return (
    <Sheet title={it?.name ?? id} onClose={onClose} testid="m-tools-sheet" full>
      {d === undefined && <div className="m-empty dim">{t("tools.loading")}</div>}
      {d === null && <div className="m-empty dim">{t("tools.detail.gone")}</div>}
      {d && it && (
        <div className="m-tools-detail">
          <div className="dim small">{kindLabel(it.kind)} · {sourceLabel(it.sourceId, snap)}</div>
          {(it.description ?? it.purpose) && <p>{it.description ?? it.purpose}</p>}
          <div className="m-tools-chips">
            {it.categories.map((c) => <span key={c} className="m-tools-chip">{catLabel(c)}</span>)}
            {it.risks.map((r) => <span key={r} className="m-tools-chip warn">{riskLabel(r)}</span>)}
          </div>
          {d.findings.length > 0 && (
            <Group header={t("tools.detail.findings")}>
              {d.findings.map((f) => <Row key={f.id} title={findingTitle(f, snap.items)} sub={findingWhy(f)} />)}
            </Group>
          )}
          {it.invoke.length > 0 && (
            <Group header={t("tools.detail.invoke")} testid="m-tools-invoke">
              {it.invoke.map((iv, i) => <Row key={i} title={<code>{iv.text}</code>} sub={`${harnessLabel(iv.harness, snap)} · ${howLabel(iv.how)}`} />)}
            </Group>
          )}
          <Group header={t("tools.detail.where", { count: it.placements.length })}>
            {it.placements.map((p, i) => {
              const s = placeState(p, snap.findings, it.id);
              return <Row key={i} title={<><span className={`m-tools-glyph st-${s}`}>{STATE_GLYPH[s]}</span> {harnessLabel(p.harness, snap)}{p.account ? ` · ${p.account}` : ""}</>} sub={p.path} value={stateLabel(s)} testid="m-tools-place" />;
            })}
          </Group>
          {d.body && (
            <div className="m-tools-body md" data-testid="m-tools-body">
              <Markdown text={d.body} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
