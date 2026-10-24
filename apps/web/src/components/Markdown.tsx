import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Markdown sem HTML cru: títulos, parágrafos, listas (inclusive tarefas), citações, regras, tabelas,
 * imagens, links (URLs e caminhos de arquivo), código com realce simples. Mermaid e KaTeX (`math`,
 * `latex` ou `$$…$$`) são desenhados sob demanda (import dinâmico), com "Copiar fonte".
 */
const KW = /\b(fn|let|const|var|function|return|if|else|for|while|match|impl|struct|enum|pub|use|import|from|export|class|async|await|def|self|true|false|null|None|interface|type|mut|new|try|catch)\b/g;

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|\b\d+(?:\.\d+)?\b)/g;
  let last = 0, k = 0;
  const kw = (s: string) => s.split(KW).map((p, i) => (i % 2 ? <span key={k++} className="hl-kw">{p}</span> : p));
  for (const m of code.matchAll(re)) {
    out.push(...kw(code.slice(last, m.index)));
    const t = m[0];
    out.push(<span key={k++} className={t.startsWith("//") || t.startsWith("#") ? "hl-com" : /^\d/.test(t) ? "hl-num" : "hl-str"}>{t}</span>);
    last = m.index! + t.length;
  }
  out.push(...kw(code.slice(last)));
  return out;
}

export function inline(t: string, onFile?: (p: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|(?<![*\w])\*[^*\n]+\*(?!\w)|https?:\/\/[^\s)]+)/g;
  let last = 0, k = 0;
  for (const m of t.matchAll(re)) {
    if (m.index! > last) out.push(t.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("![")) {
      const [, alt, src] = /!\[([^\]]*)\]\(([^)]+)\)/.exec(s)!;
      out.push(<img key={k++} className="md-img" src={src} alt={alt} />);
    } else if (s.startsWith("[")) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(s)!;
      out.push(<a key={k++} className="md-link" title={href} onClick={() => (/^https?:/.test(href) ? window.dispatchEvent(new CustomEvent("kabul:open-url", { detail: href })) : onFile?.(href.replace(/^\.\//, "")))}>{label}</a>);
    } else if (s.startsWith("http")) {
      out.push(<a key={k++} className="md-link" onClick={() => window.dispatchEvent(new CustomEvent("kabul:open-url", { detail: s }))}>{s}</a>);
    } else if (s.startsWith("`")) {
      const c = s.slice(1, -1);
      const looksFile = onFile && /^[\w./-]+\.[a-z0-9]{1,6}(:\d+)?$/i.test(c) && c.includes("/");
      out.push(looksFile ? <a key={k++} className="md-link md-file" onClick={() => onFile!(c.replace(/:\d+$/, ""))}><code>{c}</code></a> : <code key={k++}>{c}</code>);
    } else if (s.startsWith("**")) out.push(<b key={k++}>{inline(s.slice(2, -2), onFile)}</b>);
    else out.push(<i key={k++}>{s.slice(1, -1)}</i>);
    last = m.index! + s.length;
  }
  out.push(t.slice(last));
  return out;
}

let mermaidSeq = 0;

/** Desenha Mermaid (SVG) ou KaTeX (HTML) sob demanda; se falhar, mostra a fonte com o erro. */
function Rendered({ lang, body }: { lang: string; body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (lang === "mermaid") {
          const m = (await import("mermaid")).default;
          m.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "light" ? "default" : "dark" });
          const { svg } = await m.render(`kabul-mermaid-${++mermaidSeq}`, body);
          if (alive && ref.current) ref.current.innerHTML = svg;
        } else {
          const k = (await import("katex")).default;
          await import("katex/dist/katex.min.css");
          if (alive && ref.current) ref.current.innerHTML = k.renderToString(body, { displayMode: true, throwOnError: true, trust: false });
        }
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message ?? e).split("\n")[0]);
      }
    })();
    return () => void (alive = false);
  }, [lang, body]);
  return err ? <><pre className="md-code">{body}</pre><div className="dim small md-render-err">Não deu para desenhar: {err}</div></> : <div ref={ref} className={"md-rendered md-" + (lang === "mermaid" ? "mermaid" : "math")} data-testid={lang === "mermaid" ? "mermaid" : "katex"} />;
}

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const [copied, setCopied] = useState(false);
  const special = lang === "mermaid" || lang === "math" || lang === "latex";
  return (
    <div className="md-codewrap">
      <div className="md-codebar"><span>{special ? (lang === "mermaid" ? "Mermaid" : "Fórmula") : lang || "código"}</span><span className="grow" /><button className="text-btn small" onClick={() => (navigator.clipboard.writeText(body), setCopied(true), setTimeout(() => setCopied(false), 1000))}>{copied ? "copiado" : special ? (lang === "mermaid" ? "Copiar fonte do Mermaid" : "Copiar fonte") : "Copiar"}</button></div>
      {special ? <Rendered lang={lang} body={body} /> : <pre className="md-code">{highlight(body)}</pre>}
    </div>
  );
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text, onFile }: { text: string; onFile?: (p: string) => void }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  const inl = (t: string) => inline(t, onFile);
  for (let i = 0; i < lines.length; ) {
    const l = lines[i];
    if (l.trim() === "$$") {
      // Bloco $$ … $$ vira fórmula (KaTeX).
      const body: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== "$$"; i++) body.push(lines[i]);
      i++;
      blocks.push(<CodeBlock key={i} lang="math" body={body.join("\n")} />);
      continue;
    }
    if (l.startsWith("```")) {
      const lang = l.slice(3).trim();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) body.push(lines[i]);
      i++;
      blocks.push(<CodeBlock key={i} lang={lang} body={body.join("\n")} />);
    } else if (isRow(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && isRow(lines[i]); i++) rows.push(cells(lines[i]));
      blocks.push(<div key={i} className="md-tablewrap"><table className="md-table"><thead><tr>{head.map((h, k) => <th key={k}>{inl(h)}</th>)}</tr></thead><tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inl(c)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(l);
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={i}>{items.map((x, k) => { const task = /^\[([ xX])\]\s/.exec(x); return <li key={k} className={task ? "md-task" : undefined}>{task && <input type="checkbox" readOnly checked={task[1] !== " "} />}{inl(task ? x.slice(4) : x)}</li>; })}</L>);
    } else if (/^>\s?/.test(l)) {
      const q: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={i} className="md-quote">{q.map((x, k) => <Fragment key={k}>{k > 0 && <br />}{inl(x)}</Fragment>)}</blockquote>);
    } else if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      blocks.push(<hr key={i} className="md-hr" />);
      i++;
    } else if (/^#{1,6}\s/.test(l)) {
      const level = /^#+/.exec(l)![0].length;
      blocks.push(<p key={i} className={`md-h md-h${Math.min(level, 3)}`}>{inl(l.replace(/^#+\s/, ""))}</p>);
      i++;
    } else if (!l.trim()) {
      i++;
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*([-*]|\d+\.)\s|>|\s*\|)/.test(lines[i]); i++) para.push(lines[i]);
      if (!para.length) (para.push(lines[i]), i++);
      blocks.push(<p key={i}>{para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inl(p)}</Fragment>)}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
