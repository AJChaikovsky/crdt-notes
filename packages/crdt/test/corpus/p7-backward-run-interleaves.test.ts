import { describe, expect, it } from "vitest";
import { Rga } from "../../src/index.js";

// Shrunk by fast-check from P7 (non-interleaving) on 2026-09-28, seeds 1, 2 and 3.
//
// KNOWN ANOMALY, pinned on purpose (ADR-0001): RGA interleaves backward runs. Alice types
// "aa" backward at index 0, so both of her characters have origin null and are siblings.
// Bob concurrently types "aa" forward. His first character sorts between Alice's two, and
// his second follows it, splitting her run.
//
// When Fugue lands, this test must change to expect Alice's run in one piece; P7 then
// covers backward runs too.
describe("corpus: P7 backward run interleaves (RGA)", () => {
  it("splits Alice's backward run with Bob's forward run", () => {
    const alice = new Rga("A");
    const a1 = alice.insert(null, "a"); // (1,A)
    const a2 = alice.insert(null, "a"); // (2,A), typed before a1: a backward run

    const bob = new Rga("B");
    const b1 = bob.insert(null, "a"); // (1,B)
    const b2 = bob.insert(b1.id, "a"); // (2,B), typed after b1: a forward run

    for (const op of [b1, b2]) alice.apply(op);
    for (const op of [a1, a2]) bob.apply(op);

    // Alice's run reads a2, a1. Bob's run lands between them.
    const expected = [a2.id, b1.id, b2.id, a1.id];
    expect(alice.visibleIds()).toEqual(expected);
    expect(bob.visibleIds()).toEqual(expected);
  });
});
