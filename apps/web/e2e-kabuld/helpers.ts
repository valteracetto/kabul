import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

/** kabuld real + estado sintético + sessões tmux de teste (`kabul-test-*`) + agente falso no PATH. */
export interface Kabuld {
  base: string;
  port: number;
  pairLink: string;
  dir: string;
  wsPath: string;
  repo: string;
  sessions: { claude: string; codex: string; cloud: string; shell: string };
  stop(): void;
}

const ROOT = resolve(process.cwd(), "../..");
export const KABULD = join(ROOT, "target/debug/kabuld");
export const DIST = resolve(process.cwd(), "dist");

export async function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

const tmux = (...args: string[]) => execFileSync("tmux", args, { stdio: "pipe" }).toString();

/** Só as sessões deste E2E (`kabul-test-kd-*`): outros testes podem estar usando `kabul-test-*`. */
export function killTestSessions(prefix = "kabul-test-kd-") {
  try {
    for (const s of tmux("list-sessions", "-F", "#{session_name}").split("\n")) if (s.startsWith(prefix)) tmux("kill-session", "-t", `=${s}`);
  } catch {}
}

export async function startKabuld(opts: { trustLocalBrowser?: boolean; repoName?: string; fakeHome?: boolean } = {}): Promise<Kabuld> {
  const dir = mkdtempSync(join(tmpdir(), "kabul-e2e-kd-"));
  const id = Math.random().toString(36).slice(2, 7);
  // Repo git e um worktree sintéticos.
  const repoName = opts.repoName ?? "app-exemplo";
  const repo = join(dir, repoName);
  const wsPath = join(dir, "workspaces", repoName, "lisboa");
  mkdirSync(repo, { recursive: true });
  execSync(`git init -q -b main && echo oi > a.txt && git add . && git -c user.name=t -c user.email=t@example.com commit -qm i && git worktree add -q -b dev/lisboa ${JSON.stringify(wsPath)}`, { cwd: repo });
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "state.json"),
    JSON.stringify({
      repos: [{ id: "r1", name: repoName, path: repo, default_branch: "main" }],
      workspaces: [{ id: "w1", repo_id: "r1", name: "lisboa", branch: "dev/lisboa", path: wsPath, archived: false, created_at: 0, title: "Login novo", status: "in-progress", state: "ready", pinned: false, notes: "", port: 0 }],
    }),
  );
  // Agente falso para o chat (claude stream-json) e "TUIs" para o espelho do tmux.
  const bin = join(dir, "bin");
  const tui = join(dir, "tui");
  mkdirSync(bin);
  mkdirSync(tui);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec node ${JSON.stringify(resolve(process.cwd(), "e2e-kabuld/fake-claude.mjs"))} "$@"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  symlinkSync("/bin/cat", join(tui, "claude"));
  symlinkSync("/bin/cat", join(tui, "codex"));

  // HOME falso com uma sessão sintética do Claude Code feita fora do Kabul (no worktree do workspace).
  const fakeHome = join(dir, "userhome");
  if (opts.fakeHome) {
    const proj = join(fakeHome, ".claude", "projects", "exemplo");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "aaaa-1111-fora.jsonl"), [
      JSON.stringify({ type: "user", cwd: wsPath, gitBranch: "dev/lisboa", sessionId: "aaaa-1111-fora", message: { role: "user", content: "arrumar o login" } }),
      JSON.stringify({ type: "ai-title", aiTitle: "Arrumar o login (de fora)", sessionId: "aaaa-1111-fora" }),
    ].join("\n") + "\n");
  }
  const port = await freePort();
  const env = { ...process.env, ...(opts.fakeHome ? { HOME: fakeHome } : {}), PATH: `${bin}:${process.env.PATH}`, KABULD_TRUST_LOCAL_BROWSER: opts.trustLocalBrowser === false ? "0" : "1", KABULD_VAPID_SUBJECT: "mailto:e2e@example.com" };
  const proc: ChildProcess = spawn(KABULD, ["--port", String(port), "--home", home, "--web", DIST, "--no-tailscale", "--secrets", "file", "--pair"], { env, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  const pairLink = await new Promise<string>((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`kabuld não subiu: ${err}`)), 20_000);
    proc.stderr!.on("data", (b: Buffer) => {
      err += b.toString();
      const m = err.match(/link de pareamento[^:]*: (\S+)/);
      if (m) (clearTimeout(t), ok(m[1]));
    });
    proc.on("exit", (c) => fail(new Error(`kabuld saiu (${c}): ${err}`)));
  });

  // Sessões tmux de teste: cada "agente" é filho do shell do pane, como no uso real.
  const s = { claude: `kabul-test-kd-${id}-claude`, codex: `kabul-test-kd-${id}-codex`, cloud: `kabul-test-kd-${id}-cloud-1`, shell: `kabul-test-kd-${id}-shell` };
  tmux("new-session", "-d", "-x", "100", "-y", "30", "-s", s.claude, "-c", wsPath, `sh -c 'printf "Bash command\\n  npm test\\nDo you want to proceed?\\n> 1. Yes\\n  2. No\\n"; ${tui}/claude; exec sh'`);
  tmux("new-session", "-d", "-x", "100", "-y", "30", "-s", s.codex, "-c", repo, `sh -c 'printf "Would you like to run the following command?\\n  $ npm test\\n"; ${tui}/codex; exec sh'`);
  tmux("new-session", "-d", "-x", "100", "-y", "30", "-s", s.cloud, "-c", wsPath, "sh");
  tmux("new-session", "-d", "-x", "100", "-y", "30", "-s", s.shell, "-c", dir, "sh");
  // O monitor do kabuld varre a cada 1,5 s.
  await new Promise((r) => setTimeout(r, 2500));

  return {
    base: `http://127.0.0.1:${port}`,
    port,
    pairLink,
    dir,
    wsPath,
    repo,
    sessions: s,
    stop() {
      proc.kill();
      for (const name of Object.values(s)) {
        try {
          tmux("kill-session", "-t", `=${name}`);
        } catch {}
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

export function ensureBuilt() {
  // Sempre: é rápido quando nada mudou e evita testar um binário velho.
  execSync("cargo build -p kabuld", { cwd: ROOT, stdio: "inherit" });
  if (!existsSync(join(DIST, "index.html"))) execSync("npx vite build", { stdio: "inherit" });
}
