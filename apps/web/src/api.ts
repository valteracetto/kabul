import { transport } from "./transport";

export type HarnessKind = "claude" | "codex" | "antigravity" | "opencode" | "qwen" | "gemini";
export type Api = "openai" | "anthropic" | "gemini";

export interface Repo { id: string; name: string; path: string; default_branch: string }
export interface Workspace {
  id: string; repo_id: string; name: string; branch: string; path: string; archived: boolean; created_at: number;
  title: string | null; status: string; state: string; pinned: boolean; notes: string; port: number;
  target_branch: string | null; pr_url: string | null; archive_checkpoint: string | null; user_set_branch: boolean; files_copied: number; linear?: LinearLink | null;
}
export interface Pane { session: string; window_index: number; pane_index: number; pane_id: string; pid: number; command: string; path: string; active: boolean; title: string }
export interface TmuxSession extends Pane { agent: string }
export interface ConductorSession { id: string; workspace_id: string | null; status: string | null; title: string | null; model: string | null; agent_type: string | null; updated_at: string | null }
export interface ConductorWorkspace { id: string; repo_name: string | null; directory_name: string | null; branch: string | null; state: string | null; path: string | null }
export interface Sessions { tmux: TmuxSession[]; conductor_workspaces: ConductorWorkspace[]; conductor_sessions: ConductorSession[]; conductor_error: string | null }
export interface AuthStatus { kind: HarnessKind; logged_in: boolean; source: string; method: string | null; error: string | null; installed: boolean }
export interface LocalRef { source: string; source_name: string; model: string; family: string; note: string; missing: HarnessKind[]; size_bytes: number | null; quant: string | null; fits: boolean | null }
export interface Model { key: string; harness: HarnessKind; id: string; label: string; provider: string; efforts: string[]; effort_in_id: boolean; local: LocalRef | null; context: number | null }
export interface FileChange { path: string; added: number | null; removed: number | null; untracked: boolean }
export interface Diff { base: string; base_ref: string; stat: string; patch: string }
export interface DiffComment { id: string; workspace_id: string; path: string; line: number; end_line: number | null; body: string; resolved: boolean; created_at: number }
export interface Checkpoint { id: string; commit: string; head: string; message: string; created_at: number }
export interface RunScript { command: string; default: boolean; icon: string | null; available_in: string[] | null }
export interface RepoSettingsT { scripts: { setup: string | null; archive: string | null; run_mode: string | null; run: Record<string, RunScript> }; file_include_globs: string[]; target_branch: string | null }
export interface Layer { name: string; path: string; found: boolean }
export interface PrOptions { title: string; body: string; draft: boolean; labels: string[]; stack_on: number | null; dry_run: boolean }
export interface PrResult { url: string | null; commands: string[]; dry_run: boolean }
export interface LocalModel { id: string; name: string; source: string; size_bytes: number | null; quant: string | null; params: string | null; context: number | null; loaded: boolean }
export interface SourceStatus { id: string; name: string; kind: string; base_url: string; installed: boolean; running: boolean; apis: Api[]; models: LocalModel[]; can_start: boolean; can_pull: boolean; pull_hint: string; custom: boolean }
export interface LocalOverview { sources: SourceStatus[]; memory: number | null; harnesses: [HarnessKind, boolean, string][] }
export interface CustomEndpoint { id: string; name: string; base_url: string; apis: Api[]; api_key: string | null }
export interface EnvVar { key: string; value: string; scope: string }
export interface AppSettings { branch_prefix_type: string; branch_prefix_custom: string; notifications: boolean; sound: boolean; caffeinate: boolean; auto_rename_branch: boolean; env: EnvVar[] }
export interface SessionSummary { id: string; title: string; model_key: string | null; updated_at: number }
export interface SessionRecord { id: string; workspace_id: string; title: string; model_key: string | null; agent_session: string | null; updated_at: number; items: unknown }
export interface ChatStarted { chat_id: string; harness: HarnessKind; approvals: boolean; note: string | null }
export interface McpEntry { name: string; scope: string; source: string; transport: string; target: string }
export interface LinearIssue { id: string; identifier: string; title: string; url: string; description: string | null; state: string | null; branchName: string | null; priority: string | null; assignee: string | null; team: string | null }
export interface LinearLink { identifier: string; title: string; url: string }
export interface CloudInfo { id: string | null; url: string | null; title: string | null; warning: string | null; exited: number | null; runs_on?: { kind: string; provider?: string; host?: string } | null }
export interface GhAccount { host: string; login: string; active: boolean; scopes: string[]; source: string; ok: boolean }
export interface RepoAccess { slug: string | null; ok: boolean; permission: string | null; message: string | null }
export interface AccountRow { id: string; provider: string; nickname: string; email: string | null; plan: string | null; dir: string | null; default: boolean; logged_in: boolean | null; env_var: string | null; env_confirmed: boolean }
export interface OpenTarget { id: string; name: string; kind: "finder" | "editor" | "terminal"; app: string; icon: string | null }
export interface PrCheck { name: string; state: string; bucket: string; link: string; workflow: string; description?: string }
export interface TermInfo { session: string; pane: string; snapshot: string }

