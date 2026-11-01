/* i18n-ignore-file: backend de mentira; dados 100% sintéticos (home /Users/dev, repositório fictício). */
import type { ToolFinding, ToolItem, ToolItemDetail, ToolPlacement, ToolRoot, ToolScope, ToolSource, ToolsSnapshot } from "../api";

/**
 * Ferramentas no mock (comandos `tools_*`): um home sintético com os casos que a tela precisa mostrar —
 * link saudável para a pasta canônica, cópia duplicada, cópia divergente, órfã, link quebrado, plugin
 * com versão velha, hook que roda código, MCP sem versão fixa e com placeholder, item de projeto, conta
 * isolada e itens geridos (embutidos/plugin). Carregado só no primeiro `tools_*`.
 */
export interface ToolsMock { handlers: Record<string, (a: any) => unknown> }

const LABEL: Record<string, string> = { shared: ".agents", claude: "Claude Code", codex: "Codex", gemini: "Gemini CLI", qwen: "Qwen Code", goose: "Goose", cursor: "Cursor", copilot: "GitHub Copilot CLI", other: "other" };
const ORDER = ["shared", "claude", "codex", "gemini", "agy", "antigravity", "qwen", "opencode", "goose", "cursor", "copilot", "vscode", "windsurf", "other"];

type P = Partial<ToolPlacement> & { harness: string; path: string };
const pl = (p: P): ToolPlacement => ({ scope: "global", link: { kind: "real" }, format: "skill-md", canonical: p.harness === "shared", managed: false, ...p });
const link = (target: string) => ({ kind: "symlink" as const, target });
const broken = (target: string) => ({ kind: "broken" as const, target });

const SKILL_BODY = (name: string, desc: string) => `# ${name}\n\n${desc}\n\n## When to use\n\n- Before writing new code for a feature or bug fix.\n- When a change needs a safety net.\n\n## Steps\n\n1. Write a failing test that describes the behavior.\n2. Make it pass with the smallest change.\n3. Refactor with the tests green.\n\n\`\`\`bash\nnpm test -- --watch\n\`\`\`\n`;

