import { useEffect, useState } from "react";
import { api } from "../api";
import { noSuggest } from "../noSuggest";
import { t } from "../i18n";
import { tNode } from "../i18n/react";
import { trError } from "../i18n/errors";

/** Eventos do login pelo CLI (core `auth::AuthEvent`). */
export type LoginEvent = { Url: string } | { Codigo: string } | "PedeCodigo" | "Ok" | { Erro: string } | "Expirou";

export interface LoginState {
  url?: string;
  /** Código de dispositivo para digitar no navegador (gh). */
  code?: string;
  ask?: boolean;
  done?: string;
  input?: string;
  sent?: boolean;
  urlAt?: number;
  restarts?: number;
}

/** Quantas vezes o fluxo recomeça sozinho quando o CLI desiste de esperar (60 s cada no agy). */
export const MAX_RESTARTS = 10;

export function reduceLogin(f: LoginState | undefined, ev: LoginEvent): LoginState {
  const c: LoginState = { ...(f ?? {}) };
  if (ev === "Ok") c.done = "ok";
  else if (ev === "PedeCodigo") c.ask = true;
  else if (ev === "Expirou") {
    // Link novo a caminho; o campo do código (e o que já foi digitado) continua.
    c.url = undefined;
    c.urlAt = undefined;
    c.sent = false;
    c.restarts = (c.restarts ?? 0) + 1;
    if (c.restarts > MAX_RESTARTS) c.done = t("settings.login.timedOut");
  } else if ("Url" in ev) (c.url = ev.Url), (c.urlAt = Date.now());
  else if ("Codigo" in ev) c.code = ev.Codigo;
  else if ("Erro" in ev) (c.done = ev.Erro), (c.sent = false); // i18n-ignore: nome do evento do backend
  return c;
}

/** Link para abrir no navegador, campo "Cole o código aqui" e, com `timeout`, a contagem regressiva. */
export function LoginFlow({ f, codeNow, timeout, onInput, onSend, onCancel, onRetry, testid }: {
  f: LoginState;
  /** Mostra o campo do código desde o início (agy pede o código assim que mostra o link). */
  codeNow?: boolean;
  /** Segundos que o CLI espera pelo código (agy: 60). */
  timeout?: number;
  onInput: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onRetry?: () => void;
  testid?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!timeout || f.done) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [timeout, f.done]);
  const left = timeout && f.urlAt ? Math.max(0, Math.ceil(timeout - (now - f.urlAt) / 1000)) : null;
  const showCode = !f.done && (f.ask || (codeNow && !f.code));
  return (
    <div className="flow" data-testid={testid ?? "login-flow"}>
      {f.code && <div>{tNode("settings.login.code", { code: <code className="big-code">{f.code}</code> })}</div>}
      {!f.url && !f.done && <div className="dim" data-testid="login-wait">{f.restarts ? t("settings.login.expired") : t("settings.login.starting")}</div>}
      {f.url && !f.done && (
        <div className="row login-link">
          <button className="btn" onClick={() => api.openExternal(f.url!)} data-testid="login-open">{t("settings.login.openBrowser")}</button>
          <a className="url small" onClick={() => api.openExternal(f.url!)} title={f.url}>{f.url.length > 80 ? f.url.slice(0, 80) + "…" : f.url}</a>
        </div>
      )}
      {showCode && (
        <div className="row">
          <input {...noSuggest} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder={t("settings.login.paste")} value={f.input ?? ""}
            onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && f.url && (f.input ?? "").trim() && onSend()} data-testid="login-code" />
          <button className="btn primary" disabled={!f.url || !(f.input ?? "").trim()} onClick={onSend} data-testid="login-send">{t("common.send")}</button>
          {left != null && <span className={"dim small mono" + (left <= 10 ? " warn" : "")} data-testid="login-countdown">{left > 0 ? t("settings.login.expiresIn", { n: left }) : t("settings.login.newLink")}</span>}
        </div>
      )}
      {f.sent && !f.done && <div className="dim small">{t("settings.login.checking")}</div>}
      {f.done && <div className={f.done === "ok" ? "ok" : "error"} data-testid="login-result">{f.done === "ok" ? t("settings.login.done") : trError(f.done)}</div>}
      <div className="row">
        {f.done && f.done !== "ok" && onRetry && <button className="btn" onClick={onRetry} data-testid="login-retry">{t("common.retry")}</button>}
        <button className="text-btn small" onClick={onCancel}>{f.done ? t("common.close") : t("common.cancel")}</button>
      </div>
    </div>
  );
}
