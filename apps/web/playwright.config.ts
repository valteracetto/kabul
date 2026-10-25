import { defineConfig } from "@playwright/test";

// tmux só num servidor próprio (`tmux -L`): o `kabul serve`/kabuld que os testes sobem herdam isto e nunca usam
// o servidor padrão de quem roda o teste (lá o Kabul de verdade listaria as sessões de teste).
process.env.KABUL_TMUX_SOCKET ||= `kabul-test-e2e-${process.pid}`;
// Avatar do GitHub sem rede nos backends que os testes sobem (repo clonado do GitHub não baixa imagem).
process.env.KABUL_GITHUB_AVATAR ||= "off";

// Porta do Vite (KABUL_E2E_PORT, ou E2E_PORT): worktrees diferentes rodando E2E ao mesmo tempo não podem
// dividir o servidor. Os specs com backend real deslocam as portas do `kabul serve` junto.
const PORT = Number(process.env.KABUL_E2E_PORT ?? process.env.E2E_PORT ?? 5174);
// KABUL_E2E_MOCK_ONLY=1 (CI): só o mock; pula os specs *-real que sobem o kabul-core e usam gh/agy de verdade.
const mockOnly = process.env.KABUL_E2E_MOCK_ONLY === "1";

// E2E do frontend com o transporte mock (?mock). O app Tauri real é testado à parte (roteiro manual).
export default defineConfig({
  testDir: "e2e",
  testIgnore: mockOnly ? /-real\.spec\.ts$/ : undefined,
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "../../.context/e2e/resultado.json" }]],
  // Idioma fixo em pt-BR: os specs conferem textos em português (o spec em inglês é o idioma-en.spec.ts).
  use: { locale: "pt-BR", screenshot: "only-on-failure", baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000 },
});
