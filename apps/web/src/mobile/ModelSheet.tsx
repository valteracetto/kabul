import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderMark } from "../icons";
import { HARNESS_LABEL, type HarnessKind, type Model } from "../api";
import { useModelPrefs } from "../components/prefs";
import { ACCOUNT_PROVIDER, EFFORTS, EFFORT_PT, isOwner, k, type Account, type StartOpts } from "./kabuld";
import { AgentIcon, Group, I, Row, Sheet, haptic } from "./ui";

export type RunsWhere = "local" | "cloud";

const PROVIDER_LABEL: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
export const markOf = (m: Model) => (
  <span className="m-model-mark" data-agent={m.harness}>
    {m.local ? <span className="m-local-mark">L</span> : m.provider in PROVIDER_LABEL ? <ProviderMark provider={m.provider} size={22} /> : <AgentIcon agent={m.harness} size={24} />}
  </span>
);

/** Modelos guardados no aparelho (os mesmos favoritos/esforço do seletor do desktop, chave `kabul.modelPrefs`). */
export function useMobileModels() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => void k.models().then(setModels, (e) => setErr(String(e))), []);
  const mp = useModelPrefs(models ?? []);
  return { models, err, ...mp };
}

/**
 * Selecionar modelo: favoritos (✓ no ativo) + "Todos ›" agrupado por provedor, esforço em trilho
 * segmentado, modo rápido, conta do provedor e onde roda. `mode="start"`: tocar num modelo já começa.
 */
export function ModelSheet({ title = "Selecionar modelo", testid = "m-model-sheet", mode = "pick", onClose, onPick, where, onWhere, current }: {
  title?: string; testid?: string; mode?: "pick" | "start"; onClose: () => void; onPick: (m: Model, o: StartOpts) => Promise<unknown> | void; where?: RunsWhere; onWhere?: (w: RunsWhere) => void; current?: string | null;
}) {
  const { models, err: loadErr, prefs, setPrefs, selected, effort } = useMobileModels();
  const [view, setView] = useState<"main" | "all" | "account">("main");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const active = (current ? models?.find((m) => m.label === current || m.key === current) : null) ?? selected;
  const provider = active ? ACCOUNT_PROVIDER[active.harness] : undefined;
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (!provider || !isOwner()) return setAccounts([]);
    k.accounts(provider).then((a) => (setAccounts(a), setAccount(a.find((x) => x.default)?.id ?? null)), () => setAccounts([]));
  }, [provider]);
  const favs = useMemo(() => {
    const f = prefs.favorites.map((key) => models?.find((m) => m.key === key)).filter(Boolean) as Model[];
    return f.length ? f : (models ?? []).slice(0, 5);
  }, [prefs.favorites, models]);
  const opts = (): StartOpts => ({ effort, fast: prefs.fast, account: account && !account.endsWith(":sistema") ? account : null });
  const choose = (m: Model, fromAll = false) => {
    setPrefs((p) => ({ ...p, selected: m.key, favorites: fromAll && !p.favorites.includes(m.key) ? [...p.favorites, m.key] : p.favorites }));
    if (mode === "pick") {
      // Esforço/conta do modelo novo: quem chamou usa o que estiver salvo.
      void onPick(m, { ...opts(), effort: m.efforts.includes(prefs.effort) ? prefs.effort : m.efforts[0] ?? null });
      return onClose();
    }
    setBusy(true);
    setErr(null);
    Promise.resolve(onPick(m, { ...opts(), effort: m.efforts.length ? (m.efforts.includes(prefs.effort) ? prefs.effort : m.efforts[0]) : null })).catch((e) => (setErr(String(e)), setBusy(false)));
  };
  const groups = useMemo(() => {
    const g = new Map<string, Model[]>();
    for (const m of models ?? []) {
      const key = m.local ? "Locais" : `${PROVIDER_LABEL[m.provider] ?? m.provider} · ${HARNESS_LABEL[m.harness as HarnessKind] ?? m.harness}`;
      g.set(key, [...(g.get(key) ?? []), m]);
    }
    return [...g.entries()].sort((a, b) => (a[0] === "Locais" ? 1 : b[0] === "Locais" ? -1 : a[0].localeCompare(b[0])));
  }, [models]);
  const sheetTitle = view === "all" ? "Todos os modelos" : view === "account" ? "Conta" : title;
  const accName = accounts.find((a) => a.id === account)?.nickname;
  return (
    <Sheet title={sheetTitle} onClose={onClose} testid={testid} full onBack={view !== "main" ? () => setView("main") : undefined}>
      {!models && !loadErr && <div className="m-sheet-note">Carregando modelos…</div>}
      {view === "main" && models && (
        <>
          <Group>
            {favs.map((m) => (
              <Row key={m.key} icon={markOf(m)} title={m.label} sub={m.local ? `Local · ${m.local.source_name}` : undefined} check={mode === "pick" && m.key === active?.key} onClick={busy ? undefined : () => choose(m)} testid="m-model" />
            ))}
            <Row title="Todos" chevron onClick={() => setView("all")} testid="m-model-all" />
          </Group>
          {active && active.efforts.length > 0 && (
            <Group>
              <div className="m-effort-head"><span>Esforço</span><span className="m-row-value">{EFFORT_PT[effort ?? ""] ?? effort}</span></div>
              <EffortTrack levels={active.efforts} value={effort} onChange={(e) => setPrefs((p) => ({ ...p, effort: e }))} />
              <Row icon={<I.bolt />} title="Modo rápido" toggle={prefs.fast} onClick={() => setPrefs((p) => ({ ...p, fast: !p.fast }))} testid="m-fast" />
            </Group>
          )}
          {accounts.length > 1 && (
            <Group>
              <Row icon={<I.key />} title="Conta" value={accName ?? "Padrão do sistema"} chevron onClick={() => setView("account")} testid="m-account" />
            </Group>
          )}
          {onWhere && active?.harness === "claude" && (
            <Group header="Onde roda" footer={where === "cloud" ? "Roda na nuvem da Anthropic (claude --cloud) e abre o terminal da sessão aqui." : undefined}>
              <Row icon={<I.laptop />} title="Este computador" check={where !== "cloud"} onClick={() => onWhere("local")} testid="m-where-local" />
              <Row icon={<I.cloud />} title="Nuvem · Anthropic" check={where === "cloud"} onClick={() => onWhere("cloud")} testid="m-where-cloud" />
            </Group>
          )}
        </>
      )}
      {view === "all" &&
        groups.map(([g, ms]) => (
          <Group key={g} header={g}>
            {ms.map((m) => (
              <Row key={m.key} icon={markOf(m)} title={m.label} sub={m.local ? m.local.source_name : undefined} value={m.local ? <span className="m-badge">Local</span> : undefined} check={m.key === active?.key} onClick={busy ? undefined : () => (choose(m, true), mode === "pick" ? undefined : setView("main"))} testid="m-model-any" />
            ))}
          </Group>
        ))}
      {view === "account" && (
        <Group footer="Para adicionar ou entrar numa conta, use Configurações › Contas no app desktop.">
          {accounts.map((a) => (
            <Row key={a.id} title={a.nickname} sub={[a.email, a.plan].filter(Boolean).join(" · ") || undefined} check={a.id === account} onClick={() => (setAccount(a.id), setView("main"))} />
          ))}
        </Group>
      )}
      {(err || loadErr) && <div className="m-error">{err ?? loadErr}</div>}
    </Sheet>
  );
}

