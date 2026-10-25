import { defineConfig, devices } from "@playwright/test";

// Clipes curtos da landing page (kabul.dev) a partir do ambiente de demonstração (`?mock&demo`, dados 100%
// fictícios): `npm run demo:site-clips`. Os specs gravam o .webm cru e as marcas do trecho útil em
// ../../.context/demo/raw/clip-<nome>.webm|.json; o demo/site-clips.mjs corta, codifica e grava em ../../site/media/.
// Porta do Vite em KABUL_E2E_PORT (padrão 5317, longe da 5300 do `demo:capture`).
const PORT = Number(process.env.KABUL_E2E_PORT ?? 5317);

export default defineConfig({
  testDir: "demo",
  testMatch: /site-clips\.capture\.ts$/,
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "en-US", timezoneId: "America/Los_Angeles", colorScheme: "dark" },
  projects: [
    // Desktop: viewport um pouco menor que 1280×800 para a interface ficar maior no site (onde o clipe aparece
    // com ~720 px); vídeo em 2× para o texto sair nítido antes da redução no encode. O screencast do Chromium
    // headless ignora o deviceScaleFactor emulado (grava em pixels CSS); só sai em 2× com a flag de linha de comando.
    {
      name: "clip-desktop",
      grep: /@desktop/,
      use: {
        browserName: "chromium",
        viewport: { width: 1120, height: 700 },
        deviceScaleFactor: 2,
        launchOptions: { args: ["--force-device-scale-factor=2"] },
        video: { mode: "on", size: { width: 2240, height: 1400 } },
      },
    },
    // Celular: tela cheia do PWA (393×852) em 2×. O vídeo do WebKit sairia em pixels CSS; o spec grava com
    // screenshots (786×1704) e o encode reduz para 430 px de largura.
    { name: "clip-phone", grep: /@phone/, use: { ...devices["iPhone 15 Pro"], viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: "en-US" } },
  ],
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 60_000 },
});
