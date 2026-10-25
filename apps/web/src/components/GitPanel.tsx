import { useState } from "react";
import { t } from "../i18n";
import { Floating } from "./Floating";
import { api, type PrCheck, type PrComment, type Workspace } from "../api";
import { IChevronDown, IPR } from "../icons";
import { usePopover } from "./useDismiss";
import { ACTION_LABEL, failing, primaryAction, type GitActionId, type GitState } from "./useGit";

const KBD = ({ k }: { k: string }) => (k ? <span className="kbd-hint">{k}</span> : null);

/** Ações disponíveis agora (o menu mostra todas; as indisponíveis ficam apagadas com o motivo). */
export function availability(g: GitState): Record<GitActionId, string | null> {
  const s = g.status, pr = g.pr;
  const open = pr && pr.state === "OPEN";
  return {
    commit: (s?.dirty ?? 0) > 0 ? null : t("code.why.nothingToCommit"),
    pull: s?.upstream ? (s.behind ? null : t("code.why.upToDate")) : t("code.why.noUpstream"),
    push: s?.upstream && !s.ahead ? t("code.why.nothingToPush") : null,
    "create-pr": open ? t("code.why.prExists") : null,
    "create-pr-agent": open ? t("code.why.prExists") : null,
    merge: open ? (pr!.is_draft ? t("code.why.prDraft") : pr!.mergeable === "CONFLICTING" ? t("code.why.conflicts") : null) : t("code.why.noOpenPr"),
    ready: open && pr!.is_draft ? null : t("code.why.notDraft"),
    fix: failing(g.checks).length ? null : t("code.why.noFailing"),
    conflicts: s?.conflicts.length || pr?.mergeable === "CONFLICTING" ? null : t("code.why.noConflicts"),
    "open-pr": pr ? null : t("code.why.noPr"),
    review: null,
    archive: null,
    comments: pr?.comments.length ? null : t("code.why.noComments"),
  };
}

const MENU: GitActionId[] = ["commit", "pull", "push", "create-pr", "create-pr-agent", "ready", "merge", "fix", "conflicts", "review", "comments", "open-pr", "archive"];

/** Botão dividido do git: a ação principal muda com o estado (criar PR, commit, pull, push, corrigir, ready, merge, arquivar). */
export function GitButton({ git, onAction, compact }: { git: GitState; onAction: (a: GitActionId) => void; compact?: boolean }) {
  const pop = usePopover();
  const main = primaryAction(git);
  const av = availability(git);
  const [label, key] = ACTION_LABEL[main];
  return (
    <div className="split-btn git-btn" ref={pop.ref}>
      <button className={"btn" + (main === "merge" || main === "archive" ? " primary" : "")} onClick={() => onAction(main)} disabled={git.busy !== null} title={key ? `${label} (${key})` : label} data-testid={main === "create-pr" ? "create-pr" : "git-primary"} data-action={main}>
        {git.busy ? <span className="spinner tiny" /> : <IPR size={14} />} {compact ? label.split(" ")[0] : label}
      </button>
      <button className="btn caret-btn" title={t("code.git.actions")} onClick={pop.toggle} data-testid="git-menu"><IChevronDown size={12} /></button>
      {pop.open && (
        <Floating className="status-pop git-pop" placement="bottom-end" testid="git-pop">
          {MENU.map((a) => (
            <div key={a} className={"pop-row" + (av[a] ? " disabled" : "")} title={av[a] ?? undefined} onClick={() => !av[a] && (pop.close(), onAction(a))} data-testid={`git-${a}`}>
              {ACTION_LABEL[a][0]}<span className="grow" /><KBD k={ACTION_LABEL[a][1]} />
            </div>
          ))}
        </Floating>
      )}
    </div>
  );
}

const PR_STATE = (): Record<string, [string, string]> => ({ OPEN: [t("code.pr.state.open"), "open"], MERGED: [t("code.pr.state.merged"), "merged"], CLOSED: [t("code.pr.state.closed"), "closed"] });

