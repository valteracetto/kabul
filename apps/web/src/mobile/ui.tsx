import { useEffect, useState, type ReactNode } from "react";
import { ProviderMark } from "../icons";
import type { RunsOn } from "../components/RunsOn";
import { runsOnTooltip } from "../components/RunsOn";
import { AGENT_LABEL, STATUS_LABEL, type Status } from "./kabuld";

/** Ícone do agente: marca do provedor quando há, terminal para shell. */
export function AgentIcon({ agent, size = 22 }: { agent: string; size?: number }) {
  const provider: Record<string, string> = { claude: "anthropic", codex: "openai", antigravity: "google", agy: "google", gemini: "google" };
  const p = provider[agent];
  return (
    <span className={`m-agent m-agent-${agent}`} style={{ width: size, height: size }} title={AGENT_LABEL[agent] ?? agent} data-testid="m-agent" data-agent={agent}>
      {p ? (
        <ProviderMark provider={p} size={size - 4} />
      ) : agent === "shell" ? (
        <svg width={size - 6} height={size - 6} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 5 3 3-3 3M8.5 11.5h4" /></svg>
      ) : (
        <span className="m-agent-letter">{(AGENT_LABEL[agent] ?? agent).slice(0, 2)}</span>
      )}
    </span>
  );
}

export function StatusPill({ status, detail }: { status: Status; detail?: string | null }) {
  return (
    <span className={`m-status m-status-${status}`} data-testid="m-status" data-status={status} title={detail ?? undefined}>
      <span className="m-dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Onde roda: Mac, nuvem do provedor, outra máquina. */
export function RunsOnLabel({ r, machine, os }: { r: RunsOn; machine?: string; os?: string }) {
  const provider: Record<string, string> = { claude: "Anthropic", codex: "OpenAI", gemini: "Google" };
  let text: string;
  let cls = "local";
  switch (r.kind) {
    case "provider_cloud":
      text = `Nuvem · ${provider[r.provider] ?? r.provider}`;
      cls = "cloud";
      break;
    case "kabul_cloud":
      text = "Nuvem Kabul";
      cls = "cloud";
      break;
    case "remote":
      text = r.host;
      cls = "remote";
      break;
    default:
      text = os === "windows" ? "PC" : os && os !== "macos" ? "Local" : "Mac";
      if (r.mirrored) text += " · espelhada";
  }
  const title = r.kind === "local" && machine ? `Rodando em ${machine}${r.mirrored ? ", espelhada no claude.ai e no celular" : ""}` : runsOnTooltip(r);
  return <span className={`m-runs m-runs-${cls}`} title={title} data-testid="m-runs-on" data-kind={r.kind}>{text}</span>;
}

export function Avatar({ name, color, size = 26, title }: { name: string; color: string; size?: number; title?: string }) {
  return <span className="m-avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.45 }} title={title ?? name}>{name.slice(0, 1).toUpperCase()}</span>;
}

/** Folha que sobe da base da tela (menus e diálogos no celular). */
export function Sheet({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid?: string }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="m-sheet-bg" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()} data-testid={testid} role="dialog" aria-label={title}>
        <div className="m-sheet-head">
          <b>{title}</b>
          <button className="m-btn ghost" onClick={onClose} aria-label="Fechar">Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Contagem regressiva até `expiresAt` (segundos Unix). */
export function useCountdown(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.round(expiresAt - now)) : 0;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** QR (SVG gerado pelo kabuld) + link + copiar/compartilhar. */
export function TicketCard({ svg, url, left, onRegen, big, onBig }: { svg: string; url: string; left: number; onRegen?: () => void; big?: boolean; onBig?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)), () => {});
  return (
    <div className={"m-ticket" + (big ? " big" : "")} data-testid="ticket">
      <div className={"m-qr" + (left === 0 ? " expired" : "")} dangerouslySetInnerHTML={{ __html: svg }} onClick={onBig} data-testid="ticket-qr" />
      <div className="m-ticket-info">
        <div className="m-ticket-left" data-testid="ticket-left">{left > 0 ? `Expira em ${mmss(left)}` : "Expirado"}</div>
        <code className="m-ticket-url" data-testid="ticket-url">{url}</code>
        <div className="row">
          <button className="m-btn" onClick={copy}>{copied ? "Copiado" : "Copiar link"}</button>
          {"share" in navigator && <button className="m-btn" onClick={() => navigator.share({ title: "Kabul", url }).catch(() => {})}>Compartilhar</button>}
          {onRegen && <button className="m-btn" onClick={onRegen} data-testid="ticket-regen">Gerar outro</button>}
        </div>
      </div>
    </div>
  );
}