function baseItems(repo: { id: string; name: string }): ToolItem[] {
  const proj = (p: P): ToolPlacement => pl({ scope: "project", repoId: repo.id, repo: repo.name, ...p });
  const it = (x: Partial<ToolItem> & { id: string; kind: ToolItem["kind"]; name: string; placements: ToolPlacement[] }): ToolItem => ({ categories: ["other"], extras: {}, harnesses: [], findingIds: [], risks: [], invoke: [], favorite: false, status: "ok", ...x });
  return [
    it({
      id: "skill:test-driven-development", kind: "skill", name: "test-driven-development", description: "Write the test first, watch it fail, then write the minimal code to pass. Use when implementing any feature or bugfix.", purpose: "Write the test first, watch it fail, then write the minimal code to pass", categories: ["testing", "dev"], sourceId: "gh:acme/agent-skills", weightTokens: 1450,
      extras: { name: "test-driven-development", license: "MIT" },
      placements: [
        pl({ harness: "shared", path: "~/.agents/skills/test-driven-development", hash: "a1b2c3d4e5f6", sourceId: "gh:acme/agent-skills", mtime: 1_760_000_000 }),
        pl({ harness: "claude", path: "~/.claude/skills/test-driven-development", link: link("../../.agents/skills/test-driven-development"), hash: "a1b2c3d4e5f6" }),
        pl({ harness: "codex", path: "~/.codex/skills/test-driven-development", link: link("../../.agents/skills/test-driven-development"), hash: "a1b2c3d4e5f6" }),
        pl({ harness: "cursor", path: "~/.cursor/skills/test-driven-development", link: link("../../.agents/skills/test-driven-development"), hash: "a1b2c3d4e5f6" }),
      ],
      invoke: [{ harness: "claude", how: "slash", text: "/test-driven-development" }, { harness: "codex", how: "dollar", text: "$test-driven-development" }, { harness: "cursor", how: "auto", text: "test-driven-development" }],
    }),
    it({
      id: "skill:deploy-checklist", kind: "skill", name: "deploy-checklist", description: "Checklist before shipping to production: migrations, feature flags, rollback plan.", purpose: "Checklist before shipping to production: migrations, feature flags, rollback plan", categories: ["cloud", "planning"], sourceId: "local", weightTokens: 820, risks: ["scripts"],
      placements: [
        pl({ harness: "claude", path: "~/.claude/skills/deploy-checklist", hash: "d1d1d1d1d1d1" }),
        pl({ harness: "claude", account: "Trabalho", path: "~/Library/Application Support/kabul/accounts/claude/a1/skills/deploy-checklist", hash: "d1d1d1d1d1d1" }),
        pl({ harness: "codex", path: "~/.codex/skills/deploy-checklist", hash: "d1d1d1d1d1d1" }),
        pl({ harness: "gemini", path: "~/.gemini/skills/deploy-checklist", hash: "d1d1d1d1d1d1" }),
      ],
      invoke: [{ harness: "claude", how: "slash", text: "/deploy-checklist" }, { harness: "codex", how: "dollar", text: "$deploy-checklist" }, { harness: "gemini", how: "auto", text: "deploy-checklist" }],
    }),
    it({
      id: "skill:code-review", kind: "skill", name: "code-review", description: "Review a diff for bugs, missing tests and risky changes.", purpose: "Review a diff for bugs, missing tests and risky changes", categories: ["review"], sourceId: "local", weightTokens: 960,
      placements: [pl({ harness: "claude", path: "~/.claude/skills/code-review", hash: "c0ffee000001" }), pl({ harness: "cursor", path: "~/.cursor/skills/code-review", hash: "c0ffee000002" })],
      invoke: [{ harness: "claude", how: "slash", text: "/code-review" }, { harness: "cursor", how: "auto", text: "code-review" }],
    }),
    it({
      id: "skill:release-notes", kind: "skill", name: "release-notes", description: "Draft release notes from merged pull requests.", purpose: "Draft release notes from merged pull requests", categories: ["docs", "git"], sourceId: "gh:acme/agent-skills", weightTokens: 640,
      placements: [pl({ harness: "shared", path: "~/.agents/skills/release-notes", hash: "feed00000001", sourceId: "gh:acme/agent-skills" })],
      invoke: [],
    }),
    it({
      id: "skill:prd-writer", kind: "skill", name: "prd-writer", categories: ["planning"], sourceId: "local",
      placements: [pl({ harness: "qwen", path: "~/.qwen/skills/prd-writer", link: broken("../../.agents/skills/prd-writer") }), pl({ harness: "goose", path: "~/.config/goose/skills/prd-writer", link: broken("../../../.agents/skills/prd-writer") })],
      invoke: [{ harness: "qwen", how: "auto", text: "prd-writer" }],
    }),
    it({
      id: "skill:data-explorer", kind: "skill", name: "data-explorer", description: "Explore CSV and JSON files with quick summaries.", purpose: "Explore CSV and JSON files with quick summaries", categories: ["data"], sourceId: "builtin:codex",
      placements: [pl({ harness: "codex", path: "~/.codex/skills/.system/data-explorer", format: "skill-md-builtin", managed: true })],
      invoke: [{ harness: "codex", how: "dollar", text: "$data-explorer" }],
    }),
    it({
      id: "skill:migrations-guide", kind: "skill", name: "migrations-guide", description: "How this team writes and reviews database migrations.", purpose: "How this team writes and reviews database migrations", categories: ["data", "docs"], sourceId: "project", weightTokens: 1100,
      placements: [proj({ harness: "claude", path: `~/code/${repo.name}/.claude/skills/migrations-guide`, hash: "aaaa00000001" })],
      invoke: [{ harness: "claude", how: "slash", text: "/migrations-guide" }],
    }),
    it({
      id: "skill:acme-tools:lint-fix", kind: "skill", name: "lint-fix", description: "Fix lint errors across the workspace using the project config.", purpose: "Fix lint errors across the workspace using the project config", categories: ["review", "dev"], sourceId: "mkt:acme-marketplace",
      placements: [pl({ harness: "claude", plugin: "acme-tools@acme-marketplace", managed: true, path: "~/.claude/plugins/cache/acme-marketplace/acme-tools/2.1.0/skills/lint-fix", sourceId: "mkt:acme-marketplace" })],
      invoke: [{ harness: "claude", how: "slash", text: "/acme-tools:lint-fix" }],
    }),
    it({
      id: "command:commit", kind: "command", name: "commit", description: "Write a conventional commit message for the staged changes.", purpose: "Write a conventional commit message for the staged changes", categories: ["git"], sourceId: "local", weightTokens: 210,
      placements: [pl({ harness: "claude", path: "~/.claude/commands/commit.md", format: "command-md", hash: "0c0c0c0c0c0c" })],
      invoke: [{ harness: "claude", how: "slash", text: "/commit" }],
    }),
    it({
      id: "command:git:sync", kind: "command", name: "git:sync", description: "Fetch, rebase on the target branch and push.", purpose: "Fetch, rebase on the target branch and push", categories: ["git"], sourceId: "local",
      placements: [pl({ harness: "claude", path: "~/.claude/commands/git/sync.md", format: "command-md" }), pl({ harness: "gemini", path: "~/.gemini/commands/git/sync.toml", format: "command-toml" })],
      invoke: [{ harness: "claude", how: "slash", text: "/git:sync" }, { harness: "gemini", how: "slash", text: "/git:sync" }],
    }),
    it({
      id: "prompt:explain", kind: "prompt", name: "explain", description: "Explain the selected code step by step.", purpose: "Explain the selected code step by step", categories: ["docs"], sourceId: "local",
      placements: [pl({ harness: "codex", path: "~/.codex/prompts/explain.md", format: "prompt-md" })],
      invoke: [{ harness: "codex", how: "slash", text: "/prompts:explain" }],
    }),
    it({
      id: "agent:security-reviewer", kind: "agent", name: "security-reviewer", description: "Subagent that checks changes for secrets, injection and unsafe defaults.", purpose: "Subagent that checks changes for secrets, injection and unsafe defaults", categories: ["security", "review"], sourceId: "project", extras: { tools: "Read, Grep", model: "inherit" },
      placements: [proj({ harness: "claude", path: `~/code/${repo.name}/.claude/agents/security-reviewer.md`, format: "agent-md" })],
      invoke: [{ harness: "claude", how: "mention", text: "@agent-security-reviewer" }],
    }),
    it({
      id: "plugin:acme-tools@acme-marketplace", kind: "plugin", name: "acme-tools", description: "Lint, format and release helpers for Acme projects.", purpose: "Lint, format and release helpers for Acme projects", categories: ["dev"], sourceId: "mkt:acme-marketplace", extras: { scope: "user", author: "Acme", license: "MIT", commit: "9f8e7d6c5b4a" },
      placements: [pl({ harness: "claude", path: "~/.claude/plugins/cache/acme-marketplace/acme-tools/2.1.0", format: "claude-plugin", version: "2.1.0", enabled: true, sourceId: "mkt:acme-marketplace" })],
    }),
    it({
      id: "hook:notify-done", kind: "hook", name: "notify-done", categories: ["productivity"], sourceId: "tool:notifier", risks: ["runsCode"], extras: { events: "Stop, Notification", command: "~/.notifier/bin/notify-done --sound •••" },
      placements: [pl({ harness: "claude", path: "~/.claude/settings.json", format: "hooks-json", sourceId: "tool:notifier" })],
    }),
    it({
      id: "mcp:docs-search", kind: "mcp", name: "docs-search", categories: ["docs"], sourceId: "local", risks: ["unpinned"], extras: { transport: "stdio", target: "npx -y docs-search-mcp" },
      placements: [pl({ harness: "claude", path: "~/.claude.json", format: "mcp-json", enabled: true }), pl({ harness: "cursor", path: "~/.cursor/mcp.json", format: "mcp-json", enabled: true })],
      invoke: [{ harness: "claude", how: "tool", text: "mcp__docs-search__*" }, { harness: "cursor", how: "tool", text: "docs-search" }],
    }),
    it({
      id: "mcp:issue-tracker", kind: "mcp", name: "issue-tracker", categories: ["planning"], sourceId: "local", risks: ["placeholder"], extras: { transport: "stdio", target: "issue-tracker-mcp --stdio", env: "ISSUE_TRACKER_TOKEN" },
      placements: [pl({ harness: "codex", path: "~/.codex/config.toml", format: "mcp-toml", enabled: true })],
      invoke: [{ harness: "codex", how: "tool", text: "issue-tracker" }],
    }),
    it({
      id: "mcp:design-api", kind: "mcp", name: "design-api", categories: ["design"], sourceId: "project", risks: ["network"], extras: { transport: "http", target: "https://mcp.design.example/mcp" },
      placements: [proj({ harness: "claude", path: `~/code/${repo.name}/.mcp.json`, format: "mcp-json", enabled: true })],
      invoke: [{ harness: "claude", how: "tool", text: "mcp__design-api__*" }],
    }),
    it({
      id: "extension:acme-gemini", kind: "extension", name: "acme-gemini", description: "Acme commands and context for Gemini CLI.", purpose: "Acme commands and context for Gemini CLI", categories: ["agents"], sourceId: "gh:acme/gemini-extension", extras: { contextFile: "GEMINI.md" },
      placements: [pl({ harness: "gemini", path: "~/.gemini/extensions/acme-gemini", format: "extension-json", version: "0.3.0", sourceId: "gh:acme/gemini-extension" })],
    }),
    it({
      id: `instructions:${repo.name}:AGENTS.md`, kind: "instructions", name: "AGENTS.md", description: "Project conventions: run the tests before committing, keep PRs small.", purpose: "Project conventions: run the tests before committing, keep PRs small", categories: ["docs"], sourceId: "project", weightTokens: 380,
      placements: [proj({ harness: "shared", path: `~/code/${repo.name}/AGENTS.md`, format: "instructions-md", canonical: false })],
    }),
    it({
      id: "foreign:obsidian", kind: "foreign", name: "Obsidian", categories: ["other"], sourceId: "project", extras: { plugins: "dataview, calendar" },
      placements: [proj({ harness: "other", path: `~/code/${repo.name}/.obsidian`, format: "foreign", canonical: false })],
    }),
  ];
}

