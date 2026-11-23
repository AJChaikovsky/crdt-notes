import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FastFugue, Fugue } from "@crdt-notes/crdt";
import { fastFugue, fugue } from "./implementation.js";
import { propertyParameters } from "./property.js";
import { run, scenario } from "./scenario.js";

// Phase 4 exit (roadmap): the optimised implementation produces identical output to the
// reference. Same scenario, same delivery choices, so every replica must end with the
// same items, tombstones included, and every op must be identical.
describe("FastFugue matches the reference Fugue", () => {
  it("gives identical ops and identical replicas for the same scenario", () => {
    fc.assert(
      fc.property(scenario(), fc.boolean(), (s, causal) => {
        const reference = run(fugue, s, { causal });
        const fast = run(fastFugue, s, { causal });
        expect(fast.log()).toEqual(reference.log());
        for (let r = 0; r < reference.size; r += 1) {
          expect(fast.doc(r).items()).toEqual(reference.doc(r).items());
        }
      }),
      propertyParameters(),
    );
  });
});

describe("FastFugue matches the reference Fugue on documents big enough to split", () => {
  // The scenarios above stay under one B-tree leaf (64 items). These grow to hundreds of
  // characters, edited anywhere, so leaves and inner nodes split.
  it("gives identical ops and items for long local editing with any cursor position", () => {
    const edit = fc.record({
      del: fc.boolean(),
      pick: fc.nat(),
      char: fc.constantFrom("a", "b"),
    });
    fc.assert(
      fc.property(fc.array(edit, { minLength: 300, maxLength: 1500 }), (edits) => {
        const reference = new Fugue("A");
        const fast = new FastFugue("A");
        for (const { del, pick, char } of edits) {
          const length = reference.visibleIds().length;
          if (del && length > 0) {
            expect(fast.deleteAt(pick % length)).toEqual(
              reference.deleteAt(pick % length),
            );
          } else {
            const at = pick % (length + 1);
            expect(fast.insertAt(at, char)).toEqual(reference.insertAt(at, char));
          }
        }
        expect(fast.items()).toEqual(reference.items());
      }),
      { ...propertyParameters(), numRuns: 50 },
    );
  });

  it("gives identical replicas for long multi-replica scenarios", () => {
    fc.assert(
      fc.property(scenario(600), fc.boolean(), (s, causal) => {
        const reference = run(fugue, s, { causal });
        const fast = run(fastFugue, s, { causal });
        for (let r = 0; r < reference.size; r += 1) {
          expect(fast.doc(r).items()).toEqual(reference.doc(r).items());
        }
      }),
      { ...propertyParameters(), numRuns: 100 },
    );
  });
});
