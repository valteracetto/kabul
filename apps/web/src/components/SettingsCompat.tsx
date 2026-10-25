import { useEffect, useState } from "react";
import { api, type ImportPreview, type Layer, type SettingsWarning } from "../api";
import { t, type Key } from "../i18n";

const TYPES = new Set(["string", "bool", "integer", "float", "list", "table", "null"]);
const PAGES: Record<string, string> = { git: "git", advanced: "avancado", models: "modelos" };

const typeName = (x?: string | null) => (x ?? "?").split("|").map((k) => (TYPES.has(k) ? t(`settings.compat.type.${k}` as Key) : k)).join(t("settings.compat.or"));

/** Motivo de um aviso, no idioma da interface. */
export function warningReason(w: SettingsWarning): string {
  switch (w.kind) {
    case "syntax": return t("settings.compat.reason.syntax", { detail: w.detail ?? "" });
    case "type": return t("settings.compat.reason.type", { expected: typeName(w.expected), found: typeName(w.found) });
    case "value": return t("settings.compat.reason.value", { expected: (w.expected ?? "").split("|").join(", "), found: w.found ?? "" });
    case "unsupported": return t("settings.compat.reason.unsupported");
    case "app_setting": return t("settings.compat.reason.app_setting", { page: t(`settings.tab.${PAGES[w.detail ?? ""] ?? "geral"}` as Key) });
    case "cloud": return t("settings.compat.reason.cloud");
    default: return t("settings.compat.reason.unknown");
  }
}

/** Caminho relativo ao repo (os de fora ficam inteiros). */
const rel = (file: string, repoPath?: string) => (repoPath && file.startsWith(repoPath + "/") ? file.slice(repoPath.length + 1) : file);

/** Faixa "Algumas configurações não foram lidas": arquivo, chave e motivo de cada uma. */
export function SettingsWarnings({ layers, repoPath }: { layers: Layer[]; repoPath?: string }) {
  const ws = layers.flatMap((l) => l.warnings ?? []);
  if (!ws.length) return null;
  return (
    <div className="settings-warn" role="status" data-testid="settings-warnings">
      <b>{t("settings.compat.title")}</b>
      <div className="dim small">{t("settings.compat.hint")}</div>
      <ul>
        {ws.map((w, i) => (
          <li key={i} data-testid="settings-warning"><code>{rel(w.file, repoPath)}</code> › <code>{w.key || t("settings.compat.wholeFile")}</code> — {warningReason(w)}</li>
        ))}
      </ul>
    </div>
  );
}

/** "Importar configuração legada" (pasta do app anterior): mostra a prévia do `.kabul/settings.toml` gerado e só grava depois da confirmação. */
export function ImportSettings({ repoId, onDone, onError }: { repoId: string; onDone: () => void; onError: (e: string) => void }) {
  const [p, setP] = useState<ImportPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const load = () => api.repoSettingsImportPreview(repoId).then(setP, () => setP(null));
  useEffect(() => {
    setOpen(false);
    setDone(null);
    void load();
  }, [repoId]);
  if (done) return <div className="ok small" data-testid="import-done">{t("settings.compat.import.done", { files: done.join(", ") })}</div>;
  if (!p?.available) return null;
  const write = () => api.repoSettingsImport(repoId, p.digest).then((files) => (setDone(files), setOpen(false), onDone()), (e) => (onError(String(e)), void load()));
  return (
    <div className="settings-import">
      {!open ? (
        <div className="row">
          <button className="btn" onClick={() => void load().then(() => setOpen(true))} data-testid="import-settings">{t("settings.compat.import")}</button>
          <span className="dim small">{t("settings.compat.import.hint")}</span>
        </div>
      ) : (
        <div className="set-group" data-testid="import-preview">
          <div className="dim small">{t("settings.compat.import.preview")}</div>
          {p.warnings.length > 0 && <div className="small">{t("settings.compat.import.notImported", { count: p.warnings.length })}</div>}
          {p.files.map((f) => (
            <div key={f.target}>
              <div className="small"><code>{f.source}</code> → <code>{f.target}</code></div>
              <pre className="import-pre" data-testid="import-file">{f.content}</pre>
            </div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={write} data-testid="import-confirm">{t("settings.compat.import.write", { files: p.files.map((f) => f.target).join(", ") })}</button>
            <button className="btn" onClick={() => setOpen(false)} data-testid="import-cancel">{t("common.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
