import { expect, type Page } from "../playwright-silencio";

/** Adiciona um projeto pelo submenu "Adicionar projeto › Abrir projeto" (o seletor de pasta do mock devolve `path`). */
export async function addRepo(page: Page, path: string) {
  await page.evaluate((p) => ((window as any).__mock.pickFolder = p), path);
  if (!(await page.getByTestId("add-open").isVisible())) await page.getByTestId("add-project").click();
  await page.getByTestId("add-open").click();
  await expect(page.getByTestId("repo-pop")).toHaveCount(0);
}

/**
 * Telas fora dos workspaces pela barra lateral: Visão geral (Agentes · Quadro · Painel, seletor dentro da tela),
 * menu "Mais" do rodapé (Início, Rotinas, Modelos locais) e o medidor de uso. No máximo 2 cliques.
 */
export type NavDest = "agents" | "dashboard" | "sessions" | "home" | "routines" | "local" | "usage";
export async function navTo(page: Page, dest: NavDest) {
  if (dest === "usage") return page.getByTestId("nav-usage").click();
  if (dest === "agents" || dest === "dashboard" || dest === "sessions") {
    await page.getByTestId("nav-overview").click();
    await page.getByTestId(`ov-${dest}`).click();
    return expect(page.getByTestId(`ov-${dest}`)).toHaveAttribute("aria-selected", "true");
  }
  await page.getByTestId("nav-more").click();
  await page.getByTestId(`nav-${dest}`).click();
}
