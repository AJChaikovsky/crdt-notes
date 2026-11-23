# ADR-0005 (Architecture Decision Record): Phase 4 benchmark and index-based edits

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (the trace was chosen by AJ on a decision card, 2026-11-23)
- **Date:** 2026-11-23

## Context

Phase 4's target, set on 2026-09-28: replaying a realistic editing trace on a
100k-character document takes under 1 second in Node. Before optimising anything, we need
the trace, a way to replay it, and a baseline number.

## Decision

1. **The trace is automerge-paper** (AJ's pick). It records Martin Kleppmann writing a
   paper: 259,778 single-character edits that end at 104,852 characters. Yjs, Automerge
   and diamond-types all publish numbers on it. It is CC BY 4.0, and is committed with
   attribution in `packages/crdt-testkit/bench/traces/`.
2. **The CRDT (Conflict-free Replicated Data Type) takes edits by visible index:**
   `Fugue.insertAt(index, char)` and `Fugue.deleteAt(index)`. An editor knows the cursor
   index, not the ID of the character to its left, so the core has to do that conversion.
   Doing it inside the class is also the only way to make it fast later. The ID-based
   `insert` and `delete` stay.
3. **What is timed:**
   - **Local:** one replica replays the trace as its own typing.
   - **Remote:** a second replica applies the resulting ops in order.
   Both must end with the trace's final text.
4. **Benchmarks run on demand** (`pnpm bench`), not in `pnpm test` or CI, because they are
   slow and their timings depend on the machine. `EDITS=n` replays only the first n edits.

## Baseline (2026-11-23, Node 22, the cloud container)

Reference `Fugue`, first 20,000 edits (14,302 characters at the end):

| | Time |
|---|---|
| Local replay | 42.8 s |
| Remote replay | 15 ms |

Remote replay is already fast: applying an op attaches a node in about constant time.
Local replay is slow because `insertAt` and `deleteAt` walk the whole tree on every
keystroke to turn the index into an ID. Its cost grows with edits × document length. The
full trace's documents average about 65,000 characters, against about 7,000 in this
prefix, so the full local replay would take roughly an hour and a half. That figure is
extrapolated, not measured.

## Rejected

- **A synthetic trace:** easy to tune it so the optimisations look good, and it lacks
  real typing's long runs.
- **Converting index to ID in the testkit:** the core could never optimise a conversion
  it never sees.

## Consequences

- The optimised implementation must make index-to-position lookup fast. A full walk per
  keystroke can't meet the target.
- The reference `Fugue` stays as it is. The optimised class is checked against it
  (Phase 4 exit).
