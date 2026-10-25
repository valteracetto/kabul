import { useCallback, useEffect, useRef, useState } from "react";
import { fetchRange, files, type FileInfo } from "./api";

/** Link do arquivo, renovado quando expira (vale 5 minutos; um vídeo longo passa disso). */
export function useFileInfo(ws: string, path: string) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = useRef<FileInfo | null>(null);
  const refresh = useCallback(async () => {
    const i = await files.url(ws, path);
    cur.current = i;
    setInfo(i);
    return i;
  }, [ws, path]);
  useEffect(() => {
    setInfo(null);
    setErr(null);
    refresh().catch((e) => setErr(String((e as Error)?.message ?? e)));
  }, [refresh]);
  /** Link válido agora (renova faltando menos de 20 s). */
  const fresh = useCallback(async () => {
    const i = cur.current;
    if (i && i.expires_at - Date.now() / 1000 > 20) return i;
    return refresh();
  }, [refresh]);
  /** Pedaço do arquivo; se o link caiu no meio, pede outro e tenta de novo. */
  const range = useCallback(
    async (start: number, end: number) => {
      const i = await fresh();
      try {
        return await fetchRange(i.url, start, Math.min(end, i.size));
      } catch {
        const j = await refresh();
        return fetchRange(j.url, start, Math.min(end, j.size));
      }
    },
    [fresh, refresh],
  );
  return { info, err, refresh, fresh, range };
}

const cache = new Map<string, { at: number; list: Promise<string[]> }>();

/** Lista de arquivos do workspace (cache de 30 s, compartilhado entre a árvore e o chat). */
export function fileList(ws: string, force = false): Promise<string[]> {
  const c = cache.get(ws);
  if (!force && c && Date.now() - c.at < 30_000) return c.list;
  const list = files.list(ws);
  cache.set(ws, { at: Date.now(), list });
  list.catch(() => cache.delete(ws));
  return list;
}

export function useFileSet(ws: string | null): Set<string> | null {
  const [set, setSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!ws) return;
    let alive = true;
    fileList(ws).then((l) => alive && setSet(new Set(l)), () => {});
    return () => void (alive = false);
  }, [ws]);
  return set;
}

/** Acha o arquivo citado: caminho exato ou, se único, o que termina com ele (`main.rs` → `src/main.rs`). */
export function resolveCited(cited: string, set: Set<string> | null): string | null {
  const p = cited.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!set || !p) return null;
  if (set.has(p)) return p;
  let hit: string | null = null;
  for (const f of set) {
    if (f.endsWith("/" + p)) {
      if (hit) return null;
      hit = f;
    }
  }
  return hit;
}
