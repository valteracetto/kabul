import { useEffect, useState } from "react";
import type { SubNode } from "./chatStore";
import { t, type Key } from "../i18n";
import { fmtDurationShort, fmtMoney } from "../i18n/format";

const secs = (n: SubNode, now: number) => (n.started ? Math.max(0, Math.round(((n.ended ?? now) - n.started) / 1000)) : null);
const dur = (s: number | null) => (s == null ? "—" : fmtDurationShort(s, " "));
const STATUS = (s: SubNode["status"]) => t(`chat.sub.status.${s}` as Key);
export const fmtCost = (c: number) => (c ? fmtMoney(c, c < 0.01 ? 4 : 2) : "—");
export const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

/** Árvore pai → filhos dos subagentes de uma conversa (Task/Agent e os que eles lançaram). */
export function SubagentTree({ subs }: { subs: Record<string, SubNode> }) {
  const list = Object.values(subs);
  const running = list.some((n) => n.status === "running");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const kids = (p: string | null) => list.filter((n) => (p === null ? !n.parent || !subs[n.parent] : n.parent === p)).sort((a, b) => a.started - b.started);
  const render = (p: string | null, depth: number): React.ReactNode =>
    kids(p).map((n) => (
      <div key={n.id}>
        <div className={"sub-row st-" + n.status} style={{ paddingLeft: 8 + depth * 16 }} data-testid="subagent-row" data-status={n.status}>
          {n.status === "running" ? <span className="spinner tiny" /> : <span className={"sub-dot " + n.status} />}
          <span className="sub-desc" title={n.description}>{n.description || n.name}</span>
          <span className="dim small">{n.name !== n.description ? n.name : ""}</span>
          <span className="grow" />
          <span className="dim small mono" title={t("chat.sub.time")}>{dur(secs(n, now))}</span>
          <span className="dim small mono" title={t("chat.sub.tools")}>{t("chat.sub.toolsShort", { count: n.tools })}</span>
          <span className="dim small mono" title={t("chat.sub.tokens")}>{fmtTok(n.tokensIn)}/{fmtTok(n.tokensOut)}</span>
          <span className="dim small mono" title={t("chat.sub.cost")}>{fmtCost(n.costUsd)}</span>
          <span className="sr-only">{STATUS(n.status)}</span>
        </div>
        {render(n.id, depth + 1)}
      </div>
    ));
  return <div className="sub-tree" data-testid="subagent-tree">{render(null, 0)}</div>;
}
