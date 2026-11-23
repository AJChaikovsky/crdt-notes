# ADR-0009 (Architecture Decision Record): the sync server

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (follows from ADR-0008; no new fork)
- **Date:** 2026-11-23

## Context

Step 2 of Phase 5 (ADR-0008): a Node server that keeps each document's op log, catches
clients up when they connect, and relays new ops between them. The exit test kills and
restarts it, so what it has accepted must survive a crash.

## Decision

1. **`apps/server`, using `ws`** (the standard Node WebSocket library, 8.19.0) as the
   roadmap says. `startServer({ port, dataDir })` returns the port and a `close()` that
   cuts every connection without a goodbye, which is how the tests simulate a crash.
2. **The server never opens the document.** It holds one `OpLog` per document and moves
   entries; it doesn't need `FastFugue`, because merging happens on the clients.
3. **One file per document, one entry per line** (`encodeEntry`: versioned JSON, the same
   op format as everywhere else). Every write is an append, done synchronously before the
   entry is relayed.
   - A crash can only cut off the last line. Loading drops a cut-off line and truncates
     the file back to the last complete line, so the next append doesn't glue onto it.
   - The dropped entry isn't lost: the client that sent it still has it, and the next
     handshake shows the server's vector is missing it.
   - A broken line in the middle of a file is real corruption, not a crash, so loading
     throws and the server stops rather than serving a damaged document.
4. **File names are the document name in base64url** (letters, digits, `-` and `_`), so a
   name like `../../etc` can't reach outside the data folder. Names must be 1 to 200
   characters.
5. **The session protocol** (ADR-0008 item 6): `hello`, then `welcome` and `ops` with what
   the client lacks, then `ops` both ways. Only entries the server didn't already hold
   are saved and relayed, and never back to their sender.
6. **Anything unexpected closes the connection with code 1008** (policy violation): bad
   JSON, `ops` before `hello`, a second `hello`, a `welcome` from a client. The server
   doesn't try to recover a confused session; the client reconnects and the handshake
   repairs any gap.

## How it is checked

`apps/server/src/server.test.ts`, over real WebSockets on a random port:

- Relay between two clients of a document, and no relay across documents.
- A reconnecting client is caught up and uploads what it typed offline, and both end with
  the same text and vector.
- A restart keeps every document's log.
- Malformed messages and `ops` before `hello` close the connection with 1008.
- A cut-off last line is dropped and later appends stay clean; a path-like document name
  stays inside the data folder.

Four planted bugs were all caught (`../testing-strategy.md`).

## Rejected

- **Storing snapshots on the server.** The server doesn't hold a document, and a
  log of 31 MB for the whole trace is acceptable for now. Compaction can come later.
- **A database (SQLite and the like).** More moving parts than an append-only file, for
  no benefit at one process and one folder.
- **Writing asynchronously.** Faster under load, but an entry could be relayed before it
  is on disk; with the sync write, anything another client has seen is saved.

## Consequences

- Every accepted entry costs a synchronous disk write. Fine for a notes app; batching is
  the fix if it ever isn't.
- The whole log of an opened document stays in memory while the server runs.
