# ADR-0010 (Architecture Decision Record): the sync client

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (follows from ADR-0008 and ADR-0009; no new fork)
- **Date:** 2026-11-23

## Context

Step 3 of Phase 5 (ADR-0008): one document on one device. It must work fully offline,
survive the tab being killed at any moment, and sync with the server (ADR-0009)
whenever it can reach it. The web app (Phase 6) will be a screen on top of this.

## Decision

1. **A new package, `packages/sync-client`,** rather than putting this inside
   `sync-protocol` or `apps/web`. `sync-protocol` stays free of storage and sockets, and
   the client can be tested in Node without a browser. It uses the standard browser
   APIs (`indexedDB` and the global `WebSocket`, which Node 22 also has), and takes
   either as an option so tests can substitute them.
2. **`SyncClient` holds a `FastFugue`, an `OpLog` and a `Storage`.** Edits go through
   `insertAt` and `deleteAt`; `connect()` and `disconnect()` switch syncing on and off,
   and while connected it reconnects by itself after a drop (default delay 1 s).
3. **IndexedDB layout: one database per document, `crdt-notes:<doc>`,** with two object
   stores:
   - `entries`: every entry, keyed by `[author, seq]`, as `encodeEntry` text.
   - `meta`: the device's replica ID, and the latest snapshot with the version vector
     of the entries it already includes.
4. **An op is saved before it is sent.** If an op reached the server and the tab died
   before saving it, the reloaded client would number its next op with the same `seq`
   (and possibly the same Lamport ID), and the server would ignore the new op as a
   duplicate: the two replicas would silently disagree forever. So:
   - local entries go to the server only after their IndexedDB transaction commits;
   - the handshake's catch-up leaves out entries still being saved;
   - a failed save puts the entries back to be retried with the next write, and they
     are sent once a save succeeds. `saved()` rejects if the retry fails too.
5. **A snapshot is saved in the same transaction as the entries it includes,** every
   1000 entries by default. The snapshot and its vector are taken at the moment the
   write starts, when every entry in the log is either already saved or part of that
   write. A snapshot taken separately could hold an edit whose entry never got saved,
   and that edit would then exist in this replica only.
6. **Opening a document** loads the snapshot, then applies only the saved entries above
   the snapshot's vector. Entries are still all loaded into the `OpLog`, because the
   server may need any of them on a handshake (for example, after losing its own data).
7. **A device with nothing saved gets a new random replica ID** (`crypto.randomUUID()`),
   as ADR-0008 item 7 requires.
8. **Received entries are applied straight away and saved afterwards.** If the tab dies
   first, they are not in the saved log, so the next handshake's vector asks for them
   again.

## How it is checked

`packages/sync-client/src/client.test.ts`, with `fake-indexeddb` (an in-memory
IndexedDB for Node, dev only) standing in for each device's storage and the real server
from ADR-0009:

- Reopening restores the text, the replica ID, and loading via snapshot plus later
  entries gives identical items.
- Two devices relay live edits; offline edits on both sides merge on reconnect; clients
  reconnect by themselves after a server restart; received edits survive a reload.
- With saves forced to fail, nothing unsaved reaches the server, either live or in the
  handshake, and it is sent once a save succeeds.

`packages/sync-client/src/phase5-exit.test.ts` is the roadmap's Phase 5 exit test: three
clients make random edits; the server is killed and restarted mid-session from its
files; one client stays offline and keeps editing across the restart; all three end with
identical items, and reloading every device from IndexedDB gives the same texts. It
passed 8 runs in a row.

Six planted bugs were all caught (`../testing-strategy.md`).

## Rejected

- **Sending first and saving in the background.** Faster to appear on other screens,
  but loses edits as item 4 describes.
- **Deleting entries once a snapshot covers them.** Halves storage, but then this device
  could no longer repair a server that lost data. Possible later, once the server can be
  trusted to keep everything.
- **localStorage instead of IndexedDB.** Synchronous, limited to a few MB, and no
  transactions.

## Consequences

- Every edit costs one IndexedDB transaction. Fast typing queues them, and each write
  takes every queued entry at once.
- Storage grows with the whole history, plus one snapshot.
