import { useEffect, useState } from "react";
import { Markdown } from "./Markdown";
import type { DockerContainer, Leftover } from "../api";
import { t, type Key } from "../i18n";
import { IBrain, IGlobe, IList, IMinus, IPencil, IPlug, IPlus, ISearch, ISend, ITerminal, ITool } from "../icons";

type O = Record<string, any>;
const short = (s: string, n = 120) => (s.length > n ? s.slice(0, n) + "…" : s);
const base = (p: string) => p.split("/").pop() ?? p;

/** Linhas de diff de um Edit/MultiEdit/Write para o card. */
function editLines(name: string, input: O): { sign: string; text: string }[] {
  // Agentes que não mandam o conteúdo (ex.: agy): só o nome do arquivo.
  if (name === "Write" && input.content == null) return [];
  if (name !== "Write" && input.old_string == null && input.new_string == null && !input.edits) return [];
  if (name === "Write") return String(input.content ?? "").split("\n").slice(0, 60).map((ln) => ({ sign: "+", text: ln }));
  const edits: O[] = name === "MultiEdit" ? input.edits ?? [] : [input];
  return edits.flatMap((e) => [
    ...String(e.old_string ?? "").split("\n").map((ln) => ({ sign: "-", text: ln })),
    ...String(e.new_string ?? "").split("\n").map((ln) => ({ sign: "+", text: ln })),
  ]).slice(0, 80);
}

