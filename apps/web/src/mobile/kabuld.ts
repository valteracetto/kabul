import { transport } from "../transport";
import type { Principal, WsTransport } from "../transport/websocket";
import type { RunsOn } from "../components/RunsOn";
import type { Model, Repo, Section, Workspace } from "../api";
import { t, lazyRecord } from "../i18n";

/** Opções de início/troca de modelo (mesmas do app desktop). */
export interface StartOpts { effort?: string | null; fast?: boolean; account?: string | null; plan?: boolean }
export interface Account { id: string; provider: string; nickname: string; email: string | null; plan: string | null; default: boolean; logged_in: boolean | null }

/** Conta de cada harness (`accounts::provider_of` no core). */
export const ACCOUNT_PROVIDER: Record<string, string> = { claude: "claude", codex: "codex", antigravity: "agy", gemini: "gemini", opencode: "opencode", qwen: "qwen" };
export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"];
/** Nome do esforço no idioma da tela (o nome ficou EFFORT_PT por histórico). */
export const EFFORT_PT: Record<string, string> = lazyRecord(() => ({ low: t("mobile.effort.low"), medium: t("mobile.effort.medium"), high: t("mobile.effort.high"), xhigh: t("mobile.effort.xhigh"), max: t("mobile.effort.max"), ultra: t("mobile.effort.ultra") }));

/** Versão e nome do kabuld (rota HTTP pública `/api/health`). */
/** `update`: versão nova que o app do Mac achou e ainda não instalou. */
export const health = (): Promise<{ kabuld: boolean; name: string; version: string; update?: { version: string; channel: string } | null } | null> => fetch("/api/health").then((r) => r.json(), () => null).catch(() => null);

export type Status = "working" | "waiting" | "idle";
export interface Group { key: string; repo: string; workspace: string | null; workspace_id: string | null }
export interface LiveSession {
  id: string; kind: "tmux" | "chat"; name: string; agent: string; status: Status; detail: string | null; runs_on: RunsOn;
  group: Group; path: string; pane: string | null; cols: number; rows: number; idle_secs: number; preview: string;
  /** Preenchido no cliente quando a sessão vem de outra máquina pareada. */
  machine?: string;
}
export interface TermInfo { session: string; pane: string; snapshot: string; cols: number; rows: number }
export interface AuthorView { id: string; name: string; device: string; color: string }
export interface Queued { id: string; text: string; author: AuthorView; at: number }
export interface Pending { request_id: string; tool: string; input: unknown }
export interface ChatView { id: string; workspace_id: string; branch: string; title: string; harness: string; model: string; approvals: boolean; account: string | null; status: Status; detail: string | null; queue: Queued[]; pending: Pending[] }
export type EntryAuthor = { kind: "user"; name: string; device: string } | { kind: "agent"; harness: string; model: string } | { kind: "system" };
export interface Entry { seq: number; at: number; author: EntryAuthor; segment: number; kind: { type: string; [k: string]: unknown } }
export interface Present { conn: number; id: string; name: string; device: string; color: string; role: string; workspace: string | null; target: string | null; typing: boolean }
export interface Device { id: string; user: string; name: string; role: "owner" | "editor" | "observer"; scope: { kind: string; id?: string }; color: string; created_at: number; last_seen: number | null }
export interface Ticket { token: string; url: string; qr_svg: string; expires_at: number; ttl: number; role?: string }
export interface NetStatus { kind: string; up: boolean; ips: string[]; dns_name: string | null; https_url: string | null; message: string | null }
export interface RemoteStatus { running: boolean; port: number; net: NetStatus; base_url: string; machine: string; devices: number; secrets: string; push: number; https: boolean }
export interface FoundMachine { name: string; dns_name: string | null; ip: string; os: string; online: boolean; kabuld: boolean; machine: string | null; url: string }

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Comandos do kabuld. No app desktop (Tauri) vão ao kabuld embutido por `kabuld_call`; no navegador
 * (PWA ou desktop servido pelo kabuld) vão direto pelo WebSocket.
 */
export function kcall<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return isTauri ? transport.call<T>("kabuld_call", { command, args }) : transport.call<T>(command, args);
}

