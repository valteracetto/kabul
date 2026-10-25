import { lastNotify } from "./components/links";
import { transport } from "./transport";
import { t, lazyRecord } from "./i18n";
import { fmtNum } from "./i18n/format";

export type HarnessKind = "claude" | "codex" | "antigravity" | "opencode" | "qwen" | "gemini" | "goose" | "cursor";
export type Api = "openai" | "anthropic" | "gemini";

export interface Repo { id: string; name: string; path: string; default_branch: string; hidden?: boolean; icon?: string | null }
export interface Workspace {
  id: string; repo_id: string; name: string; branch: string; path: string; archived: boolean; created_at: number;
  title: string | null; status: string; state: string; pinned: boolean; notes: string; port: number;
  target_branch: string | null; pr_url: string | null; archive_checkpoint: string | null; user_set_branch: boolean; files_copied: number; linear?: LinearLink | null;
  unread?: boolean; section?: string | null; pin_order?: number | null;
}
export interface Section { id: string; name: string; emoji: string; order: number }
export interface GitStatus { branch: string; target: string; upstream: string | null; dirty: number; ahead: number; behind: number; behind_target: number; conflicts: string[] }
export interface Outcome { ok: boolean; dry_run: boolean; commands: string[]; output: string }
export interface PrComment { author: string; body: string; url: string | null; path: string | null; line: number | null; kind: "comment" | "review" | "inline"; state: string | null }
export interface PrInfo { number: number; title: string; body: string; url: string; state: string; is_draft: boolean; mergeable: string; merge_state: string; review_decision: string; head: string; base: string; comments: PrComment[] }
export interface MachineInfo { name: string; user: { login: string; email: string | null; avatar: string | null } | null }
export interface GitIdentity { name: string; email: string; scope: "repo" | "global"; global_name: string; global_email: string }
export interface Diagnostics { checks: { group: string; name: string; ok: boolean; detail: string }[]; report: string; redacted: string }
export interface GhRepo { name_with_owner: string; owner: string; private: boolean; updated_at: string; url: string; description: string | null; avatar: string }
export interface GrepHit { path: string; line: number; text: string }
export type DiffScope = "all" | "branch" | "uncommitted";
export interface Prompts { general: string | null; review: string | null; create_pr: string | null; fix_errors: string | null; resolve_conflicts: string | null; branch_rename: string | null }
export interface Pane { session: string; window_index: number; pane_index: number; pane_id: string; pid: number; command: string; path: string; active: boolean; title: string }
export interface TmuxSession extends Pane { agent: string }
export interface ImportedSession { id: string; workspace_id: string | null; status: string | null; title: string | null; model: string | null; agent_type: string | null; updated_at: string | null }
export interface ImportedWorkspace { id: string; repo_name: string | null; directory_name: string | null; branch: string | null; state: string | null; path: string | null }
export interface Sessions { tmux: TmuxSession[]; imported_workspaces: ImportedWorkspace[]; imported_sessions: ImportedSession[]; imported_error: string | null }
export interface AuthStatus { kind: HarnessKind; logged_in: boolean; source: string; method: string | null; error: string | null; installed: boolean }
export interface LocalRef { source: string; source_name: string; model: string; family: string; note: string; missing: HarnessKind[]; size_bytes: number | null; quant: string | null; fits: boolean | null }
export interface Model { key: string; harness: HarnessKind; id: string; label: string; provider: string; efforts: string[]; effort_in_id: boolean; local: LocalRef | null; context: number | null }
export interface FileChange { path: string; added: number | null; removed: number | null; untracked: boolean }
export interface Diff { base: string; base_ref: string; stat: string; patch: string }
export interface DiffComment { id: string; workspace_id: string; path: string; line: number; end_line: number | null; body: string; resolved: boolean; created_at: number }
export interface Checkpoint { id: string; commit: string; head: string; message: string; created_at: number }
export interface RunScript { command: string; default: boolean; icon: string | null; available_in: string[] | null }
export interface RepoSettingsT { scripts: { setup: string | null; archive: string | null; run_mode: string | null; run: Record<string, RunScript> }; file_include_globs: string[]; target_branch: string | null; base_branch?: string | null; remote?: string | null; delete_branch_on_archive?: boolean | null; archive_on_merge?: boolean | null; env?: Record<string, string>; prompts?: Prompts; preview_url?: string | null }
export interface Layer { name: string; path: string; found: boolean }
export interface PrOptions { title: string; body: string; draft: boolean; labels: string[]; stack_on: number | null; dry_run: boolean }
export interface PrResult { url: string | null; commands: string[]; dry_run: boolean }
export interface LocalModel { id: string; name: string; source: string; size_bytes: number | null; quant: string | null; params: string | null; context: number | null; loaded: boolean }
export interface SourceStatus { id: string; name: string; kind: string; base_url: string; installed: boolean; running: boolean; apis: Api[]; models: LocalModel[]; can_start: boolean; can_pull: boolean; pull_hint: string; custom: boolean }
export interface LocalOverview { sources: SourceStatus[]; memory: number | null; harnesses: [HarnessKind, boolean, string][] }
export interface CustomEndpoint { id: string; name: string; base_url: string; apis: Api[]; api_key: string | null }
export interface EnvVar { key: string; value: string; scope: string }
export interface AppSettings {
  branch_prefix_type: string; branch_prefix_custom: string; notifications: boolean; sound: boolean; caffeinate: boolean; auto_rename_branch: boolean; env: EnvVar[]; env_file?: string | null;
  completion_sound?: string; always_show_context?: boolean; auto_convert_long_text?: boolean; not_absolutely_right?: boolean;
  open_prs_in?: string; delete_branch_on_archive?: boolean; archive_on_merge?: boolean; rename_ws_on_branch?: boolean; merge_method?: string; github_dry_run?: boolean; pr_include_workspace_link?: boolean; automerge?: boolean; optional_checks_blocking?: boolean; push_set_upstream?: boolean; stacked_prs?: boolean;
  claude_output_style?: string; codex_personality?: string; review_model?: string | null; default_plan?: boolean; agy_skip_permissions?: boolean; show_resources?: boolean;
  clone_dir?: string; claude_path?: string | null; codex_path?: string | null; opencode_path?: string | null; scrollback_mb?: number;
  tray?: boolean; usage_alert_pct?: number; usage_daily_budget?: number | null; usage_monthly_budget?: number | null; usage_codexbar?: boolean;
  /** Configurações › Avançado › Atualizações. */
  auto_update?: boolean; update_channel?: string; schema_version?: number;
}
/** Versão do app instalado e se o updater roda (só no app empacotado). */
export interface AppVersion { version: string; protocol: number; channel: string; updater: boolean }
export interface UpdateInfo { current: string; version: string; notes: string | null; date: string | null; channel: string }
export interface SessionSummary { id: string; title: string; model_key: string | null; updated_at: number }
export interface SessionRecord { id: string; workspace_id: string; title: string; model_key: string | null; agent_session: string | null; updated_at: number; items: unknown }
/** Processo que o agente deixou rodando (Parar, fechar aba, arquivar, sair). */
export interface Leftover { pid: number; start: number; name: string; cmd: string; ports: number[]; age: number; workspace_id?: string | null }
export interface DockerContainer { id: string; image: string; name: string }
export interface StopReport { alive: boolean; leftovers: Leftover[]; containers: DockerContainer[] }
export interface ChatStarted { chat_id: string; harness: HarnessKind; approvals: boolean; note: string | null; plan?: "native" | "emulated" }
export interface McpEntry { name: string; scope: string; source: string; transport: string; target: string }
/** MCP do registro único: origem em cada CLI, compartilhamento e peso no contexto (sem valores de env). */
export interface McpShared { name: string; transport: string; target: string; origins: { harness: string; scope: string; source: string }[]; conflict: boolean; shared: boolean; env_keys: string[]; weight: { tools: number; tokens: number } | null }
export interface LinearIssue { id: string; identifier: string; title: string; url: string; description: string | null; state: string | null; branchName: string | null; priority: string | null; assignee: string | null; team: string | null }
export interface LinearLink { identifier: string; title: string; url: string }
export interface CloudInfo { id: string | null; url: string | null; title: string | null; warning: string | null; exited: number | null; runs_on?: { kind: string; provider?: string; host?: string } | null }
export interface GhAccount { host: string; login: string; active: boolean; scopes: string[]; source: string; ok: boolean }
export interface RepoAccess { slug: string | null; ok: boolean; permission: string | null; message: string | null }
export interface AccountRow { id: string; provider: string; nickname: string; email: string | null; plan: string | null; dir: string | null; default: boolean; logged_in: boolean | null; env_var: string | null; env_confirmed: boolean }
export interface OpenTarget { id: string; name: string; kind: "finder" | "editor" | "terminal"; app: string; icon: string | null }
export interface PrCheck { name: string; state: string; bucket: string; link: string; workflow: string; description?: string }
export interface TermInfo { session: string; pane: string; snapshot: string }