function sources(): ToolSource[] {
  const s = (x: Partial<ToolSource> & { id: string; kind: ToolSource["kind"]; label: string }): ToolSource => ({ itemIds: [], footprint: [], exists: true, ...x });
  return [
    s({ id: "gh:acme/agent-skills", kind: "skillsLock", label: "acme/agent-skills", repo: "acme/agent-skills", url: "https://github.com/acme/agent-skills", commit: "4e5f6a7b8c9d", installedAt: "2026-05-02T10:00:00Z", updatedAt: "2026-10-01T09:30:00Z", footprint: [{ kind: "registry", label: ".skill-lock.json", path: "~/.agents/.skill-lock.json" }] }),
    s({ id: "mkt:acme-marketplace", kind: "marketplace", label: "acme-marketplace", repo: "acme/plugins", url: "https://github.com/acme/plugins", updatedAt: "2026-10-20T08:00:00Z", footprint: [{ kind: "dir", label: "marketplace", path: "~/.claude/plugins/marketplaces/acme-marketplace" }] }),
    s({ id: "gh:acme/gemini-extension", kind: "gitRepo", label: "acme/gemini-extension", repo: "acme/gemini-extension", url: "https://github.com/acme/gemini-extension" }),
    s({
      id: "tool:notifier", kind: "nativeIntegration", label: "notifier", version: "1.4.0", installedAt: "2026-09-12T14:00:00Z",
      footprint: [{ kind: "dir", label: "notifier", path: "~/.notifier" }, { kind: "binary", label: "notify-done", path: "~/.notifier/bin/notify-done" }, { kind: "npm", label: "@acme/notifier@1.4.0", path: "/usr/local/lib/node_modules/@acme/notifier" }, { kind: "hook", label: "notify-done · Claude Code" }, { kind: "settings", label: "settings.json", path: "~/.claude/settings.json" }],
    }),
    s({ id: "builtin:codex", kind: "builtin", label: "Codex" }),
    s({ id: "local", kind: "local", label: "local" }),
    s({ id: "project", kind: "project", label: "project" }),
  ];
}

