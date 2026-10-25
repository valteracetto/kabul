import { useEffect, useState, type RefObject } from "react";
import { transport } from "../../transport";
import { base, files, splitLine, type Change } from "./api";
import { resolveCited, useFileSet } from "./hooks";
import { go, openFile, openFiles } from "./route";
import { t } from "../../i18n";

/**
 * Caminhos citados pelo agente viram links para o preview: código inline (`src/a.ts:12`,
 * `README.md`) que bate com um arquivo do workspace ganha `data-kabul-file` e abre ao toque. O
 * Markdown já liga os caminhos com pasta (`onFile`); este gancho cobre os da raiz e `main.rs` →
 * `src/main.rs` quando só há um.
 */
export function useFileTaps(ref: RefObject<HTMLElement | null>, ws: string | null, from: string) {
  const set = useFileSet(ws);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ws || !set) return;
    const mark = () => {
      el.querySelectorAll<HTMLElement>(".m-msg code:not([data-kabul-file]), .m-tool summary .dim:not([data-kabul-file])").forEach((c) => {
        if (c.closest("pre, a")) return;
        const { path } = splitLine(c.textContent ?? "");
        const hit = path.length < 300 ? resolveCited(path, set) : null;
        c.dataset.kabulFile = hit ?? "";
        if (hit) c.classList.add("pv-filecode");
      });
    };
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    const click = (e: MouseEvent) => {
      // O link de arquivo do Markdown (`a.md-file`) perde a linha (`:12`): tratado aqui, antes dele.
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-kabul-file], a.md-file");
      const path = c?.matches("a.md-file") ? resolveCited(splitLine(c.textContent ?? "").path, set) : c?.dataset.kabulFile;
      if (!c || !path) return;
      e.preventDefault();
      e.stopPropagation();
      openFile(ws, path, { line: splitLine(c.textContent ?? "").line, from });
    };
    el.addEventListener("click", click);
    return () => (mo.disconnect(), el.removeEventListener("click", click));
  }, [ref, ws, set, from]);
}

/** Abre um caminho que o Markdown do chat ligou (`onFile`), com a linha se veio junto. */
export const chatFileOpener = (ws: string | null, from: string) => (p: string) => {
  if (!ws) return;
  const { path, line } = splitLine(p);
  openFile(ws, path.replace(/^\.\//, ""), { line, from });
};

/** Faixa de arquivos alterados acima do campo de mensagem (toque abre o diff); atualiza a cada turno. */
export function ChangedChips({ ws, from }: { ws: string | null; from: string }) {
  const [list, setList] = useState<Change[]>([]);
  useEffect(() => {
    if (!ws) return;
    const load = () => files.changes(ws, "all").then(setList, () => {});
    load();
    let t: number | null = null;
    const off = transport.subscribe("chat-state", (c: { workspace_id?: string; status?: string }) => {
      if (c.workspace_id !== ws || c.status === "working") return;
      if (t) clearTimeout(t);
      t = window.setTimeout(load, 400);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, [ws]);
  if (!ws) return null;
  return (
    <div className="pv-chips" data-testid="pv-chips">
      <button className="pv-chip files" onClick={() => openFiles(ws, from)} data-testid="pv-chip-files">{t("mobile.pv.files")}</button>
      {list.slice(0, 12).map((c) => (
        <button key={c.path} className="pv-chip" onClick={() => go({ ws, diff: c.path, from })} title={c.path} data-testid="pv-chip" data-path={c.path}>
          {base(c.path)} {c.added !== null && <><span className="pv-add">+{c.added}</span><span className="pv-del">−{c.removed ?? 0}</span></>}
        </button>
      ))}
      {list.length > 12 && <button className="pv-chip" onClick={() => openFiles(ws, from, "changes")}>+{list.length - 12}</button>}
    </div>
  );
}

/** Botão "Arquivos" (cabeçalho da sessão e grupo da lista). */
export function FilesButton({ ws, from, small }: { ws: string; from?: string | null; small?: boolean }) {
  return <button className={"m-btn" + (small ? " small" : " ghost pv-files-btn")} onClick={() => openFiles(ws, from)} data-testid="m-files" aria-label={t("mobile.pv.wsFiles")}>{small ? t("mobile.pv.files") : "⧉"}</button>;
}
