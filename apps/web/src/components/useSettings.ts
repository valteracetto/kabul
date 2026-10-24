import { useEffect, useState } from "react";
import { api, type AppSettings } from "../api";

let cache: AppSettings | null = null;
let loading: Promise<AppSettings> | null = null;
const load = () => (loading ??= api.appSettings().then((s) => (cache = s), () => (loading = null, cache as AppSettings)));
// Configurações salvas: invalida o cache mesmo sem nenhum componente montado.
if (typeof window !== "undefined") window.addEventListener("kabul:settings", () => void (loading = null));

/** Configurações do app para quem só lê (chat, terminal): carrega uma vez e recarrega quando salvas. */
export function useSettings(): AppSettings | null {
  const [s, setS] = useState<AppSettings | null>(cache);
  useEffect(() => {
    load().then((x) => x && setS(x));
    const h = () => void load().then((x) => x && setS({ ...x }));
    window.addEventListener("kabul:settings", h);
    return () => window.removeEventListener("kabul:settings", h);
  }, []);
  return s;
}

/** Tira "You're absolutely right!" (e variações) do começo da resposta. */
export const stripAbsolutelyRight = (t: string) => t.replace(/^\s*(you['’]re|you are)\s+(absolutely|completely|totally)\s+right[.!]*\s*/i, "").replace(/^\s*voc[eê]\s+(est[aá]|tem)\s+(absolutamente|totalmente|completamente)\s+(certo|razão)[.!]*\s*/i, "");
