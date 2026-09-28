# ADR-0003 (Architecture Decision Record): Holding back ops that arrive early

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (chosen by AJ on a decision card)
- **Date:** 2026-09-28

## Context

A network can deliver an op before the op it builds on: an insert before its origin,
or a delete before its target. Until now `Rga.apply()` threw in that case. P4
(causal readiness, `../testing-strategy.md`) requires such an op to be held, applied
once the missing op arrives, and never dropped.

RGA (Replicated Growable Array) only needs the op's origin or target to be present, not
every op its author had seen. The skip loop places an insert correctly whatever order
its siblings arrived in, because every item in a sibling's subtree has a bigger ID than
that sibling (Lamport clock), and everything after the origin's subtree has a smaller
one.

## Decision

1. **`Rga` itself holds early ops.** `apply()` accepts ops in any order. An op whose
   origin (insert) or target (delete) is missing goes into a private pending list.
   After every op that does apply, `apply()` keeps applying pending ops that have become
   ready until none are left, so one arrival can unblock a whole chain.
2. **Readiness is structural:** origin or target present. No vector clocks in the core.
3. **The clock observes an op when it arrives,** not when it is finally applied. Both
   are correct, since the counter only has to be at least as big as anything seen.
   Observing on arrival keeps `apply()` to one code path.
4. **A duplicate of a held op is ignored** (P2), matched by op ID.
5. **`pendingCount`** is public so tests and, later, the sync layer can see what is
   waiting.

## Rejected

- A separate wrapper class that buffers and feeds a strict `Rga`: two entry points, and
  anyone calling `Rga.apply` directly still gets the throw.
- Leaving the core strict and buffering in the sync layer with Phase 5 vector clocks:
  P4 couldn't be tested in the core now, and every future caller would have to
  remember to buffer.

## Consequences

- An op whose origin never arrives waits forever. The sync layer must eventually deliver
  everything (Phase 5); `pendingCount` makes a stuck op visible.
- Each apply rescans the pending list, O(pending) per step. Fine for the naive reference
  implementation; revisit in Phase 4.
- Local `insert()` and `delete()` still require their origin or target to be present:
  a local edit can only reference what the user can see.
