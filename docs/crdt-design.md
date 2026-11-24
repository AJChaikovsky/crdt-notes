# CRDT design (Conflict-free Replicated Data Type)

Acronyms are expanded on first use. Full definitions live in `glossary.md`.

The writeup of how this project's text CRDT works, why, and how it compares. Every claim
about another algorithm or library was checked against its paper or by running it.

---

## 1. The problem

Several people edit the same note, each on their own device, sometimes offline for days.
Every device must accept edits instantly, without asking a server, and when devices
exchange what they have, all of them must end up showing the same text. That is what
"conflict-free" means for text: no edit is ever rejected or shown as a conflict for a
person to resolve, and any two devices that have received the same edits show the same
document, whatever order the edits arrived in (convergence, P1 in
`testing-strategy.md`).

**Last-writer-wins on the whole document doesn't do it.** If each device sends its whole
text and the newest copy wins, two people who edit different paragraphs offline lose one
person's work entirely. It converges, but by throwing edits away.

**OT (Operational Transformation)**, the approach behind Google Docs, sends edits as
"insert `x` at index 5" and rewrites each incoming edit against the edits its author
hadn't seen: if someone else inserted three characters before index 5 in the meantime, it
becomes "insert at 8". Getting the rewriting rules right for every pair of concurrent
edits, in every order they can arrive, is notoriously hard; several published OT
algorithms were later shown not to converge. A central server that puts every edit in one
order makes it tractable, because each client then only transforms against that one
sequence. That server is exactly what a local-first app can't depend on.

**A CRDT avoids rewriting** by never addressing characters by index on the wire. Each
character gets a permanent unique ID, and an edit says "insert this new character next to
character X" or "delete character Y". Those mean the same thing on every device, whatever
else has happened, so edits can be applied in any order without transformation. The cost
moves elsewhere: devices must keep IDs, and deleted characters, around (sections 2 and 5),
and concurrent inserts at the same place need a rule that keeps each person's typing
together (section 3).

---

## 2. Model

- **Replica.** One copy of a document on one device, with a **replica ID**: a random
  string chosen the first time that device saves the document (ADR-0002, ADR-0010).
- **Op (operation).** The unit that is sent and saved. An insert op carries the new
  character, its ID, and where it goes (in Fugue, a `parent` character and a `side`). A
  delete op names the ID of the character it deletes and has an ID of its own
  (ADR-0002, ADR-0004).
- **ID.** A pair `(counter, replica)`. IDs are compared by counter, then by replica ID
  with plain `<`. No two ops ever share one, because each replica only makes IDs with its
  own replica ID and never reuses a counter.
- **Lamport clock.** Each replica's counter. It adds 1 for every local op, and on
  receiving an op it jumps past that op's counter. So if op B was made by someone who had
  already seen op A, B's counter is bigger than A's: counters respect causal order without
  anyone's wall clock being right.
- **Happens-before.** Op A happens before op B if B's author had A when making B, directly
  or through ops received in between. Otherwise A and B are **concurrent**: neither author
  knew about the other's op. Only concurrent ops need a tie-break rule; for everything
  else, the order people saw is the order kept.
- **Causal readiness.** An op can only be applied once everything it refers to is
  present: an insert's `parent`, a delete's target. One that arrives early waits in a
  pending buffer until it is ready (P4, ADR-0003).
- **Tombstones.** A deleted character stays in the structure, marked deleted, hidden from
  the text. A concurrent insert may name it as its `parent`; if it were gone, that insert
  would have nowhere to go, and replicas that received the delete and the insert in
  different orders would put it in different places. Section 5 covers what this costs.

The guarantee all of this buys is strong eventual consistency: replicas that have received
the same set of ops are in the same state (P3), with no further messages or coordination.

---

## 3. The interleaving problem

Convergence is necessary and not sufficient. Two replicas can agree perfectly on a
document that is garbage.

Alice and Bob start from the same state and concurrently type at the same position.
Alice types `Hello`, Bob types `World`. Every algorithm here converges. The question is
what they converge *to*:

