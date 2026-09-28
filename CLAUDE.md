# CLAUDE.md

Guardrails for Claude Code in this repository. Read this before doing anything.

## What this project is

A local-first collaborative markdown notes app. Every client works fully offline and
syncs conflict-free on reconnect. The list CRDT (Conflict-free Replicated Data Type)
that makes this work is implemented from scratch in this repo, not imported.

Terms are defined in `docs/glossary.md`. If you hit one that isn't there, it belongs there.

## Non-negotiables

1. **No CRDT library in the core.** `packages/crdt` has zero runtime dependencies.
   Yjs, Automerge, Loro, diamond-types, and friends are reference material and
   comparison targets. They never appear in an `import` inside `packages/crdt`.
   If you think a dependency is unavoidable, stop and say so instead of adding it.

2. **The CRDT is finished and fuzzed before any UI (User Interface) exists.** No React,
   no IndexedDB (the browser's built-in local database), no WebSocket until the
   convergence property tests have been green across thousands of seeds in CI
   (Continuous Integration — the automated test run on every push). If asked to "just
   sketch the editor real quick," refuse and point at the roadmap.

3. **A convergence property-test failure is a stop-the-line bug.** Do not continue
   feature work. Do not raise the `numRuns` threshold in fast-check (the property-based
   testing library) to make it pass.
   Do not mark it `.skip`. Shrink the counterexample to a minimal case, add it to the
   regression corpus in `packages/crdt/test/corpus/`, and fix the algorithm.

4. **Every counterexample becomes a permanent test.** The corpus only grows.

## How to work with me

I am learning this material, not outsourcing it. That changes what "helpful" means here.

- **At every design fork, stop.** Give me 2–3 options, the failure mode of each, your
  recommendation, and *why*. Then ask me to pick. Do not pick for me and proceed.
- **Explain before you implement.** For anything non-trivial, write the algorithm in
  prose or pseudocode first, and check that I follow it, before generating TypeScript.
- **Quiz me.** After each significant piece lands, ask me 2–3 questions that I can only
  answer if I actually understood it. Tell me plainly when I'm wrong. Do not be
  encouraging about a wrong answer.
- **Small steps.** One concept per exchange. Never write the CRDT integration algorithm
  in a single shot — build it incrementally with a test at each step.
- **Expand every acronym on first use, in parentheses.** Write "CRDT (Conflict-free
  Replicated Data Type)", not "CRDT". This applies in chat, in code comments, and in
  docs. Once per conversation or once per document is enough — don't expand it in
  every sentence.
- **Fully explain any concept the first time it comes up.** Not a one-line gloss — what
  it is, what problem it solves, and what goes wrong without it. If I've seen it before
  in this project it's in `docs/glossary.md`; check there and link rather than
  re-explaining. If it isn't in the glossary, explain it properly *and* add it.
- **Push back.** If I ask for something that will bite me later, say so before doing it.
- **No silent design decisions.** If you had to choose a tie-break rule, an encoding, or
  an ordering while implementing, surface it in your response and add it to the relevant
  ADR in `docs/decisions/`.

## Conventions

- TypeScript strict mode. `noUncheckedIndexedAccess` on. No `any`, no non-null `!`
  assertions in `packages/crdt` — if the types don't work, the model is wrong.
- Vitest + fast-check. Property tests live beside the code as `*.property.test.ts`.
- pnpm workspaces. Packages: `crdt` (zero-dep core), `crdt-testkit` (simulator and
  generators, dev-only), `sync-protocol` (shared wire types). Apps: `server`, `web`.
- Conventional commits. One logical change per commit.
- Public API (Application Programming Interface — the functions and types other packages
  are allowed to call) of `packages/crdt` is documented with TSDoc (TypeScript's doc
  comment format, the `/** ... */` blocks) including a worked example of concurrent
  behaviour.
- Design decisions are recorded as ADRs (Architecture Decision Records) in
  `docs/decisions/` — numbered, dated files capturing what you chose, what you rejected,
  and why, so future-you can tell a deliberate choice from an accident.

## Definition of done, per layer

| Layer | Done means |
|---|---|
| CRDT core | Properties P1–P9 in `docs/testing-strategy.md` green at 10k seeds in CI |
| Persistence | Kill the tab mid-edit, reload, state is byte-identical |
| Sync | Kill the server mid-session, reconnect, all replicas converge |
| Editor | Two windows, airplane mode, divergent edits, reconnect, clean merge |
| Writeup | `docs/crdt-design.md` has no `TODO` markers left |

## Things that are out of scope until explicitly unblocked

Auth, multi-document permissions, rich text (bold/italic as CRDT-tracked formatting),
mobile apps, server clustering, end-to-end encryption. Note them in
`docs/roadmap.md#parked` if they come up. Don't build them.
