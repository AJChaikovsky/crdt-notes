import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fugue, rga, type Implementation, type OpShape } from "./implementation.js";
import { propertyParameters } from "./property.js";
import { concurrentRuns, typeRuns, type ConcurrentRuns } from "./runs.js";
import { opKey } from "./simulator.js";

function interleaving<O extends OpShape>(
  impl: Implementation<O>,
  runs: fc.Arbitrary<ConcurrentRuns>,
  which: string,
): void {
  describe(`interleaving: ${impl.name}`, () => {
    it(`P7: a run typed in one go ends up contiguous, in its own order (${which})`, () => {
      fc.assert(
        fc.property(runs, (spec) => {
          const { sim, runIds } = typeRuns(impl, spec);
          for (let r = 0; r < sim.size; r += 1) {
            const doc = sim.doc(r).visibleIds().map(opKey).join(",");
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
}

// RGA interleaves backward runs (ADR-0001), so it is held to forward runs only. The
// shrunk backward case is pinned in packages/crdt/test/corpus/.
interleaving(
  rga,
  concurrentRuns().filter((s) => s.runs.every((r) => r.direction === "forward")),
  "forward runs",
);
interleaving(fugue, concurrentRuns(), "forward and backward runs");
