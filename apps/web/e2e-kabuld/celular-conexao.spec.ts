import { test, expect } from "../playwright-silencio";
import { startKabuld, type Kabuld } from "./helpers";

// Conexão do celular com o kabuld real (iPhone e Android): o print do Val depois de reiniciar o Kabul era
// "Kabul", ponto laranja, avatar de engrenagem e "Todas 0" — socket pendurado esperando o hello e recuo de
// até 25,6 s entre tentativas. Agora: aviso de "conectando", desiste do socket mudo em 8 s, ao voltar ao app
// confere a conexão e reconecta na hora, e avisa quando o kabuld passa a servir um build novo.
let kd: Kabuld;
test.beforeAll(async () => {
  kd = await startKabuld({ trustLocalBrowser: false });
});
test.afterAll(() => kd?.stop());
// O roteamento do Playwright não vê pedidos que passam pelo service worker no WebKit (o do Kabul não guarda nada).
test.use({ serviceWorkers: "block" });

test("socket mudo: avisa que está conectando, tenta de novo sozinho; ao voltar ao app reconecta; build novo pede recarregar", async ({ page }) => {
  await page.goto(kd.pairLink);
  await page.getByTestId("m-pair-user").fill("Teste");
  await page.getByTestId("m-pair-go").click();
  await expect(page.getByTestId("m-conn")).toHaveClass(/m-conn-open/);

  // A partir daqui o WebSocket passa pelo teste: o 1º fica mudo (nem o hello volta), os outros repassam.
  let n = 0;
  const mudos = new Set<number>(); // conexões que ficam caladas
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const i = ++n;
    if (i === 1) return; // aceita e não responde nada
    const server = ws.connectToServer();
    ws.onMessage((m) => !mudos.has(i) && server.send(m));
    server.onMessage((m) => !mudos.has(i) && ws.send(m));
  });
  await page.reload();
  // Sem dados ainda: diz que está conectando (antes: "Todas 0" e a lista vazia).
  await expect(page.getByTestId("m-connecting")).toBeVisible();
  await expect(page.getByTestId("m-count-all")).toHaveCount(0);
  // Desiste do socket mudo e conecta no seguinte, sem esperar dezenas de segundos.
  await expect(page.getByTestId("m-conn")).toHaveClass(/m-conn-open/, { timeout: 15_000 });
  await expect(page.getByTestId("m-group").filter({ hasText: "Login novo" })).toBeVisible();
  await expect(page.getByTestId("m-connecting")).toHaveCount(0);
  expect(Number(await page.getByTestId("m-count-all").textContent())).toBeGreaterThan(0);
  expect(n).toBe(2);

  // O iOS congela a PWA no fundo e o socket morre calado. Ao voltar, o app confere (whoami) e reconecta.
  mudos.add(2);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => n, { timeout: 10_000 }).toBe(3);
  await expect(page.getByTestId("m-conn")).toHaveClass(/m-conn-open/);
  await expect(page.getByTestId("m-group").filter({ hasText: "Login novo" })).toBeVisible();

  // Kabul atualizado no computador: o HTML passa a apontar outro build; ao voltar ao app, oferece recarregar.
  await expect(page.getByTestId("m-new-version")).toHaveCount(0);
  await page.route(/\/m\/$/, async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/(src="\/assets\/index-)[^"]+(\.js")/, "$1BUILDNOVO$2");
    await route.fulfill({ response: res, body: html });
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("m-new-version")).toBeVisible();
  await page.unroute(/\/m\/$/);
  await page.getByTestId("m-new-version-reload").click();
  await expect(page.getByTestId("m-list")).toBeVisible();
  await expect(page.getByTestId("m-new-version")).toHaveCount(0);
});

test("HTML e sw.js revalidam sempre; arquivos do build (com hash) ficam em cache para sempre", async ({ request }) => {
  const html = await request.get(`${kd.base}/m/`);
  expect(html.headers()["cache-control"]).toBe("no-cache");
  expect((await request.get(`${kd.base}/sw.js`)).headers()["cache-control"]).toBe("no-cache");
  const js = (await html.text()).match(/src="(\/assets\/[^"]+\.js)"/)![1];
  expect((await request.get(`${kd.base}${js}`)).headers()["cache-control"]).toContain("immutable");
  expect((await request.get(`${kd.base}/api/health`)).headers()["cache-control"]).toBe("no-store");
});
