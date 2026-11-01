import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SshEffective, type SshForm, type SshHost, type SshKey, type SshOp, type SshOverview, type SshPlan, type SshTest } from "../api";
import { Floating } from "../components/Floating";
import { useDismiss } from "../components/useDismiss";
import { ICopy, IMore, IPencil, IPlay, IPlus, IRestore, ISearch, ITerminal, ITrash } from "../icons";
import { noSuggest } from "../noSuggest";
import { t, type Key } from "../i18n";
import { trError } from "../i18n/errors";
import { sshAddress, sshCommand, testLabel } from "../components/ssh";
import "./SettingsSsh.css";

const keyOf = (h: SshHost) => `${h.file}\u0000${h.alias}`;
const base = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.pub$/, "");
const errText = (e: unknown) => trError(String(e).replace(/^Error: /, ""));

/** Abre a sessão `ssh <alias>` como aba de terminal no último workspace aberto. */
async function openTerminal(alias: string, onError: (e: string) => void) {
  try {
    const session = await api.sshTerminal(alias);
    const wss = (await api.workspaces()).filter((w) => !w.archived);
    const last = localStorage.getItem("kabul.lastWs");
    const w = wss.find((x) => x.id === last) ?? wss[0];
    if (!w) return onError(t("ssh.terminal.noWorkspace", { cmd: sshCommand(alias) }));
    window.dispatchEvent(new CustomEvent("kabul:route", { detail: { kind: "workspace", id: w.id } }));
    // i18n-ignore: comando e nome da operação do backend
    setTimeout(() => window.dispatchEvent(new CustomEvent("kabul:open-term", { detail: { ws: w.id, session, title: `ssh ${alias}` } })), 400);
  } catch (e) {
    onError(errText(e));
  }
}

