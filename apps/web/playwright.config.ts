import { defineConfig } from "@playwright/test";

// E2E do frontend com o transporte mock (?mock). O app Tauri real é testado à parte (roteiro manual).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../../.context/e2e/resultado.json" }]],
  use: { screenshot: "only-on-failure", baseURL: "http://localhost:5174", viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  webServer: { command: "npx vite --port 5174 --strictPort", url: "http://localhost:5174", reuseExistingServer: true, timeout: 60_000 },
});
