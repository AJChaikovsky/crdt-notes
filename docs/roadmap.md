# Roadmap

Acronyms are expanded on first use; full definitions live in `glossary.md`.

Each phase has an **exit criterion**. Don't start the next phase until the current one
meets it. The whole point of this ordering is that the hard correctness work happens
while the project is still small enough to reason about.

## Repo layout

```
packages/
  crdt/            zero runtime deps, the thing you're actually building
  crdt-testkit/    replica simulator, fast-check generators, trace replay (dev only)
  sync-protocol/   wire types shared by server and web
apps/
  server/          Node + ws, per-document op log, vector-clock catch-up
  web/             React editor, IndexedDB, PWA
docs/
  crdt-design.md   the writeup
  decisions/       ADRs
```

---

## Phase 0 — Scaffold

pnpm workspace (several packages in one repo), TypeScript strict mode, Vitest (test
runner), fast-check (property-based testing library), GitHub Actions for CI (Continuous
Integration), lint, format.

**Exit:** CI is green on an empty-but-real test suite, and `pnpm test` runs in under 5s.

---

## Phase 1 — CRDT spine

Op (operation) IDs (`{ replica: string, counter: number }`), Lamport clock — a
per-replica counter that establishes causal ordering without synchronised wall-clocks —
the op types, and a
deliberately naive reference implementation — array of items with tombstones, O(n) scan,
no optimisation. Readability over speed. This becomes your oracle later.

**Exit:** hand-written tests pass for: concurrent inserts at the same position resolve
deterministically regardless of delivery order; delete-then-insert-at-that-position
behaves; an op delivered twice is a no-op.

---

## Phase 2 — The convergence harness

This is the real deliverable of the first half of the project. Build `crdt-testkit`:
N in-memory replicas, a generator for random op sequences, a generator for random but
**causally valid** delivery orders, and a runner that asserts all replicas converge.

**Exit:** properties P1–P6 green at 10,000 seeds in CI. Plus — and this matters — you
have deliberately broken the tie-break rule (e.g. compared replica IDs the wrong way)
and confirmed the harness *catches it within a few hundred seeds*. A property test you
haven't seen fail is a property test you don't trust.

---

## Phase 3 — Interleaving

Write P7, the non-interleaving property. Depending on what you chose in ADR-0001 (Architecture Decision Record), watch
it fail on a specific input class. Understand exactly why. Either fix the algorithm or
document the anomaly as a deliberate, bounded tradeoff.

**Exit:** P7 green, or an ADR that explains precisely which input class interleaves,
with a minimal reproducing test in the corpus and an argument for why you accept it.

---

## Phase 4 — Making it not slow

The naive implementation is O(n) per op — cost proportional to document length — and stores one object per character. Fix it:
RLE (Run-Length Encoding) of contiguous same-replica inserts, collapsing 50 sequential
keystrokes into one record, an index cache for the common
case of sequential local edits, and a tombstone strategy (see ADR-0003).

**Exit:** the reference implementation from Phase 1 and the optimised one are both run
against the same property suite and produce identical output. A benchmark replaying a
realistic editing trace on a 100k-character document completes in a target you set now
and write down.

---

## Phase 5 — Persistence and sync

IndexedDB (the browser's built-in local database) op log plus periodic snapshots. Node + `ws` server that relays ops and stores
them per document. Vector-clock handshake — a vector clock being a per-replica map of the
highest counter seen from every other replica, which lets you compute exactly what a
client is missing rather than re-sending everything — so a client offline for a week gets
only what it missed.

**Exit:** integration test — three clients, server killed and restarted mid-session,
one client offline across the restart, all three converge to identical state.

---

## Phase 6 — The app

React markdown editor, cursor/selection presence (an ephemeral layer, *not* in the CRDT —
presence is not persistent state), document list, share links, service worker (a background
script that serves cached responses when offline), PWA (Progressive Web App)
manifest, offline-first shell.

**Exit:** Playwright test with two browser contexts, network disabled on both, divergent
edits to the same sentence, network restored, both DOMs (Document Object Model — the
browser's rendered page tree) identical.

---

## Phase 7 — Demo and writeup

The scripted GIF (Graphics Interchange Format — the animated screen recording) scenario, and `docs/crdt-design.md` finished. Write the Yjs comparison
by actually running the same trace through Yjs and measuring, not by paraphrasing its
README.

**Exit:** the GIF exists and is under 5MB. The writeup has no `TODO` markers.

---

## Parked

Things that will occur to you mid-project. Write them here and move on.

- (add as they come up)
