import { useEffect, useState } from "react";
import { Floating } from "./Floating";
import { api, HARNESS_LABEL, type HarnessKind, type McpShared } from "../api";
import { IPlus } from "../icons";

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

/** 3200 → "3,2k". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  return (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
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
    if (!confirm(`Gravar "${m.name}" na config global do Antigravity (~/.gemini/config/mcp_config.json)? O Kabul guarda um backup ao lado.`)) return;
    try {
      const b = await api.mcpExportAgy(workspaceId, m.name);
      setNote(b ? `“${m.name}” exportado para o Antigravity (backup em ${b}).` : `“${m.name}” exportado para o Antigravity.`);
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
      <div className="pop-title row">MCP da sessão <span className="grow" /><span className="dim small">{HARNESS_LABEL[harness]}{live ? ` · ${live.total} ferramentas` : ""}</span></div>
      {entries && entries.length > 0 && (
        <div className="mcp-profiles row" data-testid="mcp-profiles">
          <button className={"mcp-chip" + (sessionOff.length === 0 ? " on" : "")} onClick={() => setSessionOff([])} data-testid="mcp-profile-all">Todos</button>
          <button className="mcp-chip" disabled={!essential.length} title={essential.length ? "Liga só os marcados com ★" : "Marque com ★ os essenciais deste repositório"} onClick={() => setSessionOff(all.filter((n) => !essential.includes(n)))} data-testid="mcp-profile-essential">Só o essencial</button>
          <span className="grow" />
          {(using > 0 || saved > 0) && (
            <span className="dim small" data-testid="mcp-savings">
              ~{fmtTokens(using)} tokens/turno{saved > 0 && <b className="mcp-saved"> · −{fmtTokens(saved)} tokens por turno</b>}
            </span>
          )}
        </div>
      )}
      {note && <div className="pop-row dim small" data-testid="mcp-note">{note}</div>}
      {entries === null && <div className="pop-row dim">Lendo configuração…</div>}
      {entries?.length === 0 && <div className="pop-row dim">Nenhum MCP configurado em nenhuma IA.</div>}
      {entries?.map((m) => {
        const st = live?.status[m.name];
        const off = isOff(m.name);
        const here = reaches(m);
        const n = tools(m);
        const t = tokens(m);
        return (
          <div key={m.name} className={"mcp-row" + (off || !here ? " off" : "")} data-testid="mcp-row">
            <span className={"dot " + (st === "connected" ? "st-done" : st === "failed" ? "st-fail" : st ? "st-in-progress" : "")} title={st ?? "ainda não iniciado nesta sessão"} />
            <div className="mcp-main">
              <div className="row">
                <button className={"text-btn star" + (essential.includes(m.name) ? " on" : "")} title="Essencial neste repositório (perfil “Só o essencial”)" onClick={() => toggleEssential(m.name)} data-testid="mcp-star">{essential.includes(m.name) ? "★" : "☆"}</button>
                <b>{m.name}</b>
                {m.origins.map((o) => <span key={o.harness} className="badge" title={`${o.scope} · ${o.source}`}>do {ORIGIN_LABEL[o.harness] ?? o.harness}</span>)}
                {m.conflict && <span className="badge warn" title="Mesmo nome com configurações diferentes em CLIs diferentes: vale a primeira">conflito</span>}
                {st === "failed" && <span className="error small">falhou</span>}
              </div>
              <div className="dim small mcp-target" title={`${m.target}${m.env_keys.length ? ` · variáveis: ${m.env_keys.join(", ")}` : ""}`}>{m.transport} · {m.target}</div>
              <div className="dim small row mcp-meta">
                {n != null ? <span data-testid="mcp-weight">{n} ferramenta{n === 1 ? "" : "s"}{t != null ? ` · ~${fmtTokens(t)} tokens` : ""}</span> : m.transport === "stdio" ? <button className="text-btn small" onClick={() => weigh(m)} disabled={weighing === m.name} data-testid="mcp-weigh">{weighing === m.name ? "medindo…" : "medir peso"}</button> : <span>peso desconhecido</span>}
                <span className="grow" />
                {!native(m) && harness === "antigravity" ? (
                  <button className="text-btn small" onClick={() => exportAgy(m)} title="A config de MCP do Antigravity é só global" data-testid="mcp-export-agy">Exportar para o Antigravity</button>
                ) : (
                  <label className="row mcp-share" title={m.shared ? "Disponível em todas as IAs" : m.transport !== "stdio" ? "Remoto com login: fica só no CLI de origem até você ligar" : "Só nos CLIs de origem"}>
                    <span className={"toggle small" + (m.shared ? " on" : "")} onClick={() => toggleShared(m)} data-testid="mcp-share"><span /></span>todas as IAs
                  </label>
                )}
              </div>
            </div>
            <label className="mcp-toggle" title={here ? "Ligar/desligar nesta sessão (vale no próximo turno)" : "Não chega a esta IA"}>
              <span className={"toggle" + (here && !sessionOff.includes(m.name) ? " on" : "")} onClick={() => here && setSessionOff(sessionOff.includes(m.name) ? sessionOff.filter((x) => x !== m.name) : [...sessionOff, m.name])}><span /></span>
            </label>
            <button className={"text-btn small" + (repoOff.includes(m.name) ? " error" : "")} title="Desligar em todas as sessões deste repositório (padrão do repo)" onClick={() => toggleRepo(m.name)}>{repoOff.includes(m.name) ? "desligado no repo" : "desligar no repo"}</button>
          </div>
        );
      })}
      {adding ? (
        <div className="mcp-add">
          <input autoFocus placeholder="nome (ex.: docs)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="comando ou URL (ex.: npx -y @org/mcp  ·  https://…/mcp)" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          <div className="row end"><button className="btn" onClick={() => setAdding(false)}>Cancelar</button><button className="btn primary" disabled={!form.name || !form.command} onClick={add}>Adicionar ao .mcp.json</button></div>
        </div>
      ) : (
        <div className="pop-row add-models" onClick={() => setAdding(true)} data-testid="mcp-add"><IPlus /> <span>Adicionar MCP ao projeto</span></div>
      )}
      <div className="dim small mcp-foot">Mudanças valem no próximo turno, em qualquer IA (a conversa continua). Valores de variáveis e cabeçalhos não aparecem aqui.</div>
    </Floating>
  );
}
