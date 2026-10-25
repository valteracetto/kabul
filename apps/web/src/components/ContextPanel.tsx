import { Floating } from "./Floating";
/** Popover do anel de contexto: uso em tokens e % da janela, divisão estimada e "Compactar". */
export interface CtxParts { system: number; tools: number; mcp: number; messages: number; files: number }

export function ContextPanel({ used, total, parts, onCompact, canCompact }: { used: number; total: number | null; parts: CtxParts; onCompact: () => void; canCompact: boolean }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  const rows: [keyof CtxParts, string, string][] = [["system", "Sistema", "var(--muted)"], ["tools", "Ferramentas", "var(--blue)"], ["mcp", "MCP", "var(--local)"], ["messages", "Mensagens", "var(--accent)"], ["files", "Arquivos lidos", "var(--warn)"]];
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n)));
  return (
    <Floating className="ctx-pop" placement="top-end" testid="context-panel">
      <div className="ctx-head"><b>{fmt(used)}</b> <span className="dim">de {total ? fmt(total) : "?"} tokens</span><span className="grow" /><b>{pct.toFixed(pct < 10 ? 1 : 0)}%</b></div>
      <div className="ctx-bar">
        {rows.map(([k, , c]) => <span key={k} style={{ width: `${total ? (parts[k] / total) * 100 : 0}%`, background: c }} />)}
      </div>
      {rows.map(([k, label, c]) => (
        <div key={k} className="ctx-row"><span className="sw" style={{ background: c }} />{label}<span className="grow" /><span className="dim">{fmt(parts[k])}</span></div>
      ))}
      <div className="dim small">Divisão estimada a partir do uso do primeiro turno, das ferramentas e das leituras de arquivo.</div>
      <button className="btn" disabled={!canCompact || used === 0} onClick={onCompact} title={canCompact ? "Pede ao agente para resumir a conversa (/compact)" : "Este agente não tem /compact"}>Compactar conversa</button>
    </Floating>
  );
}