/** Trilho segmentado de esforço: 6 pontos possíveis, só os que o modelo aceita; arrastar ou tocar. */
function EffortTrack({ levels, value, onChange }: { levels: string[]; value: string | null; onChange: (e: string) => void }) {
  const lv = EFFORTS.filter((e) => levels.includes(e)).concat(levels.filter((e) => !EFFORTS.includes(e)));
  const i = Math.max(0, lv.indexOf(value ?? ""));
  const ref = useRef<HTMLDivElement>(null);
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (x - r.left - 22) / (r.width - 44)));
    return Math.round(t * (lv.length - 1));
  };
  const set = (j: number) => {
    if (lv[j] && lv[j] !== value) (haptic(null), onChange(lv[j]));
  };
  const pct = lv.length > 1 ? i / (lv.length - 1) : 1;
  return (
    <div
      className="m-effort"
      ref={ref}
      role="slider"
      aria-label="Esforço"
      aria-valuemin={0}
      aria-valuemax={lv.length - 1}
      aria-valuenow={i}
      aria-valuetext={EFFORT_PT[lv[i]] ?? lv[i]}
      tabIndex={0}
      data-testid="m-effort"
      style={{ ["--p" as string]: pct }}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), set(at(e.clientX)))}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && set(at(e.clientX))}
      onKeyDown={(e) => (e.key === "ArrowRight" ? set(Math.min(lv.length - 1, i + 1)) : e.key === "ArrowLeft" ? set(Math.max(0, i - 1)) : null)}
    >
      <span className="m-effort-fill" />
      {lv.map((e, j) => (
        <span key={e} className="m-effort-dot" style={{ left: `calc(22px + (100% - 44px) * ${lv.length > 1 ? j / (lv.length - 1) : 1})` }} />
      ))}
      <span className="m-effort-thumb" />
    </div>
  );
}