export const ws = (): WsTransport | null => ("principal" in transport ? (transport as WsTransport) : null);
export const me = (): Principal | null => ws()?.principal() ?? null;
export const canWrite = () => (me()?.role ?? "owner") !== "observer";
export const isOwner = () => (me()?.role ?? "owner") === "owner";

export const k = {
  live: () => kcall<{ machine: string; os: string; sessions: LiveSession[] }>("live_sessions"),
  termAttach: (session: string) => kcall<TermInfo>("term_attach", { session }),
  termInput: (session: string, pane: string, data: string) => kcall<void>("term_input", { session, pane, data }),
  termKeys: (session: string, pane: string, keys: string[]) => kcall<void>("term_keys", { session, pane, keys }),
  termFit: (session: string, cols: number, rows: number) => kcall<void>("term_resize", { session, cols, rows, apply: true }),
  chatStart: (workspaceId: string, model: Model, resume?: string, o: StartOpts = {}) => kcall<ChatView>("chat_start", { workspaceId, model, resume, ...o }),
  chatSwitch: (chatId: string, model: Model, o: StartOpts = {}) => kcall<ChatView>("chat_switch", { chatId, model, ...o }),
  chatClose: (chatId: string) => kcall<void>("chat_close", { chatId }),
  chatList: () => kcall<ChatView[]>("chat_list"),
  repos: () => kcall<Repo[]>("repos_list"),
  sections: () => kcall<Section[]>("sections_list"),
  workspaceCreate: (repoId: string, title?: string) => kcall<Workspace>("workspace_create", { repoId, title }),
  workspaceArchive: (id: string, archive: boolean) => kcall<Workspace>(archive ? "workspace_archive" : "workspace_unarchive", { id }),
  workspaceUpdate: (id: string, patch: { pinned?: boolean; pin_order?: number | null; title?: string; section?: string }) => kcall<Workspace>("workspace_update", { id, patch }),
  accounts: (provider: string) => kcall<Account[]>("accounts_list", { provider }),
  accountDefault: (id: string) => kcall<void>("account_update", { id, makeDefault: true }),
  cloudStart: (workspaceId: string, prompt: string) => kcall<{ tmux: string }>("cloud_start", { workspaceId, prompt }),
  external: () => kcall<import("../api").ExternalSessions>("external_sessions"),
  workspaces: () => kcall<import("../api").Workspace[]>("workspaces_list"),
  chatSend: (chatId: string, text: string) => kcall<{ queued: boolean; id: string; position?: number }>("chat_send", { chatId, text }),
  chatApprove: (chatId: string, requestId: string, allow: boolean) => kcall<void>("chat_approve", { chatId, requestId, allow }),
  chatStop: (chatId: string) => kcall<void>("chat_stop", { chatId }),
  chatTranscript: (chatId: string) => kcall<{ chat: ChatView; transcript: { entries: Entry[] } }>("chat_transcript", { chatId }),
  queueRemove: (chatId: string, id: string) => kcall<void>("chat_queue_remove", { chatId, id }),
  models: () => kcall<Model[]>("models_list"),
  presence: (workspaceId: string | null, target: string | null, typing = false) => kcall<void>("presence_set", { workspaceId, target, typing }),
  status: () => kcall<RemoteStatus>("remote_status"),
  pairCreate: () => kcall<Ticket>("pair_create"),
  invite: (workspaceId: string, role: "editor" | "observer") => kcall<Ticket>("invite_create", { workspaceId, role }),
  devices: () => kcall<Device[]>("devices_list"),
  revoke: (id: string) => kcall<void>("device_revoke", { id }),
  https: (on: boolean) => kcall<NetStatus>("remote_https", { on }),
  discover: () => kcall<FoundMachine[]>("machines_discover"),
  pushKey: () => kcall<string>("push_key"),
  pushSubscribe: (subscription: unknown) => kcall<void>("push_subscribe", { subscription }),
  pushTest: () => kcall<number>("push_test"),
};

export const STATUS_LABEL: Record<Status, string> = lazyRecord(() => ({ working: t("mobile.status.working"), waiting: t("mobile.status.waiting"), idle: t("mobile.status.idle") }));
export const AGENT_LABEL: Record<string, string> = lazyRecord(() => ({ claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", agy: "Antigravity", opencode: "OpenCode", qwen: "Qwen Code", gemini: "Gemini CLI", shell: "Terminal", outro: t("mobile.agent.process") }));
