/**
 * Testes em silêncio: nenhum E2E, captura, perf ou visual pode falar ou tocar som no computador de quem
 * roda. Todas as specs importam `test`/`expect` daqui (no lugar de "@playwright/test").
 *
 * - `speechSynthesis.speak` é trocado por um gravador (`window.__spoken`, [texto, idioma]); `cancel`
 *   encerra a fala "virtual" como o navegador faria (onend). Sem isso, o headless do Chromium fala de
 *   verdade pela voz do sistema (o "Ler em voz alta" do chat, clicado pela auditoria de controles,
 *   lia a resposta do mock: "Recebi: …").
 * - `<audio>`/`<video>` tocam mudos; o Chromium sobe com `--mute-audio`.
 * Vale para a página padrão, para os contextos criados à mão (`browser.newContext`) e para os navegadores
 * abertos à mão (`playwright.webkit.launch()`, como o celular-tela faz para o iPhone num worker Chromium).
 *
 * `--mute-audio` é só do Chromium, mas o Playwright aplica as `launchOptions` do worker a todo
 * `browserType.launch()` (padrão raso: `{ ...padrão, ...opções }`). O WebKit do macOS ignora a opção; o do
 * Linux (CI) recusa ("Cannot parse arguments: Unknown option --mute-audio") e nem abre. Por isso os
 * outros navegadores sobem com os `args` do worker sem ela.
 */
import { test as base, type Browser, type BrowserContext, type BrowserType } from "@playwright/test";

export * from "@playwright/test";

function silence() {
  const w = window as any;
  w.__spoken ??= [];
  if ("speechSynthesis" in window) {
    const s = window.speechSynthesis as any;
    let current: SpeechSynthesisUtterance | null = null;
    try {
      s.speak = (u: SpeechSynthesisUtterance) => {
        w.__spoken.push([u.text, u.lang]);
        current = u;
      };
      s.cancel = () => {
        const u = current;
        current = null;
        u?.onend?.call(u, new Event("end") as SpeechSynthesisEvent);
      };
    } catch {
      /* navegador sem como trocar: a página segue */
    }
  }
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    this.muted = true;
    return play.call(this);
  };
}

const quiet = (c: BrowserContext) => c.addInitScript(silence);
const patched = new WeakSet<Browser | BrowserType>();
const MUDO = "--mute-audio";

function silenciarBrowser(browser: Browser) {
  if (patched.has(browser)) return browser;
  patched.add(browser);
  const orig = browser.newContext.bind(browser);
  browser.newContext = async (...a: Parameters<Browser["newContext"]>) => {
    const c = await orig(...a);
    await quiet(c);
    return c;
  };
  return browser;
}

/** `launch()` à mão: Chromium sempre mudo; WebKit/Firefox sem a opção que só o Chromium entende. */
function silenciarLaunch(bt: BrowserType, chromium: boolean, padrao: string[]) {
  if (patched.has(bt)) return;
  patched.add(bt);
  const orig = bt.launch.bind(bt);
  bt.launch = async (o: Parameters<BrowserType["launch"]>[0] = {}) => {
    const args = o.args ?? padrao;
    const ok = chromium ? [...args.filter((x) => x !== MUDO), MUDO] : args.filter((x) => x !== MUDO);
    return silenciarBrowser(await orig({ ...o, args: ok }));
  };
}

export const test = base.extend<{}, { _silencioBrowser: void }>({
  launchOptions: [
    async ({ launchOptions, browserName }, use) => {
      await use(browserName === "chromium" ? { ...launchOptions, args: [...(launchOptions.args ?? []), MUDO] } : launchOptions);
    },
    { scope: "worker" },
  ],
  _silencioBrowser: [
    async ({ browser, playwright, launchOptions }, use) => {
      silenciarBrowser(browser);
      const padrao = launchOptions.args ?? [];
      for (const nome of ["chromium", "firefox", "webkit"] as const) silenciarLaunch(playwright[nome], nome === "chromium", padrao);
      await use();
    },
    { scope: "worker", auto: true },
  ],
  context: async ({ context }, use) => {
    await quiet(context);
    await use(context);
  },
});
