import { describe, expect, it } from "vitest";
import { Fugue, Rga } from "../../src/index.js";

// Shrunk by fast-check from P7 (non-interleaving) on 2026-09-28, seeds 1, 2 and 3.
//
// KNOWN ANOMALY, pinned on purpose (ADR-0001): RGA interleaves backward runs. Alice types
// "aa" backward at index 0, so both of her characters have origin null and are siblings.
// Bob concurrently types "aa" forward. His first character sorts between Alice's two, and
// his second follows it, splitting her run.
//
// Fugue fixes it (ADR-0004): the same edits keep Alice's run in one piece, and P7 covers
// backward runs for Fugue. The RGA test stays as a record of the anomaly.
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

describe("corpus: P7 backward run interleaves (Fugue keeps it whole)", () => {
  it("keeps Alice's backward run in one piece beside Bob's forward run", () => {
    const alice = new Fugue("A");
    const a1 = alice.insert(null, "a"); // (1,A), right child of the start
    const a2 = alice.insert(null, "a"); // (2,A), left child of a1: a backward run

    const bob = new Fugue("B");
    const b1 = bob.insert(null, "a"); // (1,B), right child of the start
    const b2 = bob.insert(b1.id, "a"); // (2,B), right child of b1: a forward run

    for (const op of [b1, b2]) alice.apply(op);
    for (const op of [a1, a2]) bob.apply(op);

    // a1 and b1 are sibling subtrees under the start, (1,A) first. Each run stays inside
    // its own subtree, so neither can split the other.
    const expected = [a2.id, a1.id, b1.id, b2.id];
    expect(alice.visibleIds()).toEqual(expected);
    expect(bob.visibleIds()).toEqual(expected);
  });
});
