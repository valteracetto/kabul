import { k } from "./kabuld";

/** Service worker da PWA: instalação na tela de início e Web Push. Só existe em contexto seguro. */
export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export const pushSupported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Por que não dá para ligar as notificações aqui (texto para o usuário), ou null se dá. */
export function pushBlocker(): string | null {
  if (!window.isSecureContext) return "Notificações precisam de HTTPS: no Mac, ligue o HTTPS do Tailscale (Configurações › Celular e remoto) e abra o link https.";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return ios ? "No iPhone, adicione o Kabul à Tela de Início (Compartilhar › Adicionar à Tela de Início) e abra por lá." : "Este navegador não oferece notificações push.";
  }
  return null;
}

function b64url(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<void> {
  const why = pushBlocker();
  if (why) throw new Error(why);
  const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Permissão de notificação negada.");
  const key = await k.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(key) as BufferSource }));
  await k.pushSubscribe(sub.toJSON());
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return !!(await reg?.pushManager.getSubscription()) && Notification.permission === "granted";
}
