import { useEffect, useMemo, useState } from "react";
import { AGENT_LABEL, isOwner, k, type ChatView } from "./kabuld";
import { push } from "./nav";
import { refresh, useKabul } from "./data";
import { AgentIcon, Group, NavBar, Row, useCollapse, usePullToRefresh } from "./ui";

interface Spend { model: string; harness: string; input: number; output: number; cost: number; turns: number }

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} mil` : String(n));
const usd = (n: number) => `US$ ${n.toFixed(n < 1 ? 3 : 2)}`;

/** Aba Uso: agentes agora (status e por agente) e tokens/custo das conversas do Kabul abertas neste computador. */
export function Usage() {
  const { list } = useKabul();
  const [collapsed, onScroll] = useCollapse();
  const [spend, setSpend] = useState<Spend[] | null>(null);
  const load = async () => {
    const chats: ChatView[] = await k.chatList().catch(() => []);
    const per = new Map<string, Spend>();
    await Promise.all(
      chats.map((c) =>
        k.chatTranscript(c.id).then(
          (r) => {
            const s = per.get(c.model) ?? { model: c.model, harness: c.harness, input: 0, output: 0, cost: 0, turns: 0 };
            for (const e of r.transcript.entries) {
              const kk = e.kind as Record<string, unknown>;
              if (kk.type !== "turn_end") continue;
              s.turns++;
              s.input += Number(kk.input_tokens ?? 0);
              s.output += Number(kk.output_tokens ?? 0);
              s.cost += Number(kk.cost_usd ?? 0);
            }
            per.set(c.model, s);
          },
          () => {},
        ),
      ),
    );
    setSpend([...per.values()].sort((a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output)));
  };
  useEffect(() => void load(), []);
  const ptr = usePullToRefresh(() => Promise.all([refresh(), load()]));
  const count = (st: string) => list.filter((s) => s.status === st).length;
  const byAgent = useMemo(() => {
    const m = new Map<string, number>();
    list.forEach((s) => m.set(s.agent, (m.get(s.agent) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);
  const total = (spend ?? []).reduce((a, s) => ({ tokens: a.tokens + s.input + s.output, cost: a.cost + s.cost }), { tokens: 0, cost: 0 });
  const max = Math.max(1, ...(spend ?? []).map((s) => s.input + s.output));
  return (
    <div className="m-page" data-testid="m-usage">
      <NavBar collapsed={collapsed} title="Uso" />
      <main className="m-scroll has-tabbar" onScroll={onScroll} {...ptr.handlers}>
        {ptr.indicator}
        <h1 className="m-large-title">Uso</h1>
        <div className="m-stats">
          <div className="m-stat working"><b>{count("working")}</b><span>Trabalhando</span></div>
          <div className="m-stat waiting"><b>{count("waiting")}</b><span>Esperando você</span></div>
          <div className="m-stat"><b>{count("idle")}</b><span>Ociosas</span></div>
        </div>
        {isOwner() && (
          <Group>
            <Row title="Custos e limites" sub="Gasto por dia, limites das contas e sessões (30 dias)" chevron onClick={() => push("uso")} testid="m-open-usage" />
          </Group>
        )}
        {byAgent.length > 0 && (
          <Group header="Sessões por agente">
            {byAgent.map(([a, n]) => (
              <Row key={a} icon={<AgentIcon agent={a} size={28} />} title={AGENT_LABEL[a] ?? a} value={String(n)} />
            ))}
          </Group>
        )}
        <Group header="Conversas do Kabul" footer="Somado dos turnos das conversas abertas neste computador. O histórico completo por workspace, conta e dia fica no app desktop.">
          {!spend && <Row title="Carregando…" />}
          {spend && spend.length === 0 && <Row title="Nenhuma conversa aberta" />}
          {spend && spend.length > 0 && <Row title="Total" value={`${fmt(total.tokens)} tokens · ${usd(total.cost)}`} testid="m-usage-total" />}
          {spend?.map((s) => (
            <div key={s.model} className="m-row m-usage-row" data-testid="m-usage-model">
              <AgentIcon agent={s.harness} size={28} />
              <span className="m-row-text">
                <span className="m-row-title">{s.model}</span>
                <span className="m-bar"><span style={{ width: `${((s.input + s.output) / max) * 100}%` }} /></span>
                <span className="m-row-sub">{fmt(s.input)} entrada · {fmt(s.output)} saída · {s.turns} {s.turns === 1 ? "turno" : "turnos"}</span>
              </span>
              <span className="m-row-value">{usd(s.cost)}</span>
            </div>
          ))}
        </Group>
        <div className="m-scroll-end" />
      </main>
    </div>
  );
}