function findings(repoId: string): ToolFinding[] {
  const f = (id: string, kind: ToolFinding["kind"], severity: ToolFinding["severity"], itemIds: string[], paths: string[] = [], args: Record<string, string> = {}): ToolFinding => ({ id, kind, severity, itemIds, paths, args });
  return [
    f("brokenLink:1", "brokenLink", "error", ["skill:prd-writer"], ["~/.qwen/skills/prd-writer"], { target: "../../.agents/skills/prd-writer", harness: "qwen" }),
    f("brokenLink:2", "brokenLink", "error", ["skill:prd-writer"], ["~/.config/goose/skills/prd-writer"], { target: "../../../.agents/skills/prd-writer", harness: "goose" }),
    f("duplicateCopy:1", "duplicateCopy", "warn", ["skill:deploy-checklist"], ["~/.claude/skills/deploy-checklist", "~/.codex/skills/deploy-checklist", "~/.gemini/skills/deploy-checklist"], { copies: "4", harnesses: "3", versions: "1" }),
    f("drift:1", "drift", "warn", ["skill:code-review"], ["~/.claude/skills/code-review", "~/.cursor/skills/code-review"], { copies: "2", harnesses: "2", versions: "2" }),
    f("orphan:1", "orphan", "warn", ["skill:release-notes"], ["~/.agents/skills/release-notes"]),
    f("placeholder:1", "placeholder", "warn", ["mcp:issue-tracker"], ["~/.codex/config.toml"]),
    f("unpinnedMcp:1", "unpinnedMcp", "info", ["mcp:docs-search"], [], { target: "npx -y docs-search-mcp" }),
    f("hookRunsCode:1", "hookRunsCode", "info", ["hook:notify-done"], ["~/.claude/settings.json"], { events: "Stop, Notification" }),
    f("stalePluginVersion:1", "stalePluginVersion", "info", ["plugin:acme-tools@acme-marketplace"], ["~/.claude/plugins/cache/acme-marketplace/acme-tools/1.9.0", "~/.claude/plugins/cache/acme-marketplace/acme-tools/2.0.0"], { count: "2", plugin: "acme-tools" }),
    f("missingDescription:1", "missingDescription", "info", ["skill:prd-writer"]),
    f("parseError:1", "parseError", "warn", [], ["~/.qwen/settings.json"], { detail: "expected value at line 4 column 3", harness: "qwen" }),
    f("nestedRepo:1", "nestedRepo", "info", [], ["~/code/acme-web/vendor-libs/ui-kit"], { count: "1", repo: "acme-web", repoId }),
  ];
}