/**
 * Evento do agente. `parent_tool_use_id` (opcional): o evento veio de um subagente lançado pelo tool_use
 * Task/Agent com esse id (árvore de subagentes). `queued`/`slot_acquired`: fila do limite de agentes
 * simultâneos; `suspended`/`resumed`: encerrado por ociosidade e retomado (contrato em docs/escala.md).
 */
export type AgentEvent = (
  | { type: "session_started"; session_id: string; model: string | null }
  | { type: "queued"; position: number; limit: number | null }
  | { type: "slot_acquired" }
  | { type: "suspended" }
  | { type: "resumed" }
  | { type: "text"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; output: string; is_error: boolean }
  | { type: "approval_request"; request_id: string; tool: string; input: unknown }
  | { type: "usage"; input: number | null; output: number | null; cache_read: number | null; cache_write: number | null; duration_ms: number | null }
  | { type: "session_info"; tools: string[]; mcp_servers: { name: string; status: string }[] }
  | { type: "turn_completed"; result: string | null; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null }
  | { type: "error"; message: string }
  | { type: "raw"; value: unknown }
  | { type: "log"; line: string }
  | { type: "exited"; code: number | null }
) & { parent_tool_use_id?: string | null };

/** Fila e limite de agentes simultâneos (kabuld/core; o Tauri ainda não tem: a UI esconde). */
export interface AgentsStatus { limit: number | null; running: number; queued: { chat_id: string; position: number; workspace_id?: string | null }[]; running_chats?: string[]; suspended?: string[]; focus?: string | null; idle_minutes?: number | null }

