import { useEffect, useState } from "react";

type O = Record<string, any>;
type Step = { k: string; name?: string; input?: unknown; output?: string; streaming?: boolean };

const FRAMES = ["⠂", "⠄", "⠆", "⠖", "⠶", "⠴", "⠤", "⠠"];
const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** O que o agente está fazendo agora, a partir do último passo do turno (igual para todos os harnesses). */
export function activity(steps: Step[]): string {
  const last = steps[steps.length - 1];
  if (!last) return "Pensando…";
  if (last.k === "assistant") return last.streaming ? "Escrevendo…" : "Pensando…";
  if (last.k === "reasoning") return "Pensando…";
  if (last.k !== "tool" || last.output !== undefined) return "Pensando…";
  const i = (last.input ?? {}) as O;
  const n = last.name ?? "";
  if (n === "Bash") return `Rodando ${short(String(i.command ?? i.description ?? "comando"))}`;
  if (n === "Task" || n === "Agent") return `Aguardando subagente ${short(String(i.description ?? i.subagent_type ?? ""))}`.trim();
  if (n === "Read") return `Lendo ${base(String(i.file_path ?? ""))}`;
  if (["Edit", "MultiEdit", "Write"].includes(n)) return `Editando ${base(String(i.file_path ?? ""))}`;
  if (n === "Grep" || n === "Glob") return `Buscando ${short(String(i.pattern ?? ""))}`;
  if (n === "LS") return `Listando ${base(String(i.path ?? ""))}`;
  if (n === "WebFetch") return `Abrindo ${short(String(i.url ?? ""))}`;
  if (n === "WebSearch") return `Pesquisando ${short(String(i.query ?? ""))}`;
  if (n === "TodoWrite") return "Atualizando as tarefas";
  const mcp = /^mcp__(.+?)__(.+)$/.exec(n);
  if (mcp) return `Rodando ${mcp[2].replace(/_/g, " ")} (${mcp[1]})`;
  return `Rodando ${n.replace(/_/g, " ")}`;
}

/** Linha de status discreta: pontinhos animados, o que está acontecendo e o cronômetro ao vivo. */
export function WorkingLine({ text, since, testid }: { text: string; since: number; testid?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const frame = FRAMES[Math.floor(now / 120) % FRAMES.length];
  return (
    <div className="working-line" data-testid={testid ?? "working"} title="⌘⇧⌫ ou Esc interrompe">
      <span className="wl-dots" aria-hidden>{frame}</span>
      <span className="wl-text">{text}</span>
      <span className="wl-time mono" data-testid="working-time">{((now - since) / 1000).toFixed(1)}s</span>
    </div>
  );
}
