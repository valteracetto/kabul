// Service worker da PWA do Kabul: instalação e Web Push. Sem cache de páginas: os dados são ao vivo
// e o app sempre vem do kabuld (evita servir uma versão velha depois de atualizar).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// Idioma das notificações: o app manda o que está em uso (Ajustes › Idioma); sem isso, o do aparelho.
const PREFS = "kabul-prefs";
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "kabul-lang" && typeof e.data.lang === "string") {
    e.waitUntil(caches.open(PREFS).then((c) => c.put("/__kabul-lang", new Response(e.data.lang))));
  }
});
async function uiLang() {
  try {
    const r = await (await caches.open(PREFS)).match("/__kabul-lang");
    if (r) return await r.text();
  } catch {
    /* sem Cache API: segue o aparelho */
  }
  return /^pt/i.test(self.navigator.language || "") ? "pt-BR" : "en";
}

/** Texto em inglês para os avisos que o kabuld manda com `kind` (o título/corpo do payload estão em português). */
function english(d) {
  if (d.kind === "waiting") return { title: `${d.name} is waiting for you`, body: d.detail || "Needs a decision from you." };
  if (d.kind === "done") return { title: `${d.name} finished`, body: "The agent finished its turn." };
  return null;
}

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "Kabul", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    uiLang().then((lang) => {
      const en = lang === "en" && d.kind ? english(d) : null;
      return self.registration.showNotification((en && en.title) || d.title || "Kabul", {
        body: (en && en.body) || d.body || "",
        tag: d.tag || undefined,
        renotify: !!d.tag,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { url: d.url || "/m/" },
      });
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/m/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