/** Card por ferramenta: Bash, Edit/Write (diff), Read/Glob/Grep, TodoWrite, Task (subagente), Web, MCP. */
export function ToolCard({ name, input, output, error, interrupted, onOpenFile }: { name: string; input: unknown; output?: string; error?: boolean; interrupted?: boolean; onOpenFile?: (p: string) => void }) {
  const i = (input ?? {}) as O;
  const pending = output === undefined && !interrupted;
  const [open, setOpen] = useState(false);
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  let title = name, sub = "", body: React.ReactNode = null, badge: string | null = null;
  if (name === "Bash") {
    title = i.description || t("chat.tool.command");
    sub = i.command ?? "";
    if (i.run_in_background) badge = t("chat.tool.background");
    body = <><pre className="tc-cmd">$ {i.command}</pre>{output !== undefined && <pre className="tc-out">{short(output, 6000)}</pre>}</>;
  } else if (["Edit", "MultiEdit", "Write"].includes(name)) {
    title = name === "Write" ? t("chat.tool.wrote") : t("chat.tool.edited");
    sub = i.file_path ?? "";
    body = (
      <div className="tc-diff">
        <div className="tc-diff-bar"><code>{base(sub)}</code><span className="grow" />{onOpenFile && <button className="text-btn small" onClick={() => onOpenFile(sub)}>{t("chat.tool.openDiff")}</button>}<button className="text-btn small" onClick={() => navigator.clipboard.writeText(name === "Write" ? i.content ?? "" : i.new_string ?? "")}>{t("common.copy")}</button></div>
        {editLines(name, i).map((l, k) => <div key={k} className={"pl " + (l.sign === "+" ? "a" : "d")}><span className="code">{l.sign} {l.text}</span></div>)}
      </div>
    );
  } else if (["Read", "Glob", "Grep", "LS"].includes(name)) {
    title = t(`chat.tool.${name}` as Key);
    sub = i.file_path ?? i.pattern ?? i.path ?? "";
    body = output !== undefined && <pre className="tc-out">{short(output, 4000)}</pre>;
  } else if (name === "TodoWrite") {
    title = t("chat.tool.todos");
    const todos: O[] = i.todos ?? [];
    sub = t("chat.tool.todosDone", { done: todos.filter((td) => td.status === "completed").length, total: todos.length });
    body = <ul className="tc-todos">{todos.map((td, k) => <li key={k} className={"todo-" + td.status}><span className="todo-box">{td.status === "completed" ? "✓" : td.status === "in_progress" ? "◐" : ""}</span>{td.content}</li>)}</ul>;
  } else if (name === "Task" || name === "Agent") {
    title = i.description || t("chat.tool.subagent");
    badge = t("chat.tool.subagent");
    sub = i.subagent_type ?? "";
    body = <><div className="tc-sub-prompt"><Markdown text={String(i.prompt ?? "")} /></div>{output !== undefined && <div className="tc-sub-out"><Markdown text={short(output, 8000)} /></div>}</>;
  } else if (name === "WebFetch" || name === "WebSearch") {
    title = name === "WebFetch" ? t("chat.tool.webFetch") : t("chat.tool.webSearch");
    sub = i.url ?? i.query ?? "";
    body = output !== undefined && <pre className="tc-out">{short(output, 3000)}</pre>;
  } else if (mcp) {
    badge = `MCP · ${mcp[1]}`;
    title = mcp[2].replace(/_/g, " ");
    sub = short(JSON.stringify(input) ?? "", 100);
    body = <><pre>{JSON.stringify(input, null, 2)}</pre>{output !== undefined && <pre className="tc-out">{short(output, 4000)}</pre>}</>;
  } else {
    // Ferramenta sem cartão próprio: nome legível e os parâmetros como "chave: valor".
    title = name.replace(/_/g, " ");
    const params = Object.entries(i).filter(([, v]) => v != null && v !== "");
    sub = short(params.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · "), 100);
    body = <><dl className="tc-params">{params.map(([k, v]) => <div key={k}><dt>{k}</dt><dd><code>{typeof v === "string" ? v : JSON.stringify(v)}</code></dd></div>)}</dl>{output !== undefined && <pre className="tc-out">{short(output, 4000)}</pre>}</>;
  }
  // Todo e edição abertos por padrão (o conteúdo é o que interessa).
  useEffect(() => void ((name === "TodoWrite" || ["Edit", "MultiEdit", "Write"].includes(name)) && setOpen(true)), [name]);
  const Icon = stepIcon(name, !!mcp);
  // Comando, caminho e padrão em monoespaçada; descrição e parâmetros soltos em texto normal.
  const mono = ["Bash", "Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "LS", "WebFetch"].includes(name);
  return (
    <div className={"step" + (error ? " err" : "") + (pending ? " pending" : "") + (interrupted ? " stopped" : "") + (open ? " open" : "")} data-testid="tool-card" data-tool={name} data-state={interrupted ? "interrupted" : pending ? "running" : "done"}>
      <div className={"step-head" + (body ? " has-body" : "")} onClick={() => body && setOpen(!open)} title={sub || undefined}>
        <span className="step-ico"><Icon size={14} className="si-kind" />{body ? (open ? <IMinus size={14} className="si-hover" /> : <IPlus size={14} className="si-hover" />) : null}</span>
        <span className="step-label">{title}</span>
        {badge && <span className="tc-badge">{badge}</span>}
        {sub && <span className={"step-chip" + (mono ? " mono" : "")}>{sub}</span>}
        {pending && <span className="spinner tiny" />}
        {interrupted && <span className="step-state" data-testid="step-interrupted">{t("chat.interrupted")}</span>}
        {error && <span className="error small">{t("chat.mcp.failed")}</span>}
      </div>
      {open && body && <div className="step-body">{body}</div>}
    </div>
  );
}

/** Ícone do passo pelo tipo de ferramenta (o mesmo para todos os harnesses, que já chegam normalizados). */
function stepIcon(name: string, mcp: boolean) {
  if (name === "Bash") return ITerminal;
  if (["Edit", "MultiEdit", "Write"].includes(name)) return IPencil;
  if (["Read", "Glob", "Grep", "LS", "ToolSearch"].includes(name)) return ISearch;
  if (name === "WebFetch" || name === "WebSearch") return IGlobe;
  if (name === "TodoWrite") return IList;
  if (name === "Task" || name === "Agent" || name === "SendMessage") return ISend;
  if (mcp) return IPlug;
  return ITool;
}

export function ThinkingCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"step thinking" + (open ? " open" : "")} data-testid="thinking">
      <div className="step-head has-body" onClick={() => setOpen(!open)}>
        <span className="step-ico"><IBrain size={14} className="si-kind" />{open ? <IMinus size={14} className="si-hover" /> : <IPlus size={14} className="si-hover" />}</span>
        <span className="step-label">{t("chat.tool.thinking")}</span>
        {!open && <span className="step-chip">{short(text.replace(/\s+/g, " ").trim(), 140)}</span>}
      </div>
      {open && <div className="step-body"><Markdown text={text} /></div>}
    </div>
  );
}

const APPROVAL_TOOLS = ["Bash", "Edit", "MultiEdit", "Write", "Read", "LS", "WebFetch"];
const approvalTitle = (tool: string) => (APPROVAL_TOOLS.includes(tool) ? t(`chat.approval.${tool}` as Key) : t("chat.approval.other", { tool }));

/** Pedido de permissão: Sim (↵), "Sempre permitir <ferramenta> nesta sessão" (⌘↵), Não (⌫).
 *  Com `input.rule` (agy), "sempre" grava a regra no projeto do workspace e o cartão mostra a regra. */
