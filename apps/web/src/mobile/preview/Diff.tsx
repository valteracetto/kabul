import { useEffect, useMemo, useState } from "react";
import { highlight } from "../../components/Markdown";
import { parseDiff } from "../../views/FileDiff";
import { base, dir, files, type Change, type Scope } from "./api";
import type { AskTarget, Selection } from "./Viewer";
import { t } from "../../i18n";
import { trError } from "../../i18n/errors";

const scopes = (): [Scope, string][] => [["all", t("mobile.pv.scope.all")], ["uncommitted", t("mobile.pv.scope.uncommitted")], ["branch", t("mobile.pv.scope.branch")]];

/** "Alterações": arquivos mudados no workspace com +/−, por escopo. */
export function ChangesList({ ws, scope, onScope, onOpen }: { ws: string; scope: Scope; onScope: (s: Scope) => void; onOpen: (c: Change) => void }) {
  const [list, setList] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setList(null);
    setErr(null);
    files.changes(ws, scope).then(setList, (e) => setErr(String(e?.message ?? e)));
  }, [ws, scope]);
  const total = (list ?? []).reduce((a, c) => [a[0] + (c.added ?? 0), a[1] + (c.removed ?? 0)], [0, 0]);
  return (
    <div className="pv-changes">
      <div className="m-seg">{scopes().map(([s, l]) => <button key={s} className={scope === s ? "on" : ""} onClick={() => onScope(s)} data-testid={`pv-scope-${s}`}>{l}</button>)}</div>
      {err && <div className="m-error">{trError(err)}</div>}
      {!list && !err && <div className="pv-loading dim">{t("mobile.pv.loading")}</div>}
      {list && list.length === 0 && <div className="m-empty dim" data-testid="pv-no-changes">{t("mobile.pv.noChanges")}</div>}
      {list && list.length > 0 && <div className="dim small m-pad">{t("mobile.pv.filesCount", { count: list.length })} · <span className="pv-add">+{total[0]}</span> <span className="pv-del">−{total[1]}</span></div>}
      {list?.map((c) => (
        <button key={c.path} className="pv-row" onClick={() => onOpen(c)} data-testid="pv-change" data-path={c.path}>
          <span className={"pv-badge" + (c.untracked ? " new" : "")}>{c.untracked ? t("mobile.pv.new") : "M"}</span>
          <span className="pv-row-main">
            <b className="m-ellipsis">{base(c.path)}</b>
            {dir(c.path) && <span className="dim small m-ellipsis">{dir(c.path)}</span>}
          </span>
          <span className="pv-nums small">{c.added === null ? <span className="dim">{t("mobile.pv.bin")}</span> : <><span className="pv-add">+{c.added}</span> <span className="pv-del">−{c.removed ?? 0}</span></>}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Diff unificado legível em tela estreita: uma coluna de número (o novo; o antigo nas remoções),
 * sinal, código com realce e quebra de linha (sem rolar para o lado). Toque no número seleciona
 * linhas para "Perguntar no chat".
 */
export function DiffView({ ws, path, scope, onAsk, onOpenFile }: { ws: string; path: string; scope: Scope; onAsk?: (t: AskTarget) => void; onOpenFile: (line?: number | null) => void }) {
  const [d, setD] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [sel, setSel] = useState<Selection | null>(null);
  useEffect(() => {
    setD(null);
    files.diff(ws, path, scope).then(setD, (e) => setErr(String(e?.message ?? e)));
  }, [ws, path, scope]);
  const lines = useMemo(() => (d ? parseDiff(d) : []), [d]);
  const binary = !!d && /^Binary files /m.test(d);
  if (err) return <div className="m-error">{trError(err)}</div>;
  if (d === null) return <div className="pv-loading dim">{t("mobile.pv.loading")}</div>;
  const add = lines.filter((l) => l.kind === "a").length;
  const del = lines.filter((l) => l.kind === "d").length;
  const tap = (i: number) => setSel((s) => (!s ? { a: i, b: i } : s.a === s.b && i !== s.a ? { a: Math.min(s.a, i), b: Math.max(s.a, i) } : s.a === i && s.b === i ? null : { a: i, b: i }));
  const chosen = sel ? lines.slice(sel.a, sel.b + 1).filter((l) => l.kind !== "h") : [];
  const firstNew = chosen.find((l) => l.neu)?.neu ?? chosen[0]?.old ?? 1;
  const lastNew = [...chosen].reverse().find((l) => l.neu)?.neu ?? firstNew;
  const asText = chosen.map((l) => (l.kind === "a" ? "+" : l.kind === "d" ? "-" : " ") + l.text).join("\n");
  return (
    <div className={"pv-diff-wrap" + (wrap ? " wrap" : "")}>
      <div className="pv-bar">
        <span className="small"><span className="pv-add">+{add}</span> <span className="pv-del">−{del}</span></span>
        <span className="grow" />
        <button className="m-btn small" onClick={() => setWrap((w) => !w)}>{wrap ? t("mobile.pv.noWrap") : t("mobile.pv.wrap")}</button>
        <button className="m-btn small" onClick={() => onOpenFile(sel ? firstNew : null)} data-testid="pv-diff-file">{t("mobile.pv.viewFile")}</button>
      </div>
      {binary && <div className="pv-note dim">{t("mobile.pv.binary")}</div>}
      {!binary && lines.length === 0 && <div className="pv-note dim">{t("mobile.pv.noDiff")}</div>}
      <div className="pv-diff" data-testid="pv-diff">
        {lines.map((l, i) =>
          l.kind === "h" ? (
            <div key={i} className="pv-hunk">{l.text.replace(/^@@[^@]*@@\s?/, "")}<span className="dim"> {/^@@[^@]*@@/.exec(l.text)?.[0]}</span></div>
          ) : (
            <div key={i} className={`pv-dl ${l.kind}` + (sel && i >= sel.a && i <= sel.b ? " sel" : "")} data-kind={l.kind}>
              <button className="pv-ln" onClick={() => tap(i)}>{l.kind === "d" ? l.old : l.neu}</button>
              <span className="pv-sign">{l.kind === "a" ? "+" : l.kind === "d" ? "−" : ""}</span>
              <span className="pv-text">{l.text ? highlight(l.text) : " "}</span>
            </div>
          ),
        )}
      </div>
      {sel && (
        <div className="pv-selbar" data-testid="pv-selbar">
          <span className="grow">{t("mobile.pv.diffLines", { count: chosen.length })}</span>
          {onAsk && <button className="m-btn small primary" onClick={() => onAsk({ path, a: firstNew, b: lastNew, text: asText })} data-testid="pv-ask">{t("mobile.pv.ask.title")}</button>}
          <button className="m-btn small ghost" onClick={() => setSel(null)} aria-label={t("mobile.pv.clearSel")}>×</button>
        </div>
      )}
    </div>
  );
}
