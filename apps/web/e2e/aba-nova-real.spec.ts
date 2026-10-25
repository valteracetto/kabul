import { test, expect } from "../playwright-silencio";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fluxo do app instalado com o backend REAL (`kabul serve`) e um agy de mentira (KABUL_BIN_AGY):
// workspace com conversa → reabrir o app → "+" → Nova conversa → enviar com o Gemini → resposta.
const KABUL = join(process.cwd(), "../../target/debug/kabul");
const AGY = join(process.cwd(), "e2e/fixtures/agy-falso.sh");
// Desloca junto com a porta do Vite (KABUL_E2E_PORT) para worktrees em paralelo não dividirem o servidor.
const PORT = 7795 + (Number(process.env.KABUL_E2E_PORT ?? 5174) - 5174);
let srv: ChildProcess;
let dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kabul-aba-"));
  const repo = join(dir, "repo");
  mkdirSync(join(dir, "casa"));
  execSync(`mkdir -p ${repo} && cd ${repo} && git init -q -b main && echo oi > a.txt && git add . && git -c user.name=t -c user.email=t@t commit -qm i`);
  // HOME isolado: o projeto do agy por workspace é gravado em ~/.gemini.
  srv = spawn(KABUL, ["serve", "--port", String(PORT), "--home", join(dir, "home")], { stdio: "inherit", env: { ...process.env, HOME: join(dir, "casa"), KABUL_PICK_FOLDER: repo, KABUL_BIN_AGY: AGY } });
  for (let i = 0; i < 300; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: "POST", body: "{}" }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.afterAll(() => srv?.kill());

test("backend real: workspace com conversa, reabrir, '+' → Nova conversa e enviar com o Gemini", async ({ page }) => {
  const warn: string[] = [];
  page.on("console", (m) => void (/Maximum update depth/.test(m.text()) && warn.push(m.text())));
  await page.addInitScript(() => localStorage.setItem("kabul.modelPrefs", JSON.stringify({ favorites: ["agy:gemini-9-teste"], selected: "agy:gemini-9-teste", effort: "low", fast: false })));
  await page.goto(`/?http=http://127.0.0.1:${PORT}`);
  await page.getByTestId("create-ws").click();
  await page.getByTestId("add-open").click();
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("new-ws-repo").click();
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1, { timeout: 20_000 });
  const host = page.locator(".ws-host:not([hidden])");
  const chat = page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
  await chat.getByTestId("composer").fill("primeira");
  await chat.getByTestId("composer").press("Enter");
  await expect(chat.locator(".msg-assistant").last()).toContainText("resposta 1 do gemini de teste", { timeout: 20_000 });
  await expect(chat.locator(".turn-meta")).toHaveCount(1);

  // Reabre o app (workspace existente com conversa) e abre uma aba nova pelo "+".
  await page.reload();
  await page.getByTestId("ws-row").first().click();
  await expect(host.getByTestId("ctab")).toHaveCount(1);
  await host.getByTestId("new-tab").click();
  await expect(page.getByTestId("new-chat")).toBeVisible();
  await page.getByTestId("new-chat").click();
  await expect(host.getByTestId("ctab")).toHaveCount(2);
  await chat.getByTestId("composer").fill("na aba nova");
  await chat.getByTestId("composer").press("Enter");
  await expect(chat.locator(".msg-assistant").last()).toContainText("do gemini de teste", { timeout: 20_000 });
  await expect(chat.locator(".turn-meta")).toHaveCount(1);
  expect(warn).toEqual([]);
});
