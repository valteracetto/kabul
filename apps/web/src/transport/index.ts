import { tauriTransport } from "./tauri";
import { websocketTransport } from "./websocket";
import { mockTransport } from "./mock";
import { httpTransport } from "./http";
import type { Transport } from "./types";
import { remoteMachine } from "../components/machines";
import { localCred } from "./credentials";

export type { Transport } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMock = typeof location !== "undefined" && (new URLSearchParams(location.search).has("mock") || import.meta.env.VITE_KABUL_MOCK === "1");

/** Tauri no desktop; `?http=<url>` contra `kabul serve` (E2E real); mock em testes (`?mock`); WebSocket (kabuld) quando servido como PWA. */
const httpBase = typeof location !== "undefined" ? new URLSearchParams(location.search).get("http") : null;
// Outra máquina escolhida no seletor do topo: fala com o kabuld dela por WebSocket (com a credencial pareada).
const remote = typeof localStorage !== "undefined" && !isMock && !httpBase ? remoteMachine() : null;
export const transport: Transport = remote
  ? websocketTransport(remote.url, remote.device && remote.key ? { device: remote.device, key: remote.key } : null)
  : isTauri ? tauriTransport : httpBase ? httpTransport(httpBase) : isMock ? mockTransport : websocketTransport(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`, localCred);
