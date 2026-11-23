# Open questions

Questions to answer later, from memory, at your own pace. Since 2026-11-23 nothing in the
project waits on these: each milestone moves on, and new questions are added here
instead of being asked in chat. When you answer one, move it with your answer into
`learning-log.md` and delete it here.

Terms are defined in `glossary.md`.

## Phase 4: making it fast

1. In the reference `Fugue` class, why does one local keystroke cost time proportional
   to the document's length, even though attaching the node to the tree takes constant
   time?
2. Remote replay was already fast in the reference `Fugue` (15 ms for 20,000 edits) while
   local replay took 42.8 s. What does a remote op carry that makes it cheap to apply?
3. In `PositionTree`, how does storing a visible count in every node let you find the
   character at index 52,301 without reading the characters before it?
4. A new right child that has no bigger sibling goes "after the end of its parent's
   subtree", not straight after its parent. Draw a small Fugue tree where those two
   places differ.
5. Why must that subtree end (`rightmost`) be computed *before* the new node is attached?

## Phase 3: Fugue and P7 (from PR #17)

1. Fugue was changed so that every local insert became a right child of the character
   before the cursor. P5 failed even with one replica typing alone. Why?
2. In the Fugue version of the pinned P7 corpus case, the result is Alice's run and then
   Bob's. Why that order, and what would change if Bob's replica ID were "0" instead of
   "B"?

## Checkpoint questions not answered yet

From the "Understanding checkpoints" in `learning-log.md`.

**After Phase 1**

1. Why can't you just use array indices as character IDs? (Explained to you in step 1,
   but not yet answered in your own words.)
2. What does a CRDT (Conflict-free Replicated Data Type) actually promise, in one
   sentence?
3. Two replicas insert at the same origin with the same Lamport counter. What breaks if
   you tie-break on wall-clock time instead of replica ID?

**After Phase 2**

4. What's the difference between convergence and correctness? Give one example that has
   one and not the other. (Your 2026-09-28 22:23 answer covers it; say it as one example
   from memory.)
5. The delivery-order generator respects happens-before. Why does that matter, and what
   class of bug does it therefore *hide*?
6. fast-check shrank a failure to 4 ops. Why is that more valuable than the original 200?

**After Phase 3**

7. Name a case where *no* convergent algorithm can avoid interleaving.

The Phase 4, 5 and 7 checkpoints in `learning-log.md` come up as those phases finish.

## Optional writing

- Rewrite ADR-0003's Decision section (holding early ops) in your own words. It's
  currently in Claude's words.
- Per-session entries in `learning-log.md` (*Explain it cold*, *Surprised me*, *Still
  fuzzy*, *Claude did something I couldn't have done alone*).
