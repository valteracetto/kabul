import { useEffect, useState } from "react";
import { Floating } from "./Floating";
import { api, HARNESS_LABEL, type HarnessKind, type McpShared } from "../api";
import { IPlus } from "../icons";
import { t } from "../i18n";
import { fmtNum } from "../i18n/format";

export interface McpLive { status: Record<string, string>; tools: Record<string, number>; total: number }

const repoKey = (repoId: string) => `kabul.mcp.repoOff.${repoId}`;
const essentialKey = (repoId: string) => `kabul.mcp.essential.${repoId}`;
const sessionKey = (sessionId: string) => `kabul.mcp.sessionOff.${sessionId}`;
const read = (k: string): string[] => JSON.parse(localStorage.getItem(k) ?? "[]");
export const repoDisabled = (repoId: string): string[] => read(repoKey(repoId));
/** Escolha de MCP lembrada por sessão (aba de conversa). */
export const sessionDisabled = (sessionId: string): string[] => read(sessionKey(sessionId));
export const saveSessionDisabled = (sessionId: string, v: string[]) => localStorage.setItem(sessionKey(sessionId), JSON.stringify(v));

/** Id do harness como aparece nas origens do registro (`agy` para o Antigravity). */
const originId = (h: HarnessKind) => (h === "antigravity" ? "agy" : h);
const ORIGIN_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", agy: "Antigravity", opencode: "OpenCode", gemini: "Gemini CLI", qwen: "Qwen Code", goose: "Goose", cursor: "Cursor" };

/** 3200 → "3,2k" (pt-BR) / "3.2k" (en). */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return fmtNum(n / 1000, { maximumFractionDigits: 1 }) + "k";
}

/**
 * Painel de MCPs da sessão. Registro único: todo MCP configurado em qualquer IA (Claude, Codex, OpenCode,
 * Gemini CLI, Qwen Code, Antigravity) aparece com a origem e chega às outras IAs (o Kabul injeta no
 * formato de cada uma). Cada um mostra o peso no contexto (ferramentas e tokens das definições),
 * liga/desliga por sessão (lembrado) e por repo, com perfis rápidos e a economia estimada.
 */
