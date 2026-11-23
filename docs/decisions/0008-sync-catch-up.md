# ADR-0008 (Architecture Decision Record): catching up with version vectors

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (method chosen by AJ on a decision card, 2026-11-23)
- **Date:** 2026-11-23

## Context

Phase 5 connects replicas: each client keeps its ops in IndexedDB (the browser's
built-in local database), and a Node server relays ops between clients over WebSocket
and keeps its own copy per document. Clients go offline, and the server can be killed
and restarted. On every reconnect, two sides that each hold some ops must work out what
the other is missing and send exactly that.

The CRDT (Conflict-free Replicated Data Type) already accepts ops in any order and
ignores duplicates (P2, P4), so sending too much only costs traffic. Sending too little
is the real danger: an op nobody resends is lost for good.

## Decision

1. **Version vectors** (AJ's pick over server-assigned sequence numbers and over
   exchanging every op ID). Each side summarises what it holds as one number per
   author, and the other side sends everything above that number.
2. **Each op gets a per-author sequence number, `seq`**, separate from its Lamport
   counter. The author's first op is 1, then 2, 3, and so on with no gaps. The vector
   holds these numbers, not Lamport counters, because:
   - Lamport counters jump. Bob's ops might be counters 1, 2, 9, 10, because he saw
     Alice's op 8 in between. "Highest counter from Bob is 10" can't tell whether 9 is
     missing.
   - With `seq`, "I hold Bob's ops up to 4" means exactly 1, 2, 3 and 4, so a gap is
     visible.
3. **A vector entry is the end of the unbroken run.** If a side holds Bob's ops 1, 2 and
   4, its vector says 2, not 4, so the other side resends 3 and 4. An op that arrives
   ahead of a gap is kept, but doesn't move the vector until the gap is filled. This
   is what makes a race safe: Alice's op 8 arriving straight from Alice while Bob is
   still uploading Alice's ops 5 to 7 can't hide 5 to 7.
4. **One stored unit is an entry: `{seq, op}`.** The author is the op's own replica
   (`op.id.replica`), so it isn't stored twice. The author assigns `seq` when the op is
   made locally, and it never changes after that.
5. **`OpLog` in `packages/sync-protocol`** holds a document's entries, on the server and
   in every client:
   - `append(op)` stores a local op under the author's next `seq`.
   - `add(entry)` stores an entry from elsewhere and reports whether it was new.
   - `vector()` returns the version vector.
   - `missing(vector)` returns every entry the other side lacks, sorted by author and
     then `seq`, so each author's ops arrive in order.
6. **Wire messages** are versioned JSON like ops (ADR-0007), decoded as strictly, with
   `DecodeError` for anything malformed:
   - `hello {doc, vector}`, client to server, opens a session for one document.
   - `welcome {vector}`, server to client, answers it.
   - `ops {entries}`, either way, carries entries. After the handshake, each side sends
     the other `missing(theirVector)`, then live edits as they happen.

   A vector goes on the wire as a list of `[replica, seq]` pairs, not as an object,
   because a replica ID like `"__proto__"` is a dangerous object key.
7. **A replica that loses its local storage needs a new replica ID.** Its `seq` would
   restart at 1 and clash with the ops it already sent. The web app (Phase 6) generates
   a fresh ID whenever it starts with an empty database.

## Plan for the rest of Phase 5

Each step is one PR with its own tests:

1. **This step:** `OpLog`, version vectors and the message codec. Property tests, no
   network yet.
2. **Server:** `apps/server`, a Node `ws` server holding one `OpLog` per document, saved
   to disk so a restart keeps it, and relaying new entries to the other clients of that
   document.
3. **Client:** a client class holding a `FastFugue`, an `OpLog` and a socket, saving
   entries and periodic snapshots to IndexedDB, and doing the handshake on every
   reconnect. Tested in Node with an in-memory IndexedDB.
4. **Exit test:** three clients, the server killed and restarted mid-session, one client
   offline across the restart, and all three end with identical state. (Landed together with step 3,
   in ADR-0010.)

## How it is checked

`packages/sync-protocol/src/log.property.test.ts`:

- Authors make random ops. Two logs each receive a random subset, in a random order
  that respects nothing, including entries ahead of gaps. After each sends the other
  `missing(otherVector)`, both hold exactly the union of what either held.
- A vector entry is always the longest unbroken run from 1, checked against a plain
  model.
- The message decoder is fuzzed like `decodeOp`: either `DecodeError` or a message that
  round-trips.

## Rejected

- **Server sequence numbers.** Simpler, but if the server's log is wiped, clients can't
  tell what to resend, and only the server can be a sync partner.
- **Exchanging every op ID.** Correct, but each reconnect costs the whole history.
- **Vectors of Lamport counters.** Can't see gaps (item 2).

## Consequences

- Every stored op carries one extra number.
- A vector has one entry per author who ever edited the document. That is fine for a
  notes app; documents with thousands of authors would need something more compact.
