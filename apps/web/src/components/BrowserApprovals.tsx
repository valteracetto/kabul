import { useEffect, useRef, useState } from "react";
import { api, wsTitle, type BrowserApproval, type Workspace } from "../api";
import { visibleBrowser } from "./browser";
import { t } from "../i18n";

/**
 * Pedidos de aprovação do navegador do Kabul (agente quer abrir um site fora de localhost ou rodar
 * JavaScript na página), de qualquer workspace, mesmo com a aba Browser fechada. Sem resposta em 2 min
 * o agente recebe "negado". A aba Browser visível mostra os do workspace dela (aqui não repete).
 */
export function BrowserApprovals({ workspaces, onOpen }: { workspaces: Workspace[]; onOpen: (ws: string) => void }) {
  const [list, setList] = useState<BrowserApproval[]>([]);
  const dead = useRef(false);
  useEffect(() => {
    const load = () => {
      if (dead.current || document.hidden) return;
      api.browserPending().then(setList, () => {
        // Backend sem o navegador (versão antiga, convidado): para de perguntar.
        dead.current = true;
      });
    };
    load();
    const iv = setInterval(load, 1500);
    return () => clearInterval(iv);
  }, []);
  const show = list.filter((a) => a.workspaceId && !visibleBrowser.has(a.workspaceId));
  if (!show.length) return null;
  const a = show[0];
  const ws = workspaces.find((w) => w.id === a.workspaceId);
  const decide = (allow: boolean, always = false) => {
    setList((l) => l.filter((x) => x.id !== a.id));
    api.browserApprove(a.workspaceId!, a.id, allow, always).catch(() => {});
  };
  return (
    <div className="update-banner browser-banner" role="alert" data-testid="browser-approval-banner">
      <span>
        <b>{ws ? wsTitle(ws) : a.workspaceId}</b> · {a.kind === "navigate" ? t("code.browser.askNavigate", { agent: a.agent, url: a.detail }) : t("code.browser.askEvaluate", { agent: a.agent })}
        {show.length > 1 && <span className="dim"> · {t("code.browser.moreApprovals", { count: show.length - 1 })}</span>}
      </span>
      <button className="btn small primary" onClick={() => decide(true)} data-testid="browser-banner-allow">{t("code.browser.allow")}</button>
      {a.kind === "navigate" && <button className="btn small" onClick={() => decide(true, true)}>{t("code.browser.always")}</button>}
      <button className="btn small" onClick={() => decide(false)} data-testid="browser-banner-deny">{t("code.browser.deny")}</button>
      {a.workspaceId && <button className="btn small" onClick={() => onOpen(a.workspaceId!)} data-testid="browser-banner-open">{t("code.browser.see")}</button>}
    </div>
  );
}
