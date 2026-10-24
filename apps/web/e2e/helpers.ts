import { expect, type Page } from "@playwright/test";

/** Adiciona um projeto pelo submenu "Adicionar projeto › Abrir projeto" (o seletor de pasta do mock devolve `path`). */
export async function addRepo(page: Page, path: string) {
  await page.evaluate((p) => ((window as any).__mock.pickFolder = p), path);
  if (!(await page.getByTestId("add-open").isVisible())) await page.getByTestId("add-project").click();
  await page.getByTestId("add-open").click();
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
}
