import { Floating } from "./Floating";
import { t } from "../i18n";
/** Popover do anel de contexto: uso em tokens e % da janela, divisão estimada e "Compactar". */
export interface CtxParts { system: number; tools: number; mcp: number; messages: number; files: number }

export function ContextPanel({ used, total, parts, onCompact, canCompact }: { used: number; total: number | null; parts: CtxParts; onCompact: () => void; canCompact: boolean }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  const rows: [keyof CtxParts, string, string][] = [["system", t("chat.ctx.system"), "var(--muted)"], ["tools", t("chat.ctx.tools"), "var(--blue)"], ["mcp", "MCP", "var(--local)"], ["messages", t("chat.ctx.messages"), "var(--accent)"], ["files", t("chat.ctx.files"), "var(--warn)"]];
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n)));
  return (
    <Floating className="ctx-pop" placement="top-end" testid="context-panel">
      <div className="ctx-head"><b>{fmt(used)}</b> <span className="dim">{t("chat.ctx.ofTokens", { total: total ? fmt(total) : "?" })}</span><span className="grow" /><b>{pct.toFixed(pct < 10 ? 1 : 0)}%</b></div>
      <div className="ctx-bar">
        {rows.map(([k, , c]) => <span key={k} style={{ width: `${total ? (parts[k] / total) * 100 : 0}%`, background: c }} />)}
      </div>
      {rows.map(([k, label, c]) => (
        <div key={k} className="ctx-row"><span className="sw" style={{ background: c }} />{label}<span className="grow" /><span className="dim">{fmt(parts[k])}</span></div>
      ))}
      <div className="dim small">{t("chat.ctx.estimate")}</div>
      <button className="btn" disabled={!canCompact || used === 0} onClick={onCompact} title={canCompact ? t("chat.ctx.compactHint") : t("chat.ctx.noCompact")}>{t("chat.ctx.compact")}</button>
    </Floating>
  );
}
