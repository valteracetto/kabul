import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { Floating } from "../components/Floating";
import { api, type DiffComment, type DiffScope, type Workspace } from "../api";
import { IChevronDown, IComment } from "../icons";
import { highlight } from "../components/Markdown";
import { usePopover } from "../components/useDismiss";
import { LazyChunks } from "../components/LazyChunks";

const CHUNK = 200;

type Line = { kind: "a" | "d" | "c" | "h"; text: string; old: number | null; neu: number | null };

/** Parse do diff unificado: linhas com número antigo e novo. */
export function parseDiff(d: string): Line[] {
  const out: Line[] = [];
  let o = 0, n = 0, inHunk = false;
  for (const l of d.split("\n")) {
    if (l.startsWith("@@")) {
      const m = /-(\d+)(?:,\d+)? \+(\d+)/.exec(l);
      o = Number(m?.[1] ?? 1) - 1;
      n = Number(m?.[2] ?? 1) - 1;
      inHunk = true;
      out.push({ kind: "h", text: l, old: null, neu: null });
    } else if (!inHunk) continue;
    else if (l.startsWith("+")) out.push({ kind: "a", text: l.slice(1), old: null, neu: ++n });
    else if (l.startsWith("-")) out.push({ kind: "d", text: l.slice(1), old: ++o, neu: null });
    else if (l.startsWith("\\")) continue;
    else if (l !== "" || out.length) out.push({ kind: "c", text: l.slice(1), old: ++o, neu: ++n });
  }
  while (out.length && out[out.length - 1].kind === "c" && out[out.length - 1].text === "" ) out.pop();
  return out;
}

/** Linhas do modo lado a lado: blocos de remoção e adição viram pares. */
export function splitRows(lines: Line[]): [Line | null, Line | null][] {
  const rows: [Line | null, Line | null][] = [];
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (l.kind === "c" || l.kind === "h") (rows.push([l, l]), i++);
    else {
      const del: Line[] = [], add: Line[] = [];
      while (i < lines.length && lines[i].kind === "d") del.push(lines[i++]);
      while (i < lines.length && lines[i].kind === "a") add.push(lines[i++]);
      for (let k = 0; k < Math.max(del.length, add.length); k++) rows.push([del[k] ?? null, add[k] ?? null]);
    }
  }
  return rows;
}

/** Hash curto do diff: "visto" vale enquanto o arquivo não mudar. */
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
const viewedKey = (ws: string) => `kabul.viewed.${ws}`;
export const viewedMap = (ws: string): Record<string, string> => { try { return JSON.parse(localStorage.getItem(viewedKey(ws)) ?? "{}"); } catch { return {}; } };

/**
 * Diff de um arquivo: unificado ou lado a lado, ocultar espaços, quebra de linha, realce de sintaxe,
 * marcar como visto (⌃V), ↑/↓ entre arquivos, ⌥⌘J/⌥⌘K entre comentários e comentários por linha.
 */
