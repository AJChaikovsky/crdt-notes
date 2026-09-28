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
and right-descendants. It's proved *maximally* non-interleaving — it interleaves only in
cases where every convergent algorithm must. The paper also identifies cases where YATA
still interleaves.

> **Verify this yourself.** That last claim about YATA is exactly the sort of thing a
> writeup gets wrong by repeating. Construct the case, run it through Yjs, and report
> what you actually observed. If you can't reproduce it, say so.

### What this means for the property test

P7 in `docs/testing-strategy.md` must generate runs in both directions. A non-interleaving
test that only types left-to-right passes on RGA and tells you nothing.

---

## 4. The algorithm this project implements

TODO — after ADR-0001. Include: the integration rule in pseudocode, a worked example of
two concurrent inserts stepping through it, and the exact comparison function used for
tie-breaking, spelled out, because that's where the bugs live.

---

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

TODO. Measure, don't paraphrase. Run the same editing trace through your implementation,
Yjs, and Automerge, and report document size, memory, ops/sec, and merge behaviour on
the interleaving cases. Be honest about where you lose — you will, and a writeup that
admits it is far more credible than one that doesn't.

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
