import { useEffect, useState } from "react";
import { api, HARNESS_LABEL, type HarnessKind, type McpEntry } from "../api";
import { IPlus } from "../icons";

export interface McpLive { status: Record<string, string>; tools: Record<string, number>; total: number }

const repoKey = (repoId: string) => `kabul.mcp.repoOff.${repoId}`;
export const repoDisabled = (repoId: string): string[] => JSON.parse(localStorage.getItem(repoKey(repoId)) ?? "[]");

/**
 * Painel de MCPs da sessão: lidos da config do agente, status e nº de ferramentas vindos do `init`,
 * toggles por sessão e por repositório (valem no próximo turno) e "Adicionar MCP" (.mcp.json do projeto).
 */
export function McpPanel({ workspaceId, repoId, harness, live, sessionOff, setSessionOff, onError }: {
  workspaceId: string; repoId: string; harness: HarnessKind; live: McpLive | null;
  sessionOff: string[]; setSessionOff: (v: string[]) => void; onError: (e: string) => void;
}) {
  const [entries, setEntries] = useState<McpEntry[] | null>(null);
  const [repoOff, setRepoOff] = useState<string[]>(() => repoDisabled(repoId));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", command: "" });
  const load = () => api.mcpList(workspaceId, harness).then(setEntries, (e) => (setEntries([]), onError(String(e))));
  useEffect(() => void load(), [workspaceId, harness]);

  const toggleRepo = (n: string) => {
    const v = repoOff.includes(n) ? repoOff.filter((x) => x !== n) : [...repoOff, n];
    localStorage.setItem(repoKey(repoId), JSON.stringify(v));
    setRepoOff(v);
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
  return (
    <div className="popover apps-pop mcp-pop" data-testid="mcp-panel">
      <div className="pop-title row">MCP da sessão <span className="grow" /><span className="dim small">{HARNESS_LABEL[harness]}{live ? ` · ${live.total} ferramentas` : ""}</span></div>
      {entries === null && <div className="pop-row dim">Lendo configuração…</div>}
      {entries?.length === 0 && <div className="pop-row dim">Nenhum MCP configurado para {HARNESS_LABEL[harness]}.</div>}
      {entries?.map((m) => {
        const st = live?.status[m.name];
        const off = sessionOff.includes(m.name) || repoOff.includes(m.name);
        return (
          <div key={m.name + m.scope} className={"mcp-row" + (off ? " off" : "")} data-testid="mcp-row">
            <span className={"dot " + (st === "connected" ? "st-done" : st === "failed" ? "st-fail" : st ? "st-in-progress" : "")} title={st ?? "ainda não iniciado nesta sessão"} />
            <div className="mcp-main">
              <div className="row"><b>{m.name}</b><span className="badge">{m.scope}</span>{live?.tools[m.name] != null && <span className="dim small">{live.tools[m.name]} ferramentas</span>}{st === "failed" && <span className="error small">falhou</span>}</div>
              <div className="dim small mcp-target" title={`${m.target} · ${m.source}`}>{m.transport} · {m.target}</div>
            </div>
            <label className="mcp-toggle" title="Ligar/desligar nesta sessão (vale no próximo turno)">
              <span className={"toggle" + (!sessionOff.includes(m.name) ? " on" : "")} onClick={() => setSessionOff(sessionOff.includes(m.name) ? sessionOff.filter((x) => x !== m.name) : [...sessionOff, m.name])}><span /></span>
            </label>
            <button className={"text-btn small" + (repoOff.includes(m.name) ? " error" : "")} title="Desligar em todas as sessões deste repositório" onClick={() => toggleRepo(m.name)}>{repoOff.includes(m.name) ? "desligado no repo" : "desligar no repo"}</button>
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
      <div className="dim small mcp-foot">Mudanças valem no próximo turno (a conversa continua com --resume).</div>
    </div>
  );
}
