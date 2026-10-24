/** Transporte abstrato: o frontend nunca fala direto com o Tauri. */
export type Unsubscribe = () => void;

export interface Transport {
  /** Chamada request/response (comando Tauri agora, mensagem WebSocket depois). */
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Assina um canal de eventos empurrados pelo backend. */
  subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe;
}
