import { test, expect, type Page } from "../playwright-silencio";
import { addRepo } from "./helpers";

// Hosts SSH contra o mock (config sintético: domínios e IPs de documentação, usuário `dev`, com Include,
// curinga e Match). O parser e a escrita de verdade são testados no core (cargo test -p kabul-core ssh::).
// Nenhuma conexão SSH acontece aqui.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const row = (page: Page, alias: string) => page.locator(`[data-testid="ssh-row"][data-alias="${alias}"]`);
async function openSsh(page: Page, scenario?: string) {
  if (scenario) await page.evaluate((s) => ((window as any).__mock.sshScenario = s), scenario);
  await page.getByTestId("settings").click();
  await page.getByTestId("set-tab-ssh").click();
  await expect(page.getByTestId("ssh-page")).toBeVisible();
}
async function menu(page: Page, alias: string, item: string) {
  await row(page, alias).getByTestId("ssh-row-menu").click();
  await page.getByTestId("ssh-row-pop").getByTestId(item).click();
}

test("Hosts SSH: lista por arquivo, busca, teste em lote com o erro real, regras", async ({ page }) => {
  await page.goto("/?mock");
  await openSsh(page);
  await expect(page.locator(".settings-title")).toHaveText("Hosts SSH");
  await expect(page.getByTestId("ssh-sync")).toHaveText("Sincronizar ~/.ssh/config");
  await expect(page.getByTestId("ssh-count")).toHaveText("7 hosts");
  const groups = page.getByTestId("ssh-group");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator(".ssh-group-head")).toContainText("De ~/.ssh/config· 5");
  await expect(groups.nth(1).locator(".ssh-group-head")).toContainText("De ~/.ssh/config.d/lab.conf· 2");
  // user@host:porta (porta efetiva do ssh -G) e a chave resumida.
  await expect(row(page, "web-prod").locator(".ssh-addr")).toHaveText("deploy@203.0.113.10:22 · id_ed25519");
  await expect(row(page, "staging").locator(".ssh-addr")).toHaveText("dev@staging.example.com:2222 · staging_admin");
  await expect(row(page, "lab/cpu").locator(".ssh-addr")).toHaveText("dev@192.0.2.51:22");

  await page.getByTestId("ssh-search").fill("lab");
  await expect(page.getByTestId("ssh-count")).toHaveText("2 hosts");
  await page.getByTestId("ssh-search").fill("nada-disso");
  await expect(page.getByTestId("ssh-none")).toBeVisible();
  await page.getByTestId("ssh-search").fill("");

  // Seleção em lote do grupo e teste: cada linha mostra o resultado; o detalhe traz a mensagem do ssh.
  await groups.nth(0).getByTestId("ssh-group-check").check();
  await expect(page.getByTestId("ssh-batch")).toContainText("5 selecionados");
  await page.getByTestId("ssh-batch-test").click();
  await expect(row(page, "web-prod").getByTestId("ssh-status")).toHaveText("Conectou · 84 ms");
  await expect(row(page, "staging").getByTestId("ssh-status")).toHaveText("Permissão negada");
  await expect(row(page, "bastion").getByTestId("ssh-status")).toHaveText("Tempo esgotado");
  await page.getByTestId("ssh-batch-copy").click();
  await expect(page.getByTestId("ssh-notice")).toContainText("5 comandos copiados");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ssh web-prod\nssh staging\nssh db\nssh db-primary\nssh bastion");
  await row(page, "staging").getByTestId("ssh-expand").click();
  await expect(row(page, "staging").getByTestId("ssh-error")).toContainText("dev@staging.example.com: Permission denied (publickey).");
  await expect(row(page, "staging").getByTestId("ssh-detail")).toContainText("LocalForward5433 localhost:5432");
  await expect(row(page, "staging").getByTestId("ssh-detail")).toContainText("SHA256:TIjol4qf8oRqlXTkMSpYL97wGu9uJSafnly6cvh49mY");

  // Pelo menu da linha: host key desconhecida.
  await menu(page, "lab-gpu", "ssh-test");
  await expect(row(page, "lab-gpu").getByTestId("ssh-status")).toHaveText("Host key desconhecida");
  await page.screenshot({ path: "../../.context/e2e/ssh-hosts.png" });

  // Regras (Host * e Match) ficam à parte, sem edição.
  await page.getByTestId("ssh-more").click();
  await page.getByTestId("ssh-rules-toggle").click();
  await expect(page.getByTestId("ssh-rule")).toHaveCount(3);
  await expect(page.getByTestId("ssh-rules")).toContainText("Match host *.corp.example exec true");
  await expect(page.getByTestId("ssh-rules")).toContainText("Host *.internal !bastion.internal");
});

