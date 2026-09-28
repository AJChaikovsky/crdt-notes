import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { propertyParameters } from "./property.js";
import { concurrentRuns, typeRuns } from "./runs.js";
import { opKey } from "./simulator.js";

describe("interleaving", () => {
  // Forward runs only for now. RGA interleaves backward runs (ADR-0001); the shrunk case
  // is pinned in packages/crdt/test/corpus/. Phase 3's Fugue work widens this to both
  // directions and flips that corpus test.
  it("P7: a run typed in one go ends up contiguous, in its own order (forward runs)", () => {
    const forwardOnly = concurrentRuns().filter((s) =>
      s.runs.every((r) => r.direction === "forward"),
    );
    fc.assert(
      fc.property(forwardOnly, (spec) => {
        const { sim, runIds } = typeRuns(spec);
        for (let r = 0; r < sim.size; r += 1) {
          const doc = sim.rga(r).visibleIds().map(opKey).join(",");
          for (const ids of runIds) {
            // Contiguous and in order means the run's IDs appear as one unbroken stretch.
            expect(doc).toContain(ids.map(opKey).join(","));
          }
        }
      }),
      propertyParameters(),
    );
  });
});