```
HelloWorld     fine
WorldHello     fine
HWeolrllod     converged, and completely unusable
```

The third is an **interleaving anomaly**. Nobody's intention survived it.

### Where each algorithm stands

**Logoot / LSEQ** (position-identifier algorithms; LSEQ is a name rather than an
expansion) use dense position identifiers — a new character gets a fractional
position between its neighbours. Concurrent runs interleave badly, including in the
simple case of two people typing left-to-right. Kleppmann, Gomes, Mulligan and
Beresford document this in *Interleaving anomalies in collaborative text editors*
(PaPoC 2019 — the Workshop on Principles and Practice of Consistency for Distributed
Data). Read it before you dismiss the approach; the failure is worse than you'd
guess.

**RGA (Replicated Growable Array)** gives each character a single **origin**: the ID of the character it was inserted
after. Same-origin siblings are ordered by descending timestamp, tie-broken by replica
ID, and a character's whole subtree follows it.

For left-to-right typing this works. Alice's `e` has `H` as its origin, `l` has `e`,
and so on — a chain. Chains don't interleave, and the PaPoC paper proves RGA never
interleaves forward insertions.

Now insert right-to-left. Suppose both replicas repeatedly insert at the same index,
so each new character has the *same* origin as the last rather than chaining off it.
Alice produces `abc` by inserting `c`, then `b`, then `a` — all three siblings of the
same origin X, with counters 1, 2, 3. Bob concurrently produces `xyz` the same way,
counters 1, 2, 3. Sort the six siblings by descending counter, tie-break by replica:

```
a(3,A)  x(3,B)  b(2,A)  y(2,B)  c(1,A)  z(1,B)   →   "axbycz"
```

Converged. Interleaved. This is not exotic — it's what an editor does whenever it
inserts at a fixed index, and it's what paste-and-edit patterns produce.

**YATA (Yet Another Transformation Approach)**, the algorithm behind Yjs, gives each
character *two* origins, left and right.
Bob's backward run now chains through right-origins, so the runs stay contiguous. The
integration algorithm that resolves concurrent insertions in the span between origins is
genuinely fiddly, and it is easy to write a version that looks right and converges in
your tests but is subtly wrong on a case you haven't generated. Your property suite is
the only thing standing between you and that.

**Fugue** — not an acronym, named for the musical form — (Weidner and Kleppmann, *The Art
of the Fugue*, 2023) also uses left and right
origins, structured as a tree where each node's children are split into left-descendants
and right-descendants. Its FugueMax variant is proved *maximally* non-interleaving — it
interleaves only in cases where every convergent algorithm must. Plain Fugue is proved
forward non-interleaving and falls slightly short on some backward cases (corrected
2026-09-28 against the paper's Theorem 9; see ADR-0004). The paper also identifies cases where YATA
still interleaves.

> **Verified 2026-11-24.** The paper's example (its Appendix A.1.9, three replicas, a
> backward insert after a one-way sync) still interleaves on Yjs 13.6.33: it merges to
> `axb`. Section 7 has the steps. Strictly, the paper makes the claim about Yjs, not about
> YATA as published; Yjs is YATA plus later changes.

### What this means for the property test

P7 in `docs/testing-strategy.md` must generate runs in both directions. A non-interleaving
test that only types left-to-right passes on RGA and tells you nothing.

---

## 4. The algorithm this project implements

Phases 1 and 2 built RGA (ADR-0001). Phase 3 replaces its ordering with Fugue. This
section is the Fugue design, written as pseudocode for review before any TypeScript.
Checked against Weidner and Kleppmann, *The Art of the Fugue*, Algorithm 1
(arxiv.org/abs/2305.00583).

**Agreed by AJ on 2026-09-28; recorded in ADR-0004.** Decisions (AJ, 2026-09-28):
plain Fugue sibling order; a new `Fugue` class side by side with `Rga`, same public
methods, with every property run against both (P7 in full for Fugue, forward-only for
RGA).

### State

```
Node   = { id, char, deleted, parent: Id | ROOT, side: LEFT | RIGHT,
           leftKids: Id[], rightKids: Id[] }      // each list kept sorted
ROOT   = a sentinel node standing for the start of the document
```

