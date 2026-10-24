import { test, expect } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// E2E contra o backend REAL (kabul-core via `kabul serve`): git e worktrees de verdade.
const KABUL = join(process.cwd(), "../../target/debug/kabul");
let srv: ChildProcess;
let dir: string;
const PORT = 7791;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kabul-e2e-"));
  const repo = join(dir, "repo");
  execSync(`mkdir -p ${repo} && cd ${repo} && git init -q -b main && echo oi > a.txt && git add . && git -c user.name=t -c user.email=t@t commit -qm i`);
  srv = spawn(KABUL, ["serve", "--port", String(PORT), "--home", join(dir, "home")], { stdio: "inherit" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: "POST", body: "{}" }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.afterAll(() => srv?.kill());

test("arquivar e desarquivar com backend real", async ({ page }) => {
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("create-ws").click();
  await page.getByTestId("repo-path").fill(join(dir, "repo"));
  await page.getByTestId("repo-path").press("Enter");
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

  await page.getByText(/Arquivados \(1\)/).click();
  await page.getByTestId("unarchive").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  expect(execSync(`cat ${wsPath}/a.txt`).toString().trim()).toBe("mudanca");
});

test("GitHub real: conta do gh e aviso de acesso para repo sem remote", async ({ page }) => {
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("settings").click();
  await page.locator(".seg .rtab", { hasText: "Contas" }).click();
  const gh = execSync("gh auth status --json hosts --jq '.hosts[\"github.com\"][] | select(.active) | .login'").toString().trim();
  await expect(page.getByTestId("github")).toContainText(`@${gh}`);
  await page.locator(".side-nav button", { hasText: "Início" }).click();
  await page.locator('[data-testid^="new-ws-"]').first().click().catch(() => {});
  await page.getByTestId("create-go").click().catch(() => {});
  await page.getByTestId("ws-row").first().click();
  await expect(page.getByTestId("gh-warn")).toContainText("não tem remote origin");
});
