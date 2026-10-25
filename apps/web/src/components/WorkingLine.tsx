import { useEffect, useState } from "react";
import { t } from "../i18n";

type O = Record<string, any>;
type Step = { k: string; name?: string; input?: unknown; output?: string; streaming?: boolean };

const FRAMES = ["⠂", "⠄", "⠆", "⠖", "⠶", "⠴", "⠤", "⠠"];
const short = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + "…" : s);
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** O que o agente está fazendo agora, a partir do último passo do turno (igual para todos os harnesses). */
export function activity(steps: Step[]): string {
  const last = steps[steps.length - 1];
  if (!last) return t("chat.act.thinking");
  if (last.k === "assistant") return last.streaming ? t("chat.act.writing") : t("chat.act.thinking");
  if (last.k === "reasoning") return t("chat.act.thinking");
  if (last.k !== "tool" || last.output !== undefined) return t("chat.act.thinking");
  const i = (last.input ?? {}) as O;
  const n = last.name ?? "";
  if (n === "Bash") return t("chat.act.running", { what: short(String(i.command ?? i.description ?? t("chat.act.command"))) });
  if (n === "Task" || n === "Agent") return t("chat.act.subagent", { what: short(String(i.description ?? i.subagent_type ?? "")) }).trim();
  if (n === "Read") return t("chat.act.reading", { what: base(String(i.file_path ?? "")) });
  if (["Edit", "MultiEdit", "Write"].includes(n)) return t("chat.act.editing", { what: base(String(i.file_path ?? "")) });
  if (n === "Grep" || n === "Glob") return t("chat.act.searching", { what: short(String(i.pattern ?? "")) });
  if (n === "LS") return t("chat.act.listing", { what: base(String(i.path ?? "")) });
  if (n === "WebFetch") return t("chat.act.fetching", { what: short(String(i.url ?? "")) });
  if (n === "WebSearch") return t("chat.act.webSearch", { what: short(String(i.query ?? "")) });
  if (n === "TodoWrite") return t("chat.act.todos");
  const mcp = /^mcp__(.+?)__(.+)$/.exec(n);
  if (mcp) return t("chat.act.running", { what: `${mcp[2].replace(/_/g, " ")} (${mcp[1]})` });
  return t("chat.act.running", { what: n.replace(/_/g, " ") });
}

/** Linha de status discreta: pontinhos animados, o que está acontecendo e o cronômetro ao vivo. */
export function WorkingLine({ text, since, testid }: { text: string; since: number; testid?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const frame = FRAMES[Math.floor(now / 120) % FRAMES.length];
  return (
    <div className="working-line" data-testid={testid ?? "working"} title={t("chat.act.interrupt")}>
      <span className="wl-dots" aria-hidden>{frame}</span>
      <span className="wl-text">{text}</span>
      <span className="wl-time mono" data-testid="working-time">{((now - since) / 1000).toFixed(1)}s</span>
    </div>
  );
}
