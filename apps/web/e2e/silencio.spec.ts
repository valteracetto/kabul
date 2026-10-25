import { test, expect } from "../playwright-silencio";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Nenhum teste fala ou toca som no computador de quem roda (ver playwright-silencio.ts).
test("Ler em voz alta e mídia ficam mudos nos testes; nenhuma spec importa @playwright/test direto", async ({ page, browser }) => {
  await page.goto("/?mock");
  const spoken = await page.evaluate(() => {
    speechSynthesis.speak(new SpeechSynthesisUtterance("não pode sair som"));
    return (window as any).__spoken;
  });
  expect(spoken).toEqual([["não pode sair som", ""]]);
  // Contexto criado à mão também.
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto("/?mock");
  expect(await p2.evaluate(() => (speechSynthesis.speak(new SpeechSynthesisUtterance("x")), (window as any).__spoken.length))).toBe(1);
  await ctx.close();

  const dirs = ["e2e", "e2e-kabuld", "perf", "demo", "visual"];
  const needle = 'from "@playwright' + '/test"';
  const direct = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => join(d, f))).filter((f) => readFileSync(f, "utf8").includes(needle));
  expect(direct, "importe de ../playwright-silencio").toEqual([]);
});
