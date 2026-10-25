import { k } from "./kabuld";
import { lang, t } from "../i18n";

/** Service worker da PWA: instalação na tela de início e Web Push. Só existe em contexto seguro. */
export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    // Idioma das notificações push (o service worker traduz os avisos que chegam com `kind`).
    (reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ type: "kabul-lang", lang: lang() });
    return reg;
  } catch {
    return null;
  }
}

export const pushSupported = () => window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Por que não dá para ligar as notificações aqui (texto para o usuário), ou null se dá. */
export function pushBlocker(): string | null {
  if (!window.isSecureContext) return t("mobile.push.needsHttps");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return ios ? t("mobile.push.iosHome") : t("mobile.push.unsupported");
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
  if (perm !== "granted") throw new Error(t("mobile.push.denied"));
  const key = await k.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(key) as BufferSource }));
  await k.pushSubscribe(sub.toJSON());
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return !!(await reg?.pushManager.getSubscription()) && Notification.permission === "granted";
}
