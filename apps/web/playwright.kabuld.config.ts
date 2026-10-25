import { defineConfig, devices } from "@playwright/test";

// E2E contra o kabuld REAL (binário em target/debug, PWA em dist, tmux de verdade com sessões
// `kabul-test-*`). Celular: iPhone (WebKit) e Android (Pixel 8, Chromium). Desktop: painel Celular e remoto (Chromium).
// Antes: `cargo build -p kabuld` e `npx vite build` (o globalSetup faz se faltar).
export default defineConfig({
  testDir: "e2e-kabuld",
  timeout: 90_000,
  workers: 1,
  globalSetup: "./e2e-kabuld/global-setup.ts",
  reporter: [["list"]],
  // Idioma fixo em pt-BR: os specs conferem textos em português.
  use: { locale: "pt-BR", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "iphone", testMatch: /celular|colaboracao|fora|preview|plano/, use: { ...devices["iPhone 15"] } },
    { name: "android", testMatch: /celular|fora|android|plano/, use: { ...devices["Pixel 8"] } },
    { name: "capturas", testMatch: /capturas/, use: { ...devices["iPhone 15"] } },
    { name: "capturas-android", testMatch: /capturas/, use: { ...devices["Pixel 8"] } },
    { name: "desktop", testMatch: /painel/, use: { browserName: "chromium", viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
  ],
});
