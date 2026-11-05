// VERSION zmieniaj przy zmianie listy SHELL (fetch jest network-first, więc zwykłe zmiany przychodzą same).
const VERSION = "v1";
const CACHE = `nawyki-${VERSION}`;
const SHELL = [
  "./", "index.html", "style.css", "config.js", "app.js", "api.js", "dates.js", "state.js", "ui.js", "settings.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("nawyki-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  // Tylko GET z własnego origin; api.github.com i reszta idą prosto do sieci, bez cache.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // Network-first: nowa wersja aplikacji przychodzi od razu, cache tylko gdy brak sieci.
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(p.title || "Nawyki", {
    body: p.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: p.tag || "nawyki",
    data: { url: p.url || "./" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope);
  const date = target.searchParams.get("date");
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find(c => c.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: "open-date", date });
    } else {
      await self.clients.openWindow(target.href);
    }
  })());
});
