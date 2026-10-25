import { kcall } from "../kabuld";

/** Link de um arquivo para o preview (`file_url` do kabuld): vale 5 minutos, preso a você e ao caminho. */
export interface FileInfo { url: string; size: number; mime: string; expires_at: number; max_chunk: number }
export interface Change { path: string; added: number | null; removed: number | null; untracked: boolean }
export type Scope = "all" | "uncommitted" | "branch";
export interface PortState { port: number; listening: boolean }
export interface ProxyOpened { url: string; path: string; port: number; upstream: number; expires_at: number }
export interface ChatSummary { id: string; workspace_id: string; title: string; model: string; harness: string; status: string }

export const files = {
  list: (ws: string) => kcall<string[]>("file_list", { workspaceId: ws }),
  url: (ws: string, path: string) => kcall<FileInfo>("file_url", { workspaceId: ws, path }),
  changes: (ws: string, scope: Scope = "all") => kcall<Change[]>("workspace_changes", { workspaceId: ws, scope }),
  diff: (ws: string, path: string, scope: Scope = "all") => kcall<string>("workspace_file_diff", { workspaceId: ws, path, scope }),
  ports: (ws: string) => kcall<{ base: number; ports: PortState[] }>("proxy_ports", { workspaceId: ws }),
  proxy: (ws: string, port: number) => kcall<ProxyOpened>("proxy_open", { workspaceId: ws, port }),
  chats: (ws: string) => kcall<ChatSummary[]>("chat_list", { workspaceId: ws }),
  send: (chatId: string, text: string) => kcall<{ queued: boolean; id: string }>("chat_send", { chatId, text }),
  /** Navegador do Kabul do workspace: captura atual (null = fechado) e estado. Só leitura no celular. */
  browserShot: (ws: string) => kcall<{ data: string; width: number; height: number; url: string } | null>("browser_screenshot", { workspaceId: ws, quality: 55 }),
  browserStatus: (ws: string) => kcall<{ running: boolean; url: string | null; title: string | null; paused: boolean; agent: { at: number; agent: string; tool: string; detail: string } | null }>("browser_status", { workspaceId: ws }),
};

/** Tamanho de uma página de texto (o arquivo vem por partes com `Range`). */
export const PAGE = 192 << 10;
/** Até aqui um CSV/JSON/Markdown é lido inteiro para ser formatado. */
export const WHOLE_MAX = 3 << 20;

/** Bytes `[start, end)` do arquivo, com `Range` (o kabuld limita cada resposta a 16 MB). */
export async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  if (end <= start) return new Uint8Array();
  const r = await fetch(url, { headers: { range: `bytes=${start}-${end - 1}` }, cache: "no-store" });
  if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Parece binário: byte nulo ou muitos de controle no começo. */
export function looksBinary(b: Uint8Array): boolean {
  const n = Math.min(b.length, 8000);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  return n > 0 && ctrl / n > 0.1;
}

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`);

export const ext = (p: string) => {
  const b = p.split("/").pop() ?? "";
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : b.toLowerCase();
};
export const base = (p: string) => p.split("/").pop() ?? p;
export const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Caminho relativo a partir de outro arquivo (links do Markdown). `null` se sair do workspace. */
export function joinRel(from: string, href: string): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return null;
  const clean = href.split("#")[0].split("?")[0];
  const parts = (clean.startsWith("/") ? [] : dir(from).split("/").filter(Boolean)).concat(clean.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join("/") || null;
}

export type Kind = "code" | "markdown" | "image" | "svg" | "pdf" | "video" | "audio" | "csv" | "json" | "binary";

/** Como mostrar: pela extensão e pelo tipo que o kabuld vai mandar. */
export function kindOf(path: string, mime: string): Kind {
  const e = ext(path);
  if (e === "svg") return "svg";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (e === "csv" || e === "tsv") return "csv";
  if (e === "json" || e === "jsonc" || e === "geojson") return "json";
  if (["md", "markdown", "mdx"].includes(e)) return "markdown";
  if (mime === "application/octet-stream") return "binary";
  return "code";
}

/** Caminho citado (`src/a.ts:12` ou `src/a.ts#L12`): arquivo e linha. */
export function splitLine(p: string): { path: string; line: number | null } {
  const m = /^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$/.exec(p.trim());
  return m ? { path: m[1], line: Number(m[2] ?? m[3]) } : { path: p.trim(), line: null };
}
