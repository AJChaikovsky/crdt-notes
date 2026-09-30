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

---

## Phases 1–3: your answers, collected

Collected on 2026-09-30 from the "Choose a CRDT library and stack" thread, for revision.
Your answers are quoted exactly as you sent them, except that stray "GitHub" citation
tags were removed. Anything under **Feedback** is what Claude said at the time, not your
words. The per-session entries above (*Explain it cold*, *Surprised me*, *Still fuzzy*,
*Claude did something I couldn't have done alone*) are yours to write. None have been
written yet, and nothing here fills them in for you.

### Your one-liners

The shortest versions of the ideas, in your own words, pulled from the answers below.

- "Deleted" means not visible, not structurally erased.
- Origin dependency ⊂ causal dependencies.
- The generator produces stable data; the simulator interprets that data against the
  current state.
- P1: "Did everyone agree?" P5: "Did the agreed result preserve the causal ordering the
  user actually experienced?"
- P1 tests reordering, not duplication.
- Arrival affects causal time; origin affects structural position.
- The RGA weakness is specifically that backward typing turns the entire run into
  siblings; forward typing turns each run into a subtree.
- Fugue changes the tie-break from "How do these individual concurrent characters
  intermix?" to "Which complete concurrent run goes first?"
- RGA uses ID ordering to infer structure; Fugue stores the structure explicitly.
- Missing parent → hold the op; parent arrives → release it.

### Still open: not answered yet

From PR #17 (P1–P7 run against both RGA and Fugue):

1. Fugue was changed so every local insert became a right child of the character before
   the cursor. P5 failed even with one replica typing alone. Why?
2. In the Fugue corpus case the result is Alice's run and then Bob's. Why that order, and
   what would change if Bob's replica ID were "0" instead of "B"?

Also optional and still open: rewriting ADR-0003's Decision section (holding early ops)
in your own words. It's currently in Claude's words.

### Checkpoint questions: where you stand

| Checkpoint | Status |
|---|---|
| **Phase 1:** Why can't you just use array indices as character IDs? | Explained by Claude in step 1. You haven't answered it yourself yet. |
| **Phase 1:** What does a CRDT promise, in one sentence? | Not answered yet. |
| **Phase 1:** Why does a delete leave a tombstone? | Answered: 2026-09-28 18:59 and 19:03 (Q2) below. |
| **Phase 1:** Tie-break on wall-clock time instead of replica ID: what breaks? | Not answered yet. The closest is your 18:35 answer on why every device must make the same choice. |
| **Phase 1:** What does causal ordering buy you over a global sequence number? | Answered: 2026-09-28 19:15 below. |
| **Phase 2:** Convergence vs correctness, with an example of one without the other | Covered by your 22:23 answer (replicas agree on an order nobody typed). Worth saying as one example from memory. |
| **Phase 2:** The generator respects happens-before. Why does that matter, and what bug class does it hide? | Not answered yet. Hint: that's what P4's `{ causal: false }` mode exists for. |
| **Phase 2:** Why is a failure shrunk to 4 ops more valuable than the original 200? | Not answered yet. Your 21:49 answer is about how shrinking stays valid, not why it's valuable. |
| **Phase 3:** Draw the RGA anomaly from memory | Done on 2026-09-28 at 23:15 and 23:20 (text, not paper). |
| **Phase 3:** Why does a right-origin fix backward runs? | Answered: 2026-09-28 23:20 (Q2) and 23:24. |
| **Phase 3:** Name a case where *no* convergent algorithm can avoid interleaving | Not answered yet. |

### Design decisions you made

Each was picked from 2–3 options. The ADRs (Architecture Decision Records) hold the
reasoning.

| Date | Decision | Your pick | Recorded in |
|---|---|---|---|
| 2026-09-28 | Which list algorithm to hand-write | RGA (Replicated Growable Array) first, Fugue in Phase 3 | ADR-0001 (Decision in your own words) |
| 2026-09-28 | Replica ID format | Random string, compared with plain `<` | ADR-0002 |
| 2026-09-28 | Does a delete get its own ID? | Own ID | ADR-0002 |
| 2026-09-28 | How the simulator tracks causal dependencies | Explicit set of op keys | `crdt-testkit` simulator |
| 2026-09-28 | Origin for text typed right after deleted text | Last visible character | ADR-0002 item 6 |
| 2026-09-28 | When P2 re-sends duplicates | Mid-scenario | testing-strategy.md |
| 2026-09-28 | What P3 compares | Full item list, tombstones included | testing-strategy.md |
| 2026-09-28 | Where early ops wait | Inside `Rga` | ADR-0003 |
| 2026-09-28 | How P5 checks intention | Cursor check (replaced the doc's original P5) | testing-strategy.md |
| 2026-09-28 | What P6 compares | Visible IDs | testing-strategy.md |
| 2026-09-28 | How P7 generates runs | Dedicated runs | testing-strategy.md |
| 2026-09-28 | How P7 lands while RGA fails backward runs | Forward runs now, failure pinned in the corpus | testing-strategy.md |
| 2026-09-28 | Fugue or FugueMax | Plain Fugue first | ADR-0004 |
| 2026-09-28 | How Fugue fits next to RGA | Side by side | ADR-0004 |
| 2026-09-28 | Fugue pseudocode (design doc §4) | Confirmed it matches your model | crdt-design.md |
| 2026-09-29 | Where the shared test interface lives | Testkit only | ADR-0004 |


### Phase 1: IDs, RGA insert and delete

#### 2026-09-28 18:18 UTC · Check, step 1 (IDs and the Lamport clock)

**Question:** What goes wrong if the receiver doesn't bump its counter to the max it has seen?

**Your answer:**

> If the receiver doesn’t update its counter to the maximum value it has seen, it could create a new character with a lower counter than characters it already received. Then, when RGA sorts sibling characters by their IDs, a character typed later could incorrectly appear before or after an older one. Updating the counter ensures that anything created after seeing another operation gets a higher counter and preserves that causal order.

**Feedback:** Mostly right. "Before or after" is too vague. Siblings sort biggest ID first, so the too-small character always lands *after* the older sibling, away from where the user typed. Also: a Lamport clock only works one way. A happened before B means A's counter is smaller, but a smaller counter doesn't prove A happened before B.

#### 2026-09-28 18:35 UTC · Quiz, PR #2 (Id, compareIds, Clock)

**Question:** 1. Alice's clock is at 5. She receives Bob's op with counter 9, then types two characters. What are their IDs? 2. Why can't a Lamport counter tell you on its own that two ops were concurrent? 3. Alice's replica ID is "b" and Bob's is "C", both inserting with counter 4 at the same spot. Whose character comes first, and why must every device agree?

**Your answer:**

> (10, Alice) and (11, Alice). Alice observes Bob’s counter 9, so her clock jumps from 5 → 9. Each local insert then increments it: first 10, then 11.
>
> A Lamport counter only tells you causality in one direction. If A happened before B, A’s counter will be smaller. But seeing A.counter < B.counter does not prove A happened before B—they could have been created independently and therefore be concurrent.
>
> Alice’s "b" character comes first. Both counters are 4, so the replica ID breaks the tie. Your RGA puts the bigger ID first, and plain UTF-16 comparison makes "b" > "C" (b has a larger code unit). Every device must make the exact same choice; otherwise replicas could arrange the same concurrent characters differently and the documents would diverge.

**Feedback:** All three correct. The code-unit detail in 3 (98 for "b" vs 67 for "C") is the part people get wrong. This answer came with "GitHub" citation tags, which were flagged as a sign it might not have been from memory.

#### 2026-09-28 18:42 UTC · Follow-up, answered cold

**Question:** Bob's clock is at 12 and he receives Alice's op with counter 7. What does `observe` do, and what's the ID of Bob's next character?

**Your answer:**

> observe(7) does nothing to Bob’s clock, because max(12, 7) = 12.
>
> Then when Bob types his next character, the clock increments to 13, so the ID is:
>
> (13, Bob)

**Feedback:** Correct, from memory. `observe` never moves the clock backwards, so an old op can't make Bob reuse a counter.

#### 2026-09-28 18:49 UTC · Check, step 3 (the insert op and `integrate`)

**Question:** The skip loop only compares IDs, yet it must skip a newer sibling *and* everything typed after it. Why is "skip while bigger" enough to jump the whole group?

**Your answer:**

> because every character in a sibling’s “group” was created after that sibling was already known, its Lamport counter must be higher than the sibling’s counter.
>
> So suppose we’re inserting X, and an existing sibling Y has a bigger ID than X:
>
> * Y comes before X.
>
> * Any character typed after Y must have observed Y.
>
> * Its Lamport clock therefore becomes at least Y.counter, then increments before creating the new character.
>
> * So every descendant of Y has a counter greater than Y.counter, which means its ID is also greater than X.
>
> Example:
>
> ```
> X = (5, "A")
>
> Y = (7, "B")      ← sibling
>   Z = (8, "B")    ← typed after Y
>   W = (10, "C")   ← typed after seeing Z
> ```
>
> The loop checks:
>
> ```
> Y > X  → skip
> Z > X  → skip
> W > X  → skip
> ```
>
> So it doesn't need to explicitly know that Z and W belong under Y. The Lamport ordering guarantees that the entire causal chain after Y also has IDs bigger than X.
>
> That's why “skip while bigger” effectively skips the sibling plus its whole group/subtree

**Feedback:** Correct. This is the key idea behind RGA: the Lamport clock turns "typed after" into "has a bigger ID", so the loop never needs the tree.

#### 2026-09-28 18:53 UTC · Quiz, PR #3

**Question:** 1. Suppose `apply` didn't call `clock.observe`. Describe a concrete sequence where Bob's next character lands in the wrong place. 2. Bob types `World` at the start of an empty document while Alice types `Hello` there. Which word comes first, and what decides it?

**Your answer:**

> 1. Suppose Bob’s clock is at 2. Alice inserts A with ID (10, Alice), and Bob receives it. If apply does not call clock.observe(10), Bob’s clock stays at 2. Bob then types B in a position that should come after what he has already seen, and B gets ID (3, Bob) instead of (11, Bob). Because the RGA uses the IDs to order characters/groups, Bob’s new character can sort as though it were older than Alice’s character, even though Bob created it only after receiving Alice’s edit. Calling observe prevents that by making Bob’s next ID larger than every operation he has already seen. 2. Hello and World each form their own chain. The important comparison is between the first characters: - H = (1, AliceReplicaId) - W = (1, BobReplicaId) Their counters are equal because Alice and Bob typed concurrently, so the replica ID tie-breaker decides which first character comes first. Whichever first-character ID sorts first under your compareIds rule brings its entire word with it. So if the replica IDs were literally "Alice" and "Bob", and your rule puts the larger ID first, then: WorldHello because "Bob" > "Alice" using the deterministic plain string comparison. The crucial point is that it is not decided by who physically typed faster or whose operation arrives first. It is decided deterministically by the IDs of W and H, so every replica reaches the same merged text.

**Feedback:** 2 exactly right. 1 right in principle, loose in one place. The small ID only does harm when Bob's character has the **same origin** as Alice's, so they're siblings competing for the spot. If Bob types right after Alice's character, nothing competes and the small ID is harmless.

#### 2026-09-28 18:59 UTC · Check, step 4 (delete and tombstones)

**Question:** y's origin is a tombstone. Does y still land in the right place? Use the `Hxz` example: Bob types y after x while Alice deletes x.

**Your answer:**

> Yes. `y` still lands in the correct visible position because deleting `x` does not remove `x` from the CRDT structure—it only hides it from `text()`.
>
> Starting from:
>
> `H x z`
>
> Bob concurrently inserts `y` after `x`, so:
>
> * `y.origin = x.id`
>
> Alice deletes `x`, turning it into a tombstone:
>
> `H [x deleted] z`
>
> When Bob’s insert reaches Alice, `integrate` can still find `x` by ID because the tombstone is still in the array. It inserts `y` after that structural position:
>
> `H [x deleted] y z`
>
> Then `text()` skips tombstones, so the user sees:
>
> `Hyz`
>
> The key idea is that tombstones remain part of the document’s structural history even though they disappear from the visible text. That lets later or concurrent operations still refer to deleted characters as origins.

**Feedback:** Correct. Detail skipped: `z` also has `x` as its origin, so `y` and `z` are siblings. `y` lands before `z` because it has the bigger ID, not simply because it was typed after `x`.

#### 2026-09-28 19:03 UTC · Quiz, PR #4 (deletes)

**Question:** 1. Why is delivering a delete twice already harmless, when delivering an insert twice isn't? 2. In the test `still skips a deleted newer sibling` the result is `Hzx`. Why does `x` end up after `z`, even though `z`'s origin `y` is deleted?

**Your answer:**

> 1. A delete is already idempotent because applying it just does something like: item.deleted = true If the same delete arrives again, it sets true to true again, so nothing changes. An insert is different: if you integrate the same insert twice without checking whether its ID already exists, you can add the same character to the array twice. So inserts need explicit deduplication by ID. 2. In still skips a deleted newer sibling, think of the structure like this: - x and y have the same origin, so they are siblings. - y has the newer/bigger ID, so y's whole group must come before x. - z was typed after y, so z.origin = y. - Then y gets deleted. Structurally, the array is still: H [y tombstone] z x When x is integrated, the skip loop reaches y. Even though y is deleted, it still participates in ordering, so the loop sees that y.id > x.id and skips it. Then it reaches z. Because z was created after seeing y, its Lamport ID is also greater than x's, so the loop skips z too. Only after the entire y group does x get inserted. Finally, text() hides the tombstone y, leaving: Hzx So the important rule is: deleted characters disappear visually, but not structurally. A tombstone still anchors its descendants and still participates in the skip logic.

**Feedback:** Both correct. "Disappear visually, not structurally" is the whole idea of tombstones in one line.

#### 2026-09-28 19:15 UTC · Phase 1 checkpoint question

**Question:** What does causal ordering buy you that a single global sequence number wouldn't?

**Your answer:**

> Causal ordering lets replicas preserve only the ordering that actually matters: if B was created after seeing A, B must come after A.
>
> A single global sequence number would totally order every operation, including ones that were truly concurrent, and assigning that global number usually requires coordination with a central server or sequencer.
>
> So causal ordering gives you:
>
> * offline/local edits without waiting for a central authority
>
> * preservation of real cause-and-effect relationships
>
> * freedom for concurrent edits to be resolved deterministically by the CRDT instead of being artificially serialized
>
> In short: causal ordering preserves necessary order without requiring global coordination.

**Feedback:** Right. Addition: a global sequence number also throws away the fact that two ops were concurrent. Causal order keeps it, and concurrency is exactly the case the merge rule exists for.


### Phase 2: convergence harness and P1–P6

#### 2026-09-28 19:16 UTC · Check, causally valid delivery

**Question:** A simpler rule would be "deliver an op once its origin exists at R". Describe an op that passes that check but still arrives before something its author had already seen.

**Your answer:**

> Example:
>
> - Bob inserts `x` after `H`.
>
> - Carol independently inserts `z` somewhere else.
>
> - Alice receives and applies **both** `x` and `z`.
>
> - Alice then inserts `y` after `x`.
>
> For Alice's `y` operation:
>
> - **origin:** `x`
>
> - **dependencies:** both `x` **and `z`**, because Alice had already seen both when she created `y`.
>
> Now suppose replica R has received `x` but **not `z`**.
>
> The simpler rule says:
>
> > “Does `y`'s origin `x` exist?”
>
> Yes, so it would deliver `y`.
>
> But that is **not causally valid**, because `y` was created after Alice had already seen `z`. R is receiving `y` before one of its causal dependencies.
>
> So checking only the origin tells you **whether the operation can be structurally placed**, not whether you've preserved everything the author had already observed.
>
> **Origin dependency ⊂ causal dependencies.**

**Feedback:** Exactly right. The origin check answers "can I place this?"; the causal check answers "have I seen everything the author saw?"

#### 2026-09-28 21:49 UTC · Check, the generators

**Question:** Why does wrapping raw numbers into range (`index % length`) matter specifically for shrinking?

**Your answer:**

> Rule 2 matters because shrinking changes the steps that came before a given edit, which changes the document length at that moment.
>
> If the generator had produced only “currently valid” indices, then after fast-check removes or simplifies earlier steps, a later index might no longer be valid. The shrunken scenario could become impossible to run, so fast-check would either have to reject it or lose the path to a smaller counterexample.
>
> By generating raw numbers and doing:
>
> index % currentLength
>
> inside the simulator, every shrunken version is still executable, even if earlier edits disappear.
>
> So the key idea is:
>
> the generator produces stable data; the simulator interprets that data against the current state.
>
> That lets shrinking freely delete steps and reduce numbers without accidentally turning a failing case into an invalid test case.

**Feedback:** Exactly right.

#### 2026-09-28 22:23 UTC · Quiz, PR #8 (P1 convergence)

**Question:** Why can't P1 catch a missing `observe`, and which property should?

**Your answer:**

> P1 only checks convergence: after all operations are delivered, do all replicas end with the same text?
>
> If apply forgets to call clock.observe, replicas can still deterministically agree on the same wrong ordering. The bug affects whether a later local edit gets an ID that reflects what its author had already seen, but that does not necessarily make replicas diverge. As PR #8 notes, they can “still converge on an order nobody typed.”
>
> The property that should catch it is P5.
>
> The reason is that P5 is about preserving the user’s causal/local intent, not merely eventual agreement. A missing observe can give Bob’s new character a Lamport counter lower than a sibling he had already seen, so the merge rule can place Bob’s character on the wrong side of that sibling even though every replica eventually agrees on that incorrect placement.
>
> So:
>
> P1: “Did everyone agree?”
>
> P5: “Did the agreed result preserve the causal ordering the user actually experienced?”

**Feedback:** Correct at the time, but later corrected. P1 only checks agreement, and everyone can agree on the wrong order. But the P5 *as your strategy doc first wrote it* couldn't catch this either (see the 22:55 answer below). The cursor-check P5 you picked is what catches it. This answer also had "GitHub" citation tags, flagged again.

#### 2026-09-28 22:26 UTC · Check before P2 (idempotence)

**Question:** If the `#has(op.id)` guard is deleted, what does a duplicate insert do, and why can't P1 as merged catch it?

**Your answer:**

> Without the #has(op.id) guard, delivering the same insert twice would put two copies of the same character with the same ID into the array.
>
> For example, if an insert is:
>
> x = { id: (3, Bob), origin: H }
>
> the first delivery gives something like:
>
> H x
>
> and the duplicate can produce:
>
> H x x
>
> That is invalid because one logical operation has now created two structural items.
>
> P1 can’t catch it because the merged P1 harness only tests different causally valid delivery orders; it still delivers each operation once per replica. It never generates duplicate network deliveries.
>
> So even with the guard removed, every replica receives the same set of inserts exactly once and still converges normally.
>
> In other words:
>
> P1 tests reordering, not duplication.
>
> You need a property that intentionally delivers the same op multiple times and checks idempotence—the second application must leave the state unchanged.

**Feedback:** Right, including why P1 can't see it. When P2 was built, removing the guard shrank to exactly your "H x x" case: one insert echoed back to its author.

#### 2026-09-28 22:31 UTC · Quiz, PR #9 (P2)

**Question:** 1. What about the redeliver step keeps the run with duplicates and the run without them picking the same deliveries? 2. The toggle bug shrank to insert "a", delete it, echo the delete. What text results, and why can't a scenario with no delete catch it?

**Your answer:**

> 1. The `redeliver` step re-applies an already-delivered operation directly without removing, adding, or reordering anything in the pending-delivery queue. So it does not affect which deliveries are ready or what `k % ready.length` selects later.
>
> That means if you remove all the `redeliver` steps, every normal `deliver(k)` still selects the same operation in the same place. The two runs differ only in whether some already-seen operations get applied again, which makes the P2 comparison fair.
>
> 2. With the toggle bug:
>
>    * insert `"a"` → visible text is `"a"`
>
>    * delete `"a"` → `deleted: false → true`, so text is `""`
>
>    * echo the same delete → `deleted: true → false`
>
> So the final text becomes `"a"`. The duplicate delete accidentally resurrects the character.
>
> The shrinker can't expose that mutation with a scenario containing no delete because the buggy code is never executed. Inserts behave identically whether deletion uses:
>
> `deleted = true`
>
> or
>
> `deleted = !deleted`
>
> You need at least one delete, applied twice, for those implementations to differ.
>
> So the minimal counterexample really is:
>
> insert → delete → duplicate delete → `"a"` comes back.

**Feedback:** Both right. Addition to 1: the two runs only stay in step while the CRDT is correct. With a bug, a duplicate can change which origin a later edit picks, which just makes the bug show up.

#### 2026-09-28 22:34 UTC · Check before P3 (commutativity)

**Question:** Construct two replicas with the same text but different internal state, then the later edit that makes them diverge visibly.

**Your answer:**

> Start with visible `H`.
>
> Suppose `x` and `y` are siblings with the same origin `H`, and `y` has the larger ID, so structurally `y` should come before `x`. Then `y` is deleted.
>
> Imagine the replicas somehow end up as:
>
> ```
> Replica A: H [y*] x
> Replica B: H x [y*]
> ```
>
> where `y*` is a tombstone.
>
> Both replicas show the same visible text:
>
> ```
> Hx
> ```
>
> because `text()` hides `y`.
>
> Now someone types `z` after `y`, so:
>
> ```
> z.origin = y.id
> ```
>
> On Replica A:
>
> ```
> H [y*] z x
> ```
>
> Visible text:
>
> ```
> Hzx
> ```
>
> On Replica B:
>
> ```
> H x [y*] z
> ```
>
> Visible text:
>
> ```
> Hxz
> ```
>
> So the hidden structural difference becomes visible only when a later operation uses the tombstone as its origin.
>
> That’s exactly why P3 has to compare the full internal array, including tombstones and ordering, rather than only `text()`. Two replicas can look converged now while already containing a state difference that will cause future divergence.

**Feedback:** Correct. The realistic way to get `z.origin = y`: `z` is typed on a replica that hadn't yet seen the delete of `y`. The last-visible-char rule never picks a tombstone the author already knows is deleted.

#### 2026-09-28 22:38 UTC · Quiz, PR #10 (P3)

**Question:** 1. E inserts "a" as (1,E) and deletes it; concurrently A inserts "a" at the start as (1,A). Where does (1,A) land relative to the tombstone in both orders? 2. P3 looks at more state than P1, so why does it catch the tombstone bug more slowly?

**Your answer:**

> 1. `(1,A)` lands after the `(1,E)` tombstone in both delivery orders.
>
> They are siblings because both have `origin = null`, and their counters are equal. So the replica ID breaks the tie:
>
> * `(1,E) > (1,A)`
>
> * RGA orders the larger sibling first.
>
> If E’s insert/delete is already there, A’s insert sees the tombstone and skips it, because tombstones still participate in ordering:
>
> `[E*] A`
>
> If A arrives first and E arrives later, E’s larger ID causes E to be inserted before A:
>
> `[E*] A`
>
> So both orders produce the same internal state. The fact that E is deleted changes visibility, not ordering.
>
> 2. P3 catches it more slowly because a stronger oracle doesn’t mean the generator is more likely to create the bug-triggering setup.
>
> P3 needs a fairly specific situation:
>
> * the built state must contain the right tombstone,
>
> * another replica must create a concurrent sibling,
>
> * their IDs must order in the relevant way,
>
> * then AB versus BA has to expose the structural difference.
>
> P1 generates longer, messier scenarios with lots of edits and deliveries, so it has many more chances for a bad tombstone position to eventually affect visible text.
>
> So:
>
> P3 is better at detecting a hidden difference once the right case exists, but P1 happens to generate the triggering circumstances more often.

**Feedback:** 2 right. 1: final state right, but the walkthrough described a different case. E's insert is already in the shared history, so it never "arrives later". The two concurrent ops are E's **delete** and A's insert. Either way the skip loop must pass (1,E) because its ID is bigger, deleted or not. The mutation stops at tombstones, so delete-first gives `A [E*]` and insert-first gives `[E*] A`. That's the bug.

#### 2026-09-28 22:48 UTC · Check before P4 (held ops)

**Question:** Why is the origin being present enough? What property of a sibling subtree's IDs lets the skip loop place an insert even if unrelated causal dependencies haven't arrived?

**Your answer:**

> Because the IDs encode enough ordering information to skip an entire sibling subtree without having to see every causally prior op.
>
> Suppose a new insert `x` has origin `O`, and there is already a sibling `y` after `O` with:
>
> `y.id > x.id`
>
> So `y` belongs before `x`.
>
> Now consider anything in y’s subtree—characters inserted after `y`, after those characters, etc. Every one of those characters was created only after its author had seen its parent. Because of the Lamport `observe` rule, each descendant gets a counter strictly greater than its parent’s counter.
>
> So you get something like:
>
> ```
> y = (10, B)
> z = (11, B)   // child of y
> q = (15, A)   // descendant of z
> x = (7, C)
> ```
>
> All of `y`’s descendants also have IDs greater than `x`:
>
> ```
> y > x
> z > x
> q > x
> ```
>
> Therefore the loop can simply:
>
> ```
> skip while current.id > x.id
> ```
>
> and it automatically jumps over the whole `y` subtree, even though it doesn't explicitly know where that subtree ends.
>
> The unrelated causal dependencies don't matter for placing `x`. They may have influenced `x`’s Lamport counter, but they aren't part of the structural chain rooted at `x.origin`. Once the origin exists, the existing IDs tell `integrate` exactly how `x` compares with the sibling groups around that origin.
>
> So the key property is:
>
> Every descendant of a sibling has a Lamport ID greater than that sibling, because descendants are causally created after their ancestors.
>
> That's what makes origin present + ID ordering enough for structural placement.

**Feedback:** Correct. Your answer covers why the loop skips a bigger sibling's whole subtree. The other half is why it stops in the right place: whatever follows O's subtree is a smaller sibling of O or of one of O's ancestors, and all of those are smaller than O, which is smaller than x.

#### 2026-09-28 22:53 UTC · Quiz, PR #11 (P4)

**Question:** 1. Why must the release loop keep going after one held op applies? Give a three-op example. 2. Bob types while Alice's op is still held on his replica, so his op gets a bigger counter. Why is that harmless?

**Your answer:**

> 1. The release loop has to keep going because applying one held op can unlock another held op, which can unlock another.
>
> Example:
>
> * `A`: insert `a` at the start.
>
> * `B`: insert `b` after `a`.
>
> * `C`: insert `c` after `b`.
>
> Suppose Bob receives them in this order:
>
> `C → B → A`
>
> When `C` arrives, `b` is missing, so `C` is held.
>
> When `B` arrives, `a` is missing, so `B` is held.
>
> Then `A` arrives and applies.
>
> Now:
>
> * `A` applying makes `B` ready.
>
> * Applying `B` makes `C` ready.
>
> If the release code applies only one newly ready op and stops, Bob ends at `ab` with `C` still unnecessarily pending. The loop must continue until an entire pass releases nothing, producing `abc`.
>
> So one arrival can trigger a chain of dependencies.
>
> 2. It’s harmless because Lamport counters are allowed to reflect everything Bob has observed, even operations that are not structurally applicable yet.
>
> Suppose Alice’s held op has counter 10. Bob receives it, so his clock observes 10, but the op stays pending because its origin is missing. Bob then types something unrelated that he can validly place, so his new character might get counter 11.
>
> That does not incorrectly imply Bob’s new character belongs structurally after Alice’s held character. Its placement is determined by:
>
> * its `origin`, and
>
> * ID comparisons among the relevant sibling/subtree structure.
>
> The Lamport counter says only that Bob’s new op was created after Bob had observed Alice’s op. That is true, even though Alice’s op had not yet been integrated.
>
> So:
>
> arrival affects causal time; origin affects structural position.
>
> A larger Lamport counter is not a command to place the character later in the whole document.

**Feedback:** Both right. Refinement to 2: the bigger counter *does* affect placement when Bob's op is a sibling of Alice's held op (his goes first). That's fine: the ops are concurrent, so any consistent order is acceptable, and a larger counter never breaks the rule the skip loop relies on (a descendant is bigger than its ancestor).

#### 2026-09-28 22:55 UTC · Check before P5 (intention preservation)

**Question:** Why can the strategy doc's original P5 (keep only R's characters; they must be in the order R typed them) never fail once replicas have converged?

**Your answer:**

> Because P5 throws away exactly the information needed to detect the interesting mistake.
>
> P5 says: for replica `R`, take the merged document and remove every character not written by `R`. The remaining characters should be in the order `R` typed them.
>
> But characters created by one replica already have strictly increasing local Lamport counters:
>
> `(1,R), (2,R), (3,R), ...`
>
> So once the replicas have converged on the same `items()` ordering, filtering that array down to only `R`'s characters will preserve that same-replica order.
>
> The missing-`observe` bug is different. It breaks the ordering between Bob's new character and a remote character Bob had already seen.
>
> For example:
>
> ```
> Alice: x = (10,A)
> Bob sees x
>
> // broken observe: Bob's clock is still 2
> Bob: y = (3,B)
> ```
>
> The bug may place `y` on the wrong side of Alice's `x`.
>
> But P5 then asks, "Are Bob's characters in Bob's order?"
>
> It deletes Alice's `x` from consideration. If Bob only typed `y`, the answer is trivially yes.
>
> So even if everyone converges to:
>
> ```
> x y   // wrong relative to Bob's causal experience
> ```
>
> P5 filters Alice away and sees:
>
> ```
> y
> ```
>
> which passes.
>
> The core issue is:
>
> P5 checks per-replica typing order, while `observe` protects causal ordering across replicas.
>
> Once you project away the other replicas' characters, the evidence of the missing-`observe` bug disappears. That's why the current P5 cannot be the property that catches that mutation, despite what the mutation log currently says.

**Feedback:** Half right. Right that filtering throws away the evidence, and right that the mutation log's claim was wrong. But increasing counters are **not** the reason: counter order isn't document order (type "c", move left, type "b", then "a": counters rise while the text reads "abc"). The real reason is that `integrate` only ever splices items in and never moves one, so R's characters keep whatever relative order they had on R's screen, and convergence copies that order everywhere.

#### 2026-09-28 23:01 UTC · Quiz, PR #12 (P5 cursor check)

**Question:** 1. A types "a", then another "a" at index 0. B receives only the second one. With `observe` removed, B types "e" at index 0. What ID does "e" get, and why does it land at index 1? 2. With `observe` working, why can a local insert never be skipped past anything?

**Your answer:**

> 1. With `observe` removed, B receives A’s second `"a"` with ID `(2, A)`, but B’s clock does not advance. If B’s clock is still 0, typing `"e"` gives it ID:
>
> `(1, B)`
>
> B inserts at index 0, so `"e"` has the same origin (`null`) as A’s `(2,A)` character. The skip loop sees:
>
> `(2,A) > (1,B)`
>
> so it treats A’s `"a"` as the newer sibling and skips over it. `"e"` therefore lands at array index 1, even though B typed it at index 0.
>
> 2. With `observe` working, B would observe counter 2 when A’s op arrives. B’s next local insert increments from 2 to 3, so its ID is `(3,B)`.
>
> More generally, a local insert’s Lamport counter is always greater than every operation that replica has already observed. Since the skip loop only skips existing items whose IDs are greater than the new ID, nothing already present can satisfy that condition.
>
> So a properly clocked local insert is placed immediately at the position corresponding to the user’s cursor—it never gets skipped past an already-seen item.

**Feedback:** Both correct, and precise. Extension: ops still held in the buffer have been observed too, which only makes the counter bigger, so the argument still holds.

#### 2026-09-28 23:07 UTC · Check before P6 (conservation)

**Question:** Two replicas concurrently delete the same "e". Why must "deleted" count distinct targets rather than delete ops?

**Your answer:**

> Because both delete operations refer to the same character ID.
>
> If the document has one visible `"e"` and Alice and Bob concurrently both delete that same target, the correct result removes one character, not two.
>
> So conservation should use something like:
>
> visible count = distinct inserted IDs − distinct deleted target IDs
>
> If you counted delete operations instead, you’d have:
>
> * 1 inserted character
>
> * 2 delete ops
>
> and the formula would predict:
>
> 1 − 2 = -1 visible characters
>
> which is impossible.
>
> The key is that deletes are idempotent by target: multiple delete ops against the same ID still represent only one logical removal.

**Feedback:** Correct.

#### 2026-09-28 23:12 UTC · Restatement (not the quiz)

**Question:** Your follow-up on the P6 formula.

**Your answer:**

> Exactly. The thing P6 should count is **unique logical characters**, not operation count.
>
> So the invariant is:
>
> **visible characters = unique inserted IDs − unique inserted IDs whose target appears in at least one delete**
>
> That way, two or ten deletes of the same character still subtract only one character.

**Feedback:** Right, and it's the formula P6 uses.

#### 2026-09-28 23:13 UTC · Quiz, PR #13 (P6)

**Question:** 1. P6 compares sorted lists of IDs, not Sets. What bug would a Set hide? 2. Why does P6 build its expected IDs from the op log instead of one replica's document?

**Your answer:**

> 1. A Set would hide duplicate characters. If a bug caused the same inserted ID to appear twice in the document, converting actual IDs to a Set would collapse the two copies into one, making the result look correct. Sorted lists preserve multiplicity, so an extra copy shows up as an extra entry and P6 fails.
>
> 2. The op log is the independent source of truth. P6 is supposed to check whether the CRDT lost or invented characters. If expected IDs came from one replica’s own document, that replica could already contain the same bug being tested—for example, a missing insert or duplicated item—and the “expected” result would be corrupted too.
>
> So:
>
> * op log: what operations actually happened
>
> * replica document: what the CRDT produced
>
> P6 needs to compare those two independently, otherwise the implementation would partly be grading itself.

**Feedback:** Both correct. "The implementation would partly be grading itself" is exactly the point.


### Phase 3: interleaving (P7) and Fugue

#### 2026-09-28 23:15 UTC · Check, worked by hand

**Question:** Alice types "c", then "b" at index 0, then "a" at index 0. Concurrently Bob types "z", "y", "x" the same way. What does every replica show, and why doesn't the same thing typed left to right interleave?

**Your answer:**

> For the backward case, every character becomes a sibling with `origin = null` because each character is inserted at index 0.
>
> Alice creates:
>
> * `c = (1,A)`
>
> * `b = (2,A)`
>
> * `a = (3,A)`
>
> Bob creates:
>
> * `z = (1,B)`
>
> * `y = (2,B)`
>
> * `x = (3,B)`
>
> The skip loop therefore sorts all six siblings by ID, newest/larger first. So they group by Lamport counter:
>
> * the two counter-3 chars: `a` and `x`
>
> * then counter-2: `b` and `y`
>
> * then counter-1: `c` and `z`
>
> That produces an interleaving such as:
>
> `axbycz`
>
> or `xaybzc`, depending only on which replica ID wins the deterministic tie-break. With literal replica IDs `"Alice"` and `"Bob"` and your bigger-ID-first rule, `"Bob" > "Alice"`, so it would be `xaybzc`.
>
> The important part is that the words get zipped together by counter instead of remaining contiguous.
>
> Left-to-right typing behaves differently because later letters use the previous letter as their origin:
>
> `a → b → c`
>
> and
>
> `x → y → z`
>
> Only the first letters are siblings. Once the merge decides whether the `a` subtree or `x` subtree comes first, the Lamport ordering makes the skip loop jump over that sibling's entire descendant chain. So you get either:
>
> `abcxyz` or `xyzabc`
>
> rather than interleaving the letters.
>
> So the RGA weakness is specifically that backward typing turns the entire run into siblings; forward typing turns each run into a subtree.

**Feedback:** Correct on all of it. With this repo's test IDs "A" and "B" it's `xaybzc`. When P7 ran, the shrunk case was even smaller: one backward run is enough.

#### 2026-09-28 23:20 UTC · Quiz, PR #14 (P7)

**Question:** 1. In the pinned case, why does Bob's (1,B) sort between Alice's (2,A) and (1,A), and why does his (2,B) stay right after (1,B)? 2. What extra piece of information would let a merge know Alice's second "a" belongs directly before her first?

**Your answer:**

> 1. Bob’s `(1,B)` sorts between Alice’s `(2,A)` and `(1,A)` because all three are siblings with the same origin, `null`, and RGA orders those siblings by ID from larger to smaller:
>
>    * `(2,A)` is largest because counter `2 > 1`
>
>    * between `(1,B)` and `(1,A)`, counters tie, so replica ID breaks the tie
>
>    * since `"B" > "A"`, `(1,B) > (1,A)`
>
> So the sibling order is:
>
> `(2,A) → (1,B) → (1,A)`
>
> Bob’s `(2,B)` is different: it was typed after `(1,B)`, so its origin is `(1,B)`. That makes it part of `(1,B)`’s subtree, not another `null` sibling. Once the skip loop reaches `(1,B)`, `(2,B)` stays attached to it, so the structure becomes:
>
> `(2,A) → (1,B) → (2,B) → (1,A)`
>
> That’s why Bob’s run stays together while Alice’s gets split.
>
> 2. The missing information is the right neighbor.
>
> When Alice inserts her second `"a"` at index 0, RGA records only:
>
> left/origin = `null`
>
> But that loses the fact that, at the moment Alice typed it, she meant:
>
> put this new `"a"` between the start of the document and my existing `(1,A)`
>
> So if the op also recorded something like:
>
> * left neighbor: `null`
>
> * right neighbor: `(1,A)`
>
> then the merge would know the new character belongs specifically directly before `(1,A)`, rather than just being one more member of the huge group of `null`-origin siblings.
>
> That is the key idea Fugue builds on: preserve more of the insertion position than just “what was on my left.” For backward typing, knowing the right-side anchor is what lets the algorithm keep Alice’s run together instead of letting unrelated concurrent siblings slip between its characters.

**Feedback:** Both correct. The right neighbour is exactly the missing piece Fugue adds.

#### 2026-09-28 23:24 UTC · Check, Fugue in prose

**Question:** Draw the Fugue tree for the two backward runs, write the in-order walk, and say what the replica-ID tie-break still decides and what it can no longer affect.

**Your answer:**

> Treat the start of the document as a sentinel root `⊥`.
>
> Alice typing backward:
>
> ```
> ⊥
> └─ right: c
>    └─ left: b
>       └─ left: a
> ```
>
> Bob independently does the same:
>
> ```
> ⊥
> ├─ right: c
> │  └─ left: b
> │     └─ left: a
> │
> └─ right: z
>    └─ left: y
>       └─ left: x
> ```
>
> So Alice's subtree reads in-order as:
>
> `a → b → c`
>
> and Bob's reads:
>
> `x → y → z`
>
> The only remaining question is how the two concurrent right children of `⊥`, `c` and `z`, are ordered.
>
> If `c`'s subtree wins the sibling tie-break, the walk is:
>
> `abcxyz`
>
> If `z`'s subtree wins:
>
> `xyzabc`
>
> The replica-ID tie-break still decides which concurrent run comes first as a whole.
>
> What it can no longer affect is the ordering inside the runs. It cannot produce something like:
>
> `axbycz`
>
> because `a,b,c` are structurally one subtree and `x,y,z` are another. The traversal finishes one subtree before moving to its sibling.
>
> So Fugue changes the tie-break from:
>
> “How do these individual concurrent characters intermix?”
>
> to:
>
> “Which complete concurrent run goes first?”

**Feedback:** Correct. Detail: the *author* decides left child or right child at typing time, and the op carries that decision (`parent` + `side`), so a receiver just attaches the node.

#### 2026-09-29 21:47 UTC · Quiz, PR #15 (Fugue inserts)

**Question:** 1. Alice has typed "ac". With the cursor between them she types "b". Where does "b" go in the tree, and why isn't it a right child of "a"? 2. Why doesn't Fugue need RGA's "every descendant has a bigger ID" property?

**Your answer:**

> 1. If Alice has `ac` and inserts `b` between them, then:
>
> * left neighbor = `a`
>
> * right neighbor = `c`
>
> But `a` already has a right child: `c`. So `b` does not become another right child of `a`. Instead, it becomes a left child of `c`.
>
> Structurally:
>
> ```text
> a
> └─ right: c
>    └─ left: b
> ```
>
> The in-order walk is:
>
> `a b c`
>
> It isn't a right child of `a` because that would make `b` a sibling of `c`, which would throw away the important information that Alice inserted `b` specifically before `c`. Making it a left child of `c` encodes that exact position.
>
> 2. Fugue doesn't need RGA's “every descendant has a bigger ID” property because it doesn't discover subtree boundaries by scanning a flat array and comparing IDs.
>
> RGA's skip loop needs IDs to tell it:
>
> “keep moving because this item still belongs to the bigger sibling's subtree.”
>
> Fugue represents those relationships directly in the tree:
>
> * left child
>
> * parent
>
> * right child
>
> An in-order traversal naturally visits an entire subtree in the correct place. IDs are still needed to deterministically order concurrent siblings on the same side, but they no longer have to encode enough information for a flat scan to infer where one subtree ends.
>
> So the short version is:
>
> RGA uses ID ordering to infer structure; Fugue stores the structure explicitly.

**Feedback:** Both correct. Addition to 1: as a right child of "a", "b" wouldn't just lose information, it would land in the wrong place. Siblings sort smallest ID first and "b" has a bigger ID than "c", so Alice's own screen would read "acb".

#### 2026-09-29 21:51 UTC · Quiz, PR #16 (Fugue deletes and held ops)

**Question:** 1. Why can't Fugue remove a deleted node, even when no replica will ever show it again? 2. Alice types "a" then "b" to its right, and Bob receives "b" first. What happens to "b", and what exact event releases it?

**Your answer:**

> 1. Fugue can’t remove a deleted node because that node may still be structurally necessary even though it is no longer visible.
>
> Other inserts may have that node as their parent, or may need its position to preserve the tree’s ordering. If you physically remove it, you can orphan descendants or lose the information that tells the traversal where those descendants belong.
>
> So, like RGA, Fugue keeps a deleted character as a tombstone:
>
> * hidden from `text()`
>
> * still present in the tree
>
> * still usable as a parent/anchor
>
> “Deleted” means not visible, not structurally erased.
>
> 2. Alice types:
>
> * `a`
>
> * then `b` to the right of `a`
>
> So `b`’s parent is `a`.
>
> If Bob receives `b` first, he cannot place it yet because its parent `a` is missing. He puts `b` in the pending buffer.
>
> Then Bob receives and applies `a`.
>
> That exact event—the arrival/application of `a`, which creates `b`’s missing parent—makes `b` ready. The release loop retries pending ops, sees that `b`’s parent now exists, and inserts `b` into the tree.
>
> So:
>
> missing parent → hold the op; parent arrives → release it.

**Feedback:** Both correct. Detail for 1: the tombstone is needed even on the replica that deleted it. Fugue's middle-insert rule looks for "the leftmost node of the next subtree", which can be a tombstone, and the new character becomes its left child. Refinement for 2: the release happens inside the same `apply` call that places "a".
