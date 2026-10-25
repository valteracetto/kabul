import { addRepo, navTo, type NavDest } from "./helpers";
import { test, expect, type Page } from "../playwright-silencio";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Interface em inglês (locale do navegador en-US, preferência "Sistema"): as telas principais do desktop e
 * do celular não podem mostrar chave sem texto ([i18n] no console, `area.chave` na tela) nem texto pt-BR
 * vazando. Os outros specs rodam fixos em pt-BR (playwright.config.ts).
 */
test.use({ locale: "en-US" });

const LOCALES = join(process.cwd(), "src/i18n/locales");
const flat = (lang: string) => {
  const out: Record<string, string[]> = {};
  for (const f of readdirSync(join(LOCALES, lang)).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(LOCALES, lang, f), "utf8")) as Record<string, string | Record<string, string>>;
    for (const [k, v] of Object.entries(d)) out[k] = typeof v === "string" ? [v] : Object.values(v);
  }
  return out;
};
const PT = flat("pt-BR");
const EN = flat("en");
const enText = new Set(Object.values(EN).flat());
// Trechos de texto que só existem em português: cada pedaço fixo (entre {variáveis}) de 8+ caracteres e 2+ palavras
// que não aparece em nenhum texto em inglês. Erros do backend (errors.*) ficam de fora: o mock os imita.
const PT_ONLY = [
  ...new Set(
    Object.entries(PT)
      .filter(([k]) => !k.startsWith("errors."))
      .flatMap(([, v]) => v)
      .flatMap((s) => s.split(/\{\w+\}/))
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.includes(" ") && /[a-zà-ú]{3}/i.test(s) && ![...enText].some((e) => e.includes(s))),
  ),
];
// Palavras de interface que nunca aparecem em inglês (pegam texto fixo que escapou do dicionário).
const PT_WORDS = /\b(Configurações|Conversas?|Arquivar|Carregando|Nenhum|Nenhuma|Adicionar|Sessões|Início|Abrir|Salvar|Cancelar|Fechar|Copiar|Buscar|Atualizar|Remover|Desfazer|Enviar|Agentes|Modelos|Atalhos|Avançado|Aparência|Contas|Integrações|Máquinas|Rotinas|Uso e limites|não|você)\b/;

// Dados do backend de mentira (em português, como o backend real): resposta do agente falso e erro de comando que o mock não tem.
const MOCK_DATA = [/Recebi: [^\n]*/g, /mock: comando desconhecido \S+/g];

/** Texto visível da tela, sem o conteúdo que vem dos dados de mentira (conversas, terminal, nomes). */
async function screenText(page: Page) {
  return page.evaluate(() => {
    const root = document.body.cloneNode(true) as HTMLElement;
    root.querySelectorAll(".msg-user, .msg-assistant, .md, .xterm, .term, pre, code, [data-i18n-skip], script, style, template").forEach((e) => e.remove());
    const attrs = [...document.querySelectorAll("[title], [placeholder], [aria-label]")]
      .filter((e) => !(e as HTMLElement).closest(".msg-user, .msg-assistant, .md, .xterm, [data-i18n-skip]"))
      .flatMap((e) => ["title", "placeholder", "aria-label"].map((a) => e.getAttribute(a) ?? ""));
    return (root.innerText || root.textContent || "") + "\n" + attrs.join("\n");
  }).then((s) => MOCK_DATA.reduce((acc, re) => acc.replace(re, ""), s));
}

async function expectEnglish(page: Page, where: string, errors: string[]) {
  await page.waitForTimeout(150);
  const text = await screenText(page);
  const around = (s: string) => { const i = text.indexOf(s); return text.slice(Math.max(0, i - 50), i + s.length + 50).replace(/\s+/g, " "); };
  const leaks = PT_ONLY.filter((s) => text.includes(s)).map((s) => `${s} ← …${around(s)}…`);
  const words = text.split("\n").filter((l) => PT_WORDS.test(l));
  const keys = (text.match(/\b(common|app|chat|code|settings|usage|mobile|errors)\.[a-z][\w.]*[a-zA-Z]\b/g) ?? []).filter((k) => !/\.(toml|json|ts|tsx|md|js|ya?ml)$/.test(k));
  expect.soft(leaks, `${where}: texto pt-BR do dicionário na tela`).toEqual([]);
  expect.soft(words, `${where}: palavra em português na tela`).toEqual([]);
  expect.soft(keys, `${where}: chave sem texto na tela`).toEqual([]);
  expect.soft(errors, `${where}: chave sem texto no console`).toEqual([]);
}

