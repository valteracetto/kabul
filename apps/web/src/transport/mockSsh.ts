/* i18n-ignore-file: backend de mentira; os textos imitam dados e erros do backend (pt-BR). */
/**
 * Hosts SSH no mock: um `~/.ssh/config` sintético (domínios e IPs de documentação, usuário `dev`) com
 * `Include`, curingas, `Match` e um arquivo incluído. O parser de verdade é o do core (testes Rust); aqui
 * o config é gerado a partir da lista, e a prévia/gravação seguem o mesmo contrato (diff + digest).
 *
 * `window.__mock.sshScenario`: "default" | "empty" (sem config) | "windows" (caminhos do Windows).
 * `window.__ssh`: estado para os testes (`backups`, `opened`, `terminals`, `keygen`).
 */
type Host = {
  alias: string; file: string; file_display: string; line: number; siblings: string[]; hostname: string | null; user: string | null; port: string | null; identity_files: string[];
  proxy_jump: string | null; proxy_command: string | null; forward_agent: string | null; local_forwards: string[]; remote_forwards: string[]; other: [string, string][]; comment: string | null; conditional: boolean;
};
type Form = { alias: string; hostname?: string | null; user?: string | null; port?: string | null; identity_file?: string | null; proxy_jump?: string | null };

const w = () => window as any;
const scenario = (): string => w().__mock?.sshScenario ?? "default";
const win = () => scenario() === "windows";
const HOME = () => (win() ? "C:\\Users\\dev" : "/home/dev");
const sep = () => (win() ? "\\" : "/");
const MAIN = () => `${HOME()}${sep()}.ssh${sep()}config`;
const INC = () => `${HOME()}${sep()}.ssh${sep()}config.d${sep()}lab.conf`;
const key = (n: string) => (win() ? `C:\\Users\\dev\\.ssh\\${n}` : `~/.ssh/${n}`);

const blank = (alias: string, file: "main" | "inc", p: Partial<Host> = {}): Host => ({ alias, file, file_display: "", line: 0, siblings: [], hostname: null, user: null, port: null, identity_files: [], proxy_jump: null, proxy_command: null, forward_agent: null, local_forwards: [], remote_forwards: [], other: [], comment: null, conditional: false, ...p });

let st: { hosts: Host[]; exists: boolean; scenario: string } | null = null;
function state() {
  if (st && st.scenario === scenario()) return st;
  const empty = scenario() === "empty";
  st = {
    scenario: scenario(),
    exists: !empty,
    hosts: empty ? [] : [
      blank("web-prod", "main", { hostname: "203.0.113.10", user: "deploy", identity_files: [key("id_ed25519")], comment: "Servidor de produção (exemplo)", forward_agent: "no" }),
      blank("staging", "main", { hostname: "staging.example.com", user: "dev", port: "2222", identity_files: [key("staging_admin")], local_forwards: ["5433 localhost:5432"] }),
      blank("db", "main", { siblings: ["db-primary"], hostname: "198.51.100.20", user: "postgres", proxy_jump: "bastion" }),
      blank("db-primary", "main", { siblings: ["db"], hostname: "198.51.100.20", user: "postgres", proxy_jump: "bastion" }),
      blank("bastion", "main", { hostname: "bastion.example.net", user: "ops", other: [["ServerAliveInterval", "30"]] }),
      blank("lab-gpu", "inc", { hostname: "192.0.2.50", user: "dev", identity_files: [key("lab_auto")] }),
      blank("lab/cpu", "inc", { hostname: "192.0.2.51" }),
    ],
  };
  return st;
}

const display = (f: "main" | "inc" | string) => (f === "main" || f === MAIN() ? "~/.ssh/config" : "~/.ssh/config.d/lab.conf");
const pathOf = (f: string) => (f === "main" ? MAIN() : f === "inc" ? INC() : f);

