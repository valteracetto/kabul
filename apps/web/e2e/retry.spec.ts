import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "./helpers";

const host = (page: Page) => page.locator(".ws-host:not([hidden])");
const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");

test("erro com Tentar de novo, Tentar em nova conversa e Copiar detalhes; Ler em voz alta no rodapé do turno", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void (window as any).__spoken.push([u.text, u.lang]);
  });
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await chat(page).getByTestId("composer").fill("falhe agora");
  await chat(page).getByTestId("composer").press("Enter");
  const err = chat(page).getByTestId("msg-error");
  await expect(err).toContainText("Limite de uso atingido");
  await err.getByTestId("copy-error").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Limite de uso");
  // Tentar de novo reenvia a mesma mensagem na conversa.
  await err.getByTestId("retry").click();
  await expect(chat(page).locator(".msg-user")).toHaveCount(2);
  await expect(chat(page).getByTestId("msg-error")).toHaveCount(2);
  await expect(chat(page).getByTestId("retry")).toHaveCount(1);
  // Em nova conversa: aba nova com a mesma mensagem.
  await chat(page).getByTestId("retry-new").click();
  await expect(host(page).getByTestId("ctab")).toHaveCount(2);
  await expect(chat(page).locator(".msg-user").first()).toHaveText("falhe agora");
  // Ler em voz alta (pt-BR) a resposta final do turno.
  await chat(page).getByTestId("composer").fill("liste");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(2);
  await chat(page).getByTestId("read-aloud").last().click();
  const spoken = await page.evaluate(() => (window as any).__spoken);
  expect(spoken[0][1]).toBe("pt-BR");
  expect(spoken[0][0]).toContain("Recebi: liste");
});
