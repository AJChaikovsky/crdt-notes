# Open questions

Questions to answer later, from memory, at your own pace. Since 2026-11-23 nothing in the
project waits on these: each milestone moves on, and new questions are added here
instead of being asked in chat. When you answer one, move it with your answer into
`learning-log.md` and delete it here.

Terms are defined in `glossary.md`.

## Phase 6: the editor

1. A CodeMirror transaction replaces positions 2–4 with "x" and inserts "y" at 7, both
   in positions of the old text. Why does `applyToCrdt` apply the insert at 7 first?
2. A remote edit is applied to the editor but kept out of its undo history. What would
   Ctrl+Z do to the other person's text if it weren't?
3. Cursors are sent as "after character X" rather than as an index. Give a concrete
   sequence of two people typing where the index version shows a cursor in the wrong
   place.
4. The note list is a cache kept separately from the notes. Name one way it can end up
   disagreeing with them, and say why that never loses any text.
5. Note IDs are 80 random bits instead of names like "shopping". With no accounts, what
   would someone be able to do if IDs were short names?
6. The service worker downloads every file of a new version before taking over. What
   would someone see if it took over after downloading only half of them, with no network?
7. Why can't the exit test compare the two editors' HTML as it is, and why is removing
   the cursor decorations before comparing still a fair test of convergence?

## Phase 5: catching up with version vectors

1. Bob's ops have Lamport counters 1, 2, 9 and 10. Why can't a vector of Lamport
   counters tell the server that op 9 is missing, when a vector of `seq` numbers can?
2. A log holds Bob's ops 1, 2 and 4. Its vector says Bob: 2. What goes wrong if it says
   Bob: 4 instead, and in what real situation could that happen?
3. The server writes each entry to disk before relaying it. If it relayed first and
   crashed before writing, why would the document still converge, and what would the
   next handshake have to do?
4. The client saves an op before sending it. Describe step by step how the two replicas
   end up permanently different if it sent first and the tab was killed before saving.

## P8 and P9: encoding and snapshots

1. A snapshot stores the Lamport clock instead of working it out from the highest
   counter among the nodes. Describe the sequence of events that goes wrong if it is
   worked out from the nodes instead.
2. Why does a snapshot store each node's parent and side, when the text and the order of
   the characters would already reproduce the document?
3. The decoder rejects an op with an extra field it doesn't know. What would go wrong if
   it ignored the field instead, once a version 2 of the format exists?

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
