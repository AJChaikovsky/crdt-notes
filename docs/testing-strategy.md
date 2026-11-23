# Testing strategy

Acronyms are expanded on first use; full definitions live in `glossary.md`.

Five layers. The properties are the load-bearing ones.

1. **Unit tests** — encoding, clock arithmetic, ID comparison. Cheap, boring, necessary.
2. **Property tests** — P1–P9 below, via fast-check. Rather than asserting one input
   gives one output, you state a rule that must hold for *all* inputs and let the library
   generate thousands. The interesting bugs here live in op orderings no human would
   think to write by hand.
3. **Corpus** — every shrunk counterexample (fast-check automatically retries failures
   with simpler inputs until it finds the smallest one that still fails), frozen as a named regression test forever.
4. **Trace replay** — recorded realistic editing sessions replayed through the CRDT and
   compared against the Phase 1 reference implementation.
5. **End-to-end** — Playwright, two contexts, real offline/online transitions.

---

## The properties

Each takes: N replicas (2–5), a random sequence of local operations per replica, and a
random *causally valid* delivery order.

**P1 — Convergence.** After all ops are delivered everywhere, every replica's rendered
text is identical. This is SEC (Strong Eventual Consistency) — replicas that have seen the same ops are in
the same state, with no rollback and no conflict dialog — and it's the whole ballgame.

**P2 — Idempotence.** Delivering the same op twice leaves state unchanged. You will
need this when the sync server replays on reconnect.

*How it's tested:* scenarios include `redeliver` steps that send a replica an op it has
already applied (its own ops included, as a server echo), mixed in with edits and
deliveries. Each replica's final text must equal the same scenario run with every
`redeliver` step removed. Because duplicates are part of every scenario, P1 runs over
them too.

**P3 — Commutativity.** Two concurrent ops applied in either order give the same state.

*How it's tested:* run a scenario's steps without draining, then make one edit on each
of two different replicas before either op is delivered, so the two are concurrent.
Replay the op log into two fresh replicas, then apply the pair as AB on one and BA on
the other, and compare `Rga.items()` (every item, tombstones included), not just text.

**P4 — Causal readiness.** An op whose dependencies haven't arrived is buffered, not
applied and not dropped. Generate deliberately out-of-order deliveries and assert the
buffer drains correctly once the gap fills.

*How it's tested:* the simulator's `{ causal: false }` mode delivers any pending op at
any time. After the same scenarios as P1, every replica must have nothing held
(`pendingCount` 0), identical `items()`, and every insert ever made. About half of
scenarios end their steps with ops still held, so the buffer is exercised. See ADR-0003.

**P5 — Intention preservation.** Every local edit lands where the author's cursor was:
an insert at index `i` shows up at index `i` of the author's own text, and a delete at
index `i` removes exactly that character. If this fails, a user's keystroke appeared
somewhere other than where they typed it.

*How it's tested:* after every local edit in a scenario (causal or not), the author's
new text must equal the old text with the character spliced in at, or removed from, the
cursor index.

