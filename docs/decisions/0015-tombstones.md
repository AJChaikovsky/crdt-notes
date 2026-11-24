# ADR-0015 (Architecture Decision Record): tombstones are never collected

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (AJ picked "Never collect" on a decision card, 2026-11-24)
- **Date:** 2026-11-24

## Context

A deleted character stays in the Fugue tree as a tombstone, because a concurrent insert
may name it as its parent (`../crdt-design.md` section 2). The writeup's section 5 asked
for a decision on whether tombstones are ever removed. On the automerge-paper trace, 77,463
of the final 182,315 nodes (42%) are tombstones.

## Decision

1. **Tombstones are never collected.** The code already behaves this way; this records it
   as deliberate.
2. **The cost is measured and published** in the writeup (sections 5 and 7), next to Yjs,
   which makes tombstones cheap by storing them as runs.

## Rejected

- **Collecting causally stable tombstones.** Needs a known, complete replica set and every
  replica reporting what it holds. One device that never reconnects blocks collection
  forever; a device that reconnects after its peers collected holds ops whose parents no
  longer exist. A tombstone with children would also need the tree restructured the same
  way on every replica.
- **Compact spans now.** Storing a deleted stretch as one entry is the same change as runs
  in FastFugue, already parked (ADR-0006). It would shrink every node, not only
  tombstones, and is the right fix if size or memory becomes a problem.

## Consequences

- A note's storage never shrinks when text is deleted. Deleting half a note leaves its
  snapshot about the same size.
- An op from a device that was offline for any length of time still applies, because
  everything it can refer to is still there.
- If size becomes a problem, un-park runs (ADR-0006, `../roadmap.md#parked`), not
  collection.
