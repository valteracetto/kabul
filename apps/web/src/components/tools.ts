/**
 * Ferramentas: rótulos e textos montados a partir dos dados do núcleo (o núcleo manda ids e argumentos;
 * o texto, no idioma da tela, nasce aqui). Usado pela tela do desktop e pela do celular.
 */
import { api, type ToolFinding, type ToolItem, type ToolPlacement, type ToolScope, type ToolsSnapshot } from "../api";
import { has, t, type Key, type Vars } from "../i18n";
import { fmtCompact } from "../i18n/format";

/** Texto de uma chave montada a partir de dados (cai no `fallback` quando não existe). */
export const tr = (k: string, vars: Vars = {}, fallback = ""): string => (has(k) ? t(k as Key, vars) : fallback || k.split(".").pop() || k);

export const harnessLabel = (id: string, snap?: ToolsSnapshot | null): string => {
  if (id === "shared") return t("tools.harness.shared");
  if (id === "other") return t("tools.harness.other");
  return snap?.harnesses.find((h) => h.id === id)?.label ?? id;
};
export const kindLabel = (k: string) => tr(`tools.kind.${k}`, {}, k);
export const kindPlural = (k: string) => tr(`tools.kinds.${k}`, {}, k);
export const catLabel = (c: string) => tr(`tools.cat.${c}`, {}, c);
export const riskLabel = (r: string) => tr(`tools.risk.${r}`, {}, r);
export const sourceKindLabel = (k: string) => tr(`tools.sourceKind.${k}`, {}, k);
export const sevLabel = (s: string) => tr(`tools.sev.${s}`, {}, s);
export const whatLabel = (w: string) => tr(`tools.what.${w}`, {}, w);
export const howLabel = (h: string) => tr(`tools.how.${h}`, {}, h);

/** Rótulo de uma fonte: as genéricas ("local", "project") são traduzidas. */
export const sourceLabel = (id: string | undefined, snap?: ToolsSnapshot | null): string => {
  if (!id) return t("tools.source.unknown");
  const s = snap?.sources.find((x) => x.id === id);
  if (id === "local" || s?.kind === "local") return t("tools.source.local");
  if (id === "project" || s?.kind === "project") return t("tools.source.project");
  if (s && (s.kind === "builtin" || s.kind === "synced")) return t(s.kind === "synced" ? "tools.source.synced" : "tools.source.builtin", { ai: s.label });
  return s?.label ?? id;
};

/** Frase do achado e "por que importa". */
export const findingTitle = (f: ToolFinding, items?: ToolItem[]): string => {
  const name = items?.find((i) => i.id === f.itemIds[0])?.name ?? f.itemIds[0]?.split(":").slice(1).join(":") ?? f.paths[0] ?? "";
  return tr(`tools.finding.${f.kind}.title`, { name, ...f.args, path: f.paths[0] ?? "" }, f.kind);
};
export const findingWhy = (f: ToolFinding) => tr(`tools.finding.${f.kind}.why`, f.args, "");

/** Como o item está naquela pasta, para o selo: cópia, link, divergente, quebrado ou gerido. */
export type PlaceState = "copy" | "link" | "drift" | "broken" | "managed" | "canonical";
export function placeState(p: ToolPlacement, findings: ToolFinding[], itemId: string): PlaceState {
  if (p.link.kind === "broken") return "broken";
  if (findings.some((f) => f.kind === "drift" && f.itemIds.includes(itemId) && f.paths.includes(p.path))) return "drift";
  if (p.link.kind === "symlink") return "link";
  if (p.managed || p.plugin) return "managed";
  if (p.canonical) return "canonical";
  return "copy";
}
export const STATE_GLYPH: Record<PlaceState, string> = { copy: "●", canonical: "●", link: "↗", drift: "⚠", broken: "✕", managed: "◆" };
export const stateLabel = (s: PlaceState) => tr(`tools.state.${s}`, {}, s);

/** Prefixo do item na paleta (Skill: x, Comando: /x, MCP: x...). */
export const paletteLabel = (i: ToolItem) => {
  const slash = i.kind === "command" || i.kind === "prompt" ? i.invoke[0]?.text ?? `/${i.name}` : i.name;
  return `${kindLabel(i.kind)}: ${slash}`;
};

/** Snapshot recente para a paleta (sem varrer o disco a cada tecla). */
let palCache: { at: number; key: string; snap: ToolsSnapshot } | null = null;
export async function toolsForPalette(workspaceId: string | null): Promise<ToolItem[]> {
  const key = workspaceId ?? "";
  if (palCache && palCache.key === key && Date.now() - palCache.at < 60_000) return palCache.snap.items;
  const snap = await api.toolsSnapshot("all" as ToolScope, workspaceId);
  palCache = { at: Date.now(), key, snap };
  return snap.items;
}

/** Item bate com a busca (nome, descrição, categoria, IA, fonte). */
export function matches(i: ToolItem, q: string, snap?: ToolsSnapshot | null): boolean {
  if (!q) return true;
  const hay = [i.name, i.description ?? "", i.kind, kindLabel(i.kind), ...i.categories.map(catLabel), ...i.harnesses.map((h) => harnessLabel(h, snap)), sourceLabel(i.sourceId, snap), i.note ?? ""].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Grupos por categoria (a primeira categoria de cada item), favoritos primeiro. */
export function byCategory(items: ToolItem[]): [string, ToolItem[]][] {
  const m = new Map<string, ToolItem[]>();
  const fav = items.filter((i) => i.favorite);
  if (fav.length) m.set("__fav", fav);
  for (const i of items) {
    const c = i.categories[0] ?? "other";
    m.set(c, [...(m.get(c) ?? []), i]);
  }
  return [...m].sort((a, b) => (a[0] === "__fav" ? -1 : b[0] === "__fav" ? 1 : a[0] === "other" ? 1 : b[0] === "other" ? -1 : catLabel(a[0]).localeCompare(catLabel(b[0]))));
}

export const SEV_RANK: Record<string, number> = { error: 3, warn: 2, info: 1 };
export const fmtTokens = (n?: number) => (n == null ? "—" : fmtCompact(n));