/** Selo do PR no cabeçalho: número, estado, checks e merge; o popover mostra os detalhes. */
export function PrPill({ git, onOpen }: { git: GitState; onOpen: () => void }) {
  const pop = usePopover<HTMLSpanElement>();
  const pr = git.pr;
  if (!pr) return null;
  const [st, cls] = pr.is_draft && pr.state === "OPEN" ? [t("code.pr.state.draft"), "draft"] : PR_STATE()[pr.state] ?? [pr.state, ""];
  const fail = failing(git.checks).length, pend = git.checks.filter((c) => c.bucket === "pending").length;
  const glyph = fail ? <span className="error">✕</span> : pend ? <span className="pending">●</span> : git.checks.length ? <span className="ok">✓</span> : null;
  return (
    <span className="picker" ref={pop.ref}>
      <button className={"pr-pill pr-" + cls} onClick={pop.toggle} title={t("code.pr.details")} data-testid="pr-pill">#{pr.number} {st} {glyph}</button>
      {pop.open && (
        <Floating className="status-pop pr-details" placement="bottom-start" testid="pr-details">
          <div className="pop-title">{pr.title}</div>
          <div className="row"><span className="dim">{t("code.pr.state")}</span><span className="grow" />{st}</div>
          <div className="row"><span className="dim">{t("code.pr.merge")}</span><span className="grow" />{mergeLabel(pr.mergeable, pr.merge_state)}</div>
          <div className="row"><span className="dim">{t("code.pr.review")}</span><span className="grow" />{reviewLabel(pr.review_decision)}</div>
          <div className="row"><span className="dim">{t("code.checks.title")}</span><span className="grow" />{git.checks.length ? t("code.checks.summary", { ok: git.checks.length - fail - pend, fail, pend }) : "—"}</div>
          <div className="row"><span className="dim">{t("code.pr.branches")}</span><span className="grow" /><code>{pr.head}</code> → <code>{pr.base}</code></div>
          <div className="pop-sep" />
          <div className="pop-row" onClick={() => (pop.close(), onOpen())}>{t("code.action.open-pr")} <span className="grow" /><KBD k="⌘⇧G" /></div>
        </Floating>
      )}
    </span>
  );
}

export const mergeLabel = (m: string, s: string) => (m === "CONFLICTING" ? t("code.merge.conflicts") : s === "CLEAN" ? t("code.merge.clean") : s === "BLOCKED" ? t("code.merge.blocked") : s === "BEHIND" ? t("code.merge.behind") : s === "DRAFT" ? t("code.pr.state.draft") : s === "UNSTABLE" ? t("code.merge.unstable") : "—");
export const reviewLabel = (d: string) => ({ APPROVED: t("code.reviewDecision.approved"), CHANGES_REQUESTED: t("code.reviewDecision.changes"), REVIEW_REQUIRED: t("code.reviewDecision.required") }[d] ?? "—");

// i18n-ignore: glifo e classe CSS
const ICON: Record<string, [string, string]> = { pass: ["✓", "ok"], fail: ["✕", "error"], pending: ["●", "pending"], skipping: ["–", "dim"], cancel: ["⊘", "dim"] };
const ORDER = ["fail", "pending", "pass", "skipping", "cancel"];

