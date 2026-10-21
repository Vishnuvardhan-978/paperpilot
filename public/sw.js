/*
 * PaperPilot service worker: the app opens offline.
 * - Build assets (/_next/static) are immutable: cache-first.
 * - Pages: network-first, falling back to the last cached copy.
 * - API calls are never cached; they fail fast offline and the page shows its own error.
 * Chats, flashcards and quiz history already live in IndexedDB/localStorage, so they are there offline.
 */
const VERSION = "pp-v1";
const PAGES = ["/app", "/study", "/parent", "/settings", "/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(PAGES.map((p) => c.add(new Request(p, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/monaco/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/app"))),
    );
  }
});
