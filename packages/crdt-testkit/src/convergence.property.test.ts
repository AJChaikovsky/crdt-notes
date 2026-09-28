import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { propertyParameters } from "./property.js";
import { opKey } from "./simulator.js";
import { Rga, type Op } from "@crdt-notes/crdt";
import {
  concurrentPair,
  type EditCheck,
  run,
  runSteps,
  scenario,
  withoutDuplicates,
} from "./scenario.js";

// Properties from docs/testing-strategy.md, over random scenarios with causally valid
// delivery.
describe("convergence", () => {
  it("P1: once every op is delivered everywhere, every replica has the same text", () => {
    fc.assert(
      fc.property(scenario(), (s) => {
        const texts = run(s).texts();
        for (const text of texts) expect(text).toBe(texts[0]);
      }),
      propertyParameters(),
    );
  });

  it("P2: receiving an op again changes nothing", () => {
    fc.assert(
      fc.property(
        scenario().filter((s) => s.steps.some((step) => step.kind === "redeliver")),
        (s) => {
          // Each replica must end exactly where it would have if no op had been duplicated.
          expect(run(s).texts()).toEqual(run(withoutDuplicates(s)).texts());
        },
      ),
      propertyParameters(),
    );
  });

  it("P3: two concurrent ops applied in either order leave the same items", () => {
    fc.assert(
      fc.property(concurrentPair(), ({ scenario, first, second }) => {
        const sim = runSteps(scenario);
        const history = sim.log().map(({ op }) => op);
        const r1 = first.replica % sim.size;
        const r2 = (r1 + 1 + (second.offset % (sim.size - 1))) % sim.size;
        // Neither op has been delivered anywhere, so neither author saw the other's.
        const a = sim.edit(r1, first.edit);
        const b = sim.edit(r2, second.edit);
        if (a === null || b === null) return; // a delete on an empty document

        // Two fresh copies that have everything both authors had seen, then a and b in
        // opposite orders. Tombstones count: same text with a tombstone in a different
        // place is still a bug (see Rga.items).
        const replay = (last: readonly Op[]): Rga => {
          const rga = new Rga("Z");
          for (const op of [...history, ...last]) rga.apply(op);
          return rga;
        };
        expect(replay([b, a]).items()).toEqual(replay([a, b]).items());
      }),
      propertyParameters(),
    );
  });

  it("P4: ops that arrive before their dependencies are held, then applied, never lost", () => {
    fc.assert(
      fc.property(scenario(), (s) => {
        // Any delivery order at all, not just causally valid ones.
        const sim = run(s, { causal: false });
        for (let r = 0; r < sim.size; r += 1) {
          expect(sim.rga(r).pendingCount).toBe(0);
          expect(sim.rga(r).items()).toEqual(sim.rga(0).items());
        }
        // Nothing dropped: every insert ever made is in the document. A dropped delete
        // would leave its author's items different from everyone else's, caught above.
        expect(sim.rga(0).items().length).toBe(
          sim.log().filter(({ op }) => op.kind === "insert").length,
        );
      }),
      propertyParameters(),
    );
  });

  it("P5: every local edit lands at the author's cursor", () => {
    // What the author's screen must show after the edit, from the text before it.
    const expected = ({ before, edit }: EditCheck): string =>
      edit.kind === "insert"
        ? before.slice(0, edit.index) + edit.char + before.slice(edit.index)
        : before.slice(0, edit.index) + before.slice(edit.index + 1);
    const afterEdit = (check: EditCheck): void => {
      expect(check.after).toBe(expected(check));
    };
    fc.assert(
      fc.property(scenario(), fc.boolean(), (s, causal) => {
        run(s, { causal, afterEdit });
      }),
      propertyParameters(),
    );
  });

  it("P6: the visible document is every insert minus every deleted target", () => {
    fc.assert(
      fc.property(scenario(), fc.boolean(), (s, causal) => {
        const sim = run(s, { causal });
        const ops = sim.log().map(({ op }) => op);
        // Deletes count by target: two deletes of the same character remove it once.
        const deleted = new Set(
          ops.flatMap((op) => (op.kind === "delete" ? [opKey(op.target)] : [])),
        );
        const expected = ops
          .flatMap((op) => (op.kind === "insert" ? [opKey(op.id)] : []))
          .filter((key) => !deleted.has(key))
          .sort();
        for (let r = 0; r < sim.size; r += 1) {
          // Compared as a sorted list, so a character shown twice fails too.
          expect(sim.rga(r).visibleIds().map(opKey).sort()).toEqual(expected);
        }
      }),
      propertyParameters(),
    );
  });
});