/** Configurações › Hosts SSH: o `~/.ssh/config` como lista, com teste, terminal, edição com prévia e chaves. */
export function SshHostsPage({ onError }: { onError: (e: string) => void }) {
  const [ov, setOv] = useState<SshOverview | null>(null);
  const [eff, setEff] = useState<Record<string, SshEffective>>({});
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [targets, setTargets] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tests, setTests] = useState<Record<string, SshTest | "running">>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState<{ host: SshHost | null } | null>(null);
  const [review, setReview] = useState<{ op: SshOp; plan: SshPlan; title: string } | null>(null);
  const [keygen, setKeygen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useDismiss(moreRef, more, () => setMore(false));

  const load = async (announce = false) => {
    setSyncing(true);
    try {
      const o = await api.sshHosts();
      setOv(o);
      if (announce) setNotice(t("ssh.synced", { count: o.hosts.length, file: o.config_display }));
      api.sshKeys().then(setKeys, () => {});
      const aliases = [...new Set(o.hosts.map((h) => h.alias))];
      if (o.ssh_available && aliases.length) api.sshEffective(aliases).then((l) => setEff(Object.fromEntries(l.filter((x) => !x.error).map((x) => [x.alias, x]))), () => {});
    } catch (e) {
      onError(errText(e));
    } finally {
      setSyncing(false);
    }
  };
  useEffect(() => {
    void load();
    api.sshOpenTargets().then(setTargets, () => {});
  }, []);

  const test = async (alias: string) => {
    setTests((x) => ({ ...x, [alias]: "running" }));
    try {
      const r = await api.sshTest(alias);
      setTests((x) => ({ ...x, [alias]: r }));
    } catch (e) {
      setTests((x) => ({ ...x, [alias]: { ok: false, kind: "other", message: errText(e), ms: 0, command: sshCommand(alias) } }));
    }
  };
  const copy = (text: string, msg: string) => void navigator.clipboard.writeText(text).then(() => setNotice(msg), () => {});

  const ask = async (op: SshOp, title: string) => {
    try {
      setReview({ op, plan: await api.sshPreview(op), title });
    } catch (e) {
      onError(errText(e));
    }
  };
  // A prévia em diff é a confirmação: nada sai do arquivo antes de "Salvar".
  // i18n-ignore: comando e nome da operação do backend
  const remove = (h: SshHost) => ask({ op: "remove", file: h.file, line: h.line, alias: h.alias }, h.siblings.length ? t("ssh.remove.titleShared", { alias: h.alias, others: h.siblings.join(", ") }) : t("ssh.remove.title", { alias: h.alias }));

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (ov?.hosts ?? []).filter((h) => !needle || [h.alias, h.hostname, h.user, h.port, ...h.identity_files, h.proxy_jump, h.comment, eff[h.alias]?.hostname].some((v) => v?.toLowerCase().includes(needle))), [ov, needle, eff]);
  // Um grupo por arquivo: o principal primeiro, depois os incluídos na ordem em que aparecem.
  const groups = useMemo(() => {
    const m = new Map<string, SshHost[]>();
    if (ov) m.set(ov.config_display, []);
    for (const h of shown) m.set(h.file_display, [...(m.get(h.file_display) ?? []), h]);
    return [...m.entries()].filter(([, l]) => l.length);
  }, [shown, ov]);
  const selected = (ov?.hosts ?? []).filter((h) => sel.has(keyOf(h)));
  const toggle = (k: string[], on: boolean) => setSel((s) => {
    const n = new Set(s);
    k.forEach((x) => (on ? n.add(x) : n.delete(x)));
    return n;
  });
  const keyInfo = (path: string) => keys.find((k) => k.path === path || k.display === path || base(k.path) === base(path));

  return (
    <div className="ssh-page" data-testid="ssh-page">
      <p className="dim lead">{t("ssh.lead")}</p>
      <div className="ssh-toolbar">
        <button className="btn" onClick={() => void load(true)} disabled={syncing} data-testid="ssh-sync"><IRestore size={14} />{t("ssh.sync", { file: ov?.config_display ?? "~/.ssh/config" })}</button>
        <button className="btn" onClick={() => setForm({ host: null })} data-testid="ssh-add"><IPlus size={14} />{t("ssh.add")}</button>
        <div ref={moreRef} className="ssh-more">
          <button className="btn icon-only" title={t("ssh.more")} aria-label={t("ssh.more")} onClick={() => setMore(!more)} data-testid="ssh-more"><IMore size={14} /></button>
          {more && (
            <Floating testid="ssh-more-pop" className="ssh-pop">
              <div className={"pop-row" + (ov?.keygen_available ? "" : " disabled")} onClick={() => ov?.keygen_available && (setMore(false), setKeygen(true))} data-testid="ssh-keygen">{t("ssh.keygen.menu")}</div>
              <div className="pop-row" onClick={() => (setMore(false), setShowRules(!showRules))} data-testid="ssh-rules-toggle">{showRules ? t("ssh.rules.hide") : t("ssh.rules.show", { count: ov?.rules.length ?? 0 })}</div>
              <div className="pop-row" onClick={() => (setMore(false), ov && copy(ov.config, t("ssh.copiedPath")))}>{t("ssh.copyPath")}</div>
            </Floating>
          )}
        </div>
      </div>
      <hr className="ssh-sep" />
      {notice && <div className="ssh-notice" role="status" data-testid="ssh-notice">{notice}<button className="text-btn small" onClick={() => setNotice(null)}>{t("common.close")}</button></div>}
      {ov && !ov.ssh_available && <div className="gh-warn" data-testid="ssh-no-client">{t("ssh.noClient")}</div>}
      {ov?.warnings.map((w, i) => <div key={i} className="dim small ssh-warning" data-testid="ssh-warning">{t(`ssh.warning.${w.kind}` as Key, { detail: w.detail, file: w.file, line: w.line ?? "" })}</div>)}

      {ov && !ov.config_exists && ov.hosts.length === 0 ? (
        <div className="ssh-empty" data-testid="ssh-empty">
          <div>{t("ssh.empty.title", { file: ov.config_display })}</div>
          <div className="dim small">{t("ssh.empty.lead")}</div>
          <button className="btn primary" onClick={() => setForm({ host: null })}>{t("ssh.add")}</button>
        </div>
      ) : (
        <>
          <div className="ssh-countbar">
            <label className="pop-search ssh-search"><ISearch size={14} /><input {...noSuggest} autoComplete="off" placeholder={t("ssh.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="ssh-search" /></label>
            <span className="dim" data-testid="ssh-count">{ov ? t("ssh.count", { count: needle ? shown.length : ov.hosts.length }) : "…"}</span>
          </div>
          {selected.length > 0 && (
            <div className="ssh-batch" data-testid="ssh-batch">
              <span>{t("ssh.selected", { count: selected.length })}</span>
              <span className="grow" />
              <button className="btn" onClick={() => selected.forEach((h) => void test(h.alias))} data-testid="ssh-batch-test"><IPlay size={12} />{t("ssh.test.action")}</button>
              <button className="btn" onClick={() => copy(selected.map((h) => sshCommand(h.alias)).join("\n"), t("ssh.copiedCommands", { count: selected.length }))} data-testid="ssh-batch-copy"><ICopy size={12} />{t("ssh.copyCommands")}</button>
              <button className="btn" onClick={() => setSel(new Set())}>{t("ssh.clearSelection")}</button>
            </div>
          )}
          {groups.map(([file, list]) => {
            const ks = list.map(keyOf);
            const all = ks.every((k) => sel.has(k));
            return (
              <div key={file} className="ssh-group" data-testid="ssh-group">
                <div className="ssh-group-head">
                  <input type="checkbox" checked={all} ref={(el) => void (el && (el.indeterminate = !all && ks.some((k) => sel.has(k))))} onChange={() => toggle(ks, !all)} aria-label={t("ssh.selectGroup", { file })} data-testid="ssh-group-check" />
                  <span>{t("ssh.from", { file })}</span><span className="dim">· {list.length}</span>
                </div>
                {list.map((h) => (
                  <HostRow key={keyOf(h)} h={h} eff={eff[h.alias]} keyInfo={keyInfo} test={tests[h.alias]} checked={sel.has(keyOf(h))} expanded={expanded === keyOf(h)} targets={targets}
                    onCheck={(on) => toggle([keyOf(h)], on)} onExpand={() => setExpanded(expanded === keyOf(h) ? null : keyOf(h))}
                    onTest={() => void test(h.alias)} onTerminal={() => void openTerminal(h.alias, onError)} onCopy={() => copy(sshCommand(h.alias), t("ssh.copiedCommand", { cmd: sshCommand(h.alias) }))}
                    onOpenIn={(id) => api.sshOpenIn(id, h.alias).catch((e) => onError(errText(e)))} onEdit={() => setForm({ host: h })} onRemove={() => void remove(h)} />
                ))}
              </div>
            );
          })}
          {ov && ov.hosts.length > 0 && shown.length === 0 && <div className="dim small" data-testid="ssh-none">{t("ssh.noMatch", { q })}</div>}
          {ov && ov.config_exists && ov.hosts.length === 0 && <div className="dim small">{t("ssh.noHosts", { file: ov.config_display })}</div>}
        </>
      )}

      {showRules && ov && (
        <div className="ssh-rules" data-testid="ssh-rules">
          <h3>{t("ssh.rules.title")} <span className="count">{ov.rules.length}</span></h3>
          <div className="dim small">{t("ssh.rules.lead")}</div>
          {ov.rules.map((r) => (
            <div key={`${r.file}:${r.line}`} className="ssh-rule" data-testid="ssh-rule">
              <div><code>{r.kind === "match" ? "Match" : "Host"} {r.patterns}</code> <span className="dim small">{r.file_display}:{r.line}</span></div>
              {r.directives.map(([k, v], i) => <div key={i} className="dim small mono">{k} {v}</div>)}
            </div>
          ))}
        </div>
      )}

      {form && ov && (
        <HostFormDialog initial={form.host} keys={keys} aliases={ov.hosts.map((h) => h.alias)} sshDir={ov.config.replace(/[\\/]config$/, "")}
          onCancel={() => setForm(null)}
          onReview={async (f) => {
            const h = form.host;
            const op: SshOp = h ? { op: "update", file: h.file, line: h.line, alias: h.alias, host: f } : { op: "add", host: f };
            try {
              const plan = await api.sshPreview(op);
              setForm(null);
              setReview({ op, plan, title: h ? t("ssh.edit.title", { alias: h.alias }) : t("ssh.add.title", { alias: f.alias }) });
            } catch (e) {
              return errText(e);
            }
            return null;
          }} />
      )}
      {review && (
        <ReviewDialog title={review.title} plan={review.plan} onCancel={() => setReview(null)}
          onApply={async () => {
            try {
              const r = await api.sshApply(review.op, review.plan.digest);
              setReview(null);
              setNotice(r.backup ? t("ssh.saved", { file: review.plan.file_display, backup: r.backup.split(/[\\/]/).pop() ?? r.backup }) : t("ssh.savedNew", { file: review.plan.file_display }));
              setSel(new Set());
              await load();
            } catch (e) {
              return errText(e);
            }
            return null;
          }} />
      )}
      {keygen && <KeygenDialog keys={keys} onClose={() => setKeygen(false)} onDone={(k) => (setKeygen(false), setNotice(t("ssh.keygen.done", { file: k.display, fp: k.fingerprint ?? "" })), void load())} />}
    </div>
  );
}

function HostRow({ h, eff, keyInfo, test, checked, expanded, targets, onCheck, onExpand, onTest, onTerminal, onCopy, onOpenIn, onEdit, onRemove }: {
  h: SshHost; eff?: SshEffective; keyInfo: (p: string) => SshKey | undefined; test?: SshTest | "running"; checked: boolean; expanded: boolean; targets: { id: string; name: string }[];
  onCheck: (on: boolean) => void; onExpand: () => void; onTest: () => void; onTerminal: () => void; onCopy: () => void; onOpenIn: (id: string) => void; onEdit: () => void; onRemove: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, menu, () => setMenu(false));
  const id = h.identity_files[0];
  const act = (f: () => void) => () => (setMenu(false), f());
  const rows: [string, string | null | undefined][] = [
    ["HostName", h.hostname], ["User", h.user], ["Port", h.port], ...h.identity_files.map((x): [string, string] => ["IdentityFile", x]),
    ["ProxyJump", h.proxy_jump], ["ProxyCommand", h.proxy_command], ["ForwardAgent", h.forward_agent],
    ...h.local_forwards.map((x): [string, string] => ["LocalForward", x]), ...h.remote_forwards.map((x): [string, string] => ["RemoteForward", x]), ...h.other,
  ];
  return (
    <div className={"ssh-item" + (expanded ? " open" : "")} data-testid="ssh-row" data-alias={h.alias}>
      <div className="ssh-row">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={h.alias} data-testid="ssh-check" />
        <button className="ssh-main" onClick={onExpand} aria-expanded={expanded} data-testid="ssh-expand">
          <span className="ssh-alias">{h.alias}</span>
          <span className="ssh-addr">{sshAddress(h, eff)}{id && <span className="ssh-key"> · {base(id)}</span>}</span>
          {h.conditional && <span className="badge" title={t("ssh.conditional.hint")}>{t("ssh.conditional")}</span>}
        </button>
        {test && <span className={"ssh-status " + (test === "running" ? "run" : test.ok ? "ok" : "bad")} title={test !== "running" ? test.message : undefined} data-testid="ssh-status">{test === "running" ? t("ssh.test.running") : testLabel(test)}</span>}
        <div ref={ref} className="ssh-more">
          <button className="btn icon-only ghost" aria-label={t("ssh.rowMenu", { alias: h.alias })} onClick={() => setMenu(!menu)} data-testid="ssh-row-menu"><IMore size={14} /></button>
          {menu && (
            <Floating placement="bottom-end" testid="ssh-row-pop" className="ssh-pop">
              <div className="pop-row" onClick={act(onTest)} data-testid="ssh-test"><IPlay size={13} />{t("ssh.test.action")}</div>
              <div className="pop-row" onClick={act(onTerminal)} data-testid="ssh-terminal"><ITerminal size={13} />{t("ssh.terminal.action")}</div>
              <div className="pop-row" onClick={act(onCopy)} data-testid="ssh-copy"><ICopy size={13} />{t("ssh.copyCommand")}</div>
              {targets.length > 0 && <div className="pop-title">{t("ssh.openIn")}</div>}
              {targets.map((x) => <div key={x.id} className="pop-row" onClick={act(() => onOpenIn(x.id))} data-testid={`ssh-open-${x.id}`}>{t("ssh.openInApp", { app: x.name })}</div>)}
              <div className="pop-sep" />
              <div className="pop-row" onClick={act(onEdit)} data-testid="ssh-edit"><IPencil size={13} />{t("common.edit")}</div>
              <div className="pop-row danger" onClick={act(onRemove)} data-testid="ssh-remove"><ITrash size={13} />{t("common.remove")}</div>
            </Floating>
          )}
        </div>
      </div>
      {expanded && (
        <div className="ssh-detail" data-testid="ssh-detail">
          {h.comment && <div className="dim small">{h.comment}</div>}
          <dl>
            <dt>{t("ssh.detail.file")}</dt><dd className="mono">{h.file_display}:{h.line}</dd>
            {rows.filter(([, v]) => v).map(([k, v], i) => {
              const ki = k === "IdentityFile" ? keyInfo(v!) : undefined;
              return [<dt key={`k${i}`}>{k}</dt>, <dd key={`v${i}`} className="mono">{v}{ki?.fingerprint && <span className="dim"> · {ki.kind} {ki.fingerprint}</span>}{k === "IdentityFile" && ki && !ki.has_private && <span className="error small"> · {t("ssh.detail.noPrivate")}</span>}</dd>];
            })}
            {/* i18n-ignore: exemplos e diretivas do ssh_config */}
            {eff && (eff.hostname !== (h.hostname ?? h.alias) || eff.user !== h.user || eff.port !== h.port) && <><dt>{t("ssh.detail.effective")}</dt><dd className="mono" data-testid="ssh-effective">{`${eff.user ?? "?"}@${eff.hostname ?? "?"}:${eff.port ?? "?"}`}{eff.proxy_jump && ` · ProxyJump ${eff.proxy_jump}`}</dd></>}
          </dl>
          {h.siblings.length > 0 && <div className="dim small">{t("ssh.detail.siblings", { others: h.siblings.join(", ") })}</div>}
          {h.forward_agent?.toLowerCase() === "yes" && <div className="gh-warn small">{t("ssh.detail.forwardAgent")}</div>}
          {test && test !== "running" && !test.ok && (
            <div className="ssh-error" data-testid="ssh-error">
              <div><b>{testLabel(test)}</b> <span className="dim small">· {t(`ssh.hint.${test.kind}` as Key)}</span></div>
              {test.message && <pre>{test.message}</pre>}
              <div className="dim small mono">{test.command}</div>
            </div>
          )}
          <div className="row">
            <button className="btn" onClick={onTest}><IPlay size={12} />{t("ssh.test.action")}</button>
            <button className="btn" onClick={onTerminal}><ITerminal size={12} />{t("ssh.terminal.action")}</button>
            <button className="btn" onClick={onCopy}><ICopy size={12} />{t("ssh.copyCommand")}</button>
            <span className="grow" />
            <button className="btn" onClick={onEdit}>{t("common.edit")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Formulário de host (adicionar ou editar). `onReview` devolve o erro (texto) ou `null` se abriu a prévia. */
function HostFormDialog({ initial, keys, aliases, sshDir, onCancel, onReview }: { initial: SshHost | null; keys: SshKey[]; aliases: string[]; sshDir: string; onCancel: () => void; onReview: (f: SshForm) => Promise<string | null> }) {
  const [f, setF] = useState<SshForm>(() => ({ alias: initial?.alias ?? "", hostname: initial?.hostname ?? "", user: initial?.user ?? "", port: initial?.port ?? "", identity_file: initial?.identity_files[0] ?? "", proxy_jump: initial?.proxy_jump ?? "" }));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof SshForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  // Caminho dentro do ~/.ssh vira `~/.ssh/...` (o config fica portátil entre máquinas).
  const tilde = (p: string) => (p.startsWith(sshDir + "/") || p.startsWith(sshDir + "\\") ? `~/.ssh/${p.slice(sshDir.length + 1).replace(/\\/g, "/")}` : p);
  const known = keys.filter((k) => k.has_private).map((k) => ({ value: tilde(k.path).startsWith("~") ? k.display : k.path, label: `${k.display}${k.kind ? ` · ${k.kind}` : ""}${k.fingerprint ? ` · ${k.fingerprint.slice(0, 19)}…` : ""}` }));
  const cur = f.identity_file ?? "";
  const go = async () => {
    setBusy(true);
    setErr(await onReview({ ...f, alias: f.alias.trim() }));
    setBusy(false);
  };
  const portBad = !!f.port && !/^\d{1,5}$/.test(f.port);
  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="popover dialog ssh-form" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())} data-testid="ssh-form">
        <div className="dialog-title">{initial ? t("ssh.edit.title", { alias: initial.alias }) : t("ssh.add.formTitle")}</div>
        {initial && initial.siblings.length > 0 && <div className="dim small">{t("ssh.detail.siblings", { others: initial.siblings.join(", ") })}</div>}
        <div className="ssh-form-grid">
          <label className="field">{t("ssh.form.alias")}<input autoFocus {...noSuggest} autoComplete="off" value={f.alias} onChange={set("alias")} placeholder={t("ssh.form.aliasPlaceholder")} data-testid="ssh-f-alias" /></label>
          {/* i18n-ignore: exemplos e diretivas do ssh_config */}
          <label className="field">{t("ssh.form.hostname")}<input {...noSuggest} autoComplete="off" value={f.hostname ?? ""} onChange={set("hostname")} placeholder="server.example.com" data-testid="ssh-f-hostname" /></label>
          <label className="field">{t("ssh.form.user")}<input {...noSuggest} autoComplete="off" value={f.user ?? ""} onChange={set("user")} placeholder={"ubuntu" /* i18n-ignore */} data-testid="ssh-f-user" /></label>
          <label className="field">{t("ssh.form.port")}<input {...noSuggest} autoComplete="off" inputMode="numeric" value={f.port ?? ""} onChange={set("port")} placeholder="22" data-testid="ssh-f-port" /></label>
        </div>
        <label className="field">{t("ssh.form.key")}
          <div className="row">
            <select value={known.some((k) => k.value === cur) ? cur : cur ? "__custom" : ""} onChange={(e) => e.target.value !== "__custom" && setF({ ...f, identity_file: e.target.value })} data-testid="ssh-f-key-select">
              <option value="">{t("ssh.form.keyNone")}</option>
              {known.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              {cur && !known.some((k) => k.value === cur) && <option value="__custom">{cur}</option>}
            </select>
            <button className="btn" type="button" onClick={() => api.sshPickKey().then((p) => p && setF((x) => ({ ...x, identity_file: tilde(p) })), (e) => setErr(errText(e)))} data-testid="ssh-f-key-pick">{t("ssh.form.keyPick")}</button>
          </div>
          {/* i18n-ignore: exemplos e diretivas do ssh_config */}
          <input {...noSuggest} autoComplete="off" value={cur} onChange={set("identity_file")} placeholder="~/.ssh/id_ed25519" data-testid="ssh-f-key" />
          <span className="dim small">{t("ssh.form.keyHint")}</span>
        </label>
        <label className="field">{t("ssh.form.proxyJump")}<input {...noSuggest} autoComplete="off" list="ssh-aliases" value={f.proxy_jump ?? ""} onChange={set("proxy_jump")} placeholder={t("ssh.form.proxyJumpPlaceholder")} data-testid="ssh-f-jump" /></label>
        <datalist id="ssh-aliases">{aliases.filter((a) => a !== f.alias).map((a) => <option key={a} value={a} />)}</datalist>
        {portBad && <div className="error small">{t("ssh.form.portInvalid")}</div>}
        {err && <div className="error small" role="alert" data-testid="ssh-form-error">{err}</div>}
        <div className="row end">
          <button className="btn" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={busy || !f.alias.trim() || portBad} onClick={() => void go()} data-testid="ssh-f-review">{t("ssh.form.review")}</button>
        </div>
      </div>
    </div>
  );
}

/** Prévia em diff antes de gravar: backup e 0600 explicados; nada muda até "Salvar". */
function ReviewDialog({ title, plan, onCancel, onApply }: { title: string; plan: SshPlan; onCancel: () => void; onApply: () => Promise<string | null> }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const same = plan.before === plan.after;
  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="popover dialog ssh-review" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onCancel())} data-testid="ssh-review">
        <div className="dialog-title">{title}</div>
        <div className="dim small">{plan.creates ? t("ssh.review.creates", { file: plan.file_display }) : t("ssh.review.lead", { file: plan.file_display })}</div>
        {same ? <div className="dim">{t("ssh.review.nothing")}</div> : (
          <pre className="ssh-diff" data-testid="ssh-diff">
            {plan.diff.map((d, i) => <div key={i} className={d.op === "+" ? "add" : d.op === "-" ? "del" : d.op === "…" ? "gap" : ""}><span className="ln">{d.op === "…" ? "" : (d.new ?? d.old)}</span><span className="op">{d.op === " " ? "" : d.op}</span>{d.text}</div>)}
          </pre>
        )}
        {err && <div className="error small" role="alert" data-testid="ssh-review-error">{err}</div>}
        <div className="row end">
          <button className="btn" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="btn primary" autoFocus disabled={busy || same} onClick={async () => (setBusy(true), setErr(await onApply()), setBusy(false))} data-testid="ssh-apply">{t("ssh.review.save")}</button>
        </div>
      </div>
    </div>
  );
}

/** "Gerar chave": `ssh-keygen -t ed25519` sem senha, só depois de confirmar. */
function KeygenDialog({ keys, onClose, onDone }: { keys: SshKey[]; onClose: () => void; onDone: (k: SshKey) => void }) {
  const taken = (n: string) => keys.some((k) => base(k.path) === n);
  const [name, setName] = useState(() => (taken("id_ed25519") ? "id_ed25519_kabul" : "id_ed25519"));
  const [comment, setComment] = useState("kabul");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bad = !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.endsWith(".pub");
  const go = async () => {
    setBusy(true);
    try {
      onDone(await api.sshKeygen(name, comment));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="popover dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())} data-testid="ssh-keygen-dialog">
        <div className="dialog-title">{t("ssh.keygen.title")}</div>
        <div className="dim small">{t("ssh.keygen.lead")}</div>
        <label className="field">{t("ssh.keygen.name")}<input autoFocus {...noSuggest} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} data-testid="ssh-kg-name" /></label>
        <label className="field">{t("ssh.keygen.comment")}<input {...noSuggest} autoComplete="off" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="ssh-kg-comment" /></label>
        <code className="small">ssh-keygen -t ed25519 -N "" -C {JSON.stringify(comment)} -f ~/.ssh/{name}</code>
        <div className="dim small">{t("ssh.keygen.passphrase")}</div>
        {taken(name) && <div className="error small">{t("ssh.keygen.exists", { name })}</div>}
        {err && <div className="error small" role="alert">{err}</div>}
        <div className="row end">
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={busy || bad || taken(name)} onClick={() => void go()} data-testid="ssh-kg-go">{t("ssh.keygen.go")}</button>
        </div>
      </div>
    </div>
  );
}
