/**
 * Testes em silêncio: nenhum E2E, captura, perf ou visual pode falar ou tocar som no computador de quem
 * roda. Todas as specs importam `test`/`expect` daqui (no lugar de "@playwright/test").
 *
 * - `speechSynthesis.speak` é trocado por um gravador (`window.__spoken`, [texto, idioma]); `cancel`
 *   encerra a fala "virtual" como o navegador faria (onend). Sem isso, o headless do Chromium fala de
 *   verdade pela voz do sistema (o "Ler em voz alta" do chat, clicado pela auditoria de controles,
 *   lia a resposta do mock: "Recebi: …").
 * - `<audio>`/`<video>` tocam mudos; o Chromium sobe com `--mute-audio`.
 * Vale para a página padrão e para os contextos criados à mão (`browser.newContext`).
 */
import { test as base, type Browser, type BrowserContext } from "@playwright/test";

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
const patched = new WeakSet<Browser>();

export const test = base.extend<{}, { _silencioBrowser: void }>({
  launchOptions: [
    async ({ launchOptions, browserName }, use) => {
      await use(browserName === "chromium" ? { ...launchOptions, args: [...(launchOptions.args ?? []), "--mute-audio"] } : launchOptions);
    },
    { scope: "worker" },
  ],
  _silencioBrowser: [
    async ({ browser }, use) => {
      if (!patched.has(browser)) {
        patched.add(browser);
        const orig = browser.newContext.bind(browser);
        browser.newContext = async (...a: Parameters<Browser["newContext"]>) => {
          const c = await orig(...a);
          await quiet(c);
          return c;
        };
      }
      await use();
    },
    { scope: "worker", auto: true },
  ],
  context: async ({ context }, use) => {
    await quiet(context);
    await use(context);
  },
});
