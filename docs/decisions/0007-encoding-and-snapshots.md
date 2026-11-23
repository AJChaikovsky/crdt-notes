# ADR-0007 (Architecture Decision Record): encoding ops and snapshots

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (format chosen by AJ on a decision card, 2026-11-23)
- **Date:** 2026-11-23

## Context

Phase 5 stores ops in IndexedDB (the browser's built-in local database) and sends them
over a WebSocket, so ops need a format that survives a trip through bytes. A replica
also can't replay its whole history on every page load forever, so it needs a snapshot:
its whole state in one value, loaded in one step. CLAUDE.md requires two properties
before any of that is wired up:

- **P8:** `decode(encode(op))` equals `op` for every op shape, and the decoder rejects
  random input instead of crashing.
- **P9:** state loaded from a snapshot equals state rebuilt by replaying the full log.

Both cover Fugue ops (`FugueOp`), which is what `Fugue` and `FastFugue` send. `Rga` is
the Phase 1 stepping stone and gets neither.

## Decision

1. **JSON with a version number** (AJ's pick over a compact binary format). Readable when
   debugging and quickest to build. Every encoded value carries `"v": 1`, and callers
   only ever use the function pairs below, so a binary format can replace JSON later as
   version 2 without touching them.
2. **One op is one JSON object:** the op's own fields plus `v`, for example
   `{"v":1,"kind":"insert","id":{"counter":3,"replica":"A"},"char":"x","parent":null,"side":"right"}`.
   `encodeOp(op)` returns that string; `decodeOp(text)` returns the op or throws
   `DecodeError`.
3. **The decoder trusts nothing.** Anything that comes off the network or out of storage
   may be corrupt, truncated, from a newer version, or hostile. `decodeOp` checks every
   field and throws `DecodeError`, never anything else:
   - `v` must be 1. Version 2 data is rejected, not guessed at.
   - `kind` must be `"insert"` or `"delete"`, and the object must have exactly that
     kind's fields. An unknown extra field is rejected, because it means a format this
     version doesn't understand.
   - A counter must be a whole number from 1 to `Number.MAX_SAFE_INTEGER` (2^53 − 1).
     Clocks start at 1, and above that limit two different counters can round to the
     same number.
   - A replica must be a string. A `char` must be a non-empty string.
   - `side` must be `"left"` or `"right"`, and an insert at the start (`parent: null`)
     must be `"right"`, because the start of the document only has right children.
4. **A snapshot is one JSON object** `{"v":1,"clock":n,"nodes":[...],"pending":[...]}`:
   - `nodes`: every character ever inserted, tombstones included, each as its insert
     op's fields plus `deleted`.
   - `clock`: the replica's Lamport clock counter (0 for a replica that has seen nothing).
   - `pending`: ops held back because their parent or target hasn't arrived (P4), in
     arrival order, each in the op format above without its own `v`.
   - Taken with `doc.snapshot()`, loaded with `Fugue.load(replica, text)` or
     `FastFugue.load(replica, text)`. Both classes read and write the same format, so a
     snapshot from one loads into the other.
5. **Loading replays the inserts.** Each node is attached as if its insert op had just
   arrived, then marked deleted if its flag says so. Attaching uses the op's own parent
   and side, so the loaded Fugue tree has exactly the same shape as the original, not
   just the same text. That matters: the shape decides where future concurrent inserts
   go.
6. **Nodes are listed parent before child,** in a pre-order walk of the Fugue tree (a
   node, then its left children's subtrees, then its right children's). Loading in that
   order always finds a node's parent already attached. Sorting by counter would also
   put parents first for every op this code creates, because a parent is always seen
   before its child is typed, but it relies on peers following that rule; the tree walk
   doesn't. Two replicas in the same state also produce byte-identical snapshots, which
   Phase 5's "reload is byte-identical" check can use.
7. **The clock is stored, not recomputed.** Recomputing it from the nodes would miss
   delete ops, which have their own IDs (ADR-0002) but leave no node behind. A replica
   reloaded with a clock lower than one of its own old deletes could reuse that ID for a
   new insert, and a peer still holding the old delete in its pending buffer would throw
   the new insert away as a duplicate.
8. **Load is as strict as `decodeOp`.** A node whose parent hasn't appeared earlier in the
   list, two nodes with the same ID, or a clock lower than any ID in the snapshot all
   throw `DecodeError`.

## Results (2026-11-23, Node 22, cloud container, `pnpm bench`)

Full automerge-paper trace with `FastFugue`, one-letter replica IDs:

| What | Size | Time |
|---|---|---|
| Snapshot (182,315 nodes, tombstones included) | 22.4 MB | 373 ms to write |
| Loading that snapshot | | 572 ms |
| The whole op log, one encoded op each | 31.2 MB | |

Real replica IDs are UUIDs (Universally Unique Identifiers, 36 characters), which would
roughly double both sizes. That is workable for Phase 5 but large; a binary version 2 is
the first thing to reach for if storage or load time becomes a problem.

## How it is checked

- **P8 round-trip** (`crdt-testkit/src/encoding.property.test.ts`): every op from random
  multi-replica scenarios, plus ops with random replica strings, characters and counters
  up to 2^53 − 1, comes back equal.
- **P8 fuzz:** random strings, random bytes decoded as UTF-8, random JSON values, and valid
  encodings with fields removed, changed or added. `decodeOp` must either throw
  `DecodeError` or return an op that round-trips; any other exception fails.
- **P9** (`crdt-testkit/src/snapshot.property.test.ts`): run a random scenario partway,
  snapshot every replica, and load each snapshot into both implementations. Each loaded
  copy must have the same items, pending count and snapshot as the original. Then the
  rest of the scenario's ops are applied, and new local edits made, on original and copy
  alike: the ops they send and the items they end with must stay identical. That checks
  the tree shape and the clock, not just the text.
- Unit tests in `crdt/src/encoding.test.ts` cover each rejection rule by name.

## Rejected

- **Compact binary now.** About 3–5× smaller, but more code to write and fuzz before
  storage and sync work at all. The version number leaves room to switch.
- **Snapshot nodes sorted by counter.** Works for honest peers, fails to load for any op
  whose parent has a bigger counter (item 6).
- **Rebuilding the clock from the nodes.** Loses delete IDs (item 7).
- **Lenient decoding** (ignore unknown fields, fill in defaults). It turns a version
  mismatch or a corrupt record into a silently different document.

## Consequences

- JSON is big: field names repeat for every character. Phase 5 can compress or move to
  binary as version 2 if storage size becomes a problem.
- Snapshots keep every tombstone forever. Removing them safely needs every replica to
  have seen the delete, which is out of scope here.
