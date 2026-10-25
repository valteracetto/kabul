import { defineConfig } from "@playwright/test";

// Porta do Vite (KABUL_E2E_PORT): worktrees diferentes rodando E2E ao mesmo tempo não podem dividir o servidor.
const PORT = Number(process.env.KABUL_E2E_PORT ?? 5174);

// Capturas para comparação visual (não é teste de regressão): `npx playwright test -c playwright.visual.config.ts`.
// Saída em ../../.context/comparar/final/ (fora do git). KABUL_TEMA=light|dark escolhe o tema (padrão: os dois).
export default defineConfig({
  testDir: "visual",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { locale: "pt-BR", baseURL: `http://localhost:${PORT}`, viewport: { width: 1855, height: 1050 }, deviceScaleFactor: 2 },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
});
