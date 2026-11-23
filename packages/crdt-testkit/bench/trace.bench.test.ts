import { Fugue, type FugueOp } from "@crdt-notes/crdt";
import { describe, expect, it } from "vitest";
import { expectedText, loadTrace, replayLocal } from "./trace.js";

// Phase 4 benchmark (ADR-0005): replay the automerge-paper trace, 259,778 edits ending at
// 104,852 characters. Target: the full trace in under 1s in Node.
//
// EDITS limits the replay to a prefix. The reference Fugue walks the whole document on
// every keystroke, so its full replay would take hours; it defaults to the first 20,000.
const trace = loadTrace("automerge-paper");
const limit = Number(process.env["EDITS"] ?? 20_000);
const edits = trace.edits.slice(0, limit);
const full = edits.length === trace.edits.length;

function time<T>(run: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = run();
  return { result, ms: performance.now() - start };
}

describe(`trace replay: automerge-paper, ${edits.length} of ${trace.edits.length} edits`, () => {
  const want = full ? trace.endContent : expectedText(edits);

  it("Fugue (reference)", () => {
    const author = new Fugue("A");
    const local = time(() => replayLocal<FugueOp>(author, edits));
    expect(author.text()).toBe(want);

    // The same ops arriving at another replica, in order.
    const peer = new Fugue("B");
    const remote = time(() => {
      for (const op of local.result) peer.apply(op);
    });
    expect(peer.text()).toBe(want);

    console.info(
      `Fugue (reference): local ${local.ms.toFixed(0)} ms, remote ${remote.ms.toFixed(0)} ms, ` +
        `${local.result.length} ops, ${want.length} chars`,
    );
  });
});
