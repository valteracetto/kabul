import { useEffect, useMemo, useState } from "react";
import { api, wsTitle, type AgentsStatus, type Repo, type Workspace } from "../api";
import type { Route } from "../App";
import { chatStore, statusOf, type ChatInfo, type ChatStatus } from "../components/chatStore";
import { confirmDialog } from "../components/Confirm";
import { pendingActivate } from "../components/chatPrefs";
import { SubagentTree, fmtCost, fmtTok } from "../components/SubagentTree";
import { noSuggest } from "../noSuggest";

const LABEL: Record<ChatStatus, string> = { working: "Trabalhando", waiting: "Esperando você", queued: "Aguardando vaga", idle: "Ocioso" };
type Filter = "active" | ChatStatus | "all";
const FILTERS: [Filter, string][] = [["active", "Ativos"], ["working", "Trabalhando"], ["waiting", "Esperando você"], ["queued", "Aguardando vaga"], ["all", "Todos"]];
const ago = (ms: number | null, now: number) => {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Lista das conversas do registro, atualizada no máximo 4 vezes por segundo (os contadores mudam a cada evento). */
function useAllChats(ms = 250) {
  const [list, setList] = useState<ChatInfo[]>(() => chatStore.all());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = chatStore.subscribe(() => void (t ??= setTimeout(() => ((t = null), setList(chatStore.all())), ms)));
    return () => void (off(), t && clearTimeout(t));
  }, [ms]);
  return list;
}

/**
 * Painel "Agentes": todas as conversas com agente de todos os workspaces (rodando, esperando você,
 * aguardando vaga), com filtros, subagentes de cada uma e parar em lote. Fila e limite vêm do backend
 * (`agents_status`); sem o comando, o painel mostra só o que o app sabe.
 */