/** Texto do arquivo e a linha do `Host` de cada alias. */
function render(hosts: Host[], file: "main" | "inc"): { text: string; lines: Record<string, number> } {
  const out: string[] = [];
  const lines: Record<string, number> = {};
  if (file === "main") out.push("# Config de exemplo do Kabul (mock)", "Include config.d/*.conf", "");
  const seen = new Set<string>();
  for (const h of hosts.filter((x) => x.file === file)) {
    if (seen.has(h.alias)) continue;
    const group = [h.alias, ...h.siblings];
    group.forEach((a) => seen.add(a));
    if (h.comment) out.push(`# ${h.comment}`);
    group.forEach((a) => (lines[a] = out.length + 1));
    out.push(`Host ${group.join(" ")}`);
    const kv: [string, string | null][] = [["HostName", h.hostname], ["User", h.user], ["Port", h.port], ...h.identity_files.map((i): [string, string] => ["IdentityFile", i.includes(" ") ? `"${i}"` : i]), ["ProxyJump", h.proxy_jump], ["ForwardAgent", h.forward_agent], ...h.local_forwards.map((l): [string, string] => ["LocalForward", l]), ...h.other];
    for (const [k, v] of kv) if (v) out.push(`    ${k} ${v}`);
    out.push("");
  }
  if (file === "main") out.push("Host *.internal !bastion.internal", "    ProxyJump bastion", "", "Match host *.corp.example exec \"true\"", "    User corp", "", "Host *", "    AddKeysToAgent yes", "    ServerAliveInterval 60", "");
  return { text: out.join("\n"), lines };
}

function overview() {
  const s = state();
  const main = render(s.hosts, "main");
  const inc = render(s.hosts, "inc");
  const hosts = s.exists ? s.hosts.map((h) => ({ ...h, file: pathOf(h.file), file_display: display(h.file), line: (h.file === "main" ? main : inc).lines[h.alias] })) : [];
  return {
    config: MAIN(), config_display: "~/.ssh/config", config_exists: s.exists, ssh_dir_display: "~/.ssh",
    files: s.exists ? [{ path: MAIN(), display: "~/.ssh/config", exists: true, included_from: null, error: null }, { path: INC(), display: "~/.ssh/config.d/lab.conf", exists: true, included_from: "~/.ssh/config:2", error: null }] : [{ path: MAIN(), display: "~/.ssh/config", exists: false, included_from: null, error: null }],
    // Ordem do ssh: o Include vem no topo do config, então os hosts dele aparecem primeiro.
    hosts: [...hosts.filter((h) => h.file === INC()), ...hosts.filter((h) => h.file === MAIN())],
    rules: s.exists ? [
      { kind: "host", patterns: "*.internal !bastion.internal", file: MAIN(), file_display: "~/.ssh/config", line: main.text.split("\n").indexOf("Host *.internal !bastion.internal") + 1, directives: [["ProxyJump", "bastion"]] },
      { kind: "match", patterns: "host *.corp.example exec true", file: MAIN(), file_display: "~/.ssh/config", line: main.text.split("\n").findIndex((l) => l.startsWith("Match")) + 1, directives: [["User", "corp"]] },
      { kind: "host", patterns: "*", file: MAIN(), file_display: "~/.ssh/config", line: main.text.split("\n").indexOf("Host *") + 1, directives: [["AddKeysToAgent", "yes"], ["ServerAliveInterval", "60"]] },
    ] : [],
    warnings: [],
    ssh_available: true,
    keygen_available: true,
  };
}

function diff(a: string, b: string) {
  const x = a.split("\n"), y = b.split("\n");
  const n = x.length, m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const all: { op: string; text: string; old: number | null; new: number | null }[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) all.push({ op: " ", text: x[i], old: ++i, new: ++j });
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) all.push({ op: "+", text: y[j], old: null, new: ++j });
    else all.push({ op: "-", text: x[i], old: ++i, new: null });
  }
  const changed = all.map((d, k) => (d.op !== " " ? k : -1)).filter((k) => k >= 0);
  const out: typeof all = [];
  let skipped = false;
  all.forEach((d, k) => {
    if (d.op === " " && !changed.some((c) => Math.abs(c - k) <= 3)) return void (skipped = true);
    if (skipped && out.length) out.push({ op: "…", text: "", old: null, new: null });
    skipped = false;
    out.push(d);
  });
  return out;
}