test("Hosts SSH: adicionar, editar e remover com prévia em diff e backup", async ({ page }) => {
  await page.goto("/?mock");
  await openSsh(page);
  await expect(page.getByTestId("ssh-count")).toHaveText("7 hosts");

  await page.getByTestId("ssh-add").click();
  await page.getByTestId("ssh-f-alias").fill("novo-servidor");
  await page.getByTestId("ssh-f-hostname").fill("192.0.2.77");
  await page.getByTestId("ssh-f-user").fill("dev");
  await page.getByTestId("ssh-f-port").fill("2200");
  await page.getByTestId("ssh-f-key-select").selectOption("~/.ssh/id_ed25519");
  await expect(page.getByTestId("ssh-f-key")).toHaveValue("~/.ssh/id_ed25519");
  await page.getByTestId("ssh-f-review").click();
  const diff = page.getByTestId("ssh-diff");
  // Bloco novo inteiro (5 linhas + a linha em branco que separa), nada removido.
  await expect(diff.locator(".add")).toHaveCount(6);
  for (const l of ["+Host novo-servidor", "+ HostName 192.0.2.77", "+ User dev", "+ Port 2200", "+ IdentityFile ~/.ssh/id_ed25519"]) await expect(diff).toContainText(l);
  await expect(diff.locator(".del")).toHaveCount(0);
  await expect(page.getByTestId("ssh-review")).toContainText("config.bak-kabul-");
  await page.getByTestId("ssh-apply").click();
  await expect(page.getByTestId("ssh-notice")).toContainText("Salvo em ~/.ssh/config. Backup: config.bak-kabul-");
  await expect(page.getByTestId("ssh-count")).toHaveText("8 hosts");
  await expect(row(page, "novo-servidor").locator(".ssh-addr")).toHaveText("dev@192.0.2.77:2200 · id_ed25519");

  // Alias repetido: o erro volta no formulário.
  await page.getByTestId("ssh-add").click();
  await page.getByTestId("ssh-f-alias").fill("staging");
  await page.getByTestId("ssh-f-review").click();
  await expect(page.getByTestId("ssh-form-error")).toHaveText("já existe um host staging");
  await page.getByTestId("ssh-form").getByText("Cancelar").click();

  // Editar: só a linha da porta muda.
  await menu(page, "novo-servidor", "ssh-edit");
  await expect(page.getByTestId("ssh-f-port")).toHaveValue("2200");
  await page.getByTestId("ssh-f-port").fill("22");
  await page.getByTestId("ssh-f-review").click();
  await expect(diff.locator(".del")).toHaveCount(1);
  await expect(diff.locator(".del")).toContainText("- Port 2200");
  await expect(diff.locator(".add")).toHaveCount(1);
  await expect(diff.locator(".add")).toContainText("+ Port 22");
  await page.getByTestId("ssh-apply").click();
  await expect(row(page, "novo-servidor").locator(".ssh-addr")).toHaveText("dev@192.0.2.77:22 · id_ed25519");

  // Remover um alias de bloco compartilhado só tira o nome do cabeçalho.
  await menu(page, "db-primary", "ssh-remove");
  await expect(page.getByTestId("ssh-review")).toContainText("Tirar db-primary do bloco (que continua para db)");
  await expect(diff.locator(".del")).toHaveCount(1);
  await expect(diff.locator(".del")).toContainText("-Host db db-primary");
  await expect(diff.locator(".add")).toHaveCount(1);
  await expect(diff.locator(".add")).toHaveText(/\+Host db$/);
  await page.getByTestId("ssh-apply").click();
  await expect(page.getByTestId("ssh-count")).toHaveText("7 hosts");
  await expect(row(page, "db-primary")).toHaveCount(0);

  // Remover o bloco inteiro; cancelar a prévia não muda nada.
  await menu(page, "novo-servidor", "ssh-remove");
  await page.getByTestId("ssh-review").getByText("Cancelar").click();
  await expect(page.getByTestId("ssh-count")).toHaveText("7 hosts");
  await menu(page, "novo-servidor", "ssh-remove");
  await expect(diff.locator(".del").first()).toContainText("-Host novo-servidor");
  await page.getByTestId("ssh-apply").click();
  await expect(page.getByTestId("ssh-count")).toHaveText("6 hosts");
  expect(await page.evaluate(() => (window as any).__ssh.backups.length)).toBe(4);
});