export function McpPanel({ workspaceId, repoId, harness, live, sessionOff, setSessionOff, onError }: {
  workspaceId: string; repoId: string; harness: HarnessKind; live: McpLive | null;
  sessionOff: string[]; setSessionOff: (v: string[]) => void; onError: (e: string) => void;
}) {
  const [entries, setEntries] = useState<McpShared[] | null>(null);
  const [repoOff, setRepoOff] = useState<string[]>(() => repoDisabled(repoId));
  const [essential, setEssential] = useState<string[]>(() => read(essentialKey(repoId)));
  const [weighing, setWeighing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", command: "" });
  const load = () => api.mcpShared(workspaceId).then(setEntries, (e) => (setEntries([]), onError(String(e))));
  useEffect(() => void load(), [workspaceId]);

  const me = originId(harness);
  const native = (m: McpShared) => m.origins.some((o) => o.harness === me);
  /** Chega a esta IA: nativo dele, ou compartilhado (o agy não recebe por sessão: a config dele é global). */
  const reaches = (m: McpShared) => native(m) || (m.shared && harness !== "antigravity");
  // Ferramentas: as vistas nesta sessão (init do agente) valem mais que a medida em cache.
  const tools = (m: McpShared) => live?.tools[m.name] ?? m.weight?.tools ?? null;
  // Sem medida, estima pelas ferramentas vistas no init (≈ 450 tokens por ferramenta).
  const tokens = (m: McpShared) => m.weight?.tokens ?? (live?.tools[m.name] != null ? live.tools[m.name] * 450 : null);
  const isOff = (n: string) => sessionOff.includes(n) || repoOff.includes(n);
  const saved = (entries ?? []).filter((m) => reaches(m) && isOff(m.name)).reduce((a, m) => a + (tokens(m) ?? 0), 0);
  const using = (entries ?? []).filter((m) => reaches(m) && !isOff(m.name)).reduce((a, m) => a + (tokens(m) ?? 0), 0);

  const toggleRepo = (n: string) => {
    const v = repoOff.includes(n) ? repoOff.filter((x) => x !== n) : [...repoOff, n];
    localStorage.setItem(repoKey(repoId), JSON.stringify(v));
    setRepoOff(v);
  };
  const toggleEssential = (n: string) => {
    const v = essential.includes(n) ? essential.filter((x) => x !== n) : [...essential, n];
    localStorage.setItem(essentialKey(repoId), JSON.stringify(v));
    setEssential(v);
  };
  const toggleShared = async (m: McpShared) => {
    try {
      await api.mcpSetShared(workspaceId, m.name, !m.shared);
      load();
    } catch (e) {
      onError(String(e));
    }
  };
  const weigh = async (m: McpShared) => {
    setWeighing(m.name);
    try {
      const w = await api.mcpWeigh(workspaceId, m.name);
      setEntries((es) => es?.map((x) => (x.name === m.name ? { ...x, weight: w } : x)) ?? null);
    } catch (e) {
      onError(String(e));
    } finally {
      setWeighing(null);
    }
  };
  const exportAgy = async (m: McpShared) => {
    if (!confirm(t("chat.mcp.exportConfirm", { name: m.name }))) return;
    try {
      const b = await api.mcpExportAgy(workspaceId, m.name);
      setNote(b ? t("chat.mcp.exportedBackup", { name: m.name, backup: b }) : t("chat.mcp.exported", { name: m.name }));
      load();
    } catch (e) {
      onError(String(e));
    }
  };
  const add = async () => {
    const [command, ...args] = form.command.trim().split(/\s+/);
    try {
      await api.mcpAdd(workspaceId, form.name.trim(), command, args);
      setForm({ name: "", command: "" });
      setAdding(false);
      load();
    } catch (e) {
      onError(String(e));
    }
  };
  const all = (entries ?? []).filter(reaches).map((m) => m.name);
  return (
    <Floating className="apps-pop mcp-pop" placement="top-end" testid="mcp-panel">
      <div className="pop-title row">{t("chat.mcp.title")} <span className="grow" /><span className="dim small">{HARNESS_LABEL[harness]}{live ? ` · ${t("chat.mcp.tools", { count: live.total })}` : ""}</span></div>
      {entries && entries.length > 0 && (
        <div className="mcp-profiles row" data-testid="mcp-profiles">
          <button className={"mcp-chip" + (sessionOff.length === 0 ? " on" : "")} onClick={() => setSessionOff([])} data-testid="mcp-profile-all">{t("chat.mcp.all")}</button>
          <button className="mcp-chip" disabled={!essential.length} title={essential.length ? t("chat.mcp.essentialOn") : t("chat.mcp.essentialMark")} onClick={() => setSessionOff(all.filter((n) => !essential.includes(n)))} data-testid="mcp-profile-essential">{t("chat.mcp.essential")}</button>
          <span className="grow" />
          {(using > 0 || saved > 0) && (
            <span className="dim small" data-testid="mcp-savings">
              {t("chat.mcp.usingPerTurn", { n: fmtTokens(using) })}{saved > 0 && <b className="mcp-saved"> · {t("chat.mcp.savedPerTurn", { n: fmtTokens(saved) })}</b>}
            </span>
          )}
        </div>
      )}
      {note && <div className="pop-row dim small" data-testid="mcp-note">{note}</div>}
      {entries === null && <div className="pop-row dim">{t("chat.mcp.reading")}</div>}
      {entries?.length === 0 && <div className="pop-row dim">{t("chat.mcp.none")}</div>}
      {entries?.map((m) => {
        const st = live?.status[m.name];
        const off = isOff(m.name);
        const here = reaches(m);
        const n = tools(m);
        const tok = tokens(m);
        return (
          <div key={m.name} className={"mcp-row" + (off || !here ? " off" : "")} data-testid="mcp-row">
            <span className={"dot " + (st === "connected" ? "st-done" : st === "failed" ? "st-fail" : st ? "st-in-progress" : "")} title={st ?? t("chat.mcp.notStarted")} />
            <div className="mcp-main">
              <div className="row">
                <button className={"text-btn star" + (essential.includes(m.name) ? " on" : "")} title={t("chat.mcp.starTitle")} onClick={() => toggleEssential(m.name)} data-testid="mcp-star">{essential.includes(m.name) ? "★" : "☆"}</button>
                <b>{m.name}</b>
                {m.origins.map((o) => <span key={o.harness} className="badge" title={`${o.scope} · ${o.source}`}>{t("chat.mcp.from", { origin: ORIGIN_LABEL[o.harness] ?? o.harness })}</span>)}
                {m.conflict && <span className="badge warn" title={t("chat.mcp.conflictTitle")}>{t("chat.mcp.conflict")}</span>}
                {st === "failed" && <span className="error small">{t("chat.mcp.failed")}</span>}
              </div>
              <div className="dim small mcp-target" title={`${m.target}${m.env_keys.length ? ` · ${t("chat.mcp.vars", { vars: m.env_keys.join(", ") })}` : ""}`}>{m.transport} · {m.target}</div>
              <div className="dim small row mcp-meta">
                {n != null ? <span data-testid="mcp-weight">{t("chat.mcp.tools", { count: n })}{tok != null ? ` · ${t("chat.mcp.approxTokens", { n: fmtTokens(tok) })}` : ""}</span> : m.transport === "stdio" ? <button className="text-btn small" onClick={() => weigh(m)} disabled={weighing === m.name} data-testid="mcp-weigh">{weighing === m.name ? t("chat.mcp.weighing") : t("chat.mcp.weigh")}</button> : <span>{t("chat.mcp.unknownWeight")}</span>}
                <span className="grow" />
                {!native(m) && harness === "antigravity" ? (
                  <button className="text-btn small" onClick={() => exportAgy(m)} title={t("chat.mcp.agyGlobal")} data-testid="mcp-export-agy">{t("chat.mcp.exportAgy")}</button>
                ) : (
                  <label className="row mcp-share" title={m.shared ? t("chat.mcp.sharedAll") : m.transport !== "stdio" ? t("chat.mcp.remoteLogin") : t("chat.mcp.originOnly")}>
                    <span className={"toggle small" + (m.shared ? " on" : "")} onClick={() => toggleShared(m)} data-testid="mcp-share"><span /></span>{t("chat.mcp.allAis")}
                  </label>
                )}
              </div>
            </div>
            <label className="mcp-toggle" title={here ? t("chat.mcp.toggleSession") : t("chat.mcp.notReaching")}>
              <span className={"toggle" + (here && !sessionOff.includes(m.name) ? " on" : "")} onClick={() => here && setSessionOff(sessionOff.includes(m.name) ? sessionOff.filter((x) => x !== m.name) : [...sessionOff, m.name])}><span /></span>
            </label>
            <button className={"text-btn small" + (repoOff.includes(m.name) ? " error" : "")} title={t("chat.mcp.repoOffTitle")} onClick={() => toggleRepo(m.name)}>{repoOff.includes(m.name) ? t("chat.mcp.repoIsOff") : t("chat.mcp.repoOff")}</button>
          </div>
        );
      })}
      {adding ? (
        <div className="mcp-add">
          <input autoFocus placeholder={t("chat.mcp.namePh")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder={t("chat.mcp.commandPh")} value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="row end"><button className="btn" onClick={() => setAdding(false)}>{t("common.cancel")}</button><button className="btn primary" disabled={!form.name || !form.command} onClick={add}>{t("chat.mcp.addToJson")}</button></div>
        </div>
      ) : (
        <div className="pop-row add-models" onClick={() => setAdding(true)} data-testid="mcp-add"><IPlus /> <span>{t("chat.mcp.addToProject")}</span></div>
      )}
      <div className="dim small mcp-foot">{t("chat.mcp.foot")}</div>
    </Floating>
  );
}
