import type { CloudInfo } from "../api";
import { ProviderMark } from "../icons";

/** Espelha o enum `RunsOn` do core. */
export type RunsOn =
  | { kind: "local"; mirrored?: boolean }
  | { kind: "provider_cloud"; provider: string }
  | { kind: "kabul_cloud"; host: string }
  | { kind: "remote"; host: string };

const PROVIDER: Record<string, [string, string]> = { claude: ["anthropic", "Rodando na nuvem da Anthropic (claude.ai)"], codex: ["openai", "Rodando na nuvem da OpenAI (Codex)"], gemini: ["google", "Rodando na nuvem do Google (Gemini)"] };

export function runsOnTooltip(r: RunsOn): string {
  switch (r.kind) {
    case "local": return r.mirrored ? "Rodando neste Mac, espelhada no claude.ai e no celular" : "Rodando neste Mac";
    case "provider_cloud": return PROVIDER[r.provider]?.[1] ?? `Rodando na nuvem do provedor (${r.provider})`;
    case "kabul_cloud": return `Rodando na nuvem do Kabul (${r.host})`;
    case "remote": return `Rodando em ${r.host}`;
  }
}

/** Selo: nuvem + mini-logo do provedor; nuvem com a marca Kabul (futuro); remoto; local espelhado. */
export function RunsOnBadge({ r, size = 14 }: { r: RunsOn; size?: number }) {
  const cloud = (inner: React.ReactNode, color: string) => (
    <span className="runs-on" title={runsOnTooltip(r)} data-testid={`runs-on-${r.kind}`}>
      <svg width={size + 4} height={size} viewBox="0 0 18 14"><path d="M4.6 12.5h9a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9.2-1A3.9 3.9 0 0 0 4.6 12.5Z" fill="none" stroke={color} strokeWidth="1.3" /></svg>
      <span className="runs-on-mark">{inner}</span>
    </span>
  );
  switch (r.kind) {
    case "provider_cloud": return cloud(<ProviderMark provider={PROVIDER[r.provider]?.[0] ?? r.provider} size={9} />, "var(--blue)");
    case "kabul_cloud": return cloud(<span className="kabul-diamond" />, "var(--accent)");
    case "remote": return <span className="runs-on" title={runsOnTooltip(r)} data-testid="runs-on-remote">⇄</span>;
    case "local": return r.mirrored ? <span className="runs-on mirrored" title={runsOnTooltip(r)} data-testid="runs-on-mirrored">📱</span> : null;
  }
}

/** Sessões de nuvem por workspace (lado do cliente; o CLI não lista sessões de nuvem). */
export interface CloudRecord { tmux: string; info: CloudInfo; created: number }
const key = (ws: string) => `kabul.cloud.${ws}`;
export const cloudList = (ws: string): CloudRecord[] => JSON.parse(localStorage.getItem(key(ws)) ?? "[]");
export function cloudAdd(ws: string, rec: CloudRecord) {
  localStorage.setItem(key(ws), JSON.stringify([rec, ...cloudList(ws).filter((c) => c.tmux !== rec.tmux)].slice(0, 30)));
  window.dispatchEvent(new Event("kabul:cloud-changed"));
}
export function cloudRemove(ws: string, tmux: string) {
  localStorage.setItem(key(ws), JSON.stringify(cloudList(ws).filter((c) => c.tmux !== tmux)));
  window.dispatchEvent(new Event("kabul:cloud-changed"));
}
export const cloudRunsOn = (c: CloudRecord): RunsOn => ((c.info as any).runs_on as RunsOn) ?? { kind: "provider_cloud", provider: "claude" };
