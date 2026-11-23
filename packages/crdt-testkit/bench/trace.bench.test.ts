import { FastFugue, Fugue, type FugueOp } from "@crdt-notes/crdt";
import { describe, expect, it } from "vitest";
import { expectedText, loadTrace, replayLocal } from "./trace.js";

// Phase 4 benchmark (ADR-0005): replay the automerge-paper trace, 259,778 edits ending at
// 104,852 characters. Target: the full trace in under 1s in Node.
//
// REF_EDITS limits the reference Fugue to a prefix: it walks the whole document on
// every keystroke, so its full replay would take hours. EDITS limits FastFugue.
const trace = loadTrace("automerge-paper");

type Doc = Fugue | FastFugue;

function time<T>(run: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = run();
  return { result, ms: performance.now() - start };
}

function bench(name: string, create: (replica: string) => Doc, limit: number): void {
  const edits = trace.edits.slice(0, limit);
  const full = edits.length === trace.edits.length;
  it(`${name}: ${edits.length} of ${trace.edits.length} edits`, () => {
    const want = full ? trace.endContent : expectedText(edits);
    const author = create("A");
    const local = time(() => replayLocal<FugueOp>(author, edits));
    expect(author.text()).toBe(want);

    // The same ops arriving at another replica, in order.
    const peer = create("B");
    const remote = time(() => {
      for (const op of local.result) peer.apply(op);
    });
    expect(peer.text()).toBe(want);

    console.info(
      `${name}: ${edits.length} edits, local ${local.ms.toFixed(0)} ms, ` +
        `remote ${remote.ms.toFixed(0)} ms, ${want.length} chars`,
    );
  });
}

describe("trace replay: automerge-paper", () => {
  bench(
    "Fugue (reference)",
    (id) => new Fugue(id),
    Number(process.env["REF_EDITS"] ?? 20_000),
  );
  bench("FastFugue", (id) => new FastFugue(id), Number(process.env["EDITS"] ?? Infinity));
});
