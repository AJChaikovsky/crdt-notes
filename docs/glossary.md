# Glossary

Every term this project uses, explained once. Other docs link here instead of
re-explaining. If a term is missing, it belongs here.

## Tooling (Phase 0)

**pnpm workspace.** One repository holding several packages (`packages/crdt`,
`packages/crdt-testkit`, ...) that can depend on each other without being published.
It keeps the CRDT (Conflict-free Replicated Data Type) core separate from test tooling,
so the rule "the core has zero runtime dependencies" is visible in one `package.json`
and checked by a test. Without it you'd either publish packages to share code or mix
dev-only code into the core.

**Vitest.** The test runner: it finds `*.test.ts` files, runs them, and reports
failures. `pnpm test` runs it once.

**Property-based testing / fast-check.** Instead of checking one hand-picked input,
you state a rule that must hold for every input ("all replicas end up with the same
text") and fast-check generates hundreds or thousands of random inputs to try to break
it. When one fails, it *shrinks* the input to the smallest case that still fails. This
matters for a CRDT because the bugs live in delivery orders no human would think to
write by hand.

**Seed / `numRuns`.** fast-check's random inputs come from a seed number: the same seed
generates the same inputs, so a printed seed makes a failure reproducible
(`SEED=<n> pnpm test`). `numRuns` is how many inputs each property tries: 100 locally
(`NUM_RUNS` overrides it), 10,000 in CI.

**CI (Continuous Integration).** GitHub Actions runs format, lint, typecheck and the
full 10,000-run test suite on every push and pull request, so a broken property can't
land on `main` unnoticed. The workflow lives in `.github/workflows/ci.yml`.

**Lint (ESLint) and format (Prettier).** ESLint flags code patterns that are legal but
wrong for this repo; here it also bans CRDT libraries, `any` and non-null `!`
assertions inside `packages/crdt`. Prettier rewrites layout so diffs only show real
changes.

## CRDT spine (Phase 1)

**Replica.** One copy of a document being edited: a device, or a tab. Each has a
**replica ID**, a string that is unique to it (a UUID, Universally Unique Identifier,
in the app). Without it, two replicas could create the same character ID.

**Character ID / op ID.** The pair `(counter, replica)` that names one inserted
character forever. Array indices can't do this: a concurrent insert or delete earlier in
the text shifts them, so "insert after index 3" lands in different places on different
replicas.

**Lamport clock.** A counter each replica keeps. It adds 1 for every local op, and on
receiving a remote op it jumps to `max(own, theirs)`. That guarantees: if B's author had
seen A, B's counter is bigger than A's. The reverse does not hold, since a smaller
counter can also belong to a concurrent op, which is why ties need a rule. Without the
jump, something typed after seeing another op could get a smaller counter and be sorted
as if it came first. See ADR-0002.

**Origin.** The ID of the character an insert was typed after (`null` for the start of
the document). RGA (Replicated Growable Array) stores it instead of an index, because
an index names a different character once someone else edits earlier in the text.

**Siblings.** Inserts that share the same origin, usually typed concurrently at the
same spot. RGA places the one with the bigger ID first. Everything typed after a sibling
has an even bigger ID (the Lamport clock guarantees it), so skipping every item with a
bigger ID skips a newer sibling together with everything typed after it.

**Integrate.** Applying an insert to a replica's state: start just after the origin,
skip items with bigger IDs, insert at the first smaller one. Local and remote inserts use
the same code, which is what makes replicas agree.

**Tombstone.** A deleted character that stays in the array, marked `deleted`, instead
of being removed. It is hidden from the visible text but keeps its place. Without it, an
insert typed concurrently right after that character would arrive with an origin that no
longer exists and have nowhere to go. The cost is that tombstones accumulate; ADR-0003
will decide whether and when to collect them.

## Convergence harness (Phase 2)

**Causal dependencies.** Every op the author of an op had already applied when they made
it. The origin (or delete target) is one of them, but not the only one: if Alice saw
Carol's edit before typing, Carol's edit is a dependency even if Alice typed somewhere
else. The simulator stores them as an explicit set of op keys per op.

**Causally valid delivery.** An order of delivering ops in which no op reaches a replica
before all of its causal dependencies have. Concurrent ops, which don't depend on each
other, can still arrive in any order. Real sync guarantees this, so the harness
generates only such orders by default; P4 tests what happens when it's broken.

**Mutation testing.** Deliberately breaking the code (a "mutation") and checking that
the tests fail. A property that survives a real bug isn't testing what you think it is.
Results go in the mutation log in `docs/testing-strategy.md`.

**Idempotence.** Applying the same op twice leaves the state exactly as applying it
once. A sync server replays ops after a reconnect because it can't know which of its
last messages arrived, so every replica will see duplicates. Without it, a replayed
insert types the character a second time, and a replayed delete can undo itself. P2
tests it.

**Commutativity.** Applying two concurrent ops in either order gives the same state.
Replicas receive concurrent ops in different orders, so without it they drift apart.
"Same state" means the whole item list, tombstones included, not just the visible text:
two replicas can show identical text with a tombstone in different places, and diverge
only when someone later types after that tombstone. P3 tests it with `Rga.items()`.

**Held op (causal readiness).** A remote op that arrived before its origin or target,
kept in a replica's pending list and applied as soon as that op arrives. Dropping it
would lose an edit for good; applying it early is impossible, because there is nowhere
to put it. RGA only needs the origin or target present, not every op the author had
seen. P4 tests it; ADR-0003 has the design.

**Intention preservation.** A user's edit takes effect where they made it: a character
typed at the cursor appears at the cursor, on their own screen, whatever they have
received from others. Convergence alone doesn't guarantee it; replicas can all agree on
a document where a keystroke landed somewhere else. P5 tests it.

## Interleaving (Phase 3)

**Interleaving.** Two runs of text typed concurrently at the same spot get shuffled
together in the merge ("axbycz" instead of "abcxyz"). Replicas still converge, so
P1 to P6 pass, but the text is nonsense to both writers. In RGA a backward run (each
character typed before the previous one, so all of them share one origin) is a set of
siblings, and anything concurrent can sort between them. A forward run is a chain of
children, which the skip loop keeps together. P7 tests it; ADR-0001 plans the fix
(Fugue).

**Regression corpus.** `packages/crdt/test/corpus/`: every counterexample fast-check
has shrunk, frozen as a named test that runs on every push. It only grows.

**Fugue tree, left and right children.** In Fugue every character is a node with left
children and right children, each list sorted by ID. The document is the in-order walk:
a node's left children (and their subtrees), then the node, then its right children.
Typing forward adds right children; typing before an existing character adds a left
child of it. A run typed in one go is one subtree, and a walk never leaves a subtree
half-read, which is why runs don't interleave. ADR-0004.

**Right origin.** The character immediately to the right of the cursor when typing,
tombstones included. RGA ignores it; Fugue uses it to decide where a character typed
before existing text belongs.

## Performance (Phase 4)

**Editing trace.** A recording of a real editing session, one entry per keystroke: at
visible position `pos`, delete `del` characters, then insert some text. Replaying one
through a CRDT gives a realistic benchmark, because real typing has long runs and strong
locality (the next keystroke is usually right after the last one), which made-up
workloads lack. Without a trace, it's easy to optimise for a workload nobody produces.
This project uses the automerge-paper trace (ADR-0005).

**Local vs remote replay.** Local replay is one replica typing the trace itself, so every
keystroke has to turn a cursor index into a position in the CRDT. Remote replay is
another replica applying the resulting ops, which already name their parent by ID. The
two can differ by orders of magnitude, so the benchmark times both.

**B-tree (position tree).** A balanced tree whose nodes each hold many entries (here up
to 64), so it stays only a few levels deep even for a huge document. Each node also
stores how many visible characters are under it, which lets you find "the character at
index i" by walking down and subtracting counts, in log n steps instead of reading the
whole document. Without it, every keystroke costs time proportional to the document's
length, which made the reference Fugue take an estimated 1.5 hours on the trace
(ADR-0006).

## Storage format (Phase 4, P8 and P9)

**Encoding (serialization).** Turning an in-memory value, like an op, into bytes or text
that can be stored or sent, and decoding is turning it back. Without it nothing leaves
the process. The catch is that the decoder reads data it didn't write: a corrupted disk,
a truncated message, an older or newer app version, or a hostile peer. So a decoder must
check everything and reject what it can't read, rather than crash or quietly build a
wrong value. Here, ops and snapshots are JSON with a version number (ADR-0007).

**Fuzzing.** Feeding a program large amounts of random or slightly broken input to find
inputs that crash it. P8 fuzzes the decoder: whatever text it gets, it must either
return a valid op or throw `DecodeError`, never some other exception. Without fuzzing, a
decoder is usually only tested on the well-formed input its author thought of.

**Snapshot.** A replica's whole state saved as one value, so it can be loaded in one step
instead of replaying every op since the document was created. It is what lets storage
throw away an old op log (compaction). It must restore everything that affects future
behaviour, not just the text: here the Fugue tree's shape, the tombstones, the Lamport
clock and any held-back ops (ADR-0007). A snapshot that only kept the text would load
fine and then merge the next concurrent edit differently from every other replica.

## Sync (Phase 5)

**Version vector.** A summary of which ops a side holds: one number per author, where
"Bob: 4" means "I hold Bob's ops 1 to 4". Two sides swap vectors when they reconnect,
and each sends only the ops above the other's numbers. Without it, a client offline for
a week either re-downloads the whole history or has no way to know what it missed.
It only works if the numbers have no gaps, which is why ops carry a per-author sequence
number (below) and the vector stops at the first missing op (ADR-0008).

**Sequence number (`seq`).** An op's position among its author's ops: 1 for the first,
then 2, 3, and so on, with no gaps. It is separate from the Lamport counter, which jumps
whenever the author sees someone else's op, so "highest counter seen" can't reveal a
missing op and "highest unbroken `seq`" can.