export function FileDiff({ ws, path, scope = "all", files = [], active = true, onNavigate, onError }: { ws: Workspace; path: string; scope?: DiffScope; files?: string[]; active?: boolean; onNavigate?: (p: string) => void; onError: (e: string) => void }) {
  const [d, setD] = useState<string | null>(null);
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [composing, setComposing] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [mode, setMode] = useState(() => localStorage.getItem("kabul.diff.mode") ?? "unified");
  const [ignoreWs, setIgnoreWs] = useState(() => localStorage.getItem("kabul.diff.ignoreWs") === "1");
  const [wrap, setWrap] = useState(() => localStorage.getItem("kabul.diff.wrap") === "1");
  const [viewed, setViewed] = useState(() => viewedMap(ws.id));
  const [cIdx, setCIdx] = useState(-1);
  const opts = usePopover();
  const root = useRef<HTMLDivElement>(null);
  const load = useCallback(() => api.comments(ws.id).then((c) => setComments(c.filter((x) => x.path === path)), () => {}), [ws.id, path]);
  useEffect(() => {
    setD(null);
    api.fileDiff(ws.id, path, scope, ignoreWs).then(setD, (e) => onError(String(e)));
    load();
  }, [ws.id, path, scope, ignoreWs, load, onError]);
  const lines = useMemo(() => (d ? parseDiff(d) : []), [d]);
  const srows = useMemo(() => (mode === "split" ? splitRows(lines) : []), [lines, mode]);
  const h = d ? hash(d) : "";
  const isViewed = !!d && viewed[path] === h;
  const toggleViewed = useCallback(() => {
    const m = viewedMap(ws.id);
    if (m[path] === h) delete m[path];
    else m[path] = h;
    localStorage.setItem(viewedKey(ws.id), JSON.stringify(m));
    setViewed(m);
    window.dispatchEvent(new Event("kabul:viewed"));
  }, [ws.id, path, h]);
  const idx = files.indexOf(path);
  const go = (delta: number) => idx >= 0 && files[idx + delta] && onNavigate?.(files[idx + delta]);
  const jumpComment = (delta: number) => {
    const els = root.current?.querySelectorAll<HTMLElement>("[data-testid=diff-comment]") ?? [];
    if (!els.length) return;
    const next = (cIdx + delta + els.length) % els.length;
    setCIdx(next);
    els[next].scrollIntoView({ block: "center" });
    els.forEach((e, k) => e.classList.toggle("focus", k === next));
  };
  const goRef = useRef({ go, jumpComment, toggleViewed });
  goRef.current = { go, jumpComment, toggleViewed };
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if (e.ctrlKey && !e.metaKey && e.code === "KeyV") (e.preventDefault(), goRef.current.toggleViewed());
      else if (e.metaKey && e.altKey && e.code === "KeyJ") (e.preventDefault(), goRef.current.jumpComment(1));
      else if (e.metaKey && e.altKey && e.code === "KeyK") (e.preventDefault(), goRef.current.jumpComment(-1));
      else if (!typing && !e.metaKey && !e.altKey && !e.ctrlKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && root.current?.contains(document.activeElement)) (e.preventDefault(), goRef.current.go(e.key === "ArrowDown" ? 1 : -1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [active]);
  useEffect(() => void (active && root.current?.focus({ preventScroll: true })), [active, path]);

  const add = async () => {
    if (composing == null || !body.trim()) return;
    await api.addComment(ws.id, path, composing, null, body.trim()).catch((e) => onError(String(e)));
    setComposing(null);
    setBody("");
    load();
  };
  const open = comments.filter((c) => !c.resolved);
  // Blocos sempre desenhados: os que têm comentário ou a caixa de comentar aberta (⌥⌘J/K e foco funcionam).
  const marked = new Set([...comments.map((c) => c.line), ...(composing != null ? [composing] : [])]);
  const pinOf = (list: (number | null | undefined)[]) => [...new Set(list.flatMap((n, i) => (n != null && marked.has(n) ? [Math.floor(i / CHUNK)] : [])))];
  const sendToAgent = () => window.dispatchEvent(new CustomEvent("kabul:compose", { detail: { ws: ws.id, text: t("code.diff.reviewComments") + "\n" + open.map((c) => `- ${c.path}:${c.line} — ${c.body}`).join("\n") } }));
  const setPref = (k: string, v: string, f: (x: never) => void) => (localStorage.setItem(k, v), f(v as never));
  const code = (s: string) => (s ? highlight(s) : " ");
  const lnCell = (n: number | null, cls = "") => <span className={"ln" + (n ? " can" : "") + cls} title={n ? t("code.diff.commentLine") : undefined} onClick={() => n && (setComposing(n), setBody(""))}>{n ?? ""}</span>;
  const extras = (n: number | null) => n == null ? null : (
    <>
      {comments.filter((c) => c.line === n).map((c) => (
        <div key={c.id} className={"comment" + (c.resolved ? " resolved" : "")} data-testid="diff-comment">
          <IComment size={12} /> <span>{c.body}</span><span className="grow" />
          <button className="text-btn small" onClick={() => api.updateComment(c.id, !c.resolved).then(load)}>{c.resolved ? t("code.diff.reopen") : t("code.diff.resolve")}</button>
          <button className="text-btn small" onClick={() => api.updateComment(c.id, null, true).then(load)}>{t("code.diff.delete")}</button>
        </div>
      ))}
      {composing === n && (
        <div className="comment-box">
          <textarea autoFocus rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("code.diff.commentPlaceholder", { line: n })} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || !e.shiftKey)) { e.preventDefault(); add(); } if (e.key === "Escape") (e.stopPropagation(), setComposing(null)); }} />
          <div className="row end"><button className="btn" onClick={() => setComposing(null)}>{t("common.cancel")}</button><button className="btn primary" onClick={add}>{t("code.diff.comment")}</button></div>
        </div>
      )}
    </>
  );

  return (
    <div className={"filediff" + (wrap ? " wrap" : "") + (isViewed ? " viewed" : "")} ref={root} tabIndex={-1} data-testid="filediff">
      <div className="fd-head">
        <button className="icon-btn" title={t("code.diff.prevFile")} disabled={idx <= 0} onClick={() => go(-1)} data-testid="diff-prev">↑</button>
        <button className="icon-btn" title={t("code.diff.nextFile")} disabled={idx < 0 || idx >= files.length - 1} onClick={() => go(1)} data-testid="diff-next">↓</button>
        <code>{path}</code>{files.length > 1 && idx >= 0 && <span className="dim small">{idx + 1}/{files.length}</span>}
        <span className="grow" />
        {open.length > 0 && <button className="btn" onClick={sendToAgent}><IComment size={13} /> {t("code.diff.sendComments", { count: open.length })}</button>}
        <div className="seg-mini" data-testid="diff-mode">
          <button className={mode === "unified" ? "on" : ""} onClick={() => setPref("kabul.diff.mode", "unified", setMode)}>{t("code.diff.unified")}</button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setPref("kabul.diff.mode", "split", setMode)} data-testid="diff-split">{t("code.diff.split")}</button>
        </div>
        <div className="picker" ref={opts.ref}>
          <button className={"btn" + (opts.open ? " on" : "")} onClick={opts.toggle} data-testid="diff-options">{t("code.diff.options")} <IChevronDown size={11} /></button>
          {opts.open && (
            <Floating className="status-pop diff-opts" placement="bottom-end">
              <label className="pop-row"><input type="checkbox" checked={ignoreWs} onChange={(e) => setPref("kabul.diff.ignoreWs", e.target.checked ? "1" : "0", () => setIgnoreWs(e.target.checked))} data-testid="diff-ignore-ws" /> {t("code.diff.ignoreWs")}</label>
              <label className="pop-row"><input type="checkbox" checked={wrap} onChange={(e) => setPref("kabul.diff.wrap", e.target.checked ? "1" : "0", () => setWrap(e.target.checked))} data-testid="diff-wrap" /> {t("code.diff.wrap")}</label>
            </Floating>
          )}
        </div>
        <label className={"viewed-box" + (isViewed ? " on" : "")} title={t("code.diff.markViewed")}><input type="checkbox" checked={isViewed} onChange={toggleViewed} data-testid="diff-viewed" /> {t("code.diff.viewed")}</label>
      </div>
      {d === null && <div className="empty-state">{t("code.diff.loading")}</div>}
      {d !== null && d.trim() === "" && <div className="empty-state">{ignoreWs ? t("code.diff.noChangesWs") : t("code.diff.noChanges")}</div>}
      {isViewed ? <div className="empty-state dim small">{t("code.diff.viewedDot")} <button className="text-btn small" onClick={toggleViewed}>{t("code.diff.showAgain")}</button></div> : mode === "split" ? (
        <div className="patch split" hidden={!d} data-testid="patch">
          <LazyChunks count={srows.length} chunk={CHUNK} rowPx={20} pin={pinOf(srows.map(([, r]) => r?.neu))} render={(a, b) => srows.slice(a, b).map(([l, r], k) => { const i = a + k; return (
            <Fragment key={i}>
              {l?.kind === "h" ? <div className="pl h"><span className="code">{l.text}</span></div> : (
                <div className="srow">
                  <div className={"pl half " + (l ? (l.kind === "d" ? "d" : "") : "empty")}><span className="ln">{l?.old ?? ""}</span><span className="code">{l ? code(l.text) : ""}</span></div>
                  <div className={"pl half " + (r ? (r.kind === "a" ? "a" : "") : "empty")}>{lnCell(r?.neu ?? null)}<span className="code">{r ? code(r.text) : ""}</span></div>
                </div>
              )}
              {r && r.kind !== "h" && extras(r.neu)}
            </Fragment>
          ); })} />
        </div>
      ) : (
        <div className="patch" hidden={!d} data-testid="patch">
          <LazyChunks count={lines.length} chunk={CHUNK} rowPx={20} pin={pinOf(lines.map((r) => r.neu))} render={(a, b) => lines.slice(a, b).map((r, k) => (
            <div key={a + k}>
              <div className={"pl " + (r.kind === "c" ? "" : r.kind)}>
                {r.kind === "h" ? <><span className="ln" /><span className="ln" /><span className="code">{r.text}</span></> : <><span className="ln old">{r.old ?? ""}</span>{lnCell(r.neu)}<span className="sign">{r.kind === "a" ? "+" : r.kind === "d" ? "-" : " "}</span><span className="code">{code(r.text)}</span></>}
              </div>
              {extras(r.neu)}
            </div>
          ))} />
        </div>
      )}
    </div>
  );
}

/** Arquivo só leitura, com realce; `line` rola até a linha (busca nos arquivos). */
export function FileView({ ws, path, line, onError }: { ws: Workspace; path: string; line?: number; onError: (e: string) => void }) {
  const [txt, setTxt] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => void api.readFile(ws.id, path).then(setTxt, (e) => onError(String(e))), [ws.id, path, onError]);
  const rows = useMemo(() => (txt ?? "").split("\n"), [txt]);
  useEffect(() => void (txt !== null && line && root.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: "center" })), [txt, line]);
  return (
    <div className="filediff" ref={root} data-testid="fileview">
      <div className="fd-head"><code>{path}</code>{line ? <span className="dim small">{t("code.diff.line", { line })}</span> : null}</div>
      <div className="patch"><LazyChunks count={rows.length} chunk={CHUNK} rowPx={20} pin={line ? [Math.floor((line - 1) / CHUNK)] : []} render={(a, b) => rows.slice(a, b).map((l, k) => { const i = a + k; return <div key={i} data-line={i + 1} className={"pl" + (line === i + 1 ? " hit" : "")}><span className="ln">{i + 1}</span><span className="code">{l ? highlight(l) : " "}</span></div>; })} /></div>
    </div>
  );
}
