import { useEffect, useState } from "react";
import { api, type Diagnostics } from "../api";
import { t } from "../i18n";

/** Ajuda › Diagnóstico: checagens do ambiente com relatório copiável (com ou sem dados pessoais). */
export function DiagnosticsView({ onError }: { onError: (e: string) => void }) {
  const [d, setD] = useState<Diagnostics | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const load = () => (setD(null), api.diagnostics().then(setD, (e) => onError(String(e))));
  useEffect(() => void load(), []);
  const copy = (k: string, text: string) => navigator.clipboard.writeText(text).then(() => (setCopied(k), setTimeout(() => setCopied(null), 1200)));
  const groups = [...new Set((d?.checks ?? []).map((c) => c.group))];
  return (
    <section className="page" data-testid="diagnostics">
      <header className="page-head" data-tauri-drag-region><h2>{t("settings.diag.title")}</h2><span className="grow" />
        <button className="btn" onClick={load}>{t("settings.diag.rerun")}</button>
        <button className="btn" disabled={!d} onClick={() => d && copy("full", d.report)} data-testid="diag-copy">{copied === "full" ? t("common.copied") : t("settings.diag.copy")}</button>
        <button className="btn primary" disabled={!d} onClick={() => d && copy("redacted", d.redacted)} data-testid="diag-copy-redacted">{copied === "redacted" ? t("common.copied") : t("settings.diag.copyRedacted")}</button>
      </header>
      {!d && <div className="dim">{t("settings.diag.checking")}</div>}
      {groups.map((g) => (
        <div key={g} className="set-group">
          <h3>{g}</h3>
          {d!.checks.filter((c) => c.group === g).map((c) => (
            <div key={c.name} className="set-row" data-testid="diag-row"><div><div><span className={c.ok ? "ok" : "error"}>{c.ok ? "✓" : "✕"}</span> {c.name}</div><div className="dim small">{c.detail}</div></div></div>
          ))}
        </div>
      ))}
    </section>
  );
}
