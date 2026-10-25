import { useEffect, useState } from "react";
import { tNode } from "../i18n/react";
import { t } from "../i18n";
import { api, type AppSettings, type GitIdentity, type Repo, type RepoSettingsT } from "../api";
import { noSuggest } from "../noSuggest";
import { Row, Toggle, useAppSettings } from "./settingsUi";

/** Configurações › Git: opções do usuário e, por repositório, base, remote, alvo, sobrescritas e identidade. */
export function GitSettings({ repos, onError }: { repos: Repo[]; onError: (e: string) => void }) {
  const [scope, setScope] = useState<string>("user");
  return (
    <div className="set-group" data-testid="git-settings">
      <div className="scope-seg" data-testid="git-scope">
        <button className={"rtab" + (scope === "user" ? " on" : "")} onClick={() => setScope("user")}>{t("code.gs.user")}</button>
        {repos.map((r) => <button key={r.id} className={"rtab" + (scope === r.id ? " on" : "")} onClick={() => setScope(r.id)}>{r.name}</button>)}
      </div>
      {scope === "user" ? <UserGit onError={onError} /> : <RepoGit key={scope} repo={repos.find((r) => r.id === scope)!} onError={onError} />}
    </div>
  );
}

function UserGit({ onError }: { onError: (e: string) => void }) {
  const [s, save] = useAppSettings(onError);
  if (!s) return null;
  const set = (p: Partial<AppSettings>) => save({ ...s, ...p });
  return (
    <>
      <Row label={t("code.gs.prefix")} hint={s.branch_prefix_type === "none" ? t("code.gs.prefix.hintNone") : t("code.gs.prefix.hint")}>
        <div className="row">
          <select value={s.branch_prefix_type} onChange={(e) => set({ branch_prefix_type: e.target.value })} data-testid="git-prefix">
            <option value="github">{t("code.gs.prefix.github")}</option><option value="user">{t("code.gs.prefix.user")}</option><option value="custom">{t("code.gs.prefix.custom")}</option><option value="none">{t("common.none")}</option>
          </select>
          {s.branch_prefix_type === "custom" && <input {...noSuggest} autoComplete="off" defaultValue={s.branch_prefix_custom} onBlur={(e) => set({ branch_prefix_custom: e.target.value })} placeholder="feature/" data-testid="git-prefix-custom" />}
        </div>
      </Row>
      <Toggle s={s} save={save} k="auto_rename_branch" label={t("code.gs.autoRename")} hint={t("code.gs.autoRename.hint")} />
      <Toggle s={s} save={save} k="rename_ws_on_branch" label={t("code.gs.renameWs")} hint={t("code.gs.renameWs.hint")} />
      <Toggle s={s} save={save} k="delete_branch_on_archive" label={t("code.gs.deleteBranch")} hint={t("code.gs.deleteBranch.hint")} danger />
      <Toggle s={s} save={save} k="archive_on_merge" label={t("code.gs.archiveOnMerge")} hint={t("code.gs.archiveOnMerge.hint")} />
      <Row label={t("code.gs.mergeMethod")} hint={t("code.gs.mergeMethod.hint")}>
        <select value={s.merge_method ?? "squash"} onChange={(e) => set({ merge_method: e.target.value })} data-testid="git-merge-method"><option value="squash">{t("code.gs.merge.squash")}</option><option value="merge">{t("code.gs.merge.merge")}</option><option value="rebase">{t("code.gs.merge.rebase")}</option></select>
      </Row>
      <Toggle s={s} save={save} k="automerge" label={t("code.gs.automerge")} hint={t("code.gs.automerge.hint")} />
      <Toggle s={s} save={save} k="optional_checks_blocking" label={t("code.gs.optionalBlocking")} hint={t("code.gs.optionalBlocking.hint")} />
      <Toggle s={s} save={save} k="push_set_upstream" label={t("code.gs.setUpstream")} hint={t("code.gs.setUpstream.hint")} />
      <Toggle s={s} save={save} k="stacked_prs" label={t("code.gs.stacked")} hint={t("code.gs.stacked.hint")} />
      <Row label={t("code.gs.openPrsIn")} hint={t("code.gs.openPrsIn.hint")}>
        <select value={s.open_prs_in ?? "github"} onChange={(e) => set({ open_prs_in: e.target.value })} data-testid="git-open-in"><option value="github">GitHub</option><option value="linear">{t("code.gs.openPrsIn.linear")}</option><option value="graphite">{"Graphite" /* i18n-ignore: marca */}</option></select>
      </Row>
      <Toggle s={s} save={save} k="pr_include_workspace_link" label={t("code.gs.wsLink")} hint={t("code.gs.wsLink.hint")} />
      <Toggle s={s} save={save} k="github_dry_run" label={t("code.gs.dryRun")} hint={t("code.gs.dryRun.hint")} />
    </>
  );
}

