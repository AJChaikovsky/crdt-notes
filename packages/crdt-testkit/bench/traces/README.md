# Editing traces

Recorded editing sessions, replayed by the Phase 4 benchmark (`../trace.bench.test.ts`).

## automerge-paper.json.gz

The character-by-character editing trace of Martin Kleppmann writing the LaTeX paper
"A Conflict-Free Replicated JSON Datatype" (arXiv:1608.03960): 259,778 single-character
edits (182,315 inserts and 77,463 deletes) that end at 104,852 characters. Pure ASCII.

- Original: [automerge/automerge-perf](https://github.com/automerge/automerge-perf),
  prepared by Martin Kleppmann.
- This file is the copy in the
  [josephg/editing-traces](https://github.com/josephg/editing-traces) format
  (`sequential_traces/automerge-paper.json.gz`), by Joseph Gentle.
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Unmodified.

Format: `{ startContent, endContent, txns: [{ time, patches: [[pos, del, ins], ...] }] }`.
Each patch deletes `del` characters at visible position `pos`, then inserts the string
`ins` there.
