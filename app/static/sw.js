/* Telearr service worker — app-shell offline cache.
 * Static assets: cache-first. Navigations: network-first, fall back to the
 * cached shell when offline. API/SSE/auth are never cached. */
const CACHE = "telearr-shell-v7";
const SHELL = [
  "/",
  "/static/app.css",
  "/static/js/main.js",
  "/static/js/core.js",
  "/static/js/views.js",
  "/static/js/icons.js",
  "/static/js/palette.js",
  "/static/js/connect.js",
  "/static/js/directory.js",
  "/static/js/review.js",
  "/static/js/i18n.js",
  "/static/i18n/ca.json",
  "/static/i18n/en.json",
  "/static/manifest.json",
  "/static/favicon.svg",
  "/static/icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never cache dynamic/auth/streaming endpoints.
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js" ||
      url.pathname.startsWith("/login") || url.pathname === "/logout") return;

  // Static assets: cache-first, then populate the cache.
  if (url.pathname.startsWith("/static/")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      })),
    );
    return;
  }

  // Page navigations: network-first so auth redirects work, offline → shell.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
  }
});
