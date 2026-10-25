import { test, expect } from "../playwright-silencio";
import { execFileSync } from "node:child_process";
import { startKabuld, tmux, TMUX_SOCKET, type Kabuld } from "./helpers";

// As sessões tmux dos testes vivem num servidor próprio (`tmux -L kabul-test-kd-<RUN>`), nunca no padrão de
// quem roda o teste: lá o Kabul de verdade as listava no celular do Val ("kabul-test-kd-…", "app-exemplo").
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld();
});
test.afterAll(() => kd?.stop());

/** A sessão existe no servidor tmux padrão do usuário? (sem `-L`, sem herdar `$TMUX`.) */
const noPadrao = (name: string) => {
  try {
    execFileSync("tmux", ["has-session", "-t", `=${name}`], { stdio: "pipe", env: { ...process.env, TMUX: "" } });
    return true;
  } catch {
    return false;
  }
};

test("sessões de teste só no servidor tmux isolado; o kabuld de teste enxerga as dele", async ({ page }) => {
  expect(TMUX_SOCKET).toMatch(/^kabul-test-/);
  const nomes = tmux("list-sessions", "-F", "#{session_name}").trim().split("\n");
  for (const s of Object.values(kd.sessions)) {
    expect(nomes).toContain(s);
    expect(noPadrao(s), `${s} vazou para o servidor tmux padrão`).toBe(false);
  }
  // O kabuld do teste usa o mesmo servidor isolado (KABUL_TMUX_SOCKET) e lista as sessões dele.
  await page.goto(`${kd.base}/m/`);
  await expect(page.locator(`[data-id="tmux:${kd.sessions.claude}"]`)).toBeVisible();
});
