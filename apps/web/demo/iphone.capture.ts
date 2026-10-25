/* i18n-ignore-file: capturas da demonstração. */
import { test, expect } from "@playwright/test";
import { BASE, composeCollab, frame, prepare, shot } from "./frame";

// iPhone 15 Pro (WebKit), PWA em tela cheia, inglês, tema escuro. Cru em .context/demo/raw/iphone-*.png;
// no fim, as composições com moldura em docs/assets/ (mobile.png, mobile-preview.png e, se o Android já
// rodou, collab-mobile.png).
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => prepare(page, "iphone"));

const chat = (id: string, extra = "") => `${BASE}${extra}#s=${encodeURIComponent(`chat:${id}`)}`;

test("lista de sessões", async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByTestId("m-session")).toHaveCount(9);
  await expect(page.locator('[data-status="waiting"]').first()).toBeVisible();
  await shot(page, "iphone-list");
});

test("conversa com aprovação", async ({ page }) => {
  await page.goto(chat("c-dark"));
  await expect(page.getByTestId("m-approve")).toBeVisible();
  await expect(page.getByTestId("m-presence-user")).toHaveCount(2);
  await expect(page.getByTestId("pv-chip").first()).toBeVisible();
  await shot(page, "iphone-approval");
});

test("preview de arquivo", async ({ page }) => {
  await page.goto(`${BASE}#f=w-dark&p=${encodeURIComponent("src/theme/useColorScheme.ts")}&from=${encodeURIComponent("chat:c-dark")}`);
  await expect(page.getByTestId("pv-code")).toContainText("matchMedia");
  await shot(page, "iphone-preview");
});

test("seletor de modelo", async ({ page }) => {
  // Favoritos e esforço guardados no aparelho (os mesmos do seletor do desktop).
  await page.addInitScript(() => localStorage.setItem("kabul.modelPrefs", JSON.stringify({ favorites: ["claude:opus", "claude:sonnet", "codex:gpt-6-luna", "agy:gemini-4-argon"], selected: "claude:opus", effort: "high", fast: false })));
  await page.goto(chat("c-safari"));
  await expect(page.getByTestId("m-msg-agent").first()).toBeVisible();
  await page.getByTestId("m-chat-model-chip").click();
  await expect(page.getByTestId("m-model").first()).toBeVisible();
  await expect(page.getByTestId("m-effort")).toBeVisible();
  await shot(page, "iphone-models");
});

test("colaboração (Sam vê a Maya digitando)", async ({ page }) => {
  await page.goto(chat("c-dark", "&collab"));
  await expect(page.getByTestId("m-typing")).toBeVisible();
  await expect(page.getByTestId("m-decision")).toBeVisible();
  await shot(page, "iphone-collab");
});

test("moldura", async ({ browser }) => {
  await frame(browser, [{ src: "iphone-list", device: "iphone", theme: "dark" }, { src: "iphone-approval", device: "iphone", theme: "dark" }], "mobile");
  await frame(browser, [{ src: "iphone-preview", device: "iphone", theme: "dark" }, { src: "iphone-models", device: "iphone", theme: "dark" }], "mobile-preview");
  await composeCollab(browser);
});
