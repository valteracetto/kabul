import { confirmDialog } from "../components/Confirm";
import { noSuggest } from "../noSuggest";
import { useEffect, useState } from "react";
import { api, fmtBytes, HARNESS_LABEL, type Api, type LocalOverview } from "../api";
import { t } from "../i18n";
import { trError } from "../i18n/errors";

/** Modelos locais: runtimes detectados, modelos (tamanho, quantização, se cabe), downloads, endpoints e registro. */
export function LocalModelsView({ onError }: { onError: (e: string) => void }) {
  const [o, setO] = useState<LocalOverview | null>(null);
  const [pull, setPull] = useState<Record<string, string>>({});
  const [ep, setEp] = useState({ name: "", base_url: "", apis: ["openai"] as Api[], api_key: "" });
  const [reg, setReg] = useState("");
  const [regMsg, setRegMsg] = useState<string | null>(null);
  const load = () => api.localOverview().then(setO, (e) => onError(String(e)));
  useEffect(() => {
    load();
    api.registry().then(setReg, () => {});
  }, []);

  const doPull = async (source: string) => {
    const m = (pull[source] ?? "").trim();
    if (!m) return;
    if (!(await confirmDialog(t("settings.local.pullConfirm", { model: m, source }), { ok: t("settings.local.pullOk") }))) return;
    api.localPull(source, m).then((s) => onError(t("settings.local.pullStarted", { session: s })), (e) => onError(String(e)));
  };

  return (
    <section className="page" data-testid="local-page">
      <header className="page-head" data-tauri-drag-region><h2>{t("settings.local.title")}</h2>{o?.memory && <span className="dim">{t("settings.local.memory", { size: fmtBytes(o.memory) })}</span>}<span className="grow" /><button className="btn" onClick={load}>{t("common.refresh")}</button></header>
      {!o && <div className="dim">{t("settings.local.detecting")}</div>}
      {o?.sources.map((s) => (
        <div key={s.id} className="source" data-testid="source">
          <div className="source-head">
            <b>{s.name}</b>
            <span className={"badge " + (s.running ? "ok" : "")}>{s.running ? t("settings.local.running") : s.installed ? t("settings.local.stopped") : t("settings.local.notInstalled")}</span>
            {s.apis.map((a) => <span key={a} className="badge">{a}</span>)}
            <code className="dim">{s.base_url}</code>
            <span className="grow" />
            {!s.running && s.can_start && <button className="btn" onClick={() => api.localStart(s.id).then(() => setTimeout(load, 2500), (e) => onError(String(e)))}>{t("settings.local.start")}</button>}
            {s.custom && <button className="btn" onClick={() => api.removeEndpoint(s.id).then(load)}>{t("common.remove")}</button>}
          </div>
          {s.models.length > 0 && (
            <table>
              <thead><tr><th>{t("settings.local.col.model")}</th><th>{t("settings.local.col.params")}</th><th>{t("settings.local.col.quant")}</th><th>{t("settings.local.col.size")}</th><th>{t("settings.local.col.context")}</th><th>{t("settings.local.col.fits")}</th><th>{t("settings.local.col.loaded")}</th></tr></thead>
              <tbody>
                {s.models.map((m) => {
                  const fits = m.size_bytes && o.memory ? m.size_bytes * 1.2 <= o.memory * 0.75 : null;
                  return (
                    <tr key={m.id}>
                      <td>{m.name || m.id} <span className="dim small">{m.id !== m.name ? m.id : ""}</span></td>
                      <td>{m.params ?? "—"}</td><td>{m.quant ?? "—"}</td><td>{fmtBytes(m.size_bytes)}</td><td>{m.context ? `${Math.round(m.context / 1024)}k` : "—"}</td>
                      <td>{fits == null ? "—" : fits ? <span className="ok">{t("settings.local.yes")}</span> : <span className="error">{t("settings.local.no")}</span>}</td><td>{m.loaded ? t("settings.local.yes") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {s.can_pull && (s.installed || s.custom) && (
            <div className="row pull-row">
              <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.local.pullPlaceholder", { hint: s.pull_hint })} value={pull[s.id] ?? ""} onChange={(e) => setPull({ ...pull, [s.id]: e.target.value })} />
              <button className="btn" onClick={() => doPull(s.id)}>{t("settings.local.pull")}</button>
            </div>
          )}
        </div>
      ))}

      <h3>{t("settings.local.addEndpoint")}</h3>
      <div className="row env-row">
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.local.name")} value={ep.name} onChange={(e) => setEp({ ...ep, name: e.target.value })} />
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.local.urlPlaceholder")} value={ep.base_url} onChange={(e) => setEp({ ...ep, base_url: e.target.value })} />
        <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={ep.apis.includes("openai")} onChange={(e) => setEp({ ...ep, apis: e.target.checked ? [...ep.apis, "openai"] : ep.apis.filter((a) => a !== "openai") })} /> OpenAI</label>
        <label className="check-row"><input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} type="checkbox" checked={ep.apis.includes("anthropic")} onChange={(e) => setEp({ ...ep, apis: e.target.checked ? [...ep.apis, "anthropic"] : ep.apis.filter((a) => a !== "anthropic") })} /> Anthropic</label>
        <input autoComplete="off" autoCorrect="off" spellCheck={false} {...noSuggest} placeholder={t("settings.local.keyOptional")} type="password" value={ep.api_key} onChange={(e) => setEp({ ...ep, api_key: e.target.value })} />
        <button className="btn primary" disabled={!ep.name || !ep.base_url || !ep.apis.length} onClick={() => api.saveEndpoint({ id: "ep-" + ep.name.toLowerCase().replace(/\W+/g, "-"), name: ep.name, base_url: ep.base_url.replace(/\/v1\/?$/, ""), apis: ep.apis, api_key: ep.api_key || null }).then(() => (setEp({ name: "", base_url: "", apis: ["openai"], api_key: "" }), load()), (e) => onError(String(e)))}>{t("common.add")}</button>
      </div>

      <h3>{t("settings.local.harnesses")}</h3>
      <div className="harness-list">
        {o?.harnesses.map(([k, inst, cmd]) => (
          <div key={k} className="harness">
            <b>{HARNESS_LABEL[k]}</b> <span className={"badge " + (inst ? "ok" : "")}>{inst ? t("settings.local.installed") : t("settings.local.notInstalled")}</span>
            {!inst && <button className="btn" onClick={() => confirmDialog(t("settings.local.installConfirm", { name: HARNESS_LABEL[k], cmd })).then((ok) => void (ok && api.installHarness(k).then((s) => onError(t("settings.local.installing", { session: s })), (e) => onError(String(e)))))}>{t("settings.local.install")}</button>}
          </div>
        ))}
      </div>

      <h3>{t("settings.local.bestHarness")}</h3>
      <p className="dim small">{t("settings.local.bestHarnessLead")}</p>
      <textarea className="registry" rows={14} value={reg} onChange={(e) => setReg(e.target.value)} spellCheck={false} data-testid="registry" />
      <div className="row">
        <button className="btn primary" onClick={() => api.saveRegistry(reg).then(() => (setRegMsg(t("settings.local.saved")), load()), (e) => setRegMsg(trError(e)))}>{t("settings.local.saveRegistry")}</button>
        <button className="btn" onClick={() => api.resetRegistry().then(() => api.registry().then(setReg)).then(() => setRegMsg(t("settings.local.restored")))}>{t("settings.local.restore")}</button>
        {regMsg && <span className="dim small">{regMsg}</span>}
      </div>
    </section>
  );
}
