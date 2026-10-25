import { useEffect, useState } from "react";
import { api, type AppSettings, type Model, type Prompts, type Repo, type RepoSettingsT } from "../api";
import { noSuggest } from "../noSuggest";
import { confirmDialog } from "../components/Confirm";
import { getThemePref, setThemePref, applyAppearance, type ThemePref } from "../theme";
import { IMonitor, IMoon, ISun, RepoMark } from "../icons";
import { DEFAULT_PROMPTS, promptLabels } from "../components/useGit";
import { Row, Toggle, useAppSettings, useLocalPref } from "./settingsUi";
import { applyZoom } from "../App";
import { UpdatesSection } from "../components/Updates";
import { TrayIconSection } from "../components/TrayIconPrefs";
import type { Route } from "../App";
import { LANG_NAMES, langPref, setLangPref, systemLang, t, type LangPref } from "../i18n";
import { tNode } from "../i18n/react";

const SOUNDS = ["none", "Glass", "Ping", "Pop", "Purr", "Hero", "Submarine", "Funk", "Tink", "Bottle", "Frog", "Morse", "Sosumi", "Blow", "Basso"];

/** Geral: envio, fila, passos, notificações e som (com Teste), contexto, colagem longa, frase “absolutely right”. */
export function GeneralPage({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  if (!s) return null;
  return (
    <div className="set-group" data-testid="general">
      <Row label={t("settings.language")} hint={t("settings.language.hint")} id="language">
        <select defaultValue={langPref()} onChange={(e) => setLangPref(e.target.value as LangPref)} data-testid="lang-select">
          <option value="system">{t("settings.language.system", { lang: LANG_NAMES[systemLang()] })}</option>
          <option value="en">{LANG_NAMES.en}</option>
          <option value="pt-BR">{LANG_NAMES["pt-BR"]}</option>
        </select>
      </Row>
      <Row label={t("settings.general.sendKey")} hint={t("settings.general.sendKey.hint")}><select defaultValue={localStorage.getItem("kabul.sendKey") ?? "enter"} onChange={(e) => localStorage.setItem("kabul.sendKey", e.target.value)} data-testid="send-key"><option value="enter">↵</option><option value="cmdEnter">⌘↵</option></select></Row>
      <Row label={t("settings.general.followUp")} hint={t("settings.general.followUp.hint")}><select defaultValue={localStorage.getItem("kabul.followUp") ?? "queue"} onChange={(e) => localStorage.setItem("kabul.followUp", e.target.value)} data-testid="follow-up"><option value="queue">{t("settings.general.followUp.queue")}</option><option value="steer">{t("settings.general.followUp.steer")}</option></select></Row>
      <Row label={t("settings.general.noCollapse")} hint={t("settings.general.noCollapse.hint")}><select defaultValue={localStorage.getItem("kabul.noCollapse") ?? "0"} onChange={(e) => localStorage.setItem("kabul.noCollapse", e.target.value)}><option value="0">{t("settings.general.noCollapse.collapse")}</option><option value="1">{t("settings.general.noCollapse.showAll")}</option></select></Row>
      <Row label={t("settings.general.openIn")} hint={t("settings.general.openIn.hint")}><select defaultValue={localStorage.getItem("kabul.openIn.default") ?? ""} onChange={(e) => localStorage.setItem("kabul.openIn.default", e.target.value)} data-testid="open-default"><option value="">{t("settings.general.openIn.last")}</option><option value="finder">Finder</option><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="zed">Zed</option><option value="terminal">Terminal</option><option value="iterm">iTerm</option><option value="warp">Warp</option><option value="ghostty">Ghostty</option></select></Row>
      <Toggle s={s} save={save} k="notifications" label={t("settings.general.notifications")} hint={t("settings.general.notifications.hint")} />
      <Row label={t("settings.general.sound")} hint={t("settings.general.sound.hint")}>
        <div className="row">
          <select value={s.sound ? s.completion_sound ?? "Glass" : "none"} onChange={(e) => save({ ...s, sound: e.target.value !== "none", completion_sound: e.target.value })} data-testid="sound-select">
            {SOUNDS.map((x) => <option key={x} value={x}>{x === "none" ? t("settings.general.sound.none") : x}</option>)}
          </select>
          <button className="btn" disabled={!s.sound} onClick={() => api.soundPlay(s.completion_sound ?? "Glass").catch((e) => onError(String(e)))} data-testid="sound-test">{t("common.test")}</button>
        </div>
      </Row>
      <Toggle s={s} save={save} k="show_resources" label={t("settings.general.resources")} hint={t("settings.general.resources.hint")} />
      <Toggle s={s} save={save} k="caffeinate" label={t("settings.general.caffeinate")} hint={t("settings.general.caffeinate.hint")} />
      <Toggle s={s} save={save} k="tray" label={t("settings.general.tray")} hint={t("settings.general.tray.hint")} />
      {s.tray !== false && (
        <div className="set-row set-sub" data-setting="tray_icon">
          <div><div>{t("usage.tray.section")}</div><div className="dim small">{t("settings.general.trayIcon.hint")}</div></div>
          <TrayIconSection s={s} save={save} />
        </div>
      )}
      <Row label={t("settings.general.alertPct")} hint={t("settings.general.alertPct.hint")} id="usage_alert_pct">
        <select value={s.usage_alert_pct ?? 80} onChange={(e) => save({ ...s, usage_alert_pct: Number(e.target.value) })} data-testid="usage-alert-pct">
          {[50, 70, 80, 90, 95].map((p) => <option key={p} value={p}>{p}%</option>)}
        </select>
      </Row>
      <Row label={t("settings.general.budget")} hint={t("settings.general.budget.hint")} id="usage_budget">
        <div className="row">
          <input type="number" min={0} step={1} placeholder={t("settings.general.budget.daily")} defaultValue={s.usage_daily_budget ?? ""} style={{ width: 90 }} onBlur={(e) => save({ ...s, usage_daily_budget: e.target.value ? Number(e.target.value) : null })} data-testid="usage-daily-budget" />
          <input type="number" min={0} step={1} placeholder={t("settings.general.budget.monthly")} defaultValue={s.usage_monthly_budget ?? ""} style={{ width: 90 }} onBlur={(e) => save({ ...s, usage_monthly_budget: e.target.value ? Number(e.target.value) : null })} data-testid="usage-monthly-budget" />
        </div>
      </Row>
      <Toggle s={s} save={save} k="usage_codexbar" label={t("settings.general.codexbar")} hint={t("settings.general.codexbar.hint")} />
      <Toggle s={s} save={save} k="always_show_context" label={t("settings.general.context")} hint={t("settings.general.context.hint")} />
      <Toggle s={s} save={save} k="auto_convert_long_text" label={t("settings.general.longText")} hint={t("settings.general.longText.hint")} />
      <Toggle s={s} save={save} k="not_absolutely_right" label={t("settings.general.absolutelyRight")} hint={t("settings.general.absolutelyRight.hint")} />
    </div>
  );
}

/** Aparência: tema, zoom, contraste, cores acessíveis, fontes, Markdown, terminal, ligaduras, diffs na barra lateral. */
export function AppearancePage() {
  const [p, setP] = useState<ThemePref>(getThemePref());
  const [zoom, setZoom] = useState(Number(localStorage.getItem("kabul.zoom") ?? "100"));
  const pref = (k: string, def: string) => {
    const [v, set] = useLocalPref(k, def);
    return [v, (n: string) => (set(n), applyAppearance())] as const;
  };
  const [contrast, setContrast] = pref("kabul.contrast", "normal");
  const [cb, setCb] = pref("kabul.cb", "default");
  const [mono, setMono] = pref("kabul.monoFont", "Geist Mono");
  const [md, setMd] = pref("kabul.mdStyle", "default");
  const [lig, setLig] = pref("kabul.ligatures", "on");
  const [diffs, setDiffs] = pref("kabul.sidebarDiffs", "colored");
  const [tfont, setTfont] = pref("kabul.term.font", "");
  const [tsize, setTsize] = pref("kabul.term.size", "12");
  useEffect(() => {
    const h = (e: Event) => setZoom((e as CustomEvent).detail);
    window.addEventListener("kabul:zoom-changed", h);
    return () => window.removeEventListener("kabul:zoom-changed", h);
  }, []);
  const opts: [ThemePref, string, React.ReactNode][] = [["light", t("settings.appearance.light"), <ISun size={18} />], ["dark", t("settings.appearance.dark"), <IMoon size={18} />], ["system", t("settings.appearance.system"), <IMonitor size={18} />]];
  return (
    <div className="set-group" data-testid="appearance">
      <div className="dim small">{t("settings.appearance.lead")}</div>
      <div className="theme-cards" data-testid="theme-cards">
        {opts.map(([k, label, icon]) => (
          <button key={k} className={"theme-card t-" + k + (p === k ? " on" : "")} onClick={() => (setThemePref(k), setP(k))}>
            <span className="theme-preview"><span /><span /><span /></span>
            <span className="row">{icon} {label}</span>
          </button>
        ))}
      </div>
      <Row label={t("settings.appearance.zoom")} hint={t("settings.appearance.zoom.hint")}><div className="row"><button className="btn" onClick={() => applyZoom(-1)}>−</button><span data-testid="zoom-value">{zoom}%</span><button className="btn" onClick={() => applyZoom(1)}>+</button><button className="btn" onClick={() => applyZoom(0)}>100%</button></div></Row>
      <Row label={t("settings.appearance.contrast")} hint={t("settings.appearance.contrast.hint")}><select value={contrast} onChange={(e) => setContrast(e.target.value)} data-testid="contrast"><option value="normal">{t("settings.appearance.contrast.normal")}</option><option value="low">{t("settings.appearance.contrast.low")}</option></select></Row>
      <Row label={t("settings.appearance.cb")} hint={t("settings.appearance.cb.hint")}><select value={cb} onChange={(e) => setCb(e.target.value)} data-testid="cb"><option value="default">{t("settings.appearance.default")}</option><option value="deuteranopia">{t("settings.appearance.cb.deuteranopia")}</option><option value="protanopia">{t("settings.appearance.cb.protanopia")}</option><option value="tritanopia">{t("settings.appearance.cb.tritanopia")}</option></select></Row>
      <Row label={t("settings.appearance.mono")} hint={t("settings.appearance.mono.hint")}><select value={mono} onChange={(e) => setMono(e.target.value)} data-testid="mono-font">{["Geist Mono", "SF Mono", "Menlo", "JetBrains Mono"].map((f) => <option key={f}>{f}</option>)}</select></Row>
      <Row label={t("settings.appearance.md")} hint={t("settings.appearance.md.hint")}><select value={md} onChange={(e) => setMd(e.target.value)} data-testid="md-style"><option value="default">{t("settings.appearance.default")}</option><option value="tufte">{t("settings.appearance.md.tufte")}</option></select></Row>
      <Row label={t("settings.appearance.ligatures")}><select value={lig} onChange={(e) => setLig(e.target.value)}><option value="on">{t("settings.appearance.ligatures.on")}</option><option value="off">{t("settings.appearance.ligatures.off")}</option></select></Row>
      <Row label={t("settings.appearance.diffs")} hint={t("settings.appearance.diffs.hint")}><select value={diffs} onChange={(e) => setDiffs(e.target.value)}><option value="colored">{t("settings.appearance.diffs.colored")}</option><option value="plain">{t("settings.appearance.diffs.plain")}</option></select></Row>
      <h3>{t("settings.appearance.terminal")}</h3>
      <Row label={t("settings.appearance.termFont")} hint={t("settings.appearance.termFont.hint")}><input {...noSuggest} autoComplete="off" value={tfont} onChange={(e) => setTfont(e.target.value)} placeholder={t("settings.appearance.termFont.placeholder")} data-testid="term-font" /></Row>
      <Row label={t("settings.appearance.termSize")} hint={t("settings.appearance.termSize.hint")}><input type="number" min={10} max={20} value={tsize} onChange={(e) => setTsize(String(Math.min(20, Math.max(10, Number(e.target.value) || 12))))} data-testid="term-size" style={{ width: 70 }} /></Row>
      <div className="term-preview" style={{ fontFamily: `${tfont ? `"${tfont}", ` : ""}Menlo, monospace`, fontSize: Number(tsize) }}>{"dev@mac kabul % echo $KABUL_PORT"}<br />41000</div> {/* i18n-ignore: amostra de terminal */}
      <BigTerminalPreset />
    </div>
  );
}

/** Modelos: estilo de saída do Claude, personalidade do Codex, modelo da revisão e plano como padrão. */
export function ModelsPage({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  const [models, setModels] = useState<Model[]>([]);
  useEffect(() => void api.models().then(setModels, () => {}), []);
  if (!s) return null;
  return (
    <div className="set-group" data-testid="models-page">
      <Row label={t("settings.models.outputStyle")} hint={t("settings.models.outputStyle.hint")}><select value={s.claude_output_style ?? "default"} onChange={(e) => save({ ...s, claude_output_style: e.target.value })} data-testid="output-style">{["default", "Proactive", "Concise", "Explanatory", "Learning"].map((o) => <option key={o} value={o}>{o === "default" ? t("settings.appearance.default") : o}</option>)}</select></Row>
      <Row label={t("settings.models.codexPersonality")} hint={t("settings.models.codexPersonality.hint")}><select value={s.codex_personality ?? "pragmatic"} onChange={(e) => save({ ...s, codex_personality: e.target.value })}><option value="pragmatic">{t("settings.models.codexPersonality.pragmatic")}</option><option value="friendly">{t("settings.models.codexPersonality.friendly")}</option><option value="none">{t("settings.models.codexPersonality.none")}</option></select></Row>
      <Row label={t("settings.models.review")} hint={t("settings.models.review.hint")}><select value={s.review_model ?? ""} onChange={(e) => save({ ...s, review_model: e.target.value || null })} data-testid="review-model"><option value="">{t("settings.models.review.current")}</option>{models.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Row>
      <Toggle s={s} save={save} k="default_plan" label={t("settings.models.defaultPlan")} hint={t("settings.models.defaultPlan.hint")} />
      <Toggle s={s} k="agy_skip_permissions" danger label={t("settings.models.agySkip")} id="Gemini: aprovar tudo automaticamente (--dangerously-skip-permissions)" // i18n-ignore: id estável (E2E)
        hint={t("settings.models.agySkip.hint")}
        save={async (n) => {
          if (n.agy_skip_permissions && !(await confirmDialog(t("settings.models.agySkip.confirm"), { ok: t("settings.models.agySkip.ok"), danger: true }))) return;
          save(n);
        }} />
    </div>
  );
}

/** Ambiente por escopo: usuário (todas as conversas), repo local (editável) e repo compartilhado (herdado, só leitura). */
export function EnvironmentPage({ repos, onError }: { repos: Repo[]; onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  const [scope, setScope] = useState("user");
  const [bulk, setBulk] = useState("");
  const [layers, setLayers] = useState<[string, Record<string, string>][]>([]);
  const [repoSet, setRepoSet] = useState<RepoSettingsT | null>(null);
  useEffect(() => {
    if (scope === "user") return;
    api.repoEnvLayers(scope).then(setLayers, (e) => onError(String(e)));
    api.repoSettings(scope).then((r) => setRepoSet(r.settings), () => {});
  }, [scope, onError]);
  if (!s) return null;
  const valid = (k: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
  const parse = (txt: string) => txt.split("\n").map((l) => l.trim().replace(/^export\s+/, "")).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2")] as [string, string]).filter(([k]) => valid(k));
  const shared = layers.find(([n]) => n === "repo")?.[1] ?? {};
  const local = layers.find(([n]) => n === "repo local")?.[1] ?? {};
  const saveLocal = async (env: Record<string, string>) => {
    if (!repoSet) return;
    // A camada local guarda só o que difere da compartilhada (o resto é herdado).
    const n = { ...repoSet, env };
    setRepoSet(n);
    await api.saveRepoSettings(scope, n).catch((e) => onError(String(e)));
    api.repoEnvLayers(scope).then(setLayers, () => {});
  };
  return (
    <div className="set-group" data-testid="env-page">
      <div className="scope-seg">
        <button className={"rtab" + (scope === "user" ? " on" : "")} onClick={() => setScope("user")} data-testid="env-scope-user">{t("settings.env.user")}</button>
        {repos.map((r) => <button key={r.id} className={"rtab" + (scope === r.id ? " on" : "")} onClick={() => setScope(r.id)} data-testid="env-scope-repo">{r.name}</button>)}
      </div>
      {scope === "user" ? (
        <>
          <p className="dim small">{t("settings.env.userLead")}</p>
          {s.env.map((v, i) => (
            <div key={i} className="row env-row" data-testid="env-row">
              <input {...noSuggest} autoComplete="off" value={v.key} placeholder={t("settings.env.key")} className={v.key && !valid(v.key) ? "invalid" : ""} onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
              <input {...noSuggest} autoComplete="off" value={v.value} placeholder={t("settings.env.value")} type="password" onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <select value={v.scope} onChange={(e) => save({ ...s, env: s.env.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)) })}>{["all", "claude", "codex", "opencode", "qwen", "gemini", "agy"].map((o) => <option key={o}>{o}</option>)}</select>
              <button className="btn" onClick={() => save({ ...s, env: s.env.filter((_, j) => j !== i) })}>{t("common.remove")}</button>
            </div>
          ))}
          <div className="row"><button className="btn" onClick={() => save({ ...s, env: [...s.env, { key: "", value: "", scope: "all" }] })} data-testid="env-add">{t("settings.env.addVar")}</button></div>
          <label className="field">{t("settings.env.bulk")}<textarea rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"API_URL=http://localhost:3000\nexport DEBUG=1"} /* i18n-ignore: exemplo de .env */ data-testid="env-bulk" /></label>
          <div className="row"><button className="btn" disabled={!parse(bulk).length} onClick={() => (save({ ...s, env: [...s.env.filter((x) => !parse(bulk).some(([k]) => k === x.key)), ...parse(bulk).map(([key, value]) => ({ key, value, scope: "all" }))] }), setBulk(""))} data-testid="env-bulk-add">{t("settings.env.bulkAdd", { count: parse(bulk).length, n: parse(bulk).length || "" })}</button></div>
          <Row label={t("settings.env.file")} hint={t("settings.env.file.hint")}><input {...noSuggest} autoComplete="off" defaultValue={s.env_file ?? ""} onBlur={(e) => save({ ...s, env_file: e.target.value || null })} placeholder="~/.config/kabul/.env" /* i18n-ignore: caminho */ data-testid="env-file" /></Row>
        </>
      ) : (
        <>
          <p className="dim small">{tNode("settings.env.repoLead", { shared: <code>.kabul/settings.toml</code>, local: <code>settings.local.toml</code> })}</p>
          {Object.entries({ ...shared, ...local }).map(([k, v]) => {
            const inherited = k in shared && !(k in local);
            const over = k in shared && k in local;
            return (
              <div key={k} className="row env-row" data-testid="repo-env-row">
                <code>{k}</code>
                <input {...noSuggest} autoComplete="off" defaultValue={v} disabled={inherited} onBlur={(e) => e.target.value !== v && saveLocal({ ...local, [k]: e.target.value })} />
                {inherited && <span className="badge">{t("settings.env.inherited")}</span>}
                {over && <span className="badge ok">{t("settings.env.overridden")}</span>}
                {inherited ? <button className="btn" onClick={() => saveLocal({ ...local, [k]: v })}>{t("settings.env.override")}</button> : <button className="btn" onClick={() => { const n = { ...local }; delete n[k]; saveLocal(n); }}>{over ? t("settings.env.revert") : t("common.remove")}</button>}
              </div>
            );
          })}
          <label className="field">{t("settings.env.repoAdd")}<textarea rows={2} value={bulk} onChange={(e) => setBulk(e.target.value)} data-testid="repo-env-bulk" /></label>
          <div className="row"><button className="btn" disabled={!parse(bulk).length} onClick={() => (saveLocal({ ...local, ...Object.fromEntries(parse(bulk)) }), setBulk(""))} data-testid="repo-env-add">{t("common.add")}</button></div>
        </>
      )}
    </div>
  );
}

/** Ações (por repositório): instruções extras para revisão, criar PR, corrigir erros, conflitos, branch e gerais. */
export function ActionsPage({ repos, repoId, onError, onRoute }: { repos: Repo[]; repoId?: string; onError: (e: string) => void; onRoute: (r: Route) => void }) {
  const [s, setS] = useState<RepoSettingsT | null>(null);
  const [saved, setSaved] = useState(false);
  const id = repoId ?? repos[0]?.id;
  useEffect(() => void (id && api.repoSettings(id).then((r) => setS(r.settings), (e) => onError(String(e)))), [id, onError]);
  if (!repos.length) return <p className="dim">{t("settings.repo.addFirst")}</p>;
  if (!s) return null;
  const prompts: Prompts = s.prompts ?? { general: null, review: null, create_pr: null, fix_errors: null, resolve_conflicts: null, branch_rename: null };
  const save = (k: keyof Prompts, v: string) => {
    const n = { ...s, prompts: { ...prompts, [k]: v.trim() ? v : null } };
    setS(n);
    api.saveRepoSettings(id!, n).then(() => (setSaved(true), setTimeout(() => setSaved(false), 1200)), (e) => onError(String(e)));
  };
  return (
    <div className="set-group" data-testid="actions-page">
      <div className="set-row"><div>{t("settings.repo.label")}</div><select value={id} onChange={(e) => onRoute({ kind: "settings", tab: "acoes", repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      <p className="dim small">{t("settings.actions.lead")} {saved && <span className="ok">{t("settings.actions.saved")}</span>}</p>
      {promptLabels().map(([k, label, hint]) => (
        <label key={k} className="field prompt-field">{label} <span className="dim small">{hint}</span>
          <textarea rows={3} defaultValue={prompts[k] ?? ""} onBlur={(e) => save(k, e.target.value)} placeholder={k === "general" ? t("settings.actions.generalPlaceholder") : t("settings.actions.defaultPlaceholder", { text: (DEFAULT_PROMPTS[k] || "").slice(0, 110) })} data-testid={`prompt-${k}`} />
        </label>
      ))}
    </div>
  );
}

const ICONS = ["", "🚀", "🧪", "🛒", "📱", "🌐", "⚙️", "📦", "🎮", "📊", "🤖", "🔧"];

/** Diversos do repositório: ícone, caminhos (só leitura), URL de preview com a porta e remover. */
export function MiscPage({ repos, repoId, onError, onRoute, onChange }: { repos: Repo[]; repoId?: string; onError: (e: string) => void; onRoute: (r: Route) => void; onChange: () => void }) {
  const id = repoId ?? repos[0]?.id;
  const repo = repos.find((r) => r.id === id);
  const [s, setS] = useState<RepoSettingsT | null>(null);
  useEffect(() => void (id && api.repoSettings(id).then((r) => setS(r.settings), (e) => onError(String(e)))), [id, onError]);
  if (!repo) return <p className="dim">{t("settings.repo.addFirst")}</p>;
  return (
    <div className="set-group" data-testid="misc-page">
      <div className="set-row"><div>{t("settings.repo.label")}</div><select value={id} onChange={(e) => onRoute({ kind: "settings", tab: "diversos", repoId: e.target.value })}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      <Row label={t("settings.misc.icon")} hint={t("settings.misc.icon.hint")}>
        <div className="emoji-grid">{ICONS.map((e) => <button key={e || "none"} className={"emoji" + ((repo.icon ?? "") === e ? " on" : "")} onClick={() => api.repoUpdate(repo.id, { icon: e }).then(onChange, (x) => onError(String(x)))} data-testid="repo-icon">{e || <RepoMark name={repo.name} size={16} />}</button>)}</div>
      </Row>
      <Row label={t("settings.misc.folder")}><code className="dim small">{repo.path}</code></Row>
      <Row label={t("settings.misc.preview")} hint={t("settings.misc.preview.hint")}>
        {s && <input {...noSuggest} autoComplete="off" defaultValue={s.preview_url ?? ""} placeholder="http://localhost:$KABUL_PORT" onBlur={(e) => api.saveRepoSettings(repo.id, { ...s, preview_url: e.target.value || null }).catch((x) => onError(String(x)))} data-testid="preview-url" />}
      </Row>
      <Row label={t("settings.misc.browserHosts")} hint={t("settings.misc.browserHosts.hint")} id="browser_hosts">
        {s && <input {...noSuggest} autoComplete="off" defaultValue={(s.browser_hosts ?? []).join(", ")} placeholder={t("settings.misc.browserHosts.ph")} onBlur={(e) => { const hosts = e.target.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean); const n = { ...s, browser_hosts: hosts }; setS(n); api.saveRepoSettings(repo.id, n).catch((x) => onError(String(x))); }} data-testid="browser-hosts" />}
      </Row>
      <Row label={t("settings.misc.remove")} hint={t("settings.misc.remove.hint")}>
        <button className="btn danger" onClick={async () => { if (await confirmDialog(t("settings.misc.remove.confirm", { name: repo.name }), { ok: t("common.remove"), danger: true })) api.removeRepo(repo.id).then(() => (onChange(), onRoute({ kind: "settings", tab: "geral" })), (e) => onError(String(e))); }} data-testid="repo-remove">{t("settings.misc.remove.button")}</button>
      </Row>
    </div>
  );
}

/** Avançado: pasta de estado, executáveis dos agentes, scrollback do terminal e atualizações. */
export function AdvancedPage({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  if (!s) return null;
  const path = (k: "claude_path" | "codex_path" | "opencode_path", label: string, ph: string) => (
    <Row label={label} hint={t("settings.advanced.bin.hint")}><div className="row"><input {...noSuggest} autoComplete="off" defaultValue={s[k] ?? ""} placeholder={ph} onBlur={(e) => save({ ...s, [k]: e.target.value || null })} data-testid={`bin-${k}`} /><button className="btn" onClick={() => save({ ...s, [k]: null })}>{t("settings.advanced.bin.default")}</button></div></Row>
  );
  return (
    <div className="set-group" data-testid="advanced-page">
      <Row label={t("settings.advanced.stateDir")} hint={t("settings.advanced.stateDir.hint")}><code className="dim small">~/Library/Application Support/kabul</code></Row>
      {path("claude_path", t("settings.advanced.bin.claude"), "/opt/homebrew/bin/claude")}
      {path("codex_path", t("settings.advanced.bin.codex"), "/opt/homebrew/bin/codex")}
      {path("opencode_path", t("settings.advanced.bin.opencode"), "~/.opencode/bin/opencode")}
      <Row label={t("settings.advanced.scrollback")} hint={t("settings.advanced.scrollback.hint")}>
        <input type="number" min={1} max={200} defaultValue={s.scrollback_mb ?? 10} onBlur={(e) => { const v = Math.max(1, Number(e.target.value) || 10); localStorage.setItem("kabul.term.scrollback", String(v)); save({ ...s, scrollback_mb: v }); }} style={{ width: 80 }} data-testid="scrollback" />
      </Row>
      <UpdatesSection s={s} save={save} />
    </div>
  );
}

export type { AppSettings };

/** Terminal grande (aba ⌘⇧T no centro): comando que já roda ao abrir a aba. */
import { TERM_PRESETS, termPreset } from "../components/chatPrefs";
export { TERM_PRESETS, termPreset };
function BigTerminalPreset() {
  const [k, setK] = useState(localStorage.getItem("kabul.bigTerminal.preset") ?? "none");
  const [cmd, setCmd] = useState(localStorage.getItem("kabul.bigTerminal.command") ?? "");
  useEffect(() => void localStorage.setItem("kabul.bigTerminal.preset", k), [k]);
  useEffect(() => void localStorage.setItem("kabul.bigTerminal.command", cmd), [cmd]);
  return (
    <>
      <Row label={t("settings.appearance.bigTerm")} hint={t("settings.appearance.bigTerm.hint")}>
        <select value={k} onChange={(e) => setK(e.target.value)} data-testid="term-preset">
          <option value="none">{t("settings.appearance.bigTerm.none")}</option><option value="claude">Claude Code</option><option value="codex">Codex</option><option value="agy">Gemini (Antigravity)</option><option value="opencode">OpenCode</option><option value="custom">{t("settings.appearance.bigTerm.custom")}</option>
        </select>
      </Row>
      {k === "custom" && <Row label={t("settings.appearance.bigTerm.command")}><input {...noSuggest} autoComplete="off" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={t("settings.appearance.bigTerm.placeholder")} data-testid="term-preset-cmd" /></Row>}
    </>
  );
}
