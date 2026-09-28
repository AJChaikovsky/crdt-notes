# Learning log

Terms are defined in `glossary.md`.

The point of this project is that you understand distributed systems at the end of it,
not that the repo exists. This file is how you tell the difference.

## Per-session entry

Keep it to five minutes. Write it *before* you close the laptop, not the next morning.

```md
### YYYY-MM-DD — <what you worked on>

**Explain it cold:** <the thing you built, in 3 sentences, without looking at the code>

**Surprised me:** <something that didn't work the way you expected>

**Still fuzzy:** <the thing you'd fail a question on>

**Claude did something I couldn't have done alone:** <yes/what — or "no">
```

That last line is the honest one. If it's "yes" three sessions running, slow down and
rebuild the last piece yourself.

---

## Understanding checkpoints

Don't leave a phase until you can answer these without notes. Have Claude Code quiz you
on them — ask it to press on vague answers rather than accept them.

**After Phase 1**
- Why can't you just use array indices as character IDs?
- What does CRDT (Conflict-free Replicated Data Type) actually promise, in one sentence?
- Why does a delete leave a tombstone instead of removing the element?
- Two replicas insert at the same origin with the same Lamport counter. What breaks if
  you tie-break on wall-clock time instead of replica ID?
- What does "causal ordering" buy you that a global sequence number wouldn't?

**After Phase 2**
- What's the difference between convergence and correctness? Give an example that has
  one and not the other.
- Your delivery-order generator respects happens-before. Why does that matter, and what
  class of bug does it therefore *hide*?
- fast-check shrank a failure to 4 ops. Why is that more valuable than the original 200?

**After Phase 3**
- Draw the RGA anomaly on paper from memory.
- Why does a right-origin fix backward runs? Be specific about what chains where.
- Name a case where *no* convergent algorithm can avoid interleaving.

**After Phase 4**
- What invariant must run-length encoding preserve for your property tests to stay valid?
- Why is tombstone GC (Garbage Collection) hard? What would you need to know to do it safely?

**After Phase 5**
- A client is offline for a week. Walk through the reconnect handshake, message by message.
- Why is presence data deliberately not in the CRDT?
- The server crashes after acknowledging an op but before persisting it. What happens?

**After Phase 7**
- Where is your implementation worse than Yjs, and why did Yjs make that tradeoff?
