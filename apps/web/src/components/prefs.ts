import { useEffect, useState } from "react";
import type { Model } from "../api";

/** Preferências do seletor de modelo, guardadas no aparelho (desktop e PWA separados). */
export interface ModelPrefs { favorites: string[]; selected: string | null; effort: string; fast: boolean }

const KEY = "kabul.modelPrefs";
const DEFAULT: ModelPrefs = { favorites: ["claude:opus", "codex:gpt-6-luna"], selected: "claude:opus", effort: "low", fast: false };

export function useModelPrefs(models: Model[]) {
  const [prefs, setPrefs] = useState<ModelPrefs>(() => {
    try {
      return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    } catch {
      return DEFAULT;
    }
  });
  useEffect(() => void localStorage.setItem(KEY, JSON.stringify(prefs)), [prefs]);
  // Primeiro Gemini disponível entra nos favoritos uma vez.
  useEffect(() => {
    const g = models.find((m) => m.provider === "google");
    if (g && !localStorage.getItem(KEY + ".geminiSeeded")) {
      localStorage.setItem(KEY + ".geminiSeeded", "1");
      setPrefs((p) => (p.favorites.includes(g.key) ? p : { ...p, favorites: [...p.favorites, g.key] }));
    }
  }, [models]);
  const selected = models.find((m) => m.key === prefs.selected) ?? models[0] ?? null;
  return { prefs, setPrefs, selected, effort: selected ? effortFor(selected, prefs.effort) : null };
}

/** Esforço válido para o modelo (o preferido, se o modelo o aceita; senão o primeiro dele). */
export function effortFor(m: Model, preferred: string): string | null {
  return m.efforts.length ? (m.efforts.includes(preferred) ? preferred : m.efforts[0]) : null;
}
