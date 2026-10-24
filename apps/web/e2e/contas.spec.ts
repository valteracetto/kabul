import { addRepo } from "./helpers";
import { test, expect, type Page } from "@playwright/test";

const chat = (page: Page) => page.locator(".ws-host:not([hidden]) .center-body:not([hidden])");
async function setup(page: Page) {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
}

test("várias contas: adicionar, entrar, renomear, padrão, remover; trocar no meio da conversa com handoff", async ({ page }) => {
  await setup(page);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-contas").click();
  const claude = page.getByTestId("accounts-claude");
  await expect(claude.getByTestId("account-row")).toHaveCount(1);
  await page.getByTestId("account-add-claude").fill("Trabalho");
  await page.getByTestId("account-add-claude").press("Enter");
  await expect(claude.getByTestId("account-row")).toHaveCount(2);
  await claude.getByTestId("account-login").click();
  await claude.getByTestId("account-code").fill("codigo-falso");
  await claude.getByRole("button", { name: "Enviar" }).click();
  await expect(claude).toContainText("Conta conectada.");
  await expect(claude).toContainText("dev2@example.com");
  await claude.getByTestId("account-rename").click();
  await claude.getByTestId("account-rename-input").fill("Cliente");
  await claude.getByTestId("account-rename-input").press("Enter");
  await expect(claude).toContainText("Cliente");
  await claude.getByTestId("account-default").click();
  await expect(claude.getByTestId("account-row").nth(1)).toContainText("padrão");
  await page.screenshot({ path: "../../.context/e2e/contas.png" });
  // Conversa: começa na conta padrão e troca para o padrão do sistema no meio.
  await page.getByTestId("ws-row").click();
  await chat(page).getByTestId("composer").fill("primeira");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(1);
  await chat(page).getByTestId("account-chip").click();
  await expect(page.getByTestId("account-option")).toHaveCount(2);
  await page.getByTestId("account-option").filter({ hasText: "Padrão do sistema" }).click();
  await expect(chat(page).getByTestId("account-chip")).toContainText("Padrão do sistema");
  await chat(page).getByTestId("composer").fill("segunda");
  await chat(page).getByTestId("composer").press("Enter");
  await expect(chat(page).getByTestId("handoff")).toContainText("Trocou para a conta Padrão do sistema");
  await expect(chat(page).locator(".turn-meta")).toHaveCount(2);
  // Remover a conta
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-contas").click();
  await page.getByTestId("accounts-claude").getByTestId("account-remove").click();
  await page.getByTestId("confirm-ok").click();
  await expect(page.getByTestId("accounts-claude").getByTestId("account-row")).toHaveCount(1);
});

test("aba: renomear sem prompt() (o WKWebView não tem)", async ({ page }) => {
  await setup(page);
  await page.getByTestId("ctab").first().click({ button: "right" });
  await page.getByTestId("tab-rename").click();
  await page.getByTestId("tab-rename-input").fill("Login");
  await page.getByTestId("tab-rename-input").press("Enter");
  await expect(page.getByTestId("ctab").first()).toContainText("Login");
});
