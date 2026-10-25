import { test, expect } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// E2E com o agy DE VERDADE (via `kabul serve`): comando negado no modo headless vira cartão de
// aprovação; "Permitir uma vez" grava a regra no projeto do agy do workspace, o agente continua e a
// regra sai no fim do turno. Pula se o agy não estiver instalado ou logado.
const KABUL = join(process.cwd(), "../../target/debug/kabul");
const AGY_TOKEN = join(homedir(), ".gemini/antigravity-cli/antigravity-oauth-token");
const hasAgy = (() => {
  try {
    execSync("command -v agy", { stdio: "ignore" });
    return existsSync(AGY_TOKEN);
  } catch {
    return false;
  }
})();
const PORT = 7793;
let srv: ChildProcess;
let dir: string;

/** Mesmo id do core (`antigravity::project_id`): FNV-1a 64 do caminho do workspace. */
function projectId(cwd: string) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(cwd)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return "kabul-" + h.toString(16).padStart(16, "0");
}

test.skip(!hasAgy, "agy não instalado ou não logado");

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kabul-agy-"));
  const repo = join(dir, "repo");
  execSync(`mkdir -p ${repo} && cd ${repo} && git init -q -b main && echo oi > a.txt && git add . && git -c user.name=t -c user.email=t@t commit -qm i`);
  srv = spawn(KABUL, ["serve", "--port", String(PORT), "--home", join(dir, "home")], { stdio: "inherit", env: { ...process.env, KABUL_PICK_FOLDER: repo } });
  for (let i = 0; i < 300; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: "POST", body: "{}" }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.afterAll(() => srv?.kill());

test("agy real: comando negado vira cartão; permitir uma vez grava a regra no projeto, continua e tira a regra", async ({ page }) => {
  test.setTimeout(600_000);
  const models = (await (await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: "POST", body: JSON.stringify({ command: "models_list", args: {} }) })).json()).value as { key: string; harness: string }[];
  const agy = models.filter((m) => m.harness === "antigravity");
  const key = (agy.find((m) => /flash/.test(m.key)) ?? agy[0])?.key;
  test.skip(!key, "sem modelos do agy");
  await page.addInitScript((k) => localStorage.setItem("kabul.modelPrefs", JSON.stringify({ favorites: [k], selected: k, effort: "low", fast: false })), key);
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("create-ws").click();
  await page.getByTestId("add-open").click();
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-repo").click();
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("ws-row").first().click();
  const wsPath = join(dir, "home/workspaces/repo/kabul");
  const proj = join(homedir(), ".gemini/config/projects", projectId(wsPath) + ".json");
  try {
    const chat = page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
    await chat.getByTestId("composer").fill("Rode no terminal exatamente o comando `echo kabul-e2e-ok` (use a ferramenta de terminal) e depois me diga a saída em uma frase.");
    await chat.getByTestId("composer").press("Enter");
    const card = chat.getByTestId("approval").last();
    await expect(card).toBeVisible({ timeout: 300_000 });
    await expect(card).toHaveAttribute("data-rule", /^command\(echo/);
    await expect(card).toContainText("Rodar este comando?");
    await expect(card).toContainText("kabul-e2e-ok");
    await page.screenshot({ path: "../../.context/e2e/agy-aprovacao.png" });
    // O projeto do agy deste workspace existe e ainda não tem a regra.
    expect(existsSync(proj)).toBe(true);
    await card.getByRole("button", { name: /Permitir uma vez/ }).click();
    await expect(card).toContainText("Aprovado");
    await expect(chat.locator(".turn-meta")).toHaveCount(1, { timeout: 300_000 });
    await expect(chat.locator(".md").last()).toContainText("kabul-e2e-ok");
    // "Uma vez": a regra saiu do projeto no fim do turno.
    const allow = JSON.parse(readFileSync(proj, "utf8")).permissionGrants?.permissionGrants?.allow ?? [];
    expect(allow).toEqual([]);
    // Cartão da ferramenta com nome e parâmetros (Bash com o comando), não "tool" com JSON cru.
    const steps = chat.getByTestId("expand-steps");
    if (await steps.count()) await steps.first().click();
    await expect(chat.locator('[data-tool="Bash"]').first()).toContainText("echo kabul-e2e-ok");
    await expect(chat.locator('[data-tool="tool"]')).toHaveCount(0);
    await page.screenshot({ path: "../../.context/e2e/agy-continuou.png" });
  } finally {
    rmSync(proj, { force: true });
  }
});