const tri = (v: boolean | null | undefined) => (v == null ? "" : v ? "1" : "0");
const fromTri = (v: string) => (v === "" ? null : v === "1");

function RepoGit({ repo, onError }: { repo: Repo; onError: (e: string) => void }) {
  const [s, setS] = useState<RepoSettingsT | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [id, setId] = useState<GitIdentity | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.repoSettings(repo.id).then((r) => setS(r.settings), (e) => onError(String(e)));
    api.repoBranches(repo.id).then((b) => setBranches(b.filter((x) => !x.includes("HEAD"))), () => {});
    api.repoRemotes(repo.id).then(setRemotes, () => {});
    api.gitIdentity(repo.id).then(setId, () => {});
  }, [repo.id, onError]);
  if (!s) return null;
  const save = (p: Partial<RepoSettingsT>) => {
    const n = { ...s, ...p };
    setS(n);
    api.saveRepoSettings(repo.id, n).then(() => (setSaved(true), setTimeout(() => setSaved(false), 1200)), (e) => onError(String(e)));
  };
  const local = branches.filter((b) => !b.includes("/") || !remotes.some((r) => b.startsWith(r + "/")));
  return (
    <>
      <div className="dim small">{tNode("code.gs.savedIn", { file: <code>.kabul/settings.local.toml</code> })} {saved && <span className="ok">{t("code.gs.saved")}</span>}</div>
      <Row label={t("code.gs.base")} hint={t("code.gs.defaultIs", { branch: repo.default_branch })}>
        <select value={s.base_branch ?? ""} onChange={(e) => save({ base_branch: e.target.value || null })} data-testid="git-base">
          <option value="">{t("code.gs.defaultOpt", { name: repo.default_branch })}</option>
          {local.filter((b) => b !== repo.default_branch).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Row>
      <Row label={t("code.gs.remote")} hint={t("code.gs.remote.hint")}>
        <select value={s.remote ?? ""} onChange={(e) => save({ remote: e.target.value || null })} data-testid="git-remote">
          <option value="">{t("code.gs.defaultOpt", { name: "origin" })}</option>
          {remotes.filter((r) => r !== "origin").map((r) => <option key={r} value={r}>{r}</option>)}
          {remotes.length === 0 && <option disabled>{t("code.gs.noRemote")}</option>}
        </select>
      </Row>
      <Row label={t("code.gs.target")} hint={t("code.gs.defaultIs", { branch: repo.default_branch })}>
        <select value={s.target_branch ?? ""} onChange={(e) => save({ target_branch: e.target.value || null })} data-testid="git-target">
          <option value="">{t("code.gs.defaultOpt", { name: repo.default_branch })}</option>
          {local.filter((b) => b !== repo.default_branch).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Row>
      <Row label={t("code.gs.deleteBranch")} hint={t("code.gs.overrides")}>
        <select value={tri(s.delete_branch_on_archive)} onChange={(e) => save({ delete_branch_on_archive: fromTri(e.target.value) })} data-testid="git-repo-delete"><option value="">{t("code.gs.inherit")}</option><option value="1">{t("common.yes")}</option><option value="0">{t("common.no")}</option></select>
      </Row>
      <Row label={t("code.gs.archiveOnMerge")} hint={t("code.gs.overrides")}>
        <select value={tri(s.archive_on_merge)} onChange={(e) => save({ archive_on_merge: fromTri(e.target.value) })} data-testid="git-repo-archive"><option value="">{t("code.gs.inherit")}</option><option value="1">{t("common.yes")}</option><option value="0">{t("common.no")}</option></select>
      </Row>
      <h3>{t("code.gs.identity")}</h3>
      {id && (
        <div className="git-identity" data-testid="git-identity">
          <div className="dim small">{id.scope === "repo" ? t("code.gs.identity.repo") : id.global_name ? t("code.gs.identity.globalNamed", { who: `${id.global_name} <${id.global_email}>` }) : t("code.gs.identity.global")}</div>
          <div className="row env-row">
            <input {...noSuggest} autoComplete="off" defaultValue={id.scope === "repo" ? id.name : ""} placeholder={id.global_name || t("code.gs.identity.name")} id="git-id-name" data-testid="git-id-name" />
            <input {...noSuggest} autoComplete="off" defaultValue={id.scope === "repo" ? id.email : ""} placeholder={id.global_email || t("code.gs.identity.email")} id="git-id-email" data-testid="git-id-email" />
            <button className="btn" onClick={() => api.gitIdentitySet(repo.id, (document.getElementById("git-id-name") as HTMLInputElement).value, (document.getElementById("git-id-email") as HTMLInputElement).value).then(setId, (e) => onError(String(e)))} data-testid="git-id-save">{t("common.save")}</button>
          </div>
        </div>
      )}
    </>
  );
}
