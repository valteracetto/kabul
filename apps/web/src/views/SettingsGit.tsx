import { useEffect, useState } from "react";
import { api, type AppSettings, type GitIdentity, type Repo, type RepoSettingsT } from "../api";
import { noSuggest } from "../noSuggest";
import { Row, Toggle, useAppSettings } from "./settingsUi";

/** Configurações › Git: opções do usuário e, por repositório, base, remote, alvo, sobrescritas e identidade. */
export function GitSettings({ repos, onError }: { repos: Repo[]; onError: (e: string) => void }) {
  const [scope, setScope] = useState<string>("user");
  return (
    <div className="set-group" data-testid="git-settings">
      <div className="scope-seg" data-testid="git-scope">
        <button className={"rtab" + (scope === "user" ? " on" : "")} onClick={() => setScope("user")}>Usuário</button>
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
      <Row label="Prefixo da branch" hint={s.branch_prefix_type === "none" ? "Branches novas sem prefixo (só o nome)" : "Workspaces nascem em <prefixo>/<nome>"}>
        <div className="row">
          <select value={s.branch_prefix_type} onChange={(e) => set({ branch_prefix_type: e.target.value })} data-testid="git-prefix">
            <option value="github">Usuário do GitHub (padrão)</option><option value="user">Usuário deste computador</option><option value="custom">Personalizado</option><option value="none">Nenhum</option>
          </select>
          {s.branch_prefix_type === "custom" && <input {...noSuggest} autoComplete="off" defaultValue={s.branch_prefix_custom} onBlur={(e) => set({ branch_prefix_custom: e.target.value })} placeholder="feature/" data-testid="git-prefix-custom" />}
        </div>
      </Row>
      <Toggle s={s} save={save} k="auto_rename_branch" label="Renomear branches novas automaticamente" hint="Pela primeira mensagem, enquanto a branch tiver o nome gerado" />
      <Toggle s={s} save={save} k="rename_ws_on_branch" label="Renomear o workspace quando a branch ganhar nome" hint="O título do workspace acompanha a branch (se você não deu um título)" />
      <Toggle s={s} save={save} k="delete_branch_on_archive" label="Apagar a branch ao arquivar" hint="A branch local é apagada. Sem push, os commits só voltam ao desarquivar (pelo checkpoint); depois de limpar os checkpoints, não há como recuperar." danger />
      <Toggle s={s} save={save} k="archive_on_merge" label="Arquivar ao fazer merge" hint="Depois do merge do PR pelo Kabul, o workspace é arquivado" />
      <Row label="Método de merge" hint="Usado pelo botão Merge e pelo auto-merge">
        <select value={s.merge_method ?? "squash"} onChange={(e) => set({ merge_method: e.target.value })} data-testid="git-merge-method"><option value="squash">Squash</option><option value="merge">Merge commit</option><option value="rebase">Rebase</option></select>
      </Row>
      <Toggle s={s} save={save} k="automerge" label="Automerge" hint="Liga o auto-merge do GitHub ao criar o PR (gh pr merge --auto)" />
      <Toggle s={s} save={save} k="optional_checks_blocking" label="Tratar checks opcionais como bloqueantes" hint="Sem isso, só checks obrigatórios que falham pedem “Corrigir erros” antes do merge" />
      <Toggle s={s} save={save} k="push_set_upstream" label="Gravar o upstream no push" hint="git push -u <remote> HEAD" />
      <Toggle s={s} save={save} k="stacked_prs" label="Usar PRs empilhados" hint="O formulário de PR aceita empilhar sobre outro PR (a base vira a branch dele)" />
      <Row label="Abrir PRs em" hint="Destino de “Abrir PR” (⌘⇧G)">
        <select value={s.open_prs_in ?? "github"} onChange={(e) => set({ open_prs_in: e.target.value })} data-testid="git-open-in"><option value="github">GitHub</option><option value="linear">Linear (issue ligada)</option><option value="graphite">Graphite</option></select>
      </Row>
      <Toggle s={s} save={save} k="pr_include_workspace_link" label="Incluir o link do workspace na descrição do PR" hint="Acrescenta “Criado no Kabul” com o link kabul://" />
      <Toggle s={s} save={save} k="github_dry_run" label="Simular ações do GitHub" hint="Push, merge, ready e re-run só mostram os comandos (para testar sem enviar nada)" />
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
      <div className="dim small">Salvo em <code>.kabul/settings.local.toml</code> deste repositório; vale só para ele. {saved && <span className="ok">salvo</span>}</div>
      <Row label="Branch base dos workspaces novos" hint={`Padrão: ${repo.default_branch}`}>
        <select value={s.base_branch ?? ""} onChange={(e) => save({ base_branch: e.target.value || null })} data-testid="git-base">
          <option value="">{repo.default_branch} (padrão)</option>
          {local.filter((b) => b !== repo.default_branch).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Row>
      <Row label="Remote" hint="Base, alvo, push e PR usam este remote">
        <select value={s.remote ?? ""} onChange={(e) => save({ remote: e.target.value || null })} data-testid="git-remote">
          <option value="">origin (padrão)</option>
          {remotes.filter((r) => r !== "origin").map((r) => <option key={r} value={r}>{r}</option>)}
          {remotes.length === 0 && <option disabled>Nenhum remote encontrado</option>}
        </select>
      </Row>
      <Row label="Branch alvo (PR e diff)" hint={`Padrão: ${repo.default_branch}`}>
        <select value={s.target_branch ?? ""} onChange={(e) => save({ target_branch: e.target.value || null })} data-testid="git-target">
          <option value="">{repo.default_branch} (padrão)</option>
          {local.filter((b) => b !== repo.default_branch).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </Row>
      <Row label="Apagar a branch ao arquivar" hint="Sobrescreve a opção do usuário neste repositório">
        <select value={tri(s.delete_branch_on_archive)} onChange={(e) => save({ delete_branch_on_archive: fromTri(e.target.value) })} data-testid="git-repo-delete"><option value="">Herdar do usuário</option><option value="1">Sim</option><option value="0">Não</option></select>
      </Row>
      <Row label="Arquivar ao fazer merge" hint="Sobrescreve a opção do usuário neste repositório">
        <select value={tri(s.archive_on_merge)} onChange={(e) => save({ archive_on_merge: fromTri(e.target.value) })} data-testid="git-repo-archive"><option value="">Herdar do usuário</option><option value="1">Sim</option><option value="0">Não</option></select>
      </Row>
      <h3>Identidade do git</h3>
      {id && (
        <div className="git-identity" data-testid="git-identity">
          <div className="dim small">{id.scope === "repo" ? "Definida neste repositório (vale para todos os workspaces dele)." : `Usando a identidade global${id.global_name ? ` (${id.global_name} <${id.global_email}>)` : ""}.`}</div>
          <div className="row env-row">
            <input {...noSuggest} autoComplete="off" defaultValue={id.scope === "repo" ? id.name : ""} placeholder={id.global_name || "Nome"} id="git-id-name" data-testid="git-id-name" />
            <input {...noSuggest} autoComplete="off" defaultValue={id.scope === "repo" ? id.email : ""} placeholder={id.global_email || "e-mail"} id="git-id-email" data-testid="git-id-email" />
            <button className="btn" onClick={() => api.gitIdentitySet(repo.id, (document.getElementById("git-id-name") as HTMLInputElement).value, (document.getElementById("git-id-email") as HTMLInputElement).value).then(setId, (e) => onError(String(e)))} data-testid="git-id-save">Salvar</button>
          </div>
        </div>
      )}
    </>
  );
}
