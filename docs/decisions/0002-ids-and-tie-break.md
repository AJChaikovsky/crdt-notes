# ADR-0002 (Architecture Decision Record): Character IDs and the tie-break rule

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (replica ID format), PROPOSED (string comparison, see below)
- **Date:** 2026-09-28

## Context

RGA (Replicated Growable Array, ADR-0001) needs a permanent, unique name for every
character, and a single ordering of those names that every replica computes the same
way. Sibling order depends on it, so a disagreement here means replicas diverge.

## Decision

1. **ID = `(counter, replica)`.** `counter` comes from a Lamport clock: `tick()` adds 1
   for a local op, `observe(id)` sets `counter = max(counter, id.counter)` for a remote
   one.
2. **Replica ID is a string supplied by the caller.** A UUID (Universally Unique
   Identifier) in the app, `"A"`/`"B"` in tests. The core never generates one, so test
   runs are deterministic. Chosen by AJ over a random 53-bit integer (harder to read in
   counterexamples) and a server-assigned ID (a new device couldn't type offline).
3. **`compareIds` orders by counter, then by replica ID.** RGA puts the *bigger* ID first
   among siblings, so on a counter tie the bigger replica ID wins.
4. **Replica IDs compare by UTF-16 code unit** (plain `<`), never `localeCompare`.
   `localeCompare` depends on the machine's locale, so two replicas could order the same
   pair differently and diverge. `id.test.ts` has a test that fails if this changes.

## Rejected

- Tie-break on wall-clock time: clocks disagree between devices, and two ops can share a
  timestamp, so the order is not guaranteed to be the same everywhere.
- Per-replica sequence numbers without the `max` rule: an op typed after seeing another
  could get a smaller counter and sort after it, away from where the user typed.

## Consequences

- IDs cost about 36 bytes of replica ID each until Phase 4's run-length encoding.
- Phase 2 must deliberately flip the tie-break and confirm the harness catches it.