export function AgentsView({ workspaces, repos, onRoute }: { workspaces: Workspace[]; repos: Repo[]; onRoute: (r: Route) => void }) {
  const chats = useAllChats();
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<AgentsStatus | null>(null);
  const [limit, setLimit] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Fila e limite: consulta enquanto o painel está aberto (sem o comando no backend, para de perguntar).
  useEffect(() => {
    let alive = true, t: ReturnType<typeof setTimeout> | null = null;
    const poll = () => api.agentsStatus().then((s) => { if (!alive) return; setStatus(s); t = setTimeout(poll, 2000); }, () => alive && setStatus(null));
    void poll();
    const off = api.onAgentsStatus((st) => alive && setStatus(st));
    return () => void ((alive = false), t && clearTimeout(t), off());
  }, []);
  const wsById = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);
  const repoOf = (c: ChatInfo) => wsById.get(c.ws)?.repo_id ?? "";
  const rows = chats
    .filter((c) => wsById.has(c.ws) && (c.chat || statusOf(c) !== "idle" || filter === "all"))
    .filter((c) => (filter === "all" ? true : filter === "active" ? statusOf(c) !== "idle" : statusOf(c) === filter))
    .filter((c) => !repo || repoOf(c) === repo)
    .filter((c) => !q.trim() || `${wsTitle(wsById.get(c.ws)!)} ${c.title} ${c.model ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => ({ waiting: 0, working: 1, queued: 2, idle: 3 })[statusOf(a)] - ({ waiting: 0, working: 1, queued: 2, idle: 3 })[statusOf(b)] || (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const counts = { working: 0, waiting: 0, queued: 0 } as Record<string, number>;
  for (const c of chats) if (wsById.has(c.ws)) counts[statusOf(c)] = (counts[statusOf(c)] ?? 0) + 1;
  const stoppable = (c: ChatInfo) => statusOf(c) !== "idle";
  const chosen = rows.filter((c) => sel.has(c.session) && stoppable(c));
  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const stop = async (list: ChatInfo[]) => {
    if (!list.length) return;
    if (list.length > 1 && !(await confirmDialog(`Parar ${list.length} agentes? As sessões continuam retomáveis.`, { ok: `Parar ${list.length}`, danger: true }))) return;
    await chatStore.stopMany(list.map((c) => c.session));
    setSel(new Set());
  };
  const go = (c: ChatInfo) => {
    pendingActivate[c.ws] = c.session;
    onRoute({ kind: "workspace", id: c.ws });
    setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:activate-tab", { detail: c.session })), 120);
  };
  const totalCost = rows.reduce((a, c) => a + c.costUsd, 0);

  return (
    <section className="page agents-view" data-testid="agents-view">
      <header className="page-head" data-tauri-drag-region>
        <h2>Agentes</h2>
        <span className="dim">{counts.working} trabalhando · {counts.waiting} esperando você · {counts.queued} aguardando vaga</span>
        <span className="grow" />
        {status && (
          <span className="agents-limit dim small" data-testid="agents-limit">
            {status.limit ? `Limite: ${status.limit} ao mesmo tempo · ${status.running} rodando · ${status.queued.length} na fila` : `Sem limite · ${status.running} rodando`}
            <input {...noSuggest} autoComplete="off" className="limit-input" placeholder="limite" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} data-testid="agents-limit-input"
              onKeyDown={(e) => e.key === "Enter" && api.agentsConfig({ limit: limit ? Number(limit) : null }).then(setStatus, () => {})} title="Máximo de agentes rodando ao mesmo tempo (vazio = sem limite); Enter aplica" />
          </span>
        )}
      </header>
      <div className="agents-tools">
        <div className="seg-mini" data-testid="agents-filter">
          {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)} data-testid={`agents-filter-${k}`}>{l}{k !== "active" && k !== "all" && counts[k] ? ` (${counts[k]})` : ""}</button>)}
        </div>
        <select value={repo} onChange={(e) => setRepo(e.target.value)} data-testid="agents-repo"><option value="">Todos os projetos</option>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        <input {...noSuggest} className="agents-search" autoComplete="off" placeholder="Filtrar por workspace, conversa ou modelo" value={q} onChange={(e) => setQ(e.target.value)} data-testid="agents-search" />
        <span className="grow" />
        <button className="btn" disabled={!rows.some(stoppable)} onClick={() => setSel(new Set(rows.filter(stoppable).map((c) => c.session)))} data-testid="agents-select-all">Selecionar todos</button>
        <button className="btn danger" disabled={!chosen.length} onClick={() => stop(chosen)} data-testid="agents-stop-selected">Parar selecionados{chosen.length ? ` (${chosen.length})` : ""}</button>
      </div>
      {rows.length === 0 ? <div className="empty-state">{filter === "active" ? "Nenhum agente ativo agora." : "Nada com esse filtro."}</div> : (
        <div className="agents-table" role="table">
          <div className="agents-row head" role="row"><span /><span>Status</span><span>Workspace · conversa</span><span>Modelo</span><span>Tempo</span><span>Ferramentas</span><span>Tokens</span><span>Custo</span><span>Subagentes</span><span /></div>
          {rows.map((c) => {
            const st = statusOf(c), w = wsById.get(c.ws)!, subs = Object.values(c.subs);
            return (
              <div key={c.session} className="agents-item">
                <div className={"agents-row st-" + st} role="row" data-testid="agent-row" data-status={st} data-session={c.session}>
                  <input type="checkbox" checked={sel.has(c.session)} disabled={!stoppable(c)} onChange={() => setSel((s) => toggle(s, c.session))} data-testid="agent-select" />
                  <span className="agent-st">{st === "working" ? <span className="spinner tiny" /> : <span className={"agent-dot " + st} />} {LABEL[st]}{c.queue ? ` · ${c.queue.position}º` : ""}</span>
                  <button className="text-btn agent-open" onClick={() => go(c)} title="Abrir a conversa" data-testid="agent-open"><b>{wsTitle(w)}</b> <span className="dim">· {c.title}</span></button>
                  <span className="dim small">{c.model ?? "—"}</span>
                  <span className="mono small">{st === "idle" ? `há ${ago(c.lastEventAt || null, now)}` : ago(c.startedAt, now)}</span>
                  <span className="mono small">{c.tools}</span>
                  <span className="mono small">{fmtTok(c.tokensIn)}/{fmtTok(c.tokensOut)}</span>
                  <span className="mono small">{fmtCost(c.costUsd)}</span>
                  <button className="text-btn small" disabled={!subs.length} onClick={() => setOpen((o) => toggle(o, c.session))} data-testid="agent-subs">{subs.length ? `${subs.length}${subs.some((s) => s.status === "running") ? ` · ${subs.filter((s) => s.status === "running").length} rodando` : ""} ${open.has(c.session) ? "▾" : "▸"}` : "—"}</button>
                  {stoppable(c) ? <button className="btn small" onClick={() => stop([c])} data-testid="agent-stop">Parar</button> : <span />}
                </div>
                {open.has(c.session) && subs.length > 0 && <div className="agents-subs"><SubagentTree subs={c.subs} /></div>}
              </div>
            );
          })}
          <div className="agents-foot dim small">{rows.length} conversa{rows.length === 1 ? "" : "s"} · custo somado {fmtCost(totalCost)}</div>
        </div>
      )}
    </section>
  );
}
