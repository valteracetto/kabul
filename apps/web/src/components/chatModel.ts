import type { AgentEvent, DockerContainer, HarnessKind, Leftover } from "../api";
import type { McpLive } from "./McpPanel";

/** Itens da conversa (o que o chat desenha e o histórico salva). */
export type Item =
  | { k: "user"; text: string; checkpoint?: string; queued?: boolean }
  | { k: "assistant"; text: string; streaming: boolean }
  | { k: "reasoning"; text: string }
  | { k: "tool"; id: string; name: string; input: unknown; output?: string; error?: boolean; interrupted?: boolean }
  | { k: "leftovers"; procs: Leftover[]; containers: DockerContainer[]; decided?: "kept" | "killed"; killed?: number[]; stopped?: string[] }
  | { k: "approval"; id: string; tool: string; input: unknown; decided?: boolean; allow?: boolean; always?: boolean }
  | { k: "turn"; meta: string; copy: string; usage?: Usage; started?: number; ended?: number }
  | { k: "handoff"; text: string }
  | { k: "notice"; text: string }
  | { k: "error"; text: string };

export interface Usage { input: number | null; output: number | null; cache_read: number | null; cache_write: number | null; duration_ms: number | null }
export interface Live { id: string; harness: HarnessKind; key: string; effort: string | null; fast: boolean; plan: boolean; approvals: boolean; mcpOff: string; account: string | null; planKind?: "native" | "emulated" }

const time = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Duração humana como na referência: "21s", "2m, 21s", "1h, 3m". */
export const humanDur = (secs: number) => (secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs / 60)}m, ${secs % 60}s` : `${Math.floor(secs / 3600)}h, ${Math.floor((secs % 3600) / 60)}m`);

/**
 * Aplica um evento do agente à lista de itens (puro: devolve a mesma lista se nada mudou).
 * Eventos de subagente (`parent_tool_use_id`) não entram no fio principal: vão para a árvore de subagentes.
 */
export function apply(items: Item[], ev: AgentEvent, started: number): Item[] {
  if (ev.parent_tool_use_id) return items;
  const last = items[items.length - 1];
  switch (ev.type) {
    case "text_delta":
      if (last?.k === "assistant" && last.streaming) return [...items.slice(0, -1), { ...last, text: last.text + ev.text }];
      return [...items, { k: "assistant", text: ev.text, streaming: true }];
    case "text":
      if (last?.k === "assistant" && last.streaming) return [...items.slice(0, -1), { k: "assistant", text: ev.text, streaming: false }];
      return [...items, { k: "assistant", text: ev.text, streaming: false }];
    case "reasoning":
      return ev.text.trim() ? [...items, { k: "reasoning", text: ev.text }] : items;
    case "tool_use":
      return items.some((i) => i.k === "tool" && i.id === ev.id) ? items : [...items, { k: "tool", id: ev.id, name: ev.name, input: ev.input }];
    case "tool_result": {
      // De trás para frente: o resultado quase sempre é da ferramenta mais recente.
      for (let j = items.length - 1; j >= 0; j--) {
        const i = items[j];
        if (i.k === "tool" && i.id === ev.id) return [...items.slice(0, j), { ...i, output: ev.output, error: ev.is_error }, ...items.slice(j + 1)];
      }
      return items;
    }
    case "approval_request":
      return [...items, { k: "approval", id: ev.request_id, tool: ev.tool, input: ev.input }];
    case "turn_completed": {
      // Fim de turno repetido (nada entre os dois): mostra um só.
      if (last?.k === "turn") return items;
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      let lastText: string | undefined;
      for (let j = items.length - 1; j >= 0 && lastText === undefined; j--) if (items[j].k === "assistant") lastText = (items[j] as { text: string }).text;
      // Agentes que só mandam deltas (agy, ACP): o fim do turno encerra o streaming do texto.
      const done = items.map((i) => (i.k === "assistant" && i.streaming ? { ...i, streaming: false } : i));
      return [...done, { k: "turn", meta: `${humanDur(secs)} · ${time()}`, copy: lastText ?? ev.result ?? "" }];
    }
    case "error":
      // O mesmo erro pode chegar duas vezes (notificação e fim do turno): mostra uma.
      return last?.k === "error" && last.text === ev.message ? items : [...items, { k: "error", text: ev.message }];
    case "exited":
      return ev.code ? [...items, { k: "error", text: `o agente encerrou (código ${ev.code})` }] : items;
    default:
      return items;
  }
}

/** Passos pendentes viram "interrompido" e o marcador vai no fim do turno (Parar). */
export const interrupted = (items: Item[]): Item[] => [
  ...items.map((i) => (i.k === "tool" && i.output === undefined ? { ...i, output: "", interrupted: true } : i.k === "assistant" && i.streaming ? { ...i, streaming: false } : i)),
  { k: "notice", text: "Interrompido" },
];

/** Estado de uma conversa guardado quando a aba (ou o workspace) desmonta; volta igual ao remontar. */
export interface ChatMemory {
  items: Item[];
  live: Live | null;
  agentSession: string | null;
  text: string;
  queue: string[];
  queuePaused: boolean;
  plan: boolean;
  ctxUsed: number;
  ctxBase: number;
  mcpLive: McpLive | null;
  sessionOff: string[];
  account: { id: string; nickname: string } | null;
  note: string | null;
  scroll: { top: number; bottom: boolean } | null;
  expanded: number[];
  harness: HarnessKind | null;
  fork: boolean;
  replay: boolean;
  stopped: string | null;
  started: number;
  usage: Usage | null;
  modelKey: string | null;
  busy: boolean;
  window: number;
  /** Muda a cada evento aplicado fora da tela (a aba que monta confere se pegou o estado mais novo). */
  seq: number;
}
