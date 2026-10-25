import { defineConfig, devices } from "@playwright/test";

// tmux só num servidor próprio (`tmux -L`): o `kabul serve`/kabuld que os testes sobem herdam isto e nunca usam
// o servidor padrão de quem roda o teste (lá o Kabul de verdade listaria as sessões de teste).
process.env.KABUL_TMUX_SOCKET ||= `kabul-test-e2e-${process.pid}`;

// Capturas do README e do site a partir do ambiente de demonstração (`?mock&demo`, dados 100% fictícios):
// `npm run demo:capture`. Saída crua em ../../.context/demo/raw/; o demo/finish.mjs moldura, otimiza e grava em
// ../../docs/assets/. Porta do Vite em KABUL_E2E_PORT (padrão 5300) para não dividir o servidor com outro E2E.
const PORT = Number(process.env.KABUL_E2E_PORT ?? 5300);

export default defineConfig({
  testDir: "demo",
  testMatch: /\.capture\.ts$/,
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "en-US", timezoneId: "America/Los_Angeles", colorScheme: "dark" },
  projects: [
    { name: "desktop", testMatch: /desktop\.capture\.ts$/, use: { browserName: "chromium", viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 } },
    { name: "video", testMatch: /video\.capture\.ts$/, use: { browserName: "chromium", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, video: { mode: "on", size: { width: 1280, height: 800 } } } },
    // Tela cheia do PWA instalado (sem barra do navegador): iPhone 15 Pro com a barra de status opaca (a página
    // começa abaixo dela: 393×793 @3x; a moldura pinta a barra), Pixel 8 em 412×915.
    { name: "iphone", testMatch: /iphone\.capture\.ts$/, use: { ...devices["iPhone 15 Pro"], viewport: { width: 393, height: 793 }, locale: "en-US" } },
    { name: "android", testMatch: /android\.capture\.ts$/, use: { ...devices["Pixel 8"], viewport: { width: 412, height: 915 }, locale: "en-US" } },
  ],
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
});