/** Aba Checks: status do git (linhas com ação), PR editável, checks com log embutido e re-run, comentários com "Adicionar ao chat". */
export function ChecksPanel({ ws, git, onAction, onToChat, onError }: { ws: Workspace; git: GitState; onAction: (a: GitActionId) => void; onToChat: (text: string) => void; onError: (e: string) => void }) {
  const s = git.status, pr = git.pr;
  const rows: { id: string; text: string; action?: [string, GitActionId] }[] = [];
  if (pr?.state === "MERGED") rows.push({ id: "merged", text: t("code.row.merged"), action: [t("code.action.archive"), "archive"] });
  if (pr?.state === "OPEN" && !pr.is_draft && pr.mergeable !== "CONFLICTING" && !failing(git.checks).length && !(s?.dirty)) rows.push({ id: "ready-to-merge", text: t("code.row.readyToMerge"), action: [t("code.action.merge"), "merge"] });
  if (!pr || pr.state === "CLOSED") rows.push({ id: "create-pr", text: t("code.row.noPr"), action: [t("code.action.create-pr"), "create-pr"] });
  if (pr?.is_draft && pr.state === "OPEN") rows.push({ id: "draft-pr", text: t("code.row.draft"), action: [t("code.action.ready"), "ready"] });
  if (s?.dirty) rows.push({ id: "uncommitted", text: t("code.row.uncommitted", { count: s.dirty }), action: [t("code.action.commit"), "commit"] });
  if (s?.behind) rows.push({ id: "behind", text: t("code.row.behind", { count: s.behind }), action: [t("code.action.pull"), "pull"] });
  if (s?.ahead) rows.push({ id: "ahead", text: t("code.row.ahead", { count: s.ahead }), action: [t("code.action.push"), "push"] });
  if (s?.conflicts.length || pr?.mergeable === "CONFLICTING") rows.push({ id: "conflicts", text: t("code.row.conflicts"), action: [t("code.row.resolve"), "conflicts"] });
  if (s?.behind_target) rows.push({ id: "behind-target", text: t("code.row.behindTarget", { count: s.behind_target, target: s.target }) });
  if (pr?.review_decision === "REVIEW_REQUIRED") rows.push({ id: "review-required", text: t("code.row.reviewRequired") });
  if (pr?.review_decision === "CHANGES_REQUESTED") rows.push({ id: "changes-requested", text: t("code.row.changesRequested"), action: [t("code.action.comments"), "comments"] });
  if (!s) return <div className="files-empty">{t("code.git.reading")}</div>;
  return (
    <div className="checks-panel" data-testid="checks">
      <div className="pop-title cp-title">{t("code.git.status")}</div>
      {rows.length === 0 && <div className="files-empty small">{t("code.git.allClear")}</div>}
      {rows.map((r) => (
        <div key={r.id} className="file-row git-row" data-testid={`gitrow-${r.id}`}>
          <span>{r.text}</span><span className="grow" />
          {r.action && <button className="text-btn small" disabled={git.busy !== null} onClick={() => onAction(r.action![1])}>{r.action[0]}</button>}
        </div>
      ))}
      {git.result && (
        <div className="pr-done" data-testid="git-result">
          <span>{git.result.label}{git.result.dry_run ? t("code.git.dryRun") : ""}: <code>{git.result.commands.join(" && ")}</code>{git.result.output ? <pre>{git.result.output.slice(-600)}</pre> : null}</span>
          <button className="icon-btn" onClick={() => git.setResult(null)}>×</button>
        </div>
      )}
      {pr && <PrCard ws={ws} git={git} onError={onError} />}
      {pr && <CheckList ws={ws} checks={git.checks} onToChat={onToChat} onError={onError} git={git} />}
      {pr && <Comments comments={pr.comments} onToChat={onToChat} />}
    </div>
  );
}

function PrCard({ ws, git, onError }: { ws: Workspace; git: GitState; onError: (e: string) => void }) {
  const pr = git.pr!;
  const [edit, setEdit] = useState<{ title: string; body: string } | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const r = await api.prEdit(ws.id, edit.title, edit.body);
      git.setResult({ ...r, label: t("code.pr.edited") });
      setEdit(null);
      git.refresh();
    } catch (e) {
      onError(String(e));
    }
  };
  return (
    <div className="pr-card" data-testid="pr-card">
      <div className="pop-title cp-title">{t("code.pr.card", { number: pr.number })}</div>
      {edit ? (
        <div className="pr-edit">
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} data-testid="pr-title-input" />
          <textarea rows={5} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} data-testid="pr-body-input" />
          <div className="row end"><button className="btn" onClick={() => setEdit(null)}>{t("common.cancel")}</button><button className="btn primary" onClick={save} data-testid="pr-save">{t("code.pr.saveGithub")}</button></div>
        </div>
      ) : (
        <div className="pr-view" onDoubleClick={() => setEdit({ title: pr.title, body: pr.body })}>
          <div className="pr-title-row"><b data-testid="pr-title">{pr.title}</b><span className="grow" /><button className="text-btn small" onClick={() => setEdit({ title: pr.title, body: pr.body })} data-testid="pr-edit">{t("common.edit")}</button></div>
          {pr.body && <div className="pr-body dim small">{pr.body.slice(0, 600)}</div>}
          <div className="pr-meta small"><span className="badge">{mergeLabel(pr.mergeable, pr.merge_state)}</span><span className="badge">{reviewLabel(pr.review_decision)}</span></div>
        </div>
      )}
    </div>
  );
}

