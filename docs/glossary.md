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
