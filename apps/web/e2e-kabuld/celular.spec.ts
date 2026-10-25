import { test, expect, type Page } from "@playwright/test";
import { startKabuld, type Kabuld } from "./helpers";

// iPhone (WebKit) contra o kabuld real exigindo pareamento até do navegador local
// (simula o celular chegando pela tailnet).
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ trustLocalBrowser: false });
});
test.afterAll(() => kd?.stop());

const shot = (page: Page, name: string) => page.screenshot({ path: `../../.context/e2e/kabuld-${name}.png` });

test("pareamento por QR, lista agrupada com agente, onde roda e status, terminal ao vivo com barra de teclas", async ({ page }) => {
  // Sem credencial: tela de pareamento.
  await page.goto(`${kd.base}/m/`);
  await expect(page.getByTestId("m-need-pairing")).toBeVisible();
  await shot(page, "sem-pareamento");

  // Link do QR (gerado pelo kabuld): nome e aparelho, depois a lista.
  await page.goto(kd.pairLink);
  await expect(page.getByTestId("m-pair")).toBeVisible();
  await page.getByTestId("m-pair-user").fill("Ana");
  await page.getByTestId("m-pair-go").click();
  await expect(page.getByTestId("m-list")).toBeVisible();
  await expect(page.getByTestId("m-conn")).toHaveClass(/m-conn-open/);

  // Agrupado por repo/workspace; ícone do agente; status; selo de onde roda.
  const ws = page.getByTestId("m-group").filter({ hasText: "Login novo" });
  await expect(ws).toContainText("app-exemplo");
  const claude = page.locator(`[data-id="tmux:${kd.sessions.claude}"]`);
  await expect(claude.getByTestId("m-agent")).toHaveAttribute("data-agent", "claude");
  await expect(claude.getByTestId("m-status")).toHaveAttribute("data-status", "waiting");
  await expect(claude).toContainText("Do you want to proceed?");
  const codex = page.locator(`[data-id="tmux:${kd.sessions.codex}"]`);
  await expect(codex.getByTestId("m-agent")).toHaveAttribute("data-agent", "codex");
  await expect(codex.getByTestId("m-status")).toHaveAttribute("data-status", "waiting");
  await expect(page.getByTestId("m-group").filter({ has: codex })).toHaveAttribute("data-repo", "app-exemplo");
  const cloud = page.locator(`[data-id="tmux:${kd.sessions.cloud}"]`);
  await expect(cloud.getByTestId("m-runs-on")).toHaveAttribute("data-kind", "provider_cloud");
  await expect(cloud.getByTestId("m-runs-on")).toContainText("Nuvem · Anthropic");
  const shell = page.locator(`[data-id="tmux:${kd.sessions.shell}"]`);
  await expect(shell.getByTestId("m-agent")).toHaveAttribute("data-agent", "shell");
  await expect(shell.getByTestId("m-runs-on")).toHaveAttribute("data-kind", "local");
  await expect(page.getByTestId("m-group").filter({ has: shell })).toHaveAttribute("data-repo", "Outras sessões");
  await shot(page, "lista");

  // Filtro "Esperando você".
  await page.getByTestId("m-filter-waiting").click();
  await expect(shell).toHaveCount(0);
  await expect(codex).toBeVisible();
  await page.getByText("Todas").click();

  // Terminal ao vivo de um shell qualquer: digitar, Ctrl-C, ver a saída chegar.
  await shell.click();
  await expect(page.getByTestId("m-terminal")).toBeVisible();
  await page.getByTestId("m-term-input").fill("sleep 30");
  await page.getByTestId("m-term-send").click();
  await page.waitForTimeout(400);
  await page.getByTestId("m-key-ctrlc").click();
  await page.getByTestId("m-term-input").fill("echo ok-$((40+2))");
  await page.getByTestId("m-term-send").click();
  await expect(page.locator(".m-term .xterm-rows")).toContainText("ok-42", { timeout: 10_000 });
  await expect(page.getByTestId("m-keybar")).toContainText("Aprovar");
  await shot(page, "terminal");

  // "Aprovar" num agente esperando: o codex falso recebe "y".
  await page.getByTestId("m-back").click();
  await codex.click();
  await expect(page.locator(".m-term .xterm-rows")).toContainText("Would you like to run");
  await page.getByTestId("m-key-approve").click();
  await page.getByRole("button", { name: "⏎" }).click();
  // O tty ecoa "y" e o cat devolve a linha: duas linhas "y" depois do comando.
  await expect(page.locator(".m-term .xterm-rows")).toContainText(/npm test\s*y\s*y/);

  // Notificações: sem HTTPS ou fora da Tela de Início, o app explica o que falta.
  await page.getByTestId("m-back").click();
  await page.getByTestId("m-menu").click();
  // iPhone fora da Tela de Início explica o que falta; o Chrome do Android em localhost já permite ligar.
  if (test.info().project.name === "android") await expect(page.getByTestId("m-push")).toBeEnabled();
  else await expect(page.getByTestId("m-push-why")).toContainText(/HTTPS|Tela de Início/);
  await shot(page, "menu");
});

test("PWA instalável: manifest, ícones e service worker servidos pelo kabuld", async ({ request }) => {
  const m = await (await request.get(`${kd.base}/manifest.webmanifest`)).json();
  expect(m.start_url).toBe("/m/");
  expect(m.display).toBe("standalone");
  expect((await request.get(`${kd.base}/icon-192.png`)).headers()["content-type"]).toContain("image/png");
  expect(await (await request.get(`${kd.base}/sw.js`)).text()).toContain("showNotification");
  const h = await (await request.get(`${kd.base}/api/health`)).json();
  expect(h.kabuld).toBe(true);
});
