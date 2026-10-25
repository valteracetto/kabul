import { useEffect, useState } from "react";
import { api } from "../api";
import { noSuggest } from "../noSuggest";

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
    if (c.restarts > MAX_RESTARTS) c.done = "O tempo para colar o código acabou. Tente de novo.";
  } else if ("Url" in ev) (c.url = ev.Url), (c.urlAt = Date.now());
  else if ("Codigo" in ev) c.code = ev.Codigo;
  else if ("Erro" in ev) (c.done = ev.Erro), (c.sent = false);
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
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [timeout, f.done]);
  const left = timeout && f.urlAt ? Math.max(0, Math.ceil(timeout - (now - f.urlAt) / 1000)) : null;
  const showCode = !f.done && (f.ask || (codeNow && !f.code));
  return (
    <div className="flow" data-testid={testid ?? "login-flow"}>
      {f.code && <div>Código: <code className="big-code">{f.code}</code></div>}
      {!f.url && !f.done && <div className="dim" data-testid="login-wait">{f.restarts ? "O link expirou; gerando um novo…" : "Iniciando o CLI…"}</div>}
      {f.url && !f.done && (
        <div className="row login-link">
          <button className="btn" onClick={() => api.openExternal(f.url!)} data-testid="login-open">Abrir no navegador</button>
          <a className="url small" onClick={() => api.openExternal(f.url!)} title={f.url}>{f.url.length > 80 ? f.url.slice(0, 80) + "…" : f.url}</a>
        </div>
      )}
      {showCode && (
        <div className="row">
          <input {...noSuggest} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="Cole o código aqui" value={f.input ?? ""}
            onChange={(e) => onInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && f.url && (f.input ?? "").trim() && onSend()} data-testid="login-code" />
          <button className="btn primary" disabled={!f.url || !(f.input ?? "").trim()} onClick={onSend} data-testid="login-send">Enviar</button>
          {left != null && <span className={"dim small mono" + (left <= 10 ? " warn" : "")} data-testid="login-countdown">{left > 0 ? `expira em ${left} s` : "gerando link novo…"}</span>}
        </div>
      )}
      {f.sent && !f.done && <div className="dim small">Verificando o código…</div>}
      {f.done && <div className={f.done === "ok" ? "ok" : "error"} data-testid="login-result">{f.done === "ok" ? "Login concluído." : f.done}</div>}
      <div className="row">
        {f.done && f.done !== "ok" && onRetry && <button className="btn" onClick={onRetry} data-testid="login-retry">Tentar de novo</button>}
        <button className="text-btn small" onClick={onCancel}>{f.done ? "Fechar" : "Cancelar"}</button>
      </div>
    </div>
  );
}
