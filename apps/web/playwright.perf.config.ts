import { defineConfig } from "@playwright/test";

// Desempenho em escala (npm run perf): build de produção servido pelo `vite preview`, transporte mock com
// 100 workspaces e 30 agentes de carga. Porta própria (KABUL_PERF_PORT, ou a do E2E + 1) para não dividir servidor.
const PORT = Number(process.env.KABUL_PERF_PORT ?? Number(process.env.KABUL_E2E_PORT ?? 5174) + 1);

export default defineConfig({
  testDir: "perf",
  timeout: 300_000,
  workers: 1,
  reporter: [["list"]],
  use: { locale: "pt-BR", baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 }, colorScheme: "dark", launchOptions: { args: ["--enable-precise-memory-info"] } },
  // KABUL_PERF_REUSE=1 reaproveita um preview já no ar (sem rebuild).
  webServer: { command: `npx vite build --logLevel warn && npx vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !!process.env.KABUL_PERF_REUSE, timeout: 180_000 },
});
