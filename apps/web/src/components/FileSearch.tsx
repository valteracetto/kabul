import { useEffect, useMemo, useRef, useState } from "react";
import { api, type GrepHit, type Workspace } from "../api";
import { noSuggest } from "../noSuggest";
import { FileIcon, ISearch } from "../icons";

/** Pontuação fuzzy simples: letras em ordem; mais pontos para nome do arquivo e sequências. */
export function fuzzy(q: string, path: string): number {
  if (!q) return 1;
  const s = path.toLowerCase(), n = q.toLowerCase();
  const name = s.slice(s.lastIndexOf("/") + 1);
  if (name.startsWith(n)) return 1000 - name.length;
  if (name.includes(n)) return 800 - name.length;
  if (s.includes(n)) return 600 - s.length;
  let i = 0, score = 0, run = 0;
  for (const ch of s) {
    if (ch === n[i]) (i++, run++, (score += run));
    else run = 0;
    if (i === n.length) return 100 + score - s.length / 10;
  }
  return -1;
}

function Overlay({ children, onClose, testid }: { children: React.ReactNode; onClose: () => void; testid: string }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover palette" onMouseDown={(e) => e.stopPropagation()} data-testid={testid}>{children}</div>
    </div>
  );
}

/** ⌘P: abrir arquivo pelo nome. */
export function QuickOpen({ ws, onOpen, onClose }: { ws: Workspace; onOpen: (path: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => void api.files(ws.id).then(setFiles, () => {}), [ws.id]);
  useEffect(() => input.current?.focus(), []);
  const hits = useMemo(() => files.map((f) => [f, fuzzy(q, f)] as const).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([f]) => f), [files, q]);
  const pick = (f: string) => (onOpen(f), onClose());
  return (
    <Overlay onClose={onClose} testid="quick-open">
      <label className="pop-search"><ISearch />
        <input ref={input} {...noSuggest} autoComplete="off" placeholder="Abrir arquivo…" value={q} onChange={(e) => (setQ(e.target.value), setSel(0))} data-testid="quick-open-input"
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.stopPropagation(), onClose());
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, hits.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            if (e.key === "Enter" && hits[sel]) pick(hits[sel]);
          }} />
      </label>
      <div className="pop-sep" />
      <div className="pop-list">
        {hits.map((f, k) => {
          const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
          return <div key={f} className={"pop-row" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => pick(f)} data-testid="quick-open-row"><FileIcon name={f.split("/").pop()!} /><span className="label">{f.split("/").pop()}</span><span className="dim small">{dir}</span></div>;
        })}
        {hits.length === 0 && <div className="pop-row dim">Nenhum arquivo para “{q}”</div>}
      </div>
    </Overlay>
  );
}

/** ⌘⇧F: buscar texto em todos os arquivos do workspace. */
export function SearchFiles({ ws, onOpen, onClose }: { ws: Workspace; onOpen: (path: string, line: number) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GrepHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!q.trim()) return setHits(null);
    const t = setTimeout(() => api.grep(ws.id, q).then((h) => (setHits(h), setSel(0)), () => setHits([])), 180);
    return () => clearTimeout(t);
  }, [q, ws.id]);
  const files = useMemo(() => [...new Set((hits ?? []).map((h) => h.path))], [hits]);
  const flat = hits ?? [];
  const pick = (h: GrepHit) => (onOpen(h.path, h.line), onClose());
  const mark = (t: string) => {
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? t : <>{t.slice(0, i)}<mark>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>;
  };
  return (
    <Overlay onClose={onClose} testid="search-files">
      <label className="pop-search"><ISearch />
        <input ref={input} {...noSuggest} autoComplete="off" placeholder="Buscar nos arquivos…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="search-files-input"
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.stopPropagation(), onClose());
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, flat.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
            if (e.key === "Enter" && flat[sel]) pick(flat[sel]);
          }} />
      </label>
      <div className="pop-sep" />
      <div className="pop-list grep-list">
        {hits && <div className="pop-title">{flat.length} resultado{flat.length === 1 ? "" : "s"} em {files.length} arquivo{files.length === 1 ? "" : "s"}</div>}
        {files.map((f) => (
          <div key={f}>
            <div className="grep-file"><FileIcon name={f.split("/").pop()!} /> {f}</div>
            {flat.map((h, k) => h.path === f && (
              <div key={k} className={"pop-row grep-hit" + (k === sel ? " on" : "")} onMouseEnter={() => setSel(k)} onClick={() => pick(h)} data-testid="search-hit">
                <span className="dim small ln-no">{h.line}</span><code>{mark(h.text.trim())}</code>
              </div>
            ))}
          </div>
        ))}
        {hits && flat.length === 0 && <div className="pop-row dim">Nada encontrado para “{q}”</div>}
      </div>
    </Overlay>
  );
}
