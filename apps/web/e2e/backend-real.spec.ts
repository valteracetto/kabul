import { test, expect } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// E2E contra o backend REAL (kabul-core via `kabul serve`): git e worktrees de verdade.
const KABUL = join(process.cwd(), "../../target/debug/kabul");
let srv: ChildProcess;
let dir: string;
// Desloca junto com a porta do Vite (KABUL_E2E_PORT) para worktrees em paralelo não dividirem o servidor.
const PORT = 7791 + (Number(process.env.KABUL_E2E_PORT ?? 5174) - 5174);

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kabul-e2e-"));
  const repo = join(dir, "repo");
  execSync(`mkdir -p ${repo} && cd ${repo} && git init -q -b main && echo oi > a.txt && git add . && git -c user.name=t -c user.email=t@t commit -qm i`);
  srv = spawn(KABUL, ["serve", "--port", String(PORT), "--home", join(dir, "home")], { stdio: "inherit", env: { ...process.env, KABUL_PICK_FOLDER: repo } });
  for (let i = 0; i < 300; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.afterAll(() => srv?.kill());

test("arquivar e desarquivar com backend real", async ({ page }) => {
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("create-ws").click();
  await page.getByTestId("add-open").click();
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-repo").click();
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  const wsPath = join(dir, "home/workspaces/repo/kabul");
  expect(existsSync(wsPath)).toBe(true);
  execSync(`echo mudanca > ${wsPath}/a.txt`);

  await page.getByTestId("ws-row").hover();
  await page.getByTestId("archive").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(0);
  expect(existsSync(wsPath)).toBe(false);
  await page.screenshot({ path: "../../.context/e2e/real-arquivado.png" });

  await page.getByTestId("group-menu").click();
  await page.getByTestId("view-archived").click();
  await page.getByTestId("palette").locator(".pop-row").first().click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  expect(execSync(`cat ${wsPath}/a.txt`).toString().trim()).toBe("mudanca");
});

test("GitHub real: conta do gh e aviso de acesso para repo sem remote", async ({ page }) => {
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-contas").click();
  const gh = execSync("gh auth status --json hosts --jq '.hosts[\"github.com\"][] | select(.active) | .login'").toString().trim();
  await expect(page.getByTestId("github")).toContainText(`@${gh}`);
  await page.locator(".side-nav button", { hasText: "Início" }).click();
  await page.locator('[data-testid^="new-ws-"]').first().click().catch(() => {});
  await page.getByTestId("create-go").click().catch(() => {});
  await page.getByTestId("ws-row").first().click();
  await expect(page.getByTestId("gh-warn")).toContainText("não tem remote origin");
});

test("clonar repo público pequeno do GitHub com o backend real", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("create-ws").click();
  await page.getByTestId("add-github").click();
  await page.getByTestId("clone-q").fill("octocat/Hello-World");
  await page.getByTestId("clone-dir").fill(join(dir, "clones"));
  await page.getByTestId("clone-go").click();
  await expect(page.getByTestId("clone-dialog")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByTestId("create-repo")).toContainText("Hello-World");
  expect(existsSync(join(dir, "clones/Hello-World/README"))).toBe(true);
  // Erro legível para repo que não existe.
  await page.getByTestId("create-repo").click();
  await page.getByTestId("add-project").click();
  await page.getByTestId("add-github").click();
  await page.getByTestId("clone-q").fill("octocat/repo-que-nao-existe-kabul");
  await page.getByTestId("clone-dir").fill(join(dir, "clones"));
  await page.getByTestId("clone-go").click();
  await expect(page.getByTestId("clone-error")).toContainText(/não encontrado|recusou o acesso/, { timeout: 60_000 });
});

test("Git real: branch base e remote do repo valem para o workspace novo; identidade grava no config do repo", async ({ page }) => {
  const repo = join(dir, "repo");
  execSync(`cd ${repo} && git checkout -q -b release && echo r > r.txt && git add . && git -c user.name=t -c user.email=t@t commit -qm r && git checkout -q main`);
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-git").click();
  await page.getByTestId("git-scope").getByText("repo", { exact: true }).click();
  await page.getByTestId("git-base").selectOption("release");
  await page.getByTestId("git-id-name").fill("Dev Kabul");
  await page.getByTestId("git-id-email").fill("dev@example.com");
  await page.getByTestId("git-id-save").click();
  await expect(page.getByTestId("git-identity")).toContainText("Definida neste repositório");
  expect(execSync(`git -C ${repo} config --local user.name`).toString().trim()).toBe("Dev Kabul");
  const state = () => JSON.parse(execSync(`cat ${join(dir, "home/state.json")}`).toString());
  const before = state().workspaces.length;
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-repo")).toContainText("repo");
  await page.getByTestId("create-go").click();
  await expect.poll(() => state().workspaces.length).toBe(before + 1);
  const w = state().workspaces[before];
  expect(existsSync(join(w.path, "r.txt"))).toBe(true);
  execSync(`git -C ${repo} config --local --unset user.name; git -C ${repo} config --local --unset user.email; rm -f ${repo}/.kabul/settings.local.toml`);
  // Ao reabrir, volta à última rota (o workspace recém-criado).
  await page.getByTestId("ws-row").last().click();
  const ws = await page.getByTestId("ws-row").last().getAttribute("data-ws");
  await page.reload();
  await expect(page.locator(`[data-ws="${ws}"]`)).toHaveClass(/ on/);
});

// Conversa real pelo mesmo caminho do app (core chat::start + pump), com o Antigravity.
const agyToken = join(homedir(), ".gemini/antigravity-cli/antigravity-oauth-token");
test("chat real com Antigravity (Gemini) pelo caminho do app; erro visível se o agente sair calado", async ({ page }) => {
  test.skip(!existsSync(agyToken) || !execSync("command -v agy || true").toString().trim(), "agy não está logado nesta máquina");
  test.setTimeout(150_000);
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-repo")).toContainText("repo");
  await page.getByTestId("create-go").click();
  const host = page.locator(".ws-host:not([hidden])");
  await expect(host.getByTestId("composer")).toBeVisible();
  await host.locator(".composer .picker-trigger").click();
  await page.locator(".picker-pop input").fill("argon");
  await page.locator(".picker-pop .pop-row.model").first().click();
  await expect(host.locator(".composer .picker-trigger")).toContainText("Argon");
  await host.getByTestId("composer").fill("Responda só a palavra: ok");
  await host.getByTestId("composer").press("Enter");
  await expect(host.locator(".msg-assistant").last()).toContainText(/ok/i, { timeout: 120_000 });
  await expect(host.locator(".turn-meta").last()).toBeVisible();
});
