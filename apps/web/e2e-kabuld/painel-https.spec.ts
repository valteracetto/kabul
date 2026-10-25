import { test, expect } from "../playwright-silencio";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startKabuld, type Kabuld } from "./helpers";

// "Ativar HTTPS" com um Tailscale de mentira (KABUL_BIN_TAILSCALE): tailnet sem certificado mostra o
// que ligar no painel; erro do `tailscale serve` aparece com a saída real; ligado, a URL https e o QR
// novo. Nada toca no Tailscale de verdade.
let kd: Kabuld;
let dir: string;
const FAKE = `#!/bin/sh
D="$FAKE_TS_DIR"
case "$1 $2" in
  "ip "*|"ip") echo 100.101.102.103 ;;
  "status --json")
    if [ -f "$D/certs" ]; then C='["mac.tailnet-exemplo.ts.net"]'; else C=null; fi
    echo "{\\"Self\\":{\\"DNSName\\":\\"mac.tailnet-exemplo.ts.net.\\"},\\"MagicDNSSuffix\\":\\"tailnet-exemplo.ts.net\\",\\"CurrentTailnet\\":{\\"MagicDNSEnabled\\":true},\\"CertDomains\\":$C}" ;;
  "serve status") if [ -f "$D/served" ]; then cat "$D/served"; else echo "{}"; fi ;;
  "serve --bg")
    if [ -f "$D/fail" ]; then cat "$D/fail" >&2; exit 1; fi
    echo "{\\"TCP\\":{\\"443\\":{\\"HTTPS\\":true}},\\"Web\\":{\\"mac.tailnet-exemplo.ts.net:443\\":{\\"Handlers\\":{\\"/\\":{\\"Proxy\\":\\"$4\\"}}}}}" > "$D/served"
    echo "Available within your tailnet" ;;
  "serve --https=443") rm -f "$D/served" ;;
esac
`;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kabul-e2e-ts-"));
  const bin = join(dir, "tailscale");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  kd = await startKabuld({ tailscale: bin, env: { FAKE_TS_DIR: dir } });
});
test.afterAll(() => {
  kd?.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("Ativar HTTPS: tailnet sem certificado explica o que ligar, erro real do serve, URL https e QR com ela", async ({ page }) => {
  await page.goto(`${kd.base}/`);
  await page.keyboard.press("Meta+Comma");
  await page.getByRole("button", { name: "Celular e remoto" }).click();
  const panel = page.getByTestId("remote-panel");
  await expect(panel.getByTestId("remote-net-badge")).toHaveText("conectado");

  // Sem HTTPS Certificates na tailnet: instrução com o link do painel e "Tentar de novo".
  const box = panel.getByTestId("remote-https-box");
  await expect(box).toContainText("exigem HTTPS");
  await expect(box.getByTestId("remote-https-help")).toContainText("Enable HTTPS");
  await expect(box.getByTestId("remote-https-admin")).toHaveAttribute("href", "https://login.tailscale.com/admin/dns");
  await expect(panel.getByTestId("ticket-url").first()).toContainText("http://100.101.102.103:");
  await box.getByTestId("remote-https-retry").click();
  await expect(box.getByTestId("remote-https-error")).toContainText("ainda não está habilitada para HTTPS");
  await page.screenshot({ path: "../../.context/e2e/https-sem-certificado.png" });

  // A pessoa liga no painel; o serve falha: aparece a saída real do comando.
  writeFileSync(join(dir, "certs"), "");
  writeFileSync(join(dir, "fail"), "serve: erro de teste do tailscale\n");
  await box.getByTestId("remote-https-retry").click();
  await expect(box.getByTestId("remote-https-error")).toContainText("tailscale serve falhou (código 1): serve: erro de teste do tailscale");

  // Agora funciona: URL https e QR novo com ela.
  rmSync(join(dir, "fail"));
  await box.getByTestId("remote-https-retry").click();
  await expect(box.getByTestId("remote-https-url")).toContainText("https://mac.tailnet-exemplo.ts.net/m/");
  await expect(box.getByTestId("remote-https-error")).toHaveCount(0);
  await expect(panel.getByTestId("ticket-url").first()).toContainText("https://mac.tailnet-exemplo.ts.net/m/#pair=");
  await page.screenshot({ path: "../../.context/e2e/https-ligado.png" });

  // Clicar de novo com o serve já apontando para o kabuld reaproveita (sem rodar o serve).
  writeFileSync(join(dir, "fail"), "não devia rodar\n");
  const r = await page.evaluate(async () => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    await new Promise((ok) => (ws.onopen = ok));
    ws.send(JSON.stringify({ hello: {} }));
    await new Promise((ok) => (ws.onmessage = ok));
    ws.send(JSON.stringify({ id: 1, command: "remote_https", args: { on: true } }));
    const m = await new Promise<MessageEvent>((ok) => (ws.onmessage = ok));
    return JSON.parse(m.data);
  });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(r.value.https_url).toBe("https://mac.tailnet-exemplo.ts.net");
});
