# CRDT design (Conflict-free Replicated Data Type)

Acronyms are expanded on first use. Full definitions live in `glossary.md`.

The writeup. Sections marked `TODO` get filled in as you build. The interleaving section
is pre-written because you need it before you can choose an algorithm — verify every
claim in it against the papers before you publish.

---

## 1. The problem

TODO — what "conflict-free" means for text, why last-writer-wins on the whole document
is useless, why OT (Operational Transformation) — the pre-CRDT approach, where incoming ops are
rewritten against the ops their author hadn't seen — needs a central server to be
tractable.

---

## 2. Model

TODO — ops (operations), IDs, Lamport clocks (per-replica counters giving causal order
without synchronised wall-clocks), replica IDs, what happens-before means here, why you
need tombstones (deleted characters kept as markers, because a concurrent op may still
reference them as an insertion point).

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
right siblings with different right origins (the paper's Figure 7). Section 3 above and
the ADR-0001 table currently say Fugue itself is maximal; that needs correcting. AJ chose
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

TODO. The shape of the problem: a deleted character can't be removed outright, because a
concurrent op might reference it as an origin. Options to evaluate — never collect;
collect once an op is *causally stable* (every replica has seen it, which requires
knowing the replica set); run-length-encode tombstone spans so the cost is per-span not
per-character. Note what Yjs does and why. Record the decision in ADR-0003.

---

## 6. Sync protocol

TODO — vector clock handshake, what the server stores, what happens when a client
reconnects after a week offline, why presence is deliberately outside the CRDT.

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
