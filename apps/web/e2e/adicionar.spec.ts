import { test, expect } from "@playwright/test";

test("Adicionar projeto: abrir do GitHub (lista da conta, URL, progresso, erro legível), início rápido; o repo fica selecionado", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("add-github")).toBeVisible();
  await page.getByTestId("add-github").click();
  await expect(page.getByTestId("clone-repo")).toHaveCount(3);
  await expect(page.getByTestId("clone-list")).toContainText("privado");
  await expect(page.getByTestId("clone-dir")).toHaveValue("~/Developer");
  await page.getByTestId("clone-q").fill("acme");
  await expect(page.getByTestId("clone-repo")).toHaveCount(1);
  await page.screenshot({ path: "../../.context/e2e/clonar.png" });
  // Erro legível
  await page.getByTestId("clone-q").fill("dev/nao-existe");
  await page.getByTestId("clone-go").click();
  await expect(page.getByTestId("clone-error")).toContainText("Repositório não encontrado");
  // Clonar da lista, em outra pasta
  await page.getByTestId("clone-q").fill("dev/demo");
  await page.getByTestId("clone-repo").first().click();
  await page.getByTestId("clone-dir").fill("/home/dev/code");
  await page.getByTestId("clone-go").click();
  await expect(page.getByTestId("clone-progress")).toBeVisible();
  await expect(page.getByTestId("clone-dialog")).toHaveCount(0);
  await expect(page.getByTestId("create-repo")).toContainText("demo-app");
  await expect(page.getByTestId("create-modal")).toBeVisible();
  // Início rápido com a última pasta lembrada
  await page.getByTestId("create-repo").click();
  await page.getByTestId("add-project").click();
  await page.getByTestId("add-quick").click();
  await expect(page.getByTestId("clone-dir")).toHaveValue("/home/dev/code");
  await page.getByTestId("quick-name").fill("meu-app");
  await page.getByTestId("quick-go").click();
  await expect(page.getByTestId("create-repo")).toContainText("meu-app");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
});

test("Início: cartões Abrir projeto, do GitHub e Início rápido", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("home-github").click();
  await page.getByTestId("clone-q").fill("acme/site");
  await page.getByTestId("clone-go").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expect(page.getByTestId("create-repo")).toContainText("site");
  await page.keyboard.press("Escape");
  await page.getByTestId("home-quick").click();
  await page.getByTestId("quick-name").fill("novo");
  await page.getByTestId("quick-go").click();
  await expect(page.getByTestId("create-repo")).toContainText("novo");
  await page.keyboard.press("Escape");
  await page.getByTestId("home-open").click();
  await expect(page.getByTestId("create-repo")).toContainText("demo");
});
