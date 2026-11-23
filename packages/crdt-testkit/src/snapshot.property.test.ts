import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FastFugue, Fugue, type FugueOp } from "@crdt-notes/crdt";
import { fastFugue, fugue, type Implementation, asFugueDoc } from "./implementation.js";
import { propertyParameters } from "./property.js";
import { run, runSteps, scenario } from "./scenario.js";

type Doc = Fugue | FastFugue;
const loaders = [Fugue, FastFugue] as const;
const REPLICA_IDS = "ABCDE";

const edits = fc.array(
  fc.record({ del: fc.boolean(), pick: fc.nat(), char: fc.constantFrom("a", "b") }),
  { maxLength: 10 },
);

function p9(impl: Implementation<FugueOp>): void {
  describe(`P9: snapshot equivalence, snapshots taken by ${impl.name}`, () => {
    it("a loaded replica keeps behaving exactly like the original, mid-scenario", () => {
      fc.assert(
        fc.property(scenario(), fc.boolean(), edits, (s, causal, more) => {
          // Not drained: replicas disagree, ops are in flight, some may be held back.
          const sim = runSteps(impl, s, { causal });
          const everything = sim.log().map(({ op }) => op);
          for (let r = 0; r < sim.size; r += 1) {
            const original = asFugueDoc(sim.doc(r));
            const snapshot = original.snapshot();
            const copies = loaders.map((Load) =>
              Load.load(REPLICA_IDS[r] ?? "?", snapshot),
            );
            for (const copy of copies) {
              expect(copy.items()).toEqual(original.items());
              expect(copy.pendingCount).toBe(original.pendingCount);
              expect(copy.snapshot()).toBe(snapshot);
            }

            // The same ops arriving later, then the same local edits: the copies must send
            // the same ops and end in the same state, which needs the same tree shape and
            // clock, not just the same text.
            for (const op of everything)
              for (const doc of [original, ...copies]) doc.apply(op);
            for (const { del, pick, char } of more) {
              const length = original.visibleIds().length;
              const at = del && length > 0 ? pick % length : pick % (length + 1);
              const edit = (doc: Doc): FugueOp =>
                del && length > 0 ? doc.deleteAt(at) : doc.insertAt(at, char);
              const sent = edit(original);
              for (const copy of copies) expect(edit(copy)).toEqual(sent);
            }
            for (const copy of copies) expect(copy.snapshot()).toBe(original.snapshot());
          }
        }),
        propertyParameters(),
      );
    });

    it("loading a converged replica's snapshot equals replaying the full log from empty", () => {
      fc.assert(
        fc.property(scenario(), fc.boolean(), (s, causal) => {
          const sim = run(impl, s, { causal });
          for (const Load of loaders) {
            const replayed = new Load("Z");
            for (const { op } of sim.log()) replayed.apply(op);
            const loaded = Load.load("Z", asFugueDoc(sim.doc(0)).snapshot());
            expect(loaded.items()).toEqual(replayed.items());
            expect(loaded.snapshot()).toBe(replayed.snapshot());
          }
        }),
        propertyParameters(),
      );
    });
  });
}

p9(fugue);
p9(fastFugue);
