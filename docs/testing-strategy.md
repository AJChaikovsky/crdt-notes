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

**P3 — Commutativity.** Two concurrent ops applied in either order give the same state.

**P4 — Causal readiness.** An op whose dependencies haven't arrived is buffered, not
applied and not dropped. Generate deliberately out-of-order deliveries and assert the
buffer drains correctly once the gap fills.

**P5 — Intention preservation.** Take the merged document and delete every character
that didn't come from replica R. What's left must be exactly R's characters in the order
R inserted them. If this fails, you've reordered someone's typing.

**P6 — Conservation.** The multiset (a set allowing duplicates — you're comparing counts,
since a document really can contain forty `e`s) of visible characters equals (all inserted) minus
(all deleted). No characters invented, none lost.

**P7 — Non-interleaving.** If replica R inserted characters c₁…cₙ as a contiguous run
with no concurrent op from R in between, then c₁…cₙ appear contiguously in the merged
result. Generate runs in *both* directions — left-to-right typing and right-to-left
insertion at a fixed index. The second one is where algorithms die. See
`docs/crdt-design.md#the-interleaving-problem`.

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
| 2026-09-28 | P1 | `apply` doesn't call `clock.observe` | **not caught** in 10,000 runs: replicas still converge, just on an order nobody typed. P1 can't see it; P5 (intention preservation) should |