### The op

```
InsertOp = { kind: "insert", id, char, parent: Id | null, side: "left" | "right" }
```

The author decides `parent` and `side` when typing, and the op carries them, so a
receiver never recomputes them (as in the paper). This replaces RGA's `origin`, which
changes the op format in ADR-0002 item 5. `DeleteOp` is unchanged.

### Local insert at cursor index i

```
L = the visible character at index i - 1, or ROOT when i = 0    // as ADR-0002 item 6
if L has no right children:
    parent, side = L, RIGHT              // forward typing: chain to the right
else:
    R = the node right after L in the full walk, TOMBSTONES INCLUDED
    parent, side = R, LEFT               // R is leftmost in L's right subtree, so
                                         // it has no left children yet
op = { id: clock.tick(), char, parent, side }
integrate(op)
```

### Integrate (local and remote)

```
if op.id already present: return                          // P2
add the node; insert op.id into parent.leftKids or parent.rightKids,
    keeping the list sorted by compareIds, smallest first (Fugue)
```

Ready (P4) when `parent` is ROOT or present. Unlike RGA, no skip loop and no reliance on
Lamport order: siblings are placed by a sort, so arrival order cannot matter.

### Reading the document

```
walk(node): walk each of node.leftKids; visit node; walk each of node.rightKids
text()   = chars of walk(ROOT) that are not deleted
items()  = walk(ROOT), tombstones included
```

### Sibling order: Fugue, chosen by AJ 2026-09-28

- **Fugue:** siblings on each side sorted by ID, smallest first.
- **FugueMax:** left siblings as Fugue; right siblings sorted by their right origin
  (descending), ties by ID. Needs the op to also carry `rightOrigin`.

