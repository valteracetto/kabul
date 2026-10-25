import { test, expect, type Page } from "@playwright/test";
import { addRepo } from "../e2e/helpers";

// Medidas do Kabul (px CSS) para comparar com os valores medidos na referência. Imprime JSON.
const SEL: Record<string, string> = {
  topbar: ".ws-host:not([hidden]) .topbar",
  sideTop: ".side-top",
  machine: ".machine-btn",
  navBtn: ".side-nav button",
  groupLabel: ".side-group-head, .group-head",
  repoRow: ".repo-row",
  wsRow: ".ws-row",
  sideFoot: ".side-foot",
  tabstrip: ".ws-host:not([hidden]) .tabstrip",
  ctab: ".ws-host:not([hidden]) .ctab",
  thread: ".ws-host:not([hidden]) .center-body:not([hidden]) .thread",
  msgUser: ".ws-host:not([hidden]) .msg-user",
  msgAsst: ".ws-host:not([hidden]) .msg-assistant",
  turnMeta: ".ws-host:not([hidden]) .turn-meta",
  composer: ".ws-host:not([hidden]) .center-body:not([hidden]) .composer",
  composerTa: ".ws-host:not([hidden]) .center-body:not([hidden]) .composer textarea",
  send: ".ws-host:not([hidden]) .center-body:not([hidden]) [data-testid=send]",
  rtab: ".ws-host:not([hidden]) .rtabs button",
  crumbRepo: ".ws-host:not([hidden]) .crumb-repo",
  crumbBranch: ".ws-host:not([hidden]) .crumb-branch",
  resChip: "[data-testid=res-chip]",
};
test("medidas", async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem("kabul.theme", t), process.env.KABUL_TEMA ?? "dark");
  await page.goto("/?mock");
  await page.getByTestId("create-ws").click();
  await addRepo(page, "/mock/repos/demo");
  await page.getByTestId("create-go").click();
  await expect(page.getByTestId("ws-row")).toHaveCount(1);
  const c = page.locator(".ws-host:not([hidden]) .center-body:not([hidden]) [data-testid=composer]");
  await c.fill("liste");
  await c.press("Enter");
  await expect(page.locator(".ws-host:not([hidden]) .turn-meta")).toBeVisible();
  const out = await page.evaluate((sel) => {
    const r: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(sel)) {
      const e = document.querySelector(s) as HTMLElement | null;
      if (!e) { r[k] = null; continue; }
      const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
      r[k] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, color: cs.color, bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, border: cs.borderTopWidth + " " + cs.borderTopColor, ff: cs.fontFamily.split(",")[0] };
    }
    return r;
  }, SEL);
  console.log(JSON.stringify(out, null, 1));
});
