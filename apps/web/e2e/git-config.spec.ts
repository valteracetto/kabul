import { test, expect } from "../playwright-silencio";
import { addRepo } from "./helpers";

test("Configurações › Git: opções do usuário e do repo (base, remote, alvo, sobrescritas, identidade)", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.keyboard.press("Escape");
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-git").click();
  await expect(page.getByTestId("git-prefix")).toHaveValue("github");
  await page.getByTestId("git-prefix").selectOption("custom");
  await expect(page.getByTestId("git-prefix-custom")).toHaveAttribute("placeholder", "feature/");
  await page.getByTestId("git-prefix").selectOption("none");
  for (const k of ["delete_branch_on_archive", "archive_on_merge", "automerge", "optional_checks_blocking"]) await page.getByTestId(`toggle-${k}`).click();
  await page.getByTestId("toggle-push_set_upstream").click();
  await page.getByTestId("git-open-in").selectOption("graphite");
  await page.getByTestId("git-merge-method").selectOption("rebase");
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.settings)).toMatchObject({ branch_prefix_type: "none", delete_branch_on_archive: true, archive_on_merge: true, automerge: true, optional_checks_blocking: true, push_set_upstream: false, open_prs_in: "graphite", merge_method: "rebase" });
  await expect(page.getByTestId("settings-page")).toContainText("não há como recuperar");
  await page.screenshot({ path: "../../.context/e2e/config-git.png" });
  // Escopo do repo
  await page.getByTestId("git-scope").getByText("demo").click();
  await page.getByTestId("git-base").selectOption("feat/relatorio-pdf");
  await page.getByTestId("git-remote").selectOption("upstream");
  await page.getByTestId("git-repo-archive").selectOption("0");
  await expect.poll(() => page.evaluate(() => (window as any).__mock.db.repoSettings)).toMatchObject({ base_branch: "feat/relatorio-pdf", remote: "upstream", archive_on_merge: false });
  await expect(page.getByTestId("git-identity")).toContainText("identidade global");
  await page.getByTestId("git-id-name").fill("Dev Kabul");
  await page.getByTestId("git-id-email").fill("dev@example.com");
  await page.getByTestId("git-id-save").click();
  await expect(page.getByTestId("git-identity")).toContainText("Definida neste repositório");
});
