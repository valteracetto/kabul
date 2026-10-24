import type { Transport } from "./types";

/**
 * Backend falso em memória para testes E2E (Playwright) e para ver a UI no navegador sem o app.
 * Simula repos, worktrees, agente (com pedido de aprovação), terminal e git.
 */
type H = (p: any) => void;
// Como no WKWebView do Tauri: window.confirm não existe de verdade (devolve false). Pega regressões.
if (typeof window !== "undefined") window.confirm = () => false;
if (typeof window !== "undefined") window.prompt = () => null;
if (typeof window !== "undefined") (window as any).__calls = [];
const subs = new Map<string, Set<H>>();
const emit = (ch: string, p: unknown) => setTimeout(() => subs.get(ch)?.forEach((h) => h(p)), 0);
let seq = 0;
const id = () => `m${++seq}`;
const now = () => Math.floor(Date.now() / 1000);

const db = {
  repos: [] as any[],
  workspaces: [] as any[],
  comments: [] as any[],
  checkpoints: {} as Record<string, any[]>,
  files: { "README.md": "# demo\n", "main.rs": 'fn main() {\n    println!("oi");\n}\n' } as Record<string, string>,
  changed: {} as Record<string, Record<string, string>>,
  history: {} as Record<string, any>,
  endpoints: [] as any[],
  registry: "",
  settings: { branch_prefix_type: "github", branch_prefix_custom: "", notifications: true, sound: true, caffeinate: true, auto_rename_branch: true, env: [], env_file: null, completion_sound: "Glass", always_show_context: false, auto_convert_long_text: true, not_absolutely_right: false, open_prs_in: "github", delete_branch_on_archive: false, archive_on_merge: false, rename_ws_on_branch: true, merge_method: "squash", github_dry_run: false, pr_include_workspace_link: true, automerge: false, optional_checks_blocking: false, push_set_upstream: true, stacked_prs: true, clone_dir: "~/Developer", claude_output_style: "default", codex_personality: "pragmatic", review_model: null, default_plan: false, claude_path: null, codex_path: null, opencode_path: null, scrollback_mb: 10 } as any,
  repoSettings: { scripts: { setup: "echo instalando", archive: null, run_mode: "concurrent", run: { web: { command: "npm run dev", default: true, icon: "globe", available_in: null } } }, file_include_globs: [], target_branch: null, env: { API_URL: "http://localhost:$KABUL_PORT" }, prompts: { general: null, review: null, create_pr: null, fix_errors: null, resolve_conflicts: null, branch_rename: null }, preview_url: "http://localhost:$KABUL_PORT" } as any,
  chats: {} as Record<string, { pending: string | null; turn: number }>,
  linear: false,
  accounts: [] as any[],
  mirror: false,
  ghToken: false,
  sections: [] as any[],
  pr: {} as Record<string, any>,
  git: {} as Record<string, any>,
  ghAccounts: [{ host: "github.com", login: "dev", active: true, scopes: ["gist", "read:org", "repo", "workflow"], source: "keyring", ok: true }] as any[],
};
const CITIES = ["kabul", "lisboa", "cusco", "quito"];
const models = [
  { key: "claude:opus", harness: "claude", id: "opus", label: "Opus 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "xhigh", "max"], effort_in_id: false, local: null, context: 200000 },
  { key: "codex:gpt-6-luna", harness: "codex", id: "gpt-6-luna", label: "GPT-6-Luna", provider: "openai", efforts: ["low", "medium", "high"], effort_in_id: false, local: null, context: 272000 },
  { key: "agy:gemini-4-argon", harness: "antigravity", id: "gemini-4-argon", label: "Gemini 4 Argon", provider: "google", efforts: ["low", "medium", "high"], effort_in_id: true, local: null, context: 1000000 },
  { key: "local:lmstudio:qwen3-8b", harness: "opencode", id: "qwen3-8b", label: "Qwen3 8B", provider: "local", efforts: [], effort_in_id: false, context: 40960, local: { source: "lmstudio", source_name: "LM Studio", model: "qwen3-8b", family: "Qwen", note: "qwen → OpenCode (Qwen Code preferido, não instalado)", missing: ["qwen"], size_bytes: 4623782544, quant: "4bit", fits: true } },
];
const ws = (wid: string) => db.workspaces.find((w) => w.id === wid);
const changes = (wid: string) => Object.entries(db.changed[wid] ?? {}).map(([path, body]) => ({ path, added: body.split("\n").length - 1, removed: db.files[path] ? 1 : 0, untracked: !db.files[path] }));

function agentTurn(chatId: string, text: string, wid: string) {
  const ch = db.chats[chatId];
  ch.turn++;
  const ev = (e: unknown, t: number) => setTimeout(() => emit("chat-event", { chat_id: chatId, event: e }), t);
  if (ch.turn === 1) {
    ev({ type: "session_started", session_id: "sess-mock", model: "mock" }, 30);
    ev({ type: "session_info", tools: ["Bash", "Read", "Write", "mcp__linear__list_issues", "mcp__linear__get_issue"], mcp_servers: [{ name: "linear", status: "connected" }, { name: "docs", status: "failed" }] }, 40);
  }
  const done = (msg: string, t: number) => {
    ev({ type: "text", text: msg }, t);
    ev({ type: "usage", input: 1200, output: 40, cache_read: 9000, cache_write: 1800, duration_ms: 900 }, t + 20);
    ev({ type: "turn_completed", result: null, input_tokens: 12000, output_tokens: 40, cost_usd: 0.01 }, t + 40);
  };
  if (/\b(crie|escreva)\b/i.test(text)) {
    ch.pending = "Write";
    ev({ type: "tool_use", id: "t1-" + ch.turn, name: "Write", input: { file_path: "ok.txt", content: "ok" } }, 120);
    ev({ type: "approval_request", request_id: "req-" + ch.turn, tool: "Write", input: { file_path: "ok.txt" } }, 200);
    return;
  }
  if (/\bplano\b/i.test(text) && !/segundo plano/i.test(text)) {
    ch.pending = "ExitPlanMode";
    ev({ type: "approval_request", request_id: "plan-" + ch.turn, tool: "ExitPlanMode", input: { plan: "## Plano\n\n1. Ler `src/app.tsx`\n2. Corrigir o login\n3. Rodar os testes" } }, 120);
    return;
  }
  if (/\bpergunte\b/i.test(text)) {
    ch.pending = "AskUserQuestion";
    ev({ type: "approval_request", request_id: "q-" + ch.turn, tool: "AskUserQuestion", input: { questions: [{ header: "Banco", question: "Qual banco usar?", options: [{ label: "Postgres", description: "relacional" }, { label: "SQLite", description: "arquivo" }] }, { header: "Testes", question: "Escrever testes?", options: [{ label: "Sim" }, { label: "Não" }] }] } }, 120);
    return;
  }
  if (/diagrama/i.test(text)) {
    done("Fluxo:\n\n```mermaid\ngraph TD\n  A[Mensagem] --> B[Agente]\n  B --> C[Resposta]\n```\n\nE a fórmula:\n\n$$\nE = mc^2\n$$\n\n```mermaid\nisso não é mermaid válido ->>\n```", 80);
    return;
  }
  if (/\bcerto\b/i.test(text)) {
    done("You're absolutely right! Corrigi o teste.", 80);
    return;
  }
  if (/demorad/i.test(text)) {
    done("Terminei a tarefa demorada.", 1500);
    return;
  }
  if (/segundo plano/i.test(text)) {
    ev({ type: "tool_use", id: "bg1-" + ch.turn, name: "Bash", input: { command: "npm run dev", run_in_background: true, description: "Sobe o servidor" } }, 80);
    ev({ type: "tool_result", id: "bg1-" + ch.turn, output: "Command running in background with ID: 1", is_error: false }, 100);
    done("Servidor rodando em segundo plano.", 140);
    return;
  }
  ev({ type: "tool_use", id: "t0-" + ch.turn, name: "Bash", input: { command: "ls", description: "Lista os arquivos" } }, 60);
  ev({ type: "tool_result", id: "t0-" + ch.turn, output: Object.keys(db.files).join("\n"), is_error: false }, 80);
  ev({ type: "tool_use", id: "td-" + ch.turn, name: "TodoWrite", input: { todos: [{ content: "Listar arquivos", status: "completed" }, { content: "Responder", status: "in_progress" }] } }, 100);
  ev({ type: "tool_result", id: "td-" + ch.turn, output: "ok", is_error: false }, 110);
  ev({ type: "tool_use", id: "ed-" + ch.turn, name: "Edit", input: { file_path: "/mock/ws/kabul/main.rs", old_string: 'println!("oi");', new_string: 'println!("olá");' } }, 120);
  ev({ type: "tool_result", id: "ed-" + ch.turn, output: "ok", is_error: false }, 130);
  done(`Recebi: **${text.slice(0, 60)}**. Há ${Object.keys(db.files).length} arquivos.\n\n| arquivo | linhas |\n|---|---|\n| main.rs | 3 |\n\nVeja \`src/app.tsx\` e [a doc](https://example.com/doc).`, 160);
  void wid;
}

const handlers: Record<string, (a: any) => unknown> = {
  repos_list: () => db.repos.map((r) => ({ ...r })),
  repo_add: ({ path }) => {
    const r = { id: id(), name: path.split("/").filter(Boolean).pop(), path, default_branch: "main" };
    db.repos.push(r);
    return r;
  },
  repo_clone: ({ url }) => handlers.repo_add({ path: "/mock/repos/" + url.split("/").pop().replace(".git", "") }),
  repo_remove: ({ id: rid }) => void (db.repos = db.repos.filter((r) => r.id !== rid)),
  repo_settings: () => ({ settings: db.repoSettings, layers: [{ name: "usuário", path: "~/.kabul/settings.toml", found: false }, { name: "repo", path: ".kabul/settings.toml", found: true }, { name: "repo local", path: ".kabul/settings.local.toml", found: false }, { name: "gerenciado", path: "~/.kabul/settings.managed.toml", found: false }] }),
  repo_settings_save: ({ settings }) => ((db.repoSettings = settings), ".kabul/settings.local.toml"),
  // Cópias, como num transporte de verdade (o React precisa ver objetos novos).
  workspaces_list: () => db.workspaces.map((w) => ({ ...w })),
  workspace_create: ({ repoId }) => {
    const used = db.workspaces.map((w) => w.name);
    const name = CITIES.find((c) => !used.includes(c)) ?? `ws${seq}`;
    const w = { id: id(), repo_id: repoId, name, branch: `dev/${name}`, path: `/mock/ws/${name}`, archived: false, created_at: now(), title: null, status: "in-progress", state: "setting_up", pinned: false, notes: "", port: 41000 + db.workspaces.length * 10, target_branch: null, pr_url: null, archive_checkpoint: null, user_set_branch: false, files_copied: 1 };
    db.workspaces.push(w);
    db.changed[w.id] = {};
    setTimeout(() => ((w.state = "ready"), emit("workspace-state", { id: w.id, state: "ready" })), 400);
    return w;
  },
  workspace_update: ({ id: wid, patch }) => Object.assign(ws(wid), Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => [k, k === "section" && v === "" ? null : v]))),
  workspace_rename_branch: ({ id: wid, name }) => Object.assign(ws(wid), { branch: name, user_set_branch: true }),
  workspace_auto_branch: ({ workspaceId, text }) => {
    const w = ws(workspaceId);
    if (w.user_set_branch || !w.branch.endsWith("/" + w.name)) return null;
    w.branch = "dev/" + text.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean).slice(0, 5).join("-");
    return w;
  },
  workspace_archive: ({ id: wid, closePr }) => { if (closePr && db.pr[wid]) db.pr[wid].state = "CLOSED"; Object.assign(ws(wid), { archived: true, state: "archived", archive_checkpoint: "archive-" + wid }); },
  workspace_unarchive: ({ id: wid }) => Object.assign(ws(wid), { archived: false, state: "ready" }),
  workspace_changes: ({ workspaceId, scope }) => (scope === "branch" ? changes(workspaceId).filter((c) => !c.untracked) : changes(workspaceId)),
  workspace_file_diff: ({ workspaceId, path, ignoreWs }) => {
    const body = (db.changed[workspaceId]?.[path] ?? "").replace(/\n$/, "");
    const old = (db.files[path] ?? "").replace(/\n$/, "").split("\n");
    const neu = body.split("\n");
    const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${old.length} +1,${neu.length} @@`];
    // Diff simples linha a linha (o suficiente para o mock): iguais viram contexto.
    const n = Math.max(old.length, neu.length);
    for (let i = 0; i < n; i++) {
      const a = old[i], b = neu[i];
      if (a === b || (ignoreWs && a !== undefined && b !== undefined && a.replace(/\s+/g, "") === b.replace(/\s+/g, ""))) out.push(" " + (b ?? a));
      else { if (a !== undefined && db.files[path] !== undefined) out.push("-" + a); if (b !== undefined) out.push("+" + b); }
    }
    return out.join("\n");
  },
  git_status: ({ workspaceId }) => ({ branch: ws(workspaceId).branch, target: ws(workspaceId).target_branch ?? "main", upstream: db.git[workspaceId]?.upstream ?? null, dirty: changes(workspaceId).length, ahead: db.git[workspaceId]?.ahead ?? 0, behind: db.git[workspaceId]?.behind ?? 0, behind_target: db.git[workspaceId]?.behind_target ?? 0, conflicts: db.git[workspaceId]?.conflicts ?? [] }),
  git_pull: ({ workspaceId }) => ((db.git[workspaceId] = { ...(db.git[workspaceId] ?? {}), behind: 0 }), { ok: true, dry_run: false, commands: [`git pull --no-rebase --no-edit origin ${ws(workspaceId).branch}`], output: "Already up to date." }),
  git_push: ({ workspaceId }) => ((db.git[workspaceId] = { ...(db.git[workspaceId] ?? {}), ahead: 0, upstream: "origin/" + ws(workspaceId).branch }), { ok: true, dry_run: false, commands: ["git push -u origin HEAD"], output: "" }),
  workspace_discard: ({ workspaceId, path }) => void delete db.changed[workspaceId]?.[path],
  workspace_grep: ({ query }) => Object.entries(db.files).flatMap(([p, body]) => body.split("\n").map((t, i) => ({ path: p, line: i + 1, text: t })).filter((h) => query && h.text.toLowerCase().includes(String(query).toLowerCase()))),
  pr_view: ({ workspaceId }) => db.pr[workspaceId] ?? null,
  pr_merge: ({ workspaceId }) => { const p = db.pr[workspaceId]; if (p) p.state = "MERGED"; ws(workspaceId).status = "done"; const rs = db.repoSettings as any; if (rs.archive_on_merge ?? db.settings.archive_on_merge) handlers.workspace_archive({ id: workspaceId }); return { ok: true, dry_run: false, commands: [`gh pr merge --${db.settings.merge_method}`], output: "" }; },
  pr_ready: ({ workspaceId }) => { const p = db.pr[workspaceId]; if (p) (p.is_draft = false, p.merge_state = "CLEAN"); return { ok: true, dry_run: false, commands: ["gh pr ready"], output: "" }; },
  pr_edit: ({ workspaceId, title, body }) => { Object.assign(db.pr[workspaceId] ?? {}, { title, body }); return { ok: true, dry_run: false, commands: ["gh pr edit --title …"], output: "" }; },
  checks_rerun: ({ links }) => ({ ok: true, dry_run: true, commands: [...new Set((links as string[]).map((l) => /runs\/(\d+)/.exec(l)?.[1]).filter(Boolean))].map((r) => `gh run rerun ${r} --failed`), output: "" }),
  check_log: ({ link }) => `Run npm run lint\nsrc/app.tsx:12:3  error  'x' is assigned a value but never used  no-unused-vars\n✖ 1 problem (1 error, 0 warnings)\nProcess completed with exit code 1. (${link})`,
  sections_list: () => db.sections,
  section_save: ({ section }) => { const s = { ...section, id: section.id || id(), order: section.id ? section.order : db.sections.length }; db.sections = [...db.sections.filter((x: any) => x.id !== s.id), s].sort((a: any, b: any) => a.order - b.order); return s; },
  section_delete: ({ id: sid }) => { db.sections = db.sections.filter((x: any) => x.id !== sid); db.workspaces.forEach((w) => w.section === sid && (w.section = null)); },
  repo_update: ({ id: rid, hidden, icon }) => Object.assign(db.repos.find((r) => r.id === rid), hidden === undefined ? {} : { hidden }, icon === undefined ? {} : { icon: icon || null }),
  repo_env_layers: () => [["repo", { API_URL: "http://localhost:$KABUL_PORT", LOG: "info" }], ["repo local", { LOG: "debug" }]],
  gh_repos: () => [
    { name_with_owner: "dev/demo-app", owner: "dev", private: true, updated_at: "2026-10-20T10:00:00Z", url: "https://github.com/dev/demo-app", description: "App de demonstração", avatar: "" },
    { name_with_owner: "acme/site", owner: "acme", private: false, updated_at: "2026-10-18T10:00:00Z", url: "https://github.com/acme/site", description: null, avatar: "" },
    { name_with_owner: "dev/dotfiles", owner: "dev", private: false, updated_at: "2026-09-01T10:00:00Z", url: "https://github.com/dev/dotfiles", description: "configs", avatar: "" },
  ],
  repo_clone_to: async ({ input, dir }) => {
    const name = String(input).replace(/\.git$/, "").split(/[/:]/).pop();
    if (name === "nao-existe") throw new Error("Repositório não encontrado. Confira a URL e se a conta do GitHub conectada tem acesso.");
    for (const [phase, pct] of [["Receiving objects", 40], ["Receiving objects", 100], ["Resolving deltas", 100]] as const) {
      emit("clone-progress", { phase, pct });
      await new Promise((r) => setTimeout(r, 60));
    }
    db.settings.clone_dir = dir;
    return handlers.repo_add({ path: `${String(dir).replace(/\/$/, "")}/${name}` });
  },
  repo_quick_start: ({ name, dir }) => ((db.settings.clone_dir = dir), handlers.repo_add({ path: `${String(dir).replace(/\/$/, "")}/${name}` })),
  git_identity: () => ({ ...{ name: "Dev", email: "dev@example.com", scope: "global", global_name: "Dev", global_email: "dev@example.com" }, ...(db as any).identity }),
  git_identity_set: ({ name, email }) => ((db as any).identity = name || email ? { name, email, scope: "repo" } : {}, handlers.git_identity({})),
  repo_remotes: () => ["origin", "upstream"],
  pr_open_url: ({ workspaceId, prUrl }) => { const t = db.settings.open_prs_in; const w = ws(workspaceId); if (t === "linear" && w.linear) return w.linear.url; if (t === "graphite") { const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl); if (m) return `https://app.graphite.dev/github/pr/${m[1]}/${m[2]}/${m[3]}`; } return prUrl; },
  diagnostics: () => ({ checks: [{ group: "Essenciais", name: "git", ok: true, detail: "git version 2.50 (/usr/bin/git)" }, { group: "Essenciais", name: "tmux", ok: true, detail: "tmux 3.5" }, { group: "Agentes", name: "Qwen Code", ok: false, detail: "não encontrado no PATH" }, { group: "Ambiente", name: "HOME", ok: true, detail: "/home/dev" }], report: "Kabul — diagnóstico\n✓ git\nHOME /home/dev", redacted: "Kabul — diagnóstico\n✓ git\nHOME ~" }),
  app_quit: () => void ((window as any).__quit = true),
  open_devtools: () => void ((window as any).__devtools = true),
  machine_info: () => ({ name: "Mac de Dev", user: { login: "dev", email: "dev@example.com", avatar: null } }),
  sound_play: ({ name }) => void ((window as any).__sound = name),
  workspace_files: () => [...Object.keys(db.files), ".gitignore", "Cargo.toml", "src/app.tsx", "src/styles.css", "docs/guia.md", ".context/notes.md"],
  workspace_read_file: ({ path }) => db.files[path] ?? "",
  workspace_busy: () => "clean",
  workspaces_stats: () => Object.fromEntries(db.workspaces.map((w) => [w.id, [changes(w.id).reduce((a, c) => a + c.added, 0), 0]])),
  workspace_diff: () => ({ base: "abc123", base_ref: "main", stat: "", patch: "" }),
  workspace_pr: ({ options }) => ({ url: options.dry_run ? null : "https://github.com/x/y/pull/1", dry_run: options.dry_run, commands: ["git push -u origin HEAD", `gh pr create --base main --title '${options.title}'${options.draft ? " --draft" : ""}`] }),
  comments_list: ({ workspaceId }) => db.comments.filter((c) => c.workspace_id === workspaceId),
  comment_add: ({ workspaceId, path, line, endLine, body }) => {
    const c = { id: id(), workspace_id: workspaceId, path, line, end_line: endLine, body, resolved: false, created_at: now() };
    db.comments.push(c);
    return c;
  },
  comment_update: ({ id: cid, resolved, delete: del }) => {
    if (del) db.comments = db.comments.filter((c) => c.id !== cid);
    else Object.assign(db.comments.find((c) => c.id === cid) ?? {}, { resolved });
  },
  checkpoints_list: ({ workspaceId }) => db.checkpoints[workspaceId] ?? [],
  checkpoint_create: ({ workspaceId, message }) => {
    const c = { id: id(), commit: "c" + seq, head: "h", message, created_at: now(), snapshot: { ...(db.changed[workspaceId] ?? {}) } };
    (db.checkpoints[workspaceId] ??= []).unshift(c);
    return c;
  },
  checkpoint_restore: ({ workspaceId, id: cid }) => void (db.changed[workspaceId] = { ...(db.checkpoints[workspaceId].find((c) => c.id === cid)?.snapshot ?? {}) }),
  attach_file: ({ path }) => ".context/attachments/" + path.split("/").pop(),
  attach_bytes: ({ name }) => ".context/attachments/" + name,
  pick_file: () => "/mock/Downloads/especificacao.pdf",
  pick_folder: () => (window as any).__mock?.pickFolder ?? "/mock/repos/demo",
  script_run: ({ workspaceId, which, runId }) => {
    const s = `kabul-${ws(workspaceId).name}-${which}${runId ? "-" + runId : ""}`;
    setTimeout(() => emit("term-output", { session: s, pane: "%9", data: [...new TextEncoder().encode(`$ ${which === "setup" ? "echo instalando" : "npm run dev"}\r\n[kabul] saiu com 0\r\n`)] }), 100);
    return s;
  },
  script_stop: () => undefined,
  term_open: ({ workspaceId, name }) => ({ session: name ?? `kabul-${ws(workspaceId).name}`, pane: "%1", snapshot: "dev@mac " + ws(workspaceId).name + " % " }),
  term_input: ({ session, pane, data }) => {
    const out = data === "\r" ? "\r\nmock: comando executado\r\nval@mac % " : data;
    emit("term-output", { session, pane, data: [...new TextEncoder().encode(out)] });
  },
  term_resize: () => undefined,
  term_close: () => undefined,
  models_list: () => models,
  local_overview: () => ({ memory: 34359738368, harnesses: [["claude", true, ""], ["codex", true, ""], ["antigravity", true, ""], ["opencode", true, ""], ["qwen", false, "npm install -g @qwen-code/qwen-code"], ["gemini", false, "npm install -g @google/gemini-cli"]], sources: [
    { id: "ollama", name: "Ollama", kind: "runtime", base_url: "http://127.0.0.1:11434", installed: false, running: false, apis: ["openai"], models: [], can_start: false, can_pull: true, pull_hint: "ex.: qwen3-coder:30b", custom: false },
    { id: "lmstudio", name: "LM Studio", kind: "runtime", base_url: "http://127.0.0.1:1234", installed: true, running: true, apis: ["openai", "anthropic"], models: [{ id: "qwen3-8b", name: "Qwen3 8B", source: "lmstudio", size_bytes: 4623782544, quant: "4bit", params: "8B", context: 40960, loaded: true }], can_start: true, can_pull: true, pull_hint: "ex.: qwen/qwen3-coder-30b", custom: false },
    ...db.endpoints.map((e) => ({ ...e, kind: "endpoint", installed: true, running: false, models: [], can_start: false, can_pull: false, pull_hint: "", custom: true })),
  ] }),
  local_endpoint_save: ({ endpoint }) => void db.endpoints.push(endpoint),
  local_endpoint_remove: ({ id: eid }) => void (db.endpoints = db.endpoints.filter((e) => e.id !== eid)),
  local_pull: ({ model }) => "kabul-pull-" + model,
  local_start: () => undefined,
  harness_install: ({ kind }) => "kabul-install-" + kind,
  registry_get: () => db.registry || '{\n  "version": 1,\n  "families": [\n    { "family": "qwen", "match": ["qwen"], "harnesses": ["qwen", "opencode"] },\n    { "family": "outros", "match": [], "harnesses": ["opencode"] }\n  ]\n}',
  registry_save: ({ text }) => {
    JSON.parse(text);
    db.registry = text;
  },
  registry_reset: () => void (db.registry = ""),
  chat_start: ({ model }) => {
    const cid = id();
    db.chats[cid] = { pending: null, turn: 0 };
    return { chat_id: cid, harness: model.harness, approvals: model.harness !== "opencode", note: model.local?.note ?? null };
  },
  chat_send: ({ chatId, text }) => agentTurn(chatId, text, ""),
  chat_approve: ({ chatId, allow, updatedInput }) => {
    const ev = (e: unknown, t: number) => setTimeout(() => emit("chat-event", { chat_id: chatId, event: e }), t);
    const pend = db.chats[chatId]?.pending;
    if (pend === "ExitPlanMode" || pend === "AskUserQuestion") {
      db.chats[chatId].pending = null;
      const msg = pend === "ExitPlanMode" ? (allow ? "Executando o plano." : "Ok, ajusto o plano.") : allow ? `Respostas: ${Object.values(updatedInput?.answers ?? {}).join(", ")}` : "Sem respostas.";
      ev({ type: "text", text: msg }, 60);
      ev({ type: "turn_completed", result: null, input_tokens: 15000, output_tokens: 30, cost_usd: 0.02 }, 100);
      return;
    }
    ev({ type: "tool_result", id: "t1-" + db.chats[chatId].turn, output: allow ? "arquivo criado" : "negado pelo usuário", is_error: !allow }, 60);
    ev({ type: "text", text: allow ? "Criei `ok.txt`." : "Ok, não criei o arquivo." }, 120);
    ev({ type: "turn_completed", result: null, input_tokens: 15000, output_tokens: 30, cost_usd: 0.02 }, 160);
    if (allow) for (const w of db.workspaces) (db.changed[w.id] ??= {})["ok.txt"] = "ok\n";
  },
  chat_stop: () => undefined,
  history_list: ({ workspaceId }) => Object.values(db.history).filter((h: any) => h.workspace_id === workspaceId).map((h: any) => ({ id: h.id, title: h.title, model_key: h.model_key, updated_at: h.updated_at })),
  history_load: ({ id: hid }) => {
    if (!db.history[hid]) throw new Error("sessão não encontrada");
    return db.history[hid];
  },
  history_save: ({ record }) => void (db.history[record.id] = record),
  history_delete: ({ id: hid }) => void delete db.history[hid],
  history_search: ({ q }) => Object.values(db.history).filter((h: any) => JSON.stringify(h.items).toLowerCase().includes(q.toLowerCase())).map((h: any) => [h.workspace_id, h.id, h.title, q]),
  slash_commands: () => [["/compact", "resumir a conversa"], ["/review", "revisar as mudanças"], ["/plan", "alternar plan mode"]],
  sessions_list: () => ({ tmux: [{ session: "kabul-kabul", window_index: 0, pane_index: 0, pane_id: "%1", pid: 1, command: "zsh", path: "/mock/ws/kabul", active: true, title: "", agent: "shell" }], imported_workspaces: [], imported_sessions: [{ id: "c1", workspace_id: null, status: "idle", title: "Sessão importada", model: "opus", agent_type: "claude", updated_at: null }], imported_error: null }),
  auth_status: () => ["claude", "codex", "antigravity", "opencode", "qwen", "gemini"].map((k) => ({ kind: k, logged_in: !["qwen", "gemini"].includes(k), source: "mock", method: null, error: null, installed: !["qwen", "gemini"].includes(k) })),
  auth_login: ({ kind }) => {
    emit("auth-event", { kind, event: { Url: "https://claude.ai/oauth/authorize?mock=1" } });
    emit("auth-event", { kind, event: "PedeCodigo" });
  },
  auth_code: ({ kind }) => emit("auth-event", { kind, event: "Ok" }),
  auth_cancel: () => undefined,
  app_settings_get: () => db.settings,
  app_settings_save: ({ settings }) => void (db.settings = settings),
  notify: () => undefined,
  accounts_list: ({ provider }) => [{ id: `${provider}:sistema`, provider, nickname: "Padrão do sistema", email: null, plan: null, dir: null, default: !db.accounts.some((a: any) => a.provider === provider && a.default), logged_in: true, env_var: "CLAUDE_CONFIG_DIR", env_confirmed: true }, ...db.accounts.filter((a: any) => a.provider === provider)],
  account_add: ({ provider, nickname }) => { const a = { id: `${provider}:${id()}`, provider, nickname, email: null, plan: null, dir: `/mock/accounts/${provider}`, default: false, logged_in: false, env_var: "CLAUDE_CONFIG_DIR", env_confirmed: true }; db.accounts.push(a); return a; },
  account_update: ({ id: aid, nickname, makeDefault, remove }) => {
    if (remove) return void (db.accounts = db.accounts.filter((a: any) => a.id !== aid));
    const a = db.accounts.find((x: any) => x.id === aid);
    if (a && nickname) a.nickname = nickname;
    if (makeDefault) db.accounts.forEach((x: any) => (x.default = x.id === aid));
  },
  account_login: ({ id: aid }) => { emit("account-auth-event", { id: aid, event: { Url: "https://claude.ai/oauth/authorize?mock=1" } }); emit("account-auth-event", { id: aid, event: "PedeCodigo" }); },
  account_code: ({ id: aid }) => { const a = db.accounts.find((x: any) => x.id === aid); if (a) (a.logged_in = true, a.email = "dev2@example.com"); emit("account-auth-event", { id: aid, event: "Ok" }); },
  account_cancel: () => undefined,
  repo_branches: () => ["main", "dev/login-safari", "feat/relatorio-pdf"],
  repo_prs: () => [{ number: 42, title: "Corrige login no Safari", headRefName: "dev/login-safari", author: { login: "dev" }, isDraft: false, url: "https://github.com/x/y/pull/42" }],
  workspace_create_ex: ({ repoId, branch, pr, prHead, base }) => { const w: any = handlers.workspace_create({ repoId }); if (branch || pr) Object.assign(w, { branch: branch ?? prHead, user_set_branch: true }); if (base) w.target_branch = base; return w; },
  cloud_start: ({ prompt }) => ({ tmux: "kabul-kabul-cloud-1", info: { id: "session_01MockCloud", url: "https://claude.ai/code/session_01MockCloud?from=cli", title: String(prompt).slice(0, 40), warning: "Branch val/kabul is not on GitHub, so the cloud session starts from the newest commit beneath it that origin/main has.", exited: 0 } }),
  cloud_poll: () => ({ id: "session_01MockCloud", url: "https://claude.ai/code/session_01MockCloud?from=cli", title: "mock", warning: null, exited: 0 }),
  teleport: ({ id }) => `kabul-kabul-teleport-${String(id).slice(-6)}`,
  term_run: ({ name }) => `kabul-kabul-${name}`,
  mirror_status: () => ({ running: db.mirror, tmux: "kabul-kabul-mirror", link: db.mirror ? "https://claude.ai/code/session_01Mirror" : null }),
  mirror_start: () => ((db.mirror = true), { running: true, tmux: "kabul-kabul-mirror", link: "https://claude.ai/code/session_01Mirror" }),
  mirror_stop: () => void (db.mirror = false),
  workspace_fork: ({ workspaceId }) => { const src = ws(workspaceId); const w: any = handlers.workspace_create({ repoId: src.repo_id }); w.title = `${src.title ?? src.name} (fork)`; return w; },
  github_status: () => db.ghAccounts.map((a: any) => ({ ...a })),
  github_login: () => {
    emit("github-auth-event", { Codigo: "ABCD-1234" });
    emit("github-auth-event", { Url: "https://github.com/login/device" });
    setTimeout(() => { db.ghAccounts = [...db.ghAccounts, { host: "github.com", login: "dev-dois", active: false, scopes: ["repo"], source: "keyring", ok: true }]; emit("github-auth-event", "Ok"); }, 300);
  },
  github_cancel: () => undefined,
  github_switch: ({ login }) => void db.ghAccounts.forEach((a: any) => (a.active = a.login === login)),
  github_token: ({ token }) => ((db.ghToken = !!token), !!token),
  github_token_set: () => db.ghToken,
  github_repo_access: () => ({ slug: "dev/demo", ok: false, permission: null, message: "Missing GitHub access: a conta ativa não acessa dev/demo." }),
  mcp_list: () => [{ name: "linear", scope: "user", source: "~/.claude.json", transport: "http", target: "https://mcp.linear.app/mcp" }, { name: "docs", scope: "project", source: ".mcp.json", transport: "stdio", target: "npx -y docs-mcp" }],
  mcp_add: () => undefined,
  linear_status: () => ({ connected: db.linear, who: db.linear ? "Dev · Acme" : null, error: null }),
  linear_connect: ({ key }) => { if (!String(key).startsWith("lin_api_")) throw new Error("Linear: chave inválida"); db.linear = true; return "Dev · Acme"; },
  linear_disconnect: () => void (db.linear = false),
  linear_issues: ({ search }) => [{ id: "i1", identifier: "ENG-12", title: "Corrigir login no Safari", url: "https://linear.app/acme/issue/ENG-12", description: "O botão de login some no Safari 18.", state: "Todo", branchName: "dev/eng-12-corrigir-login-no-safari", priority: "High", assignee: "Dev", team: "ENG" }, { id: "i2", identifier: "ENG-15", title: "Exportar relatório em PDF", url: "https://linear.app/acme/issue/ENG-15", description: null, state: "In Progress", branchName: "dev/eng-15-exportar-relatorio", priority: "Medium", assignee: "Dev", team: "ENG" }].filter((i) => !search || (i.identifier + i.title).toLowerCase().includes(String(search).toLowerCase())),
  workspace_from_issue: ({ repoId, issue }) => { const w: any = handlers.workspace_create({ repoId }); Object.assign(w, { branch: issue.branchName, title: `${issue.identifier} ${issue.title}`, linear: { identifier: issue.identifier, title: issue.title, url: issue.url }, user_set_branch: true }); return w; },
  open_targets: () => [
    { id: "finder", name: "Finder", kind: "finder", app: "/System/Library/CoreServices/Finder.app", icon: null },
    { id: "vscode", name: "VS Code", kind: "editor", app: "/Applications/Visual Studio Code.app", icon: null },
    { id: "terminal", name: "Terminal", kind: "terminal", app: "/System/Applications/Utilities/Terminal.app", icon: null },
  ],
  open_in: ({ target, path }) => void ((window as any).__opened = `${target}:${path}`),
  pr_checks: () => (db as any).checks ?? ({ checks: [{ name: "build", state: "SUCCESS", bucket: "pass", link: "https://github.com/dev/demo/actions/runs/101/job/1", workflow: "CI", required: true }, { name: "e2e", state: "IN_PROGRESS", bucket: "pending", link: "https://github.com/dev/demo/actions/runs/101/job/2", workflow: "CI", required: true }, { name: "lint", state: "FAILURE", bucket: "fail", link: "https://github.com/dev/demo/actions/runs/102/job/3", workflow: "CI", required: true }], message: null }),
  open_external: ({ target }) => void ((window as any).__external = target),
  transcribe: () => "texto ditado de teste",
};

