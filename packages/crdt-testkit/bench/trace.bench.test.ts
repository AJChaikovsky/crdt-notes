import { encodeOp, FastFugue, Fugue, type FugueOp } from "@crdt-notes/crdt";
import { describe, expect, it } from "vitest";
import { expectedText, loadTrace, replayLocal } from "./trace.js";

// Phase 4 benchmark (ADR-0005): replay the automerge-paper trace, 259,778 edits ending at
// 104,852 characters. Target: the full trace in under 1s in Node.
//
// REF_EDITS limits the reference Fugue to a prefix: it walks the whole document on
// every keystroke, so its full replay would take hours. EDITS limits FastFugue.
const trace = loadTrace("automerge-paper");

function time<T>(run: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = run();
  return { result, ms: performance.now() - start };
}

function bench(name: string, Impl: typeof Fugue | typeof FastFugue, limit: number): void {
  const edits = trace.edits.slice(0, limit);
  const full = edits.length === trace.edits.length;
  it(`${name}: ${edits.length} of ${trace.edits.length} edits`, () => {
    const want = full ? trace.endContent : expectedText(edits);
    const author = new Impl("A");
    const local = time(() => replayLocal<FugueOp>(author, edits));
    expect(author.text()).toBe(want);

    // The same ops arriving at another replica, in order.
    const peer = new Impl("B");
    const remote = time(() => {
      for (const op of local.result) peer.apply(op);
    });
    expect(peer.text()).toBe(want);

    // Saving and reloading the whole state (ADR-0007), and the size of the op log.
    const saved = time(() => peer.snapshot());
    const loaded = time(() => Impl.load("B", saved.result));
    expect(loaded.result.items()).toEqual(peer.items());
    const logBytes = local.result.reduce((sum, op) => sum + encodeOp(op).length, 0);

    const mb = (chars: number): string => `${(chars / 1e6).toFixed(1)} MB`;
    console.info(
      `${name}: ${edits.length} edits, local ${local.ms.toFixed(0)} ms, ` +
        `remote ${remote.ms.toFixed(0)} ms, ${want.length} chars; ` +
        `snapshot ${mb(saved.result.length)} in ${saved.ms.toFixed(0)} ms, ` +
        `load ${loaded.ms.toFixed(0)} ms; op log ${mb(logBytes)}`,
    );
  });
}

describe("trace replay: automerge-paper", () => {
  bench("Fugue (reference)", Fugue, Number(process.env["REF_EDITS"] ?? 20_000));
  bench("FastFugue", FastFugue, Number(process.env["EDITS"] ?? Infinity));
});