*Changed 2026-09-28 (AJ's pick).* The first version said: keep only replica R's
characters in the merged document, and they must appear in the order R typed them. That
can't fail once replicas converge, because integrating only ever splices an item in and
never moves one, so R's characters keep the relative order R saw. It also missed the
bug it was meant to catch: without `observe`, a new character can land on the wrong side
of a remote one, and filtering out the remote one hides that.

**P6 — Conservation.** Once everything is delivered, each replica's visible character IDs
are exactly the inserted IDs minus the IDs that some delete targeted. No characters
invented, none lost, none shown twice. Deletes count by distinct target, since two
concurrent deletes of the same character remove it once.

*How it's tested:* after the same scenarios as P1 (causal or not), compare each replica's
`visibleIds()` as a sorted list against the expected IDs computed from the op log.

*Changed 2026-09-28 (AJ's pick).* The first version compared the multiset of visible
characters (counts of each letter). With a five-letter alphabet repeated letters are
common, and a count can't tell which "e" was deleted, so IDs are compared instead.

**P7 — Non-interleaving.** If replica R inserted characters c₁…cₙ as a contiguous run
with no concurrent op from R in between, then c₁…cₙ appear contiguously in the merged
result. Generate runs in *both* directions — left-to-right typing and right-to-left
insertion at a fixed index. The second one is where algorithms die. See
`docs/crdt-design.md#the-interleaving-problem`.

*How it's tested:* a dedicated generator builds a shared starting document, then 2 to 4
replicas each type one run of 2 to 5 characters, forward or backward, at a chosen index,
all concurrently. After delivery, every run's character IDs must appear as one unbroken
stretch, in the run's own reading order, on every replica.

*Status 2026-09-28:* green for forward runs; fails at once on backward runs, as ADR-0001
predicted. One backward run is enough: a concurrent insert at the same spot sorts
between its characters, because they are all siblings. The shrunk case is pinned in
`packages/crdt/test/corpus/p7-backward-run-interleaves.test.ts`. P7 is restricted to
forward runs until Fugue lands (AJ's pick), which then widens it and flips that test.

*Status 2026-09-29:* P1 to P7 now run against both RGA and Fugue. Fugue passes P7 on
forward and backward runs at 10,000 cases for seeds 1, 2 and 3. RGA stays on forward
runs only, and the full generator still breaks it within 1 or 2 cases. The corpus file
keeps the RGA case and adds the same edits under Fugue, expecting both runs whole.
Plain Fugue is only proved non-interleaving for forward runs (ADR-0001's correction
note), so a rare backward case may exist that this generator doesn't reach. None has
turned up yet.

**P8 — Serialization round-trip.** `decode(encode(op))` deep-equals `op`, for every op
shape. Fuzz the decoder with random bytes too: it should reject, not crash.

**P9 — Snapshot equivalence.** State loaded from a snapshot equals state rebuilt by
replaying the full op log from empty. This is what lets you compact the IndexedDB log.

---

## Harness notes

- **Seeds.** `numRuns: 100` locally for fast feedback. `numRuns: 10000` in CI, with the
  seed logged on every run so any failure is reproducible.
- **Shrinking.** Build your generators from fast-check's combinators rather than
  `fc.constantFrom` over pre-baked scenarios, or shrinking gives you useless
  counterexamples. A 4-character repro is worth an hour of setup.
- **Test the tests.** At least once per phase, inject a deliberate bug and confirm the
  suite catches it. Record how many seeds it took. If a mutation survives 10k seeds,
  your generators aren't exploring the interesting space.
- **Causal validity.** Your delivery-order generator must respect happens-before — op A
  happens-before op B if B's author had already seen A; if neither precedes the other
  they're concurrent, which is the only case the merge rule has to think about — by
  default, with a separate opt-in mode that violates it — that mode is how you test P4.

---

## Mutation log

Deliberate bugs injected to check the suite catches them (seeds 1, 2, 3; up to 10,000
runs each).

| Date | Property | Mutation | Caught after |
|---|---|---|---|
| 2026-09-28 | P1 | Sibling tie-break compares counters only, ignoring replica ID | 1, 1, 1 runs; shrinks to two replicas each inserting one char at index 0 |
| 2026-09-28 | P1 | Skip loop stops at tombstones | 5, 16, 7 runs |
| 2026-09-28 | P1 | `apply` doesn't call `clock.observe` | **not caught** in 10,000 runs: replicas still converge, just on an order nobody typed. P1 can't see it; P5's cursor check does (see below) |
| 2026-09-28 | P2 | `#integrate` drops the `#has(op.id)` duplicate guard | 1, 1, 1 runs; shrinks to one insert echoed back to its author. P1 also fails now that scenarios contain duplicates |
| 2026-09-28 | P2 | A delete toggles `deleted` instead of setting it | 3, 3, 1 runs; shrinks to insert, delete, then the delete echoed back. P1 also fails |
| 2026-09-28 | P3 | Skip loop stops at tombstones | 925, 123, 78 runs (P1 is faster at 5, 16, 7). Shrinks to a pure hidden-state failure: a delete and a concurrent insert of the same char at the start leave text "a" on both copies but the tombstone on different sides |
| 2026-09-28 | P3 | Sibling tie-break compares counters only | 3, 4, 13 runs; shrinks to two replicas each inserting "a" at index 0 |
| 2026-09-28 | P4 | Early ops are dropped instead of held | 1, 1, 3 runs |
| 2026-09-28 | P4 | Held ops are never retried | 1, 1, 3 runs |
| 2026-09-28 | P4 | Only one held op is released per arrival, so chains stay stuck | 2, 2, 3 runs |
| 2026-09-28 | P5 | `apply` doesn't call `clock.observe` | 27, 20, 51 runs; P1 to P4 all still pass. Shrinks to: A types "a" twice at index 0, B receives only the second (delivered out of order), then types "e" at index 0 and sees "ae" |
| 2026-09-28 | P6 | A delete tombstones the item after its target | 1, 1, 3 runs. Every other property fails too: a loud bug, but P6 names it directly ("this ID should be gone") |
| 2026-09-28 | P6 | The duplicate check compares counters only, so a concurrent insert with the same counter is dropped | 1, 2, 1 runs; P1 to P5 fail as well |
| 2026-09-29 | Fugue unit tests | Held ops are never retried | 2 of 61 tests fail (the two held-op tests). Properties don't run against Fugue until step 3 |
| 2026-09-29 | Fugue unit tests | Early ops are dropped instead of held | 2 of 61 tests fail (the same two) |
| 2026-09-29 | Fugue unit tests | A delete looks up its target but doesn't tombstone it | 4 of 61 tests fail (every delete test) |
| 2026-09-29 | P5, P7 (Fugue) | Local insert always makes a right child of the origin, never a left child | P7 after 1, 2, 3 runs and P5 after 1, 1, 1 runs. P1 to P4 and P6 still pass: replicas converge, just in the wrong order |
