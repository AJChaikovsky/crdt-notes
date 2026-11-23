# ADR-0004 (Architecture Decision Record): Fugue beside RGA

Terms are defined in `../glossary.md`. Pseudocode is in `../crdt-design.md` section 4.

- **Status:** ACCEPTED (choices made by AJ on decision cards; pseudocode approved)
- **Date:** 2026-09-28

## Context

P7 showed RGA (Replicated Growable Array) interleaving backward runs: a run typed
one character at a time at a fixed spot is a set of siblings, and anything concurrent can
sort between them (`packages/crdt/test/corpus/p7-backward-run-interleaves.test.ts`).
ADR-0001 planned to fix this with Fugue in Phase 3.

## Decision

1. **Plain Fugue, not FugueMax, for now.** Siblings on each side are sorted by
   `compareIds`, smallest first. The paper proves only FugueMax maximally
   non-interleaving; plain Fugue is proved forward non-interleaving. The plan is to let
   P7 look for the gap and move to FugueMax if it finds one.
2. **A new `Fugue` class side by side with `Rga`,** with the same public methods. Every
   property runs against both; P7 runs in full for Fugue and forward-only for RGA. RGA
   stays as a baseline and a comparison for the writeup.
3. **A Fugue insert op carries `parent` and `side`,** decided by the author when typing,
   as in the paper. Receivers attach the node and never recompute its place.
4. **Local insert rule.** With `L` the visible character left of the cursor (ADR-0002
   item 6): if `L` has no right children, the new node is `L`'s right child; otherwise it
   is the left child of the next node after `L` in the walk, tombstones included. That
   node is the leftmost node of `L`'s first right child's subtree.
5. **The walk is iterative.** Forward typing builds a chain of right children as deep as
   the document, which would overflow the call stack if walked recursively.

## Rejected

- FugueMax straight away: stronger guarantee, but more to build before seeing why it is
  needed. Revisit if P7 finds a backward interleaving under plain Fugue.
- Replacing RGA's ordering in place: one implementation, but the RGA and Fugue contrast
  would no longer be testable, and the pinned corpus case would have to be rewritten.
- Sending left and right origins and letting receivers compute parent and side: more
  work on every receive, and a second place for the rule to go wrong.

## Consequences

- Two list CRDTs (Conflict-free Replicated Data Types) to keep in step until one is
  retired. The testkit becomes generic over the implementation.
- Fugue's ordering needs only the parent to be present, not Lamport order, since
  siblings are placed by a sort. Holding early ops (ADR-0003) carries over with parent in
  place of origin.
- Built in small steps: inserts first, then deletes and held ops, then the testkit and
  all properties against both.
- The shared shape the testkit drives (`ListCrdt` and `Implementation` in
  `packages/crdt-testkit/src/implementation.ts`) lives in the testkit, not the core
  (AJ's pick, 2026-09-29). Only the tests use more than one implementation, and RGA is
  expected to retire after Phase 3. Rejected: exporting it from the core, which would
  make it public API before the editor needs it; and a copy of the property files per
  implementation, since the copies would drift. It generalises over the op type, so
  each implementation keeps its own ops. It can move to the core if the editor ever
  needs to swap implementations.