The paper proves only **FugueMax** maximally non-interleaving (Theorem 9). Plain Fugue is
proved forward non-interleaving, and can interleave backward in rare cases that need
right siblings with different right origins (the paper's Figure 7). Section 3 and ADR-0001 were corrected to say so on 2026-09-28. AJ chose
plain Fugue first: build the simpler rule, let P7 look for the gap, then move to FugueMax
if it finds one.

### Worked example: backward runs no longer interleave

Alice types `c`, then `b` at 0, then `a` at 0. Bob concurrently types `z`, `y`, `x` the
same way.

```
ROOT
├─ right: c(1,A)            ├─ right: z(1,B)
│   └─ left: b(2,A)         │   └─ left: y(2,B)
│       └─ left: a(3,A)     │       └─ left: x(3,B)
```

`c` and `z` are ROOT's right children; the sibling order decides which run comes first,
but each run is one subtree, so the walk gives `abcxyz` or `xyzabc`, never `axbycz`.

## 5. Tombstones and garbage collection

A deleted character can't simply be removed, because a concurrent op might name it as its
`parent` (section 2). So deletes leave tombstones, and the question is whether they can
ever be collected.

**Decision: never collect** (AJ, 2026-11-24, ADR-0015).

What it costs, measured on the automerge-paper trace: the final document has 104,852
visible characters and 182,315 nodes, so 77,463 (42%) are tombstones. They are part of
the 22.4 MB snapshot and of the memory in section 7. For notes, which are mostly typed
and rarely rewritten wholesale, that is a constant factor, not unbounded growth. The
measured cost of storing one node per character, deleted or not, is much larger than the
cost of the tombstones themselves.

The options that were weighed:

- **Never collect.** Always correct, with no extra machinery: an op from a device that was
  offline for a year still finds its parent.
- **Collect once a tombstone is causally stable**, meaning every replica has seen the
  delete, so no op that names it as a parent can still be in flight. Knowing that needs a
  known replica set and every replica reporting what it has. One device that never comes
  back blocks collection forever, and a device that does come back after its peers
  collected would hold ops pointing at nodes that no longer exist. In a Fugue tree a
  tombstone can also have children, so removing it means restructuring the tree on every
  replica the same way.
- **Compact spans** (run-length encoding): store a deleted stretch as one entry. This
  attacks the per-node cost rather than the tombstones, and it is the same change as runs
  in FastFugue, parked in `roadmap.md#parked`.

**What Yjs does,** checked in its source (`src/structs/Item.js`, `Item.gc`, version
13.6.33): a deleted item keeps its ID and origins, but its content is replaced by a
length-only `ContentDeleted`, and adjacent items merge, so a deleted stretch costs one
small struct. Only when a whole type is deleted are its items replaced by `GC` structs,
which keep just an ID range. So Yjs never forgets a deleted character's identity either;
it makes tombstones cheap by storing them as runs. That is the compact-spans option, and
the reason its document is so much smaller (section 7).

---

## 6. Sync protocol

A Node server relays ops between clients over WebSocket and keeps every document's ops on
disk. Clients keep their own ops in IndexedDB. Neither side ever needs the other to be
up: the server is a relay and a backup, not an authority, and the CRDT would converge with
any other way of passing ops around.

**Catching up (ADR-0008).** Each op gets a per-author sequence number, `seq`: 1, 2, 3...
for each author's ops, with no gaps. A side summarises what it holds as a **version
vector**: for each author, the highest `seq` up to which it has every op, with no holes.
On connecting, the client sends `hello` with its vector; the server answers `welcome` with
its own vector and every op the client lacks; the client then sends every op the server
lacks. After that, new ops flow both ways as they are made. A vector has one entry per
author ever seen, so the handshake is small whatever the document's size.

**What the server stores (ADR-0009).** One append-only file per document, one op per
line, written to disk before the op is relayed, so the server never passes on an op it
could forget in a crash. A line cut off by a crash is dropped on load; the client that
sent it still has it and resends it on the next handshake.

**What the client stores (ADR-0010).** Every op in IndexedDB, plus a snapshot every 1000
ops so loading doesn't replay the whole history. An op is saved before it is sent, so a
tab killed in between can't leave the server holding an op the device itself lost.

**After a week offline.** Nothing special happens. The device kept editing against its
own copy, saving every op. On reconnecting, the handshake sends the server everything the
device made that week and sends the device everything others made, in one round trip
each. The CRDT merges them like any concurrent edits, because that is all they are; the
week only makes the batch bigger. The Phase 5 exit test does this with a server restart
in the middle (`packages/sync-client/src/phase5-exit.test.ts`), and the Phase 6 exit test
does it in two browsers (`apps/e2e`).

**Why presence is outside the CRDT (ADR-0012).** Where someone's cursor is matters only
while they are connected. As CRDT ops it would be saved forever and replayed to every new
device, for information that is stale within seconds. So cursors travel as their own
`presence` message, which the server relays and keeps only in memory, and positions are
sent as anchors ("just after character X") so they stay right while others type.

---

## 7. Compared to Yjs and Automerge

Measured, not paraphrased: `pnpm compare` runs the code in `packages/compare`, which is
dev only and never imported by the app or the core.

### Speed, size and memory on a real trace

The automerge-paper trace (259,778 edits, ending at 104,852 characters), replayed through
each implementation in one run on one machine (2026-11-24, Node 22.23, a 4-core cloud
container, Yjs 13.6.33, Automerge 3.5.0):

| | FastFugue (ours) | Yjs | Automerge |
|---|---|---|---|
| Local replay (typing the whole trace) | 338 ms | 2,461 ms | 23,613 ms |
| Remote, one change at a time | 249 ms | 1,629 ms | 55,749 ms for the first 20,000 only |
| Remote, all at once | 249 ms | 881 ms | 3,663 ms |
| Saved size | 22.36 MB | 0.31 MB | 0.13 MB |
| Load from saved | 606 ms | 27 ms | 864 ms |
| Memory kept by one document | 70.5 MB | 3.4 MB | 97.3 MB |

How it was measured, because each choice moves the numbers:

- **Each library through its normal API.** Yjs and Automerge take a whole edit (delete a
  range, insert a string) as one change. FastFugue only has per-character `insertAt` and
  `deleteAt`, so it makes one op per character. Yjs's local time also includes encoding
  each change as an update for the network, which ours leaves to `sync-protocol`; ours is
  timed without that.
- **Remote, one change at a time** applies each change separately, the way changes arrive
  over a network while people type. Automerge slows as the document grows (about 3 ms a
  change by 20,000), so the full trace would take hours; it is timed on the first 20,000.
- **Remote, all at once** is the same changes applied as one batch: inside one
  transaction for Yjs, one `applyChanges` call for Automerge. FastFugue has no batch path,
  so it is the same loop.
- **Saved size** is FastFugue's snapshot (ADR-0007), `Y.encodeStateAsUpdate`, and
  `Automerge.save`.
- **Memory** is what one fully built document keeps alive: for the JS heap, what is freed
  when it is dropped; for Automerge, also how much its WebAssembly memory grew.

What it says, honestly:

- **We are faster at editing.** The B-tree (ADR-0006) makes every keystroke cheap, and a
  per-character op needs no splitting of runs. This is the one column we win clearly.
- **We lose badly on size and memory: 70 to 170 times bigger on disk, and 20 times Yjs's
  memory.** Both libraries store runs: a stretch typed in one go is one entry. Yjs ends
  this trace with 10,971 structs where we have 182,315 nodes. Our snapshot is also JSON
  (ADR-0007), while both libraries use compact binary encodings, and Automerge compresses
  its columns. Runs in FastFugue are parked (`roadmap.md#parked`); this table is the
  argument for un-parking them.
- **Loading is slower than Yjs** for the same reason: 182k nodes to rebuild instead of
  11k.
- **Automerge's memory is close to ours** despite storing runs. It keeps the full history
  of every change, so any past version can be rebuilt, which neither Yjs nor we do.

### Merge behaviour on the interleaving cases

The cases from section 3, run through all three (`packages/compare/test/interleaving.test.ts`,
which pins the answers below):

| Case | FastFugue | Yjs | Automerge |
|---|---|---|---|
| Forward: `Hello` and `World` typed at the same place | `HelloWorld` | `HelloWorld` | `WorldHello` |
| Backward: `abc` and `xyz`, each typed at index 0 | `abcxyz` | `abcxyz` | `xaybzc` |
| Multi-replica backward (below) | `xab` | `axb` | `abx` |

- Everyone handles forward typing. Which person's word comes first is a tie-break and
  doesn't matter.
- **Automerge interleaves backward runs**, exactly as section 3 predicts for RGA: its
  list ordering is RGA's (Replicated Growable Array's).
