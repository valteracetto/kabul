import { test, expect, type Page, type Locator } from "../playwright-silencio";
import { addRepo } from "../e2e/helpers";

const OUT = "../../.context/comparar/final";
const temas = (process.env.KABUL_TEMA ? [process.env.KABUL_TEMA] : ["dark", "light"]) as ("dark" | "light")[];
const host = (p: Page) => p.locator(".ws-host:not([hidden])");
const chat = (p: Page) => p.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

async function shot(p: Page, tema: string, nome: string, alvo?: Locator, pad = 0) {
  await p.waitForTimeout(250);
  if (!alvo) return p.screenshot({ path: `${OUT}/${tema}-${nome}.png` });
  const b = await alvo.boundingBox();
  if (!b) return;
  const vp = p.viewportSize()!;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  await p.screenshot({ path: `${OUT}/${tema}-${nome}.png`, clip: { x, y, width: Math.min(vp.width - x, b.width + pad * 2), height: Math.min(vp.height - y, b.height + pad * 2) } });
}
async function say(p: Page, t: string) {
  await chat(p).getByTestId("composer").fill(t);
  await chat(p).getByTestId("composer").press("Enter");
}
async function setup(p: Page, tema: string) {
  await p.addInitScript((t) => localStorage.setItem("kabul.theme", t), tema);
  await p.goto("/?mock");
  await p.getByTestId("create-ws").click();
  await addRepo(p, "/mock/repos/demo");
  await p.getByTestId("create-go").click();
  await expect(p.getByTestId("ws-row")).toHaveCount(1);
}

for (const tema of temas) {
  test(`capturas ${tema}`, async ({ page: p }) => {
    await setup(p, tema);
    // Modal de criação (vazio) e lista de repos.
    await p.getByTestId("create-ws").click();
    await expect(p.getByTestId("create-modal")).toBeVisible();
    await shot(p, tema, "modal-criar", p.getByTestId("create-modal"), 24);
    await p.getByTestId("create-repo").click();
    await shot(p, tema, "modal-repos", p.getByTestId("create-modal"), 24);
    await p.keyboard.press("Escape");
    await p.keyboard.press("Escape");
    await expect(p.getByTestId("create-modal")).toHaveCount(0);

    await say(p, "liste");
    await expect(host(p).locator(".turn-meta")).toBeVisible();
    await shot(p, tema, "workspace-ocioso");
    await shot(p, tema, "sidebar", p.getByTestId("sidebar"));
    await shot(p, tema, "composer", chat(p).locator(".composer"), 8);
    await shot(p, tema, "rodape-turno", host(p).locator(".turn-meta").last(), 12);
    await host(p).getByTestId("expand-steps").click();
    await shot(p, tema, "cards-ferramenta", chat(p).locator(".thread"));
    await host(p).getByTestId("turn-more").last().click();
    await shot(p, tema, "menu-turno", p.locator("[data-floating]").last(), 12);
    await p.keyboard.press("Escape");

    // Seletor de modelo.
    await chat(p).locator(".picker-trigger").click();
    await shot(p, tema, "seletor-modelo", p.locator(".picker-pop"), 12);
    await p.keyboard.press("Escape");
    // Abrir em.
    await host(p).getByTestId("open-in-menu").click().catch(() => {});
    await shot(p, tema, "abrir-em", p.locator(".open-pop"), 12);
    await p.keyboard.press("Escape");
    // Máquina e recursos.
    await p.getByTestId("machine-picker").click();
    if (await p.getByTestId("machine-pop").isVisible().catch(() => false)) await shot(p, tema, "menu-maquina", p.getByTestId("machine-pop"), 12);
    await p.keyboard.press("Escape");
    if (await p.getByTestId("res-chip").isVisible().catch(() => false)) {
      await p.getByTestId("res-chip").click();
      await shot(p, tema, "recursos", p.locator(".res-wrap"), 12);
      await p.keyboard.press("Escape");
    }
    // ··· do repositório.
    await p.getByTestId("repo-demo").hover();
    await p.getByTestId("repo-more-demo").click();
    await shot(p, tema, "menu-repo", p.getByTestId("sidebar"), 0);
    await p.keyboard.press("Escape");
    // Aba "+".
    await host(p).getByTestId("new-tab").click();
    await shot(p, tema, "menu-nova-aba", p.locator("[data-floating]").last(), 12);
    await p.keyboard.press("Escape");

    // Trabalhando.
    await say(p, "devagar");
    await p.waitForTimeout(600);
    await shot(p, tema, "chat-trabalhando");
    await shot(p, tema, "composer-trabalhando", chat(p).locator(".composer"), 8);
    await expect(chat(p).getByTestId("stop")).toHaveCount(0, { timeout: 10_000 });

    // Aprovação.
    await say(p, "crie o arquivo");
    await expect(chat(p).locator(".approval")).toBeVisible();
    await shot(p, tema, "aprovacao", chat(p).locator(".approval"), 12);
    await p.keyboard.press("Enter");
    await p.waitForTimeout(800);

    // Plano.
    await say(p, "faça um plano");
    await expect(chat(p).locator(".plan-card")).toBeVisible();
    await shot(p, tema, "plano", chat(p).locator(".plan-card"), 12);
    await shot(p, tema, "workspace-plano");
    await chat(p).locator(".plan-card button", { hasText: /Aprovar/ }).first().click();
    await p.waitForTimeout(800);

    // Perguntas.
    await say(p, "pergunte antes");
    await expect(chat(p).locator(".ask-card, .question-card").first()).toBeVisible();
    await shot(p, tema, "perguntas", chat(p).locator(".ask-card, .question-card").first(), 12);
  });

  test(`capturas ${tema}: painel direito, terminal, configurações, Painel`, async ({ page: p }) => {
    await setup(p, tema);
    await say(p, "crie o arquivo");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(1200);
    await shot(p, tema, "painel-direito", host(p).locator(".right"));
    const row = host(p).getByTestId("change-row").first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await p.waitForTimeout(500);
      await shot(p, tema, "diff");
    }
    await host(p).getByTestId("new-tab").click();
    await p.getByTestId("new-term-tab").click();
    await p.waitForTimeout(800);
    await shot(p, tema, "terminal-aba");
    await p.getByTestId("settings").click();
    await p.waitForTimeout(500);
    await shot(p, tema, "configuracoes");
    await p.getByRole("button", { name: "Painel" }).click();
    await p.waitForTimeout(800);
    await shot(p, tema, "painel-sessoes");
  });
}
