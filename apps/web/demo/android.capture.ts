/* i18n-ignore-file: capturas da demonstração. */
import { test, expect } from "../playwright-silencio";
import { BASE, composeCollab, frame, prepare, shot } from "./frame";

// Pixel 8 (Chromium), PWA em tela cheia, inglês. Cru em .context/demo/raw/android-*.png; no fim,
// docs/assets/mobile-android.png e, se o iPhone já rodou, collab-mobile.png.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }) => prepare(page, "android"));

const chat = (id: string, extra = "") => `${BASE}${extra}#s=${encodeURIComponent(`chat:${id}`)}`;

test("lista de sessões", async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByTestId("m-session")).toHaveCount(9);
  await shot(page, "android-list");
});

test("conversa com troca de agente (tema claro)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(chat("c-flaky"));
  await expect(page.getByTestId("m-note")).toHaveCount(2);
  await shot(page, "android-chat");
});

test("colaboração (Maya na mesma conversa)", async ({ page }) => {
  await page.goto(chat("c-dark", "&collab&as=maya"));
  await expect(page.getByTestId("m-decision")).toBeVisible();
  await expect(page.getByTestId("m-presence-user")).toHaveCount(2);
  await page.getByTestId("m-chat-input").fill("Nice! I'll open the PR from my laptop.");
  // O campo cresceu com o texto: volta a conversa para o fim, como no aparelho.
  await page.getByTestId("m-chat").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await shot(page, "android-collab");
});

test("moldura", async ({ browser }) => {
  await frame(browser, [{ src: "android-list", device: "android", theme: "dark" }, { src: "android-chat", device: "android", theme: "light" }], "mobile-android");
  await composeCollab(browser);
});