- **Yjs interleaves in the multi-replica backward case,** reproduced from *The Art of the
  Fugue*, Appendix A.1.9, which reported it on Yjs 13.6.8. Replica 3 types `b`. Replica 1
  receives it and types `a` before it. Replica 2, having seen nothing, types `x` at the
  start. Yjs 13.6.33 still merges this to `axb`, splitting the `ab` replica 1 typed.
  FastFugue keeps `a` next to its `b`. This settles the "verify this yourself" note in
  section 3: the claim holds, in this narrow case. The paper's Table 1 is careful about it:
  Yjs is proven forward non-interleaving, no single-replica backward example is known, and
  this multi-replica case is the one it found.
- A random search (fast-check, 20,000 cases of runs typed between full syncs) found no case
  where Yjs interleaved and FastFugue didn't, or the other way round. The multi-replica
  case needs a one-way sync between two of three replicas, which that search didn't
  generate.

---

## References

- Kleppmann, Gomes, Mulligan, Beresford. *Interleaving anomalies in collaborative text
  editors.* PaPoC 2019.
- Weidner, Kleppmann. *The Art of the Fugue: Minimizing Interleaving in Collaborative
  Text Editing.* 2023.
- Nicolaescu et al. *Near real-time peer-to-peer shared editing on extensible data
  types.* GROUP 2016. (YATA)
- Roh et al. *Replicated abstract data types: Building blocks for collaborative
  applications.* JPDC (Journal of Parallel and Distributed Computing) 2011. (RGA)