// Ganchos para os testes montarem estados de git/PR sem backend.
if (typeof window !== "undefined") (window as any).__mock = {
  db,
  pr: (wid: string | null, p: any) => { const w = wid ?? db.workspaces[0]?.id; db.pr[w] = p && { number: 7, title: "Corrige login", body: "Descrição do PR", url: "https://github.com/dev/demo/pull/7", state: "OPEN", is_draft: false, mergeable: "MERGEABLE", merge_state: "CLEAN", review_decision: "", head: ws(w)?.branch, base: "main", comments: [], ...p }; },
  git: (wid: string | null, g: any) => { const w = wid ?? db.workspaces[0]?.id; db.git[w] = { ...(db.git[w] ?? {}), ...g }; },
  emit: (channel: string, payload: unknown) => emit(channel, payload),
  change: (wid: string | null, path: string, body: string) => { const w = wid ?? db.workspaces[0]?.id; (db.changed[w] ??= {})[path] = body; },
};

export const mockTransport: Transport = {
  async call<T>(command: string, args?: Record<string, unknown>) {
    ((window as any).__calls ??= []).push(command);
    const h = handlers[command];
    if (!h) throw new Error(`mock: comando desconhecido ${command}`);
    await new Promise((r) => setTimeout(r, 15));
    return (await h(args ?? {})) as T;
  },
  subscribe(channel, handler) {
    const s = subs.get(channel) ?? new Set();
    s.add(handler as H);
    subs.set(channel, s);
    return () => s.delete(handler as H);
  },
};
