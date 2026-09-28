# ADR-0001 (Architecture Decision Record): Which list CRDT

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED
- **Date:** 2026-09-28

## Context

We need a list CRDT (Conflict-free Replicated Data Type) for text, implemented from scratch, zero dependencies. The selection
criteria, in order: (a) I can understand it well enough to explain it to a stranger,
(b) it doesn't interleave, (c) it's fast enough for a 100k-character document.

Background in `docs/crdt-design.md#the-interleaving-problem`.

## Options

RGA (Replicated Growable Array), YATA (Yet Another Transformation Approach — the
algorithm behind Yjs), Fugue (not an acronym; named for the musical form).

| | RGA | YATA | Fugue |
|---|---|---|---|
| Origins per char | 1 (left) | 2 | 2 + side |
| Rough core size (LOC, Lines of Code) | ~200 | ~400 | ~300 |
| Interleaving | forward-safe, **interleaves backward runs** | better; Fugue paper claims residual cases | proved maximally non-interleaving |
| Failure mode if you get it wrong | diverges loudly, easy to debug | converges to subtly wrong order, hard to spot | tree invariant breaks, fails loudly |
| Prior art to lean on | plentiful, well-explained | Yjs source (dense, optimised) | recent paper, few readable implementations |
| Writeup value | "here's the classic and here's where it breaks" | "I reimplemented Yjs's core" | "I implemented the 2023 state of the art" |

## Recommendation

**Build RGA first, then upgrade to Fugue in Phase 3.**

Not a compromise — it's the shortest path to actually understanding the problem. RGA is
small enough that you'll have working convergence tests in days rather than weeks, and
the test harness is the reusable asset. Then in Phase 3 you write P7, watch RGA fail on
a backward run, shrink the counterexample to four characters, and *feel* why the second
origin is necessary before you implement it.

The alternative — going straight to Fugue — means implementing a fix for a problem you've
only read about. You'll get working code and a shakier understanding.

It's also a better writeup. "I implemented Fugue" is a sentence. "I implemented RGA, wrote
a property test that produced `axbycz`, and here's the minimal repro" is a post.

Cost: roughly a week of extra work, and you throw away some of the RGA integration code.
The tests, generators, ID types, and clock all survive.

## Decision

I will use an RGA-style list CRDT as the starting algorithm for collaborative text. Each inserted character gets a permanent ID based on a Lamport counter and replica ID, and stores the ID of the character it was inserted after as its origin. Concurrent siblings are ordered deterministically by ID so every replica makes the same choice regardless of delivery order.

Deleted characters remain as tombstones instead of being physically removed because later or concurrent inserts may still reference them as origins. The first implementation intentionally uses a plain array and O(n) scans because it is easier to understand and verify before optimizing the representation in later phases.

## Consequences

TODO
