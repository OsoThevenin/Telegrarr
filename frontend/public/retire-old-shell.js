// Imported by the generated service worker. An installed copy of the old UI has its
// pages and scripts in these caches, and nothing else would ever delete them.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => names.filter((name) => name.startsWith("telearr-shell-")))
      .then((oldShells) => Promise.all(oldShells.map((name) => caches.delete(name)))),
  );
});
