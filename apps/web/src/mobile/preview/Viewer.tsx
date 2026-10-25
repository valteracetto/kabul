import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { highlight, Markdown } from "../../components/Markdown";
import { base, fmtSize, joinRel, kindOf, looksBinary, PAGE, WHOLE_MAX, type FileInfo } from "./api";
import { resolveCited, useFileInfo } from "./hooks";
import { Zoomable } from "./Zoomable";

export interface Selection { a: number; b: number }
export interface AskTarget { path: string; a: number; b: number; text: string }

/**
 * Preview de um arquivo pelo tipo: código com realce e números de linha (em páginas), Markdown
 * renderizado, imagem e SVG com pinça (SVG num `<img>`, que nunca roda script, e o kabuld ainda manda
 * CSP `sandbox`), PDF no visualizador do sistema, vídeo/áudio com `Range`, CSV em tabela, JSON em
 * árvore, binário com tamanho e "baixar".
 */
export function Viewer({ ws, path, line, known, onOpen, onAsk }: { ws: string; path: string; line: number | null; known: Set<string> | null; onOpen: (p: string, line?: number | null) => void; onAsk?: (t: AskTarget) => void }) {
  const f = useFileInfo(ws, path);
  const [source, setSource] = useState(false);
  if (f.err) return <div className="m-error" data-testid="pv-error">{f.err}</div>;
  if (!f.info) return <div className="pv-loading dim" data-testid="pv-loading">Carregando…</div>;
  const info = f.info;
  const kind = kindOf(path, info.mime);
  const big = info.size > WHOLE_MAX;
  const toggle = (label: string) => (
    <div className="pv-modes">
      <button className={!source ? "on" : ""} onClick={() => setSource(false)} data-testid="pv-mode-render">{label}</button>
      <button className={source ? "on" : ""} onClick={() => setSource(true)} data-testid="pv-mode-source">Fonte</button>
    </div>
  );
  const code = <CodeView key={path} f={f} path={path} line={line} onAsk={onAsk} />;
  switch (kind) {
    case "image":
      return <ImageView info={info} path={path} />;
    case "svg":
      return <>{toggle("Imagem")}{source ? code : <ImageView info={info} path={path} />}</>;
    case "pdf":
      return <FileCard info={info} path={path} what="PDF" open />;
    case "video":
    case "audio":
      return <MediaView f={f} kind={kind} path={path} />;
    case "binary":
      return <FileCard info={info} path={path} what="Arquivo binário" />;
    case "markdown":
      return big ? code : <>{toggle("Renderizado")}{source ? code : <MarkdownView f={f} path={path} known={known} onOpen={onOpen} />}</>;
    case "csv":
      return big ? <>{tooBig("CSV")}{code}</> : <>{toggle("Tabela")}{source ? code : <CsvView f={f} path={path} />}</>;
    case "json":
      return big ? <>{tooBig("JSON")}{code}</> : <>{toggle("Árvore")}{source ? code : <JsonView f={f} path={path} />}</>;
    default:
      return code;
  }
}

const tooBig = (what: string) => <div className="pv-note dim small">{what} grande demais para formatar no celular: mostrando o texto em páginas.</div>;

type F = ReturnType<typeof useFileInfo>;

/** Arquivo inteiro como texto (CSV, JSON, Markdown até [`WHOLE_MAX`]). */
function useWholeText(f: F) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!f.info) return;
    let alive = true;
    f.range(0, f.info.size).then((b) => alive && setText(new TextDecoder().decode(b)), (e) => alive && setErr(String(e?.message ?? e)));
    return () => void (alive = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.info?.size]);
  return { text, err };
}

// ---------------- código / texto em páginas ----------------