export function ApprovalCard({ tool, input, decided, allow, always, onDecide }: { tool: string; input: unknown; decided?: boolean; allow?: boolean; always?: boolean; onDecide: (allow: boolean, always: boolean) => void }) {
  const i = (input ?? {}) as O;
  const rule = typeof i.rule === "string" ? i.rule : null;
  const what = i.command ?? i.file_path ?? i.url ?? i.path ?? (rule ? null : short(JSON.stringify(input) ?? "", 300));
  return (
    <div className="approval" data-testid="approval" data-rule={rule ?? undefined}>
      <div className="ap-head"><ITool size={14} /> <b>{approvalTitle(tool)}</b></div>
      {what && <code className="ap-what">{what}</code>}
      {rule && <div className="dim small" data-testid="approval-rule">{t("chat.approval.rule")} <code>{rule}</code></div>}
      {decided ? <span className={"badge " + (allow ? "ok" : "bad")}>{allow ? (always ? (rule ? t("chat.approval.alwaysWs") : t("chat.approval.alwaysTool", { tool })) : t("chat.approval.approved")) : t("chat.approval.denied")}</span> : (
        <div className="row ap-btns">
          <button className="btn primary" onClick={() => onDecide(true, false)}>{rule ? t("chat.approval.once") : t("common.yes")} <kbd>↵</kbd></button>
          <button className="btn" onClick={() => onDecide(true, true)} data-testid="approve-always">{rule ? t("chat.approval.alwaysWsBtn") : t("chat.approval.alwaysToolBtn", { tool })} <kbd>⌘↵</kbd></button>
          <button className="btn" onClick={() => onDecide(false, false)}>{rule ? t("chat.approval.deny") : t("common.no")} <kbd>⌫</kbd></button>
        </div>
      )}
    </div>
  );
}