function CheckList({ ws, checks, git, onToChat, onError }: { ws: Workspace; checks: PrCheck[]; git: GitState; onToChat: (text: string) => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const count = (b: string) => checks.filter((c) => c.bucket === b).length;
  const sorted = [...checks].sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket));
  const toggle = (c: PrCheck) => {
    const k = c.workflow + c.name;
    setOpen(open === k ? null : k);
    if (open !== k && !logs[k]) api.checkLog(ws.id, c.link).then((l) => setLogs((x) => ({ ...x, [k]: l })), (e) => setLogs((x) => ({ ...x, [k]: String(e) })));
  };
  const rerun = async () => {
    try {
      const r = await api.checksRerun(ws.id, checks.filter((c) => c.bucket === "fail").map((c) => c.link));
      git.setResult({ ...r, label: t("code.checks.rerunLabel") });
    } catch (e) {
      onError(String(e));
    }
  };
  return (
    <div className="check-list">
      <div className="cp-title row"><span className="pop-title">{t("code.checks.title")}</span><span className="dim small">{t("code.checks.summary", { ok: count("pass"), fail: count("fail"), pend: count("pending") })}</span><span className="grow" />
        {count("fail") > 0 && <button className="text-btn small" onClick={rerun} data-testid="checks-rerun">{t("code.checks.rerun")}</button>}</div>
      {checks.length === 0 && <div className="files-empty small">{t("code.checks.none")}</div>}
      {sorted.map((c) => {
        const k = c.workflow + c.name;
        const [g, cls] = ICON[c.bucket] ?? ["?", "dim"];
        return (
          <div key={k}>
            <div className="file-row" title={c.description || c.state} onClick={() => toggle(c)} data-testid="check-row">
              <span className={"check-glyph " + cls}>{g}</span>
              <span className="fpath">{c.workflow ? <span className="dim">{c.workflow} / </span> : null}{c.name}{(c as PrCheck & { required?: boolean }).required === false && <span className="dim small">{t("code.checks.optional")}</span>}</span>
              <span className="grow" /><span className="dim small">{open === k ? "▾" : "▸"} {t("code.checks.log")}</span>
            </div>
            {open === k && (
              <div className="check-log" data-testid="check-log">
                <pre>{logs[k] ?? t("code.checks.loadingLog")}</pre>
                <div className="row">
                  {logs[k] && <button className="text-btn small" onClick={() => onToChat(`${t("code.checks.failedLog", { name: c.name })}\n\n\`\`\`\n${logs[k].slice(-3000)}\n\`\`\``)} data-testid="log-to-chat">{t("code.checks.logToChat")}</button>}
                  <span className="grow" />{c.link && <button className="text-btn small" onClick={() => api.openExternal(c.link)}>{t("code.openGithub")}</button>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const commentText = (c: PrComment) => `- ${c.author}${c.path ? t("code.comment.at", { path: `${c.path}${c.line ? `:${c.line}` : ""}` }) : ""}${c.state ? ` (${c.state === "CHANGES_REQUESTED" ? t("code.comment.changes") : c.state.toLowerCase()})` : ""}: ${c.body.trim()}`;

function Comments({ comments, onToChat }: { comments: PrComment[]; onToChat: (text: string) => void }) {
  if (!comments.length) return null;
  return (
    <div className="pr-comments">
      <div className="cp-title row"><span className="pop-title">{t("code.comment.title", { count: comments.length })}</span><span className="grow" />
        <button className="text-btn small" onClick={() => onToChat(t("code.comment.replyAll") + "\n" + comments.map(commentText).join("\n"))} data-testid="comments-all">{t("code.comment.addAll")}</button></div>
      {comments.map((c, i) => (
        <div key={i} className="pr-comment" data-testid="pr-comment">
          <div className="row small"><b>{c.author}</b>{c.path && <code>{c.path}{c.line ? `:${c.line}` : ""}</code>}{c.state && <span className="badge">{c.state === "CHANGES_REQUESTED" ? t("code.comment.changes") : c.state.toLowerCase()}</span>}<span className="grow" />
            <button className="text-btn small" onClick={() => onToChat(t("code.comment.one") + "\n" + commentText(c))} data-testid="comment-to-chat">{t("code.comment.addOne")}</button></div>
          <div className="small">{c.body}</div>
        </div>
      ))}
    </div>
  );
}
