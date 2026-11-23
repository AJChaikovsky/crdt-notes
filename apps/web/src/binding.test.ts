import { EditorState, Transaction } from "@codemirror/state";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FastFugue } from "@crdt-notes/crdt";
import { applyToCrdt, fromRemote, toCodeMirror } from "./binding.js";

// Like the CRDT properties: NUM_RUNS cases (100 locally, 10,000 in CI), seed printed.
function parameters<T>(): fc.Parameters<T> {
  const numRuns = Number(process.env["NUM_RUNS"] ?? 100);
  const seed =
    process.env["SEED"] === undefined ? Date.now() : Number(process.env["SEED"]);
  console.info(`fast-check: numRuns=${numRuns} seed=${seed}`);
  return { numRuns, seed };
}

/** One editor transaction: up to 3 non-overlapping changes, as raw picks. */
const transaction = fc.array(
  fc.record({
    at: fc.nat(),
    length: fc.nat({ max: 3 }),
    insert: fc.string({ maxLength: 4 }),
  }),
  { minLength: 1, maxLength: 3 },
);

/** Turns raw picks into valid, sorted, non-overlapping changes for a text of `size`. */
function changesFor(
  size: number,
  picks: { at: number; length: number; insert: string }[],
) {
  const changes: { from: number; to: number; insert: string }[] = [];
  const sorted = picks
    .map((p) => {
      const from = p.at % (size + 1);
      return { from, to: Math.min(size, from + p.length), insert: p.insert };
    })
    .sort((a, b) => a.from - b.from);
  let end = -1;
  for (const change of sorted) {
    // Strictly after the previous change, so two inserts never share a position.
    if (change.from <= end) continue;
    changes.push(change);
    end = change.to;
  }
  return changes;
}

describe("CodeMirror binding", () => {
  it("keeps the CRDT's text equal to the editor's through any transactions", () => {
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 30 }), (transactions) => {
        let state = EditorState.create({ doc: "" });
        const doc = new FastFugue("A");
        for (const picks of transactions) {
          const tr = state.update({ changes: changesFor(state.doc.length, picks) });
          applyToCrdt(tr.changes, doc);
          state = tr.state;
          expect(doc.text()).toBe(state.doc.toString());
        }
      }),
      parameters(),
    );
  });

  it("keeps a second editor equal to the CRDT by applying its reported changes", () => {
    fc.assert(
      fc.property(fc.array(transaction, { maxLength: 30 }), (transactions) => {
        let author = EditorState.create({ doc: "" });
        let viewer = EditorState.create({ doc: "" });
        const a = new FastFugue("A");
        const b = new FastFugue("B");
        b.subscribe((change) => {
          viewer = viewer.update({
            changes: toCodeMirror(change),
            annotations: [fromRemote.of(true), Transaction.addToHistory.of(false)],
          }).state;
        });
        for (const picks of transactions) {
          const tr = author.update({ changes: changesFor(author.doc.length, picks) });
          // Every op the author makes reaches the viewer's replica straight away.
          applyToCrdt(tr.changes, {
            insertAt: (i, c) => b.apply(a.insertAt(i, c)),
            deleteAt: (i) => b.apply(a.deleteAt(i)),
          });
          author = tr.state;
          expect(viewer.doc.toString()).toBe(author.doc.toString());
        }
      }),
      parameters(),
    );
  });
});