function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.text().includes("[i18n]") && errors.push(m.text()));
  return errors;
}

test("desktop em inglês: início, workspace, configurações, uso, sessões, agentes e paleta", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/?mock");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectEnglish(page, "início vazio", errors);

  // Projeto + workspace com uma conversa.
  await page.getByTestId("create-ws").click();
  await expect(page.getByTestId("create-modal")).toBeVisible();
  await expectEnglish(page, "criar workspace", errors);
  if (!(await page.getByTestId("repo-pop").isVisible())) await page.getByTestId("create-repo").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-text").fill("List the project files");
  await page.getByTestId("create-text").press("Enter");
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  await expect(page.locator(".ws-host:not([hidden]) .msg-assistant")).toBeVisible();
  await expectEnglish(page, "workspace com conversa", errors);
  await page.screenshot({ path: "../../.context/e2e/idioma-en-workspace.png" });

  // Configurações: todas as abas.
  await page.keyboard.press("Meta+Comma");
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("lang-select")).toBeVisible();
  for (const tab of await page.getByTestId("settings-nav").locator("button").all()) {
    await tab.click();
    await expectEnglish(page, `configurações › ${await tab.getAttribute("data-testid")}`, errors);
  }

  // Painel (sessões) fica de fora: o mock traz dados de CLIs em português.
  const screens: [NavDest, string][] = [["usage", "[data-testid=usage-view]"], ["agents", "[data-testid=agents-view]"], ["dashboard", "[data-testid=dashboard]"], ["routines", "[data-testid=routines]"], ["local", "[data-testid=local-page]"], ["home", ".home"]];
  for (const [nav, sel] of screens) {
    await navTo(page, nav);
    await expect(page.locator(sel)).toBeVisible();
    await expectEnglish(page, `nav ${nav}`, errors);
  }

  await page.keyboard.press("Meta+k");
  await expectEnglish(page, "paleta", errors);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "../../.context/e2e/idioma-en-desktop.png" });
});

test("seletor de idioma: English → Português → Sistema", async ({ page }) => {
  await page.goto("/?mock");
  await expect(page.getByTestId("create-ws")).toBeVisible();
  await page.keyboard.press("Meta+Comma");
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("set-tab-geral")).toHaveText("General");
  await page.getByTestId("lang-select").selectOption("pt-BR");
  await page.waitForLoadState("load");
  await expect(page.getByTestId("create-ws")).toBeVisible();
  await page.keyboard.press("Meta+Comma");
  await expect(page.getByTestId("set-tab-geral")).toHaveText("Geral");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await page.getByTestId("lang-select").selectOption("system");
  await page.waitForLoadState("load");
  await expect(page.getByTestId("create-ws")).toBeVisible();
  await page.keyboard.press("Meta+Comma");
  await expect(page.getByTestId("set-tab-geral")).toHaveText("General");
});

test.describe("celular (iPhone) em inglês", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });

  test("início, sessão, uso e ajustes", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/m/?mock");
    await expect(page.getByTestId("m-tab-home")).toBeVisible();
    await expectEnglish(page, "celular › início", errors);
    const session = page.locator("[data-testid^=m-session]").first();
    if (await session.count()) {
      await session.click();
      await expectEnglish(page, "celular › sessão", errors);
      await page.goBack();
    }
    await page.getByTestId("m-tab-usage").click();
    await expectEnglish(page, "celular › uso", errors);
    await page.getByTestId("m-open-usage").click();
    await expect(page.getByTestId("m-usage-detail")).toBeVisible();
    await expectEnglish(page, "celular › custos e limites", errors);
    await page.getByTestId("m-usage-back").click();
    await page.getByTestId("m-tab-settings").click();
    await expectEnglish(page, "celular › ajustes", errors);
    await page.screenshot({ path: "../../.context/e2e/idioma-en-celular.png", fullPage: true });
  });
});