/** Processo no painel de recursos (CPU e memória somam os filhos). */
export interface ResourceNode { pid: number; name: string; cpu: number; mem: number; kind: string; agent: string | null; workspace_id: string | null; chat_id: string | null; children: ResourceNode[] }
export interface ResourceSnapshot { cpu: number; mem: number; count: number; root: ResourceNode }

/** Agente rodando fora do Kabul (outro terminal) e sessões recentes dos CLIs (core `external`). */
export interface ExternalRunning { agent: string; pid: number; cwd: string | null; repo: string | null; branch: string | null; running_secs: number; terminal: string | null; session_id: string | null }
export interface ExternalRecent { agent: string; id: string; title: string; cwd: string | null; repo: string | null; branch: string | null; updated: number }
export interface ExternalSessions { running: ExternalRunning[]; recent: ExternalRecent[]; cloud_note: string }

/** Uso, custos e limites (core `usage`). Custos só quando o harness reporta (`unpriced` = turnos sem custo). */
export interface UsageRow { key: string; label: string; turns: number; input: number; output: number; cache_read: number; cache_write: number; tokens: number; cost_usd: number; unpriced: number; duration_ms: number }
export interface UsageSession { session: string; workspace_id: string; provider: string; model: string; account: string | null; started: number; ended: number; turns: number; tokens: number; cost_usd: number; unpriced: number; duration_ms: number }
export interface UsageLimit { provider: string; account: string | null; account_label: string | null; plan: string | null; window: string; title: string; used_pct: number; window_mins: number | null; resets_at: number | null; source: string; updated_at: number }
export interface ProviderStatus { provider: string; indicator: string; description: string; url: string | null }
export interface LimitsSnapshot { schema_version: number; limits: UsageLimit[]; status: ProviderStatus[]; credits: { provider: string; account_label: string | null; remaining: number }[]; sources: { name: string; ok: boolean; detail: string }[]; updated_at: number }
export interface UsageAlert { key: string; kind: string; level: "warn" | "crit"; text: string; provider: string | null; account: string | null }
export interface UsageSuggestion { provider: string; account: string | null; to_account: { id: string; nickname: string } | null; to_provider: string | null; text: string }
export interface UsageOverview {
  schema_version: number; days: number; today_usd: number; month_usd: number; today_tokens: number; month_tokens: number; unpriced_turns: number;
  by_day: UsageRow[]; by_model: UsageRow[]; by_account: UsageRow[]; by_workspace: UsageRow[]; by_provider: UsageRow[]; sessions: UsageSession[];
  limits: LimitsSnapshot; tightest: UsageLimit | null; alerts: UsageAlert[]; suggestions: UsageSuggestion[];
}
export interface RunningAgent { chat_id: string; workspace_id: string; workspace: string; model: string; harness: string; since: number; working: boolean }

