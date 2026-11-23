# ADR-0006 (Architecture Decision Record): a B-tree for Fugue positions

Terms are defined in `../glossary.md`.

- **Status:** ACCEPTED (structure chosen by AJ on a decision card, 2026-11-23)
- **Date:** 2026-11-23

## Context

ADR-0005's baseline: the reference `Fugue` replays the first 20,000 trace edits in
42.8 s locally, because every keystroke walks the whole tree to turn a cursor index into
a position. Remote replay was already fast. The target is the full 259,778-edit trace in
under 1 s.

Measured options: a flat array plus a cursor cache ran the full trace in 2.6 s. Every
insert shifts the array, and finding a character by ID means scanning it.

## Decision

1. **A B-tree of runs** (AJ's pick over a flat array of runs and over counts stored in the
   Fugue tree). Planned in two steps: first one entry per character, then runs. Step 1
   met the target on its own (below), so AJ parked runs (2026-11-23, see
   `../roadmap.md#parked`).
2. **`FastFugue` sits beside `Fugue`.** It keeps the same Fugue tree (`left` and `right`
   children sorted by ID) to decide where a character belongs. A `PositionTree` holds
   the same characters in document order, tombstones included. `Fugue` is unchanged and
   is the reference.
3. **The position tree** is a B-tree: leaves hold up to 64 characters in order, and inner
   nodes hold up to 64 children. Every node stores how many visible characters are under
   it. Every character points at its leaf, and leaves are linked in order.
   - Character at visible index i: walk down, subtracting each child's visible count.
     That's log n steps, plus a scan of one leaf.
   - Insert before or after a character: splice into its leaf, then add 1 to the visible
     counts on the way up. A full leaf splits in half, which can split its parent.
   - Delete: mark the character and subtract 1 on the way up.
4. **Where a new node goes in document order.** An in-order walk of the Fugue tree would
   visit the new node N here (parent P, on side s):
   - If a sibling with a bigger ID follows N: just before that sibling's subtree, which
     starts at its leftmost descendant (follow first left children).
   - Else, if P is the start of the document: at the very end.
   - Else, if N is P's last left child: just before P.
   - Else, N is P's last right child: just after the end of P's subtree, which is P's
     rightmost descendant (follow last right children), computed before N is attached.
5. **Local inserts** use the same rule as `Fugue`. "The leftmost node of the origin's
   first right subtree" is just the next character after the origin in document order,
   tombstones included, which the position tree returns directly.

## Results (2026-11-23, Node 22, cloud container, Xeon 2.1 GHz)

Full automerge-paper trace, three runs:

| | Time |
|---|---|
| Local replay | 326–343 ms |
| Remote replay | 258–277 ms |

That is about a third of the 1 s target, and over 10,000 times faster than the
reference's extrapolated full replay.

## How it is checked

- **P1–P7** run against `FastFugue` as a third implementation, at 10,000 cases for seeds
  1, 2 and 3.
- **A new reference property** runs the same scenario on `Fugue` and `FastFugue` and
  requires identical ops and identical items on every replica. Two longer variants grow
  documents past one leaf (64 items) so splits happen: long local editing anywhere in
  the document, compared op by op, and long multi-replica scenarios.
- **`PositionTree` tests** check it against a plain array, with a split size of 3 so a few
  hundred steps build a tree several levels deep.
- **Mutations, all caught:** split forgets to move leaf pointers (3 tests fail), split
  forgets the visible count (3), last right child placed after its parent instead of
  after its subtree (5), placed before the following sibling instead of its leftmost
  descendant (7).

## Rejected

- **Flat array of runs:** measured at 2.6 s without runs. It still shifts the whole array
  on insert, and still scans to find an ID.
- **Visible counts inside the Fugue tree:** typing forward builds right-child chains as
  deep as the document, so a lookup can still take n steps.

## Consequences

- Two tree structures to keep in step: the Fugue tree and the position tree. The
  reference property is what guards this.
- `leftmost` and `rightmost` follow chains, so a remote insert next to a long chain can
  still take many steps. The trace doesn't hit this. Revisit if a concurrent trace does.
- One object per character, tombstones included, so memory grows with every character
  ever typed. Runs (step 2) and tombstone handling (ADR-0003) are what would reduce it.
