# ADR-0014 (Architecture Decision Record): the offline shell and the exit test

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (follows from the roadmap; no new fork)
- **Date:** 2026-11-23

## Context

The roadmap asks for a service worker, a PWA (Progressive Web App) manifest and an
offline-first shell: the app must open with no network at all, not just keep working once
it is open. Its exit test is two browser contexts, network disabled on both, divergent
edits to the same sentence, network restored, both DOMs (Document Object Models)
identical.

## Decision

1. **A hand-written service worker** (`apps/web/sw.js`), about 50 lines, instead of a
   library such as Workbox. The project is about knowing how each layer works, and this
   one is small.
2. **The build lists every file.** A small Vite plugin (`serviceWorker()` in
   `apps/web/vite.config.ts`) writes the list of built files into `sw.js`, with a version
   made from a SHA-256 hash of their contents. A new build is a new service worker; an
   unchanged build is not.
3. **Install downloads everything first.** All files of a version go into one cache,
   `crdt-notes-<version>`, before that version takes over. If any download fails the
   install fails and the old version keeps serving, so a half-cached app is never served.
   Activating deletes older versions' caches and takes over open pages.
4. **Cache first.** Requests for the app's own files are answered from the cache, matched
   by address only (`ignoreVary`, because the preview server's `Vary: Origin` made module
   scripts miss). A page address gets `index.html`, whatever note follows `#`. This is
   what "offline-first" means: the app opens instantly with or without a network, and a
   new version shows on the reload after it was downloaded.
5. **Only in a built app.** In development Vite serves changing files, which a cache would
   hide, so `main.tsx` registers the worker only when `import.meta.env.PROD`.
6. **The manifest** (`public/manifest.webmanifest`) names the app, its colours and its
   icons (an SVG, and 192 and 512 pixel PNGs rendered from it), so browsers offer to
   install it and open it in its own window.
7. **The app follows the browser's `offline` and `online` events.** It disconnects when
   the browser says the network is gone and connects when it is back. Without this, a
   socket on a dead network can look open for minutes and the status would say "Synced".
   `SyncClient` stays free of browser events, so its Node tests are unchanged.
8. **The exit test** (`apps/e2e`, Playwright 1.63.0) runs against the *built* app on its
   own ports (sync server 8788, app 4174), so it tests what people get, service worker
   included. "DOMs identical" compares the editor's HTML after removing the other
   person's cursor and selection, which are meant to differ, and the empty image and
   `<br>` CodeMirror adds beside a cursor widget. A second test reloads a note with the
   network off. CI runs both in a separate job.

## How it is checked

- `apps/e2e/tests/phase6-exit.spec.ts`, three passing runs in a row locally.
- Planted bugs: no reconnect on `online`, only `index.html` cached, and a remote delete
  applied one place early were each caught. Serving page addresses by their own address
  instead of `index.html` survived, because with notes after `#` every page address *is*
  the root; that mutant is equivalent today (`../testing-strategy.md`).

## Rejected

- **Workbox or vite-plugin-pwa.** Fewer lines here, but a layer of configuration hiding
  the 50 lines that matter.
- **Network first.** Always fresh, but on a bad connection the app waits for a timeout
  before opening, which is the opposite of local-first.
- **Comparing the whole editor HTML as is.** It always differs, since each window shows the
  other person's cursor.

## Consequences

- A new version appears one reload after it was downloaded.
- A socket can still sit half-open when the browser doesn't notice the network is gone
  (for example, a Wi-Fi network that stops routing). A heartbeat would catch that; it is
  parked in the roadmap.
- The sync server address is fixed at build time (`VITE_SYNC_URL`).
