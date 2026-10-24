import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "./types";

export const tauriTransport: Transport = {
  call: (command, args) => invoke(command, args),
  subscribe(channel, handler) {
    let off: (() => void) | null = null;
    let dead = false;
    listen(channel, (e) => handler(e.payload as never)).then((u) => (dead ? u() : (off = u)));
    return () => {
      dead = true;
      off?.();
    };
  },
};
