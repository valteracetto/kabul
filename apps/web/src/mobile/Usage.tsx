import { useEffect, useMemo, useState } from "react";
import { AGENT_LABEL, isOwner, k, type ChatView } from "./kabuld";
import { push } from "./nav";
import { refresh, useKabul } from "./data";
import { AgentIcon, Group, NavBar, Row, useCollapse, usePullToRefresh } from "./ui";
import { fmtTokens, fmtUsd } from "../components/Usage";
import { t } from "../i18n";
import { fmtMoney } from "../i18n/format";

interface Spend { model: string; harness: string; input: number; output: number; cost: number; turns: number }

const fmt = fmtTokens;
// Abaixo de US$ 1 com três casas (conversas curtas custam centavos).
const usd = (n: number) => (n > 0 && n < 1 ? fmtMoney(n, 3).replace(/\u00a0/g, " ") : fmtUsd(n));

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
      <NavBar collapsed={collapsed} title={t("usage.title")} />
      <main className="m-scroll has-tabbar" onScroll={onScroll} {...ptr.handlers}>
        {ptr.indicator}
        <h1 className="m-large-title">{t("usage.title")}</h1>
        <div className="m-stats">
          <div className="m-stat working"><b>{count("working")}</b><span>{t("usage.m.working")}</span></div>
          <div className="m-stat waiting"><b>{count("waiting")}</b><span>{t("usage.m.waiting")}</span></div>
          <div className="m-stat"><b>{count("idle")}</b><span>{t("usage.m.idle")}</span></div>
        </div>
        {isOwner() && (
          <Group>
            <Row title={t("usage.m.costsLimits")} sub={t("usage.m.costsLimitsSub")} chevron onClick={() => push("uso")} testid="m-open-usage" />
          </Group>
        )}
        {byAgent.length > 0 && (
          <Group header={t("usage.m.byAgent")}>
            {byAgent.map(([a, n]) => (
              <Row key={a} icon={<AgentIcon agent={a} size={28} />} title={AGENT_LABEL[a] ?? a} value={String(n)} />
            ))}
          </Group>
        )}
        <Group header={t("usage.m.kabulChats")} footer={t("usage.m.kabulChatsFooter")}>
          {!spend && <Row title={t("common.loading")} />}
          {spend && spend.length === 0 && <Row title={t("usage.m.noChats")} />}
          {spend && spend.length > 0 && <Row title={t("usage.m.total")} value={t("usage.m.totalValue", { tokens: fmt(total.tokens), cost: usd(total.cost) })} testid="m-usage-total" />}
          {spend?.map((s) => (
            <div key={s.model} className="m-row m-usage-row" data-testid="m-usage-model">
              <AgentIcon agent={s.harness} size={28} />
              <span className="m-row-text">
                <span className="m-row-title">{s.model}</span>
                <span className="m-bar"><span style={{ width: `${((s.input + s.output) / max) * 100}%` }} /></span>
                <span className="m-row-sub">{t("usage.m.modelSub", { input: fmt(s.input), output: fmt(s.output), count: s.turns })}</span>
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