export type AgentEvent =
  | { type: "session_started"; session_id: string; model: string | null }
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
  | { type: "exited"; code: number | null };

export type AuthEvent = { kind: HarnessKind; event: { Url: string } | "PedeCodigo" | "Ok" | { Erro: string } };

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
  updateWorkspace: (id: string, patch: Partial<Pick<Workspace, "title" | "status" | "pinned" | "notes" | "target_branch">>) => c<Workspace>("workspace_update", { id, patch }),
  renameBranch: (id: string, name: string) => c<Workspace>("workspace_rename_branch", { id, name, byUser: true }),
  autoBranch: (workspaceId: string, text: string) => c<Workspace | null>("workspace_auto_branch", { workspaceId, text }),
  archiveWorkspace: (id: string) => c<void>("workspace_archive", { id }),
  unarchiveWorkspace: (id: string) => c<Workspace>("workspace_unarchive", { id }),
  onWorkspaceState: (h: (p: { id: string; state: string }) => void) => transport.subscribe("workspace-state", h),

  diff: (workspaceId: string) => c<Diff>("workspace_diff", { workspaceId }),
  changes: (workspaceId: string) => c<FileChange[]>("workspace_changes", { workspaceId }),
  fileDiff: (workspaceId: string, path: string) => c<string>("workspace_file_diff", { workspaceId, path }),
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
  onAccountAuth: (h: (p: { id: string; event: { Url: string } | { Codigo: string } | "PedeCodigo" | "Ok" | { Erro: string } }) => void) => transport.subscribe("account-auth-event", h),
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
  linearStatus: () => c<{ connected: boolean; who: string | null; error: string | null }>("linear_status"),
  linearConnect: (key: string) => c<string>("linear_connect", { key }),
  linearDisconnect: () => c<void>("linear_disconnect"),
  linearIssues: (search: string | null) => c<LinearIssue[]>("linear_issues", { search }),
  workspaceFromIssue: (repoId: string, issue: LinearIssue) => c<Workspace>("workspace_from_issue", { repoId, issue }),
  chatSend: (chatId: string, text: string) => c<void>("chat_send", { chatId, text }),
  chatApprove: (chatId: string, requestId: string, allow: boolean, extra: { tool?: string; updatedInput?: unknown; always?: boolean } = {}) => c<void>("chat_approve", { chatId, requestId, allow, ...extra }),
  chatStop: (chatId: string) => c<void>("chat_stop", { chatId }),
  onChat: (h: (p: { chat_id: string; event: AgentEvent }) => void) => transport.subscribe("chat-event", h),

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
  notify: (title: string, body: string) => c<void>("notify", { title, body }),
  openExternal: (target: string) => c<void>("open_external", { target }),
  transcribe: (audio: number[], ext: string) => c<string>("transcribe", { audio, ext }),
};

export const HARNESS_LABEL: Record<HarnessKind, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", opencode: "OpenCode", qwen: "Qwen Code", gemini: "Gemini CLI" };
export const EFFORT_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max" };
export const STATUS_LABEL: Record<string, string> = { "in-progress": "Em andamento", "in-review": "Em revisão", done: "Concluído", canceled: "Cancelado" };
export const wsTitle = (w: Workspace) => w.title || w.name[0].toUpperCase() + w.name.slice(1);
export const fmtBytes = (n: number | null) => (n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
