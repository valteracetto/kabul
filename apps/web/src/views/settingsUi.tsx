import { useEffect, useState, type ReactNode } from "react";
import { api, type AppSettings } from "../api";

/** Configurações do app (core), com gravação a cada mudança. */
export function useAppSettings(onError: (e: string) => void): [AppSettings | null, (s: AppSettings) => void] {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => void api.appSettings().then(setS, (e) => onError(String(e))), [onError]);
  const save = (n: AppSettings) => {
    setS(n);
    api.saveAppSettings(n).then(() => window.dispatchEvent(new Event("kabul:settings")), (e) => onError(String(e)));
  };
  return [s, save];
}

/** Linha de configuração: rótulo, dica e o controle à direita. */
export function Row({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <div className="set-row" data-setting={id ?? label}>
      <div><div>{label}</div>{hint && <div className="dim small">{hint}</div>}</div>
      {children}
    </div>
  );
}

type BoolKeys = { [K in keyof AppSettings]-?: AppSettings[K] extends boolean | undefined ? K : never }[keyof AppSettings];

export function Toggle({ s, save, k, label, hint, danger, id }: { s: AppSettings; save: (s: AppSettings) => void; k: BoolKeys; label: string; hint?: string; danger?: boolean; id?: string }) {
  const on = !!s[k];
  return (
    <Row label={label} hint={hint} id={id}>
      <span className={"toggle" + (on ? " on" : "") + (danger ? " danger" : "")} role="switch" aria-checked={on} aria-label={label} tabIndex={0}
        onClick={() => save({ ...s, [k]: !on })} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), save({ ...s, [k]: !on }))} data-testid={`toggle-${k}`}><span /></span>
    </Row>
  );
}

/** Preferência guardada no aparelho (aparência, atalhos de tela). */
export function useLocalPref<T extends string>(key: string, def: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => (localStorage.getItem(key) as T) ?? def);
  return [v, (n: T) => (localStorage.setItem(key, n), setV(n), window.dispatchEvent(new Event("kabul:prefs")))];
}
