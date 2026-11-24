/* global self, caches, fetch, URL, Response, __FILES__, __VERSION__ */
// The service worker (ADR-0014): a script the browser keeps beside the page, which answers
// the page's requests itself. It makes the app open with no network at all.
//
// The build fills in the two constants below (see `serviceWorker()` in vite.config.ts):
// every file the app needs, and a version that changes whenever any of them does.

const FILES = __FILES__;
const VERSION = __VERSION__;
const CACHE = `crdt-notes-${VERSION}`;

// Installing: download every file of this version before taking over, so a half-cached
// app is never served. If any download fails, the install fails and the old version stays.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

// Activating: delete older versions' files, and take over pages that are already open.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("crdt-notes-") && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Every request for the app's own files is answered from the cache first. A page address
// gets the app's index.html, whatever note follows the `#`. Anything else (the sync
// server is a WebSocket, which never comes through here) goes to the network as usual.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const key =
    request.mode === "navigate" ? new URL("./", self.location.href).href : url.href;
  event.respondWith(
    caches
      .open(CACHE)
      // By address only: the cached copy is the same file whatever headers asked for it.
      .then((cache) => cache.match(key, { ignoreVary: true }))
      .then((cached) => cached ?? fetch(request))
      .catch(() => new Response("Offline, and this file isn't cached.", { status: 503 })),
  );
});