/** Cartão do plano (ExitPlanMode): Aprovar (⌘⇧↵), Ajustar, Passar para conversa nova, Copiar. */
export function PlanCard({ plan, decided, allow, onApprove, onAdjust, onHandOff }: { plan: string; decided?: boolean; allow?: boolean; onApprove: () => void; onAdjust: (text: string) => void; onHandOff: () => void }) {
  const [adj, setAdj] = useState("");
  return (
    <div className="plan-card" data-testid="plan-card">
      <div className="plan-head"><b>{t("chat.plan.title")}</b><span className="grow" /><button className="text-btn small" onClick={() => navigator.clipboard.writeText(plan)}>{t("chat.plan.copy")}</button></div>
      <div className="plan-body"><Markdown text={plan} /></div>
      {decided ? <span className={"badge " + (allow ? "ok" : "")}>{allow ? t("chat.plan.approved") : t("chat.plan.adjustSent")}</span> : (
        <>
          <textarea rows={2} placeholder={t("chat.plan.adjustPh")} value={adj} onChange={(e) => setAdj(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey && e.shiftKey) (e.preventDefault(), onApprove()); else if (e.key === "Enter" && !e.shiftKey && adj.trim()) (e.preventDefault(), onAdjust(adj.trim())); }} data-testid="plan-adjust" />
          <div className="row">
            <button className="btn primary" onClick={onApprove} data-testid="plan-approve">{t("chat.plan.approve")} <kbd>⌘⇧↵</kbd></button>
            <button className="btn" disabled={!adj.trim()} onClick={() => onAdjust(adj.trim())}>{t("chat.plan.sendAdjust")}</button>
            <button className="btn" onClick={onHandOff} data-testid="plan-handoff">{t("chat.plan.handoff")}</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Perguntas do agente (AskUserQuestion): 1–9 escolhe, 0 = Outra, ←/→ navega, Pular e Enviar. */
export function QuestionCard({ input, decided, onSubmit, onSkip }: { input: unknown; decided?: boolean; onSubmit: (answers: Record<string, string>) => void; onSkip: () => void }) {
  const qs: O[] = ((input ?? {}) as O).questions ?? [];
  const [idx, setIdx] = useState(0);
  const [ans, setAns] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const q = qs[idx];
  const pick = (label: string) => {
    setAns((a) => ({ ...a, [q.question]: label }));
    if (idx < qs.length - 1) setIdx(idx + 1);
  };
  useEffect(() => {
    if (decided) return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "TEXTAREA" || el?.tagName === "INPUT") return;
      if (/^[1-9]$/.test(e.key) && q?.options?.[Number(e.key) - 1]) (e.preventDefault(), pick(q.options[Number(e.key) - 1].label));
      else if (e.key === "0") (e.preventDefault(), document.getElementById(`q-other-${idx}`)?.focus());
      else if (e.key === "ArrowRight") setIdx((x) => Math.min(x + 1, qs.length - 1));
      else if (e.key === "ArrowLeft") setIdx((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [idx, q, decided]);
  if (!q) return null;
  return (
    <div className="question-card" data-testid="question-card">
      <div className="q-head"><b>{q.header ?? t("chat.q.question")}</b><span className="grow" />{qs.length > 1 && <span className="dim small">{t("chat.q.of", { i: idx + 1, n: qs.length })} · ←/→</span>}</div>
      <div className="q-text">{q.question}</div>
      {decided ? <div className="dim small">{Object.keys(ans).length ? t("chat.q.answered") : t("chat.q.noAnswer")}</div> : (
        <>
          <div className="q-opts">
            {(q.options ?? []).map((o: O, k: number) => (
              <button key={k} className={"q-opt" + (ans[q.question] === o.label ? " on" : "")} onClick={() => pick(o.label)} data-testid="q-opt">
                <span className="q-num">{k + 1}</span><span><b>{o.label}</b>{o.description && <span className="dim small"> · {o.description}</span>}</span>
              </button>
            ))}
            <div className="q-opt other"><span className="q-num">0</span><input id={`q-other-${idx}`} placeholder={t("chat.q.other")} value={other[idx] ?? ""} onChange={(e) => setOther({ ...other, [idx]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && other[idx]?.trim() && pick(other[idx].trim())} /></div>
          </div>
          <div className="row">
            <span className="dim small">{t("chat.q.count", { done: Object.keys(ans).length, n: qs.length })}</span><span className="grow" />
            <button className="btn" onClick={onSkip}>{t("chat.q.skip")}</button>
            <button className="btn primary" disabled={!Object.keys(ans).length} onClick={() => onSubmit(ans)} data-testid="q-submit">{t("common.send")} <kbd>↵</kbd></button>
          </div>
        </>
      )}
    </div>
  );
}

const age = (s: number) => (s < 60 ? t("chat.lo.ageS", { n: s }) : s < 3600 ? t("chat.lo.ageM", { n: Math.floor(s / 60) }) : t("chat.lo.ageH", { n: Math.floor(s / 3600) }));

/** Depois do Parar: "O agente deixou N processos rodando". Manter é o padrão; encerrar só os marcados
 *  (SIGTERM e depois SIGKILL no grupo). Contêineres com -d aparecem com o ID e "docker stop". */
export function LeftoversCard({ item, onDecide, onDockerStop }: {
  item: { procs: Leftover[]; containers: DockerContainer[]; decided?: "kept" | "killed"; killed?: number[]; stopped?: string[] };
  onDecide: (kill: Leftover[], keep: Leftover[], remember: "keep" | "kill" | null) => void;
  onDockerStop: (id: string) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [remember, setRemember] = useState(false);
  const n = item.procs.length;
  const title = n ? t("chat.lo.procs", { count: n }) : t("chat.lo.containers", { count: item.containers.length });
  const pick = (kill: boolean) => {
    const k = kill ? item.procs.filter((p) => sel.has(p.pid)) : [];
    onDecide(k, item.procs.filter((p) => !k.includes(p)), remember ? (kill ? "kill" : "keep") : null);
  };
  return (
    <div className="leftovers" data-testid="leftovers">
      <div className="lo-head"><b>{title}</b>{item.decided && <span className="dim small" data-testid="leftovers-decided">{item.decided === "kept" ? t("chat.lo.kept") : t("chat.lo.killed")}</span>}</div>
      {item.procs.map((p) => (
        <label key={p.pid} className={"lo-row" + (item.killed?.includes(p.pid) ? " gone" : "")} data-testid="leftover-row">
          {!item.decided && <input type="checkbox" checked={sel.has(p.pid)} onChange={(e) => setSel((s) => { const x = new Set(s); e.target.checked ? x.add(p.pid) : x.delete(p.pid); return x; })} data-testid="leftover-check" />}
          <span className="lo-name">{p.name}</span>
          <code className="lo-cmd" title={p.cmd}>{p.cmd}</code>
          {p.ports.length > 0 && <span className="lo-port mono">:{p.ports.join(", :")}</span>}
          <span className="dim small mono">{age(p.age)}</span>
        </label>
      ))}
      {item.containers.map((c) => (
        <div key={c.id} className="lo-row" data-testid="leftover-container">
          <span className="lo-name">docker</span><code className="lo-cmd">{c.image} · {c.name} · {c.id}</code>{/* i18n-ignore: comando docker */}
          {item.stopped?.includes(c.id) ? <span className="dim small">{t("chat.lo.stopped")}</span> : <button className="btn small" onClick={() => onDockerStop(c.id)} data-testid="docker-stop">docker stop</button>}
        </div>
      ))}
      {!item.decided && n > 0 && (
        <div className="row lo-actions">
          <button className="btn primary" onClick={() => pick(false)} data-testid="leftovers-keep">{t("chat.lo.keep")}</button>
          <button className="btn" disabled={!sel.size} onClick={() => pick(true)} data-testid="leftovers-kill">{t("chat.lo.kill")}</button>
          <label className="check-row small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="leftovers-remember" /> {t("chat.lo.remember")}</label>
        </div>
      )}
    </div>
  );
}