test("Hosts SSH: terminal do Kabul, Abrir em, copiar comando e gerar chave", async ({ page }) => {
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await openSsh(page);

  await menu(page, "web-prod", "ssh-copy");
  await expect(page.getByTestId("ssh-notice")).toHaveText(/Copiado: ssh web-prod/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ssh web-prod");
  await menu(page, "lab/cpu", "ssh-copy");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("ssh lab/cpu");

  await menu(page, "web-prod", "ssh-open-iterm");
  await expect.poll(() => page.evaluate(() => (window as any).__ssh.opened)).toEqual(["iterm:web-prod"]);

  await page.getByTestId("ssh-more").click();
  await page.getByTestId("ssh-keygen").click();
  await expect(page.getByTestId("ssh-kg-name")).toHaveValue("id_ed25519_kabul");
  await page.getByTestId("ssh-kg-go").click();
  await expect(page.getByTestId("ssh-notice")).toContainText("Chave criada: ~/.ssh/id_ed25519_kabul");

  // Abrir terminal: sessão `ssh <alias>` vira aba no workspace aberto por último.
  await menu(page, "web-prod", "ssh-terminal");
  await expect(page.locator(".settings-page")).toHaveCount(0);
  await expect(page.getByText("ssh web-prod", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__ssh.terminals)).toEqual(["kabul-ssh-web-prod"]);
});

test("Hosts SSH: sem ~/.ssh/config, cria o arquivo novo", async ({ page }) => {
  await page.goto("/?mock");
  await openSsh(page, "empty");
  await expect(page.getByTestId("ssh-empty")).toContainText("Ainda não existe ~/.ssh/config.");
  await page.getByTestId("ssh-add").click();
  await page.getByTestId("ssh-f-alias").fill("primeiro");
  await page.getByTestId("ssh-f-hostname").fill("primeiro.example.com");
  await page.getByTestId("ssh-f-review").click();
  await expect(page.getByTestId("ssh-review")).toContainText("~/.ssh/config ainda não existe: será criado com permissão 0600.");
  await page.getByTestId("ssh-apply").click();
  await expect(page.getByTestId("ssh-notice")).toHaveText(/~\/\.ssh\/config criado\./);
  await expect(page.getByTestId("ssh-count")).toHaveText("1 host");
});

test("Hosts SSH: caminhos do Windows e apps do Windows", async ({ page }) => {
  await page.goto("/?mock");
  await openSsh(page, "windows");
  await expect(row(page, "web-prod").locator(".ssh-addr")).toHaveText("deploy@203.0.113.10:22 · id_ed25519");
  await row(page, "web-prod").getByTestId("ssh-expand").click();
  await expect(row(page, "web-prod").getByTestId("ssh-detail")).toContainText("C:\\Users\\dev\\.ssh\\id_ed25519");
  await row(page, "web-prod").getByTestId("ssh-row-menu").click();
  await expect(page.getByTestId("ssh-row-pop")).toContainText("Abrir em Windows Terminal");
});

test("Hosts SSH no celular: lista só leitura e testar conexão", async ({ page }) => {
  await page.goto("/m/?mock#v=settings/ssh");
  await expect(page.getByTestId("m-settings-ssh")).toBeVisible();
  await expect(page.getByTestId("m-ssh-row")).toHaveCount(7);
  await expect(page.getByTestId("m-ssh-row").first()).toContainText("lab-gpu");
  const staging = page.getByTestId("m-ssh-row").filter({ hasText: "staging" });
  await expect(staging).toContainText("dev@staging.example.com:2222");
  await staging.getByTestId("m-ssh-open").click();
  await staging.getByTestId("m-ssh-test").click();
  await expect(staging.getByTestId("m-ssh-status")).toHaveText("Permissão negada");
  await expect(staging.getByTestId("m-ssh-error")).toContainText("Permission denied (publickey)");
  // Nada de editar no celular.
  await expect(page.getByTestId("ssh-add")).toHaveCount(0);
});

test.describe("em inglês", () => {
  test.use({ locale: "en-US" });
  test("SSH hosts in English", async ({ page }) => {
    await page.goto("/?mock");
    await openSsh(page);
    await expect(page.locator(".settings-title")).toHaveText("SSH hosts");
    await expect(page.getByTestId("ssh-sync")).toHaveText("Sync ~/.ssh/config");
    await expect(page.getByTestId("ssh-add")).toHaveText("Add host");
    await expect(page.getByTestId("ssh-count")).toHaveText("7 hosts");
    await menu(page, "staging", "ssh-test");
    await expect(row(page, "staging").getByTestId("ssh-status")).toHaveText("Permission denied");
  });
});