function CodeView({ f, path, line, onAsk }: { f: F; path: string; line: number | null; onAsk?: (t: AskTarget) => void }) {
  const size = f.info?.size ?? 0;
  const [lines, setLines] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [binary, setBinary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  const [sel, setSel] = useState<Selection | null>(line ? { a: line, b: line } : null);
  const dec = useRef(new TextDecoder());
  const carry = useRef("");
  const loading = useRef(false);
  const jumped = useRef(false);
  // Posição lida numa ref: o observador do fim da página pode chamar com um `more` de um render
  // antigo, e a página não pode entrar duas vezes.
  const pos = useRef(0);
  const more = useCallback(async () => {
    const at = pos.current;
    if (loading.current || at >= size) return;
    loading.current = true;
    setBusy(true);
    try {
      const b = await f.range(at, at + PAGE);
      if (at === 0 && looksBinary(b)) return setBinary(true);
      // Arquivo encolheu no meio da leitura: para aqui.
      const end = at + b.length >= size || b.length === 0;
      const t = carry.current + dec.current.decode(b, { stream: !end });
      const parts = t.split("\n");
      carry.current = end ? "" : parts.pop() ?? "";
      if (end && parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
      pos.current = end ? size : at + b.length;
      setLines((xs) => xs.concat(parts));
      setLoaded(pos.current);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }, [f, size]);
  // Primeira página; para ir a uma linha mais adiante, segue carregando (até ~20 páginas).
  useEffect(() => {
    if (size === 0) return;
    if (loaded === 0 || (line && lines.length < line && loaded < size && loaded < PAGE * 20)) void more();
  }, [loaded, size, line, lines.length, more]);
  useEffect(() => {
    if (!line || jumped.current || lines.length < line) return;
    const el = document.querySelector(`[data-testid="pv-code"] [data-line="${line}"]`);
    if (el) {
      jumped.current = true;
      el.scrollIntoView({ block: "center" });
    }
  }, [line, lines.length]);
  // Próxima página ao chegar perto do fim.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loaded >= size) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void more(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loaded, size]);
  if (f.info && binary) return <FileCard info={f.info} path={path} what="Arquivo binário" />;
  const tap = (n: number) => setSel((s) => (!s ? { a: n, b: n } : s.a === s.b && n !== s.a ? { a: Math.min(s.a, n), b: Math.max(s.a, n) } : s.a === n && s.b === n ? null : { a: n, b: n }));
  const shown = lines.length + (carry.current && loaded >= size ? 1 : 0);
  return (
    <div className={"pv-code-wrap" + (wrap ? " wrap" : "")}>
      <div className="pv-bar">
        <span className="dim small" data-testid="pv-size">{fmtSize(size)} · {shown} linhas{loaded < size ? ` (de ${fmtSize(loaded)} lidos)` : ""}</span>
        <span className="grow" />
        <button className="m-btn small" onClick={() => setWrap((w) => !w)} data-testid="pv-wrap">{wrap ? "Sem quebra" : "Quebrar linhas"}</button>
      </div>
      {size === 0 && <div className="pv-note dim">Arquivo vazio.</div>}
      <div className="pv-code" data-testid="pv-code">
        {lines.map((l, i) => {
          const n = i + 1;
          const on = sel && n >= sel.a && n <= sel.b;
          return (
            <div key={i} className={"pv-line" + (on ? " sel" : "")} data-line={n}>
              <button className="pv-ln" onClick={() => tap(n)} aria-label={`Linha ${n}`}>{n}</button>
              <span className="pv-text">{l ? highlight(l.length > 4000 ? l.slice(0, 4000) + " …" : l) : " "}</span>
            </div>
          );
        })}
      </div>
      <div ref={sentinel} />
      {err && <div className="m-error">{err}</div>}
      {loaded < size && (
        <button className="m-btn pv-more" disabled={busy} onClick={() => void more()} data-testid="pv-more">
          {busy ? "Carregando…" : `Carregar mais (faltam ${fmtSize(size - loaded)})`}
        </button>
      )}
      {sel && (
        <div className="pv-selbar" data-testid="pv-selbar">
          <span className="grow">{sel.a === sel.b ? `Linha ${sel.a}` : `Linhas ${sel.a}–${sel.b}`}</span>
          <button className="m-btn small" onClick={() => navigator.clipboard?.writeText(lines.slice(sel.a - 1, sel.b).join("\n")).catch(() => {})}>Copiar</button>
          {onAsk && <button className="m-btn small primary" onClick={() => onAsk({ path, a: sel.a, b: sel.b, text: lines.slice(sel.a - 1, sel.b).join("\n") })} data-testid="pv-ask">Perguntar no chat</button>}
          <button className="m-btn small ghost" onClick={() => setSel(null)} aria-label="Limpar seleção">×</button>
        </div>
      )}
    </div>
  );
}

// ---------------- Markdown ----------------

function MarkdownView({ f, path, known, onOpen }: { f: F; path: string; known: Set<string> | null; onOpen: (p: string, line?: number | null) => void }) {
  const { text, err } = useWholeText(f);
  if (err) return <div className="m-error">{err}</div>;
  if (text === null) return <div className="pv-loading dim">Carregando…</div>;
  const open = (href: string) => {
    const rel = joinRel(path, href);
    const hit = (rel && known?.has(rel) ? rel : null) ?? resolveCited(href, known) ?? rel;
    if (hit) onOpen(hit);
  };
  return <div className="pv-md" data-testid="pv-markdown"><Markdown text={text} onFile={open} /></div>;
}

// ---------------- imagem ----------------

function ImageView({ info, path }: { info: FileInfo; path: string }) {
  const [dims, setDims] = useState<string>("");
  return (
    <div className="pv-image">
      <Zoomable>
        <img src={info.url} alt={base(path)} draggable={false} data-testid="pv-image" onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />
      </Zoomable>
      <div className="pv-bar">
        <span className="dim small">{dims && `${dims} · `}{fmtSize(info.size)} · pinça para ampliar, dois toques para alternar</span>
        <span className="grow" />
        <a className="m-btn small" href={info.url} download={base(path)}>Baixar</a>
      </div>
    </div>
  );
}

// ---------------- vídeo / áudio ----------------

function MediaView({ f, kind, path }: { f: F; kind: "video" | "audio"; path: string }) {
  const [src, setSrc] = useState(f.info!.url);
  const at = useRef(0);
  const retries = useRef(0);
  // O link vale 5 minutos: se cair no meio (Range com link vencido), pega outro e volta ao ponto.
  const onError = async (e: SyntheticEvent<HTMLMediaElement>) => {
    at.current = e.currentTarget.currentTime;
    if (retries.current++ > 3) return;
    const i = await f.refresh().catch(() => null);
    if (i) setSrc(i.url);
  };
  const props = { src, controls: true, preload: "metadata", onError, onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => at.current && (e.currentTarget.currentTime = at.current), "data-testid": `pv-${kind}` } as const;
  return (
    <div className="pv-media">
      {kind === "video" ? <video {...props} playsInline /> : <audio {...props} />}
      <div className="pv-bar"><span className="dim small">{fmtSize(f.info!.size)}</span><span className="grow" /><a className="m-btn small" href={src} download={base(path)}>Baixar</a></div>
    </div>
  );
}

// ---------------- PDF / binário ----------------

function FileCard({ info, path, what, open }: { info: FileInfo; path: string; what: string; open?: boolean }) {
  return (
    <div className="pv-card" data-testid="pv-card">
      <div className="pv-card-icon">{open ? "PDF" : "BIN"}</div>
      <b className="pv-card-name">{base(path)}</b>
      <div className="dim small" data-testid="pv-card-size">{what} · {fmtSize(info.size)} · <code>{info.mime}</code></div>
      <div className="row">
        {open && <a className="m-btn primary" href={info.url} target="_blank" rel="noreferrer" data-testid="pv-open">Abrir</a>}
        <a className="m-btn" href={info.url} download={base(path)} data-testid="pv-download">Baixar</a>
      </div>
      {open && <div className="dim small">Abre no visualizador do sistema (com zoom e busca).</div>}
    </div>
  );
}

// ---------------- CSV ----------------

/** CSV com aspas (`"a,b"`, `""` para aspas, quebra de linha dentro de aspas). */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === sep) row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

const sepFor = (path: string, first: string) => (path.endsWith(".tsv") ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",");

function CsvView({ f, path }: { f: F; path: string }) {
  const { text, err } = useWholeText(f);
  const [limit, setLimit] = useState(300);
  const rows = useMemo(() => (text === null ? [] : parseCsv(text, sepFor(path, text.slice(0, text.indexOf("\n") >>> 0)))), [text, path]);
  if (err) return <div className="m-error">{err}</div>;
  if (text === null) return <div className="pv-loading dim">Carregando…</div>;
  const [head, ...body] = rows;
  return (
    <div className="pv-csv">
      <div className="pv-bar"><span className="dim small" data-testid="pv-csv-count">{body.length} linhas · {head?.length ?? 0} colunas</span></div>
      <div className="pv-table-wrap">
        <table className="pv-table" data-testid="pv-csv">
          <thead><tr><th className="pv-rn">#</th>{head?.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{body.slice(0, limit).map((r, i) => <tr key={i}><td className="pv-rn">{i + 1}</td>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {body.length > limit && <button className="m-btn pv-more" onClick={() => setLimit((l) => l + 500)}>Mostrar mais ({body.length - limit} restantes)</button>}
    </div>
  );
}

// ---------------- JSON ----------------

function JsonView({ f }: { f: F; path: string }) {
  const { text, err } = useWholeText(f);
  const parsed = useMemo(() => {
    if (text === null) return null;
    try {
      return { ok: true as const, v: JSON.parse(text.replace(/^﻿/, "")) as unknown };
    } catch (e) {
      return { ok: false as const, e: String((e as Error).message) };
    }
  }, [text]);
  if (err) return <div className="m-error">{err}</div>;
  if (!parsed) return <div className="pv-loading dim">Carregando…</div>;
  if (!parsed.ok) return <><div className="pv-note dim small">JSON inválido ({parsed.e}): mostrando o texto.</div><pre className="pv-pre">{text}</pre></>;
  return <div className="pv-json" data-testid="pv-json"><JsonNode k={null} v={parsed.v} depth={0} /></div>;
}

function JsonNode({ k, v, depth }: { k: string | null; v: unknown; depth: number }) {
  const [limit, setLimit] = useState(200);
  const label = k !== null ? <span className="pv-jk">{k}: </span> : null;
  if (v === null || typeof v !== "object") {
    const cls = typeof v === "string" ? "hl-str" : typeof v === "number" ? "hl-num" : "hl-kw";
    return <div className="pv-jrow">{label}<span className={cls}>{JSON.stringify(v)}</span></div>;
  }
  const arr = Array.isArray(v);
  const entries: [string, unknown][] = arr ? (v as unknown[]).map((x, i) => [String(i), x]) : Object.entries(v as object);
  const summary: ReactNode = <>{label}<span className="dim">{arr ? `[${entries.length}]` : `{${entries.length}}`}</span></>;
  return (
    <details className="pv-jnode" open={depth < 2}>
      <summary>{summary}</summary>
      <div className="pv-jkids">
        {entries.slice(0, limit).map(([kk, vv]) => <JsonNode key={kk} k={kk} v={vv} depth={depth + 1} />)}
        {entries.length > limit && <button className="m-btn small" onClick={() => setLimit((l) => l + 500)}>mais {entries.length - limit}</button>}
      </div>
    </details>
  );
}
