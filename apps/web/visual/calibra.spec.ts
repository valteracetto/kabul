import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
// Renderiza palavras em Geist em vários tamanhos/pesos (2x) para medir a largura da tinta e calibrar contra a referência.
const WORDS = (process.env.CAL_WORDS ?? "Thinking").split("|");
const SIZES = [12, 13, 13.5, 14, 15];
const WEIGHTS = [400, 450, 500, 600];
const FAM = process.env.CAL_FAM ?? "Geist";
test("calibra", async ({ page }) => {
  await page.goto("/?mock");
  await page.waitForTimeout(800);
  const list: string[] = [];
  await page.evaluate(({ WORDS, SIZES, WEIGHTS, FAM }) => {
    const d = document.createElement("div");
    d.style.cssText = `position:fixed;inset:0;z-index:99999;background:#000;color:#fff;font-family:${FAM};padding:0 10px;overflow:hidden`;
    for (const w of WORDS) for (const fs of SIZES) for (const fw of WEIGHTS) { const s = document.createElement("div"); s.style.cssText = `font-size:${fs}px;font-weight:${fw};height:24px;line-height:24px;white-space:nowrap`; s.textContent = w; d.appendChild(s); }
    document.body.appendChild(d);
  }, { WORDS, SIZES, WEIGHTS, FAM });
  for (const w of WORDS) for (const fs of SIZES) for (const fw of WEIGHTS) list.push(`${w}\t${fs}\t${fw}`);
  writeFileSync("/tmp/kb-cal.txt", list.join("\n"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "/tmp/kb-cal.png", fullPage: false });
});