function validate(f: Form): Form {
  const alias = (f.alias ?? "").trim();
  if (!alias) throw new Error("alias obrigatório");
  if (/[\s*?!#,'"]/.test(alias) || alias.startsWith("-")) throw new Error(`alias inválido: "${alias}"`);
  const c = (v?: string | null) => (v ?? "").trim() || null;
  const port = c(f.port);
  if (port && (!/^\d+$/.test(port) || +port < 1 || +port > 65535)) throw new Error(`porta inválida: ${port}`);
  return { alias, hostname: c(f.hostname), user: c(f.user), port, identity_file: c(f.identity_file), proxy_jump: c(f.proxy_jump) };
}

/** Lista nova depois da mudança (sem gravar) e o arquivo mexido. */
function transform(op: any): { hosts: Host[]; file: "main" | "inc" } {
  const s = state();
  const hosts = s.hosts.map((h) => ({ ...h, siblings: [...h.siblings], identity_files: [...h.identity_files] }));
  const taken = new Set(hosts.map((h) => h.alias));
  if (op.op === "add") {
    const f = validate(op.host);
    if (taken.has(f.alias)) throw new Error(`já existe um host ${f.alias}`);
    hosts.push(blank(f.alias, "main", { hostname: f.hostname ?? null, user: f.user ?? null, port: f.port ?? null, identity_files: f.identity_file ? [f.identity_file] : [], proxy_jump: f.proxy_jump ?? null }));
    return { hosts, file: "main" };
  }
  const file: "main" | "inc" = op.file === INC() ? "inc" : "main";
  const h = hosts.find((x) => x.alias === op.alias && x.file === file);
  if (!h) throw new Error(`o bloco de ${op.alias} mudou de lugar no arquivo: sincronize e tente de novo`);
  const group = hosts.filter((x) => x === h || h.siblings.includes(x.alias));
  if (op.op === "remove") {
    if (h.siblings.length) group.forEach((g) => (g.siblings = g.siblings.filter((a) => a !== op.alias)));
    return { hosts: hosts.filter((x) => x !== h), file };
  }
  const f = validate(op.host);
  if (f.alias !== op.alias && taken.has(f.alias)) throw new Error(`já existe um host ${f.alias}`);
  for (const g of group) {
    if (g === h) g.alias = f.alias;
    else g.siblings = g.siblings.map((a) => (a === op.alias ? f.alias : a));
    Object.assign(g, { hostname: f.hostname ?? null, user: f.user ?? null, port: f.port ?? null, proxy_jump: f.proxy_jump ?? null, identity_files: f.identity_file ? [f.identity_file, ...g.identity_files.slice(1)] : g.identity_files.slice(1) });
  }
  return { hosts, file };
}

const digestOf = (text: string | null) => (text === null ? "absent" : `d${text.length}:${[...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)}`);

function plan(op: any) {
  const s = state();
  const { hosts, file } = transform(op);
  const before = s.exists || file === "inc" ? render(s.hosts, file).text : "";
  const after = render(hosts, file).text;
  return { file: pathOf(file), file_display: display(file), creates: !s.exists && file === "main", before, after, diff: diff(before, after), digest: s.exists ? digestOf(before) : "absent" };
}

const tests: Record<string, { ok: boolean; kind: string; message: string; ms: number }> = {
  "web-prod": { ok: true, kind: "ok", message: "", ms: 84 },
  staging: { ok: false, kind: "permission_denied", message: "dev@staging.example.com: Permission denied (publickey).", ms: 412 },
  "lab-gpu": { ok: false, kind: "host_key_unknown", message: "No ED25519 host key is known for 192.0.2.50 and you have requested strict checking.\nHost key verification failed.", ms: 96 },
};

const keys = () => [
  { path: key("id_ed25519"), display: "~/.ssh/id_ed25519", has_private: true, has_public: true, kind: "ED25519", bits: 256, fingerprint: "SHA256:m6vzsXr9Kdn2bnMRntO9NyqNjIquGKKIXlzbEnX9xP4", comment: "dev@example" },
  { path: key("staging_admin"), display: "~/.ssh/staging_admin", has_private: true, has_public: true, kind: "RSA", bits: 3072, fingerprint: "SHA256:TIjol4qf8oRqlXTkMSpYL97wGu9uJSafnly6cvh49mY", comment: "dev@example" },
  { path: key("lab_auto"), display: "~/.ssh/lab_auto", has_private: true, has_public: false, kind: null, bits: null, fingerprint: null, comment: null },
  ...((w().__ssh?.keygen ?? []) as any[]),
];

export function makeSshMock() {
  w().__ssh ??= { backups: [] as string[], opened: [] as string[], terminals: [] as string[], keygen: [] as any[], tested: [] as string[] };
  const known = (alias: string) => {
    if (!state().hosts.some((h) => h.alias === alias)) throw new Error(`${alias} não está no ~/.ssh/config`);
  };
  const handlers: Record<string, (a: any) => unknown> = {
    ssh_hosts: () => overview(),
    ssh_effective: ({ aliases }: { aliases: string[] }) =>
      aliases.map((a) => {
        const h = state().hosts.find((x) => x.alias === a);
        return { alias: a, hostname: h?.hostname ?? a, user: h?.user ?? "dev", port: h?.port ?? "22", identity_files: h?.identity_files.length ? h.identity_files : ["~/.ssh/id_ed25519"], proxy_jump: h?.proxy_jump ?? null, proxy_command: null, forward_agent: h?.forward_agent ?? "no", error: null };
      }),
    ssh_test: async ({ alias }: { alias: string }) => {
      known(alias);
      w().__ssh.tested.push(alias);
      await new Promise((r) => setTimeout(r, w().__mock?.sshTestDelay ?? 120));
      const r = tests[alias] ?? { ok: false, kind: "timeout", message: `ssh: connect to host ${state().hosts.find((h) => h.alias === alias)?.hostname ?? alias} port 22: Operation timed out`, ms: 5003 };
      return { ...r, command: `ssh -o BatchMode=yes -o ConnectTimeout=5 ${alias} true` };
    },
    ssh_keys: () => keys(),
    ssh_preview: ({ op }: { op: any }) => plan(op),
    ssh_apply: ({ op, digest }: { op: any; digest: string }) => {
      const p = plan(op);
      if (p.digest !== digest) throw new Error(`${p.file_display} mudou desde a prévia: revise de novo antes de salvar`);
      const s = state();
      const backup = s.exists ? `${p.file}.bak-kabul-20261025-120000` : null;
      if (backup) w().__ssh.backups.push(backup);
      s.hosts = transform(op).hosts;
      s.exists = true;
      return { file: p.file, backup };
    },
    ssh_keygen: ({ name, comment }: { name: string; comment: string }) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error("nome de chave inválido: use letras, números, ponto, _ ou -");
      if (keys().some((k) => k.display === `~/.ssh/${name}`)) throw new Error(`~/.ssh/${name} já existe`);
      const k = { path: key(name), display: `~/.ssh/${name}`, has_private: true, has_public: true, kind: "ED25519", bits: 256, fingerprint: "SHA256:k4bUlM0cKdemoFingerprintSinteticoParaTeste12", comment };
      w().__ssh.keygen.push(k);
      return k;
    },
    ssh_terminal: ({ alias }: { alias: string }) => {
      known(alias);
      const s = `kabul-ssh-${alias.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      w().__ssh.terminals.push(s);
      return s;
    },
    ssh_open_targets: () => (win() ? [{ id: "wt", name: "Windows Terminal" }, { id: "vscode", name: "VS Code" }] : [{ id: "terminal", name: "Terminal" }, { id: "iterm", name: "iTerm" }, { id: "vscode", name: "VS Code" }]),
    ssh_open_in: ({ target, alias }: { target: string; alias: string }) => void (known(alias), w().__ssh.opened.push(`${target}:${alias}`)),
    ssh_pick_key: () => w().__mock?.sshPick ?? key("id_ed25519"),
  };
  return handlers;
}