export type AuthEvent ={ kind: HarnessKind; event: import("./components/LoginFlow").LoginEvent };

const c = transport.call.bind(transport);

export const api = {
  repos: () => c<Repo[]>("repos_list"),
  addRepo: (path: string) => c<Repo>("repo_add", { path }),
  cloneRepo: (url: string) => c<Repo>("repo_clone", { url }),
  removeRepo: (id: string) => c<void>("repo_remove", { id }),
  repoSettings: (repoId: string) => c<{ settings: RepoSettingsT; layers: Layer[] }>("repo_settings", { repoId }),
  saveRepoSettings: (repoId: string, settings: RepoSettingsT) => c<string>("repo_settings_save", { repoId, settings }),

  workspaces: () => c<Workspace[]>("workspaces_list"),
  createWorkspace: (repoId: string) => c<Workspace>("workspace_create", { repoId }),
  updateWorkspace: (id: string, patch: Partial<Pick<Workspace, "title" | "status" | "pinned" | "notes" | "target_branch" | "unread" | "pin_order">> & { section?: string }) => c<Workspace>("workspace_update", { id, patch }),
  renameBranch: (id: string, name: string) => c<Workspace>("workspace_rename_branch", { id, name, byUser: true }),
  autoBranch: (workspaceId: string, text: string) => c<Workspace | null>("workspace_auto_branch", { workspaceId, text }),
  archiveWorkspace: (id: string, closePr = false) => c<void>("workspace_archive", { id, closePr }),
  unarchiveWorkspace: (id: string) => c<Workspace>("workspace_unarchive", { id }),
  onWorkspaceState: (h: (p: { id: string; state: string }) => void) => transport.subscribe("workspace-state", h),

  diff: (workspaceId: string) => c<Diff>("workspace_diff", { workspaceId }),
  changes: (workspaceId: string, scope: DiffScope = "all") => c<FileChange[]>("workspace_changes", { workspaceId, scope }),
  fileDiff: (workspaceId: string, path: string, scope: DiffScope = "all", ignoreWs = false) => c<string>("workspace_file_diff", { workspaceId, path, scope, ignoreWs }),
  gitStatus: (workspaceId: string) => c<GitStatus>("git_status", { workspaceId }),
  gitPull: (workspaceId: string) => c<Outcome>("git_pull", { workspaceId }),
  gitPush: (workspaceId: string) => c<Outcome>("git_push", { workspaceId }),
  discard: (workspaceId: string, path: string) => c<void>("workspace_discard", { workspaceId, path }),
  grep: (workspaceId: string, query: string) => c<GrepHit[]>("workspace_grep", { workspaceId, query }),
  prView: (workspaceId: string) => c<PrInfo | null>("pr_view", { workspaceId }),
  prMerge: (workspaceId: string) => c<Outcome>("pr_merge", { workspaceId }),
  prReady: (workspaceId: string) => c<Outcome>("pr_ready", { workspaceId }),
  prEdit: (workspaceId: string, title: string, body: string) => c<Outcome>("pr_edit", { workspaceId, title, body }),
  checksRerun: (workspaceId: string, links: string[]) => c<Outcome>("checks_rerun", { workspaceId, links }),
  checkLog: (workspaceId: string, link: string) => c<string>("check_log", { workspaceId, link }),
  sections: () => c<Section[]>("sections_list"),
  sectionSave: (section: Partial<Section> & { name: string }) => c<Section>("section_save", { section: { id: "", emoji: "", order: 0, ...section } }),
  sectionDelete: (id: string) => c<void>("section_delete", { id }),
  repoUpdate: (id: string, patch: { hidden?: boolean; icon?: string }) => c<Repo>("repo_update", { id, ...patch }),
  repoEnvLayers: (repoId: string) => c<[string, Record<string, string>][]>("repo_env_layers", { repoId }),
  soundPlay: (name: string) => c<void>("sound_play", { name }),
  gitIdentity: (repoId: string) => c<GitIdentity>("git_identity", { repoId }),
  gitIdentitySet: (repoId: string, name: string, email: string) => c<GitIdentity>("git_identity_set", { repoId, name, email }),
  repoRemotes: (repoId: string) => c<string[]>("repo_remotes", { repoId }),
  prOpenUrl: (workspaceId: string, prUrl: string) => c<string>("pr_open_url", { workspaceId, prUrl }),
  diagnostics: () => c<Diagnostics>("diagnostics"),
  openDevtools: () => c<void>("open_devtools"),
  appQuit: () => c<void>("app_quit"),
  onMenu: (h: (id: string) => void) => transport.subscribe("menu", h),
  onDeepLink: (h: (url: string) => void) => transport.subscribe("deep-link", h),
  onQuitRequested: (h: () => void) => transport.subscribe("quit-requested", h),
  machineInfo: () => c<MachineInfo>("machine_info"),
  ghRepos: () => c<GhRepo[]>("gh_repos"),
  cloneTo: (input: string, dir: string) => c<Repo>("repo_clone_to", { input, dir }),
  quickStart: (name: string, dir: string) => c<Repo>("repo_quick_start", { name, dir }),
  onCloneProgress: (h: (p: { phase: string; pct: number }) => void) => transport.subscribe("clone-progress", h),
  files: (workspaceId: string) => c<string[]>("workspace_files", { workspaceId }),
  readFile: (workspaceId: string, path: string) => c<string>("workspace_read_file", { workspaceId, path }),
  busy: (workspaceId: string) => c<string>("workspace_busy", { workspaceId }),
  stats: () => c<Record<string, [number, number]>>("workspaces_stats"),
  createPr: (workspaceId: string, options: PrOptions) => c<PrResult>("workspace_pr", { workspaceId, options }),

  comments: (workspaceId: string) => c<DiffComment[]>("comments_list", { workspaceId }),
  addComment: (workspaceId: string, path: string, line: number, endLine: number | null, body: string) => c<DiffComment>("comment_add", { workspaceId, path, line, endLine, body }),
  updateComment: (id: string, resolved: boolean | null, del = false) => c<void>("comment_update", { id, resolved, delete: del }),
  checkpoints: (workspaceId: string) => c<Checkpoint[]>("checkpoints_list", { workspaceId }),
  createCheckpoint: (workspaceId: string, message: string) => c<Checkpoint>("checkpoint_create", { workspaceId, message }),
  restoreCheckpoint: (workspaceId: string, id: string) => c<void>("checkpoint_restore", { workspaceId, id }),

  attachFile: (workspaceId: string, path: string) => c<string>("attach_file", { workspaceId, path }),
  attachBytes: (workspaceId: string, name: string, data: number[]) => c<string>("attach_bytes", { workspaceId, name, data }),
  pickFile: () => c<string | null>("pick_file"),
  pickFolder: () => c<string | null>("pick_folder"),

  runScript: (workspaceId: string, which: "setup" | "run" | "archive", runId: string | null = null) => c<string>("script_run", { workspaceId, which, runId }),
  stopScript: (session: string) => c<void>("script_stop", { session }),

  termOpen: (workspaceId: string, name: string | null = null) => c<TermInfo>("term_open", { workspaceId, name }),
  termInput: (session: string, pane: string, data: string) => c<void>("term_input", { session, pane, data }),
  termResize: (session: string, cols: number, rows: number) => c<void>("term_resize", { session, cols, rows }),
  termClose: (session: string) => c<void>("term_close", { session }),
  onTerm: (h: (p: { session: string; pane: string; data: number[] }) => void) => transport.subscribe("term-output", h),

  models: () => c<Model[]>("models_list"),
  localOverview: () => c<LocalOverview>("local_overview"),
  saveEndpoint: (endpoint: CustomEndpoint) => c<void>("local_endpoint_save", { endpoint }),
  removeEndpoint: (id: string) => c<void>("local_endpoint_remove", { id }),
  localPull: (source: string, model: string) => c<string>("local_pull", { source, model }),
  localStart: (source: string) => c<void>("local_start", { source }),
  installHarness: (kind: HarnessKind) => c<string>("harness_install", { kind }),
  registry: () => c<string>("registry_get"),
  saveRegistry: (text: string) => c<void>("registry_save", { text }),
  resetRegistry: () => c<void>("registry_reset"),

  chatStart: (workspaceId: string, model: Model, effort: string | null, fast: boolean, resume: string | null, plan: boolean, disabledMcp: string[] = [], fork = false, account: string | null = null) => c<ChatStarted>("chat_start", { workspaceId, model, effort, fast, resume, plan, disabledMcp, fork, account }),
  accountsList: (provider: string) => c<AccountRow[]>("accounts_list", { provider }),
  accountAdd: (provider: string, nickname: string) => c<AccountRow>("account_add", { provider, nickname }),
  accountUpdate: (id: string, patch: { nickname?: string; makeDefault?: boolean; remove?: boolean }) => c<void>("account_update", { id, ...patch }),
  accountLogin: (id: string) => c<void>("account_login", { id }),
  accountCode: (id: string, code: string) => c<void>("account_code", { id, code }),
  accountCancel: (id: string) => c<void>("account_cancel", { id }),
  onAccountAuth: (h: (p: { id: string; event: import("./components/LoginFlow").LoginEvent }) => void) => transport.subscribe("account-auth-event", h),
  cloudStart: (workspaceId: string, prompt: string, environment: string | null) => c<{ tmux: string; info: CloudInfo }>("cloud_start", { workspaceId, prompt, environment }),
  cloudPoll: (tmux: string) => c<CloudInfo>("cloud_poll", { tmux }),
  teleport: (workspaceId: string, id: string) => c<string>("teleport", { workspaceId, id }),
  termRun: (workspaceId: string, name: string, command: string) => c<string>("term_run", { workspaceId, name, command }),
  mirrorStatus: (workspaceId: string) => c<{ running: boolean; tmux: string; link: string | null }>("mirror_status", { workspaceId }),
  mirrorStart: (workspaceId: string, resume: string | null) => c<{ running: boolean; tmux: string; link: string | null }>("mirror_start", { workspaceId, resume }),
  mirrorStop: (workspaceId: string) => c<void>("mirror_stop", { workspaceId }),
  repoBranches: (repoId: string) => c<string[]>("repo_branches", { repoId }),
  repoPrs: (repoId: string) => c<{ number: number; title: string; headRefName: string; author: { login: string }; isDraft: boolean; url: string }[]>("repo_prs", { repoId }),
  createWorkspaceEx: (repoId: string, opts: { base?: string | null; branch?: string | null; pr?: number | null; prHead?: string | null }) => c<Workspace>("workspace_create_ex", { repoId, ...opts }),
  workspaceFork: (workspaceId: string, checkpointId: string | null, agentSession: string | null) => c<Workspace>("workspace_fork", { workspaceId, checkpointId, agentSession }),
  githubStatus: () => c<GhAccount[]>("github_status"),
  githubLogin: () => c<void>("github_login"),
  githubCancel: () => c<void>("github_cancel"),
  githubSwitch: (login: string) => c<void>("github_switch", { login }),
  githubToken: (token: string | null) => c<boolean>("github_token", { token }),
  githubTokenSet: () => c<boolean>("github_token_set"),
  githubRepoAccess: (repoId: string) => c<RepoAccess>("github_repo_access", { repoId }),
  onGithubAuth: (h: (e: { Url: string } | { Codigo: string } | "PedeCodigo" | "Ok" | { Erro: string }) => void) => transport.subscribe("github-auth-event", h),
  mcpList: (workspaceId: string, harness: HarnessKind) => c<McpEntry[]>("mcp_list", { workspaceId, harness }),
  mcpAdd: (workspaceId: string, name: string, command: string, args: string[]) => c<void>("mcp_add", { workspaceId, name, command, args }),
  chatSetMode: (chatId: string, mode: "plan" | "default") => c<boolean>("chat_set_mode", { chatId, mode }),
  mcpShared: (workspaceId: string) => c<McpShared[]>("mcp_shared", { workspaceId }),
  mcpWeigh: (workspaceId: string, name: string) => c<{ tools: number; tokens: number }>("mcp_weigh", { workspaceId, name }),
  mcpSetShared: (workspaceId: string, name: string, on: boolean) => c<void>("mcp_set_shared", { workspaceId, name, on }),
  mcpExportAgy: (workspaceId: string, name: string) => c<string | null>("mcp_export_agy", { workspaceId, name }),
  linearStatus: () => c<{ connected: boolean; who: string | null; error: string | null }>("linear_status"),
  linearConnect: (key: string) => c<string>("linear_connect", { key }),
  linearDisconnect: () => c<void>("linear_disconnect"),
  linearIssues: (search: string | null) => c<LinearIssue[]>("linear_issues", { search }),
  workspaceFromIssue: (repoId: string, issue: LinearIssue) => c<Workspace>("workspace_from_issue", { repoId, issue }),
  chatSend: (chatId: string, text: string) => c<void>("chat_send", { chatId, text }),
  chatApprove: (chatId: string, requestId: string, allow: boolean, extra: { tool?: string; updatedInput?: unknown; always?: boolean } = {}) => c<void>("chat_approve", { chatId, requestId, allow, ...extra }),
  chatStop: (chatId: string) => c<void>("chat_stop", { chatId }),
  /** Parar: interrompe só o turno (protocolo do agente) e devolve o que ficou rodando. */
  chatInterrupt: (chatId: string) => c<StopReport>("chat_interrupt", { chatId }),
  chatProcesses: (chatIds: string[]) => c<Leftover[]>("chat_processes", { chatIds }),
  processesKeep: (items: Leftover[], workspaceId: string | null) => c<void>("processes_keep", { items, workspaceId }),
  processesKept: () => c<Leftover[]>("processes_kept"),
  processKill: (keys: { pid: number; start: number }[]) => c<number>("process_kill", { keys }),
  dockerStop: (id: string) => c<void>("docker_stop", { id }),
  resources: () => c<ResourceSnapshot>("resources_get"),
  externalSessions: () => c<ExternalSessions>("external_sessions"),
  onChat: (h: (p: { chat_id: string; event: AgentEvent }) => void) => transport.subscribe("chat-event", h),
  agentsStatus: () => c<AgentsStatus>("agents_status"),
  agentsConfig: (cfg: { limit?: number | null; idleMinutes?: number | null; niceBackground?: boolean }) => c<AgentsStatus>("agents_config", cfg),
  /** kabuld avisa cada mudança da fila/limite (o mesmo objeto de agents_status). */
  onAgentsStatus: (h: (s: AgentsStatus) => void) => transport.subscribe("agents-status", h),
  agentsFocus: (workspaceId: string) => c<void>("agents_focus", { workspaceId }),
  /** Parar em lote; sem o comando no backend, para um por um. */
  chatsInterrupt: (chatIds: string[]) => c<{ stopped: string[]; errors: { chat_id: string; error: string }[] }>("chats_interrupt", { chatIds }),

  historyList: (workspaceId: string) => c<SessionSummary[]>("history_list", { workspaceId }),
  historyLoad: (workspaceId: string, id: string) => c<SessionRecord>("history_load", { workspaceId, id }),
  historySave: (record: SessionRecord) => c<void>("history_save", { record }),
  historyDelete: (workspaceId: string, id: string) => c<void>("history_delete", { workspaceId, id }),
  historySearch: (q: string) => c<[string, string, string, string][]>("history_search", { q }),
  slashCommands: (workspaceId: string) => c<[string, string][]>("slash_commands", { workspaceId }),

  sessions: () => c<Sessions>("sessions_list"),
  openTargets: () => c<OpenTarget[]>("open_targets"),
  openIn: (target: string, path: string) => c<void>("open_in", { target, path }),
  prChecks: (workspaceId: string) => c<{ checks: PrCheck[]; message: string | null }>("pr_checks", { workspaceId }),
  authStatus: () => c<AuthStatus[]>("auth_status"),
  authLogin: (kind: HarnessKind) => c<void>("auth_login", { kind }),
  authCode: (kind: HarnessKind, code: string) => c<void>("auth_code", { kind, code }),
  authCancel: (kind: HarnessKind) => c<void>("auth_cancel", { kind }),
  onAuth: (h: (p: AuthEvent) => void) => transport.subscribe("auth-event", h),

  appSettings: () => c<AppSettings>("app_settings_get"),
  saveAppSettings: (settings: AppSettings) => c<void>("app_settings_save", { settings }),
  /** Notificação do sistema; `target` é a conversa que o clique deve abrir. */
  notify: (title: string, body: string, target?: { ws: string; session: string }) => (target && Object.assign(lastNotify, { ...target, at: Date.now() }), c<void>("notify", { title, body })),
  badgeSet: (count: number) => c<void>("badge_set", { count }),
  appVersion: () => c<AppVersion>("app_version"),
  updateCheck: (channel?: string) => c<UpdateInfo | null>("update_check", { channel }),
  updateInstall: () => c<void>("update_install"),
  onUpdateAvailable: (h: (u: UpdateInfo) => void) => transport.subscribe("update-available", h),
  openExternal: (target: string) => c<void>("open_external", { target }),
  transcribe: (audio: number[], ext: string) => c<string>("transcribe", { audio, ext }),

  usageOverview: (days = 30) => c<UsageOverview>("usage_overview", { days }),
  usageRefresh: () => c<LimitsSnapshot>("usage_refresh"),
  usageCsv: (days = 30) => c<string>("usage_csv", { days }),
  /** Desktop: grava em Downloads e devolve o caminho. */
  usageCsvSave: (days = 30) => c<string>("usage_csv_save", { days }),
  onUsageChanged: (h: () => void) => transport.subscribe("usage-changed", h),
  agentsRunning: () => c<RunningAgent[]>("agents_running"),
  trayAction: (action: "open" | "open-workspace" | "new-workspace" | "usage" | "pause-all", workspaceId: string | null = null) => c<void>("tray_action", { action, workspaceId }),
  trayHide: () => c<void>("tray_hide"),
  onTrayAction: (h: (p: { action: string; workspace_id: string | null }) => void) => transport.subscribe("tray-action", h),
};

export const HARNESS_LABEL: Record<HarnessKind, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", opencode: "OpenCode", qwen: "Qwen Code", gemini: "Gemini CLI", goose: "Goose", cursor: "Cursor" };
export const EFFORT_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max", ultra: "Ultra" };
export const STATUS_LABEL: Record<string, string> = lazyRecord(() => ({ backlog: t("app.status.backlog"), "in-progress": t("app.status.inProgress"), "in-review": t("app.status.inReview"), done: t("app.status.done"), canceled: t("app.status.canceled") }));
/** Ordem dos grupos por status na barra lateral. */
export const STATUS_ORDER = ["done", "in-review", "in-progress", "backlog", "canceled"];
export const wsTitle = (w: Workspace) => w.title || w.name[0].toUpperCase() + w.name.slice(1);
export const fmtBytes = (n: number | null) => (n == null ? "—" : n >= 1e9 ? `${fmtNum(n / 1e9, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB` : `${Math.round(n / 1e6)} MB`);