function roots(repo: { name: string }): ToolRoot[] {
  const r = (harness: string, what: string, path: string, status: ToolRoot["status"], count: number, x: Partial<ToolRoot> = {}): ToolRoot => ({ harness, what, path, status, count, ...x });
  return [
    r("shared", "skills", "~/.agents/skills", "ok", 2),
    r("shared", "lock", "~/.agents/.skill-lock.json", "ok", 2),
    r("claude", "skills", "~/.claude/skills", "ok", 3),
    r("claude", "commands", "~/.claude/commands", "ok", 2),
    r("claude", "agents", "~/.claude/agents", "missing", 0),
    r("claude", "plugins", "~/.claude/plugins", "ok", 2),
    r("claude", "mcp", "~/.claude.json", "ok", 1),
    r("claude", "hooks", "~/.claude/settings.json", "ok", 1),
    r("claude", "skills", "~/Library/Application Support/kabul/accounts/claude/a1/skills", "ok", 1, { account: "Trabalho", env: "CLAUDE_CONFIG_DIR" }),
    r("codex", "skills", "~/.codex/skills", "ok", 3),
    r("codex", "prompts", "~/.codex/prompts", "ok", 1),
    r("codex", "mcp", "~/.codex/config.toml", "ok", 1),
    r("gemini", "skills", "~/.gemini/skills", "ok", 1),
    r("gemini", "commands", "~/.gemini/commands", "ok", 1),
    r("gemini", "extensions", "~/.gemini/extensions", "ok", 1),
    r("qwen", "skills", "~/.qwen/skills", "ok", 1),
    r("goose", "skills", "~/.config/goose/skills", "ok", 1),
    r("cursor", "skills", "~/.cursor/skills", "ok", 2),
    r("cursor", "mcp", "~/.cursor/mcp.json", "ok", 1),
    r("copilot", "base", "~/.copilot", "missing", 0),
    r("claude", "skills", `~/code/${repo.name}/.claude/skills`, "ok", 1, { repo: repo.name }),
    r("claude", "mcp", `~/code/${repo.name}/.mcp.json`, "ok", 1, { repo: repo.name }),
  ];
}

const inScope = (p: ToolPlacement, scope: ToolScope, repoId: string | null) => scope === "all" || p.scope === "global" || (scope === "repo" && !!repoId && p.repoId === repoId);

export function makeToolsMock({ repoOf }: { repoOf: (workspaceId: string | null) => { id: string; name: string } | null }): ToolsMock {
  const prefs = { favorites: new Set<string>(), notes: new Map<string, string>() };
  let generatedAt = Date.now();
  const fallback = { id: "repo-acme-web", name: "acme-web" };
  const snapshot = (scope: ToolScope, workspaceId: string | null): ToolsSnapshot => {
    const cur = repoOf(workspaceId);
    const repo = cur ?? fallback;
    const repoId = scope === "repo" ? (cur?.id ?? null) : null;
    const all = baseItems(repo);
    const items = all
      .map((i) => ({ ...i, placements: i.placements.filter((p) => inScope(p, scope, repoId)) }))
      .filter((i) => i.placements.length > 0)
      .map((i) => ({ ...i, harnesses: [...new Set(i.placements.map((p) => p.harness))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)), favorite: prefs.favorites.has(i.id), note: prefs.notes.get(i.id) }));
    const ids = new Set(items.map((i) => i.id));
    const fs = findings(repo.id).filter((f) => (f.itemIds.length ? f.itemIds.some((x) => ids.has(x)) : !f.args.repoId || scope === "all" || f.args.repoId === repoId));
    const rank = { info: 1, warn: 2, error: 3 } as const;
    for (const i of items) {
      const mine = fs.filter((f) => f.itemIds.includes(i.id));
      i.findingIds = mine.map((f) => f.id);
      i.status = mine.reduce<ToolItem["status"]>((w, f) => (w === "ok" || rank[f.severity] > rank[w as keyof typeof rank] ? f.severity : w), "ok");
    }
    const srcs = sources().map((s) => ({ ...s, itemIds: items.filter((i) => i.sourceId === s.id).map((i) => i.id) })).filter((s) => s.itemIds.length || (s.footprint.length && scope !== "repo"));
    const counts = new Map<string, number>();
    items.forEach((i) => i.harnesses.forEach((h) => counts.set(h, (counts.get(h) ?? 0) + 1)));
    const harnesses = [...counts].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])).map(([id, count]) => ({ id, label: LABEL[id] ?? id, count }));
    const rs = roots(repo).filter((r) => scope === "all" || !r.repo || scope === "repo");
    return { schema: 1, generatedAt, scanMs: 42, stale: false, scope, repoId: repoId ?? undefined, harnesses, roots: rs, items, sources: srcs, findings: fs };
  };
  const detail = (id: string, workspaceId: string | null): ToolItemDetail | null => {
    const snap = snapshot("all", workspaceId);
    const item = snap.items.find((i) => i.id === id);
    if (!item) return null;
    const main = item.placements.find((p) => p.link.kind !== "broken") ?? item.placements[0];
    const abs = main.path.replace(/^~/, "/Users/dev");
    const isSkill = item.kind === "skill";
    const conf = item.kind === "mcp" || item.kind === "hook" || item.kind === "plugin";
    const body = conf || main.link.kind === "broken" ? undefined : isSkill || item.kind === "command" || item.kind === "agent" || item.kind === "prompt" || item.kind === "instructions" ? SKILL_BODY(item.name, item.description ?? "") : undefined;
    return {
      item, body, truncated: false, frontmatter: body ? { name: item.name, description: item.description ?? "", ...item.extras } : {},
      files: isSkill && body ? ["SKILL.md", "references/checklist.md", "scripts/run.sh"] : [],
      absPath: isSkill ? `${abs}/SKILL.md` : abs,
      findings: snap.findings.filter((f) => f.itemIds.includes(id)),
      source: snap.sources.find((s) => s.id === item.sourceId),
    };
  };
  return {
    handlers: {
      tools_snapshot: ({ scope, workspaceId, refresh }) => {
        const w = window as any;
        if (refresh) ((generatedAt = Date.now()), (w.__toolsRefreshed = (w.__toolsRefreshed ?? 0) + 1));
        return snapshot((scope as ToolScope) ?? "all", workspaceId ?? null);
      },
      tools_item: ({ id, workspaceId }) => detail(id, workspaceId ?? null),
      tools_prefs_set: ({ id, favorite, note }) => {
        if (favorite === true) prefs.favorites.add(id);
        if (favorite === false) prefs.favorites.delete(id);
        if (typeof note === "string") (note.trim() ? prefs.notes.set(id, note.trim()) : prefs.notes.delete(id));
        ((window as any).__toolsPrefs ??= []).push({ id, favorite, note });
        return { favorites: [...prefs.favorites], notes: Object.fromEntries(prefs.notes) };
      },
    },
  };
}
